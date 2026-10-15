"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const Module = require("module");

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

const root = __dirname;
const chunksDir = path.join(root, "restore", "chunks");
if (!fs.existsSync(chunksDir)) throw new Error("Missing restore/chunks directory");

const chunks = fs.readdirSync(chunksDir)
  .filter(name => name.endsWith(".b64"))
  .sort(naturalCompare);
if (!chunks.length) throw new Error("No restore chunks found");

const encoded = chunks.map(name => fs.readFileSync(path.join(chunksDir, name), "utf8").trim()).join("");
const zipBuffer = Buffer.from(encoded, "base64");
if (zipBuffer.length < 4 || zipBuffer.subarray(0, 2).toString("hex") !== "504b") {
  throw new Error("Reconstructed backup is not a ZIP archive");
}

const workDir = path.join(os.tmpdir(), "pro-optima-restored");
const zipPath = path.join(os.tmpdir(), "pro-optima-restored.zip");
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
fs.writeFileSync(zipPath, zipBuffer);
cp.execFileSync("unzip", ["-q", "-o", zipPath, "-d", workDir], { stdio: "inherit" });

const entries = fs.readdirSync(workDir, { withFileTypes: true });
let appRoot = workDir;
if (entries.length === 1 && entries[0].isDirectory()) appRoot = path.join(workDir, entries[0].name);
const startFile = path.join(appRoot, "server", "start.js");
if (!fs.existsSync(startFile)) throw new Error(`Restored archive does not contain server/start.js: ${startFile}`);

process.env.NODE_PATH = [path.join(root, "node_modules"), process.env.NODE_PATH || ""].filter(Boolean).join(path.delimiter);
Module._initPaths();
process.chdir(appRoot);
console.log(`[RESTORE] rebuilt ${chunks.length} archive chunks; starting ${startFile}`);
require(startFile);
