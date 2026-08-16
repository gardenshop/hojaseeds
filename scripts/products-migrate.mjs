import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = JSON.parse(await fs.readFile(path.join(root, "config", "production-target.json"), "utf8"));
const schema = JSON.parse(await fs.readFile(path.join(root, "config", "sheet-schema.json"), "utf8"));
const apply = process.argv.includes("--apply");
const localOnly = process.argv.includes("--local");
const productHeaders = schema.sheets.Products;
const approvedFields = ["id", "cat", "name", "unit", "icon", "price", "type"];

const source = await fs.readFile(path.join(root, "js", "products.js"), "utf8");
const sandbox = {};
vm.runInNewContext(`${source}\nthis.__products = DEFAULT_PRODUCTS;`, sandbox);
const products = sandbox.__products;
if (!Array.isArray(products) || products.length !== 47) throw new Error(`Expected exactly 47 approved local products, found ${products?.length || 0}.`);
const localIds = new Set();
for (const product of products) {
  if (localIds.has(product.id)) throw new Error(`Duplicate local product ID: ${product.id}`);
  localIds.add(product.id);
  for (const field of approvedFields) if (product[field] === undefined || product[field] === null || product[field] === "") throw new Error(`Missing approved field ${field} for ${product.id}.`);
}

function row(product) {
  const values = {
    id: product.id, name: product.name, cat: product.cat, unit: product.unit,
    icon: product.icon, price: product.price, type: product.type
  };
  return productHeaders.map(header => values[header] ?? "");
}

function compare(existing, product) {
  if (!existing) return [];
  const mismatches = [];
  for (const field of approvedFields) if (String(existing[field] ?? "") !== String(product[field] ?? "")) mismatches.push(field);
  return mismatches;
}

if (localOnly) {
  console.log(JSON.stringify({ ok: true, mode: "local", count: products.length, ids: products.map(p => p.id) }, null, 2));
  process.exit(0);
}

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = target.sheet_id;
const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId,properties(title)" });
if (metadata.data.spreadsheetId !== spreadsheetId || metadata.data.properties?.title !== target.sheet_title) throw new Error("Refusing product migration: protected Sheet identity mismatch.");
const result = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Products!A:U" });
const values = result.data.values || [];
const headers = values[0] || [];
if (headers.join("\u001f") !== productHeaders.join("\u001f")) throw new Error("Refusing product migration: Products headers do not match schema v1.");
const existingById = new Map();
for (const raw of values.slice(1)) {
  if (!raw[0]) continue;
  if (existingById.has(String(raw[0]))) throw new Error(`Duplicate existing Sheet product ID: ${raw[0]}.`);
  existingById.set(String(raw[0]), Object.fromEntries(headers.map((header, index) => [header, raw[index] ?? ""])));
}
const missing = products.filter(product => !existingById.has(product.id));
const conflicts = products.map(product => ({ product, fields: compare(existingById.get(product.id), product) })).filter(item => item.fields.length);
console.log(JSON.stringify({ ok: conflicts.length === 0, mode: apply ? "live" : "dry-run", source_count: products.length, existing_count: existingById.size, missing_count: missing.length, missing_ids: missing.map(p => p.id), conflicts: conflicts.map(item => ({ id: item.product.id, fields: item.fields })) }, null, 2));
if (conflicts.length) throw new Error("Existing product data differs from the approved local catalog; no existing rows were changed.");
if (!apply || !missing.length) process.exit(0);
await sheets.spreadsheets.values.append({ spreadsheetId, range: "Products!A:U", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: missing.map(row) } });
console.log(`Appended ${missing.length} approved products without overwriting existing rows.`);
