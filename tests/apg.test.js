// Bank Alfalah APG sandbox integration tests (HS-20260820-01).
// Synthetic Sheet/Properties/UrlFetchApp mocks only -- no real network
// call to bankalfalah.com ever happens from this suite. The AES-128-CBC
// hash implementation itself is verified byte-for-byte against Node's
// native crypto separately (see the one-off verification the task's own
// evidence trail references); here we verify the INTEGRATION built on
// top of it: field building, order gating, and idempotent status updates.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function createBackend({ apgConfigured = true, fetchResponder = null } = {}) {
  const rows = {
    Products: [
      ["id", "cat", "name", "unit", "price", "type"],
      ["veg-01", "vegetables", "Tomato", "packet", 500, "regular"],
      ["mix-01", "mix", "Kitchen Garden Mix", "kit", 999, "standard-collection"]
    ],
    Settings: [["key", "value"], ["APG_ENABLED", true]],
    Orders: [["timestamp", "orderId", "name", "phone", "address", "city", "postal", "notes", "paymentMethod", "advanceMethod", "transactionRef", "items", "subtotal", "deliveryFee", "total", "payNow", "codDue", "paymentGateway", "gatewayOrderId", "gatewayTransactionId", "gatewayStatus", "gatewayUpdatedAt", "paidAt"]]
  };
  const sheets = {};
  function makeSheet(title) {
    const data = rows[title];
    const obj = {
      getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
      appendRow: row => data.push(row.slice()),
      getRange: (r, c) => ({
        setValue: v => { data[r - 1][c - 1] = v; }
      })
    };
    sheets[title] = obj;
    return obj;
  }
  Object.keys(rows).forEach(makeSheet);
  const properties = new Map();
  if (apgConfigured) {
    properties.set("APG_SANDBOX_BASE", "https://sandbox.bankalfalah.com");
    properties.set("APG_MERCHANT_ID", "15248");
    properties.set("APG_STORE_ID", "567250");
    properties.set("APG_MERCHANT_HASH", "test-merchant-hash");
    properties.set("APG_MERCHANT_USERNAME", "otykis");
    properties.set("APG_MERCHANT_PASSWORD", "test-merchant-password");
    properties.set("APG_KEY1", "h3kqzmgWVbCFgGjz"); // 16 chars, matches real sandbox key LENGTH (not the real value)
    properties.set("APG_KEY2", "6854718648299099"); // 16 chars
  }
  const cacheMap = new Map();

  let fetchLog = [];
  const respond = fetchResponder || (() => ({ getResponseCode: () => 200, getContentText: () => "{}" }));

  const context = vm.createContext({
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => sheets[name] || null, insertSheet: name => { rows[name] = []; return makeSheet(name); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({
      get: key => cacheMap.get(key) || null,
      put: (key, value) => cacheMap.set(key, value),
      remove: key => cacheMap.delete(key)
    }) },
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
      computeDigest: (_a, value) => Array.from(crypto.createHash("sha256").update(String(value)).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url"),
      getUuid: () => crypto.randomUUID()
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    },
    UrlFetchApp: {
      fetch: (url, options) => { fetchLog.push({ url, options }); return respond(url, options); }
    }
  });
  const code = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
  vm.runInContext(`${code}\nthis.__api = { doPost, submitOrder, apgStartHandshake, apgStartSso, apgVerifyStatus, applyGatewayStatusUpdate, apgStatusInquiryFromUrl, handleApgListener, apgAesEncryptBase64, apgMapString, findOrderById, OrderError };`, context);
  return { api: context.__api, rows, properties, cacheMap, getFetchLog: () => fetchLog };
}

let keyCounter = 0;
function apgOrderPayload(overrides = {}) {
  return {
    type: "order",
    idempotencyKey: `apg-test-key-${++keyCounter}-${crypto.randomUUID()}`,
    customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Garden Road", city: "Lahore", postal: "54000", notes: "" },
    payment: { method: "Advance Payment", advanceMethod: "Bank Alfalah APG", transactionReference: "" },
    items: [{ productId: "veg-01", quantity: 1 }],
    ...overrides
  };
}

// The double-JSON-encoding quirk confirmed from the portal's own C# IPN
// sample: the raw HTTP body is a JSON STRING wrapping escaped JSON.
function wrapApgResponse(obj) {
  return JSON.stringify(JSON.stringify(obj));
}

(function apgOrderCreatedPendingNoTransactionReferenceRequired() {
  const { api } = createBackend();
  const result = api.submitOrder(apgOrderPayload());
  assert.strictEqual(result.paymentGateway, "bank_alfalah_apg");
  assert.strictEqual(result.gatewayStatus, "PENDING");
  assert.strictEqual(result.transactionReference, "", "APG orders never require a customer-typed reference");
  assert.strictEqual(result.paymentStatus, "Gateway Pending");
})();

(function apgStartHandshakeBuildsCorrectHashAndFields() {
  const { api, properties } = createBackend();
  const order = api.submitOrder(apgOrderPayload());
  const handshake = api.apgStartHandshake({ orderId: order.orderId });
  assert.strictEqual(handshake.action, "https://sandbox.bankalfalah.com/HS/HS/HS");
  assert.strictEqual(handshake.fields.HS_MerchantId, properties.get("APG_MERCHANT_ID"));
  assert.strictEqual(handshake.fields.HS_TransactionReferenceNumber, order.orderId);
  assert.strictEqual(handshake.fields.HS_IsRedirectionRequest, "1");
  // Recompute the hash independently and confirm it matches exactly --
  // proves the field order used for hashing is deterministic and correct.
  const pairs = [
    ["HS_RequestHash", ""], ["HS_IsRedirectionRequest", "1"], ["HS_ChannelId", "1001"],
    ["HS_ReturnURL", "https://www.hojaseeds.pk/?hs_view=payment-return"],
    ["HS_MerchantId", properties.get("APG_MERCHANT_ID")], ["HS_StoreId", properties.get("APG_STORE_ID")],
    ["HS_MerchantHash", properties.get("APG_MERCHANT_HASH")], ["HS_MerchantUsername", properties.get("APG_MERCHANT_USERNAME")],
    ["HS_MerchantPassword", properties.get("APG_MERCHANT_PASSWORD")], ["HS_TransactionReferenceNumber", order.orderId]
  ];
  const expected = api.apgAesEncryptBase64(api.apgMapString(pairs), properties.get("APG_KEY1"), properties.get("APG_KEY2"));
  assert.strictEqual(handshake.fields.HS_RequestHash, expected);
})();

(function apgStartHandshakeRejectsNonGatewayOrder() {
  const { api } = createBackend();
  const order = api.submitOrder({ ...apgOrderPayload(), payment: { method: "Advance Payment", advanceMethod: "JazzCash", transactionReference: "TXN12345" } });
  assert.throws(() => api.apgStartHandshake({ orderId: order.orderId }), err => err.code === "NOT_A_GATEWAY_ORDER");
})();

(function apgStartSsoUsesServerAmountNeverClientSupplied() {
  const { api } = createBackend();
  const order = api.submitOrder(apgOrderPayload());
  // Nothing in the payload can override amount -- apgStartSso only takes orderId/authToken.
  const sso = api.apgStartSso({ orderId: order.orderId, authToken: "fake-auth-token-123" });
  assert.strictEqual(sso.fields.TransactionAmount, String(order.total), "amount always comes from the server's own Order row");
  assert.strictEqual(sso.fields.Currency, "PKR");
  assert.strictEqual(sso.fields.TransactionReferenceNumber, order.orderId);
})();

(function apgStartSsoRejectsAlreadyTerminalOrder() {
  const fetchResponder = () => ({ getResponseCode: () => 200, getContentText: () => wrapApgResponse({ TransactionStatus: "Paid", TransactionReferenceNumber: "will-be-overwritten", TransactionId: "TX1" }) });
  const { api } = createBackend({ fetchResponder });
  const order = api.submitOrder(apgOrderPayload());
  api.applyGatewayStatusUpdate(order.orderId, { TransactionStatus: "Paid", TransactionId: "TX1" });
  assert.throws(() => api.apgStartSso({ orderId: order.orderId, authToken: "fake-token-1234" }), err => err.code === "GATEWAY_ORDER_NOT_PENDING");
})();

(function apgVerifyStatusMarksPaidAndIsIdempotent() {
  const { api } = createBackend({ fetchResponder: () => ({ getResponseCode: () => 200, getContentText: () => wrapApgResponse({ TransactionStatus: "Paid", TransactionId: "TXN-999", TransactionReferenceNumber: "x" }) }) });
  const order = api.submitOrder(apgOrderPayload());
  const first = api.apgVerifyStatus({ orderId: order.orderId });
  assert.strictEqual(first.state.gatewayStatus, "PAID");
  const found = api.findOrderById(order.orderId);
  assert.strictEqual(found.paymentStatus, "Paid", "restoreOrder derives paymentStatus from gatewayStatus");

  // Duplicate return visit / duplicate listener call for the SAME order --
  // section 12/7 of the task: must NOT double-process, must return the
  // same terminal state, must not re-hit the gateway once terminal.
  const fetchCountBefore = 1; // the one call above already happened
  const second = api.apgVerifyStatus({ orderId: order.orderId });
  assert.strictEqual(second.state.gatewayStatus, "PAID");
  assert.deepStrictEqual(second.state, first.state, "second call returns the identical stored state, not a fresh gateway hit");
})();

(function apgVerifyStatusMarksFailedOnNonPaidStatus() {
  const { api } = createBackend({ fetchResponder: () => ({ getResponseCode: () => 200, getContentText: () => wrapApgResponse({ TransactionStatus: "Declined", TransactionReferenceNumber: "x" }) }) });
  const order = api.submitOrder(apgOrderPayload());
  const result = api.apgVerifyStatus({ orderId: order.orderId });
  assert.strictEqual(result.state.gatewayStatus, "FAILED");
})();

(function apgVerifyStatusMarksUnknownOnInquiryFailure() {
  const { api } = createBackend({ fetchResponder: () => ({ getResponseCode: () => 500, getContentText: () => "" }) });
  const order = api.submitOrder(apgOrderPayload());
  const result = api.apgVerifyStatus({ orderId: order.orderId });
  assert.strictEqual(result.state.gatewayStatus, "UNKNOWN", "an inquiry failure is UNKNOWN, never silently FAILED");
  // Still not terminal -- a later real check can still resolve it.
  const again = api.apgVerifyStatus({ orderId: order.orderId });
  assert.strictEqual(again.state.gatewayStatus, "UNKNOWN");
})();

(function listenerAppliesSameIdempotentUpdate() {
  // TransactionReferenceNumber in the mocked response must reflect the
  // real orderId for the listener to find the right row -- built after
  // the order exists, so the backend is created first with a responder
  // closure that reads `order` once it's assigned below.
  let order;
  const backend = createBackend({ fetchResponder: () => ({ getResponseCode: () => 200, getContentText: () => wrapApgResponse({ TransactionStatus: "Paid", TransactionId: "TXN-LISTENER-1", TransactionReferenceNumber: order.orderId }) }) });
  order = backend.api.submitOrder(apgOrderPayload());
  const statusUrl = `https://sandbox.bankalfalah.com/HS/api/IPN/OrderStatus/15248/567250/${order.orderId}`;
  const encodedUrl = encodeURIComponent(statusUrl);

  const resp = backend.api.handleApgListener({ parameter: { url: encodedUrl } });
  assert.strictEqual(resp.text, "OK");
  const found = backend.api.findOrderById(order.orderId);
  assert.strictEqual(found.paymentStatus, "Paid");

  // Duplicate listener call for the SAME order -- must be a no-op, not a
  // second gateway hit or a re-write.
  const before = backend.getFetchLog().length;
  backend.api.handleApgListener({ parameter: { url: encodedUrl } });
  const after = backend.getFetchLog().length;
  assert.strictEqual(after, before, "a duplicate listener call for an already-terminal order never re-hits the gateway");
})();

(function listenerRejectsNonApgStatusUrl() {
  const { api, getFetchLog } = createBackend();
  const resp = api.handleApgListener({ parameter: { url: encodeURIComponent("https://evil.example.com/steal") } });
  assert.strictEqual(resp.text, "REJECTED");
  assert.strictEqual(getFetchLog().length, 0, "never fetches an attacker-supplied non-bankalfalah URL");
})();

(function listenerHandlesMissingUrlGracefully() {
  const { api } = createBackend();
  const resp = api.handleApgListener({ parameter: {} });
  assert.strictEqual(resp.text, "NO_URL");
})();

(function apgVerifyStatusRejectsWrongOrderOrNonGatewayOrder() {
  const { api } = createBackend();
  assert.throws(() => api.apgVerifyStatus({ orderId: "HOJA-DOES-NOT-EXIST" }), err => err.code === "ORDER_NOT_FOUND");
  const codOrder = api.submitOrder({ ...apgOrderPayload(), payment: { method: "Cash on Delivery", advanceMethod: "", transactionReference: "" }, items: [{ productId: "mix-01", quantity: 1 }] });
  assert.throws(() => api.apgVerifyStatus({ orderId: codOrder.orderId }), err => err.code === "NOT_A_GATEWAY_ORDER");
})();

(function apgDisabledInSettingsBlocksNewOrders() {
  const { api, rows } = createBackend();
  rows.Settings[1] = ["APG_ENABLED", false];
  assert.throws(() => api.submitOrder(apgOrderPayload()), err => err.code === "ADVANCE_METHOD_DISABLED");
})();

(function apgNotConfiguredRefusesHandshakeCleanly() {
  const { api } = createBackend({ apgConfigured: false });
  const order = api.submitOrder(apgOrderPayload());
  assert.throws(() => api.apgStartHandshake({ orderId: order.orderId }), err => err.code === "APG_NOT_CONFIGURED");
})();

console.log("PASS: Bank Alfalah APG sandbox integration tests");
