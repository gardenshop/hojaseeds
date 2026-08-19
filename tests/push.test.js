// Web Push backend tests (HS-20260819-03, real-send additions HS-20260819-06).
// Synthetic Sheet mocks only -- no real Sheet writes. UrlFetchApp.fetch/
// fetchAll are mocked per-test (default: every request "accepted") so no
// real network call or real push send ever happens from this suite.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function createBackend({ pushWorkerUrl = null, pushServerSecret = null, fetchAllResponder = null, nowKarachiHHMM = "12:00" } = {}) {
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
  if (pushWorkerUrl) properties.set("PUSH_WORKER_URL", pushWorkerUrl);
  if (pushServerSecret) properties.set("PUSH_SERVER_SECRET", pushServerSecret);

  // Default: every worker request is "accepted" (201) -- individual tests
  // override fetchAllResponder to simulate expired (410) / temporary
  // failures without ever making a real network call.
  const respond = fetchAllResponder || (() => ({ pushStatus: "accepted" }));
  const cacheMap = new Map();
  const cacheStore = {
    get: key => cacheMap.get(key) || null,
    put: (key, value) => cacheMap.set(key, value),
    remove: key => cacheMap.delete(key)
  };

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
      // Genuinely random across the whole UUID (not just a fixed prefix
      // with random digits tacked on the end) -- savePushCampaign truncates
      // this to its first 16 hex chars for the campaignId, so a mock that
      // only randomizes the tail would collide every time.
      getUuid: () => {
        const hex = () => Math.floor(Math.random() * 16).toString(16);
        const seg = n => Array.from({ length: n }, hex).join("");
        return `${seg(8)}-${seg(4)}-4${seg(3)}-8${seg(3)}-${seg(12)}`;
      },
      // Test-controlled "current Karachi time" instead of a real timezone
      // conversion, so quiet-hours tests are deterministic regardless of
      // when/where this suite actually runs.
      formatDate: () => nowKarachiHHMM
    },
    ScriptApp: { getService: () => ({ getUrl: () => "https://example.test/exec" }) },
    CacheService: { getScriptCache: () => cacheStore },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    UrlFetchApp: {
      fetch: () => { const r = respond(); return { getResponseCode: () => r.httpStatus || 200, getContentText: () => JSON.stringify(r) }; },
      fetchAll: requests => requests.map(() => { const r = respond(); return { getResponseCode: () => r.httpStatus || 200, getContentText: () => JSON.stringify(r) }; })
    }
  });
  const code = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8");
  vm.runInContext(`${code}\nthis.__api = { savePushSubscription, logPushEvent, savePushCampaign, sendPushCampaign, pushTestSend, setPushCampaignPause, computeEligibleSubscriptions, buildPushDashboard, readPushSubscriptionsSafe, saveLead, submitOrder, updateSettings, getSettings, classifyWorkerResponse, OrderError };`, context);
  return { api: context.__api, rows, cacheMap };
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
  const { api } = createBackend({ pushWorkerUrl: null, pushServerSecret: null });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  assert.throws(() => api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk"), err => err.code === "PUSH_PROVIDER_NOT_CONFIGURED", "no fake send success without a configured provider");
})();

// ── HS-20260819-06: real send / frequency / dedupe / quiet hours ──────

(function sendAcceptsAndCountsWhenConfigured() {
  const { api, rows } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret" });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  const result = api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk");
  assert.strictEqual(result.status, "Completed");
  assert.strictEqual(result.batch.accepted, 1);
  const campHeaders = rows.PushCampaigns[0], campRow = rows.PushCampaigns[1];
  assert.strictEqual(campRow[campHeaders.indexOf("attempted")], 1);
  assert.strictEqual(campRow[campHeaders.indexOf("accepted")], 1);
})();

(function sendDedupesSameCampaignSubscriptionPair() {
  const { api } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret" });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  const first = api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk");
  assert.strictEqual(first.batch.attempted, 1);
  assert.strictEqual(first.status, "Completed", "single subscriber, single batch -- campaign finishes immediately");
  // A finished campaign can never be resent at all (belt-and-braces on top
  // of per-subscription dedupe, which is exercised directly below).
  assert.throws(() => api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk"), err => err.code === "CAMPAIGN_ALREADY_FINAL");
  // Direct dedupe check: after one push_sent event for this campaign/
  // visitor pair, computeEligibleSubscriptions excludes it even though the
  // subscription is still active and under all frequency caps.
  const eligible = api.computeEligibleSubscriptions("all_active", created.campaignId);
  assert.strictEqual(eligible.length, 0, "same campaign never resent to the same subscription");
})();

(function sendEnforcesDailyLimit() {
  const { api } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret" });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const c1 = api.savePushCampaign({ title: "Offer 1", body: "First offer today.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  api.sendPushCampaign(c1.campaignId, "admin@hojaseeds.pk"); // uses up MAX_PUSH_PER_DAY=1
  const c2 = api.savePushCampaign({ title: "Offer 2", body: "Second offer today.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  const second = api.sendPushCampaign(c2.campaignId, "admin@hojaseeds.pk");
  assert.strictEqual(second.batch.attempted, 0, "daily limit blocks a second campaign to the same subscriber the same day");
})();

(function quietHoursBlockEntireSend() {
  const { api, rows } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret", nowKarachiHHMM: "22:30" });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  const result = api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk");
  assert.strictEqual(result.quietHours, true, "22:30 Asia/Karachi is inside the default 21:00-08:00 quiet window");
  const campHeaders = rows.PushCampaigns[0], campRow = rows.PushCampaigns[1];
  assert.strictEqual(campRow[campHeaders.indexOf("attempted")], 0, "quiet hours sent nothing at all");
})();

(function expiredSubscriptionMarkedInactive() {
  const { api, rows } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret", fetchAllResponder: () => ({ pushStatus: "expired" }) });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/gone", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  const result = api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk");
  assert.strictEqual(result.status, "Failed", "0 accepted / 1 failed on the only batch => Failed");
  const subHeaders = rows.PushSubscriptions[0], subRow = rows.PushSubscriptions[1];
  assert.strictEqual(subRow[subHeaders.indexOf("subscriptionStatus")], "expired", "a permanently-gone push service response marks the subscription expired");
})();

(function temporaryFailureKeepsSubscriptionActive() {
  const { api, rows } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret", fetchAllResponder: () => ({ pushStatus: "temporary_failure" }) });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk");
  const subHeaders = rows.PushSubscriptions[0], subRow = rows.PushSubscriptions[1];
  assert.strictEqual(subRow[subHeaders.indexOf("subscriptionStatus")], "active", "a temporary failure never expires the subscription");
})();

(function unsupportedAudienceRefusesToSend() {
  const { api } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret" });
  const created = api.savePushCampaign({ title: "Seasonal", body: "New arrivals this month.", targetUrl: "https://www.hojaseeds.pk/", audience: "interest_vegetables" }, "admin@hojaseeds.pk");
  assert.throws(() => api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk"), err => err.code === "AUDIENCE_NOT_YET_LINKED", "never guesses recipients for an unlinked segment");
})();

(function cartAbandonedAudienceMatchesRealLeadLinkage() {
  const { api } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret" });
  const abandonedVid = visitorId(), unrelatedVid = visitorId();
  api.savePushSubscription({ visitorId: abandonedVid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  api.savePushSubscription({ visitorId: unrelatedVid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/b", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  api.saveLead({
    leadId: "lead-cart-abandoned-000000001", visitorId: abandonedVid,
    customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Street 2, Sector A", city: "Lahore", postal: "", notes: "" },
    items: [{ productId: "veg-01", quantity: 1 }]
  });
  const created = api.savePushCampaign({ title: "Still Saved", body: "Your seeds are still saved.", targetUrl: "https://www.hojaseeds.pk/", audience: "cart_abandoned" }, "admin@hojaseeds.pk");
  const result = api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk");
  assert.strictEqual(result.batch.attempted, 1, "only the visitor with a matching Lead is targeted, not every active subscriber");
})();

(function testSendBypassesFrequencyAndTouchesNoCampaign() {
  const { api, rows } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret", nowKarachiHHMM: "22:30" });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const result = api.pushTestSend({ visitorId: vid }, "admin@hojaseeds.pk");
  assert.strictEqual(result.ok, true, "a single manual test send is not blocked by quiet hours");
  const eventHeaders = rows.PushEvents[0];
  const testEvent = rows.PushEvents.slice(1).find(r => r[eventHeaders.indexOf("eventType")] === "test_sent");
  assert.ok(testEvent, "test send logs a distinct test_sent event");
})();

(function campaignPauseBlocksSend() {
  const { api } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret" });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active", status: "Scheduled" }, "admin@hojaseeds.pk");
  api.setPushCampaignPause(created.campaignId, true, "admin@hojaseeds.pk");
  assert.throws(() => api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk"), err => err.code === "CAMPAIGN_PAUSED");
  const resumed = api.setPushCampaignPause(created.campaignId, false, "admin@hojaseeds.pk");
  assert.strictEqual(resumed.status, "Scheduled", "resume never auto-sends -- admin must click Send again");
})();

// ── HS-20260819-09: safe failure diagnosis ─────────────────────────────

(function authFailureClassifiedNotHiddenAsGenericFailure() {
  const { api, rows } = createBackend({
    pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret",
    fetchAllResponder: () => ({ ok: false, error: "UNAUTHORIZED", httpStatus: 401 })
  });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk");
  const eventHeaders = rows.PushEvents[0];
  const failEvent = rows.PushEvents.slice(1).find(r => r[eventHeaders.indexOf("eventType")] === "push_failed");
  const meta = JSON.parse(failEvent[eventHeaders.indexOf("metadata")]);
  assert.strictEqual(meta.code, "AUTH_FAILED", "a Worker 401 is classified distinctly, not lumped in as a generic failure");
  assert.strictEqual(meta.httpStatus, 401);
  // Surfaced to Admin without ever exposing endpoint/keys/secrets.
  const items = api.readPushSubscriptionsSafe(100);
  const row = items.find(i => i.visitorId === vid);
  assert.ok(row.lastFailure.indexOf("AUTH_FAILED") !== -1);
  assert.strictEqual(row.endpoint, undefined);
  assert.strictEqual(row.p256dh, undefined);
})();

(function classifyWorkerResponseCodes() {
  const { api } = createBackend();
  const mk = (status, body) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(body) });
  assert.strictEqual(api.classifyWorkerResponse(mk(201, { pushStatus: "accepted" })).code, "ACCEPTED");
  assert.strictEqual(api.classifyWorkerResponse(mk(410, { pushStatus: "expired" })).code, "EXPIRED_SUBSCRIPTION");
  assert.strictEqual(api.classifyWorkerResponse(mk(401, { error: "UNAUTHORIZED" })).code, "AUTH_FAILED");
  assert.strictEqual(api.classifyWorkerResponse(mk(400, { error: "INVALID_SUBSCRIPTION_ENDPOINT" })).code, "PUSH_SERVICE_REJECTED");
  assert.strictEqual(api.classifyWorkerResponse(mk(502, {})).code, "TEMPORARY_ERROR");
})();

(function concurrentSendCampaignRejectedServerSide() {
  // HS-20260819-13: simulates a second concurrent sendPushCampaign call
  // for the same campaign (e.g. two admin tabs, or a client-side race the
  // button-disabling missed) by pre-occupying the same cache lock key the
  // real function uses -- proves the server-side guard exists
  // independently of client-side button disabling.
  const { api, rows, cacheMap } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret" });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  cacheMap.set("push_sending_" + created.campaignId, "1");
  assert.throws(() => api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk"), err => err.code === "PUSH_BUSY", "a campaign already being sent rejects a concurrent call instead of double-processing");
  cacheMap.delete("push_sending_" + created.campaignId);
  const result = api.sendPushCampaign(created.campaignId, "admin@hojaseeds.pk");
  assert.strictEqual(result.batch.attempted, 1, "once the lock clears, sending works normally");
})();

(function pushSettingsValidateRanges() {
  const { api } = createBackend();
  assert.throws(() => api.updateSettings({ MAX_PUSH_PER_DAY: -1 }, "admin@hojaseeds.pk"), err => err.code === "INVALID_ADMIN_UPDATE");
  assert.throws(() => api.updateSettings({ QUIET_HOURS_START: "25:99" }, "admin@hojaseeds.pk"), err => err.code === "INVALID_ADMIN_UPDATE");
  api.updateSettings({ MAX_PUSH_PER_DAY: 2, MAX_PUSH_PER_WEEK: 5, QUIET_HOURS_START: "22:00", QUIET_HOURS_END: "07:00" }, "admin@hojaseeds.pk");
  const settings = api.getSettings();
  assert.strictEqual(settings.MAX_PUSH_PER_DAY, 2);
  assert.strictEqual(settings.QUIET_HOURS_START, "22:00");
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

(function duplicateClickEventsDoNotDoubleCount() {
  // HS-20260819-14: a service-worker fetch retry or double focus/open call
  // must not double-increment clicked/clickCount for one physical click.
  const { api, rows } = createBackend({ pushWorkerUrl: "https://worker.test/", pushServerSecret: "s3cret" });
  const vid = visitorId();
  api.savePushSubscription({ visitorId: vid, permissionStatus: "granted", subscription: { endpoint: "https://push.example/a", p256dh: "x".repeat(30), auth: "y".repeat(16) } });
  const created = api.savePushCampaign({ title: "Gift Seeds", body: "Free gift seeds this week.", targetUrl: "https://www.hojaseeds.pk/", audience: "all_active" }, "admin@hojaseeds.pk");
  api.logPushEvent({ visitorId: vid, campaignId: created.campaignId, eventType: "notification_click" });
  api.logPushEvent({ visitorId: vid, campaignId: created.campaignId, eventType: "notification_click" }); // simulated retry
  const campHeaders = rows.PushCampaigns[0];
  const campRow = rows.PushCampaigns[1];
  assert.strictEqual(campRow[campHeaders.indexOf("clicked")], 1, "clicked counter increments exactly once for two rapid identical click events");
  const subHeaders = rows.PushSubscriptions[0];
  const subRow = rows.PushSubscriptions[1];
  assert.strictEqual(subRow[subHeaders.indexOf("clickCount")], 1, "subscriber clickCount also increments exactly once");
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
