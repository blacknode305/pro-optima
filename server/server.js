#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT = __dirname;
const DATA_DIR = process.env.SOPTIMA_DATA_DIR || "/var/data";
const SEED_DIR = path.join(ROOT, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DB_FILE = path.join(DATA_DIR, "database.json");
const META_FILE = path.join(DATA_DIR, "meta.json");
const ACCESS_FILE = path.join(DATA_DIR, "access.json");
const SEED_DB_FILE = path.join(SEED_DIR, "database.seed.json");
const SEED_META_FILE = path.join(SEED_DIR, "meta.seed.json");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY = Number(process.env.SOPTIMA_MAX_BODY || 30 * 1024 * 1024);
const ADMIN_TOKEN = String(process.env.SOPTIMA_ADMIN_TOKEN || "").trim() || crypto.randomBytes(24).toString("hex");
const SESSION_SECRET = String(process.env.SOPTIMA_SESSION_SECRET || "").trim() ||
  crypto.createHash("sha256").update(ADMIN_TOKEN + ":operator-sessions").digest("hex");
const ALLOWED_ORIGINS = String(process.env.SOPTIMA_ALLOWED_ORIGINS || "*")
  .split(",").map(x => x.trim()).filter(Boolean);
const BRANCH_SESSION_HOURS = Math.max(1, Number(process.env.SOPTIMA_BRANCH_SESSION_HOURS || 24 * 30));
const BACKUP_KEEP = Math.max(10, Number(process.env.SOPTIMA_BACKUP_KEEP || 200));
const DAYS = ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"];
const DAY_MAP = new Map(DAYS.map((x,i)=>[x.toLocaleLowerCase("ru-RU"),i]));

if (!process.env.SOPTIMA_ADMIN_TOKEN) {
  console.warn("[SOPTIMA] WARNING: SOPTIMA_ADMIN_TOKEN is not set. Temporary token:", ADMIN_TOKEN);
}

function nowIso(){ return new Date().toISOString(); }
function clone(x){ return structuredClone(x); }
function normalize(s){ return String(s ?? "").trim().toLocaleLowerCase("ru-RU"); }
function branchKey(s){ const key=normalize(s); return key==="нуркен"||key==="нуркена"?"нуркена":key; }
function canonicalBranch(s){ const key=branchKey(s); const map={"горняк":"Горняк","лободы":"Лободы","нуркена":"Нуркена","сарань":"Сарань","пришахтинск":"Пришахтинск","ермекова":"Ермекова","анжерская":"Анжерская","анжерского":"Анжерская"}; return map[key]||String(s??"").trim(); }
function uid(prefix){ return prefix + "_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex"); }
function dateInAlmaty(d = new Date()){
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Asia/Almaty", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function dayIndexInAlmaty(d = new Date()){
  const name = new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Almaty",weekday:"long"}).format(d);
  const n = name.charAt(0).toUpperCase() + name.slice(1);
  return DAYS.findIndex(x=>normalize(x)===normalize(n));
}
function addDaysIso(iso, n){
  const [y,m,d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y,m-1,d,12,0,0));
  dt.setUTCDate(dt.getUTCDate()+n);
  return dt.toISOString().slice(0,10);
}
function dayIndexFromIso(iso){
  const [y,m,d]=iso.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d,12,0,0)).getUTCDay();
}
function ensureArray(v){ return Array.isArray(v) ? v : []; }

function writeJsonAtomic(file, value){
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}
function readJson(file, fallback){
  try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch { return fallback; }
}
function ensurePersistentFiles(){
  fs.mkdirSync(DATA_DIR,{recursive:true});
  fs.mkdirSync(BACKUP_DIR,{recursive:true});
  if(!fs.existsSync(DB_FILE)){
    if(!fs.existsSync(SEED_DB_FILE)) throw new Error("Missing data/database.seed.json");
    fs.copyFileSync(SEED_DB_FILE,DB_FILE);
    console.log("[SOPTIMA] Created database.json from seed.");
  }
  if(!fs.existsSync(META_FILE)){
    if(fs.existsSync(SEED_META_FILE)) fs.copyFileSync(SEED_META_FILE,META_FILE);
    else writeJsonAtomic(META_FILE,{revision:1,updatedAt:nowIso()});
  }
  if(!fs.existsSync(ACCESS_FILE)){
    writeJsonAtomic(ACCESS_FILE,{version:1,branches:{},updatedAt:nowIso()});
  }
}
function validateDb(db){
  if(!db || typeof db!=="object" || Array.isArray(db)) throw new Error("Database must be a JSON object.");
  for(const key of ["suppliers","products"]){
    if(!Array.isArray(db[key])) throw new Error(`${key} must be an array.`);
  }
  for(const key of ["supplierCatalog","offers","history","stocks","transfers","dateRequests"]){
    if(db[key]!==undefined && !Array.isArray(db[key])) throw new Error(`${key} must be an array.`);
  }
  if(db.settings!==undefined && (!db.settings || typeof db.settings!=="object" || Array.isArray(db.settings))){
    throw new Error("settings must be an object.");
  }
  if(!Array.isArray(db.supplierCatalog)) db.supplierCatalog=[];
  if(!Array.isArray(db.offers)) db.offers=[];
  if(!Array.isArray(db.history)) db.history=[];
  if(!Array.isArray(db.stocks)) db.stocks=[];
  if(!Array.isArray(db.transfers)) db.transfers=[];
  if(!Array.isArray(db.dateRequests)) db.dateRequests=[];
  if(!db.settings || typeof db.settings!=="object") db.settings={};
  return db;
}
function loadState(){
  const db = validateDb(readJson(DB_FILE,{
    version:23,suppliers:[],products:[],supplierCatalog:[],offers:[],history:[],stocks:[],
    transfers:[],dateRequests:[],settings:{}
  }));
  const meta = readJson(META_FILE,{revision:1,updatedAt:nowIso()});
  return {db,meta};
}
function loadAccess(){
  const x=readJson(ACCESS_FILE,{version:1,branches:{},updatedAt:nowIso()});
  if(!x.branches || typeof x.branches!=="object") x.branches={};
  return x;
}
function backupCurrent(db, revision){
  const stamp = nowIso().replace(/[:.]/g,"-");
  fs.writeFileSync(path.join(BACKUP_DIR,`${stamp}_rev-${revision}.json`),JSON.stringify(db,null,2),"utf8");
  const files=fs.readdirSync(BACKUP_DIR).filter(x=>x.endsWith(".json"))
    .map(name=>({name,time:fs.statSync(path.join(BACKUP_DIR,name)).mtimeMs}))
    .sort((a,b)=>b.time-a.time);
  for(const f of files.slice(BACKUP_KEEP)){ try{fs.unlinkSync(path.join(BACKUP_DIR,f.name));}catch{} }
}
let writeQueue=Promise.resolve();
function enqueueWrite(fn){
  const task=writeQueue.then(fn,fn);
  writeQueue=task.catch(()=>{});
  return task;
}
function commitDb(next, current, meta){
  validateDb(next);
  backupCurrent(current,meta.revision);
  const nextMeta={revision:Number(meta.revision||0)+1,updatedAt:nowIso()};
  writeJsonAtomic(DB_FILE,next);
  writeJsonAtomic(META_FILE,nextMeta);
  return nextMeta;
}

function timingSafeEqualText(a,b){
  const aa=Buffer.from(String(a)), bb=Buffer.from(String(b));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function adminOk(req){
  const auth=String(req.headers.authorization||"");
  const token=auth.startsWith("Bearer ")?auth.slice(7):String(req.headers["x-admin-token"]||"");
  return !!token && timingSafeEqualText(token,ADMIN_TOKEN);
}
function hashPin(pin,salt){
  return crypto.pbkdf2Sync(String(pin),salt,120000,32,"sha256").toString("hex");
}
function setBranchPin(access,branch,pin){
  const old=access.branches[branch]||{};
  const salt=crypto.randomBytes(16).toString("hex");
  access.branches[branch]={
    salt,pinHash:hashPin(pin,salt),tokenVersion:Number(old.tokenVersion||0)+1,
    updatedAt:nowIso()
  };
}
function signPayload(payload){
  const raw=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig=crypto.createHmac("sha256",SESSION_SECRET).update(raw).digest("base64url");
  return raw+"."+sig;
}
function verifySessionToken(token){
  try{
    const [raw,sig]=String(token||"").split(".");
    if(!raw||!sig)return null;
    const expected=crypto.createHmac("sha256",SESSION_SECRET).update(raw).digest("base64url");
    if(!timingSafeEqualText(sig,expected))return null;
    const payload=JSON.parse(Buffer.from(raw,"base64url").toString("utf8"));
    if(!payload.branch || !payload.exp || Date.now()>payload.exp)return null;
    const access=loadAccess(),rec=access.branches[payload.branch];
    if(!rec || Number(rec.tokenVersion||0)!==Number(payload.v||0))return null;
    return payload;
  }catch{return null}
}
function operatorSession(req){
  const auth=String(req.headers.authorization||"");
  return auth.startsWith("Bearer ")?verifySessionToken(auth.slice(7)):null;
}

function corsHeaders(req){
  const origin=String(req.headers.origin||"");
  if(!ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes("*")){
    return {
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Headers":"Content-Type, Authorization, X-Admin-Token",
      "Access-Control-Allow-Methods":"GET,POST,PATCH,PUT,DELETE,OPTIONS"
    };
  }
  if(origin && ALLOWED_ORIGINS.includes(origin)){
    return {
      "Access-Control-Allow-Origin":origin,"Vary":"Origin",
      "Access-Control-Allow-Headers":"Content-Type, Authorization, X-Admin-Token",
      "Access-Control-Allow-Methods":"GET,POST,PATCH,PUT,DELETE,OPTIONS"
    };
  }
  return {};
}
function send(res,status,body,headers={}){
  let payload;
  if(Buffer.isBuffer(body))payload=body;
  else if(typeof body==="string")payload=Buffer.from(body);
  else payload=Buffer.from(JSON.stringify(body));
  res.writeHead(status,{
    "Content-Type":typeof body==="object"&&!Buffer.isBuffer(body)?"application/json; charset=utf-8":"text/plain; charset=utf-8",
    "Content-Length":payload.length,"Cache-Control":"no-store",...headers
  });
  res.end(payload);
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    req.on("data",chunk=>{
      size+=chunk.length;
      if(size>MAX_BODY){reject(Object.assign(new Error("Request too large."),{status:413}));req.destroy();return}
      chunks.push(chunk);
    });
    req.on("end",()=>{
      try{const raw=Buffer.concat(chunks).toString("utf8");resolve(raw?JSON.parse(raw):{})}
      catch{reject(Object.assign(new Error("Invalid JSON."),{status:400}))}
    });
    req.on("error",reject);
  });
}

function branchesFromDb(db){
  const fixed=["Лободы","Нуркена","Горняк","Пришахтинск","Сарань","Ермекова","Анжерская"];
  const extra=ensureArray(db.suppliers).flatMap(s=>ensureArray(s.schedules).map(x=>String(x.branch||"").trim())).filter(Boolean);
  const out=[],seen=new Set();
  for(const branch of [...fixed,...extra]){
    const key=branchKey(branch);
    if(!key||seen.has(key))continue;
    seen.add(key);out.push(branch);
  }
  return out;
}
function scheduleFor(supplier,branch){
  return ensureArray(supplier?.schedules).find(x=>sameBranch(x.branch,branch))||null;
}
function parseDays(text){
  return String(text||"").split(/[,;/]+/).map(x=>x.trim()).filter(Boolean)
    .map(x=>DAY_MAP.get(normalize(x))).filter(x=>Number.isInteger(x));
}
function scheduleHasDay(value,idx){
  return parseDays(value).includes(Number(idx));
}
function deliveryDateForSchedule(schedule,requestDate){
  const reqIdx=dayIndexFromIso(requestDate);
  const deliveryDays=parseDays(schedule?.delivery);
  if(!deliveryDays.length)return requestDate;
  let best=7;
  for(const d of deliveryDays){
    let delta=(d-reqIdx+7)%7;
    if(delta===0 && normalize(schedule?.deliveryTiming)!=="same") delta=0;
    if(delta<best)best=delta;
  }
  return addDaysIso(requestDate,best===7?0:best);
}
function productUsedOnBranch(p,branch){
  return !ensureArray(p?.excludedBranches).some(x=>sameBranch(x,branch));
}
function supplierById(db,id){return ensureArray(db.suppliers).find(s=>String(s.id)===String(id))||null}
function offerUnit(o){return String(o?.unit||"").trim()}
function hasPrice(o){return Number.isFinite(Number(o?.price)) && Number(o.price)>0}
function manualSetting(o,branch){
  const map=o?.manualActiveByBranch;
  if(map){
    const key=Object.keys(map).find(x=>sameBranch(x,branch));
    if(key!==undefined)return map[key]===true?true:map[key]===false?false:null;
  }
  return o?.manualActive===true?true:o?.manualActive===false?false:null;
}
function productLinks(p){
  return ensureArray(p?.orderSuppliers).filter(x=>x&&(x.supplierId||x.supplier));
}
function offerFor(db,supplierId,productId,branch,unit){
  // Keep operator forms in sync with the admin order planner:
  // one effective offer per supplier/product. A branch-specific row
  // overrides the wildcard row regardless of price, and a manually
  // disabled effective row means this supplier is not eligible.
  const rows=ensureArray(db.offers).filter(o=>
    String(o.supplierId)===String(supplierId)&&Number(o.productId)===Number(productId)&&
    (String(o.branch||"*")==="*"||sameBranch(o.branch,branch))
  );
  let effective=null;
  for(const row of rows){
    const specific=String(row.branch||"*")!=="*"&&sameBranch(row.branch,branch);
    if(!effective||specific)effective=row;
  }
  if(!effective||manualSetting(effective,branch)===false)return null;
  return effective;
}
function chooseAssignment(db,product,branch,scheduled){
  if(!productUsedOnBranch(product,branch))return null;
  const byName=new Map(scheduled.map(x=>[normalize(x.s.name),x.s]));
  let candidates=productLinks(product).map((link,i)=>{
    // Admin planner resolves working-table links by supplier name.
    // Do the same here so stale supplierId values cannot resurrect
    // a supplier that the admin plan has already excluded.
    const s=byName.get(normalize(link.supplier));
    if(!s)return null;
    const unit=String(link.unit||product.unit||"");
    const o=offerFor(db,s.id,product.id,branch,unit);
    if(!o)return null;
    return {supplierId:s.id,supplier:s,link,o,orderUnit:unit,priority:Number(link.priority)||0};
  }).filter(Boolean);
  if(!candidates.length)return null;
  const forced=candidates.filter(x=>manualSetting(x.o,branch)===true);
  if(forced.length)candidates=forced;
  const priced=candidates.filter(x=>hasPrice(x.o));
  if(priced.length===1)return priced[0];
  if(priced.length>1){
    const groups=new Map();
    for(const x of priced){
      const k=normalize(offerUnit(x.o));
      if(!groups.has(k))groups.set(k,[]);
      groups.get(k).push(x);
    }
    const comparable=[...groups.values()].filter(g=>g.length>=2);
    if(comparable.length){
      comparable.sort((a,b)=>Math.min(...a.map(x=>x.priority))-Math.min(...b.map(x=>x.priority)));
      return comparable[0].sort((a,b)=>Number(a.o.price)-Number(b.o.price)||a.priority-b.priority)[0];
    }
  }
  return candidates.sort((a,b)=>a.priority-b.priority||String(a.supplier.name).localeCompare(String(b.supplier.name),"ru"))[0];
}
function orderItemsForSupplierAnyDay(db,supplier,branch){
  return ensureArray(db.products).filter(p=>p.catalogStatus!=="proposal"&&productUsedOnBranch(p,branch))
    .map(p=>{
      const link=productLinks(p).find(x=>String(x.supplierId||"")===String(supplier.id)||normalize(x.supplier)===normalize(supplier.name));
      if(!link)return null;
      const unit=String(link.unit||p.unit||"");
      const o=offerFor(db,supplier.id,p.id,branch,unit);
      if(!o)return null;
      return {productId:p.id,name:p.name,unit,price:hasPrice(o)?Number(o.price):null,catalogItemId:o.catalogItemId||""};
    }).filter(Boolean).sort((a,b)=>String(a.name).localeCompare(String(b.name),"ru"));
}
function buildPlanForDate(db,branch,date){
  const idx=dayIndexFromIso(date);
  const scheduled=ensureArray(db.suppliers).map(s=>({s,sch:scheduleFor(s,branch)}))
    .filter(x=>x.sch&&scheduleHasDay(x.sch.order,idx)&&x.s.active!==false);
  const map=new Map(scheduled.map(x=>[String(x.s.id),[]]));
  for(const p of ensureArray(db.products).filter(p=>p.catalogStatus!=="proposal"&&productUsedOnBranch(p,branch))){
    const a=chooseAssignment(db,p,branch,scheduled);
    if(a&&map.has(String(a.supplierId))){
      map.get(String(a.supplierId)).push({
        productId:p.id,name:p.name,unit:a.orderUnit||p.unit||"",
        price:hasPrice(a.o)?Number(a.o.price):null,catalogItemId:a.o?.catalogItemId||""
      });
    }
  }
  const rows=scheduled.map(x=>({
    supplierId:x.s.id,supplier:x.s.name,phone:x.s.phone||"",contact:x.s.contact||"",
    requestDate:date,deliveryDate:deliveryDateForSchedule(x.sch,date),
    note:x.sch.note||"",items:(map.get(String(x.s.id))||[]).sort((a,b)=>String(a.name).localeCompare(String(b.name),"ru")),
    source:"schedule"
  })).filter(x=>x.items.length);

  const approved=ensureArray(db.dateRequests).filter(r=>
    sameBranch(r.branch,branch)&&r.status==="approved"&&r.requestedDate===date
  );
  for(const r of approved){
    if(rows.some(x=>String(x.supplierId)===String(r.supplierId)))continue;
    const s=supplierById(db,r.supplierId);if(!s)continue;
    const sch=scheduleFor(s,branch);
    const items=orderItemsForSupplierAnyDay(db,s,branch);
    if(!items.length)continue;
    rows.push({
      supplierId:s.id,supplier:s.name,phone:s.phone||"",contact:s.contact||"",
      requestDate:date,deliveryDate:r.requestedDeliveryDate||deliveryDateForSchedule(sch,date),
      note:r.reason||"",items,source:"approved_override",dateRequestId:r.id
    });
  }
  return rows.sort((a,b)=>String(a.supplier).localeCompare(String(b.supplier),"ru"));
}
function ordersForBranch(db,branch){
  return ensureArray(db.history).filter(x=>sameBranch(x.branch,branch))
    .sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}
function transfersForBranch(db,branch){
  return ensureArray(db.transfers).filter(x=>sameBranch(x.requesterBranch,branch)||sameBranch(x.fromBranch,branch))
    .sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}
function operatorBootstrap(db,branch){
  const today=dateInAlmaty();
  return {
    branch,today,dayIndex:dayIndexFromIso(today),dayName:DAYS[dayIndexFromIso(today)],
    plan:buildPlanForDate(db,branch,today),
    orders:ordersForBranch(db,branch).slice(0,250),
    transfers:transfersForBranch(db,branch).slice(0,250),
    dateRequests:ensureArray(db.dateRequests).filter(x=>sameBranch(x.branch,branch)).slice(-100),
    branches:branchesFromDb(db),
    suppliers:ensureArray(db.suppliers).filter(s=>scheduleFor(s,branch)&&s.active!==false)
      .map(s=>({id:s.id,name:s.name,phone:s.phone||"",contact:s.contact||""})).sort((a,b)=>a.name.localeCompare(b.name,"ru")),
    products:ensureArray(db.products).filter(p=>p.catalogStatus!=="proposal"&&productUsedOnBranch(p,branch))
      .map(p=>({id:p.id,name:p.name,unit:p.unit||""})).sort((a,b)=>a.name.localeCompare(b.name,"ru"))
  };
}
function findOrder(db,id){return ensureArray(db.history).find(x=>String(x.id)===String(id))||null}
function sameBranch(a,b){return normalize(canonicalBranch(a))===normalize(canonicalBranch(b))}
function sanitizeQty(v){
  if(v===null||v===undefined||v==="")return 0;
  if(v==="-")return "-";
  const n=Number(String(v).replace(",","."));
  return Number.isFinite(n)?n:0;
}
function sanitizeOrderItems(items){
  return ensureArray(items).map(x=>({
    productId:Number(x.productId)||null,
    product:String(x.product||x.name||"").trim(),
    used:x.used!==false,
    stock:sanitizeQty(x.stock),
    stockUnit:String(x.stockUnit||x.unit||"").trim(),
    expected:sanitizeQty(x.expected ?? x.order),
    unit:String(x.unit||"").trim(),
    confirmed:x.confirmed===undefined?undefined:sanitizeQty(x.confirmed),
    delivered:x.delivered===undefined?null:sanitizeQty(x.delivered),
    deliveredUnit:String(x.deliveredUnit||x.unit||"").trim(),
    note:String(x.note||"").trim()
  })).filter(x=>x.product);
}
function filterOrderItemsToPlan(items,plan){
  const allowedItems=ensureArray(plan?.items);
  const allowedIds=new Set(allowedItems.map(x=>Number(x.productId)).filter(x=>Number.isFinite(x)&&x>0));
  const allowedNames=new Set(allowedItems.map(x=>normalize(x.name)).filter(Boolean));
  return sanitizeOrderItems(items).filter(item=>{
    const id=Number(item.productId);
    return (Number.isFinite(id)&&id>0&&allowedIds.has(id))||allowedNames.has(normalize(item.product));
  });
}
const STAGE_RANK={draft:0,sent:1,confirmed:2,expected:2,done:3,cancelled:3};
function canSetStage(oldStage,newStage){
  if(!STAGE_RANK.hasOwnProperty(newStage))return false;
  if(!oldStage)return true;
  if(newStage==="cancelled")return true;
  return STAGE_RANK[newStage]>=STAGE_RANK[oldStage] || (oldStage==="sent"&&newStage==="sent");
}

function applySupplierUpdate(db,update){
  if(!update || update.updateType!=="pro-optima-supplier-update-v1") throw new Error("Unsupported update file.");
  const summary={suppliers:0,catalogUpsert:0,catalogRetired:0,links:0,offers:0,products:0};

  for(const incoming of ensureArray(update.suppliersUpsert)){
    if(!incoming.id && !incoming.name)continue;
    let s=ensureArray(db.suppliers).find(x=>String(x.id)===String(incoming.id)) ||
      ensureArray(db.suppliers).find(x=>normalize(x.name)===normalize(incoming.name));
    if(!s){s={id:incoming.id||uid("sup"),name:incoming.name||"Новый поставщик",contact:"",phone:"",note:"",active:true,schedules:[]};db.suppliers.push(s)}
    for(const key of ["name","contact","phone","note","active"]){if(incoming[key]!==undefined)s[key]=incoming[key]}
    if(Array.isArray(incoming.schedules))s.schedules=clone(incoming.schedules);
    summary.suppliers++;
  }

  const catById=new Map(ensureArray(db.supplierCatalog).map(x=>[String(x.id),x]));
  for(const incoming of ensureArray(update.catalogUpsert)){
    if(!incoming.id || !incoming.supplierId || !incoming.name)continue;
    const existing=catById.get(String(incoming.id));
    if(existing){
      const keepUsed=existing.usedProductId;
      Object.assign(existing,clone(incoming));
      if((incoming.usedProductId===undefined||incoming.usedProductId===null)&&keepUsed&&!incoming.clearUsedProductId)existing.usedProductId=keepUsed;
      delete existing.clearUsedProductId;
    }
    else{
      const row={
        id:String(incoming.id),supplierId:String(incoming.supplierId),name:String(incoming.name),
        unit:String(incoming.unit||""),price:incoming.price??null,branch:String(incoming.branch||"*"),
        boxQty:incoming.boxQty??null,packQty:incoming.packQty??null,usedProductId:incoming.usedProductId??null,
        placeholder:!!incoming.placeholder,availability:incoming.availability||"unknown",
        availabilityNote:String(incoming.availabilityNote||""),source:String(incoming.source||"Update"),
        sourceProductId:incoming.sourceProductId??null,note:String(incoming.note||"")
      };
      db.supplierCatalog.push(row);catById.set(String(row.id),row);
    }
    const synced=catById.get(String(incoming.id));
    if(synced){
      for(const offer of ensureArray(db.offers).filter(o=>String(o.catalogItemId||"")===String(synced.id))){
        offer.supplierId=synced.supplierId;
        offer.unit=synced.unit||offer.unit||"";
        offer.price=synced.price??null;
        if(!offer.branch)offer.branch=synced.branch||"*";
        summary.offers++;
      }
    }
    summary.catalogUpsert++;
  }
  for(const id of ensureArray(update.catalogRetireIds)){
    const row=catById.get(String(id));if(!row)continue;
    row.availability="unavailable";
    row.availabilityNote=String(update.retireNote||"Нет в новом прайс-листе");
    summary.catalogRetired++;
  }

  const productsById=new Map(ensureArray(db.products).map(p=>[Number(p.id),p]));
  for(const patch of ensureArray(update.productPatches)){
    const p=productsById.get(Number(patch.productId));if(!p)continue;
    if(Array.isArray(patch.catalogLinks)){
      p.catalogLinks=[...new Set(patch.catalogLinks.map(String))];
      summary.links++;
    }
    if(Array.isArray(patch.addCatalogLinks)){
      p.catalogLinks=[...new Set([...(ensureArray(p.catalogLinks).map(String)),...patch.addCatalogLinks.map(String)])];
      summary.links++;
    }
    if(Array.isArray(patch.removeCatalogLinks)){
      const remove=new Set(patch.removeCatalogLinks.map(String));
      p.catalogLinks=ensureArray(p.catalogLinks).map(String).filter(x=>!remove.has(x));
      summary.links++;
    }
    if(patch.procurementDefault!==undefined)p.procurementDefault=clone(patch.procurementDefault);
    if(patch.procurementByBranch!==undefined)p.procurementByBranch=clone(patch.procurementByBranch);
    if(patch.orderSuppliers!==undefined)p.orderSuppliers=clone(patch.orderSuppliers);
    if(patch.orderSupplierByBranch!==undefined)p.orderSupplierByBranch=clone(patch.orderSupplierByBranch);
    if(patch.analogProductIds!==undefined)p.analogProductIds=clone(patch.analogProductIds);
    summary.products++;
  }
  for(const link of ensureArray(update.catalogLinks)){
    const row=catById.get(String(link.catalogItemId));
    const p=productsById.get(Number(link.productId));
    if(!row||!p)continue;
    for(const other of db.products){
      if(Number(other.id)!==Number(p.id) && Array.isArray(other.catalogLinks)){
        other.catalogLinks=other.catalogLinks.filter(x=>String(x)!==String(row.id));
      }
    }
    row.usedProductId=Number(p.id);
    p.catalogLinks=[...new Set([...(ensureArray(p.catalogLinks).map(String)),String(row.id)])];
    let offer=ensureArray(db.offers).find(o=>String(o.catalogItemId||"")===String(row.id));
    if(!offer){
      const supplier=ensureArray(db.suppliers).find(s=>String(s.id)===String(row.supplierId));
      offer={
        supplierId:row.supplierId,productId:p.id,supplier:supplier?.name||"",product:p.name,
        branch:row.branch||"*",unit:row.unit||p.unit||"",price:row.price??null,
        manualActive:null,manualActiveByBranch:{},catalogItemId:row.id
      };
      db.offers.push(offer);
    }else{
      offer.productId=p.id;offer.product=p.name;offer.supplierId=row.supplierId;
      offer.unit=row.unit||offer.unit||p.unit||"";offer.price=row.price??null;
    }
    summary.offers++;
    summary.links++;
  }

  for(const row of db.supplierCatalog){
    if(row.usedProductId){
      const p=productsById.get(Number(row.usedProductId));
      if(p)p.catalogLinks=[...new Set([...(ensureArray(p.catalogLinks).map(String)),String(row.id)])];
    }
  }

  for(const incoming of ensureArray(update.offersUpsert)){
    if(!incoming.supplierId || !incoming.productId)continue;
    let o=ensureArray(db.offers).find(x=>
      String(x.supplierId)===String(incoming.supplierId)&&Number(x.productId)===Number(incoming.productId)&&
      String(x.branch||"*")===String(incoming.branch||"*")&&String(x.catalogItemId||"")===String(incoming.catalogItemId||"")
    );
    if(!o){o={};db.offers.push(o)}
    Object.assign(o,clone(incoming));
    summary.offers++;
  }

  db.version=Math.max(23,Number(db.version||0));
  return summary;
}

const ALLOWED_TOP_LEVEL=new Set([
  "version","suppliers","products","supplierCatalog","offers","history","stocks","transfers","dateRequests","settings"
]);

async function api(req,res,pathname){
  const cors=corsHeaders(req);
  if(req.method==="OPTIONS")return send(res,204,"",cors);

  if(pathname==="/api/health"&&req.method==="GET"){
    const {meta}=loadState();
    return send(res,200,{ok:true,service:"pro-optima-node-v23",revision:meta.revision,updatedAt:meta.updatedAt},cors);
  }
  if(pathname==="/api/db"&&req.method==="GET"){
    const {db,meta}=loadState();
    return send(res,200,{ok:true,revision:meta.revision,updatedAt:meta.updatedAt,data:db},cors);
  }

  if(pathname==="/api/operator/login"&&req.method==="POST"){
    const body=await readBody(req);
    const branch=canonicalBranch(body.branch),pin=String(body.pin||"");
    const {db}=loadState();
    if(!branchesFromDb(db).some(x=>sameBranch(x,branch)))return send(res,400,{error:"Неизвестное производство."},cors);
    const access=loadAccess(),rec=access.branches[branch];
    if(!rec)return send(res,403,{error:"Для этого производства пароль ещё не задан администратором."},cors);
    if(!timingSafeEqualText(hashPin(pin,rec.salt),rec.pinHash))return send(res,403,{error:"Неверный пароль производства."},cors);
    const exp=Date.now()+BRANCH_SESSION_HOURS*3600*1000;
    const token=signPayload({branch,exp,v:Number(rec.tokenVersion||0)});
    return send(res,200,{ok:true,branch,token,expiresAt:new Date(exp).toISOString()},cors);
  }

  if(pathname.startsWith("/api/operator/")){
    const session=operatorSession(req);
    if(!session)return send(res,401,{error:"Сеанс производства недействителен. Войдите снова."},cors);
    const branch=session.branch;

    if(pathname==="/api/operator/bootstrap"&&req.method==="GET"){
      const {db,meta}=loadState();
      return send(res,200,{ok:true,revision:meta.revision,updatedAt:meta.updatedAt,...operatorBootstrap(db,branch)},cors);
    }

    if(pathname==="/api/operator/date-request"&&req.method==="POST"){
      const body=await readBody(req);
      return enqueueWrite(async()=>{
        const state=loadState(),current=clone(state.db),db=state.db,meta=state.meta;
        const s=supplierById(db,body.supplierId);
        if(!s)return send(res,400,{error:"Поставщик не найден."},cors);
        const requestedDate=String(body.requestedDate||"");
        if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate))return send(res,400,{error:"Неверная дата."},cors);
        const r={id:uid("date"),branch,supplierId:s.id,supplier:s.name,requestedDate,
          requestedDeliveryDate:String(body.requestedDeliveryDate||""),reason:String(body.reason||"").trim(),
          status:"pending",createdAt:nowIso(),decidedAt:null,decisionNote:""};
        db.dateRequests.push(r);
        const nextMeta=commitDb(db,current,meta);
        return send(res,200,{ok:true,request:r,revision:nextMeta.revision},cors);
      });
    }

    if(pathname==="/api/operator/orders"&&req.method==="POST"){
      const body=await readBody(req);
      return enqueueWrite(async()=>{
        const state=loadState(), current=clone(state.db), db=state.db, meta=state.meta;
        const supplier=supplierById(db,body.supplierId);
        if(!supplier)return send(res,400,{error:"Поставщик не найден."},cors);
        const requestDate=String(body.requestDate||dateInAlmaty());
        const allowedPlan=buildPlanForDate(db,branch,requestDate);
        if(!allowedPlan.some(x=>String(x.supplierId)===String(supplier.id))){
          return send(res,403,{error:"Для этого поставщика нет разрешённой заявки на выбранную дату."},cors);
        }
        let order=body.id?findOrder(db,body.id):null;
        if(order && !sameBranch(order.branch,branch))return send(res,403,{error:"Чужая заявка."},cors);
        if(!order){
          order=ensureArray(db.history).find(x=>sameBranch(x.branch,branch)&&String(x.supplierId||"")===String(supplier.id)&&x.requestDate===requestDate&&x.stage!=="done")||null;
        }
        const stage=String(body.stage||"sent");
        if(order && !canSetStage(order.stage,stage))return send(res,409,{error:"Недопустимый переход статуса."},cors);
        const plan=allowedPlan.find(x=>String(x.supplierId)===String(supplier.id));
        const items=filterOrderItemsToPlan(body.items,plan);
        if(!order){
          order={
            id:uid("ord"),requestDate,deliveryDate:String(body.deliveryDate||plan?.deliveryDate||requestDate),
            branch,supplierId:supplier.id,supplier:supplier.name,period:`${DAYS[dayIndexFromIso(requestDate)]} → ${DAYS[dayIndexFromIso(String(body.deliveryDate||plan?.deliveryDate||requestDate))]}`,
            items,stage,revision:1,createdAt:nowIso(),note:String(body.note||"")
          };
          db.history.push(order);
        }else{
          order.items=items;order.deliveryDate=String(body.deliveryDate||order.deliveryDate||plan?.deliveryDate||requestDate);
          order.stage=stage;order.note=String(body.note??order.note??"");
          order.revision=Number(order.revision||1)+1;order.updatedAt=nowIso();
        }
        if(stage==="sent"){order.sentAt=nowIso();if(body.correction)order.lastCorrectedAt=nowIso()}
        if(stage==="confirmed"||stage==="expected"){order.confirmedAt=nowIso();order.stage="confirmed"}
        if(stage==="done"){order.receivedAt=nowIso()}
        const nextMeta=commitDb(db,current,meta);
        return send(res,200,{ok:true,order,revision:nextMeta.revision},cors);
      });
    }

    const orderMatch=pathname.match(/^\/api\/operator\/orders\/([^/]+)$/);
    if(orderMatch&&req.method==="PATCH"){
      const body=await readBody(req);
      return enqueueWrite(async()=>{
        const state=loadState(),current=clone(state.db),db=state.db,meta=state.meta;
        const order=findOrder(db,decodeURIComponent(orderMatch[1]));
        if(!order||!sameBranch(order.branch,branch))return send(res,404,{error:"Заявка не найдена."},cors);
        const newStage=body.stage?String(body.stage):order.stage;
        if(!canSetStage(order.stage,newStage))return send(res,409,{error:"Недопустимый переход статуса."},cors);
        if(body.items)order.items=sanitizeOrderItems(body.items);
        if(body.note!==undefined)order.note=String(body.note||"");
        order.stage=newStage;order.revision=Number(order.revision||1)+1;order.updatedAt=nowIso();
        if(newStage==="sent"){order.sentAt=order.sentAt||nowIso();if(body.correction)order.lastCorrectedAt=nowIso()}
        if(newStage==="confirmed"||newStage==="expected"){order.stage="confirmed";order.confirmedAt=nowIso()}
        if(newStage==="done"){
          order.receivedAt=nowIso();
          for(const item of order.items){
            if(item.delivered===null||item.delivered===undefined||item.delivered==="-")continue;
            const p=ensureArray(db.products).find(x=>Number(x.id)===Number(item.productId)||normalize(x.name)===normalize(item.product));
            if(!p)continue;
            db.stocks.push({id:uid("stock"),branch,productId:p.id,date:dateInAlmaty(),value:item.delivered,
              unit:item.deliveredUnit||item.unit||p.unit||"",sourceSupplier:order.supplier,sourceOrderId:order.id,createdAt:nowIso()});
          }
        }
        const nextMeta=commitDb(db,current,meta);
        return send(res,200,{ok:true,order,revision:nextMeta.revision},cors);
      });
    }

    if(pathname==="/api/operator/transfers"&&req.method==="POST"){
      const body=await readBody(req);
      return enqueueWrite(async()=>{
        const state=loadState(),current=clone(state.db),db=state.db,meta=state.meta;
        const fromBranch=String(body.fromBranch||"").trim();
        if(!fromBranch||sameBranch(fromBranch,branch))return send(res,400,{error:"Укажите другое производство, откуда запросить перемещение."},cors);
        if(!branchesFromDb(db).some(x=>sameBranch(x,fromBranch)))return send(res,400,{error:"Производство-источник не найдено."},cors);
        const items=ensureArray(body.items).map(x=>({productId:Number(x.productId)||null,product:String(x.product||"").trim(),qty:sanitizeQty(x.qty),unit:String(x.unit||"").trim()})).filter(x=>x.product&&x.qty!==0);
        if(!items.length)return send(res,400,{error:"Добавьте товары."},cors);
        const tr={id:uid("move"),requesterBranch:branch,fromBranch,items,note:String(body.note||""),stage:"requested",createdAt:nowIso()};
        db.transfers.push(tr);
        const nextMeta=commitDb(db,current,meta);
        return send(res,200,{ok:true,transfer:tr,revision:nextMeta.revision},cors);
      });
    }

    const transferMatch=pathname.match(/^\/api\/operator\/transfers\/([^/]+)$/);
    if(transferMatch&&req.method==="PATCH"){
      const body=await readBody(req);
      return enqueueWrite(async()=>{
        const state=loadState(),current=clone(state.db),db=state.db,meta=state.meta;
        const tr=ensureArray(db.transfers).find(x=>String(x.id)===decodeURIComponent(transferMatch[1]));
        if(!tr)return send(res,404,{error:"Запрос на перемещение не найден."},cors);
        const isSource=sameBranch(tr.fromBranch,branch),isReceiver=sameBranch(tr.requesterBranch,branch);
        const stage=String(body.stage||tr.stage);
        const allowed=(isSource&&["approved","rejected","shipped"].includes(stage))||(isReceiver&&stage==="received");
        if(!allowed)return send(res,403,{error:"Недоступное действие для этого производства."},cors);
        tr.stage=stage;tr.updatedAt=nowIso();if(body.note!==undefined)tr.statusNote=String(body.note||"");
        if(stage==="approved")tr.approvedAt=nowIso();if(stage==="shipped")tr.shippedAt=nowIso();if(stage==="received")tr.receivedAt=nowIso();if(stage==="rejected")tr.rejectedAt=nowIso();
        const nextMeta=commitDb(db,current,meta);
        return send(res,200,{ok:true,transfer:tr,revision:nextMeta.revision},cors);
      });
    }
    return send(res,404,{error:"Operator API route not found."},cors);
  }

  if(!adminOk(req))return send(res,401,{error:"Неверный или отсутствующий Admin token."},cors);

  if(pathname==="/api/admin/db"&&req.method==="GET"){
    const {db,meta}=loadState();return send(res,200,{ok:true,revision:meta.revision,updatedAt:meta.updatedAt,data:db},cors);
  }
  if(pathname==="/api/admin/db"&&req.method==="PATCH"){
    const body=await readBody(req);
    return enqueueWrite(async()=>{
      const state=loadState(),current=clone(state.db),db=state.db,meta=state.meta;
      if(body.baseRevision!==undefined&&body.baseRevision!==null&&Number(body.baseRevision)!==Number(meta.revision)){
        return send(res,409,{error:"Конфликт версии. Сначала загрузите свежую базу.",revision:meta.revision,updatedAt:meta.updatedAt},cors);
      }
      if(!body.changes||typeof body.changes!=="object"||Array.isArray(body.changes))return send(res,400,{error:"changes должен быть объектом."},cors);
      for(const [key,value] of Object.entries(body.changes)){if(ALLOWED_TOP_LEVEL.has(key))db[key]=value}
      try{validateDb(db)}catch(e){return send(res,400,{error:e.message},cors)}
      const nextMeta=commitDb(db,current,meta);
      return send(res,200,{ok:true,revision:nextMeta.revision,updatedAt:nextMeta.updatedAt},cors);
    });
  }
  if(pathname==="/api/admin/import"&&req.method==="POST"){
    const body=await readBody(req),incoming=body.data||body;
    try{validateDb(incoming)}catch(e){return send(res,400,{error:e.message},cors)}
    return enqueueWrite(async()=>{
      const state=loadState(),current=clone(state.db),meta=state.meta;
      const nextMeta=commitDb(incoming,current,meta);
      return send(res,200,{ok:true,revision:nextMeta.revision,updatedAt:nextMeta.updatedAt},cors);
    });
  }
  if(pathname==="/api/admin/export"&&req.method==="GET"){
    const {db}=loadState();
    const payload=Buffer.from(JSON.stringify(db,null,2),"utf8");
    return send(res,200,payload,{...cors,"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="PRO_OPTIMA_backup_${dateInAlmaty()}.json"`});
  }
  if(pathname==="/api/admin/apply-update"&&req.method==="POST"){
    const update=await readBody(req);
    return enqueueWrite(async()=>{
      const state=loadState(),current=clone(state.db),db=state.db,meta=state.meta;
      let summary;try{summary=applySupplierUpdate(db,update)}catch(e){return send(res,400,{error:e.message},cors)}
      const nextMeta=commitDb(db,current,meta);
      return send(res,200,{ok:true,summary,revision:nextMeta.revision,updatedAt:nextMeta.updatedAt},cors);
    });
  }
  if(pathname==="/api/admin/access"&&req.method==="GET"){
    const {db}=loadState(),access=loadAccess();
    const rows=branchesFromDb(db).map(branch=>({branch,configured:!!access.branches[branch],updatedAt:access.branches[branch]?.updatedAt||null}));
    return send(res,200,{ok:true,branches:rows},cors);
  }
  if(pathname==="/api/admin/access"&&req.method==="PUT"){
    const body=await readBody(req);
    const branch=canonicalBranch(body.branch),pin=String(body.pin||"");
    const {db}=loadState();
    if(!branchesFromDb(db).some(x=>sameBranch(x,branch)))return send(res,400,{error:"Неизвестное производство."},cors);
    if(pin.length<4)return send(res,400,{error:"Пароль производства должен быть минимум 4 символа."},cors);
    const access=loadAccess();setBranchPin(access,branch,pin);access.updatedAt=nowIso();writeJsonAtomic(ACCESS_FILE,access);
    return send(res,200,{ok:true,branch},cors);
  }
  if(pathname==="/api/admin/date-requests"&&req.method==="GET"){
    const {db}=loadState();
    return send(res,200,{ok:true,requests:ensureArray(db.dateRequests).slice().reverse()},cors);
  }
  const decisionMatch=pathname.match(/^\/api\/admin\/date-requests\/([^/]+)\/decision$/);
  if(decisionMatch&&req.method==="POST"){
    const body=await readBody(req);
    return enqueueWrite(async()=>{
      const state=loadState(),current=clone(state.db),db=state.db,meta=state.meta;
      const r=ensureArray(db.dateRequests).find(x=>String(x.id)===decodeURIComponent(decisionMatch[1]));
      if(!r)return send(res,404,{error:"Запрос не найден."},cors);
      const decision=String(body.decision||"");
      if(!["approved","rejected"].includes(decision))return send(res,400,{error:"decision должен быть approved или rejected."},cors);
      r.status=decision;r.decidedAt=nowIso();r.decisionNote=String(body.note||"");
      if(body.requestedDeliveryDate)r.requestedDeliveryDate=String(body.requestedDeliveryDate);
      const nextMeta=commitDb(db,current,meta);
      return send(res,200,{ok:true,request:r,revision:nextMeta.revision},cors);
    });
  }
  return send(res,404,{error:"Admin API route not found."},cors);
}

ensurePersistentFiles();
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
    if(url.pathname.startsWith("/api/"))return await api(req,res,url.pathname);
    if(url.pathname==="/"&&(req.method==="GET"||req.method==="HEAD")){
      return send(res,200,{ok:true,service:"PRO OPTIMA API",version:23,health:"/api/health",database:"/api/db"});
    }
    return send(res,404,{error:"Not found"});
  }catch(e){
    console.error(e);
    if(!res.headersSent)send(res,e.status||500,{error:e.message||"Internal server error"},corsHeaders(req));
    else res.end();
  }
});
server.listen(PORT,HOST,()=>{
  const {meta}=loadState();
  console.log(`[SOPTIMA] http://${HOST}:${PORT}`);
  console.log(`[SOPTIMA] database revision: ${meta.revision}`);
  console.log(`[SOPTIMA] data: ${DB_FILE}`);
});