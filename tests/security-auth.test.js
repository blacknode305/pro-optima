import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = fileURLToPath(new URL('../server/server.js', import.meta.url));
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
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode != null) throw new Error('Server exited during test');
      try { if ((await req('/api/health')).ok) { ready = true; break; } } catch {}
      await sleep(75);
    }
    assert.equal(ready, true, 'server is ready');
    assert.equal((await req('/api/db')).status, 401, 'no public DB read');
    assert.equal((await req('/api/db', { headers })).status, 200, 'admin token grants read');
    assert.equal((await req('/api/admin/access')).status, 401);
    const access = await (await req('/api/admin/access', { headers })).json();
    assert.equal(access.passwordRequiredForPins, true);
    const put = additional => req('/api/admin/access', {
      method: 'PUT', headers: { ...headers, ...additional },
      body: JSON.stringify({ branch: 'Горняк', pin: '9142' })
    });
    assert.equal((await put({})).status, 403, 'cannot edit PIN with token only');
    assert.equal((await put({ 'X-Optima-Write-Password': 'incorrect' })).status, 403);
    assert.equal((await put({ 'X-Optima-Write-Password': password })).status, 200);
    const after = await (await req('/api/admin/access', { headers })).json();
    assert.equal(after.branches[0].configured, true);
    assert.equal(JSON.stringify(after).includes('9142'), false, 'never expose PIN value');
  } finally {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
});
