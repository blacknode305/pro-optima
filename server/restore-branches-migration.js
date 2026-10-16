"use strict";

const fs=require("fs");
const path=require("path");

const DATA_DIR=process.env.SOPTIMA_DATA_DIR||"/var/data";
const DB_FILE=path.join(DATA_DIR,"database.json");
const META_FILE=path.join(DATA_DIR,"meta.json");
const ACCESS_FILE=path.join(DATA_DIR,"access.json");
const BACKUP_DIR=path.join(DATA_DIR,"backups");
const MARKER_FILE=path.join(DATA_DIR,".branches-restore-v1.json");

const BRANCH_MAP=new Map([
  ["горняк","Горняк"],
  ["лободы","Лободы"],
  ["нуркен","Нуркена"],
  ["нуркена","Нуркена"],
  ["сарань","Сарань"],
  ["пришахтинск","Пришахтинск"],
  ["ермекова","Ермекова"],
  ["анжерская","Анжерская"],
  ["анжерского","Анжерская"]
]);
const norm=v=>String(v??"").trim().toLocaleLowerCase("ru-RU");
const canonical=v=>BRANCH_MAP.get(norm(v))||String(v??"").trim();
const nowIso=()=>new Date().toISOString();
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function writeAtomic(file,value){const tmp=file+`.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(tmp,JSON.stringify(value,null,2),"utf8");fs.renameSync(tmp,file)}
function newest(pattern){
  return fs.readdirSync(BACKUP_DIR).filter(name=>pattern.test(name)).map(name=>({name,time:fs.statSync(path.join(BACKUP_DIR,name)).mtimeMs})).sort((a,b)=>b.time-a.time)[0]?.name||"";
}
function mapObjKeys(obj){
  if(!obj||typeof obj!=="object"||Array.isArray(obj))return obj;
  const out={};
  for(const [k,v] of Object.entries(obj)){
    const ck=BRANCH_MAP.has(norm(k))?canonical(k):k;
    const nv=walk(v,k);
    if(out[ck]===undefined)out[ck]=nv;
    else if(typeof out[ck]==="object"&&out[ck]&&!Array.isArray(out[ck])&&typeof nv==="object"&&nv&&!Array.isArray(nv))out[ck]={...out[ck],...nv};
    else out[ck]=nv;
  }
  return out;
}
function walk(value,key=""){
  if(Array.isArray(value)){
    const mapped=value.map(v=>walk(v,key));
    if(/excludedBranches/i.test(key))return [...new Set(mapped.map(canonical))];
    return mapped;
  }
  if(!value||typeof value!=="object"){
    if(typeof value==="string"&&/(branch|production)/i.test(key))return canonical(value);
    return value;
  }
  const out={};
  for(const [k,v] of Object.entries(value)){
    if(k==="manualActiveByBranch"&&v&&typeof v==="object"&&!Array.isArray(v)){out[k]=mapObjKeys(v);continue}
    if(typeof v==="string"&&/(^|_)(branch|production)$/i.test(k)){out[k]=canonical(v);continue}
    out[k]=walk(v,k);
  }
  return out;
}
function normalizeDb(db){
  const next=walk(structuredClone(db||{}));
  if(Array.isArray(next.suppliers))for(const s of next.suppliers){
    if(!Array.isArray(s.schedules))continue;
    const seen=new Map();
    for(const row of s.schedules){
      if(!row||typeof row!=="object")continue;
      row.branch=canonical(row.branch);
      const key=norm(row.branch);
      if(!seen.has(key)){seen.set(key,row);continue}
      const base=seen.get(key);
      const mergeDays=(a,b)=>[...new Set(`${a||""},${b||""}`.split(/[,;/]+/).map(x=>x.trim()).filter(Boolean))].join(", ");
      base.order=mergeDays(base.order,row.order);base.delivery=mergeDays(base.delivery,row.delivery);
      if(!base.note&&row.note)base.note=row.note;
    }
    s.schedules=[...seen.values()];
  }
  return next;
}
function normalizeAccess(access){
  const next=structuredClone(access||{version:1,branches:{}}),out={};
  const src=next.branches&&typeof next.branches==="object"&&!Array.isArray(next.branches)?next.branches:{};
  for(const [k,v] of Object.entries(src))out[canonical(k)]=v;
  next.branches=out;next.updatedAt=nowIso();return next;
}
function restoreBranches(){
  if(fs.existsSync(MARKER_FILE))return;
  if(!fs.existsSync(DB_FILE)||!fs.existsSync(META_FILE)||!fs.existsSync(BACKUP_DIR))return;
  const meta=readJson(META_FILE,{revision:0});
  if(Number(meta.revision)!==168){
    console.warn(`[SOPTIMA] branch restore skipped: expected revision 168, got ${meta.revision}`);
    return;
  }
  const dbBackup=newest(/_pre-branches-canonical_rev-167\.json$/);
  const accessBackup=newest(/_pre-branches-access\.json$/);
  if(!dbBackup)throw new Error("Branch restore: pre-migration database backup not found.");
  const beforeDb=readJson(DB_FILE,{}),beforeAccess=readJson(ACCESS_FILE,{version:1,branches:{}});
  const restoredDb=normalizeDb(readJson(path.join(BACKUP_DIR,dbBackup),{}));
  const restoredAccess=normalizeAccess(accessBackup?readJson(path.join(BACKUP_DIR,accessBackup),beforeAccess):beforeAccess);
  const stamp=nowIso().replace(/[:.]/g,"-");
  fs.writeFileSync(path.join(BACKUP_DIR,`${stamp}_before-branch-restore_rev-168.json`),JSON.stringify(beforeDb,null,2));
  fs.writeFileSync(path.join(BACKUP_DIR,`${stamp}_before-branch-restore-access.json`),JSON.stringify(beforeAccess,null,2));
  writeAtomic(DB_FILE,restoredDb);writeAtomic(ACCESS_FILE,restoredAccess);
  const nextMeta={revision:169,updatedAt:nowIso()};writeAtomic(META_FILE,nextMeta);
  writeAtomic(MARKER_FILE,{completedAt:nextMeta.updatedAt,fromRevision:168,toRevision:169,databaseBackup:dbBackup,accessBackup:accessBackup||null});
  console.log(`[SOPTIMA] restored all branches from ${dbBackup}; revision 168 -> 169; casing normalized only`);
}
module.exports={restoreBranches};
