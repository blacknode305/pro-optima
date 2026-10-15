"use strict";

const crypto=require("crypto");

const PORT=Number(process.env.PORT||8787);
const ADMIN_TOKEN=String(process.env.SOPTIMA_ADMIN_TOKEN||"").trim();
const DAYS=["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"];
const DAY_MAP=new Map(DAYS.map((x,i)=>[x.toLocaleLowerCase("ru-RU"),i]));
const normalize=s=>String(s??"").trim().toLocaleLowerCase("ru-RU");
const ensureArray=v=>Array.isArray(v)?v:[];
const uid=prefix=>prefix+"_"+Date.now().toString(36)+"_"+crypto.randomBytes(4).toString("hex");

function dateInAlmaty(d=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function dayIndexFromIso(iso){const [y,m,d]=String(iso).split("-").map(Number);return new Date(Date.UTC(y,m-1,d,12,0,0)).getUTCDay()}
function addDaysIso(iso,n){const [y,m,d]=String(iso).split("-").map(Number),dt=new Date(Date.UTC(y,m-1,d,12));dt.setUTCDate(dt.getUTCDate()+n);return dt.toISOString().slice(0,10)}
function parseDays(text){return String(text||"").split(/[,;/]+/).map(x=>x.trim()).filter(Boolean).map(x=>DAY_MAP.get(normalize(x))).filter(Number.isInteger)}
function scheduleFor(supplier,branch){return ensureArray(supplier?.schedules).find(x=>normalize(x.branch)===normalize(branch))||null}
function scheduleHasDay(value,idx){return parseDays(value).includes(Number(idx))}
function deliveryDateForSchedule(schedule,requestDate){
  const reqIdx=dayIndexFromIso(requestDate),deliveryDays=parseDays(schedule?.delivery);
  if(!deliveryDays.length)return requestDate;
  let best=7;
  for(const d of deliveryDays){let delta=(d-reqIdx+7)%7;if(delta===0&&normalize(schedule?.deliveryTiming)!=="same")delta=0;if(delta<best)best=delta}
  return addDaysIso(requestDate,best===7?0:best);
}
function productUsedOnBranch(p,branch){return !ensureArray(p?.excludedBranches).some(x=>normalize(x)===normalize(branch))}
function supplierById(db,id){return ensureArray(db.suppliers).find(s=>String(s.id)===String(id))||null}
function offerUnit(o){return String(o?.unit||"").trim()}
function hasPrice(o){return Number.isFinite(Number(o?.price))&&Number(o.price)>0}
function manualSetting(o,branch){
  const map=o?.manualActiveByBranch;
  if(map&&Object.prototype.hasOwnProperty.call(map,branch))return map[branch]===true?true:map[branch]===false?false:null;
  return o?.manualActive===true?true:o?.manualActive===false?false:null;
}
function productLinks(p){return ensureArray(p?.orderSuppliers).filter(x=>x&&(x.supplierId||x.supplier))}
function offerFor(db,supplierId,productId,branch,unit){
  const rows=ensureArray(db.offers).filter(o=>String(o.supplierId)===String(supplierId)&&Number(o.productId)===Number(productId)&&(String(o.branch||"*")==="*"||normalize(o.branch)===normalize(branch)));
  const same=rows.filter(o=>!unit||normalize(offerUnit(o))===normalize(unit)),pool=same.length?same:rows,active=pool.filter(o=>manualSetting(o,branch)!==false);
  return (active.length?active:pool).sort((a,b)=>(hasPrice(a)?0:1)-(hasPrice(b)?0:1)||Number(a.price||Infinity)-Number(b.price||Infinity))[0]||null;
}
function chooseAssignment(db,product,branch,scheduled){
  if(!productUsedOnBranch(product,branch))return null;
  const byId=new Map(scheduled.map(x=>[String(x.s.id),x.s])),byName=new Map(scheduled.map(x=>[normalize(x.s.name),x.s]));
  let candidates=productLinks(product).map((link,i)=>{
    const s=byId.get(String(link.supplierId||""))||byName.get(normalize(link.supplier));if(!s)return null;
    const unit=String(link.unit||product.unit||""),o=offerFor(db,s.id,product.id,branch,unit);if(!o)return null;
    return{supplierId:s.id,supplier:s,link,o,orderUnit:unit,priority:Number.isFinite(Number(link.priority))?Number(link.priority):i};
  }).filter(Boolean);
  if(!candidates.length)return null;
  const forced=candidates.filter(x=>manualSetting(x.o,branch)===true);if(forced.length)candidates=forced;
  const priced=candidates.filter(x=>hasPrice(x.o));
  if(priced.length===1)return priced[0];
  if(priced.length>1){
    const groups=new Map();
    for(const x of priced){const k=normalize(offerUnit(x.o));if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x)}
    const comparable=[...groups.values()].filter(g=>g.length>=2);
    if(comparable.length){comparable.sort((a,b)=>Math.min(...a.map(x=>x.priority))-Math.min(...b.map(x=>x.priority)));return comparable[0].sort((a,b)=>Number(a.o.price)-Number(b.o.price)||a.priority-b.priority)[0]}
  }
  return candidates.sort((a,b)=>a.priority-b.priority||String(a.supplier.name).localeCompare(String(b.supplier.name),"ru"))[0];
}
function orderItemsForSupplierAnyDay(db,supplier,branch){
  return ensureArray(db.products).filter(p=>p.catalogStatus!=="proposal"&&productUsedOnBranch(p,branch)).map(p=>{
    const link=productLinks(p).find(x=>String(x.supplierId||"")===String(supplier.id)||normalize(x.supplier)===normalize(supplier.name));if(!link)return null;
    const unit=String(link.unit||p.unit||""),o=offerFor(db,supplier.id,p.id,branch,unit);if(!o)return null;
    return{productId:p.id,name:p.name,unit,price:hasPrice(o)?Number(o.price):null,catalogItemId:o.catalogItemId||""};
  }).filter(Boolean).sort((a,b)=>String(a.name).localeCompare(String(b.name),"ru"));
}
function buildPlanForDate(db,branch,date){
  const idx=dayIndexFromIso(date);
  const scheduled=ensureArray(db.suppliers).map(s=>({s,sch:scheduleFor(s,branch)})).filter(x=>x.sch&&scheduleHasDay(x.sch.order,idx)&&x.s.active!==false);
  const map=new Map(scheduled.map(x=>[String(x.s.id),[]]));
  for(const p of ensureArray(db.products).filter(p=>p.catalogStatus!=="proposal"&&productUsedOnBranch(p,branch))){
    const a=chooseAssignment(db,p,branch,scheduled);
    if(a&&map.has(String(a.supplierId)))map.get(String(a.supplierId)).push({productId:p.id,name:p.name,unit:a.orderUnit||p.unit||"",price:hasPrice(a.o)?Number(a.o.price):null,catalogItemId:a.o?.catalogItemId||""});
  }
  const rows=scheduled.map(x=>({supplierId:x.s.id,supplier:x.s.name,phone:x.s.phone||"",contact:x.s.contact||"",requestDate:date,deliveryDate:deliveryDateForSchedule(x.sch,date),note:x.sch.note||"",items:(map.get(String(x.s.id))||[]).sort((a,b)=>String(a.name).localeCompare(String(b.name),"ru")),source:"schedule"})).filter(x=>x.items.length);
  const approved=ensureArray(db.dateRequests).filter(r=>normalize(r.branch)===normalize(branch)&&r.status==="approved"&&r.requestedDate===date&&r.scope!=="branch_date");
  for(const r of approved){
    if(rows.some(x=>String(x.supplierId)===String(r.supplierId)))continue;
    const s=supplierById(db,r.supplierId);if(!s)continue;
    const sch=scheduleFor(s,branch),items=orderItemsForSupplierAnyDay(db,s,branch);if(!items.length)continue;
    rows.push({supplierId:s.id,supplier:s.name,phone:s.phone||"",contact:s.contact||"",requestDate:date,deliveryDate:r.requestedDeliveryDate||deliveryDateForSchedule(sch,date),note:r.reason||"",items,source:"approved_override",dateRequestId:r.id});
  }
  return rows.sort((a,b)=>String(a.supplier).localeCompare(String(b.supplier),"ru"));
}
function ordersForBranch(db,branch){return ensureArray(db.history).filter(x=>normalize(x.branch)===normalize(branch)).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))}
function branchDateRequest(db,branch,date){return ensureArray(db.dateRequests).filter(r=>r.scope==="branch_date"&&normalize(r.branch)===normalize(branch)&&r.requestedDate===date).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))[0]||null}
function isDateApproved(db,branch,date){return date===dateInAlmaty()||branchDateRequest(db,branch,date)?.status==="approved"}

function json(res,status,body){
  const payload=Buffer.from(JSON.stringify(body));
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Content-Length":payload.length,"Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET,POST,OPTIONS"});
  res.end(payload);
}
function readBody(req){return new Promise((resolve,reject)=>{const chunks=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{try{const raw=Buffer.concat(chunks).toString("utf8");resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}});req.on("error",reject)})}
async function internal(pathname,opts={}){
  const headers={"Content-Type":"application/json",...(opts.headers||{})};
  const r=await fetch(`http://127.0.0.1:${PORT}${pathname}`,{...opts,headers});
  let data={};try{data=await r.json()}catch{}
  if(!r.ok)throw Object.assign(new Error(data.error||`HTTP ${r.status}`),{status:r.status,data});
  return data;
}
async function sessionBootstrap(req){
  const auth=String(req.headers.authorization||"");
  if(!auth.startsWith("Bearer "))throw Object.assign(new Error("Сеанс производства недействителен. Войдите снова."),{status:401});
  return internal("/api/operator/bootstrap",{headers:{Authorization:auth}});
}
async function adminDb(){
  if(!ADMIN_TOKEN)throw Object.assign(new Error("SOPTIMA_ADMIN_TOKEN не настроен."),{status:500});
  return internal("/api/admin/db",{headers:{Authorization:`Bearer ${ADMIN_TOKEN}`}});
}
async function patchAdminDb(baseRevision,changes){
  return internal("/api/admin/db",{method:"PATCH",headers:{Authorization:`Bearer ${ADMIN_TOKEN}`},body:JSON.stringify({baseRevision,changes})});
}

async function handleExtraApi(req,res){
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`),pathname=url.pathname;
  if(!["/api/operator/date-access","/api/operator/bootstrap-date"].includes(pathname))return false;
  if(req.method==="OPTIONS"){json(res,204,{});return true}
  try{
    const session=await sessionBootstrap(req),branch=session.branch;
    if(pathname==="/api/operator/date-access"){
      if(!["GET","POST"].includes(req.method)){json(res,405,{error:"Метод не поддерживается."});return true}
      const requestedDate=req.method==="GET"?String(url.searchParams.get("date")||""):String((await readBody(req)).requestedDate||"");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)){json(res,400,{error:"Неверная дата."});return true}
      let fresh=await adminDb(),db=fresh.data||{},request=branchDateRequest(db,branch,requestedDate);
      if(req.method==="POST"&&requestedDate!==dateInAlmaty()&&(!request||request.status==="rejected")){
        request={id:uid("date"),scope:"branch_date",branch,supplierId:"*",supplier:"Доступ ко всей форме",requestedDate,requestedDeliveryDate:"",reason:"Вход в форму заявок на выбранную дату",status:"pending",createdAt:new Date().toISOString(),decidedAt:null,decisionNote:""};
        const next=ensureArray(db.dateRequests).concat([request]);
        try{
          const out=await patchAdminDb(fresh.revision,{dateRequests:next});
          fresh=await adminDb();db=fresh.data||{};request=branchDateRequest(db,branch,requestedDate)||request;
          json(res,200,{ok:true,request,status:request.status,revision:out.revision});return true;
        }catch(e){
          if(e.status!==409)throw e;
          fresh=await adminDb();db=fresh.data||{};request=branchDateRequest(db,branch,requestedDate);
        }
      }
      const status=request?.status||(requestedDate===dateInAlmaty()?"approved":"none");
      json(res,200,{ok:true,status,request:request||null,approved:status==="approved"});return true;
    }
    if(pathname==="/api/operator/bootstrap-date"&&req.method==="GET"){
      const date=String(url.searchParams.get("date")||dateInAlmaty());
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){json(res,400,{error:"Неверная дата."});return true}
      const fresh=await adminDb(),db=fresh.data||{};
      if(!isDateApproved(db,branch,date)){
        const r=branchDateRequest(db,branch,date);
        json(res,403,{error:r?.status==="rejected"?"Доступ к этой дате отклонён администратором.":"Доступ к этой дате ещё не подтверждён администратором.",status:r?.status||"none"});return true;
      }
      const plan=buildPlanForDate(db,branch,date),dateRequests=ensureArray(db.dateRequests).filter(x=>normalize(x.branch)===normalize(branch)).slice(-100);
      json(res,200,{ok:true,revision:fresh.revision,updatedAt:fresh.updatedAt,branch,today:date,actualToday:dateInAlmaty(),selectedDate:date,dayIndex:dayIndexFromIso(date),dayName:DAYS[dayIndexFromIso(date)],plan,orders:ordersForBranch(db,branch).slice(0,250),dateRequests});return true;
    }
    json(res,405,{error:"Метод не поддерживается."});return true;
  }catch(e){
    json(res,e.status||500,{error:e.message||"Ошибка доступа к дате.",status:e.data?.status});return true;
  }
}

module.exports={handleExtraApi};
