"use strict";

// Versioned, read-only adapter for DashboardX / Optima.
// Legacy PRO OPTIMA remains the single source of truth until migration cutover.
// No database duplication, writes, or speculative document/price links.
const list = x => Array.isArray(x) ? x : [];
const asId = x => String(x ?? "");
const name = x => String(x ?? "").trim();
const branchKey = x => name(x).toLocaleLowerCase("ru-RU");
const overview = (db, meta) => ({
  ok: true, schemaVersion: 1, source: "dashboardx.optima",
  revision: Number(meta?.revision || 0), updatedAt: meta?.updatedAt || null,
  counts: {
    nomenclature: list(db.products).length,
    supplierProducts: list(db.supplierCatalog).length,
    suppliers: list(db.suppliers).length,
    offers: list(db.offers).length,
    orders: list(db.history).length,
    stockEvents: list(db.stocks).length,
    documents: list(db.declarations).length
  },
  isPhysicalMigrationComplete: true
});
function productIndex(db, search = "", limit = 300) {
  const q = branchKey(search);
  const max = Math.min(1000, Math.max(1, Number(limit) || 300));
  const products = list(db.products)
    .filter(p => !q || branchKey(p.name).includes(q) || asId(p.id).includes(q))
    .map(p => ({ id: p.id, name: p.name, unit: p.unit || "",
      excludedBranches: list(p.excludedBranches) }))
    .sort((a,b) => name(a.name).localeCompare(name(b.name), "ru-RU"));
  return { products: products.slice(0,max), total: products.length };
}
function passport(db, productId) {
  const product = list(db.products).find(x => asId(x.id) === asId(productId));
  if (!product) return null;
  const linkedIds = new Set(list(product.catalogLinks).map(asId));
  const baseCatalog = list(db.supplierCatalog).filter(x =>
    (x.usedProductId !== undefined && asId(x.usedProductId) === asId(product.id)) ||
    linkedIds.has(asId(x.id)));
  for(const x of baseCatalog)linkedIds.add(asId(x.id));
  const conversions = list(db.packageConversions)
    .filter(x => !x.archivedAt && x.verifiedAt && linkedIds.has(asId(x.catalogItemId)));
  const byConversion = new Map(conversions.map(x => [asId(x.catalogItemId),x]));
  const catalog = baseCatalog.map(x => {
    const conversion=byConversion.get(asId(x.id));
    const price=x.price===null||x.price===undefined||x.price===""?null:Number(x.price);
    const basePrice=conversion&&Number.isFinite(price)&&conversion.unitsPerPurchase>0
      ? Number((price/conversion.unitsPerPurchase).toFixed(3)):null;
    return {...x,comparableUnitPrice:basePrice,comparableBaseUnit:conversion?.baseUnit||null};
  });
  const offers = list(db.offers).filter(x => asId(x.productId) === asId(product.id));
  const supplierIds = new Set([
    ...catalog.map(x => asId(x.supplierId)),
    ...offers.map(x => asId(x.supplierId)),
    ...list(product.orderSuppliers).map(x => asId(x.supplierId))
  ].filter(Boolean));
  const suppliers = list(db.suppliers).filter(x => supplierIds.has(asId(x.id)));
  const stockEvents = list(db.stocks).filter(x => asId(x.productId) === asId(product.id));
  const orders = list(db.history).filter(x => list(x.items)
    .some(line => line.productId !== null && line.productId !== undefined &&
      asId(line.productId) === asId(product.id)));
  const supplierDocuments = list(db.declarations)
    .filter(x => supplierIds.has(asId(x.supplierId)))
    .map(x => ({ ...x, productCoverage: "unverified", matchBasis: "supplier-only" }));
  const docsById = new Map(list(db.declarations).map(x=>[asId(x.id),x]));
  const confirmedDocuments = list(db.documentCoverage)
    .filter(x => !x.archivedAt && x.reviewStatus==="confirmed" &&
      linkedIds.has(asId(x.catalogItemId)) && docsById.has(asId(x.documentId)))
    .map(x=>({ ...x, document:docsById.get(asId(x.documentId)),
      matchBasis:"human-verified-evidence", productCoverage:"confirmed" }));
  const pendingDocumentLinks = list(db.documentCoverage)
    .filter(x => !x.archivedAt && x.reviewStatus!=="confirmed" && linkedIds.has(asId(x.catalogItemId)));
  const supplierProductEvidence = list(db.supplierProductEvidence)
    .filter(x => !x.archivedAt && linkedIds.has(asId(x.catalogItemId)));
  const receiptLots = list(db.receiptLots).filter(x=>!x.archivedAt &&
    (asId(x.productId)===asId(product.id)||linkedIds.has(asId(x.catalogItemId))));
  const priceHistory = list(db.priceHistory).filter(x =>
    asId(x.productId)===asId(product.id)||linkedIds.has(asId(x.catalogItemId)));
  return {
    schemaVersion:1, product, suppliers, catalog, offers, conversions,
    stockEvents, orders, supplierDocuments, confirmedDocuments,
    pendingDocumentLinks, supplierProductEvidence, receiptLots,
    priceHistory, priceHistoryComplete:false,
    warnings: {
      documents: "Only human-verified documentCoverage establishes a document-to-catalog link; legal sufficiency must still be checked.",
      prices: "Price-per-base-unit is only computed using recorded verified packaging conversions.",
      stocks: "Legacy stock records may not include supplier or invoice provenance."
    }
  };
}
module.exports = { overview, productIndex, passport };
