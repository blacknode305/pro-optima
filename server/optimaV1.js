"use strict";

// Versioned, read-only adapter for DashboardX / Optima.
// Legacy PRO OPTIMA remains the single source of truth until migration cutover.
// No database duplication, writes, or speculative document/price links.
const list = x => Array.isArray(x) ? x : [];
const asId = x => String(x ?? "");
const name = x => String(x ?? "").trim();
const branchKey = x => name(x).toLocaleLowerCase("ru-RU");
const overview = (db, meta) => ({
  ok: true, schemaVersion: 1, source: "pro-optima-legacy-adapter",
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
  isPhysicalMigrationComplete: false
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
  const catalogIds = new Set(list(product.catalogLinks).map(asId));
  const catalog = list(db.supplierCatalog).filter(x =>
    (x.usedProductId !== undefined && asId(x.usedProductId) === asId(product.id)) ||
    catalogIds.has(asId(x.id)));
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
  return {
    schemaVersion:1, product, suppliers, catalog, offers,
    stockEvents, orders, supplierDocuments,
    priceHistory: [], priceHistoryComplete: false,
    warnings: {
      documents: "Document coverage of a specific product is not verified by supplierId alone.",
      prices: "Supplier price units may differ: package conversion is not inferred.",
      stocks: "Legacy stock records may not include supplier or invoice provenance."
    }
  };
}
module.exports = { overview, productIndex, passport };
