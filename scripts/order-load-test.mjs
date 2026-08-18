import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = JSON.parse(await fs.readFile(path.join(root, "config", "production-target.json"), "utf8"));
const args = new Map(process.argv.slice(2).filter(value => value.startsWith("--")).map(value => {
  const [key, ...rest] = value.slice(2).split("=");
  return [key, rest.join("=") || "true"];
}));
const orders = Number(args.get("orders") || 5);
const concurrency = Math.max(1, Number(args.get("concurrency") || 1));
const testRunId = String(args.get("test-run-id") || `LOAD-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`);
const paymentMode = String(args.get("payment") || "mixed");
const endpoint = process.env.HOJA_ORDER_ENDPOINT || target.web_app_url;
const secret = process.env.HOJA_LOAD_TEST_SECRET;
if (!secret) throw new Error("HOJA_LOAD_TEST_SECRET is required and is never read from a tracked file.");
if (!Number.isInteger(orders) || orders < 1 || orders > 1000) throw new Error("--orders must be an integer from 1 to 1000.");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) throw new Error("--concurrency must be an integer from 1 to 20.");

const products = (await fs.readFile(path.join(root, "js", "products.js"), "utf8"))
  .matchAll(/id:\s*["']([^"']+)["'][\s\S]{0,180}?cat:\s*["']([^"']+)["'][\s\S]{0,180}?type:\s*["']([^"']+)["']/g);
const catalog = [...products].map(match => ({ id: match[1], cat: match[2], type: match[3] }));
const mix = catalog.find(product => product.cat === "mix" && product.type === "standard-collection");
const vegetable = catalog.find(product => product.cat === "vegetables");
if (!mix || !vegetable) throw new Error("Approved fallback catalog is missing required Mix/Vegetable products.");

function paymentFor(sequence) {
  if (paymentMode !== "mixed") return paymentMode;
  const bucket = sequence % 10;
  if (bucket < 4) return "Cash on Delivery";
  if (bucket < 7) return "Advance Payment";
  return "Split Payment";
}
function payload(sequence) {
  const method = paymentFor(sequence);
  const product = method === "Cash on Delivery" ? mix : vegetable;
  return {
    type: "order", loadTest: true, loadTestSecret: secret, testRunId, sequence,
    idempotencyKey: `${testRunId}-${String(sequence).padStart(5, "0")}`,
    customer: { name: `LOAD TEST ${String(sequence).padStart(6, "0")}`, phone: `0335${String(1000000 + sequence).slice(-7)}`, address: "1 Load Test Road", city: "Lahore", postal: "54000", notes: "LOAD TEST - DO NOT FULFILL" },
    items: [{ productId: product.id, quantity: 1 }],
    payment: { method, advanceMethod: method === "Cash on Delivery" ? "" : "JazzCash", transactionReference: method === "Cash on Delivery" ? "" : `LOADTEST-${String(sequence).padStart(6, "0")}` }
  };
}
const RETRYABLE_CODES = new Set(["ORDER_BUSY"]);
const MAX_ATTEMPTS = 3;

async function one(sequence) {
  const started = performance.now();
  const body = payload(sequence);
  let attempts = 0;
  let last;
  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(75000) });
      const data = await response.json().catch(() => ({}));
      const latencyMs = Math.round(performance.now() - started);
      const errorCode = data.error?.code || data.code || null;
      last = { sequence, idempotencyKey: body.idempotencyKey, paymentMode: body.payment.method, httpStatus: response.status, latencyMs, ok: Boolean(data.ok), orderId: data.orderId || null, errorCode, attempts };
      if (last.ok || !RETRYABLE_CODES.has(errorCode) || attempts >= MAX_ATTEMPTS) return last;
      await new Promise(resolve => setTimeout(resolve, 250 * attempts));
    } catch (error) {
      last = { sequence, idempotencyKey: body.idempotencyKey, paymentMode: body.payment.method, latencyMs: Math.round(performance.now() - started), ok: false, errorCode: error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR", error: error.message, attempts };
      return last;
    }
  }
  return last;
}
const startedAt = new Date().toISOString();
const results = [];
let next = 1;
async function worker() { while (next <= orders) { const sequence = next++; results.push(await one(sequence)); } }
await Promise.all(Array.from({ length: Math.min(concurrency, orders) }, worker));
results.sort((a, b) => a.sequence - b.sequence);
const latencies = results.map(result => result.latencyMs).sort((a, b) => a - b);
const percentile = p => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)] : 0;
const report = { testRunId, endpoint, startedAt, finishedAt: new Date().toISOString(), orders, concurrency, paymentMode, attempted: orders, successful: results.filter(result => result.ok).length, failures: results.filter(result => !result.ok).length, latencyMs: { min: latencies[0] || 0, mean: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : 0, p50: percentile(.5), p90: percentile(.9), p95: percentile(.95), p99: percentile(.99), max: latencies.at(-1) || 0 }, uniqueOrderIds: new Set(results.map(result => result.orderId).filter(Boolean)).size, duplicateOrderIds: results.length - new Set(results.map(result => result.orderId).filter(Boolean)).size, results };
const reportDir = path.join(root, ".tools", "load-tests");
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(path.join(reportDir, `${testRunId}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failures) process.exitCode = 2;
