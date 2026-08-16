import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(await fs.readFile(path.join(root, "config", "sheet-schema.json"), "utf8"));
const paymentDefaults = JSON.parse(await fs.readFile(path.join(root, "config", "payment-settings-defaults.json"), "utf8"));
const target = JSON.parse(await fs.readFile(path.join(root, "config", "production-target.json"), "utf8"));
const apply = process.argv.includes("--apply");
const local = process.argv.includes("--local");
const sheetId = local ? "" : (process.env.HOJA_SHEET_ID || target.sheet_id);

function plan(existing = {}) {
  return Object.keys(schema.sheets).sort().map(title => ({
    title,
    create: !Object.prototype.hasOwnProperty.call(existing, title),
    addHeaders: schema.sheets[title].filter(header => !(existing[title] || []).includes(header))
  }));
}

if (!sheetId) {
  console.log(JSON.stringify({ ok: true, mode: "dry-run", schema_version: schema.schema_version, plan: plan() }, null, 2));
  process.exit(0);
}

let googleapis;
try { googleapis = await import("googleapis"); }
catch { throw new Error("Install configured tooling with npm install before live Sheet migration."); }
const auth = process.env.GOOGLE_OAUTH_ACCESS_TOKEN
  ? new googleapis.google.auth.OAuth2()
  : new googleapis.google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) auth.setCredentials({ access_token: process.env.GOOGLE_OAUTH_ACCESS_TOKEN });
const sheets = googleapis.google.sheets({ version: "v4", auth });
const metadata = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "spreadsheetId,properties(title),sheets(properties(sheetId,title),data(rowData(values(effectiveValue))))" });
if (metadata.data.properties?.title !== (process.env.HOJA_SHEET_TITLE || target.sheet_title)) throw new Error("Refusing migration: spreadsheet title does not match hoja-seeds-2026.");

const existing = {};
const sheetIds = {};
for (const sheet of metadata.data.sheets || []) {
  const title = sheet.properties?.title;
  sheetIds[title] = sheet.properties?.sheetId;
  const row = sheet.data?.[0]?.rowData?.[0]?.values || [];
  existing[title] = row.map(cell => cell.effectiveValue?.stringValue ?? cell.effectiveValue?.numberValue ?? "").map(String).filter(Boolean);
}
const migrationPlan = plan(existing);
console.log(JSON.stringify({ ok: true, mode: apply ? "live" : "dry-run", schema_version: schema.schema_version, plan: migrationPlan, paymentSettings: Object.keys(paymentDefaults) }, null, 2));
if (!apply) process.exit(0);

const requests = [];
for (const item of migrationPlan) {
  if (item.create) {
    requests.push({ addSheet: { properties: { title: item.title } } });
  }
}
if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests } });

const refreshed = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets(properties(sheetId,title),data(rowData(values(effectiveValue))))" });
for (const sheet of refreshed.data.sheets || []) {
  const title = sheet.properties?.title;
  const current = sheet.data?.[0]?.rowData?.[0]?.values || [];
  const headers = current.map(cell => cell.effectiveValue?.stringValue ?? cell.effectiveValue?.numberValue ?? "").map(String).filter(Boolean);
  const missing = schema.sheets[title]?.filter(header => !headers.includes(header)) || [];
  if (missing.length) {
    const endColumn = headers.length;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${title}!${columnName(endColumn + 1)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [missing] }
    });
  }
}
const settings = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "Settings!A:C" });
const settingRows = settings.data.values || [];
const existingSettingKeys = new Set(settingRows.map(row => String(row[0] || "")));
const missingPaymentSettings = Object.entries(paymentDefaults).filter(([key]) => !existingSettingKeys.has(key));
if (missingPaymentSettings.length) {
  await sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: "Settings!A:B", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: missingPaymentSettings } });
}
const schemaVersionRow = settingRows.findIndex(row => row[0] === "schema_version");
if (schemaVersionRow === -1) {
  await sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: "Settings!A:B", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [["schema_version", schema.schema_version]] } });
} else if (String(settingRows[schemaVersionRow][1]) !== String(schema.schema_version)) {
  await sheets.spreadsheets.values.update({ spreadsheetId: sheetId, range: `Settings!B${schemaVersionRow + 1}`, valueInputOption: "RAW", requestBody: { values: [[schema.schema_version]] } });
}
console.log(JSON.stringify({ ok: true, migration: "applied", addedPaymentSettings: missingPaymentSettings.map(([key]) => key), message: "Migration applied additively; existing data and columns were not deleted or renamed." }));

function columnName(number) {
  let result = "";
  while (number > 0) { const remainder = (number - 1) % 26; result = String.fromCharCode(65 + remainder) + result; number = Math.floor((number - 1) / 26); }
  return result;
}
