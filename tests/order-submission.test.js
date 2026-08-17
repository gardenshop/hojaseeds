const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function createBackend(products, settings, auth = {}) {
  const rows = {
    Products: [Object.keys(products[0]), ...products.map(Object.values)],
    Settings: [["key", "value"], ...Object.entries(settings)],
    Orders: [["timestamp", "orderId", "name", "phone", "address", "city", "postal", "notes", "paymentMethod", "advanceMethod", "transactionRef", "items", "subtotal", "deliveryFee", "total", "payNow", "codDue"]],
    Contact: [["timestamp", "name", "phone", "message"]]
  };
  const properties = new Map();
  if (auth.clientId) properties.set("HOJA_GOOGLE_CLIENT_ID", auth.clientId);
  if (auth.emails) properties.set("HOJA_ADMIN_EMAILS", auth.emails);
  let uuidCounter = 0;
  let lockCount = 0;
  const sheets = Object.fromEntries(Object.entries(rows).map(([name, data]) => [name, {
    getDataRange: () => ({ getValues: () => data.map(row => row.slice()) }),
    appendRow: row => data.push(row.slice()),
    getRange: () => ({ setValue: () => {} })
  }]));
  const context = vm.createContext({
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => sheets[name] || null }) },
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
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash("sha256").update(value).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url"),
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    },
    UrlFetchApp: {
      fetch: (_url, options) => {
        if (options?.muteHttpExceptions && options.idToken === "") return { getResponseCode: () => 401, getContentText: () => "{}" };
        return { getResponseCode: () => auth.token === "authorized-token" ? 200 : 401, getContentText: () => JSON.stringify({ aud: auth.clientId, exp: Math.floor(Date.now() / 1000) + 3600, email: "admin@hojaseeds.pk", email_verified: "true" }) };
      }
    }
  });
  const code = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
  vm.runInContext(`${code}\nthis.__api = { doPost, submitOrder, buildAuthoritativeOrder, safeSheetText };`, context);
  return { api: context.__api, rows, properties, getLockCount: () => lockCount };
}

function products() {
  return [
    { id: "regular-500", name: "Regular 500", cat: "vegetables", unit: "packet", icon: "", price: 500, type: "regular", active: true, stock_quantity: 20 },
    { id: "regular-1000", name: "Regular 1000", cat: "vegetables", unit: "packet", icon: "", price: 1000, type: "regular", active: true, stock_quantity: 20 },
    { id: "regular-1500", name: "Regular 1500", cat: "vegetables", unit: "packet", icon: "", price: 1500, type: "regular", active: true, stock_quantity: 20 },
    { id: "flower-300", name: "Flower 300", cat: "flowers", unit: "packet", icon: "", price: 300, type: "regular", active: true, stock_quantity: 20 },
    { id: "regular-333", name: "Regular 333 (odd price, for split-rounding tests)", cat: "vegetables", unit: "packet", icon: "", price: 333, type: "regular", active: true, stock_quantity: 20 },
    { id: "mixpack-500", name: "Mix Pack 8", cat: "mix", unit: "kit", icon: "", price: 500, type: "standard-collection", active: true, stock_quantity: 20 },
    { id: "fert-500", name: "Fertilizer 500", cat: "fertilizer", unit: "bag", icon: "", price: 500, type: "regular", active: true, stock_quantity: 20 },
    { id: "custom-2000", name: "Custom Collection", cat: "mix", unit: "kit", icon: "", price: 2000, type: "customized-collection", active: true, stock_quantity: 20 }
  ];
}

const rules = {
  FREE_DELIVERY_THRESHOLD: 1500,
  ADVANCE_DELIVERY_FEE: 100,
  COD_DELIVERY_FEE: 250,
  COD_ALLOWED: true,
  CUSTOMIZED_REQUIRES_FULL_ADVANCE: true
};

let keyCounter = 0;
function order(overrides = {}) {
  const base = {
    type: "order",
    idempotencyKey: `test-idempotency-key-${++keyCounter}`,
    customer: {
      name: "Ali Khan",
      phone: "03001234567",
      address: "House 1, Garden Road",
      city: "Lahore",
      postal: "54000",
      notes: ""
    },
    payment: { method: "Cash on Delivery", advanceMethod: "", transactionReference: "" },
    // Default item is a Fertilizer product (payment_policy "existing" —
    // preserves the pre-HS-04 storewide COD behavior) so every pre-existing
    // generic assertion below keeps its original meaning unchanged; the new
    // cart-payment-policy tests below use "regular-500"/"flower-300"/
    // "mixpack-500"/"custom-2000" explicitly.
    items: [{ productId: "fert-500", quantity: 1 }]
  };
  return Object.assign(base, overrides);
}

function advance(productId, quantity = 1) {
  return order({
    payment: { method: "Advance Payment", advanceMethod: "JazzCash", transactionReference: "TXN123456" },
    items: [{ productId, quantity }]
  });
}

function split(productId, quantity = 1) {
  return order({
    payment: { method: "Split Payment", advanceMethod: "JazzCash", transactionReference: "TXN123456" },
    items: [{ productId, quantity }]
  });
}

async function backendTests() {
  {
    const anonymous = createBackend(products(), rules);
    const priceUpdate = anonymous.api.doPost({ postData: { contents: JSON.stringify({ type: "priceUpdate", updates: [] }) } });
    const settingsUpdate = anonymous.api.doPost({ postData: { contents: JSON.stringify({ type: "settingsUpdate", rules: {} }) } });
    assert.equal(JSON.parse(priceUpdate.text).error.code, "ADMIN_UNAUTHORIZED", "anonymous price update rejected");
    assert.equal(JSON.parse(settingsUpdate.text).error.code, "ADMIN_UNAUTHORIZED", "anonymous settings update rejected");
  }
  {
    const authorized = createBackend(products(), rules, { clientId: "hoja-client-id", emails: "admin@hojaseeds.pk", token: "authorized-token" });
    const response = authorized.api.doPost({ postData: { contents: JSON.stringify({ type: "priceUpdate", authToken: "authorized-token", updates: [{ id: "regular-500", price: 550 }] }) } });
    assert.equal(JSON.parse(response.text).ok, true, "authorized admin update accepted");
    const invalidType = authorized.api.doPost({ postData: { contents: JSON.stringify({ type: "priceUpdate", authToken: "authorized-token", updates: [{ id: "regular-500", type: "unexpected" }] }) } });
    assert.equal(JSON.parse(invalidType.text).error.code, "INVALID_ADMIN_UPDATE", "invalid product type rejected");
    const settingsResponse = authorized.api.doPost({ postData: { contents: JSON.stringify({ type: "settingsUpdate", authToken: "authorized-token", rules: { COD_ALLOWED: true } }) } });
    assert.equal(JSON.parse(settingsResponse.text).ok, true, "authorized settings update accepted");
  }
  {
    const backend = createBackend(products(), rules);
    const contact = backend.api.doPost({ postData: { contents: JSON.stringify({ type: "contact", name: "Ali", phone: "03001234567", message: "Hello" }) } });
    assert.equal(JSON.parse(contact.text).ok, true, "public contact submission remains usable");
    const unsafeContact = backend.api.doPost({ postData: { contents: JSON.stringify({ type: "contact", name: "Ali", phone: "03001234567", message: "=IMPORTXML()" }) } });
    assert.equal(JSON.parse(unsafeContact.text).ok, true, "contact formula input is safely stored");
  }
  {
    const { api } = createBackend(products(), rules);
    const result = api.submitOrder(order());
    assert.equal(result.subtotal, 500, "A: COD subtotal");
    assert.equal(result.deliveryFee, 250, "A: COD fee");
    assert.equal(result.total, 750, "A: COD total");
    assert.equal(result.paymentStatus, "COD Due", "A: COD status");
  }
  {
    const { api } = createBackend(products(), rules);
    const result = api.submitOrder(advance("regular-1000"));
    assert.equal(result.deliveryFee, 100, "B: advance below threshold");
    assert.equal(result.total, 1100, "B: advance total");
    assert.equal(result.paymentStatus, "Payment Verification", "B: advance status");
  }
  {
    const { api } = createBackend(products(), rules);
    assert.equal(api.submitOrder(advance("regular-1500")).deliveryFee, 0, "C: exact threshold is free");
    assert.equal(api.submitOrder(advance("regular-1000", 2)).deliveryFee, 0, "D: above threshold is free");
  }
  {
    const { api } = createBackend(products(), rules);
    assert.throws(() => api.submitOrder(order({ items: [{ productId: "custom-2000", quantity: 1 }] })), error => error.code === "CUSTOMIZED_REQUIRES_ADVANCE", "E: customized COD rejected");
    const disabledRule = Object.assign({}, rules, { CUSTOMIZED_REQUIRES_FULL_ADVANCE: false });
    const disabledBackend = createBackend(products(), disabledRule);
    assert.throws(() => disabledBackend.api.submitOrder(order({ items: [{ productId: "custom-2000", quantity: 1 }] })), error => error.code === "CUSTOMIZED_REQUIRES_ADVANCE", "E: customized COD remains rejected when legacy setting is false");
  }
  {
    const { api } = createBackend(products(), rules);
    const tampered = order({ subtotal: 1, deliveryFee: 0, total: 1, items: [{ productId: "fert-500", quantity: 1, price: 1 }] });
    const result = api.submitOrder(tampered);
    assert.equal(result.subtotal, 500, "F: tampered price ignored");
    assert.equal(result.deliveryFee, 250, "G: tampered delivery ignored");
    assert.equal(result.total, 750, "H: tampered total ignored");
  }
  {
    const { api } = createBackend(products(), rules);
    assert.throws(() => api.submitOrder(order({ items: [{ productId: "missing", quantity: 1 }] })), error => error.code === "INVALID_PRODUCT", "I: invalid product rejected");
    assert.throws(() => api.submitOrder(order({ items: [{ productId: "regular-500", quantity: 0 }] })), error => error.code === "INVALID_QUANTITY", "J: zero rejected");
    assert.throws(() => api.submitOrder(order({ items: [{ productId: "regular-500", quantity: -1 }] })), error => error.code === "INVALID_QUANTITY", "J: negative rejected");
  }
  {
    const backend = createBackend(products(), rules);
    const payload = order();
    const first = backend.api.submitOrder(payload);
    const second = backend.api.submitOrder(JSON.parse(JSON.stringify(payload)));
    assert.equal(first.orderId, second.orderId, "K: duplicate returns original order");
    assert.equal(backend.rows.Orders.length, 2, "K: duplicate creates one data row");
    assert.equal(backend.getLockCount(), 2, "K: submissions use the script lock");
    assert.match(first.orderId, /^HOJA-/, "N: server-generated order ID");
    assert.deepEqual([first.subtotal, first.deliveryFee, first.total], [500, 250, 750], "N: authoritative totals returned");
    backend.properties.clear();
    const recovered = backend.api.submitOrder(JSON.parse(JSON.stringify(payload)));
    assert.equal(recovered.orderId, first.orderId, "K: duplicate recovers from Orders row if properties are lost");
    assert.equal(backend.rows.Orders.length, 2, "K: recovery does not append a duplicate");
    const changedAfterPropertyLoss = JSON.parse(JSON.stringify(payload));
    changedAfterPropertyLoss.items[0].quantity = 2;
    assert.throws(() => backend.api.submitOrder(changedAfterPropertyLoss), error => error.code === "IDEMPOTENCY_CONFLICT", "K: Orders-row recovery still detects changed payload");
  }
  {
    const backend = createBackend(products(), rules);
    const payload = order();
    backend.api.submitOrder(payload);
    payload.items[0].quantity = 2;
    assert.throws(() => backend.api.submitOrder(payload), error => error.code === "IDEMPOTENCY_CONFLICT", "K: changed request cannot reuse key");
    assert.equal(backend.api.safeSheetText("=IMPORTXML()"), "'=IMPORTXML()", "input safety: formula neutralized");
  }
  {
    const backend = createBackend(products(), rules);
    const invalidPhone = order();
    invalidPhone.customer.phone = "123";
    assert.throws(() => backend.api.submitOrder(invalidPhone), error => error.code === "INVALID_PHONE", "input safety: Pakistan mobile validated");
    assert.throws(() => backend.api.submitOrder(order({ items: [{ productId: "regular-500", quantity: 21 }] })), error => error.code === "INSUFFICIENT_STOCK", "availability: optional stock enforced");
  }
  {
    const backend = createBackend(products(), rules);
    const response = backend.api.doPost({ postData: { contents: JSON.stringify(order()) } });
    const result = JSON.parse(response.text);
    assert.equal(result.ok, true, "reliable response: doPost returns readable success JSON");
    const rejected = backend.api.doPost({ postData: { contents: JSON.stringify(order({ items: [{ productId: "missing", quantity: 1 }] })) } });
    assert.equal(JSON.parse(rejected.text).ok, false, "reliable response: doPost returns readable rejection JSON");
  }

  // ── Cart-based payment-policy matrix (HS-20260817-04) ──────────────────
  {
    // PAY-A: Mix Pack only -> 100% COD allowed
    const { api } = createBackend(products(), rules);
    const result = api.submitOrder(order({ items: [{ productId: "mixpack-500", quantity: 1 }] }));
    assert.equal(result.paymentMethod, "Cash on Delivery", "PAY-A: Mix Pack COD accepted");
    assert.equal(result.payNow, 0, "PAY-A: pay now is 0 for COD");
    assert.equal(result.codDue, result.total, "PAY-A: full total due on delivery");
  }
  {
    // PAY-B: custom vegetable only -> full COD rejected; Advance/Split allowed
    const { api } = createBackend(products(), rules);
    assert.throws(
      () => api.submitOrder(order({ items: [{ productId: "regular-500", quantity: 1 }] })),
      error => error.code === "CUSTOM_SELECTION_REQUIRES_ADVANCE",
      "PAY-B: custom vegetable COD rejected"
    );
    assert.equal(api.submitOrder(advance("regular-500")).paymentMethod, "Advance Payment", "PAY-B: advance accepted");
    assert.equal(api.submitOrder(split("regular-500")).paymentMethod, "Split Payment", "PAY-B: split accepted");
  }
  {
    // PAY-C: flower custom selection -> same rule as vegetables
    const { api } = createBackend(products(), rules);
    assert.throws(
      () => api.submitOrder(order({ items: [{ productId: "flower-300", quantity: 1 }] })),
      error => error.code === "CUSTOM_SELECTION_REQUIRES_ADVANCE",
      "PAY-C: custom flower COD rejected"
    );
    assert.equal(api.submitOrder(advance("flower-300")).paymentMethod, "Advance Payment", "PAY-C: advance accepted");
  }
  {
    // PAY-D: Mix Pack + vegetable (mixed cart) -> no full COD; Advance/Split allowed
    const { api } = createBackend(products(), rules);
    const mixedItems = [{ productId: "mixpack-500", quantity: 1 }, { productId: "regular-500", quantity: 1 }];
    assert.throws(
      () => api.submitOrder(order({ items: mixedItems })),
      error => error.code === "CUSTOM_SELECTION_REQUIRES_ADVANCE",
      "PAY-D: mixed cart COD rejected (custom-selection rule wins)"
    );
    const splitResult = api.submitOrder(order({
      payment: { method: "Split Payment", advanceMethod: "JazzCash", transactionReference: "TXN123456" },
      items: mixedItems
    }));
    assert.equal(splitResult.paymentMethod, "Split Payment", "PAY-D: split accepted for mixed cart");
    assert.equal(splitResult.subtotal, 1000, "PAY-D: mixed cart subtotal (Mix Pack 500 + vegetable 500)");
  }
  {
    // PAY-E: tampered custom-cart COD POST -> server reject via the public doPost entrypoint
    const backend = createBackend(products(), rules);
    const response = backend.api.doPost({ postData: { contents: JSON.stringify(order({ items: [{ productId: "regular-500", quantity: 1 }] })) } });
    const result = JSON.parse(response.text);
    assert.equal(result.ok, false, "PAY-E: tampered custom+COD rejected at doPost");
    assert.equal(result.error.code, "CUSTOM_SELECTION_REQUIRES_ADVANCE", "PAY-E: rejection reason surfaced");
  }
  {
    // PAY-F: split calculation, even total (subtotal 1000 + advance-tier COD fee 250 = 1250 total... use exact even case)
    const { api } = createBackend(products(), rules);
    const result = api.submitOrder(split("regular-1000")); // 1000 + COD_DELIVERY_FEE(250) = 1250 total (even)
    assert.equal(result.total, 1250, "PAY-F: even total computed");
    assert.equal(result.payNow, 625, "PAY-F: even split pay-now");
    assert.equal(result.codDue, 625, "PAY-F: even split cod-due");
    assert.equal(result.payNow + result.codDue, result.total, "PAY-F: split halves reconstitute total exactly");
  }
  {
    // PAY-G: split calculation, odd total — pay-now rounds up, cod-due absorbs remainder
    const { api } = createBackend(products(), rules);
    const result = api.submitOrder(split("regular-333")); // 333 + COD_DELIVERY_FEE(250) = 583 (odd)
    assert.equal(result.total, 583, "PAY-G: odd total computed");
    assert.equal(result.payNow, 292, "PAY-G: odd split pay-now rounds up (ceil 583/2)");
    assert.equal(result.codDue, 291, "PAY-G: odd split cod-due absorbs the remainder");
    assert.equal(result.payNow + result.codDue, result.total, "PAY-G: split halves reconstitute total exactly");
    assert.ok(result.payNow >= result.codDue, "PAY-G: pay-now never less than cod-due");
  }
  {
    // PAY-H: full-advance delivery threshold below/at/above (existing free-delivery rule, unaffected by this change)
    const { api } = createBackend(products(), rules);
    assert.equal(api.submitOrder(advance("regular-1000")).deliveryFee, 100, "PAY-H: below threshold advance fee");
    assert.equal(api.submitOrder(advance("regular-1500")).deliveryFee, 0, "PAY-H: at threshold free delivery");
    assert.equal(api.submitOrder(advance("regular-1000", 2)).deliveryFee, 0, "PAY-H: above threshold free delivery");
  }
  {
    // PAY-I: Mix Pack COD uses the approved COD delivery fee
    const { api } = createBackend(products(), rules);
    const result = api.submitOrder(order({ items: [{ productId: "mixpack-500", quantity: 1 }] }));
    assert.equal(result.deliveryFee, rules.COD_DELIVERY_FEE, "PAY-I: Mix Pack COD uses COD delivery fee");
  }
  {
    // PAY-J: Split uses the approved COD delivery fee (no separate SPLIT_DELIVERY_FEE approved for launch)
    // and never receives the Advance free-delivery threshold benefit, even above threshold.
    const { api } = createBackend(products(), rules);
    const aboveThreshold = api.submitOrder(split("regular-1500")); // subtotal 1500 == FREE_DELIVERY_THRESHOLD
    assert.equal(aboveThreshold.deliveryFee, rules.COD_DELIVERY_FEE, "PAY-J: split uses COD delivery fee even at/above the advance free-delivery threshold");
  }
  {
    // Split payment requires an enabled advance channel + transaction reference, same as full Advance.
    const { api } = createBackend(products(), rules);
    assert.throws(
      () => api.submitOrder(order({ payment: { method: "Split Payment", advanceMethod: "", transactionReference: "" }, items: [{ productId: "regular-500", quantity: 1 }] })),
      error => error.code === "INVALID_FIELD",
      "PAY: split without a channel is rejected"
    );
  }
  {
    // Split is not offered for a pure COD-eligible (Mix Pack) cart.
    const { api } = createBackend(products(), rules);
    assert.throws(
      () => api.submitOrder(split("mixpack-500")),
      error => error.code === "SPLIT_NOT_APPLICABLE",
      "PAY: split rejected for Mix-Pack-only cart"
    );
  }
  {
    // Existing customized-collection rule is unchanged: advance only, no COD, no split.
    const { api } = createBackend(products(), rules);
    assert.throws(
      () => api.submitOrder(split("custom-2000")),
      error => error.code === "CUSTOMIZED_REQUIRES_ADVANCE",
      "PAY: customized-collection still rejects split, not just COD"
    );
  }
}

function element() {
  return {
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
    style: {},
    children: [],
    className: "",
    classList: { add() {}, remove() {}, toggle() { return false; } },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren() { this.children = []; }
  };
}

function createFrontend() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const storage = new Map();
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
    DEFAULT_PRODUCTS: products(),
    CATEGORY_META: {
      vegetables: { label: "Vegetable Seeds", tagline: "" },
      flowers: { label: "Flower Seeds", tagline: "" },
      mix: { label: "Mix Seeds", tagline: "" },
      fertilizer: { label: "Fertilizer", tagline: "" }
    },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value)
    },
    location: { href: "https://example.test/" },
    window: { scrollTo() {}, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" } },
    document: {
      body: { classList: { add() {}, remove() {} } },
      title: "",
      getElementById: get,
      querySelectorAll: () => [],
      querySelector: () => ({ value: "Cash on Delivery" }),
      createElement: () => element(),
      createTextNode: text => ({ textContent: text })
    },
    fetch: async () => { throw new Error("unconfigured mock"); }
  });
  const code = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  vm.runInContext(`${code}\nthis.__api = { Orders, Views, Cart, Router, Analytics, Prices, refreshStickyBar, escapeHTML };`, context);
  return { api: context.__api, context, get, storage };
}

async function frontendTests() {
  const frontend = createFrontend();
  await new Promise(resolve => setImmediate(resolve));
  frontend.context.CONFIG.SHEET_WEBHOOK_URL = "https://orders.example.test";
  frontend.context.fetch = async () => { throw new Error("network down"); };
  const networkResult = await frontend.api.Orders.submit({ type: "order" });
  assert.equal(networkResult.ok, false, "M: network failure is not success");
  frontend.context.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  const incompleteResult = await frontend.api.Orders.submit({ type: "order" });
  assert.equal(incompleteResult.ok, false, "M: incomplete success response is rejected");

  const product = products()[0];
  frontend.api.Views._order = {
    delivery: { name: "Ali Khan", phone: "03001234567", address: "House 1, Garden Road", city: "Lahore", postal: "", notes: "" },
    codAllowed: true,
    total: 750
  };
  frontend.api.Cart.flatLines = () => [{ p: product, qty: 1, line: 500 }];
  frontend.api.Cart.setQty(product.id, 3);
  frontend.api.Cart.clearSubmitted([{ productId: product.id, quantity: 1 }]);
  assert.equal(frontend.api.Cart.qtyOf(product.id), 2, "in-flight cart additions are preserved after submitted quantity clears");
  const serverResult = {
    ok: true,
    orderId: "HOJA-SERVER-1",
    customer: { name: "Ali Khan", phone: "923001234567", city: "Lahore" },
    paymentMethod: "Cash on Delivery",
    advanceMethod: "",
    transactionReference: "",
    paymentStatus: "COD Due",
    items: [{ productId: product.id, name: product.name, category: product.cat, quantity: 1, unitPrice: 500, lineTotal: 500 }],
    subtotal: 500,
    deliveryFee: 250,
    total: 750
  };
  const originalPageview = frontend.api.Analytics.pageview;
  frontend.api.Analytics.pageview = () => { throw new Error("analytics unavailable"); };
  assert.doesNotThrow(() => frontend.api.Views.showOrderConfirmation(serverResult), "analytics cannot interrupt confirmation");
  frontend.api.Analytics.pageview = originalPageview;
  let cleared = 0;
  let confirmed = 0;
  let purchased = 0;
  let capturedRequest;
  frontend.api.Cart.clearSubmitted = () => { cleared++; };
  frontend.api.Views.showOrderConfirmation = () => { confirmed++; };
  frontend.api.Analytics.purchase = () => { purchased++; };
  frontend.context.fetch = async () => { throw new Error("network down during checkout"); };
  await frontend.api.Views.submitOrder({ preventDefault() {} });
  assert.equal(cleared, 0, "M: network failure keeps cart");
  assert.equal(confirmed, 0, "M: network failure does not confirm");
  assert.equal(purchased, 0, "M: network failure does not fire purchase");

  frontend.api.Orders.submit = async request => {
    capturedRequest = request;
    return { ok: false, error: { message: "Simulated server rejection" } };
  };
  await frontend.api.Views.submitOrder({ preventDefault() {} });
  assert.equal(cleared, 0, "L: server failure keeps cart");
  assert.equal(confirmed, 0, "L/M: failure does not confirm");
  assert.equal(purchased, 0, "L/M: failure does not fire purchase");
  assert.equal("subtotal" in capturedRequest, false, "frontend does not send subtotal");
  assert.equal("deliveryFee" in capturedRequest, false, "frontend does not send delivery fee");
  assert.equal("total" in capturedRequest, false, "frontend does not send total");
  assert.deepEqual(JSON.parse(JSON.stringify(capturedRequest.items)), [{ productId: "regular-500", quantity: 1 }], "frontend sends IDs and quantities");
  assert.equal(frontend.api.escapeHTML("<img onerror=alert(1)>&"), "&lt;img onerror=alert(1)&gt;&amp;", "input safety: confirmation HTML escaped");

  frontend.api.Orders.submit = async () => serverResult;
  await frontend.api.Views.submitOrder({ preventDefault() {} });
  assert.equal(cleared, 1, "success clears cart once");
  assert.equal(confirmed, 1, "success shows confirmation once");
  assert.equal(purchased, 1, "success fires purchase once");

  frontend.api.Cart.setQty(product.id, 1);
  assert.equal(frontend.api.Cart.qtyOf(product.id), 1, "O: cart quantity still works");
  frontend.api.Router.go("vegetables");
  assert.equal(frontend.api.Router.current, "vegetables", "O: category navigation still works");
  const css = fs.readFileSync(path.join(root, "css", "styles.css"), "utf8");
  assert.match(css, /body\.has-sticky-bar/, "O: sticky overlap protection remains");
  assert.match(css, /@media \(max-width:700px\)/, "O: mobile product layout remains");
  const standalone = fs.readFileSync(path.join(root, "index-standalone.html"), "utf8");
  const config = fs.readFileSync(path.join(root, "js", "config.js"), "utf8");
  const admin = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
  assert.doesNotMatch(config + admin + standalone, /ADMIN_PASSWORD|hoja-admin-2026/, "frontend contains no admin secret");
  assert.doesNotMatch(standalone, /mode:\s*["']no-cors["']/, "standalone does not retain false-success order transport");
  const scripts = Array.from(standalone.matchAll(/<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g), match => match[1]);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new vm.Script(script), `standalone script ${index + 1} parses`));
}

(async () => {
  await backendTests();
  await frontendTests();
  console.log("PASS: order submission and regression tests");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
