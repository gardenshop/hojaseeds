// Unit coverage for the GA4/Meta unified event map (HS-20260818-34).
// IDs are blank in production so no network events actually send; this
// verifies the normalized payload SHAPE and dedup/PII rules the event map
// depends on, independent of whether real IDs are ever supplied.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function createSandbox(configOverrides = {}) {
  const calls = { ga: [], meta: [] };
  const context = vm.createContext({
    console,
    CONFIG: {
      SHEET_WEBHOOK_URL: "",
      CURRENCY: "Rs.",
      GA4_MEASUREMENT_ID: "G-TEST123",
      META_PIXEL_ID: "000000000000000",
      PAYMENT_ACCOUNTS: { JazzCash: "", EasyPaisa: "", "Bank Transfer": "" },
      PRICING_RULES: {},
      ...configOverrides
    },
    DEFAULT_PRODUCTS: [],
    CATEGORY_META: {
      vegetables: { label: "Vegetable Seeds", tagline: "" },
      flowers: { label: "Flower Seeds", tagline: "" },
      mix: { label: "Mix Seeds", tagline: "" },
      fertilizer: { label: "Fertilizer", tagline: "" }
    },
    window: { gtag: (...args) => calls.ga.push(args), fbq: (...args) => calls.meta.push(args), scrollTo() {}, matchMedia: () => ({ matches: true }) },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    gtag: (...args) => calls.ga.push(args),
    fbq: (...args) => calls.meta.push(args),
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { href: "https://example.test/" },
    document: {
      getElementById: () => ({ textContent: "", style: {}, disabled: false, addEventListener() {}, classList: { toggle() { return false; }, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} }),
      body: { classList: { add() {}, remove() {} } },
      querySelectorAll: () => [],
      querySelector: () => null
    },
    fetch: async () => { throw new Error("unused"); }
  });
  const code = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  vm.runInContext(`${code}\nthis.__api = { Analytics };`, context);
  return { Analytics: context.__api.Analytics, calls };
}

function product(overrides = {}) {
  return { id: "veg-01", name: "Tomato", cat: "vegetables", price: 185, unit: "packet", ...overrides };
}

(function gaItemHasNoPII() {
  const { Analytics } = createSandbox();
  const item = Analytics.gaItem(product(), 2);
  assert.deepStrictEqual(Object.keys(item).sort(), ["item_category", "item_id", "item_name", "price", "quantity"].sort());
})();

(function addToCartFiresForDeltaOnly() {
  const { Analytics, calls } = createSandbox();
  Analytics.addToCart(product(), 1); // simulates qty 3 -> 4, only the +1 delta is reported
  const [, , gaPayload] = calls.ga[calls.ga.length - 1];
  assert.strictEqual(gaPayload.value, 185, "value reflects only the added quantity, not the new total");
  assert.strictEqual(gaPayload.items[0].quantity, 1);
  const metaCall = calls.meta.find(c => c[0] === "track" && c[1] === "AddToCart");
  assert.ok(metaCall, "Meta AddToCart fires alongside GA add_to_cart");
})();

(function removeFromCartHasNoMetaEquivalent() {
  const { Analytics, calls } = createSandbox();
  calls.meta.length = 0;
  Analytics.removeFromCart(product(), 1);
  assert.ok(calls.ga.some(c => c[1] === "remove_from_cart"));
  assert.strictEqual(calls.meta.length, 0, "no standard Meta event for remove_from_cart, per the event map");
})();

(function purchasePayloadUsesFullOrderTotalNotPayNow() {
  // Split/Advance/COD all confirm at the FULL order total -- payNow is a
  // partial collection amount, never the analytics purchase value.
  for (const scenario of [
    { paymentMethod: "Cash on Delivery", total: 1249, deliveryFee: 250, payNow: 0, codDue: 1249 },
    { paymentMethod: "Advance Payment", total: 1099, deliveryFee: 100, payNow: 1099, codDue: 0 },
    { paymentMethod: "Split Payment", total: 1795, deliveryFee: 250, payNow: 895, codDue: 900 }
  ]) {
    const { Analytics, calls } = createSandbox();
    const lines = [{ p: product(), qty: 1, line: 185 }];
    Analytics.purchase("HOJA-TEST-1", scenario, lines);
    const gaPurchase = calls.ga.find(c => c[1] === "purchase");
    assert.strictEqual(gaPurchase[2].value, scenario.total, `${scenario.paymentMethod}: GA purchase value must be the full confirmed order total`);
    assert.strictEqual(gaPurchase[2].shipping, scenario.deliveryFee);
    assert.strictEqual(gaPurchase[2].transaction_id, "HOJA-TEST-1");
    assert.strictEqual(gaPurchase[2].currency, "PKR");
    const metaPurchase = calls.meta.find(c => c[0] === "track" && c[1] === "Purchase");
    assert.strictEqual(metaPurchase[2].value, scenario.total, `${scenario.paymentMethod}: Meta Purchase value must be the full confirmed order total`);
    assert.strictEqual(metaPurchase[3].eventID, "ORDER-HOJA-TEST-1", "Meta eventID = ORDER-<orderId>, matching the server CAPI Purchase event_id for Pixel/CAPI dedup");
  }
})();

(function purchasePayloadNeverIncludesPII() {
  const { Analytics, calls } = createSandbox();
  const lines = [{ p: product(), qty: 1, line: 185 }];
  Analytics.purchase("HOJA-TEST-2", {
    total: 185, deliveryFee: 0,
    // A realistic server response also carries customer/payment detail --
    // Analytics.purchase must never forward any of it.
    customer: { name: "Ali Khan", phone: "03001234567", address: "House 1, Street 2" },
    transactionReference: "TXN-SECRET-123"
  }, lines);
  const serialized = JSON.stringify(calls.ga).toLowerCase() + JSON.stringify(calls.meta).toLowerCase();
  ["ali khan", "03001234567", "house 1", "txn-secret-123"].forEach(pii => {
    assert.ok(!serialized.includes(pii), `PII leaked into analytics payload: ${pii}`);
  });
})();

(function generateLeadFiresGaAndMetaWithLeadPrefixedEventId() {
  const { Analytics, calls } = createSandbox();
  const lines = [{ p: product(), qty: 2, line: 370 }];
  Analytics.generateLead("lead-abc123", lines, 370);
  const gaLead = calls.ga.find(c => c[1] === "generate_lead");
  assert.ok(gaLead, "GA4 generate_lead fires");
  assert.strictEqual(gaLead[2].value, 370);
  assert.strictEqual(gaLead[2].currency, "PKR");
  const metaLead = calls.meta.find(c => c[0] === "track" && c[1] === "Lead");
  assert.ok(metaLead, "Meta Lead fires");
  assert.strictEqual(metaLead[3].eventID, "LEAD-lead-abc123", "Meta eventID = LEAD-<leadId>, matching the server CAPI Lead event_id for dedup");
})();

(function noopWhenIdsBlank() {
  const { Analytics, calls } = createSandbox({ GA4_MEASUREMENT_ID: "", META_PIXEL_ID: "" });
  Analytics.purchase("HOJA-TEST-3", { total: 100, deliveryFee: 0 }, [{ p: product(), qty: 1, line: 100 }]);
  Analytics.generateLead("lead-blank", [{ p: product(), qty: 1, line: 100 }], 100);
  assert.strictEqual(calls.ga.length, 0, "fail-closed: no GA network call with a blank Measurement ID");
  assert.strictEqual(calls.meta.length, 0, "fail-closed: no Meta network call with a blank Pixel ID");
})();

console.log("PASS: GA4/Meta event map contract tests");
