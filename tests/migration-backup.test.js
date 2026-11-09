import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMigrationBackup, LABEL } = require('../server/migrationBackup.js');

test('pre-migration snapshot contains JSON, access and immutable declaration attachments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optima-backup-'));
  try {
    mkdirSync(join(dir, 'declaration-files'));
    writeFileSync(join(dir, 'database.json'), '{"orders":[1,2]}');
    writeFileSync(join(dir, 'meta.json'), '{"revision":123}');
    writeFileSync(join(dir, 'access.json'), '{"branches":{"x":{"pinHash":"test"}}}');
    writeFileSync(join(dir, 'declaration-files', 'scan.png'), 'binary-data');
    const result = createMigrationBackup(dir);
    assert.equal(result.created, true);
    assert.equal(result.count, 4);
    const backup = join(dir, 'backups', LABEL);
    assert.deepEqual(
      JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8')).files.map(x => x.path).sort(),
      ['access.json', 'database.json', 'declaration-files/scan.png', 'meta.json']);
    writeFileSync(join(dir, 'database.json'), '{"orders":[]}');
    assert.equal(readFileSync(join(backup, 'database.json'), 'utf8'), '{"orders":[1,2]}');
    assert.equal(createMigrationBackup(dir).created, false);
    writeFileSync(join(backup, 'meta.json'), '{}');
    assert.throws(() => createMigrationBackup(dir), /checksum mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
