"use strict";

const fs=require("fs");
const path=require("path");

const DATA_DIR=process.env.SOPTIMA_DATA_DIR||"/var/data";
const DB_FILE=path.join(DATA_DIR,"database.json");
const META_FILE=path.join(DATA_DIR,"meta.json");
const BACKUP_DIR=path.join(DATA_DIR,"backups");
const MARKER_FILE=path.join(DATA_DIR,".catalog-price-import-2026-10-16.done");
const IMPORT_DIR=path.join(__dirname,"import-catalog","20261016");
const EXPECTED_REVISION=362;

function norm(value){
  return String(value??"").normalize("NFKC").trim().toLocaleLowerCase("ru-RU")
    .replace(/ё/g,"е").replace(/\s+/g," ");
}
function readJson(file){return JSON.parse(fs.readFileSync(file,"utf8"))}
function writeJsonAtomic(file,value){
  const tmp=file+".tmp-"+process.pid+"-"+Date.now();
  fs.writeFileSync(tmp,JSON.stringify(value,null,2),"utf8");
  fs.renameSync(tmp,file);
}
function stableEqual(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function nextCatalogIdFactory(catalog){
  let max=0;
  for(const row of catalog){
    const m=String(row?.id||"").match(/^cat_(\d+)$/);
    if(m)max=Math.max(max,Number(m[1])||0);
  }
  const used=new Set(catalog.map(x=>String(x?.id||"")).filter(Boolean));
  return ()=>{
    let id;
    do{id="cat_"+(++max)}while(used.has(id));
    used.add(id);
    return id;
  };
}
function sanitizeItem(raw){
  const item={...raw};
  for(const key of Object.keys(item)){
    if(item[key]===undefined)delete item[key];
  }
  return item;
}
function apply(){
  if(fs.existsSync(MARKER_FILE)){
    console.log("[CATALOG-IMPORT] marker exists; skipping");
    return;
  }
  const meta=readJson(META_FILE);
  const revision=Number(meta.revision||0);
  if(revision!==EXPECTED_REVISION){
    console.error(`[CATALOG-IMPORT] revision guard blocked import: expected ${EXPECTED_REVISION}, actual ${revision}`);
    return;
  }
  const db=readJson(DB_FILE);
  const groups=fs.readdirSync(IMPORT_DIR).filter(x=>x.endsWith(".json")).sort().map(name=>readJson(path.join(IMPORT_DIR,name)));
  const payload={importId:"catalog-price-import-2026-10-16-vivat-karavan-vichi",importedAt:"2026-10-16",suppliers:groups};
  if(!Array.isArray(db.suppliers)||!Array.isArray(db.supplierCatalog))throw new Error("Invalid database catalog structure.");

  const supplierByName=new Map(db.suppliers.map(s=>[norm(s.name),s]));
  const catalog=db.supplierCatalog;
  const nextId=nextCatalogIdFactory(catalog);
  const summary={added:0,updated:0,unchanged:0,bySupplier:{}};

  for(const group of payload.suppliers){
    const supplier=supplierByName.get(norm(group.supplierName));
    if(!supplier)throw new Error(`Supplier not found: ${group.supplierName}`);
    const supplierId=String(supplier.id);
    const supplierRows=catalog.filter(x=>String(x?.supplierId)===supplierId);
    const bySource=new Map();
    const byCode=new Map();
    const byNameUnit=new Map();
    for(const row of supplierRows){
      if(row?.sourceId)bySource.set(String(row.sourceId),row);
      if(row?.code)byCode.set(norm(row.code),row);
      if(String(row?.branch||"*")==="*"){
        byNameUnit.set(`${norm(row?.name)}|${norm(row?.unit)}`,row);
      }
    }
    const supplierSummary=summary.bySupplier[group.supplierName]||{added:0,updated:0,unchanged:0,total:0};
    summary.bySupplier[group.supplierName]=supplierSummary;
    for(const raw of group.items||[]){
      supplierSummary.total++;
      const item=sanitizeItem(raw);
      let existing=null;
      if(item.sourceId)existing=bySource.get(String(item.sourceId))||null;
      if(!existing&&item.code)existing=byCode.get(norm(item.code))||null;
      if(!existing)existing=byNameUnit.get(`${norm(item.name)}|${norm(item.unit)}`)||null;

      const common={
        supplierId,
        name:String(item.name||"").trim(),
        unit:String(item.unit||"").trim(),
        branch:"*",
        importSource:String(group.sourceFile||""),
        importId:String(payload.importId||""),
        importedAt:String(payload.importedAt||"")
      };
      if(item.sourceId)common.sourceId=String(item.sourceId);
      if(item.code)common.code=String(item.code);
      for(const key of ["fat","country","shelfLifeDays","package","minPart"]){
        if(item[key]!==null&&item[key]!==undefined&&item[key]!=="")common[key]=item[key];
      }

      if(existing){
        const before={...existing};
        Object.assign(existing,common);
        if(item.price!==null&&item.price!==undefined)existing.price=Number(item.price);
        else if(existing.price===undefined)existing.price=null;
        if(existing.usedProductId===undefined)existing.usedProductId=null;
        if(stableEqual(before,existing)){summary.unchanged++;supplierSummary.unchanged++}
        else{summary.updated++;supplierSummary.updated++}
      }else{
        const row={
          id:nextId(),
          ...common,
          price:item.price===null||item.price===undefined?null:Number(item.price),
          usedProductId:null
        };
        catalog.push(row);
        if(row.sourceId)bySource.set(String(row.sourceId),row);
        if(row.code)byCode.set(norm(row.code),row);
        byNameUnit.set(`${norm(row.name)}|${norm(row.unit)}`,row);
        summary.added++;supplierSummary.added++;
      }
    }
  }

  fs.mkdirSync(BACKUP_DIR,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const backup=path.join(BACKUP_DIR,`${stamp}_pre-catalog-price-import_rev-${revision}.json`);
  fs.copyFileSync(DB_FILE,backup);

  const nextMeta={revision:revision+1,updatedAt:new Date().toISOString()};
  writeJsonAtomic(DB_FILE,db);
  writeJsonAtomic(META_FILE,nextMeta);
  fs.writeFileSync(MARKER_FILE,JSON.stringify({importId:payload.importId,revisionBefore:revision,revisionAfter:nextMeta.revision,backup,summary},null,2),"utf8");
  console.log(`[CATALOG-IMPORT] complete revision ${revision} -> ${nextMeta.revision}; ${JSON.stringify(summary)}`);
}
apply();
