"use strict";

// One-time, integrity-checked snapshot of the production Railway volume before
// any future schema migration. Stores a separate copy of mutable JSON records;
// document attachments are immutable (written with wx) and use hard links to
// avoid duplicating the volume's potentially large binary archive.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const LABEL = "optima-before-unification-20261109-v1";
const DB_FILES = ["database.json", "meta.json", "access.json"];

function checksum(file) {
  const digest = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(256 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      digest.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return digest.digest("hex");
}
function walk(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isSymbolicLink()) throw new Error("Backup refused: symlink in attachments");
    const rel = path.join(prefix, d.name);
    const full = path.join(dir, d.name);
    if (d.isDirectory()) found.push(...walk(full, rel));
    else if (d.isFile()) found.push(rel);
    else throw new Error("Backup refused: unusual attachment file type");
  }
  return found;
}
function createMigrationBackup(dataDir) {
  const root = path.resolve(dataDir);
  const backups = path.join(root, "backups");
  const dest = path.join(backups, LABEL);
  const marker = path.join(dest, "manifest.json");
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  if (fs.existsSync(dest)) {
    if (!fs.existsSync(marker)) throw new Error("Migration backup is incomplete: " + LABEL);
    const manifest = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (manifest.label !== LABEL || manifest.files.length < 2) throw new Error("Invalid backup manifest");
    for (const f of manifest.files) {
      const backupFile = path.join(dest, f.path);
      if (!fs.existsSync(backupFile) || checksum(backupFile) !== f.sha256)
        throw new Error("Migration snapshot checksum mismatch: " + f.path);
    }
    return { created: false, count: manifest.files.length };
  }
  // A DB created on first boot has not yet been initialized; server.js will
  // generate it from the repository seed, so skip only the fresh-install case.
  if (!fs.existsSync(path.join(root, "database.json"))) return { created: false, count: 0, fresh: true };
  fs.mkdirSync(dest, { recursive: false, mode: 0o700 });
  const manifest = { label: LABEL, createdAt: new Date().toISOString(), files: [] };
  const add = (relativePath, immutable = false) => {
    const original = path.join(root, relativePath);
    const target = path.join(dest, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    if (immutable) {
      try { fs.linkSync(original, target); } catch (e) {
        if (!["EPERM", "EXDEV", "EOPNOTSUPP"].includes(e.code)) throw e;
        fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
      }
    } else fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
    const sha256 = checksum(original);
    if (sha256 !== checksum(target)) throw new Error("Backup integrity failed");
    manifest.files.push({ path: relativePath, size: fs.statSync(target).size, sha256 });
  };
  for (const name of DB_FILES) if (fs.existsSync(path.join(root, name))) add(name);
  const attachments = path.join(root, "declaration-files");
  for (const relative of walk(attachments)) add(path.join("declaration-files", relative), true);
  const tmp = marker + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
  fs.renameSync(tmp, marker);
  return { created: true, count: manifest.files.length };
}
module.exports = { createMigrationBackup, LABEL };
