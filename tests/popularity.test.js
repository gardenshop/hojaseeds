// Focused tests for the read-only "Popular Seeds" bestseller ranking
// (HS-20260818-31, getPopularProducts/computePopularProducts in
// apps-script/Code.gs). Uses synthetic Orders rows only — no real
// production orders are created or required.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const ORDERS_HEADER = ["timestamp", "orderId", "name", "phone", "address", "city", "postal", "notes", "paymentMethod", "advanceMethod", "transactionRef", "items", "subtotal", "deliveryFee", "total", "payNow", "codDue"];

function itemsCell(items, fingerprint) {
  return JSON.stringify({ fingerprint: fingerprint || "fp", items });
}

function backend(orderRows) {
  const data = { Orders: [ORDERS_HEADER.slice(), ...orderRows] };
  const sheets = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, {
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) })
  }]));
  const cacheStore = new Map();
  const context = vm.createContext({
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => sheets[name] || null }) },
    CacheService: { getScriptCache: () => ({
      get: key => (cacheStore.has(key) ? cacheStore.get(key) : null),
      put: (key, value) => cacheStore.set(key, value)
    }) }
  });
  const code = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
  vm.runInContext(`${code}\nthis.__api = { getPopularProducts, computePopularProducts };`, context);
  return { api: context.__api, cacheStore };
}

function row(name, items) {
  const r = ORDERS_HEADER.map(() => "");
  r[ORDERS_HEADER.indexOf("timestamp")] = new Date().toISOString();
  r[ORDERS_HEADER.indexOf("orderId")] = "HOJA-TEST-" + Math.random().toString(36).slice(2, 8);
  r[ORDERS_HEADER.indexOf("name")] = name;
  r[ORDERS_HEADER.indexOf("items")] = itemsCell(items);
  return r;
}

(function realQuantitiesAggregateCorrectly() {
  const { api } = backend([
    row("Ali Khan", [{ productId: "veg-01", quantity: 2 }, { productId: "flo-01", quantity: 1 }]),
    row("Sara Ahmed", [{ productId: "veg-01", quantity: 3 }])
  ]);
  const result = api.computePopularProducts();
  const veg01 = result.find(r => r.productId === "veg-01");
  assert.ok(veg01, "veg-01 should appear in ranking");
  assert.strictEqual(veg01.soldQty, 5, "PAY-POP-A: multiple orders/quantities aggregate correctly");
})();

(function testAndLoadOrdersExcluded() {
  const { api } = backend([
    row("LAUNCH TEST DO NOT FULFILL", [{ productId: "veg-02", quantity: 50 }]),
    row("FINAL E2E TEST - DO NOT FULFILL", [{ productId: "veg-02", quantity: 50 }]),
    row("Real Customer", [{ productId: "veg-02", quantity: 1 }])
  ]);
  const result = api.computePopularProducts();
  const veg02 = result.find(r => r.productId === "veg-02");
  assert.strictEqual(veg02.soldQty, 1, "PAY-POP-B: marked test/E2E/DO NOT FULFILL rows must not count");
})();

(function unknownProductIdsIgnoredSafely() {
  const { api } = backend([
    row("Customer A", [{ productId: "does-not-exist", quantity: 4 }, { productId: "veg-03", quantity: 2 }])
  ]);
  const result = api.computePopularProducts();
  // computePopularProducts itself just aggregates by whatever productId was
  // recorded; filtering against the live catalog happens client-side in
  // pickPopularProducts (js/app.js) so a since-removed ID never crashes or
  // silently disappears the ranking of real products.
  assert.ok(result.find(r => r.productId === "veg-03" && r.soldQty === 2));
})();

(function top6StableAndSortedDescending() {
  const rows = [];
  const ids = ["veg-01", "veg-02", "veg-03", "veg-04", "veg-05", "veg-06", "veg-07"];
  ids.forEach((id, i) => rows.push(row("Customer " + i, [{ productId: id, quantity: ids.length - i }])));
  const { api } = backend(rows);
  const result = api.computePopularProducts();
  assert.strictEqual(result.length, 6, "PAY-POP-C: top 6 only");
  for (let i = 1; i < result.length; i++) assert.ok(result[i - 1].soldQty >= result[i].soldQty, "sorted descending");
  assert.strictEqual(result[0].productId, "veg-01");
})();

(function emptyOrderHistoryReturnsEmptyForFrontendFallback() {
  const { api } = backend([]);
  const result = api.computePopularProducts();
  assert.strictEqual(result.length, 0, "PAY-POP-D: empty history returns [] so the frontend falls back to catalog order");
})();

(function noPIIInResponseShape() {
  const { api } = backend([row("Ali Khan", [{ productId: "veg-01", quantity: 1 }])]);
  const result = api.computePopularProducts();
  result.forEach(r => {
    const keys = Object.keys(r).sort();
    assert.deepStrictEqual(keys, ["productId", "soldQty"], "PAY-POP-E: public shape is productId/soldQty only, no PII");
  });
})();

(function cacheServesRepeatedCallsWithoutRecomputing() {
  const { api, cacheStore } = backend([row("Ali Khan", [{ productId: "veg-01", quantity: 1 }])]);
  const first = api.getPopularProducts();
  assert.strictEqual(cacheStore.size, 1, "first call populates the cache");
  const cachedRaw = cacheStore.get("popularProducts_v1");
  // Mutate the underlying store's cached payload to prove the second call
  // reads the cache rather than recomputing.
  cacheStore.set("popularProducts_v1", JSON.stringify([{ productId: "sentinel", soldQty: 999 }]));
  const second = api.getPopularProducts();
  assert.strictEqual(second[0].productId, "sentinel", "PAY-POP-F: cached result served on repeat calls");
  cacheStore.set("popularProducts_v1", cachedRaw);
  void first;
})();

console.log("PASS: popularity/bestseller ranking tests");
