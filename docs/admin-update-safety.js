(function(){
  "use strict";

  const UPDATE_TYPE="pro-optima-supplier-update-v1";
  const TOP_LEVEL=new Set([
    "updateType","baseRevision","generatedAt","sourceDescription","allowOperationalPatches",
    "suppliersUpsert","catalogUpsert","catalogRetireIds","retireNote","catalogLinks","productPatches","offersUpsert"
  ]);
  const OPERATIONAL_PRODUCT_KEYS=new Set(["procurementDefault","procurementByBranch","orderSuppliers","orderSupplierByBranch"]);
  const norm=v=>String(v??"").trim().toLocaleLowerCase("ru-RU");
  const arr=v=>Array.isArray(v)?v:[];
  const obj=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
  const copy=v=>structuredClone(v);

  function fail(message){throw new Error(message)}
  function rows(update,key){
    if(update[key]===undefined)return [];
    if(!Array.isArray(update[key]))fail(`${key} должен быть массивом.`);
    return update[key];
  }
  function keys(row,allowed,label){
    if(!obj(row))fail(`${label} должен быть объектом.`);
    for(const key of Object.keys(row))if(!allowed.has(key))fail(`${label}: неизвестное поле ${key}.`);
  }
  function price(value,label){
    if(value===undefined||value===null||value==="")return null;
    const n=Number(value);if(!Number.isFinite(n)||n<=0)fail(`${label}: цена должна быть положительным числом или null.`);
    return n;
  }
  function uniqueStrings(values){return [...new Set(arr(values).map(String))]}
  function cleanManualMap(raw){
    if(raw===undefined)return undefined;
    if(!obj(raw))fail("manualActiveByBranch должен быть объектом.");
    const out={};for(const [k,v] of Object.entries(raw)){if(typeof v!=="boolean")fail(`manualActiveByBranch.${k} должен быть boolean.`);out[String(k)]=v}
    return out;
  }

  function buildSafeChanges(current,update){
    if(!obj(update)||update.updateType!==UPDATE_TYPE)fail("Это не PRO OPTIMA UPDATE-файл.");
    for(const key of Object.keys(update))if(!TOP_LEVEL.has(key))fail(`Неизвестное поле UPDATE: ${key}.`);
    if(!Number.isInteger(Number(update.baseRevision))||Number(update.baseRevision)<=0)fail("UPDATE должен содержать baseRevision рабочей базы. Значение 0 из шаблона использовать нельзя.");
    if(update.allowOperationalPatches!==undefined&&typeof update.allowOperationalPatches!=="boolean")fail("allowOperationalPatches должен быть true или false.");

    const suppliers=copy(arr(current.suppliers));
    const products=copy(arr(current.products));
    const catalog=copy(arr(current.supplierCatalog));
    let offers=copy(arr(current.offers));
    const summary={suppliers:0,catalogUpsert:0,catalogRetired:0,links:0,offers:0,products:0,removedRetiredOffers:0};

    const productById=new Map(products.map(p=>[Number(p.id),p]));
    const supplierById=new Map(suppliers.map(s=>[String(s.id),s]));
    const supplierNameToId=new Map(suppliers.map(s=>[norm(s.name),String(s.id)]));
    const supplierSeen=new Set();
    const supplierAllowed=new Set(["id","name","contact","phone","note","active"]);
    for(const [i,incoming] of rows(update,"suppliersUpsert").entries()){
      keys(incoming,supplierAllowed,`suppliersUpsert[${i}]`);
      const id=String(incoming.id||"").trim(),name=String(incoming.name||"").trim();
      if(!id||!name)fail(`suppliersUpsert[${i}]: обязательны id и name.`);
      if(supplierSeen.has(id))fail(`suppliersUpsert: повторяется id ${id}.`);supplierSeen.add(id);
      const nameOwner=supplierNameToId.get(norm(name));if(nameOwner&&nameOwner!==id)fail(`Поставщик «${name}» уже существует с другим id.`);
      if(incoming.active!==undefined&&typeof incoming.active!=="boolean")fail(`suppliersUpsert[${i}].active должен быть boolean.`);
      let row=supplierById.get(id);
      if(!row){row={id,name,contact:"",phone:"",note:"",active:true,schedules:[]};suppliers.push(row);supplierById.set(id,row)}
      for(const key of ["name","contact","phone","note","active"])if(incoming[key]!==undefined)row[key]=incoming[key];
      supplierNameToId.set(norm(name),id);summary.suppliers++;
    }

    const catalogById=new Map(catalog.map(x=>[String(x.id),x]));
    const catalogSeen=new Set();
    const catalogAllowed=new Set(["id","supplierId","name","unit","price","branch","boxQty","packQty","usedProductId","placeholder","availability","availabilityNote","source","sourceProductId","note","clearUsedProductId"]);
    for(const [i,incoming] of rows(update,"catalogUpsert").entries()){
      keys(incoming,catalogAllowed,`catalogUpsert[${i}]`);
      const id=String(incoming.id||"").trim(),supplierId=String(incoming.supplierId||"").trim(),name=String(incoming.name||"").trim();
      if(!id||!supplierId||!name)fail(`catalogUpsert[${i}]: обязательны id, supplierId и name.`);
      if(catalogSeen.has(id))fail(`catalogUpsert: повторяется id ${id}.`);catalogSeen.add(id);
      if(!supplierById.has(supplierId))fail(`catalogUpsert[${i}]: неизвестный supplierId ${supplierId}.`);
      if(incoming.availability!==undefined&&!['available','unavailable','unknown'].includes(String(incoming.availability)))fail(`catalogUpsert[${i}].availability имеет неизвестное значение.`);
      if(incoming.placeholder!==undefined&&typeof incoming.placeholder!=="boolean")fail(`catalogUpsert[${i}].placeholder должен быть boolean.`);
      if(incoming.usedProductId!==undefined&&incoming.usedProductId!==null&&!productById.has(Number(incoming.usedProductId)))fail(`catalogUpsert[${i}]: неизвестный usedProductId ${incoming.usedProductId}.`);
      const normalizedPrice=price(incoming.price,`catalogUpsert[${i}].price`);
      let row=catalogById.get(id);
      if(row&&String(row.supplierId)!==supplierId)fail(`Нельзя переносить стабильный catalog id ${id} к другому поставщику.`);
      if(row){
        const keepUsed=row.usedProductId;
        Object.assign(row,copy(incoming));
        if(incoming.price!==undefined)row.price=normalizedPrice;
        if((incoming.usedProductId===undefined||incoming.usedProductId===null)&&keepUsed&&!incoming.clearUsedProductId)row.usedProductId=keepUsed;
        delete row.clearUsedProductId;
      }else{
        row={id,supplierId,name,unit:String(incoming.unit||""),price:incoming.price===undefined?null:normalizedPrice,branch:String(incoming.branch||"*"),boxQty:incoming.boxQty??null,packQty:incoming.packQty??null,usedProductId:incoming.usedProductId??null,placeholder:!!incoming.placeholder,availability:incoming.availability||"unknown",availabilityNote:String(incoming.availabilityNote||""),source:String(incoming.source||"Update"),sourceProductId:incoming.sourceProductId??null,note:String(incoming.note||"")};
        catalog.push(row);catalogById.set(id,row);
      }
      for(const offer of offers.filter(o=>String(o.catalogItemId||"")===id)){
        offer.supplierId=row.supplierId;offer.unit=row.unit||offer.unit||"";offer.price=row.price??null;if(!offer.branch)offer.branch=row.branch||"*";summary.offers++;
      }
      summary.catalogUpsert++;
    }

    const retireSeen=new Set();
    for(const [i,rawId] of rows(update,"catalogRetireIds").entries()){
      const id=String(rawId||"").trim();if(!id)fail(`catalogRetireIds[${i}] пустой.`);
      if(retireSeen.has(id))fail(`catalogRetireIds: повторяется id ${id}.`);retireSeen.add(id);
      if(catalogSeen.has(id))fail(`catalog id ${id} одновременно обновляется и помечается недоступным.`);
      const row=catalogById.get(id);if(!row)fail(`catalogRetireIds[${i}]: неизвестный catalog id ${id}.`);
      row.availability="unavailable";row.availabilityNote=String(update.retireNote||"Нет в новом прайс-листе");summary.catalogRetired++;
    }
    if(retireSeen.size){
      const before=offers.length;offers=offers.filter(o=>!retireSeen.has(String(o.catalogItemId||"")));summary.removedRetiredOffers=before-offers.length;
    }

    let operationalPatches=0;
    const productAllowed=new Set(["productId","catalogLinks","addCatalogLinks","removeCatalogLinks","procurementDefault","procurementByBranch","orderSuppliers","orderSupplierByBranch","analogProductIds"]);
    for(const [i,patch] of rows(update,"productPatches").entries()){
      keys(patch,productAllowed,`productPatches[${i}]`);
      const p=productById.get(Number(patch.productId));if(!p)fail(`productPatches[${i}]: неизвестный productId ${patch.productId}.`);
      for(const key of ["catalogLinks","addCatalogLinks","removeCatalogLinks"]){
        if(patch[key]!==undefined){if(!Array.isArray(patch[key]))fail(`productPatches[${i}].${key} должен быть массивом.`);for(const id of patch[key])if(!catalogById.has(String(id)))fail(`productPatches[${i}].${key}: неизвестный catalog id ${id}.`)}
      }
      if(Array.isArray(patch.catalogLinks)){p.catalogLinks=uniqueStrings(patch.catalogLinks);summary.links++}
      if(Array.isArray(patch.addCatalogLinks)){p.catalogLinks=uniqueStrings([...arr(p.catalogLinks),...patch.addCatalogLinks]);summary.links++}
      if(Array.isArray(patch.removeCatalogLinks)){const remove=new Set(patch.removeCatalogLinks.map(String));p.catalogLinks=arr(p.catalogLinks).map(String).filter(x=>!remove.has(x));summary.links++}
      if(patch.analogProductIds!==undefined){
        if(!Array.isArray(patch.analogProductIds))fail(`productPatches[${i}].analogProductIds должен быть массивом.`);
        for(const id of patch.analogProductIds)if(!productById.has(Number(id)))fail(`productPatches[${i}].analogProductIds: неизвестный productId ${id}.`);
        p.analogProductIds=copy(patch.analogProductIds);
      }
      if(patch.orderSuppliers!==undefined){
        if(!Array.isArray(patch.orderSuppliers))fail(`productPatches[${i}].orderSuppliers должен быть массивом.`);
        for(const link of patch.orderSuppliers){if(!obj(link))fail(`productPatches[${i}].orderSuppliers содержит некорректную строку.`);if(link.supplierId&&!supplierById.has(String(link.supplierId)))fail(`productPatches[${i}].orderSuppliers: неизвестный supplierId ${link.supplierId}.`)}
        p.orderSuppliers=copy(patch.orderSuppliers);operationalPatches++;
      }
      for(const key of ["procurementDefault","procurementByBranch","orderSupplierByBranch"]){
        if(patch[key]!==undefined){if(!obj(patch[key]))fail(`productPatches[${i}].${key} должен быть объектом.`);p[key]=copy(patch[key]);operationalPatches++}
      }
      summary.products++;
    }
    if(operationalPatches&&update.allowOperationalPatches!==true)fail("UPDATE содержит изменения настроек закупки. Для них требуется allowOperationalPatches=true.");

    const catalogLinkAllowed=new Set(["catalogItemId","productId"]),linkedCatalog=new Set();
    for(const [i,link] of rows(update,"catalogLinks").entries()){
      keys(link,catalogLinkAllowed,`catalogLinks[${i}]`);
      const cid=String(link.catalogItemId||"").trim(),p=productById.get(Number(link.productId)),row=catalogById.get(cid);
      if(!row)fail(`catalogLinks[${i}]: неизвестный catalogItemId ${cid}.`);if(!p)fail(`catalogLinks[${i}]: неизвестный productId ${link.productId}.`);
      if(linkedCatalog.has(cid))fail(`catalogLinks: catalogItemId ${cid} указан более одного раза.`);linkedCatalog.add(cid);
      for(const other of products)if(Number(other.id)!==Number(p.id)&&Array.isArray(other.catalogLinks))other.catalogLinks=other.catalogLinks.filter(x=>String(x)!==cid);
      row.usedProductId=Number(p.id);p.catalogLinks=uniqueStrings([...arr(p.catalogLinks),cid]);
      let offer=offers.find(o=>String(o.catalogItemId||"")===cid);
      if(row.availability==="unavailable")offers=offers.filter(o=>String(o.catalogItemId||"")!==cid);
      else if(!offer){const supplier=supplierById.get(String(row.supplierId));offers.push({supplierId:row.supplierId,productId:p.id,supplier:supplier?.name||"",product:p.name,branch:row.branch||"*",unit:row.unit||p.unit||"",price:row.price??null,manualActive:null,manualActiveByBranch:{},catalogItemId:row.id});summary.offers++}
      else{offer.productId=p.id;offer.product=p.name;offer.supplierId=row.supplierId;offer.unit=row.unit||offer.unit||p.unit||"";offer.price=row.price??null;summary.offers++}
      summary.links++;
    }

    for(const row of catalog){
      if(row.usedProductId){const p=productById.get(Number(row.usedProductId));if(p)p.catalogLinks=uniqueStrings([...arr(p.catalogLinks),String(row.id)])}
    }

    const offerAllowed=new Set(["supplierId","productId","supplier","product","branch","unit","price","manualActive","manualActiveByBranch","catalogItemId"]),offerSeen=new Set();
    for(const [i,incoming] of rows(update,"offersUpsert").entries()){
      keys(incoming,offerAllowed,`offersUpsert[${i}]`);
      const sid=String(incoming.supplierId||"").trim(),pid=Number(incoming.productId),branch=String(incoming.branch||"*"),cid=String(incoming.catalogItemId||"").trim();
      if(!supplierById.has(sid))fail(`offersUpsert[${i}]: неизвестный supplierId ${sid}.`);if(!productById.has(pid))fail(`offersUpsert[${i}]: неизвестный productId ${incoming.productId}.`);
      const normalizedPrice=price(incoming.price,`offersUpsert[${i}].price`);
      if(incoming.manualActive!==undefined&&incoming.manualActive!==null&&typeof incoming.manualActive!=="boolean")fail(`offersUpsert[${i}].manualActive должен быть boolean или null.`);
      const manualMap=cleanManualMap(incoming.manualActiveByBranch);
      if(cid){const cat=catalogById.get(cid);if(!cat)fail(`offersUpsert[${i}]: неизвестный catalogItemId ${cid}.`);if(String(cat.supplierId)!==sid)fail(`offersUpsert[${i}]: catalogItemId ${cid} принадлежит другому поставщику.`);if(cat.availability==="unavailable")fail(`offersUpsert[${i}]: нельзя активировать недоступный catalogItemId ${cid}.`)}
      const k=[sid,pid,branch,cid].join("|");if(offerSeen.has(k))fail(`offersUpsert: повторяется предложение ${k}.`);offerSeen.add(k);
      let offer=offers.find(x=>String(x.supplierId)===sid&&Number(x.productId)===pid&&String(x.branch||"*")===branch&&String(x.catalogItemId||"")===cid);
      if(!offer){offer={};offers.push(offer)}
      Object.assign(offer,copy(incoming));offer.supplierId=sid;offer.productId=pid;offer.branch=branch;if(incoming.price!==undefined)offer.price=normalizedPrice;if(manualMap!==undefined)offer.manualActiveByBranch=manualMap;summary.offers++;
    }

    const unavailableIds=new Set(catalog.filter(x=>x.availability==="unavailable").map(x=>String(x.id)));
    const beforeFinal=offers.length;offers=offers.filter(o=>!o.catalogItemId||!unavailableIds.has(String(o.catalogItemId)));summary.removedRetiredOffers+=beforeFinal-offers.length;

    return {changes:{suppliers,products,supplierCatalog:catalog,offers},summary,operationalPatches};
  }

  window.applySupplierUpdateFile=async function(event){
    const file=event.target.files?.[0];event.target.value="";if(!file)return;
    if(typeof adminToken==="function"&&!adminToken()){setAdminTokenPrompt();if(!adminToken())return}
    try{
      const raw=JSON.parse(await file.text());
      const fresh=await remoteFetch("/api/admin/db");
      if(Number(raw.baseRevision)!==Number(fresh.revision))fail(`UPDATE подготовлен для revision ${raw.baseRevision}, а на Railway сейчас revision ${fresh.revision}. Нужен новый UPDATE по свежей базе.`);
      const preview=buildSafeChanges(fresh.data||{},raw),s=preview.summary;
      const suppliers=rows(raw,"suppliersUpsert").map(x=>x.name).filter(Boolean).join(", ");
      const lines=[
        `Проверка UPDATE пройдена${suppliers?" для "+suppliers:""}.`,
        `Revision: ${fresh.revision}.`,
        `Каталог: ${s.catalogUpsert} обновлено/добавлено, ${s.catalogRetired} помечено недоступными.`,
        `Связи: ${s.links}; предложения/цены: ${s.offers}.`,
        s.removedRetiredOffers?`Удалено устаревших рабочих предложений: ${s.removedRetiredOffers}.`:"",
        preview.operationalPatches?`ВНИМАНИЕ: есть ${preview.operationalPatches} изменений настроек закупки.`:"Настройки закупки не меняются.",
        "История, остатки, перемещения, запросы дат и общие настройки не входят в запись.",
        "Railway перед PATCH автоматически создаёт резервную копию.",
        "",
        "Применить UPDATE?"
      ].filter(Boolean);
      if(!confirm(lines.join("\n")))return;
      const out=await remoteFetch("/api/admin/db",{method:"PATCH",body:JSON.stringify({baseRevision:fresh.revision,changes:preview.changes})});
      show("settingsMsg",`UPDATE применён безопасно. Revision ${out.revision}. Каталог ${s.catalogUpsert}, недоступные ${s.catalogRetired}, связи ${s.links}, цены ${s.offers}.`,"ok");
      await reloadRemote();
    }catch(e){
      const suffix=e.status===409?" База успела измениться; сформируйте UPDATE заново по свежей revision.":"";
      show("settingsMsg","Ошибка UPDATE: "+(e.message||e)+suffix,"err");
    }
  };
})();
