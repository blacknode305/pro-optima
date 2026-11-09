#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const branchRegistry = require("./branchRegistry.js");
const declarationStore = require("./declarationStore.js");
const optimaV1 = require("./optimaV1.js");

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
// Prefer a precomputed SHA-256 hex digest supplied as a Railway secret. During
// transition, derive the digest from the existing SOPTIMA_WRITE_PASSWORD secret
// at startup; never persist the raw password in a file or send it to the browser.
const configuredWriteDigest = String(process.env.SOPTIMA_WRITE_PASSWORD_HASH || "").trim();
const ADMIN_WRITE_PASSWORD_DIGEST = /^[a-f0-9]{64}$/i.test(configuredWriteDigest)
  ? Buffer.from(configuredWriteDigest, "hex")
  : process.env.SOPTIMA_WRITE_PASSWORD
    ? crypto.createHash("sha256").update(String(process.env.SOPTIMA_WRITE_PASSWORD)).digest()
    : null;
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
  for(const key of ["supplierCatalog","offers","history","stocks","transfers","dateRequests","declarations"]){
    if(db[key]!==undefined && !Array.isArray(db[key])) throw new Error(`${key} must be an array.`);
  }
  if(db.settings!==undefined && (!db.settings || typeof db.settings!=="object" || Array.isArray(db.settings))){
    throw new Error("settings must be an object.");
  }
  if(db.branches!==undefined&&(!Array.isArray(db.branches)||db.branches.some(x=>typeof x!=="string")))throw new Error("branches must be an array of names.");
  if(!Array.isArray(db.supplierCatalog)) db.supplierCatalog=[];
  if(!Array.isArray(db.offers)) db.offers=[];
  if(!Array.isArray(db.history)) db.history=[];
  if(!Array.isArray(db.stocks)) db.stocks=[];
  if(!Array.isArray(db.transfers)) db.transfers=[];
  if(!Array.isArray(db.dateRequests)) db.dateRequests=[];
  if(!Array.isArray(db.declarations)) db.declarations=[];
  if(!db.settings || typeof db.settings!=="object") db.settings={};
  if(db.dashboardx===undefined)db.dashboardx={schemaVersion:1,media:{radioStations:[]}};
  if(!db.dashboardx||typeof db.dashboardx!=="object"||Array.isArray(db.dashboardx))throw new Error("dashboardx must be an object");
  if(!db.dashboardx.media||typeof db.dashboardx.media!=="object"||Array.isArray(db.dashboardx.media))db.dashboardx.media={};
  if(!Array.isArray(db.dashboardx.media.radioStations))db.dashboardx.media.radioStations=[];
  if(!db.dashboardx.learning||typeof db.dashboardx.learning!=="object"||Array.isArray(db.dashboardx.learning))db.dashboardx.learning={};
  if(!db.dashboardx.learning.english||typeof db.dashboardx.learning.english!=="object"||Array.isArray(db.dashboardx.learning.english))
    db.dashboardx.learning.english={schemaVersion:1,revision:0,data:{}};
  return db;
}
function loadState(){
  const db = validateDb(readJson(DB_FILE,{
    version:23,suppliers:[],products:[],supplierCatalog:[],offers:[],history:[],stocks:[],
    transfers:[],dateRequests:[],declarations:[],settings:{}
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


const declarationDate=value=>{
  const text=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
  const d=new Date(text+"T12:00:00Z");
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===text;
};
function validateDeclarationInput(value,db){
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Некорректная запись декларации.");
  const supplierId=String(value.supplierId??"").trim();
  const productType=String(value.productType??"").trim().replace(/\s+/g," ");
  const startDate=String(value.startDate??"");
  const endDate=String(value.endDate??"");
  if(!supplierId||!ensureArray(db.suppliers).some(s=>String(s.id)===supplierId))throw Error("Выберите существующего поставщика.");
  if(productType.length<2||productType.length>180)throw Error("Категория продукции должна содержать 2–180 символов.");
  if(!declarationDate(startDate)||!declarationDate(endDate))throw Error("Укажите корректные даты действия.");
  if(endDate<startDate)throw Error("Дата окончания не может быть раньше даты начала.");
  return {supplierId,productType,startDate,endDate};
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
function adminWriteOk(req) {
  const supplied = String(req.headers["x-optima-write-password"] || "");
  if (!ADMIN_WRITE_PASSWORD_DIGEST || !supplied || supplied.length > 1024) return false;
  const suppliedDigest = crypto.createHash("sha256").update(supplied).digest();
  return crypto.timingSafeEqual(suppliedDigest, ADMIN_WRITE_PASSWORD_DIGEST);
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
      "Access-Control-Allow-Headers":"Content-Type, Authorization, X-Admin-Token, X-Optima-Write-Password",
      "Access-Control-Allow-Methods":"GET,POST,PATCH,PUT,DELETE,OPTIONS"
    };
  }
  if(origin && ALLOWED_ORIGINS.includes(origin)){
    return {
      "Access-Control-Allow-Origin":origin,"Vary":"Origin",
      "Access-Control-Allow-Headers":"Content-Type, Authorization, X-Admin-Token, X-Optima-Write-Password",
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
  // Once the branch manager has created its registry, deleted or renamed branches must not reappear.
  if(Array.isArray(db.branches))return [...new Map(db.branches.filter(Boolean).map(x=>[branchKey(x),x])).values()];
  const fixed=branchRegistry.LEGACY_BRANCHES;
  const extra=ensureArray(db.suppliers).flatMap(s=>ensureArray(s.schedules).map(x=>String(x.branch||"").trim())).filter(Boolean);
  const out=[],seen=new Set();
  for(const branch of [...fixed,...extra]){
    const key=branchKey(branch);
    if(!key||seen.has(key))continue;
    seen.add(key);out.push(branch);
  }
  return out;
}
function registeredBranch(db,value){
  const requested=String(value??"").trim();
  return branchesFromDb(db).find(x=>sameBranch(x,requested))||canonicalBranch(requested);
}
function branchAccessRecord(access,branch){
  const found=Object.entries(access.branches||{}).find(([name])=>sameBranch(name,branch));
  return found?found[1]:null;
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
  const dayName=DAYS[reqIdx];
  const rule=schedule?.deliveryTimingByDay?.[dayName];
  // Missing rules retain the legacy behavior for backwards compatibility.
  if(rule==="same"||rule==="next"||rule==="two"){
    const minOffset=rule==="two"?2:rule==="next"?1:0;
    if(!deliveryDays.length)return addDaysIso(requestDate,minOffset);
    for(let offset=minOffset;offset<minOffset+7;offset++){
      if(deliveryDays.includes(dayIndexFromIso(addDaysIso(requestDate,offset)))){
        return addDaysIso(requestDate,offset);
      }
    }
  }
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
  const rows=ensureArray(db.offers).filter(o=>
    String(o.supplierId)===String(supplierId)&&Number(o.productId)===Number(productId)&&
    (String(o.branch||"*")==="*"||sameBranch(o.branch,branch))
  );
  if(!rows.length)return null;

  // Match the admin "Заказник": for a concrete branch the branch-specific
  // row overrides the wildcard row. Most importantly, an explicit
  // "Неактивен" is final — never fall back to an inactive offer.
  const specific=rows.filter(o=>String(o.branch||"*")!=="*"&&sameBranch(o.branch,branch));
  const effective=specific.length?specific:rows.filter(o=>String(o.branch||"*")==="*");
  const same=effective.filter(o=>!unit||normalize(offerUnit(o))===normalize(unit));
  const pool=same.length?same:effective;
  const active=pool.filter(o=>manualSetting(o,branch)!==false);
  if(!active.length)return null;
  return active.sort((a,b)=>(hasPrice(a)?0:1)-(hasPrice(b)?0:1)||Number(a.price||Infinity)-Number(b.price||Infinity))[0]||null;
}
function chooseAssignment(db,product,branch,scheduled){
  if(!productUsedOnBranch(product,branch))return null;
  const byId=new Map(scheduled.map(x=>[String(x.s.id),x.s]));
  const byName=new Map(scheduled.map(x=>[normalize(x.s.name),x.s]));
  let candidates=productLinks(product).map((link,i)=>{
    const s=byId.get(String(link.supplierId||""))||byName.get(normalize(link.supplier));
    if(!s)return null;
    const unit=String(link.unit||product.unit||"");
    const o=offerFor(db,s.id,product.id,branch,unit);
    if(!o)return null;
    return {supplierId:s.id,supplier:s,link,o,orderUnit:unit,priority:Number.isFinite(Number(link.priority))?Number(link.priority):i};
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
function excludeUnusedProductsForBranch(db,branch,items){
  let changed=0;
  for(const item of ensureArray(items)){
    if(item?.used!==false&&item?.stock!=="-")continue;
    const product=ensureArray(db.products).find(p=>
      (item.productId!==null&&item.productId!==undefined&&String(p.id)===String(item.productId))||
      ((!item.productId)&&normalize(p.name)===normalize(item.product))
    );
    if(!product)continue;
    const next=[];
    for(const raw of ensureArray(product.excludedBranches)){
      const name=registeredBranch(db,raw);
      if(name&&!next.some(x=>sameBranch(x,name)))next.push(name);
    }
    const canonical=registeredBranch(db,branch);
    if(canonical&&!next.some(x=>sameBranch(x,canonical))){next.push(canonical);changed++}
    product.excludedBranches=next;
  }
  return changed;
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
  "version","suppliers","products","supplierCatalog","offers","history","stocks","transfers","dateRequests","settings","dashboardx"
]);

async function api(req,res,pathname){
  const cors=corsHeaders(req);
  if(req.method==="OPTIONS")return send(res,204,"",cors);



  // Versioned Optima namespace: read-only, derived from the existing Railway DB.
  if(pathname.startsWith("/api/dashboardx/optima/v1/")){
    if(!adminOk(req))return send(res,401,{error:"Admin Token обязателен."},cors);
    if(req.method!=="GET")return send(res,405,{error:"Read-only API."},cors);
    const {db,meta}=loadState();
    const headers={...cors,"Cache-Control":"private, no-store"};
    if(pathname==="/api/dashboardx/optima/v1/overview")
      return send(res,200,optimaV1.overview(db,meta),headers);
    const requestUrl=new URL(req.url,"http://localhost");
    if(pathname==="/api/dashboardx/optima/v1/products"){
      const index=optimaV1.productIndex(db,requestUrl.searchParams.get("q")||"",
        requestUrl.searchParams.get("limit")||300);
      return send(res,200,{ok:true,schemaVersion:1,revision:meta.revision,...index},headers);
    }
    if(pathname==="/api/dashboardx/optima/v1/passport"){
      const productId=requestUrl.searchParams.get("productId");
      if(!productId)return send(res,400,{error:"productId обязателен."},headers);
      const passport=optimaV1.passport(db,productId);
      if(!passport)return send(res,404,{error:"Наименование не найдено."},headers);
      return send(res,200,{ok:true,revision:meta.revision,...passport},headers);
    }
    return send(res,404,{error:"Unknown Optima v1 endpoint."},headers);
  }

  // Private English learning data owned by DashboardX, not by production orders.
  // No unauthenticated endpoint returns translations, vocabulary, or progress.
  // A dedicated revision prevents silent overwrites from multiple devices.
  if(pathname==="/api/dashboardx/learning/english"){
    if(!adminOk(req))return send(res,401,{error:"Admin token required"},cors);
    if(req.method==="GET"){
      const {db}=loadState();
      const state=db.dashboardx.learning.english;
      return send(res,200,{ok:true,revision:Number(state.revision||0),
        updatedAt:state.updatedAt||null,data:state.data||{}},cors);
    }
    if(req.method==="PATCH"){
      const body=await readBody(req);
      if(!body||!Number.isSafeInteger(body.baseRevision)||!body.changes||typeof body.changes!=="object"||Array.isArray(body.changes))
        return send(res,400,{error:"Expected baseRevision and changes object"},cors);
      const allowed=new Set(["done","bookmarks","weak","readingDone","readingDrafts","readingChecks",
        "savedWords","readingTheme","selected","view","level","phoneticsDone"]);
      const changes=body.changes;
      if(!Object.keys(changes).length||Object.keys(changes).some(key=>!allowed.has(key)))
        return send(res,400,{error:"Unknown or empty English learning change"},cors);
      function stringArray(value,max,size=150){
        if(!Array.isArray(value)||value.length>max||value.some(item=>typeof item!=="string"||item.length>size))
          throw Error("Invalid learning list");
        return [...new Set(value)];
      }
      function textMap(value,max,keyLimit=80,textLimit=7000){
        if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length>max)
          throw Error("Invalid learning map");
        const out=Object.create(null);
        for(const [key,val] of Object.entries(value)){
          if(key.length>keyLimit||typeof val!=="string"||val.length>textLimit)throw Error("Invalid learning text");
          Object.defineProperty(out,key,{value:val,enumerable:true,configurable:true,writable:true});
        }
        return out;
      }
      const clean={};
      try{
        for(const [key,val] of Object.entries(changes)){
          if(["done","bookmarks","readingDone","phoneticsDone"].includes(key))clean[key]=stringArray(val,500);
          else if(key==="weak"||key==="readingChecks"){
            if(!val||typeof val!=="object"||Array.isArray(val)||Object.keys(val).length>500)throw Error("Invalid learning scores");
            const map=Object.create(null);
            for(const [name,n] of Object.entries(val)){
              if(name.length>100||!(typeof n==="boolean"||(Number.isInteger(n)&&n>=0&&n<=10)))
                throw Error("Invalid learning score");
              Object.defineProperty(map,name,{value:n,enumerable:true,writable:true,configurable:true});
            }
            clean[key]=map;
          }else if(key==="readingDrafts")clean[key]=textMap(val,200,80,7000);
          else if(key==="savedWords"){
            if(!Array.isArray(val)||val.length>1200)throw Error("Too many saved words");
            clean[key]=val.map(word=>{
              if(!word||typeof word!=="object"||Array.isArray(word))throw Error("Invalid saved word");
              const term=String(word.term||"").trim(),translation=String(word.translation||"").trim(),
                kind=String(word.kind||"").trim(),grammarId=String(word.grammarId||"").trim();
              if(!term||term.length>120||translation.length>400||kind.length>60||grammarId.length>80)
                throw Error("Invalid saved word");
              const attempts=Math.max(0,Math.min(1000,Number(word.attempts)||0));
              const correct=Math.max(0,Math.min(attempts,Number(word.correct)||0));
              return {term,translation,kind,grammarId,attempts,correct,
                addedAt:typeof word.addedAt==="string"?word.addedAt.slice(0,35):nowIso()};
            });
          }else{
            if(typeof val!=="string"||val.length>80)throw Error("Invalid learning setting");
            clean[key]=val;
          }
        }
      }catch(e){return send(res,400,{error:e.message},cors)}
      return enqueueWrite(async()=>{
        const state=loadState(),current=clone(state.db),english=state.db.dashboardx.learning.english;
        const revision=Number(english.revision||0);
        if(revision!==body.baseRevision)return send(res,409,{
          error:"Learning data changed on another device",revision,data:english.data||{}
        },cors);
        english.data={...(english.data||{}),...clean};
        english.revision=revision+1;english.updatedAt=nowIso();
        commitDb(state.db,current,state.meta);
        return send(res,200,{ok:true,revision:english.revision,updatedAt:english.updatedAt},cors);
      });
    }
    return send(res,405,{error:"Method not allowed"},cors);
  }

  // DashboardX-owned namespace: can be migrated to an independent DashboardX database.
  if(pathname==="/api/dashboardx/radio/stations" || /^\/api\/dashboardx\/radio\/stations\/[^/]+$/.test(pathname)){
    if(!adminOk(req))return send(res,401,{error:"Admin token required"},cors);
    if(req.method==="GET"&&pathname==="/api/dashboardx/radio/stations"){
      const {db}=loadState();
      return send(res,200,{ok:true,stations:db.dashboardx.media.radioStations},cors);
    }
    if(req.method==="POST"&&pathname==="/api/dashboardx/radio/stations"){
      const body=await readBody(req);
      const name=String(body.name||"").trim(),raw=String(body.url||"").trim();
      let stream;try{stream=new URL(raw)}catch{return send(res,400,{error:"Invalid stream URL"},cors)}
      if(!name||name.length>120||raw.length>2048||!["https:","http:"].includes(stream.protocol)||stream.username||stream.password)
        return send(res,400,{error:"Invalid station"},cors);
      return enqueueWrite(async()=>{
        const state=loadState(),current=clone(state.db),db=state.db;
        const stations=db.dashboardx.media.radioStations;
        if(stations.length>=300)return send(res,409,{error:"Station limit reached"},cors);
        if(stations.some(s=>s.url===stream.href))return send(res,409,{error:"Station already saved"},cors);
        const station={id:uid("dxradio"),name,url:stream.href,createdAt:nowIso()};
        stations.push(station);commitDb(db,current,state.meta);
        return send(res,201,{ok:true,station},cors);
      });
    }
    const match=pathname.match(/^\/api\/dashboardx\/radio\/stations\/([^/]+)$/);
    if(match&&req.method==="DELETE")return enqueueWrite(async()=>{
      const state=loadState(),current=clone(state.db),db=state.db;
      const stations=db.dashboardx.media.radioStations;
      const index=stations.findIndex(s=>s.id===decodeURIComponent(match[1]));
      if(index<0)return send(res,404,{error:"Station not found"},cors);
      stations.splice(index,1);commitDb(db,current,state.meta);
      return send(res,200,{ok:true},cors);
    });
    return send(res,405,{error:"Method not allowed"},cors);
  }

  if(pathname==="/api/health"&&req.method==="GET"){
    const {meta}=loadState();
    return send(res,200,{ok:true,service:"pro-optima-node-v23",revision:meta.revision,updatedAt:meta.updatedAt},cors);
  }
  if(pathname==="/api/db"&&req.method==="GET"){
    if(!adminOk(req))return send(res,401,{error:"Admin Token обязателен для чтения базы."},cors);
    const {db,meta}=loadState();
    // DashboardX translations and personal vocabulary are private to the authenticated API.
    const publicDb={...db,dashboardx:{...db.dashboardx}};
    delete publicDb.dashboardx.learning;
    return send(res,200,{ok:true,revision:meta.revision,updatedAt:meta.updatedAt,data:publicDb},cors);
  }

  if(pathname==="/api/operator/login"&&req.method==="POST"){
    const body=await readBody(req);
    const {db}=loadState();
    const branch=registeredBranch(db,body.branch),pin=String(body.pin||"");
    if(!branchesFromDb(db).some(x=>sameBranch(x,branch)))return send(res,400,{error:"Неизвестное производство."},cors);
    const access=loadAccess(),rec=branchAccessRecord(access,branch);
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
        // A dash in branch stock means the product is not used by this branch at all.
        // Persist that branch-level exclusion so it disappears from the admin orderbook
        // and from every future supplier order for this branch. Supplier inactivity is
        // separate and only changes which supplier receives an otherwise active product.
        excludeUnusedProductsForBranch(db,branch,items);
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
  // Every privileged PRO OPTIMA mutation must be validated on the server:
  // token alone grants read access, never write access.
  if(!["GET","HEAD","OPTIONS"].includes(req.method) && !adminWriteOk(req))
    return send(res,403,{error:"Для изменения данных нужен пароль администратора Оптима."},cors);

  if(pathname==="/api/dashboardx/branches"&&req.method==="GET"){
    const {db,meta}=loadState();
    return send(res,200,{ok:true,revision:meta.revision,...branchRegistry.discover(db,loadAccess())},cors);
  }
  if(pathname==="/api/dashboardx/branches/preview"&&req.method==="POST"){
    const body=await readBody(req),{db,meta}=loadState();
    if(!Number.isSafeInteger(Number(body.baseRevision))||Number(body.baseRevision)!==Number(meta.revision))
      return send(res,409,{error:"База изменилась. Обновите филиалы и повторите.",revision:meta.revision},cors);
    let plan;
    try{plan=branchRegistry.planBranchChange(db,loadAccess(),body);}
    catch(e){return send(res,400,{error:e.message},cors);}
    const hash=crypto.createHash("sha256").update(JSON.stringify({revision:meta.revision,report:plan.report,access:plan.access})).digest("hex");
    return send(res,200,{ok:true,revision:meta.revision,previewHash:hash,...plan.report},cors);
  }
  if(pathname==="/api/dashboardx/branches/apply"&&req.method==="POST"){
    const body=await readBody(req);
    return enqueueWrite(async()=>{
      const state=loadState(),current=clone(state.db),meta=state.meta,originalAccess=loadAccess();
      if(!Number.isSafeInteger(Number(body.baseRevision))||Number(body.baseRevision)!==Number(meta.revision))
        return send(res,409,{error:"Конфликт версии. Обновите филиалы и просмотрите изменения повторно.",revision:meta.revision},cors);
      let plan;
      try{plan=branchRegistry.planBranchChange(state.db,originalAccess,body);}
      catch(e){return send(res,400,{error:e.message},cors);}
      const hash=crypto.createHash("sha256").update(JSON.stringify({revision:meta.revision,report:plan.report,access:plan.access})).digest("hex");
      if(!body.previewHash||!timingSafeEqualText(String(body.previewHash),hash))
        return send(res,409,{error:"План изменился. Просмотрите последствия операции ещё раз."},cors);
      if(!plan.report.allowed)return send(res,409,{error:"Обнаружены конфликты. Данные не изменены.",conflicts:plan.report.conflicts},cors);
      // Both the database and branch credential store are backed up BEFORE any mutation.
      const originalMeta=clone(meta),accessChanged=JSON.stringify(plan.access)!==JSON.stringify(originalAccess);
      const stamp=nowIso().replace(/[:.]/g,"-")+"-branches-"+crypto.randomBytes(3).toString("hex");
      try{
        validateDb(plan.db);
        backupCurrent(current,meta.revision);
        fs.writeFileSync(path.join(BACKUP_DIR,stamp+"_access.json"),JSON.stringify(originalAccess,null,2),"utf8");
        if(accessChanged)writeJsonAtomic(ACCESS_FILE,plan.access);
        writeJsonAtomic(DB_FILE,plan.db);
        const nextMeta={revision:Number(meta.revision||0)+1,updatedAt:nowIso()};
        writeJsonAtomic(META_FILE,nextMeta);
        return send(res,200,{ok:true,revision:nextMeta.revision,summary:plan.report.changes},cors);
      }catch(e){
        // Best-effort rollback if either store failed to commit; backups remain available.
        try{writeJsonAtomic(DB_FILE,current);writeJsonAtomic(ACCESS_FILE,originalAccess);writeJsonAtomic(META_FILE,originalMeta);}catch(rollbackError){
          console.error("[SOPTIMA] Branch migration rollback failed:",rollbackError);
        }
        console.error("[SOPTIMA] Branch migration failed:",e);
        return send(res,500,{error:"Не удалось сохранить изменения. Резервные копии сохранены."},cors);
      }
    });
  }
  const declarationFileMatch=pathname.match(/^\/api\/dashboardx\/declarations\/attachments\/([a-zA-Z0-9_-]{1,100})\/([a-f0-9-]{36})$/i);
  if(declarationFileMatch&&req.method==="GET"){
    const {db}=loadState();
    const file=declarationStore.findFile(db,DATA_DIR,declarationFileMatch[1],declarationFileMatch[2]);
    if(!file)return send(res,404,{error:"Файл не найден."},cors);
    try{
      const bytes=fs.readFileSync(file.path);
      return send(res,200,bytes,{...cors,"Content-Type":file.attachment.mime,
        "X-Content-Type-Options":"nosniff",
        "Content-Disposition":file.attachment.mime==="application/pdf"?"attachment":"inline",
        "Cache-Control":"private, no-store"});
    }catch{return send(res,404,{error:"Файл недоступен в хранилище."},cors);}
  }
  // Files are served only after the global Admin token check; never through a public static folder.
  if(pathname==="/api/dashboardx/declarations"&&req.method==="POST"){
    const body=await readBody(req);
    return enqueueWrite(async()=>{
      const state=loadState(),db=state.db,meta=state.meta,current=clone(db);
      if(!Number.isSafeInteger(body?.baseRevision)||Number(body.baseRevision)!==Number(meta.revision))
        return send(res,409,{error:"База изменилась. Обновите документы и повторите действие.",revision:meta.revision},cors);
      const action=String(body.action||"");
      if(action==="save"){
        const requestedId=String(body.declaration?.id??"").trim();
        const index=requestedId?db.declarations.findIndex(x=>String(x.id)===requestedId):-1;
        if(requestedId&&index===-1)return send(res,404,{error:"Документ не найден. Обновите список."},cors);
        const old=index>=0?db.declarations[index]:null;
        let record;
        try{record=declarationStore.normalizeRecord(body.declaration,db,old);}
        catch(error){return send(res,400,{error:error.message},cors);}
        const duplicate=db.declarations.some((x,i)=>i!==index&&
          (record.importSourceId&&x.importSourceId===record.importSourceId||
           record.documentNumber&&x.documentType===record.documentType&&
             normalize(x.documentNumber)===normalize(record.documentNumber)));
        if(duplicate)return send(res,409,{error:"Документ с таким номером или исходным файлом уже сохранён."},cors);
        const createdPaths=[];
        try{
          declarationStore.storeFiles(DATA_DIR,record,body.files||[],createdPaths);
          if(index>=0)db.declarations[index]=record;else db.declarations.push(record);
          const nextMeta=commitDb(db,current,meta);
          return send(res,200,{ok:true,revision:nextMeta.revision,declaration:record},cors);
        }catch(error){
          for(const file of createdPaths)try{fs.unlinkSync(file)}catch{}
          return send(res,400,{error:"Не удалось сохранить документ: "+error.message},cors);
        }
      }
      if(action==="import"){
        const entries=body.records;
        if(!Array.isArray(entries)||entries.length<1||entries.length>12)
          return send(res,400,{error:"Выберите пакет из 1–12 документов."},cors);
        const createdPaths=[],imported=[],skipped=[],updated=[];
        try{
          const seen=new Set(db.declarations.map(x=>String(x.importSourceId||"")).filter(Boolean));
          for(const entry of entries){
            const source=String(entry?.importSourceId||"").trim();
            if(!/^photo-[a-f0-9]{64}$/.test(source))throw Error("Неизвестный идентификатор исходного файла.");
            if(seen.has(source)){
              // Re-importing a newer review bundle can add missing item names to older
              // unreviewed drafts, but never overwrite confirmed or edited positions.
              const existing=db.declarations.find(x=>String(x.importSourceId||"")===source);
              if(existing?.reviewStatus==="needs_review"&&
                 !(existing.productItems||[]).length&&Array.isArray(entry.productItems)&&entry.productItems.length){
                const next=declarationStore.normalizeRecord({productItems:entry.productItems,
                  productType:existing.productType,documentType:existing.documentType,
                  endDate:existing.endDate},db,existing);
                existing.productItems=next.productItems;
                existing.updatedAt=nowIso();
                updated.push({id:existing.id,importSourceId:source});
              }else skipped.push(source);
              continue;
            }
            seen.add(source);
            const data=declarationStore.normalizeRecord({...entry,reviewStatus:"needs_review",supplierId:null},db);
            declarationStore.storeFiles(DATA_DIR,data,entry.files||[],createdPaths);
            if(!data.attachments.length||data.attachments[0].sha256!==source.slice(6))
              throw Error("Идентификатор фотографии не совпал с вложением.");
            db.declarations.push(data);imported.push({id:data.id,importSourceId:source});
          }
          if(!imported.length&&!updated.length)return send(res,200,{ok:true,revision:meta.revision,imported:[],updated,skipped},cors);
          const nextMeta=commitDb(db,current,meta);
          return send(res,200,{ok:true,revision:nextMeta.revision,imported,updated,skipped},cors);
        }catch(error){
          for(const file of createdPaths)try{fs.unlinkSync(file)}catch{}
          return send(res,400,{error:"Не удалось импортировать документы: "+error.message},cors);
        }
      }
      if(["archive","restore","request_replacement","cancel_replacement"].includes(action)){
        const id=String(body.id??"").trim();
        const record=db.declarations.find(x=>String(x.id)===id);
        if(!id||!record)return send(res,404,{error:"Документ не найден. Обновите список."},cors);
        const archived=Boolean(record.archivedAt);
        const timestamp=nowIso();
        if(action==="archive"){
          if(archived)return send(res,200,{ok:true,revision:meta.revision,declaration:record},cors);
          const reason=String(body.reason??"").trim();
          if(!["expired","replaced","other"].includes(reason))
            return send(res,400,{error:"Выберите причину переноса в архив."},cors);
          const note=String(body.note??"").trim();
          if(note.length>300)return send(res,400,{error:"Примечание к архиву должно быть до 300 символов."},cors);
          record.archivedAt=timestamp;
          record.archiveReason=reason;
          record.archiveNote=note;
        }else if(action==="restore"){
          if(!archived)return send(res,200,{ok:true,revision:meta.revision,declaration:record},cors);
          record.archivedAt=null;record.archiveReason="";record.archiveNote="";
        }else{
          if(archived)return send(res,409,{error:"Архивный документ нельзя отправить на повторный запрос. Сначала верните его в рабочий список."},cors);
          if(action==="request_replacement"){
            if(record.replacementRequestedAt)return send(res,200,{ok:true,revision:meta.revision,declaration:record},cors);
            record.replacementRequestedAt=timestamp;
          }else{
            if(!record.replacementRequestedAt)return send(res,200,{ok:true,revision:meta.revision,declaration:record},cors);
            record.replacementRequestedAt=null;
          }
        }
        record.updatedAt=timestamp;
        const nextMeta=commitDb(db,current,meta);
        return send(res,200,{ok:true,revision:nextMeta.revision,declaration:record},cors);
      }
      if(action==="delete"){
        const id=String(body.id??"").trim();
        const index=db.declarations.findIndex(x=>String(x.id)===id);
        if(!id||index<0)return send(res,404,{error:"Документ не найден. Обновите список."},cors);
        const target=db.declarations[index];
        const referenced=db.declarations.some(x=>String(x.replacesId||"")===id);
        if(target.archivedAt||target.reviewStatus==="confirmed"||(target.attachments||[]).length||referenced)
          return send(res,409,{error:"Документ с архивной историей, подтверждением или фотографиями нельзя удалить. Используйте архив."},cors);
        db.declarations.splice(index,1);
        const nextMeta=commitDb(db,current,meta);
        // Keep private source files until archive retention is handled separately.
        return send(res,200,{ok:true,revision:nextMeta.revision,id},cors);
      }
      return send(res,400,{error:"Операция с документом не поддерживается."},cors);
    });
  }
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
      if(Object.hasOwn(body.changes,"declarations"))return send(res,400,{error:"Изменения документов доступны только через специальный API."},cors);
      if(Array.isArray(body.changes.suppliers)){
        const remaining=new Set(body.changes.suppliers.map(x=>String(x?.id)));
        const removed=new Set(db.suppliers.filter(s=>!remaining.has(String(s.id))).map(s=>String(s.id)));
        if(db.declarations.some(d=>removed.has(String(d.supplierId))))
          return send(res,409,{error:"Нельзя удалить поставщика: к нему прикреплены декларации. Сначала перенесите или удалите эти записи."},cors);
      }
      for(const [key,value] of Object.entries(body.changes)){if(ALLOWED_TOP_LEVEL.has(key))db[key]=value}
      try{validateDb(db)}catch(e){return send(res,400,{error:e.message},cors)}
      const nextMeta=commitDb(db,current,meta);
      return send(res,200,{ok:true,revision:nextMeta.revision,updatedAt:nextMeta.updatedAt},cors);
    });
  }
  if(pathname==="/api/admin/import"&&req.method==="POST"){
    const body=await readBody(req),incoming=body.data||body;
    // Legacy PRO OPTIMA imports must not erase the DashboardX namespace.
    if(incoming&&incoming.dashboardx===undefined)incoming.dashboardx=clone(loadState().db.dashboardx);
    if(incoming&&incoming.branches===undefined&&Array.isArray(loadState().db.branches))incoming.branches=clone(loadState().db.branches);
    // Legacy imports must never replace the separately managed document archive.
    if(incoming)incoming.declarations=clone(loadState().db.declarations);
    try{validateDb(incoming)}catch(e){return send(res,400,{error:e.message},cors)}
    const ids=new Set(incoming.suppliers.map(s=>String(s.id)));
    if(incoming.declarations.some(d=>!ids.has(String(d.supplierId))))
      return send(res,409,{error:"Импорт удалит поставщиков с сохранёнными декларациями. Исправьте соответствия поставщиков."},cors);
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
  if(pathname==="/api/dashboardx/catalog/upgrade"&&req.method==="POST"){
    const body=await readBody(req);
    if(!body||typeof body.update!=="object"||Array.isArray(body.update))return send(res,400,{error:"Missing upgrade payload"},cors);
    if(!Number.isFinite(Number(body.baseRevision)))return send(res,400,{error:"Missing base revision"},cors);
    return enqueueWrite(async()=>{
      const state=loadState(),current=clone(state.db),db=state.db,meta=state.meta;
      if(Number(body.baseRevision)!==Number(meta.revision))return send(res,409,{error:"Конфликт версии. Обновите каталог и повторите импорт.",revision:meta.revision},cors);
      let summary;try{summary=applySupplierUpdate(db,body.update)}catch(e){return send(res,400,{error:e.message},cors)}
      const nextMeta=commitDb(db,current,meta);
      return send(res,200,{ok:true,summary,revision:nextMeta.revision},cors);
    });
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
    const rows=branchesFromDb(db).map(branch=>({branch,configured:!!branchAccessRecord(access,branch),updatedAt:branchAccessRecord(access,branch)?.updatedAt||null}));
    return send(res,200,{ok:true,passwordRequiredForPins:true,branches:rows},cors);
  }
  if(pathname==="/api/admin/access"&&req.method==="PUT"){
    if(!adminWriteOk(req))return send(res,403,{error:"Для смены пароля производства требуется Admin Token и пароль администратора."},cors);
    const body=await readBody(req);
    const branch=canonicalBranch(body.branch),pin=String(body.pin||"");
    const {db}=loadState();
    if(!branchesFromDb(db).some(x=>sameBranch(x,branch)))return send(res,400,{error:"Неизвестное производство."},cors);
    if(pin.length<4)return send(res,400,{error:"Пароль производства должен быть минимум 4 символа."},cors);
    return enqueueWrite(async()=>{
      const access=loadAccess();
      const old=Object.keys(access.branches).find(name=>sameBranch(name,branch));
      if(old!==undefined&&old!==branch){access.branches[branch]=access.branches[old];delete access.branches[old];}
      setBranchPin(access,branch,pin);access.updatedAt=nowIso();writeJsonAtomic(ACCESS_FILE,access);
      return send(res,200,{ok:true,branch},cors);
    });
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