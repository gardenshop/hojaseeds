// HS-20260817-11: delivery-inclusive payment preview regression tests.
// Verifies the client's single-source-of-truth paymentPreview(method, subtotal)
// in js/app.js against the exact CASE A-D matrix, and cross-checks it against
// the server-authoritative computeOrderTotals math in apps-script/Code.gs so
// client and server never disagree on deliveryFee/orderTotal/payNow/codDue.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

const rules = {
  FREE_DELIVERY_THRESHOLD: 1500,
  ADVANCE_DELIVERY_FEE: 100,
  COD_DELIVERY_FEE: 250,
  COD_ALLOWED: true,
  SPLIT_ADVANCE_PERCENT: 50,
  CUSTOMIZED_REQUIRES_FULL_ADVANCE: true
};

// ── Client: load js/app.js in a minimal vm and expose paymentPreview ──────
function loadClientPreview() {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    CONFIG: {
      SHEET_WEBHOOK_URL: "",
      WHATSAPP_NUMBER: "",
      CURRENCY: "Rs.",
      GA4_MEASUREMENT_ID: "",
      META_PIXEL_ID: "",
      PAYMENT_ACCOUNTS: { JazzCash: "", EasyPaisa: "", "Bank Transfer": "" },
      PRICING_RULES: rules
    },
    DEFAULT_PRODUCTS: [],
    CATEGORY_META: {
      vegetables: { label: "Vegetable Seeds", tagline: "" },
      flowers: { label: "Flower Seeds", tagline: "" },
      mix: { label: "Mix Seeds", tagline: "" },
      fertilizer: { label: "Fertilizer", tagline: "" }
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { href: "https://example.test/" },
    window: { scrollTo() {}, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" } },
    document: {
      body: { classList: { add() {}, remove() {} } },
      title: "",
      getElementById: () => ({ textContent: "", addEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() { return false; } } }),
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: () => ({ classList: { add() {}, remove() {} }, style: {}, children: [], appendChild(c) { return c; } }),
      createTextNode: text => ({ textContent: text })
    },
    fetch: async () => { throw new Error("unconfigured mock"); }
  });
  // Only the declarations are needed for paymentPreview() — the trailing
  // "---- Init ----" block boots the live app (Router.go, DOM listeners)
  // against a real page and isn't relevant/safe to run in this harness.
  const fullCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const code = fullCode.slice(0, fullCode.indexOf("// ---- Init ----"));
  vm.runInContext(`${code}\nthis.__paymentPreview = paymentPreview;`, context);
  return context.__paymentPreview;
}

// ── Server: load apps-script/Code.gs and expose buildAuthoritativeOrder-style totals via submitOrder ──
function loadServerPreview() {
  const rows = {
    Products: [["id", "name", "cat", "unit", "icon", "price", "type", "active", "stock_quantity"]],
    Settings: [["key", "value"], ...Object.entries(rules)],
    Orders: [["timestamp", "orderId", "name", "phone", "address", "city", "postal", "notes", "paymentMethod", "advanceMethod", "transactionRef", "items", "subtotal", "deliveryFee", "total", "payNow", "codDue"]],
    Contact: [["timestamp", "name", "phone", "message"]]
  };
  const productRow = { id: "case-item", name: "Case Item", cat: "vegetables", unit: "packet", icon: "", price: 0, type: "regular", active: true, stock_quantity: 999 };
  rows.Products.push(Object.values({ ...productRow }));
  const sheets = Object.fromEntries(Object.entries(rows).map(([name, data]) => [name, {
    getDataRange: () => ({ getValues: () => data.map(row => row.slice()) }),
    appendRow: row => data.push(row.slice()),
    getRange: () => ({ setValue: () => {} })
  }]));
  let uuidCounter = 0;
  const context = vm.createContext({
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => sheets[name] || null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}, getProperties: () => ({}) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_a, value) => Array.from(crypto.createHash("sha256").update(value).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url"),
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`
    },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 401, getContentText: () => "{}" }) }
  });
  const code = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
  vm.runInContext(`${code}\nthis.__api = { submitOrder };`, context);
  return { submitOrder: context.__api.submitOrder, productPrice: 0, sheets, rows };
}

let keyCounter = 0;
function serverOrder(server, { subtotal, paymentMethod, advanceMethod }) {
  // Cash on Delivery is only allowed on ready-made Mix Packs
  // (cat "mix"/type "standard-collection"); vegetables/flowers require
  // Advance or Split. Pick a policy-compatible product per method.
  const cod = paymentMethod === "Cash on Delivery";
  server.rows.Products[1] = cod
    ? ["case-item", "Case Item", "mix", "kit", "", subtotal, "standard-collection", true, 999]
    : ["case-item", "Case Item", "vegetables", "packet", "", subtotal, "regular", true, 999];
  return server.submitOrder({
    type: "order",
    idempotencyKey: `pp-test-idempotency-key-${++keyCounter}`,
    customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Garden Road", city: "Lahore", postal: "54000", notes: "" },
    payment: { method: paymentMethod, advanceMethod: advanceMethod || "", transactionReference: advanceMethod ? "TXN123456" : "" },
    items: [{ productId: "case-item", quantity: 1 }]
  });
}

(async () => {
  const paymentPreview = loadClientPreview();
  const server = loadServerPreview();

  // CASE A: subtotal 1545, Advance, threshold 1500, advance fee 100
  {
    const c = paymentPreview("Advance Payment", 1545);
    assert.equal(c.deliveryFee, 0, "CASE A: delivery free at/above threshold");
    assert.equal(c.orderTotal, 1545, "CASE A: total");
    assert.equal(c.payNow, 1545, "CASE A: payNow");
    assert.equal(c.codDue, 0, "CASE A: codDue");
    const s = serverOrder(server, { subtotal: 1545, paymentMethod: "Advance Payment", advanceMethod: "JazzCash" });
    assert.equal(c.deliveryFee, s.deliveryFee, "CASE A: client/server deliveryFee match");
    assert.equal(c.orderTotal, s.total, "CASE A: client/server total match");
    assert.equal(c.payNow, s.payNow, "CASE A: client/server payNow match");
    assert.equal(c.codDue, s.codDue, "CASE A: client/server codDue match");
  }

  // CASE B: subtotal 1545, Split, delivery fee 250, split 50/50, rounding 100
  {
    const c = paymentPreview("Split Payment", 1545);
    assert.equal(c.deliveryFee, 250, "CASE B: delivery");
    assert.equal(c.orderTotal, 1795, "CASE B: total");
    assert.equal(c.payNow, 895, "CASE B: payNow (not 898)");
    assert.equal(c.codDue, 900, "CASE B: codDue (not 897)");
    assert.equal(c.payNow + c.codDue, c.orderTotal, "CASE B: payNow + codDue == orderTotal");
    const s = serverOrder(server, { subtotal: 1545, paymentMethod: "Split Payment", advanceMethod: "JazzCash" });
    assert.equal(c.deliveryFee, s.deliveryFee, "CASE B: client/server deliveryFee match");
    assert.equal(c.orderTotal, s.total, "CASE B: client/server total match");
    assert.equal(c.payNow, s.payNow, "CASE B: client/server payNow match");
    assert.equal(c.codDue, s.codDue, "CASE B: client/server codDue match");
  }

  // CASE C: subtotal 999, Advance -> delivery 100, total 1099
  {
    const c = paymentPreview("Advance Payment", 999);
    assert.equal(c.deliveryFee, 100, "CASE C: delivery below threshold");
    assert.equal(c.orderTotal, 1099, "CASE C: total");
    const s = serverOrder(server, { subtotal: 999, paymentMethod: "Advance Payment", advanceMethod: "JazzCash" });
    assert.equal(c.deliveryFee, s.deliveryFee, "CASE C: client/server deliveryFee match");
    assert.equal(c.orderTotal, s.total, "CASE C: client/server total match");
  }

  // CASE D: subtotal 999, COD -> delivery 250, total 1249
  {
    const c = paymentPreview("Cash on Delivery", 999);
    assert.equal(c.deliveryFee, 250, "CASE D: delivery");
    assert.equal(c.orderTotal, 1249, "CASE D: total");
    assert.equal(c.payNow, 0, "CASE D: payNow");
    assert.equal(c.codDue, 1249, "CASE D: codDue");
    const s = serverOrder(server, { subtotal: 999, paymentMethod: "Cash on Delivery" });
    assert.equal(c.deliveryFee, s.deliveryFee, "CASE D: client/server deliveryFee match");
    assert.equal(c.orderTotal, s.total, "CASE D: client/server total match");
    assert.equal(c.payNow, s.payNow, "CASE D: client/server payNow match");
    assert.equal(c.codDue, s.codDue, "CASE D: client/server codDue match");
  }

  console.log("PASS: payment preview regression tests");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
