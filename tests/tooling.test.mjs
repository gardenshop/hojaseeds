import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const migrate = () => execFileSync(node, ["scripts/sheets-migrate.mjs", "--local"], { cwd: root, encoding: "utf8" });
const verify = () => execFileSync(node, ["scripts/sheets-verify.mjs", "--local"], { cwd: root, encoding: "utf8" });

assert.equal(migrate(), migrate(), "migration dry-run is deterministic");
assert.equal(verify(), verify(), "schema verification plan is deterministic");
const schema = JSON.parse(fs.readFileSync(path.join(root, "config", "sheet-schema.json"), "utf8"));
for (const headers of Object.values(schema.sheets)) assert.equal(new Set(headers).size, headers.length, "schema headers are unique");
const blocked = spawnSync(node, ["scripts/deploy-hoja.mjs", "--remote"], { cwd: root, encoding: "utf8", env: { ...process.env, HOJA_EXPECTED_SCRIPT_ID: "unverified-target" } });
assert.notEqual(blocked.status, 0, "remote deploy fails closed without verified target config");
assert.match(`${blocked.stdout}\n${blocked.stderr}`, /HOJA_EXPECTED_SCRIPT_ID/);
const frontend = fs.readFileSync(path.join(root, "js", "config.js"), "utf8") + fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
assert.doesNotMatch(frontend, /ADMIN_PASSWORD|hoja-admin-2026/);
assert.doesNotMatch(fs.readFileSync(path.join(root, "index-standalone.html"), "utf8"), /mode:\s*["']no-cors["']/);
console.log("PASS: tooling safety and deterministic migration tests");
