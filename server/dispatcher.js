"use strict";
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const DATA_DIR=process.env.SOPTIMA_DATA_DIR||"/var/data";
const ACCESS_FILE=path.join(DATA_DIR,"access.json");
const PORT=Number(process.env.PORT||8787);
const ADMIN_TOKEN=String(process.env.SOPTIMA_ADMIN_TOKEN||"").trim();
const SESSION_SECRET=String(process.env.SOPTIMA_SESSION_SECRET||"").trim()||crypto.createHash("sha256").update(ADMIN_TOKEN+":operator-sessions").digest("hex");
const SESSION_HOURS=Math.max(1,Number(process.env.SOPTIMA_DISPATCHER_SESSION_HOURS||24*30));

const normalize=s=>String(s??"").trim().toLocaleLowerCase("ru-RU");
const ensureArray=v=>Array.isArray(v)?v:[];
const clone=x=>structuredClone(x);
const nowIso=()=>new Date().toISOString();
const uid=p=>p+"_"+Date.now().toString(36)+"_"+crypto.randomBytes(4).toString("hex");
function dateInAlmaty(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${m.year}-${m.month}-${m.day}`}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function writeJsonAtomic(file,value){const tmp=file+".tmp-"+process.pid+"-"+Date.now();fs.writeFileSync(tmp,JSON.stringify(value,null,2),"utf8");fs.renameSync(tmp,file)}
function timingSafeEqualText(a,b){const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}
function hashPin(pin,salt){return crypto.pbkdf2Sync(String(pin),salt,120000,32,"sha256").toString("hex")}
function signPayload(payload){const raw=Buffer.from(JSON.stringify(payload)).toString("base64url"),sig=crypto.createHmac("sha256",SESSION_SECRET).update(raw).digest("base64url");return raw+"."+sig}
function loadAccess(){const a=readJson(ACCESS_FILE,{version:1,branches:{},updatedAt:nowIso()});if(!a.branches||typeof a.branches!=="object")a.branches={};return a}
function verifyDispatcherToken(token){try{const[raw,sig]=String(token||"").split(".");if(!raw||!sig)return null;const expected=crypto.createHmac("sha256",SESSION_SECRET).update(raw).digest("base64url");if(!timingSafeEqualText(sig,expected))return null;const p=JSON.parse(Buffer.from(raw,"base64url").toString("utf8"));if(p.role!=="dispatcher"||!p.exp||Date.now()>p.exp)return null;const rec=loadAccess().dispatcher;if(!rec||Number(rec.tokenVersion||0)!==Number(p.v||0))return null;return p}catch{return null}}
function dispatcherSession(req){const auth=String(req.headers.authorization||"");return auth.startsWith("Bearer ")?verifyDispatcherToken(auth.slice(7)):null}
function adminOk(req){const auth=String(req.headers.authorization||"");const t=auth.startsWith("Bearer ")?auth.slice(7):String(req.headers["x-admin-token"]||"");return !!t&&!!ADMIN_TOKEN&&timingSafeEqualText(t,ADMIN_TOKEN)}
function cors(req){const allowed=String(process.env.SOPTIMA_ALLOWED_ORIGINS||"*").split(",").map(x=>x.trim()).filter(Boolean),origin=String(req.headers.origin||"");let h={"Access-Control-Allow-Headers":"Content-Type, Authorization, X-Admin-Token","Access-Control-Allow-Methods":"GET,POST,PATCH,PUT,OPTIONS"};if(!allowed.length||allowed.includes("*"))h["Access-Control-Allow-Origin"]="*";else if(origin&&allowed.includes(origin)){h["Access-Control-Allow-Origin"]=origin;h.Vary="Origin"}return h}
function json(req,res,status,body){const b=Buffer.from(JSON.stringify(body));res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Content-Length":b.length,"Cache-Control":"no-store",...cors(req)});res.end(b)}
function readBody(req){return new Promise((resolve,reject)=>{const chunks=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"))}catch(e){reject(Object.assign(e,{status:400}))}});req.on("error",reject)})}
async function internal(pathname,opts={}){const h={"Content-Type":"application/json",...(opts.headers||{})};const r=await fetch(`http://127.0.0.1:${PORT}${pathname}`,{...opts,headers:h});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Object.assign(new Error(d.error||`HTTP ${r.status}`),{status:r.status,data:d});return d}
async function adminDb(){if(!ADMIN_TOKEN)throw Object.assign(new Error("Admin token не настроен."),{status:500});return internal("/api/admin/db",{headers:{Authorization:`Bearer ${ADMIN_TOKEN}`}})}
async function patchAdmin(baseRevision,changes){return internal("/api/admin/db",{method:"PATCH",headers:{Authorization:`Bearer ${ADMIN_TOKEN}`},body:JSON.stringify({baseRevision,changes})})}
function branches(db){const s=new Set();ensureArray(db.history).forEach(x=>x.branch&&s.add(x.branch));ensureArray(db.suppliers).forEach(x=>ensureArray(x.schedules).forEach(r=>r.branch&&s.add(r.branch)));return[...s].sort((a,b)=>a.localeCompare(b,"ru"))}
function cleanItems(items){return ensureArray(items).map(x=>({productId:Number(x.productId)||null,product:String(x.product||x.name||"").trim(),used:x.used!==false,stock:x.stock==="-"?"-":Number.isFinite(Number(String(x.stock??0).replace(",",".")))?Number(String(x.stock??0).replace(",",".")):0,stockUnit:String(x.stockUnit||x.unit||"").trim(),expected:Number.isFinite(Number(String(x.expected??0).replace(",",".")))?Number(String(x.expected??0).replace(",",".")):0,unit:String(x.unit||"").trim(),confirmed:x.confirmed===undefined?undefined:Number(String(x.confirmed)||0),delivered:x.delivered===null||x.delivered===undefined?null:Number(String(x.delivered)||0),deliveredUnit:String(x.deliveredUnit||x.unit||"").trim(),note:String(x.note||"").trim()})).filter(x=>x.product)}
function dispatcherData(db){return{history:ensureArray(db.history),suppliers:ensureArray(db.suppliers).filter(s=>s.active!==false).map(s=>({id:s.id,name:s.name,phone:s.phone||"",contact:s.contact||"",schedules:ensureArray(s.schedules).map(x=>({branch:x.branch||""}))})),settings:{unitPresets:ensureArray(db.settings?.unitPresets)}}}

async function handle(req,res,url){const p=url.pathname;if(!p.startsWith("/api/dispatcher/")&&!p.startsWith("/api/admin/dispatcher-access"))return false;if(req.method==="OPTIONS"){json(req,res,204,{});return true}
try{
  if(p==="/api/admin/dispatcher-access"){
    if(!adminOk(req)){json(req,res,401,{error:"Неверный или отсутствующий Admin token."});return true}
    if(req.method==="GET"){const rec=loadAccess().dispatcher;json(req,res,200,{ok:true,configured:!!rec,updatedAt:rec?.updatedAt||null});return true}
    if(req.method==="PUT"){const body=await readBody(req),pin=String(body.pin||"");if(pin.length<4){json(req,res,400,{error:"PIN сменщицы должен быть минимум 4 символа."});return true}const a=loadAccess(),old=a.dispatcher||{},salt=crypto.randomBytes(16).toString("hex");a.dispatcher={salt,pinHash:hashPin(pin,salt),tokenVersion:Number(old.tokenVersion||0)+1,updatedAt:nowIso()};a.updatedAt=nowIso();writeJsonAtomic(ACCESS_FILE,a);json(req,res,200,{ok:true,configured:true,updatedAt:a.dispatcher.updatedAt});return true}
    json(req,res,405,{error:"Метод не поддерживается."});return true
  }
  if(p==="/api/dispatcher/login"&&req.method==="POST"){const body=await readBody(req),pin=String(body.pin||""),rec=loadAccess().dispatcher;if(!rec){json(req,res,403,{error:"PIN сменщицы ещё не задан администратором."});return true}if(!timingSafeEqualText(hashPin(pin,rec.salt),rec.pinHash)){json(req,res,403,{error:"Неверный PIN сменщицы."});return true}const exp=Date.now()+SESSION_HOURS*3600*1000,token=signPayload({role:"dispatcher",exp,v:Number(rec.tokenVersion||0)});json(req,res,200,{ok:true,token,expiresAt:new Date(exp).toISOString()});return true}
  const sess=dispatcherSession(req);if(!sess){json(req,res,401,{error:"Сеанс сменщицы недействителен. Войдите снова."});return true}
  if(p==="/api/dispatcher/bootstrap"&&req.method==="GET"){const fresh=await adminDb(),db=fresh.data||{};json(req,res,200,{ok:true,revision:fresh.revision,updatedAt:fresh.updatedAt,branches:branches(db),data:dispatcherData(db)});return true}
  const m=p.match(/^\/api\/dispatcher\/orders\/([^/]+)$/);
  if(m&&req.method==="PATCH"){
    const body=await readBody(req),id=decodeURIComponent(m[1]);
    for(let attempt=0;attempt<2;attempt++){
      const fresh=await adminDb(),db=fresh.data||{},history=clone(ensureArray(db.history)),i=history.findIndex(x=>String(x.id)===String(id));if(i<0){json(req,res,404,{error:"Заявка не найдена."});return true}
      const o=history[i],oldStage=String(o.stage||"received"),newStage=body.stage?String(body.stage):oldStage;
      const allowed=new Set(["received","sent","confirmed","expected","done","cancelled"]);if(!allowed.has(newStage)){json(req,res,400,{error:"Недопустимый статус."});return true}
      if(body.items)o.items=cleanItems(body.items);if(body.note!==undefined)o.note=String(body.note||"");if(body.deliveryDate!==undefined)o.deliveryDate=String(body.deliveryDate||o.deliveryDate||"");o.stage=newStage;o.revision=Number(o.revision||1)+1;o.updatedAt=nowIso();if(newStage==="sent")o.sentAt=o.sentAt||nowIso();if(newStage==="confirmed"||newStage==="expected"){o.stage="confirmed";o.confirmedAt=nowIso()}if(newStage==="done")o.receivedAt=nowIso();
      const changes={history};
      if(newStage==="done"){
        const stocks=clone(ensureArray(db.stocks)).filter(x=>String(x.sourceOrderId||"")!==String(o.id));
        for(const item of ensureArray(o.items)){if(item.used===false||item.delivered===null||item.delivered===undefined)continue;stocks.push({id:uid("stock"),branch:o.branch,productId:Number(item.productId)||null,date:dateInAlmaty(),value:item.delivered,unit:item.deliveredUnit||item.unit||"",sourceSupplier:o.supplier,sourceOrderId:o.id,createdAt:nowIso()})}
        changes.stocks=stocks;
      }
      try{const out=await patchAdmin(fresh.revision,changes);json(req,res,200,{ok:true,order:o,revision:out.revision});return true}catch(e){if(e.status===409&&attempt===0)continue;throw e}
    }
  }
  json(req,res,404,{error:"Dispatcher API route not found."});return true
}catch(e){json(req,res,e.status||500,{error:e.message||"Ошибка dispatcher API."});return true}}
module.exports={handle};
