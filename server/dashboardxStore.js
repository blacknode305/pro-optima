"use strict";

/**
 * Canonical DashboardX-on-Railway persisted JSON contract.
 *
 * Disk: {format, schemaVersion, dashboardx: {optima: {...}, media: {...}, learning: {...}}}
 * API compatibility: exposes the legacy PRO OPTIMA top-level collection shape
 * only in memory; never writes a separate mutable legacy database.
 *
 * Existing identifiers, units, prices, schedules, historical orders, documents,
 * and private DashboardX state are preserved byte-for-value (JSON semantics).
 */
const FORMAT = "dashboardx-global-v1";
const SCHEMA_VERSION = 1;
const OPTIMA_SCHEMA_VERSION = 1;
const NEW_COLLECTIONS = Object.freeze([
  "supplierProductEvidence",
  "documentCoverage",
  "receiptLots",
  "priceHistory",
  "packageConversions"
]);
const REQUIRED_COLLECTIONS = Object.freeze(["suppliers", "products"]);
const COLLECTIONS = Object.freeze([
  ...REQUIRED_COLLECTIONS, "supplierCatalog", "offers", "history", "stocks",
  "transfers", "dateRequests", "declarations", ...NEW_COLLECTIONS
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function duplicate(value) {
  return structuredClone(value);
}
function optimaFromLegacy(legacy) {
  if (!object(legacy) || !object(legacy.dashboardx)) {
    throw Error("Expected validated PRO OPTIMA object with dashboardx namespace.");
  }
  const optima = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (key !== "dashboardx") optima[key] = duplicate(value);
  }
  for (const name of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(optima[name])) throw Error("Missing PRO OPTIMA collection " + name);
  }
  for (const name of COLLECTIONS) {
    if (name in optima && !Array.isArray(optima[name])) {
      throw Error("Invalid OPTIMA collection: " + name);
    }
    if (!(name in optima)) optima[name] = [];
  }
  if (!object(optima.settings)) optima.settings = {};
  if (!Number.isSafeInteger(optima.schemaVersion) || optima.schemaVersion < 1) {
    optima.schemaVersion = OPTIMA_SCHEMA_VERSION;
  }
  return optima;
}
function toCanonical(legacy) {
  const optima = optimaFromLegacy(legacy);
  const dashboardx = duplicate(legacy.dashboardx);
  // Never accept a second nested Optima value from a legacy import / PATCH.
  // Changes to its real content come from the validated legacy collections.
  delete dashboardx.optima;
  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    dashboardx: { ...dashboardx, optima }
  };
}
function fromCanonical(canonical) {
  if (!object(canonical) || canonical.format !== FORMAT ||
      canonical.schemaVersion !== SCHEMA_VERSION ||
      !object(canonical.dashboardx) || !object(canonical.dashboardx.optima)) {
    throw Error("Invalid DashboardX global database schema.");
  }
  const dashboardx = duplicate(canonical.dashboardx);
  const optima = dashboardx.optima;
  delete dashboardx.optima;
  if (!object(optima)) throw Error("Invalid dashboardx.optima");
  for (const name of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(optima[name])) throw Error("Missing canonical collection: " + name);
  }
  for (const name of COLLECTIONS) {
    if (name in optima && !Array.isArray(optima[name])) throw Error("Invalid canonical collection: " + name);
  }
  if (!object(optima.settings)) throw Error("Invalid canonical settings");
  return { ...duplicate(optima), dashboardx };
}
function integritySummary(legacy) {
  const optima = optimaFromLegacy(legacy);
  const result = {};
  for (const k of COLLECTIONS) result[k] = optima[k].length;
  return result;
}
function compareRoundTrip(legacy, converted) {
  const actual = fromCanonical(converted);
  const originalOptima = optimaFromLegacy(legacy);
  const restoredOptima = optimaFromLegacy(actual);
  if (JSON.stringify(originalOptima) !== JSON.stringify(restoredOptima)) {
    throw Error("OPTIMA round-trip content mismatch.");
  }
  const originalDX = duplicate(legacy.dashboardx);
  delete originalDX.optima;
  if (JSON.stringify(originalDX) !== JSON.stringify(actual.dashboardx)) {
    throw Error("DashboardX namespace round-trip mismatch.");
  }
  return integritySummary(actual);
}

module.exports = {
  FORMAT, SCHEMA_VERSION, COLLECTIONS, NEW_COLLECTIONS,
  optimaFromLegacy, toCanonical, fromCanonical, integritySummary,
  compareRoundTrip
};
