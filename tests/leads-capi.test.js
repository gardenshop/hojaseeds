// Checkout Leads + Meta CAPI tests (HS-20260819-02). Synthetic Sheet/CAPI
// mocks only -- no real Sheet writes, no real Meta network calls, no real
// orders created.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function products() {
  return [
    { id: "veg-01", cat: "vegetables", name: "Tomato", unit: "packet", price: 180, type: "regular" },
    { id: "mix-01", cat: "mix", name: "Kitchen Garden Mix", unit: "kit", price: 999, type: "standard-collection" }
  ];
}

function createBackend({ capiToken = "TEST_TOKEN", capiStatus = 200, capiThrows = false } = {}) {
  const rows = {
    Products: [Object.keys(products()[0]), ...products().map(Object.values)],
    Settings: [["key", "value"]],
    Orders: [["timestamp", "orderId", "name", "phone", "address", "city", "postal", "notes", "paymentMethod", "advanceMethod", "transactionRef", "items", "subtotal", "deliveryFee", "total", "payNow", "codDue"]]
  };
  const sheets = {};
  function makeSheet(title) {
    const data = rows[title];
    const obj = {
      getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
      appendRow: row => data.push(row.slice()),
      getRange: (r, c, nr, nc) => ({
        setValue: v => { data[r - 1][c - 1] = v; },
        setValues: values => {
          for (let i = 0; i < (nr || 1); i++) for (let j = 0; j < (nc || values[0].length); j++) {
            data[r - 1 + i][c - 1 + j] = values[i][j];
          }
        }
      })
    };
    sheets[title] = obj;
    return obj;
  }
  Object.keys(rows).forEach(makeSheet);

  const properties = new Map();
  if (capiToken) properties.set("META_CAPI_ACCESS_TOKEN", capiToken);
  const capiCalls = [];
  let lockCount = 0;

  const context = vm.createContext({
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: name => sheets[name] || null,
        insertSheet: name => { rows[name] = []; return makeSheet(name); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => { lockCount++; return true; }, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => properties.set(key, value),
      setProperties: values => Object.entries(values).forEach(([key, value]) => properties.set(key, value)),
      deleteProperty: key => properties.delete(key),
      getProperties: () => Object.fromEntries(properties)
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_a, value) => Array.from(require("crypto").createHash("sha256").update(String(value)).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url"),
      getUuid: () => "00000000-0000-4000-8000-000000000001"
    },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    UrlFetchApp: {
      fetch: (url, options) => {
        if (String(url).indexOf("https://graph.facebook.com") === 0) {
          capiCalls.push({ url, body: JSON.parse(options.payload) });
          if (capiThrows) throw new Error("network down");
          return { getResponseCode: () => capiStatus };
        }
        return { getResponseCode: () => 401, getContentText: () => "{}" };
      }
    }
  });
  const code = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
  vm.runInContext(`${code}\nthis.__api = { saveLead, updateLeadStatus, submitOrder, OrderError };`, context);
  return { api: context.__api, rows, capiCalls, getLockCount: () => lockCount };
}

function leadPayload(overrides = {}) {
  return {
    leadId: "lead-test-0000000000001",
    customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Street 2, Sector A", city: "Lahore", postal: "54000", notes: "" },
    items: [{ productId: "veg-01", quantity: 2 }],
    fbp: "fb.1.111.222", fbc: "", userAgent: "TestAgent/1.0", pageUrl: "https://www.hojaseeds.pk/delivery",
    ...overrides
  };
}

(function validConfirmDeliveryCreatesOneLead() {
  const { api, rows } = createBackend();
  const result = api.saveLead(leadPayload());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.isNew, true);
  assert.strictEqual(rows.Leads.length, 2, "header + exactly one lead row"); // PAY-LEAD-A
})();

(function duplicateConfirmReusesSameLead() {
  const { api, rows } = createBackend();
  api.saveLead(leadPayload());
  const second = api.saveLead(leadPayload({ customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Street 2, Sector A, Updated", city: "Lahore", postal: "54000", notes: "" } }));
  assert.strictEqual(second.isNew, false, "PAY-LEAD-B: duplicate Confirm Delivery updates, does not duplicate");
  assert.strictEqual(rows.Leads.length, 2, "still exactly one lead row");
})();

(function invalidPhoneCreatesNoLead() {
  const { api, rows } = createBackend();
  assert.throws(() => api.saveLead(leadPayload({ customer: { name: "Ali Khan", phone: "12345", address: "House 1, Street 2, Sector A", city: "Lahore", postal: "", notes: "" } })), /OrderError|INVALID_PHONE/);
  assert.strictEqual(rows.Leads, undefined, "PAY-LEAD-C: no Lead row/sheet created on validation failure");
})();

(function leadPixelAndCapiShareSameEventId() {
  const { api, capiCalls } = createBackend();
  api.saveLead(leadPayload());
  assert.strictEqual(capiCalls.length, 1);
  assert.strictEqual(capiCalls[0].body.data[0].event_id, "LEAD-lead-test-0000000000001", "PAY-LEAD-D: CAPI event_id matches the LEAD-<leadId> convention the Pixel call must also use");
  assert.strictEqual(capiCalls[0].body.data[0].event_name, "Lead");
})();

(function capiTokenAbsentCheckoutStillWorks() {
  const { api, rows, capiCalls } = createBackend({ capiToken: null });
  const result = api.saveLead(leadPayload());
  assert.strictEqual(result.ok, true, "PAY-LEAD-E: lead save succeeds with no CAPI token configured");
  assert.strictEqual(rows.Leads.length, 2);
  assert.strictEqual(capiCalls.length, 0, "no CAPI call attempted without a token");
})();

(function capiFailureDoesNotFailLeadSave() {
  const { api, rows } = createBackend({ capiThrows: true });
  const result = api.saveLead(leadPayload());
  assert.strictEqual(result.ok, true, "PAY-LEAD-F: CAPI network failure never fails the lead save");
  assert.strictEqual(rows.Leads.length, 2);
})();

(function noPiiInCapiCustomData() {
  const { capiCalls, api } = createBackend();
  api.saveLead(leadPayload());
  const custom = JSON.stringify(capiCalls[0].body.data[0].custom_data).toLowerCase();
  ["ali khan", "house 1", "03001234567"].forEach(pii => assert.ok(!custom.includes(pii), "PII must never appear in CAPI custom_data: " + pii));
  const userData = capiCalls[0].body.data[0].user_data;
  assert.ok(userData.ph[0].length === 64, "phone is SHA-256 hashed (64 hex chars), not sent in the clear");
})();

(function abandonReasonSaves() {
  const { api, rows } = createBackend();
  api.saveLead(leadPayload());
  const result = api.updateLeadStatus({ leadId: "lead-test-0000000000001", status: "COD_REQUESTED", abandonReason: "Prefer Cash on Delivery" });
  assert.strictEqual(result.updated, true);
  const headers = rows.Leads[0];
  const row = rows.Leads[1];
  assert.strictEqual(row[headers.indexOf("status")], "COD_REQUESTED");
  assert.strictEqual(row[headers.indexOf("abandonReason")], "Prefer Cash on Delivery");
})();

(function updateLeadStatusUnknownLeadDoesNotBlock() {
  const { api } = createBackend();
  const result = api.updateLeadStatus({ leadId: "lead-does-not-exist-0000", status: "PAYMENT_ABANDONED" });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.updated, false, "PAY-LEAD-G: unknown leadId never throws / never blocks navigation");
})();

(function orderConvertsLeadAndFiresCapiPurchaseWithFullTotal() {
  for (const scenario of [
    { paymentMethod: "Cash on Delivery", items: [{ productId: "mix-01", quantity: 1 }] },
    { paymentMethod: "Advance Payment", items: [{ productId: "veg-01", quantity: 1 }], payment: { advanceMethod: "JazzCash", transactionReference: "TXN1" } }
  ]) {
    const { api, rows, capiCalls } = createBackend();
    api.saveLead(leadPayload({ leadId: "lead-conv-0000000000001", items: scenario.items }));
    const orderResult = api.submitOrder({
      idempotencyKey: "idem-" + scenario.paymentMethod.replace(/\s/g, "") + "-000000000001",
      leadId: "lead-conv-0000000000001",
      customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Street 2, Sector A", city: "Lahore", postal: "", notes: "" },
      payment: { method: scenario.paymentMethod, ...(scenario.payment || {}) },
      items: scenario.items,
      fbp: "fb.1.1.1", fbc: "", userAgent: "TestAgent/1.0", pageUrl: "https://www.hojaseeds.pk/payment"
    });
    assert.strictEqual(orderResult.ok, true, JSON.stringify(orderResult));
    const headers = rows.Leads[0];
    const row = rows.Leads[1];
    assert.strictEqual(row[headers.indexOf("status")], "ORDER_CONVERTED", "PAY-LEAD-H: Lead -> converted Order linkage");
    assert.strictEqual(row[headers.indexOf("convertedOrderId")], orderResult.orderId);
    const purchaseCall = capiCalls.find(c => c.body.data[0].event_name === "Purchase");
    assert.ok(purchaseCall, "CAPI Purchase fired");
    assert.strictEqual(purchaseCall.body.data[0].event_id, "ORDER-" + orderResult.orderId);
    assert.strictEqual(purchaseCall.body.data[0].custom_data.value, orderResult.total, `${scenario.paymentMethod}: CAPI Purchase value = full order total, not payNow`);
  }
})();

(function duplicateOrderRetryFiresCapiPurchaseOnlyOnce() {
  const { api, capiCalls } = createBackend();
  const request = {
    idempotencyKey: "idem-retry-0000000000001",
    customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Street 2, Sector A", city: "Lahore", postal: "", notes: "" },
    payment: { method: "Cash on Delivery" },
    items: [{ productId: "mix-01", quantity: 1 }]
  };
  const first = api.submitOrder(request);
  const second = api.submitOrder(request); // exact same request -> idempotent early return
  assert.strictEqual(first.orderId, second.orderId);
  const purchaseCalls = capiCalls.filter(c => c.body.data[0].event_name === "Purchase");
  assert.strictEqual(purchaseCalls.length, 1, "PAY-LEAD-I: duplicate order retry fires CAPI Purchase exactly once");
})();

(function failedOrderNeverFiresCapiPurchase() {
  const { api, capiCalls } = createBackend();
  assert.throws(() => api.submitOrder({
    idempotencyKey: "idem-badphone-0000000001",
    customer: { name: "Ali Khan", phone: "123", address: "House 1, Street 2, Sector A", city: "Lahore", postal: "", notes: "" },
    payment: { method: "Cash on Delivery" },
    items: [{ productId: "mix-01", quantity: 1 }]
  }));
  assert.strictEqual(capiCalls.filter(c => c.body.data[0].event_name === "Purchase").length, 0, "PAY-LEAD-J: a failed/rejected order never fires CAPI Purchase");
})();

console.log("PASS: checkout leads and Meta CAPI tests");
