"use strict";
// Pure, revision-safe planning for PRO OPTIMA branch migrations.
// No data are written by this module; the server commits only a reviewed plan.
const LEGACY_BRANCHES=["Лободы","Нуркена","Горняк","Пришахтинск","Сарань","Ермекова","Анжерская"];
const canonicalNames={"горняк":"Горняк","лободы":"Лободы","нуркена":"Нуркена","сарань":"Сарань","пришахтинск":"Пришахтинск","ермекова":"Ермекова","анжерская":"Анжерская"};
const branchFields=new Set(["branch","fromBranch","toBranch","sourceBranch","targetBranch","deliveryBranch","orderBranch","productionBranch","branchName","originBranch","destinationBranch"]);
const branchArrays=new Set(["excludedBranches","allowedBranches","activeBranches","disabledBranches","productionBranches","includedBranches","branches"]);
const branchMaps=new Set(["manualActiveByBranch","byBranch","branchSettings","branchStocks","stockByBranch","quantitiesByBranch","pricesByBranch","availabilityByBranch","branchPrices","branches"]);
const skipKeys=new Set(["branchId","branchIds","gitBranch","defaultBranch"]);
const norm=v=>String(v??"").trim().replace(/\s+/g," ").toLocaleLowerCase("ru-RU");
const key=v=>{const k=norm(v);if(k==="нуркен"||k==="нуркена")return "нуркена";if(k==="анжерского")return "анжерская";return k;};
const name=v=>canonicalNames[key(v)]||String(v??"").trim().replace(/\s+/g," ");
const valid=v=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=100&&!/[\r\n<>]/.test(v);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const pathLabel=parts=>parts.map((p,i)=>typeof p==="number"?"["+p+"]":(i?".":"")+p).join("");
function discover(db,access){
  const entries=new Map();
  const add=(value,path,kind)=>{
    if(typeof value!=="string"||!value.trim()||value==="*")return;
    const raw=value.trim().replace(/\s+/g," "),id=norm(raw);
    if(!id)return;
    let item=entries.get(id);
    if(!item){item={name:raw,key:key(raw),count:0,usage:{},examples:[],registered:false};entries.set(id,item);}
    if(kind==="registry"){item.registered=true;return;}
    item.count++;const section=path[0]||"other";
    item.usage[section]=(item.usage[section]||0)+1;
    if(item.examples.length<8)item.examples.push(pathLabel(path));
  };
  const visit=(value,parts,parent)=>{
    if(!value||typeof value!=="object")return;
    if(Array.isArray(value)){
      for(let i=0;i<value.length;i++){
        if(typeof value[i]==="string"&&branchArrays.has(parent))add(value[i],[...parts,i],"array");
        else visit(value[i],[...parts,i],"");
      }
      return;
    }
    for(const [prop,v] of Object.entries(value)){
      if(skipKeys.has(prop)||prop==="branches"&&parts.length===0)continue;
      if(typeof v==="string"&&branchFields.has(prop))add(v,[...parts,prop],"field");
      else if(Array.isArray(v))visit(v,[...parts,prop],prop);
      else if(v&&typeof v==="object"){
        if(branchMaps.has(prop))for(const mapKey of Object.keys(v))add(mapKey,[...parts,prop,mapKey],"map");
        visit(v,[...parts,prop],prop);
      }
    }
  };
  visit(db,[],"");
  if(Array.isArray(db.branches))for(const v of db.branches)add(v,["branches"],"registry");
  else for(const v of LEGACY_BRANCHES)add(v,["branches"],"registry");
  for(const branch of Object.keys(access?.branches||{}))add(branch,["access","branches",branch],"access");
  const branches=[...entries.values()].sort((a,b)=>a.name.localeCompare(b.name,"ru"));
  const groups=Object.values(Object.groupBy?Object.groupBy(branches,x=>x.key):branches.reduce((m,x)=>{(m[x.key]||=[]).push(x);return m;},{}))
    .filter(xs=>xs.length>1).map(xs=>({canonical:name(xs[0].name),names:xs.map(x=>x.name),records:xs.reduce((n,x)=>n+x.count,0)}));
  return {branches,groups};
}
function planBranchChange(originalDb,originalAccess,operation){
  const db=structuredClone(originalDb),access=structuredClone(originalAccess);
  const action=String(operation?.action||""),source=String(operation?.source||"").trim();
  const target=String(operation?.target||"").trim().replace(/\s+/g," ");
  if(!["add","rename","merge","delete"].includes(action))throw Error("Неизвестная операция");
  if(action!=="add"&&!valid(source))throw Error("Выберите исходный филиал.");
  if(action!=="delete"&&!valid(target))throw Error("Название филиала должно содержать от 1 до 100 символов.");
  const original=discover(db,access);
  const find=x=>original.branches.some(b=>key(b.name)===key(x));
  if(action!=="add"&&!find(source))throw Error("Исходный филиал не найден.");
  if(action==="add"&&find(target))throw Error("Такой филиал уже существует. Выберите объединение.");
  if(action==="merge"&&(!find(target)||norm(source)===norm(target)))throw Error("Для объединения выберите другое существующее название.");
  if(action==="rename"&&key(source)===key(target)&&norm(source)===norm(target))throw Error("Название не изменилось.");
  const sourceKey=key(source),targetKey=key(target);
  const conflicts=[],changes={total:0,bySection:{},examples:[],collapsedLists:0,collapsedMaps:0};
  const note=(parts,detail)=>{
    changes.total++;
    const section=parts[0]||"other";changes.bySection[section]=(changes.bySection[section]||0)+1;
    if(changes.examples.length<20)changes.examples.push(pathLabel(parts)+(detail?" — "+detail:""));
  };
  const conflict=(parts,reason)=>{if(conflicts.length<100)conflicts.push({path:pathLabel(parts),reason});};
  const applicable=value=>key(value)===(action==="rename"||action==="merge"||action==="delete"?sourceKey:"");
  const targetExisting=value=>key(value)===targetKey;
  if(!Array.isArray(db.branches)){
    const names=new Map();
    for(const b of original.branches){const k=key(b.name);if(!names.has(k))names.set(k,name(b.name));}
    db.branches=[...names.values()];
  }
  // Stable branch registry: only one entry per canonical identity.
  if(action==="add")db.branches.push(target);
  else{
    const out=new Map();
    for(const raw of db.branches){
      if(action==="delete"&&applicable(raw))continue;
      const value=applicable(raw)?target:raw;
      const k=key(value);
      if(!out.has(k))out.set(k,value);
    }
    if(action!=="delete"&&!out.has(targetKey))out.set(targetKey,target);
    db.branches=[...out.values()];
  }
  // Rename references without deleting historical rows; duplicates inside scalar sets are safe to collapse.
  const changeValue=(v,parts)=>{
    if(typeof v==="string"&&applicable(v)&&action!=="delete"){if(v!==target){note(parts);return target;}}
    return v;
  };
  const walk=(obj,parts=[],parent="")=>{
    if(!obj||typeof obj!=="object")return;
    if(Array.isArray(obj)){
      if(branchArrays.has(parent)){
        const seen=new Set(),result=[];
        for(let i=0;i<obj.length;i++){
          const v=obj[i],newV=typeof v==="string"?changeValue(v,[...parts,i]):v;
          if(typeof newV==="string"){
            const k=key(newV);
            if(seen.has(k)){changes.collapsedLists++;continue;}
            seen.add(k);
          }
          result.push(newV);
          if(newV&&typeof newV==="object")walk(newV,[...parts,i],"");
        }
        obj.splice(0,obj.length,...result);
      }else obj.forEach((v,i)=>walk(v,[...parts,i],""));
      return;
    }
    for(const [p,v] of Object.entries(obj)){
      if(skipKeys.has(p)||p==="branches"&&parts.length===0)continue;
      if(typeof v==="string"&&branchFields.has(p))obj[p]=changeValue(v,[...parts,p]);
      else if(Array.isArray(v))walk(v,[...parts,p],p);
      else if(v&&typeof v==="object"){
        if(branchMaps.has(p)){
          const map={};
          for(const [mapKey,data] of Object.entries(v)){
            const renamed=action!=="delete"&&applicable(mapKey)?target:mapKey;
            if(renamed!==mapKey)note([...parts,p,mapKey],"ключ");
            const existing=Object.keys(map).find(k=>key(k)===key(renamed));
            if(existing!==undefined){
              if(equal(map[existing],data))changes.collapsedMaps++;
              else conflict([...parts,p,mapKey],"Разные данные для одного филиала. Нужен ручной выбор.");
              continue;
            }
            map[renamed]=data;
          }
          obj[p]=map;walk(map,[...parts,p],"");
        }else walk(v,[...parts,p],p);
      }
    }
  };
  if(action==="delete"){
    const used=original.branches.filter(b=>key(b.name)===sourceKey).reduce((n,b)=>n+b.count,0);
    if(used)conflict(["branches",source],"У филиала есть "+used+" связанных записей. Перенесите их через объединение.");
  }else if(action!=="add")walk(db,[],"");
  // One supplier must not end up with duplicate schedules. Remove only exact duplicates;
  // never guess which of two different schedules is correct.
  changes.collapsedSchedules=0;
  for(let si=0;si<(db.suppliers||[]).length;si++){
    const supplier=db.suppliers[si],seen=new Map(),schedules=Array.isArray(supplier?.schedules)?supplier.schedules:null;
    if(!schedules)continue;
    const identical=[];
    for(let i=0;i<schedules.length;i++){
      const schedule=schedules[i],k=key(schedule?.branch);
      if(action==="add"||action==="delete"||k!==targetKey)continue;
      if(seen.has(k)){
        const prior=seen.get(k),one={...prior.schedule},two={...schedule};
        delete one.branch;delete two.branch;
        if(!equal(one,two))conflict(["suppliers",si,"schedules",i],"У поставщика два разных графика для одного филиала. Сведения сохранены; объединение заблокировано.");
        else identical.push(i);
      }else seen.set(k,{schedule,i});
    }
    if(action!=="add"&&action!=="delete"){
      for(const i of identical.reverse()){schedules.splice(i,1);changes.collapsedSchedules++;}
    }
  }
  // Access credentials are independent of the DB. Never overwrite a PIN hash or silently combine access.
  if(action==="delete"){
    for(const k of Object.keys(access.branches||{}))if(applicable(k))conflict(["access","branches",k],"Для филиала настроен доступ. Переносите через объединение.");
  }
  if(action==="rename"||action==="merge"){
    const next={};
    for(const [k,v] of Object.entries(access.branches||{})){
      const renamed=applicable(k)?target:k;
      const existing=Object.keys(next).find(x=>key(x)===key(renamed));
      if(existing!==undefined){
        if(equal(next[existing],v))changes.collapsedMaps++;
        else conflict(["access","branches",k],"У двух названий разные пароли производства. Автоматическое объединение заблокировано.");
      }else next[renamed]=v;
    }
    access.branches=next;
  }
  if(action==="add"||action==="delete")changes.total++;
  return {db,access,report:{action,source,target,changes,conflicts,registry:db.branches,allowed:conflicts.length===0}};
}
module.exports={LEGACY_BRANCHES,key,name,discover,planBranchChange};
