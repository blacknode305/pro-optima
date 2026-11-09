import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { applyRelation, appendPriceHistory } = require('../server/optimaRelationships.js');
const { passport } = require('../server/optimaV1.js');
function data() { return {
 products:[{id:1,name:'Молоко',unit:'шт',catalogLinks:[]}],
 suppliers:[{id:'s1',name:'Поставщик А'},{id:'s2',name:'Поставщик Б'}],
 supplierCatalog:[{id:'c1',usedProductId:1,supplierId:'s1',name:'Молоко коробка',unit:'кор',price:6000},
                  {id:'c2',usedProductId:1,supplierId:'s2',name:'Молоко коробка',unit:'кор',price:5400}],
 offers:[],history:[],stocks:[],declarations:[{id:'d1',documentNumber:'EAEU-001',supplierId:null}],
 documentCoverage:[],supplierProductEvidence:[],receiptLots:[],packageConversions:[],priceHistory:[] } }
test('supplier merchandise link needs documentary evidence before confirmation', () => {
 const db=data();
 assert.throws(()=>applyRelation(db,'documentCoverage','upsert',{
  documentId:'d1',catalogItemId:'c1',reviewStatus:'confirmed'
 }),/источник подтверждения|источник|Требуется поле/);
 const pending=applyRelation(db,'documentCoverage','upsert',{
  documentId:'d1',catalogItemId:'c1',reviewStatus:'needs_review'
 });
 assert.equal(pending.reviewStatus,'needs_review');
 assert.equal(passport(db,1).confirmedDocuments.length,0);
 const confirmed=applyRelation(db,'documentCoverage','upsert',{
  ...pending,reviewStatus:'confirmed',evidenceSource:'invoice',evidenceRef:'N-123'
 });
 assert.equal(confirmed.verifiedAt!==null,true);
 assert.equal(passport(db,1).confirmedDocuments[0].document.documentNumber,'EAEU-001');
 assert.equal(passport(db,1).supplierDocuments.length,0);
 assert.throws(()=>applyRelation(db,'documentCoverage','upsert',{
  documentId:'d1',catalogItemId:'c1',reviewStatus:'confirmed',
  evidenceSource:'invoice',evidenceRef:'N-123'
 }),/уже существует/);
 applyRelation(db,'documentCoverage','archive',null,confirmed.id);
 assert.equal(passport(db,1).confirmedDocuments.length,0);
});
test('different box sizes are compared only with verified conversion', () => {
 const db=data();
 assert.equal(passport(db,1).catalog[0].comparableUnitPrice,null);
 applyRelation(db,'packageConversions','upsert',{
  catalogItemId:'c1',purchaseUnit:'кор',baseUnit:'шт',unitsPerPurchase:12,
  evidenceSource:'product_label',evidenceRef:'pack-001'
 });
 applyRelation(db,'packageConversions','upsert',{
  catalogItemId:'c2',purchaseUnit:'кор',baseUnit:'шт',unitsPerPurchase:10,
  evidenceSource:'invoice',evidenceRef:'inv-002'
 });
 const products=passport(db,1).catalog;
 assert.equal(products[0].comparableUnitPrice,500);
 assert.equal(products[1].comparableUnitPrice,540);
 assert.equal(products[0].comparableBaseUnit,'шт');
 assert.throws(()=>applyRelation(db,'packageConversions','upsert',{
  catalogItemId:'c1',purchaseUnit:'кор',baseUnit:'шт',unitsPerPurchase:0,
  evidenceSource:'invoice',evidenceRef:'invoice-4'
 }),/положительным/);
});
test('receipts reject wrong supplier and require a real invoice', () => {
 const db=data();
 assert.throws(()=>applyRelation(db,'receiptLots','upsert',{
  catalogItemId:'c1',supplierId:'s2',branch:'Лободы',invoiceNumber:'R-5',
  receivedAt:'2026-11-09',unit:'кор',quantity:2
 }),/поставщику товара/);
 assert.throws(()=>applyRelation(db,'receiptLots','upsert',{
  catalogItemId:'c1',supplierId:'s1',branch:'Лободы',
  receivedAt:'2026-11-09',unit:'кор',quantity:2
 }),/номер накладной/);
 const rec=applyRelation(db,'receiptLots','upsert',{
  catalogItemId:'c1',supplierId:'s1',productId:1,branch:'Лободы',
  invoiceNumber:'R-6',receivedAt:'2026-11-09',unit:'кор',quantity:2
 });
 assert.equal(passport(db,1).receiptLots[0].invoiceNumber,'R-6');
 assert.ok(rec.id);
});
test('price history is append-only when values change and does not erase prior entries', () => {
 const before=data(),after=structuredClone(before);
 const older={id:'historic',newPrice:7000};
 after.priceHistory.push(older);
 after.supplierCatalog[0].price=6100;
 assert.equal(appendPriceHistory(after,before,35),1);
 assert.equal(after.priceHistory.length,2);
 assert.deepEqual(after.priceHistory[0],older);
 assert.equal(after.priceHistory[1].oldPrice,6000);
 assert.equal(after.priceHistory[1].newPrice,6100);
 assert.equal(after.priceHistory[1].revision,35);
 assert.equal(appendPriceHistory(after,after,36),0);
});
