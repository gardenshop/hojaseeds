import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = JSON.parse(await fs.readFile(path.join(root, "config", "production-target.json"), "utf8"));
const remote = process.argv.includes("--remote");
const release = process.argv.includes("--release");
const push = process.argv.includes("--push") || release;
const expectedScriptId = process.env.HOJA_EXPECTED_SCRIPT_ID || target.apps_script_id || "";
const claspFile = path.join(root, ".clasp.json");

await fs.access(path.join(root, "apps-script", "Code.gs"));
await fs.access(path.join(root, "config", "sheet-schema.json"));
if (!remote) {
  console.log("Remote operations blocked. Use --remote only after verifying the Hoja Seeds Script ID, Sheet ID, and credentials.");
  process.exit(0);
}
if (!expectedScriptId) throw new Error("Set HOJA_EXPECTED_SCRIPT_ID after verifying the target belongs to Hoja Seeds.");
let clasp;
try { clasp = JSON.parse(await fs.readFile(claspFile, "utf8")); }
catch { throw new Error("Missing .clasp.json. Copy .clasp.json.example only after verifying the Hoja Seeds Script ID."); }
if (!clasp.scriptId || clasp.scriptId !== expectedScriptId) throw new Error("Refusing remote action: .clasp.json Script ID does not match HOJA_EXPECTED_SCRIPT_ID.");
const sheetId = process.env.HOJA_SHEET_ID || target.sheet_id;
if (!sheetId) throw new Error("The protected Hoja Seeds Sheet ID is missing.");
await verifyScriptTarget(clasp.scriptId);
await run(process.execPath, ["scripts/sheets-verify.mjs"]);

if (push) {
  await run(process.execPath, ["scripts/sheets-migrate.mjs", "--apply"]);
  await run(process.execPath, ["scripts/sheets-verify.mjs"]);
  await run("clasp", ["push"]);
}
if (release) {
  await run("clasp", ["version", "Hoja Seeds managed release"]);
  await run("clasp", ["deploy", "--description", "Hoja Seeds managed release"]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const executable = isWindows && command === "clasp" ? process.execPath : command;
    const commandArgs = isWindows && command === "clasp"
      ? [path.join(root, "node_modules", "@google", "clasp", "build", "src", "index.js"), ...args]
      : args;
    const child = spawn(executable, commandArgs, { cwd: root, stdio: "inherit" });
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`)));
    child.on("error", reject);
  });
}

async function verifyScriptTarget(scriptId) {
  let googleapis;
  try { googleapis = await import("googleapis"); }
  catch { throw new Error("Install googleapis before remote target verification."); }
  const auth = process.env.GOOGLE_OAUTH_ACCESS_TOKEN
    ? new googleapis.google.auth.OAuth2()
    : new googleapis.google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/script.projects"] });
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) auth.setCredentials({ access_token: process.env.GOOGLE_OAUTH_ACCESS_TOKEN });
  const scripts = googleapis.google.script({ version: "v1", auth });
  const project = await scripts.projects.get({ scriptId });
  const title = project.data.title || "";
  const expectedTitle = process.env.HOJA_SCRIPT_TITLE || "Hoja Seeds";
  if (title !== expectedTitle) throw new Error(`Refusing remote action: Apps Script title mismatch, expected ${expectedTitle}.`);
  if (project.data.parentId !== (process.env.HOJA_SHEET_ID || target.sheet_id)) throw new Error("Refusing remote action: Apps Script is not bound to the verified Hoja Seeds Sheet.");
  console.log(`Verified Apps Script target: ${title}`);
}
