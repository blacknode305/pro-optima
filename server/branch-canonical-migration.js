"use strict";

const fs=require("fs");
const path=require("path");

const DATA_DIR=process.env.SOPTIMA_DATA_DIR||"/var/data";
const DB_FILE=path.join(DATA_DIR,"database.json");
const META_FILE=path.join(DATA_DIR,"meta.json");
const ACCESS_FILE=path.join(DATA_DIR,"access.json");
const BACKUP_DIR=path.join(DATA_DIR,"backups");
const MARKER_FILE=path.join(DATA_DIR,".branches-canonical-v1.json");

const CANONICAL=["Горняк","Лободы","Нуркена"];
const ALIASES=new Map([
  ["горняк","Горняк"],
  ["лободы","Лободы"],
  ["нуркен","Нуркена"],
  ["нуркена","Нуркена"]
]);
const LEGACY_OTHER=new Set(["сарань","пришахтинск","ермекова","анжерская"]);

const normalize=value=>String(value??"").trim().toLocaleLowerCase("ru-RU");
const canonicalBranch=value=>ALIASES.get(normalize(value))||null;
const isLegacyBranch=value=>ALIASES.has(normalize(value))||LEGACY_OTHER.has(normalize(value));
const ensureArray=value=>Array.isArray(value)?value:[];
const nowIso=()=>new Date().toISOString();

function readJson(file,fallback){
  try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}
}
function writeJsonAtomic(file,value){
  const tmp=file+`.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2),"utf8");
  fs.renameSync(tmp,file);
}
function mergeDays(a,b){
  const out=[];
  for(const raw of [a,b]){
    for(const part of String(raw||"").split(/[,;/]+/).map(x=>x.trim()).filter(Boolean)){
      if(!out.some(x=>normalize(x)===normalize(part)))out.push(part);
    }
  }
  return out.join(", ");
}
function mergeText(a,b){
  const aa=String(a||"").trim(),bb=String(b||"").trim();
  if(!aa)return bb;if(!bb||normalize(aa)===normalize(bb))return aa;
  return `${aa} | ${bb}`;
}
function normalizeSchedules(rows,stats){
  const byBranch=new Map();
  for(const raw of ensureArray(rows)){
    if(!raw||typeof raw!=="object")continue;
    const branch=canonicalBranch(raw.branch);
    if(!branch){stats.removedSchedules++;continue}
    const row={...raw,branch};
    const old=byBranch.get(branch);
    if(!old){byBranch.set(branch,row);continue}
    stats.mergedSchedules++;
    old.order=mergeDays(old.order,row.order);
    old.delivery=mergeDays(old.delivery,row.delivery);
    old.note=mergeText(old.note,row.note);
    if(!old.deliveryTiming&&row.deliveryTiming)old.deliveryTiming=row.deliveryTiming;
  }
  return [...byBranch.values()];
}
function normalizeBranchList(values,stats){
  const out=[];
  for(const value of ensureArray(values)){
    const branch=canonicalBranch(value);
    if(!branch){stats.removedBranchRefs++;continue}
    if(!out.includes(branch))out.push(branch);
  }
  return out;
}
function normalizeBooleanBranchMap(map,stats){
  if(!map||typeof map!=="object"||Array.isArray(map))return {};
  const grouped=new Map();
  for(const [key,value] of Object.entries(map)){
    const branch=canonicalBranch(key);
    if(!branch){stats.removedBranchRefs++;continue}
    if(!grouped.has(branch))grouped.set(branch,[]);
    grouped.get(branch).push(value);
  }
  const out={};
  for(const branch of CANONICAL){
    const values=grouped.get(branch);if(!values?.length)continue;
    // Conservative merge: an explicit false must never become active because of an alias collision.
    out[branch]=values.some(v=>v===false)?false:values.some(v=>v===true)?true:values[0];
  }
  return out;
}
function normalizeLegacyKeys(value,stats){
  if(Array.isArray(value))return value.map(x=>normalizeLegacyKeys(x,stats));
  if(!value||typeof value!=="object")return value;
  const out={};
  for(const [key,child] of Object.entries(value)){
    if(isLegacyBranch(key)){
      const branch=canonicalBranch(key);
      if(!branch){stats.removedBranchRefs++;continue}
      const next=normalizeLegacyKeys(child,stats);
      if(out[branch]===undefined)out[branch]=next;
      else if(typeof out[branch]==="object"&&out[branch]&&!Array.isArray(out[branch])&&typeof next==="object"&&next&&!Array.isArray(next))out[branch]={...out[branch],...next};
      continue;
    }
    if(typeof child==="string"&&/(^|_)(branch|production)$/i.test(key)){
      const branch=canonicalBranch(child);
      if(branch){out[key]=branch;continue}
      if(isLegacyBranch(child)){stats.removedBranchRefs++;continue}
    }
    out[key]=normalizeLegacyKeys(child,stats);
  }
  return out;
}
function normalizeBranchRecordArray(rows,fields,stats){
  const out=[];
  for(const raw of ensureArray(rows)){
    if(!raw||typeof raw!=="object")continue;
    const row={...raw};
    let keep=true;
    for(const field of fields){
      if(row[field]===undefined||row[field]===null||String(row[field]).trim()==="")continue;
      const branch=canonicalBranch(row[field]);
      if(!branch){keep=false;break}
      row[field]=branch;
    }
    if(keep)out.push(normalizeLegacyKeys(row,stats));
    else stats.removedRecords++;
  }
  return out;
}
function migrateDb(db){
  const stats={removedSchedules:0,mergedSchedules:0,removedBranchRefs:0,removedRecords:0};
  const next=structuredClone(db||{});

  next.suppliers=ensureArray(next.suppliers).map(s=>({...s,schedules:normalizeSchedules(s?.schedules,stats)}));
  next.products=ensureArray(next.products).map(p=>{
    const row={...p};
    if(Array.isArray(row.excludedBranches))row.excludedBranches=normalizeBranchList(row.excludedBranches,stats);
    return normalizeLegacyKeys(row,stats);
  });
  next.offers=ensureArray(next.offers).flatMap(raw=>{
    if(!raw||typeof raw!=="object")return [];
    const row={...raw};
    if(row.branch!==undefined&&row.branch!==null&&String(row.branch).trim()!==""&&String(row.branch).trim()!=="*"){
      const branch=canonicalBranch(row.branch);
      if(!branch){stats.removedRecords++;return []}
      row.branch=branch;
    }
    if(row.manualActiveByBranch!==undefined)row.manualActiveByBranch=normalizeBooleanBranchMap(row.manualActiveByBranch,stats);
    return [normalizeLegacyKeys(row,stats)];
  });

  next.history=normalizeBranchRecordArray(next.history,["branch"],stats);
  next.stocks=normalizeBranchRecordArray(next.stocks,["branch"],stats);
  next.transfers=normalizeBranchRecordArray(next.transfers,["requesterBranch","fromBranch"],stats);
  next.dateRequests=normalizeBranchRecordArray(next.dateRequests,["branch"],stats);
  next.settings=normalizeLegacyKeys(next.settings||{},stats);

  return {next,stats};
}
function migrateAccess(access,stats){
  const next=structuredClone(access||{});
  const source=next.branches&&typeof next.branches==="object"&&!Array.isArray(next.branches)?next.branches:{};
  const branches={};
  for(const canonical of CANONICAL){
    const candidates=Object.entries(source).filter(([key])=>canonicalBranch(key)===canonical);
    if(!candidates.length)continue;
    const exact=candidates.find(([key])=>key===canonical);
    branches[canonical]=structuredClone((exact||candidates[0])[1]);
  }
  stats.removedAccessBranches=Math.max(0,Object.keys(source).length-Object.keys(branches).length);
  next.branches=branches;
  next.updatedAt=nowIso();
  return next;
}
function runBranchCanonicalMigration(){
  if(fs.existsSync(MARKER_FILE))return;
  if(!fs.existsSync(DB_FILE)||!fs.existsSync(META_FILE))return;

  fs.mkdirSync(BACKUP_DIR,{recursive:true});
  const db=readJson(DB_FILE,null),meta=readJson(META_FILE,{revision:0,updatedAt:null}),access=readJson(ACCESS_FILE,{version:1,branches:{}});
  if(!db||typeof db!=="object")throw new Error("Branch migration: database.json is invalid.");

  const {next,stats}=migrateDb(db);
  const nextAccess=migrateAccess(access,stats);
  const stamp=nowIso().replace(/[:.]/g,"-");
  const revision=Number(meta.revision||0);
  fs.writeFileSync(path.join(BACKUP_DIR,`${stamp}_pre-branches-canonical_rev-${revision}.json`),JSON.stringify(db,null,2),"utf8");
  fs.writeFileSync(path.join(BACKUP_DIR,`${stamp}_pre-branches-access.json`),JSON.stringify(access,null,2),"utf8");

  writeJsonAtomic(DB_FILE,next);
  if(fs.existsSync(ACCESS_FILE)||Object.keys(nextAccess.branches).length)writeJsonAtomic(ACCESS_FILE,nextAccess);
  const nextMeta={revision:revision+1,updatedAt:nowIso()};
  writeJsonAtomic(META_FILE,nextMeta);
  writeJsonAtomic(MARKER_FILE,{completedAt:nextMeta.updatedAt,fromRevision:revision,toRevision:nextMeta.revision,canonicalBranches:CANONICAL,stats});
  console.log(`[SOPTIMA] branch canonical migration complete: revision ${revision} -> ${nextMeta.revision}; branches=${CANONICAL.join(", ")}; stats=${JSON.stringify(stats)}`);
}

module.exports={runBranchCanonicalMigration,CANONICAL};
