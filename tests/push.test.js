// Web Push backend tests (HS-20260819-03). Synthetic Sheet mocks only --
// no real Sheet writes, no real push sends (there is no send path yet by
// design -- see sendPushCampaign).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function createBackend({ vapidToken = null } = {}) {
  const rows = {
    Products: [["id", "cat", "name", "unit", "price", "type"], ["veg-01", "vegetables", "Tomato", "packet", 180, "regular"], ["mix-01", "mix", "Kitchen Garden Mix", "kit", 999, "standard-collection"]],
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
          for (let i = 0; i < (nr || 1); i++) for (let j = 0; j < (nc || values[0].length); j++) data[r - 1 + i][c - 1 + j] = values[i][j];
        }
      })
    };
    sheets[title] = obj;
    return obj;
  }
  Object.keys(rows).forEach(makeSheet);
  const properties = new Map();
  if (vapidToken) properties.set("VAPID_PRIVATE_KEY", vapidToken);

  const context = vm.createContext({
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: name => sheets[name] || null,
        insertSheet: name => { rows[name] = []; return makeSheet(name); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
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
      getUuid: () => "00000000-0000-4000-8000-" + String(Math.floor(Math.random() * 1e12)).padStart(12, "0")
    },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200 }) }
  });
  const code = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
  vm.runInContext(`${code}\nthis.__api = { savePushSubscription, logPushEvent, savePushCampaign, sendPushCampaign, buildPushDashboard, readPushSubscriptionsSafe, saveLead, submitOrder, OrderError };`, context);
  return { api: context.__api, rows };
}

function visitorId() { return "visitor-test-" + Math.random().toString(36).slice(2, 10); }

(function oneSubscriptionPerVisitor() {
  const { api, rows } = createBackend();
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/abc", p256dh: "x", auth: "y" } });
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/abc", p256dh: "x", auth: "y" } });
  assert.strictEqual(rows.PushSubscriptions.length, 2, "header + exactly one subscription row for a repeated visitor");
})();

(function subscriptionStatusDerivedServerSide() {
  const { api, rows } = createBackend();
  api.savePushSubscription({ visitorId: visitorId(), permissionStatus: "granted", subscription: { endpoint: "https://push.example/a" } });
  api.savePushSubscription({ visitorId: visitorId(), permissionStatus: "denied", subscription: {} });
  api.savePushSubscription({ visitorId: visitorId(), permissionStatus: "granted", subscription: {} }); // no endpoint yet (no VAPID key)
  const headers = rows.PushSubscriptions[0];
  const statusCol = headers.indexOf("subscriptionStatus");
  const statuses = rows.PushSubscriptions.slice(1).map(r => r[statusCol]);
  assert.deepStrictEqual(statuses, ["active", "unsubscribed", "unavailable"], "status is computed server-side, never trusted from the client");
})();

(function invalidVisitorIdRejected() {
  const { api, rows } = createBackend();
  assert.throws(() => api.savePushSubscription({ visitorId: "x", permissionStatus: "granted", subscription: {} }));
  assert.strictEqual(rows.PushSubscriptions, undefined);
})();

(function pushEventLogged() {
  const { api, rows } = createBackend();
  const vid = visitorId();
  api.logPushEvent({ visitorId: vid, eventType: "prompt_view" });
  api.logPushEvent({ visitorId: vid, eventType: "soft_close" });
  assert.strictEqual(rows.PushEvents.length, 3, "header + 2 events");
})();

(function unknownEventTypeRejected() {
  const { api } = createBackend();
  assert.throws(() => api.logPushEvent({ visitorId: visitorId(), eventType: "made_up_event" }));
})();

(function campaignDraftCreateAndUpdate() {
  const { api, rows } = createBackend();
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/?hs_view=cart", audience: "cart_abandoned", offerType: "gift" }, "admin@hojaseeds.pk");
  assert.strictEqual(created.status, "Draft");
  assert.strictEqual(rows.PushCampaigns.length, 2);
  const updated = api.savePushCampaign({ campaignId: created.campaignId, title: "Gift Seeds v2", body: "Updated body text.", targetUrl: "https://www.hojaseeds.pk/?hs_view=cart", audience: "cart_abandoned" }, "admin@hojaseeds.pk");
  assert.strictEqual(updated.campaignId, created.campaignId, "same campaign updated, not duplicated");
  assert.strictEqual(rows.PushCampaigns.length, 2);
})();

(function campaignRejectsNonHojaTargetUrl() {
  const { api } = createBackend();
  assert.throws(() => api.savePushCampaign({ title: "Bad", body: "Body text here.", targetUrl: "https://evil.example/", audience: "all_active" }, "admin@hojaseeds.pk"), err => err.code === "INVALID_TARGET_URL");
})();

(function campaignStripsHtmlFromTitleAndBody() {
  const { api, rows } = createBackend();
  api.savePushCampaign({ title: "<script>alert(1)</script>Gift", body: "Body <b>text</b> here.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  const headers = rows.PushCampaigns[0];
  const row = rows.PushCampaigns[1];
  assert.ok(!String(row[headers.indexOf("title")]).includes("<script>"), "HTML stripped from title");
  assert.ok(!String(row[headers.indexOf("body")]).includes("<b>"), "HTML stripped from body");
})();

(function sendFailsClosedWithoutProvider() {
  const { api } = createBackend({ vapidToken: null });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  assert.throws(() => api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk"), err => err.code === "PUSH_PROVIDER_NOT_CONFIGURED", "no fake send success without a configured provider");
})();

(function dashboardStripsEndpointFromAdminView() {
  const { api } = createBackend();
  api.savePushSubscription({ visitorId: visitorId(), permissionStatus: "granted", subscription: { endpoint: "https://push.example/secret", p256dh: "key", auth: "secret" } });
  const items = api.readPushSubscriptionsSafe(100);
  items.forEach(row => {
    assert.strictEqual(row.endpoint, undefined, "endpoint never returned to Admin UI");
    assert.strictEqual(row.p256dh, undefined);
    assert.strictEqual(row.authKey, undefined);
  });
})();

(function dashboardComputesOptInRate() {
  const { api } = createBackend();
  const v1 = visitorId(), v2 = visitorId();
  api.logPushEvent({ visitorId: v1, eventType: "prompt_view" });
  api.logPushEvent({ visitorId: v2, eventType: "prompt_view" });
  api.savePushSubscription({ visitorId: v1, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a" } });
  api.savePushSubscription({ visitorId: v2, permissionStatus: "denied", subscription: {} });
  const summary = api.buildPushDashboard();
  assert.strictEqual(summary.promptImpressions, 2);
  assert.strictEqual(summary.permissionGranted, 1);
  assert.strictEqual(summary.permissionDenied, 1);
  assert.strictEqual(summary.optInRate, 50);
})();

(function leadConversionAttributedToRecentClick() {
  const { api, rows } = createBackend();
  const vid = visitorId();
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  api.logPushEvent({ visitorId: vid, campaignId: created.campaignId, eventType: "notification_click" });
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a" } });
  api.saveLead({
    leadId: "lead-attrib-test-000000001", visitorId: vid,
    customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Street 2, Sector A", city: "Lahore", postal: "", notes: "" },
    items: [{ productId: "veg-01", quantity: 1 }]
  });
  const campHeaders = rows.PushCampaigns[0];
  const campRow = rows.PushCampaigns[1];
  assert.strictEqual(campRow[campHeaders.indexOf("recoveredLeads")], 1, "recovered Lead credited to the clicked campaign");
  const subHeaders = rows.PushSubscriptions[0];
  const subRow = rows.PushSubscriptions[1];
  assert.strictEqual(subRow[subHeaders.indexOf("linkedLeadId")], "lead-attrib-test-000000001");
})();

(function orderConversionAttributedWithFullRevenue() {
  const { api, rows } = createBackend();
  const vid = visitorId();
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  api.logPushEvent({ visitorId: vid, campaignId: created.campaignId, eventType: "notification_click" });
  const result = api.submitOrder({
    idempotencyKey: "idem-push-attrib-000000001",
    visitorId: vid,
    customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Street 2, Sector A", city: "Lahore", postal: "", notes: "" },
    payment: { method: "Cash on Delivery" },
    items: [{ productId: "mix-01", quantity: 1 }]
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  const campHeaders = rows.PushCampaigns[0];
  const campRow = rows.PushCampaigns[1];
  assert.strictEqual(campRow[campHeaders.indexOf("recoveredOrders")], 1);
  assert.strictEqual(campRow[campHeaders.indexOf("recoveredRevenue")], result.total, "recovered revenue is the full order total");
})();

console.log("PASS: web push subscription/campaign/attribution tests");
