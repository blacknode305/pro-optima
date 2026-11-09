"use strict";
const crypto = require("crypto");

// These relations are never inferred from similar product names. They are
// created only after an administrator supplies evidence (invoice, supplier
// confirmation, packaging label or official registry).
const RELATION_TYPES = new Set([
  "supplierProductEvidence", "documentCoverage", "receiptLots", "packageConversions"
]);
const PROOF_SOURCES = new Set([
  "supplier_reply", "invoice", "product_label", "official_registry", "inspection", "other"
]);
const rows = value => Array.isArray(value) ? value : [];
const str = value => String(value ?? "").trim();
const eq = (a,b) => str(a) === str(b);
function requireText(value, field, max = 250) {
  const s = str(value);
  if (!s || s.length > max) throw Error("Требуется поле: " + field);
  return s;
}
function limited(value, max = 1000) {
  const s = str(value);
  if (s.length > max) throw Error("Слишком длинное поле.");
  return s;
}
function reference(db, collection, id, label) {
  if (!rows(db[collection]).some(x => eq(x.id,id))) throw Error("Не найден " + label + ": " + str(id));
  return str(id);
}
function proof(input, requireSource = true) {
  const source = str(input.evidenceSource);
  if (requireSource && !PROOF_SOURCES.has(source)) throw Error("Укажите источник подтверждения.");
  if (source && !PROOF_SOURCES.has(source)) throw Error("Недопустимый источник подтверждения.");
  const evidenceRef = requireSource ? requireText(input.evidenceRef,"номер накладной или ответ поставщика",250)
    : limited(input.evidenceRef,250);
  return { evidenceSource:source || "other",evidenceRef };
}
function cleanRelation(db, entity, input, old) {
  if (!RELATION_TYPES.has(entity)) throw Error("Недоступная категория связей.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Неверная запись.");
  const date = new Date().toISOString();
  const base = { id: old?.id || crypto.randomUUID(),
    createdAt: old?.createdAt || date, updatedAt: date, archivedAt: null,
    note: limited(input.note,800) };
  if (entity === "supplierProductEvidence") {
    const catalogItemId = reference(db,"supplierCatalog",input.catalogItemId,"каталожный товар");
    const supplierId = reference(db,"suppliers",input.supplierId,"поставщик");
    const catalog = rows(db.supplierCatalog).find(x => eq(x.id,catalogItemId));
    if (!eq(catalog.supplierId,supplierId)) throw Error("Товар не принадлежит выбранному поставщику.");
    return { ...base,catalogItemId,supplierId,manufacturer:limited(input.manufacturer,200),
      brand:limited(input.brand,120),sku:limited(input.sku,120),
      ...proof(input,true),verifiedAt:date };
  }
  if (entity === "documentCoverage") {
    const documentId=reference(db,"declarations",input.documentId,"документ");
    const catalogItemId=reference(db,"supplierCatalog",input.catalogItemId,"каталожный товар");
    const reviewStatus=str(input.reviewStatus||"needs_review");
    if (!["needs_review","confirmed"].includes(reviewStatus)) throw Error("Недопустимый статус связи.");
    const evidence = proof(input,reviewStatus==="confirmed");
    return { ...base,documentId,catalogItemId,reviewStatus,...evidence,
      verifiedAt:reviewStatus==="confirmed"?date:null };
  }
  if (entity === "packageConversions") {
    const catalogItemId=reference(db,"supplierCatalog",input.catalogItemId,"каталожный товар");
    const catalog=rows(db.supplierCatalog).find(x=>eq(x.id,catalogItemId));
    const unitsPerPurchase=Number(input.unitsPerPurchase);
    if(!Number.isFinite(unitsPerPurchase)||unitsPerPurchase<=0||unitsPerPurchase>1e9)
      throw Error("Количество внутри упаковки должно быть положительным.");
    const purchaseUnit=requireText(input.purchaseUnit||catalog.unit,"единица закупки",50);
    const baseUnit=requireText(input.baseUnit,"единица сравнения",50);
    return { ...base,catalogItemId,purchaseUnit,baseUnit,unitsPerPurchase,
      ...proof(input,true),verifiedAt:date };
  }
  if (entity === "receiptLots") {
    const catalogItemId=reference(db,"supplierCatalog",input.catalogItemId,"каталожный товар");
    const supplierId=reference(db,"suppliers",input.supplierId,"поставщик");
    const catalog=rows(db.supplierCatalog).find(x=>eq(x.id,catalogItemId));
    if(!eq(catalog.supplierId,supplierId))throw Error("Поступление должно относиться к поставщику товара.");
    const productId=input.productId === undefined || input.productId === null ? null
      : reference(db,"products",input.productId,"наименование");
    const quantity=Number(input.quantity);
    if(!Number.isFinite(quantity)||quantity<0||quantity>1e9)throw Error("Некорректное количество.");
    const branch=requireText(input.branch,"филиал",100);
    const invoiceNumber=requireText(input.invoiceNumber,"номер накладной",180);
    const receivedAt=requireText(input.receivedAt,"дата поступления",35);
    if(!/^\d{4}-\d\d-\d\d$/.test(receivedAt))throw Error("Дата должна иметь формат YYYY-MM-DD.");
    return { ...base,catalogItemId,supplierId,productId,branch,invoiceNumber,receivedAt,
      quantity,unit:requireText(input.unit,"единица поступления",50),
      lotNumber:limited(input.lotNumber,100),expiresAt:limited(input.expiresAt,35),
      verifiedAt:date };
  }
  throw Error("Недоступная категория связей.");
}
function applyRelation(db, entity, action, input, recordId) {
  if (!RELATION_TYPES.has(entity)) throw Error("Неизвестный тип связи.");
  const all=rows(db[entity]);
  if (action === "archive") {
    const index=all.findIndex(x=>eq(x.id,recordId));
    if (index < 0) throw Error("Связь не найдена.");
    if (all[index].archivedAt) return { ...all[index] };
    const updated={ ...all[index],archivedAt:new Date().toISOString(),updatedAt:new Date().toISOString() };
    all[index]=updated;
    db[entity]=all;
    return updated;
  }
  if(action!=="upsert")throw Error("Неизвестное действие.");
  const requested=str(input?.id);
  const index=requested?all.findIndex(x=>eq(x.id,requested)):-1;
  if(requested&&index<0)throw Error("Для обновления нужен существующий ID.");
  const old=index>=0?all[index]:null;
  if(old?.archivedAt)throw Error("Архивную связь нельзя переписать.");
  const value=cleanRelation(db,entity,input,old);
  if(entity==="documentCoverage"||entity==="packageConversions") {
    const duplicate=all.some((row,i)=>i!==index&&!row.archivedAt&&
      (entity==="documentCoverage"
        ? eq(row.documentId,value.documentId)&&eq(row.catalogItemId,value.catalogItemId)
        : eq(row.catalogItemId,value.catalogItemId)));
    if(duplicate)throw Error("Такая активная связь уже существует.");
  }
  if(index>=0)all[index]=value;
  else all.push(value);
  db[entity]=all;
  return value;
}

function priceNumber(value) {
  if(value===null||value===undefined||value==="")return null;
  const num=Number(value);
  return Number.isFinite(num)&&num>=0?num:null;
}
function priceRows(db, collection) {
  const all=rows(db[collection]);
  return new Map(all.map((row,index)=>{
    const key=collection==="supplierCatalog" ? str(row.id)
      : str(row.id) || [row.supplierId,row.productId,row.branch||"*",row.catalogItemId||""].map(str).join("|");
    return [key||"index:"+index,row];
  }));
}
function appendPriceHistory(next,current,revision) {
  const history=rows(next.priceHistory);
  let added=0;
  for(const collection of ["supplierCatalog","offers"]){
    const old=priceRows(current,collection);
    for(const [key,row] of priceRows(next,collection)){
      const previous=old.get(key);
      const from=previous?priceNumber(previous.price):null;
      const to=priceNumber(row.price);
      if(from===to || to===null)continue;
      history.push({
        id:crypto.randomUUID(),sourceType:collection,sourceId:key,
        supplierId:row.supplierId??null,productId:row.usedProductId??row.productId??null,
        catalogItemId:collection==="supplierCatalog"?row.id:(row.catalogItemId||null),
        oldPrice:from,newPrice:to,oldUnit:str(previous?.unit),
        unit:str(row.unit),revision:Number(revision),recordedAt:new Date().toISOString()
      });
      added++;
    }
  }
  if(added)next.priceHistory=history;
  return added;
}
module.exports={ RELATION_TYPES,applyRelation,appendPriceHistory };
