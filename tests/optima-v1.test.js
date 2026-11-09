import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { overview, productIndex, passport } = require('../server/optimaV1.js');

const db = {
  products:[{id:3,name:'Мука',unit:'кг',catalogLinks:['s1'],orderSuppliers:[{supplierId:2}]}],
  suppliers:[{id:2,name:'Поставщик',schedules:[{branch:'Лободы',order:'Пн',delivery:'Вт'}]}],
  supplierCatalog:[{id:'s1',supplierId:2,name:'Мука мешок 25 кг',price:9800,unit:'мешок',usedProductId:3}],
  offers:[{productId:3,supplierId:2,price:9800,unit:'мешок'}],
  declarations:[{id:'d1',supplierId:2,documentNumber:'123',productType:'Мука'}],
  stocks:[{id:'st1',productId:3,branch:'Лободы',value:7,unit:'кг'}],
  history:[{id:'o1',items:[{productId:3,product:'Мука'}],stage:'sent'}]
};
test('versioned optima overview derives from a single legacy source', () => {
 const summary=overview(db,{revision:14,updatedAt:'2026-11-09'});
 assert.equal(summary.counts.nomenclature,1);
 assert.equal(summary.counts.documents,1);
 assert.equal(summary.isPhysicalMigrationComplete,true);
 assert.equal(summary.source,'dashboardx.optima');
 assert.equal(productIndex(db,'му',10).products[0].id,3);
 assert.equal(productIndex(db,'вода').total,0);
});
test('passport joins only stable IDs and explicitly leaves documentation unverified', () => {
 const p=passport(db,3);
 assert.equal(p.catalog.length,1);
 assert.equal(p.offers.length,1);
 assert.equal(p.orders.length,1);
 assert.equal(p.stockEvents.length,1);
 assert.equal(p.supplierDocuments[0].productCoverage,'unverified');
 assert.equal(p.supplierDocuments[0].matchBasis,'supplier-only');
 assert.equal(p.priceHistoryComplete,false);
 assert.equal(passport(db, 999), null);
 assert.equal(p.catalog[0].unit,'мешок');
 assert.equal(p.product.unit,'кг');
});
