import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const store = require('../server/dashboardxStore.js');

function fixture() {
  return {
    version: 23,
    suppliers: [{ id: 17, name: 'Поставщик А', schedules: [{ branch: 'Лободы', delivery: 'Вт' }] }],
    products: [{ id: 5, name: 'Молоко', unit: 'ящ', catalogLinks: ['cat-one'], excludedBranches: ['Сарань'] }],
    supplierCatalog: [{ id: 'cat-one', name: 'Молоко', supplierId: 17, usedProductId: 5, unit: 'кор', price: 5432.123 }],
    offers: [{ id: 'o-1', supplierId: 17, productId: 5, price: 5432.123, unit: 'кор' }],
    history: [{ id: 'order-1', items: [{ productId: 5, delivered: 12 }], stage: 'confirmed' }],
    stocks: [{ id: 'stock-1', productId: 5, branch: 'Лободы', sourceSupplier: 'Поставщик А' }],
    transfers: [],
    dateRequests: [{ id: 'request-1', status: 'approved' }],
    declarations: [{ id: 'doc-1', documentNumber: 'EEAC-22', supplierId: null, attachments: [
      { id: 'f1', storedAs: 'd0799f8c-9b29-4b25-9c1a-a0c9ecc41f15.jpg', sha256: 'abcd' }] }],
    branches: ['Лободы', 'Горняк'],
    settings: { unitPresets: ['ящ', 'кор', 'кг'] },
    customLegacyField: { arbitrary: true },
    dashboardx: {
      schemaVersion: 1,
      media: { radioStations: [{ id: 'radio-1', name: 'Demo', url: 'https://example.com/' }] },
      learning: { english: { schemaVersion: 1, revision: 13, data: { savedWords: [{ term: 'milk' }] } } },
      customDashboardField: { enabled: true }
    }
  };
}

test('canonical global DB preserves Optima records, unknown fields and other DashboardX modules', () => {
  const legacy = fixture();
  const canonical = store.toCanonical(legacy);
  assert.deepEqual(Object.keys(canonical).sort(), ['dashboardx', 'format', 'schemaVersion']);
  assert.equal(canonical.format, 'dashboardx-global-v1');
  assert.equal(canonical.dashboardx.optima.products[0].id, 5);
  assert.equal(canonical.dashboardx.optima.supplierCatalog[0].price, 5432.123);
  assert.equal(canonical.dashboardx.optima.history[0].stage, 'confirmed');
  assert.equal(canonical.dashboardx.optima.declarations[0].attachments[0].id, 'f1');
  assert.equal(canonical.dashboardx.learning.english.data.savedWords[0].term, 'milk');
  assert.equal(canonical.dashboardx.media.radioStations[0].id, 'radio-1');
  assert.equal(canonical.dashboardx.optima.customLegacyField.arbitrary, true);
  assert.ok(store.compareRoundTrip(legacy, canonical));
  assert.deepEqual(store.integritySummary(store.fromCanonical(canonical)).declarations, 1);
  for (const collection of store.NEW_COLLECTIONS) assert.deepEqual(canonical.dashboardx.optima[collection], []);
  assert.equal('suppliers' in canonical, false, 'no root copy');
  assert.equal('products' in canonical, false, 'no root copy');
});
test('legacy view remains writable without changing canonical value of private DashboardX modules', () => {
  const legacy = fixture();
  const canonical = store.toCanonical(legacy);
  const view = store.fromCanonical(canonical);
  view.suppliers[0].name = 'Поставщик Б';
  view.history.push({ id: 'order-2' });
  const result = store.toCanonical(view);
  assert.equal(result.dashboardx.optima.suppliers[0].name, 'Поставщик Б');
  assert.equal(result.dashboardx.optima.history.length, 2);
  assert.equal(result.dashboardx.learning.english.data.savedWords[0].term, 'milk');
  assert.equal(legacy.suppliers[0].name, 'Поставщик А');
});
test('bad canonical schema rejected, never silently falls back to seed', () => {
  assert.throws(() => store.fromCanonical({ dashboardx: {} }), /Invalid DashboardX global database schema/);
  assert.throws(() => store.fromCanonical({ format: store.FORMAT, schemaVersion: 1, dashboardx: { optima: {} } }), /Missing canonical collection/);
});
