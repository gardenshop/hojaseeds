import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "config", "sheet-schema.json");
const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
const target = JSON.parse(await fs.readFile(path.join(root, "config", "production-target.json"), "utf8"));
const apply = process.argv.includes("--apply");
const local = process.argv.includes("--local");
const sheetId = local ? "" : (process.env.HOJA_SHEET_ID || target.sheet_id);
const expectedTitle = process.env.HOJA_SHEET_TITLE || target.sheet_title;

function sortedPlan(existing = {}) {
  return Object.keys(schema.sheets).sort().map(title => {
    const current = existing[title] || [];
    const required = schema.sheets[title];
    return {
      title,
      exists: Object.prototype.hasOwnProperty.call(existing, title),
      missing: required.filter(header => !current.includes(header)),
      current
    };
  });
}

if (!sheetId) {
  console.log(JSON.stringify({ ok: true, mode: "local", schema_version: schema.schema_version, plan: sortedPlan() }, null, 2));
  process.exit(0);
}

async function getSheetsClient() {
  let googleapis;
  try { googleapis = await import("googleapis"); }
  catch { throw new Error("Install configured tooling with npm install before live Sheet verification."); }
  const auth = process.env.GOOGLE_OAUTH_ACCESS_TOKEN
    ? new googleapis.google.auth.OAuth2()
    : new googleapis.google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) auth.setCredentials({ access_token: process.env.GOOGLE_OAUTH_ACCESS_TOKEN });
  return googleapis.google.sheets({ version: "v4", auth });
}

const sheets = await getSheetsClient();
const metadata = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "spreadsheetId,properties(title),sheets(properties(title),data(rowData(values(effectiveValue))))" });
const title = metadata.data.properties?.title;
if (title !== expectedTitle) throw new Error(`Sheet target title mismatch: expected ${expectedTitle}, got ${title || "(missing)"}.`);

const existing = {};
for (const sheet of metadata.data.sheets || []) {
  const name = sheet.properties?.title;
  const row = sheet.data?.[0]?.rowData?.[0]?.values || [];
  existing[name] = row.map(cell => cell.effectiveValue?.stringValue ?? cell.effectiveValue?.numberValue ?? "").map(String).filter(Boolean);
}
const plan = sortedPlan(existing);
console.log(JSON.stringify({ ok: true, mode: apply ? "live" : "verify", spreadsheetId: sheetId, title, schema_version: schema.schema_version, plan }, null, 2));
