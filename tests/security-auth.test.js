import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = fileURLToPath(new URL('../server/start.js', import.meta.url));
const listenPort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const port = socket.address().port;
    socket.close(() => resolve(port));
  });
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('shared database is private and branch PIN writes require admin token plus write password', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pro-optima-test-'));
  const port = await listenPort();
  const base = 'http://127.0.0.1:' + port;
  writeFileSync(join(dir, 'database.json'), JSON.stringify({
    version: 23, suppliers: [], products: [], branches: ['Горняк'],
    supplierCatalog: [], offers: [], history: [], stocks: [], declarations: [], settings: {}
  }));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ revision: 1, updatedAt: new Date().toISOString() }));
  const adminToken = 'test-admin-token-secret';
  const password = 'test-admin-write-password';
  const child = spawn(process.execPath, [root], {
    env: { ...process.env, SOPTIMA_DATA_DIR: dir, SOPTIMA_ADMIN_TOKEN: adminToken,
      SOPTIMA_WRITE_PASSWORD: password, SOPTIMA_WRITE_PASSWORD_HASH: '',
      PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore'
  });
  const req = (url, opts = {}) => fetch(base + url, opts);
  const headers = { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' };
  const authorized = { ...headers, 'X-Optima-Write-Password': password };
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode != null) throw new Error('Server exited during test');
      try { if ((await req('/api/health')).ok) { ready = true; break; } } catch {}
      await sleep(75);
    }
    assert.equal(ready, true, 'server is ready');
    const canonical = JSON.parse(readFileSync(join(dir, 'dashboardx.json'), 'utf8'));
    assert.equal(canonical.format, 'dashboardx-global-v1');
    assert.deepEqual(Object.keys(canonical).sort(), ['dashboardx', 'format', 'schemaVersion']);
    assert.deepEqual(canonical.dashboardx.optima.suppliers, []);
    assert.ok(canonical.dashboardx.optima.priceHistory);
    assert.equal(readFileSync(join(dir, 'database.json'), 'utf8').includes('"dashboardx"'), false,
      'original legacy database is unchanged during migration');
    assert.equal((await req('/api/db')).status, 401, 'no public DB read');
    assert.equal((await req('/api/db', { headers })).status, 403, 'token alone cannot read');
    assert.equal((await req('/api/db', { headers: authorized })).status, 200, 'both factors grant read');
    assert.equal((await req('/api/dashboardx/optima/v1/overview')).status, 401, 'Optima namespace is private');
    assert.equal((await req('/api/dashboardx/optima/v1/overview', { headers })).status, 403);
    const overview = await (await req('/api/dashboardx/optima/v1/overview', { headers: authorized })).json();
    assert.equal(overview.schemaVersion, 1);
    assert.equal(overview.isPhysicalMigrationComplete, true);
    assert.equal(overview.source, 'dashboardx.optima');
    const globalState = await (await req('/api/dashboardx/optima/v1/state', { headers: authorized })).json();
    assert.equal(globalState.source, 'dashboardx.optima');
    assert.ok(globalState.data.priceHistory);
    assert.equal('learning' in globalState.data, false);
    assert.equal((await req('/api/dashboardx/optima/v1/products', { headers: authorized })).status, 200);
    assert.equal((await req('/api/dashboardx/optima/v1/passport?productId=not-found', { headers: authorized })).status, 404);
    assert.equal((await req('/api/admin/access')).status, 401);
    const access = await (await req('/api/admin/access', { headers: authorized })).json();
    assert.equal(access.passwordRequiredForPins, true);
    const put = additional => req('/api/admin/access', {
      method: 'PUT', headers: { ...headers, ...additional },
      body: JSON.stringify({ branch: 'Горняк', pin: '9142' })
    });
    assert.equal((await put({})).status, 403, 'cannot edit PIN with token only');
    assert.equal((await put({ 'X-Optima-Write-Password': 'incorrect' })).status, 403);
    assert.equal((await put({ 'X-Optima-Write-Password': password })).status, 200);
    const after = await (await req('/api/admin/access', { headers: authorized })).json();
    assert.equal(after.branches[0].configured, true);
    assert.equal(JSON.stringify(after).includes('9142'), false, 'never expose PIN value');
    const base = await (await req('/api/admin/db', { headers: authorized })).json();
    const mutation = added => req('/api/admin/db', {
      method: 'PATCH', headers: { ...headers, ...added },
      body: JSON.stringify({ baseRevision: base.revision, changes: { settings: { testWriteGuard: true } } })
    });
    assert.equal((await mutation({})).status, 403, 'admin token alone cannot update the DB');
    assert.equal((await mutation({ 'X-Optima-Write-Password': 'bad' })).status, 403);
    assert.equal((await mutation({ 'X-Optima-Write-Password': password })).status, 200);
    const stateBefore = await (await req('/api/dashboardx/optima/v1/state', { headers: authorized })).json();
    const statePatch = additional => req('/api/dashboardx/optima/v1/state', {
      method:'PATCH', headers: { ...headers, ...additional },
      body: JSON.stringify({ baseRevision: stateBefore.revision, changes: {
        products: [{ id: 55, name: 'Молоко', unit: 'ящ' }]
      } })
    });
    assert.equal((await statePatch({})).status, 403);
    assert.equal((await statePatch({ 'X-Optima-Write-Password': password })).status, 200);
    const stored = JSON.parse(readFileSync(join(dir, 'dashboardx.json'), 'utf8'));
    assert.equal(stored.dashboardx.optima.products[0].id, 55);
    assert.equal(stored.dashboardx.optima.settings.testWriteGuard, true);
    assert.equal('products' in stored, false);
    assert.ok(readFileSync(join(dir, 'database.json'), 'utf8').includes('"products":[]'));
    assert.equal((await req('/api/admin/db', { headers: authorized })).status, 200);
    assert.equal((await req('/api/admin/dispatcher-access', {
      method: 'PUT', headers: authorized, body: JSON.stringify({ pin: '5824' })
    })).status, 410, 'dispatcher UI and its PIN management are disabled');
    assert.equal((await req('/api/dispatcher/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '5824' })
    })).status, 410);
    const operator = await (await req('/api/operator/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'Горняк', pin: '9142' })
    })).json();
    assert.ok(operator.token, 'production login remains operational');
    assert.equal((await req('/api/operator/bootstrap', {
      headers: { Authorization: 'Bearer ' + operator.token }
    })).status, 200);
  } finally {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
});
