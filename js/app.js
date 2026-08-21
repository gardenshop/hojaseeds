// ── Hoja Seeds — storefront logic ──────────────────────────────────
// Flow: browse -> Summary (step 1, grouped by category) -> Delivery
// (step 2, gated — "Confirm Delivery" must succeed before moving on) ->
// Payment (step 3) -> Confirmation (step 4). A sticky bottom bar is the
// primary mobile action through every step.

// ---- Price store: merges DEFAULT_PRODUCTS with Super Admin overrides ----
// Overrides are keyed by product id and can carry a price and/or a type
// override: { [id]: { price?: number, type?: string } }
const Prices = {
  KEY: "hoja_admin_overrides",
  _cache: null,
  overrides() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; }
    catch { return {}; }
  },
  async getProducts() {
    if (CONFIG.SHEET_WEBHOOK_URL) {
      try {
        const res = await fetch(`${CONFIG.SHEET_WEBHOOK_URL}?action=products`);
        const data = await res.json();
        if (Array.isArray(data) && data.length) return data;
      } catch (e) { console.warn("Sheet fetch failed, using local data:", e); }
    }
    const ov = this.overrides();
    return DEFAULT_PRODUCTS.map(p => {
      const o = ov[p.id];
      if (!o) return p;
      return { ...p, price: o.price != null ? o.price : p.price, type: o.type || p.type };
    });
  },
  async load() { this._cache = await this.getProducts(); return this._cache; },
  get() { return this._cache || DEFAULT_PRODUCTS; }
};

// ---- Store settings: merges live Sheet settings with local defaults and
// Super Admin overrides — Sheet first if configured, else local storage.
const Settings = {
  KEY: "hoja_pricing_rules",
  _cache: null,
  overrides() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; }
    catch { return {}; }
  },
  async fetchRules() {
    if (CONFIG.SHEET_WEBHOOK_URL) {
      try {
        const res = await fetch(`${CONFIG.SHEET_WEBHOOK_URL}?action=settings`);
        const data = await res.json();
        if (data && Object.keys(data).length) return { ...CONFIG.PRICING_RULES, ...CONFIG.PAYMENT_DISPLAY, ...data };
      } catch (e) { console.warn("Sheet settings fetch failed, using local data:", e); }
    }
    return { ...CONFIG.PRICING_RULES, ...CONFIG.PAYMENT_DISPLAY, ...this.overrides() };
  },
  async load() { this._cache = await this.fetchRules(); return this._cache; },
  get() { return this._cache || { ...CONFIG.PRICING_RULES, ...CONFIG.PAYMENT_DISPLAY, ...this.overrides() }; }
};

// ---- Popularity: read-only bestseller ranking for the homepage "Popular
// Seeds" strip. Fetches {productId, soldQty}[] from the server (real Orders
// history, test/load rows already excluded server-side); never blocks the
// header/hero/categories/Products render — the strip renders with a stable
// catalog-order fallback immediately and re-sorts in place if/when ranking
// arrives. No PII is requested or stored here.
const Popularity = {
  _cache: null,
  _inflight: null,
  // Fires at most once per page load: Router.go("home") runs twice during
  // boot (immediate fallback render, then again once Prices/Settings
  // resolve) — both calls land here, so an in-flight promise is reused
  // instead of firing a second ?action=popularProducts request, and a
  // resolved cache is reused by any later return-to-home navigation.
  async load() {
    if (this._cache) return this._cache;
    if (this._inflight) return this._inflight;
    if (!CONFIG.SHEET_WEBHOOK_URL) return null;
    this._inflight = (async () => {
      try {
        const res = await fetch(`${CONFIG.SHEET_WEBHOOK_URL}?action=popularProducts`);
        const data = await res.json();
        if (Array.isArray(data) && data.length) { this._cache = data; return data; }
      } catch (e) { console.warn("Popularity fetch failed, keeping fallback order:", e); }
      return null;
    })();
    const result = await this._inflight;
    this._inflight = null;
    return result;
  },
  get() { return this._cache; }
};

// Picks the top 6 products for the homepage strip: ranked by real sold
// quantity when available (unknown/removed product IDs are ignored), else a
// stable fallback of the first 6 catalog products.
function pickPopularProducts(products, ranking) {
  if (Array.isArray(ranking) && ranking.length) {
    const byId = {};
    products.forEach(p => byId[p.id] = p);
    const ranked = ranking.map(r => byId[r.productId]).filter(Boolean).slice(0, 6);
    if (ranked.length) return ranked;
  }
  return products.slice(0, 6);
}

// Payable-amount label: COD is money owed at the door; Advance is money the
// customer is submitting now (pending verification) — never call it "paid".
function payableLabelText(method) {
  return method === "Cash on Delivery" ? "Pay on delivery" : "Advance payment amount";
}

// Single source of truth for payment math: items subtotal -> delivery fee
// -> order total -> payNow/codDue, for a given payment method. Every
// payment card, the selected advance-channel panel, Order Summary, and the
// CTA all read the SAME preview object here — never duplicate this math.
// Delivery rule: Advance orders (including every customized-collection
// order, which is always advance-only) get free delivery at the threshold;
// 50/50 Split does NOT get that benefit and uses the approved COD fee (no
// separate SPLIT_DELIVERY_FEE approved for launch); COD is a flat
// normal-courier charge. Split rounding: payNow rounds up, codDue rounds to
// the nearest Rs.100 and payNow absorbs the remainder, so payNow + codDue
// always equals orderTotal exactly. Presentation only — apps-script/Code.gs
// (computeOrderTotals) mirrors this exactly and is authoritative.
function paymentPreview(method, subtotal) {
  const r = Settings.get();
  if (method === "Cash on Delivery") {
    const deliveryFee = r.COD_DELIVERY_FEE;
    const orderTotal = subtotal + deliveryFee;
    return { method, itemsSubtotal: subtotal, deliveryFee, orderTotal, payNow: 0, codDue: orderTotal, freeDelivery: false, freeDeliveryQualified: false, advancePercent: 0, deliveryPercent: 100 };
  }
  if (method === "Advance Payment") {
    const freeDeliveryQualified = subtotal >= r.FREE_DELIVERY_THRESHOLD;
    const deliveryFee = freeDeliveryQualified ? 0 : r.ADVANCE_DELIVERY_FEE;
    const orderTotal = subtotal + deliveryFee;
    return { method, itemsSubtotal: subtotal, deliveryFee, orderTotal, payNow: orderTotal, codDue: 0, freeDelivery: freeDeliveryQualified, freeDeliveryQualified, advancePercent: 100, deliveryPercent: 0 };
  }
  // Split Payment
  const deliveryFee = r.COD_DELIVERY_FEE;
  const orderTotal = subtotal + deliveryFee;
  const splitAdvancePercent = Math.min(99, Math.max(1, Number(r.SPLIT_ADVANCE_PERCENT) || 50));
  const rawPayNow = Math.ceil(orderTotal * splitAdvancePercent / 100);
  const rawCodDue = orderTotal - rawPayNow;
  const roundedCodDue = Math.round(rawCodDue / 100) * 100;
  const normalPayNow = orderTotal - roundedCodDue;
  const minimumAdvance = Math.min(orderTotal, Math.max(1, Number(r.MIN_PARTIAL_ADVANCE) || 250));
  // The configured floor applies after the existing COD rounding. Do not
  // round COD again, because that could reduce payNow below the minimum.
  const payNow = Math.max(normalPayNow, minimumAdvance);
  const codDue = orderTotal - payNow;
  return {
    method, itemsSubtotal: subtotal, deliveryFee, orderTotal, payNow, codDue, freeDelivery: false, freeDeliveryQualified: false,
    advancePercent: splitAdvancePercent, deliveryPercent: 100 - splitAdvancePercent
  };
}

// Cart-based payment-policy matrix (HS-20260817-04), mirrored client-side
// for presentation only — apps-script/Code.gs re-derives and enforces this
// authoritatively from the same cat/type Products fields, never trusting
// the client. Exact mapping (see Code.gs productPaymentPolicy for the
// documented rationale):
//   cat mix + type customized-collection -> "advance_only"
//   cat mix + type standard-collection   -> "cod"
//   cat vegetables or flowers            -> "advance_or_split"
//   anything else (Fertilizer, etc.)     -> "existing" (current COD_ALLOWED behavior)
function productPaymentPolicy(p) {
  const cat = String(p.cat || "");
  const type = String(p.type || "regular");
  if (cat === "mix" && type === "customized-collection") return "advance_only";
  if (cat === "mix" && type === "standard-collection") return "cod";
  if (cat === "vegetables" || cat === "flowers") return "advance_or_split";
  return "existing";
}
function cartPaymentPolicy(lines) {
  const policies = lines.map(l => productPaymentPolicy(l.p));
  if (policies.includes("advance_only")) return "advance_only";
  if (policies.includes("advance_or_split")) return "advance_or_split";
  return "cod";
}

// Category product-card status and total presentation. Cart state remains
// localStorage-backed and all quantity changes still flow through Cart.setQty.
function inCartStatusHTML(qty) {
  if (qty <= 0) return "";
  return `<span class="in-cart-badge">✓ In Cart</span><span class="pc-selected-count">${qty} ${qty === 1 ? "packet" : "packets"} selected</span>`;
}
function selectedTotalHTML(amount) {
  return `<span class="pc-total-label">Total</span><span class="pc-total-value mono">${CONFIG.CURRENCY} ${amount}</span>`;
}

function commerceProductCardHTML(p, qty, context = "category") {
  const isCart = context === "cart";
  const total = qty * p.price;
  const identity = isCart ? `data-pid="${p.id}"` : `data-product-id="${p.id}"`;
  const statusId = isCart ? "" : ` id="sel-${p.id}"`;
  const badge = productBadgeHTML(p);
  const removeBtn = isCart ? `<button class="cart-remove-link" onclick="Views.cartChangeQty('${p.id}',${-qty})" aria-label="Remove ${escapeHTML(p.name)} from cart" title="Remove from cart">🗑</button>` : "";
  return `<article class="commerce-product-card${qty > 0 ? " in-cart" : ""}" ${identity}>
    <div class="commerce-name-row"><span class="commerce-name">${escapeHTML(p.name)}</span>${badge ? `<span class="commerce-badge">${badge}</span>` : ""}</div>
    <div class="commerce-media">${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" loading="lazy">` : p.icon}</div>
    <div class="commerce-details">
      <div class="commerce-unit">per ${p.unit}</div>
      <div class="commerce-price">${CONFIG.CURRENCY} ${p.price} / ${p.unit}</div>
    </div>
    <div class="commerce-actions"><div class="stepper"><button onclick="Views.${isCart ? "cartChangeQty" : "changeQty"}('${p.id}',1)" aria-label="Increase ${p.name} quantity">+</button><span class="qty-display"${isCart ? "" : ` id="qty-${p.id}"`}>${qty}</span><button onclick="Views.${isCart ? "cartChangeQty" : "changeQty"}('${p.id}',-1)" aria-label="Decrease ${p.name} quantity">−</button></div></div>
    <div class="commerce-utility"><div class="commerce-total"${isCart ? "" : ` id="tot-${p.id}"`}>${selectedTotalHTML(total)}</div><div class="commerce-status"${statusId}${qty <= 0 ? ' style="display:none"' : ""}>${inCartStatusHTML(qty)}${removeBtn}</div></div>
  </article>`;
}

// Small "★ Premium" / "100% Advance" markers next to a product's name.
function productBadgeHTML(p) {
  if (p.type === "premium") return `<span class="badge badge-premium">★ Premium</span>`;
  if (p.type === "customized-collection") return `<span class="badge badge-customized">100% Advance</span>`;
  return "";
}

// ---- Cart ----
const Cart = {
  KEY: "hoja_cart",
  items() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; } // {productId: qty}
    catch { return {}; }
  },
  save(items) {
    localStorage.setItem(this.KEY, JSON.stringify(items));
    this.renderCount();
    refreshStickyBar();
  },
  setQty(id, qty) {
    const items = this.items();
    if (qty <= 0) delete items[id]; else items[id] = qty;
    this.save(items);
  },
  qtyOf(id) { return this.items()[id] || 0; },
  clear() { this.save({}); },
  saveCustomDraft() { localStorage.setItem("hoja_custom_cart_draft", JSON.stringify(this.items())); },
  restoreCustomDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem("hoja_custom_cart_draft"));
      if (!draft || typeof draft !== "object" || !Object.keys(draft).length) return false;
      this.save(draft);
      localStorage.removeItem("hoja_custom_cart_draft");
      return true;
    } catch { return false; }
  },
  hasCustomDraft() { return Boolean(localStorage.getItem("hoja_custom_cart_draft")); },
  clearSubmitted(submittedItems) {
    const items = this.items();
    submittedItems.forEach(item => {
      const current = Number(items[item.productId]) || 0;
      if (current <= item.quantity) delete items[item.productId];
      else items[item.productId] = current - item.quantity;
    });
    this.save(items);
  },
  count() { return Object.values(this.items()).reduce((a, b) => a + b, 0); },
  totalAmount() {
    const items = this.items();
    const products = Prices.get();
    return Object.keys(items).reduce((sum, id) => {
      const p = products.find(p => p.id === id);
      return p ? sum + p.price * items[id] : sum;
    }, 0);
  },
  // Cart lines as {p, qty, line}, grouped by category — used by the
  // Summary page and by every analytics call that needs an items[] array.
  linesByCategory() {
    const products = Prices.get();
    const items = this.items();
    const byCat = {};
    Object.keys(items).forEach(id => {
      const p = products.find(p => p.id === id);
      if (!p) return;
      byCat[p.cat] = byCat[p.cat] || [];
      byCat[p.cat].push({ p, qty: items[id], line: p.price * items[id] });
    });
    return byCat;
  },
  flatLines() {
    const byCat = this.linesByCategory();
    return Object.values(byCat).flat();
  },
  renderCount() {
    const countEl = document.getElementById("cartCount");
    const count = this.count();
    if (countEl) countEl.textContent = count;
    // Accessible name must include the button's visible text (WCAG 2.5.3 /
    // Lighthouse label-content-name-mismatch) — the basket icon + count are
    // visible content, so the label is kept in sync with the live count
    // instead of a static "View cart".
    const cartBtn = document.querySelector(".cart-icon-btn");
    if (cartBtn && typeof cartBtn.setAttribute === "function") cartBtn.setAttribute("aria-label", `View cart, ${count} item${count === 1 ? "" : "s"}`);
  }
};

// ---- Toast ----
// ---- Checkout Leads (HS-20260819-02, post-launch growth funnel) ----
// A persistent per-checkout leadId (reused for the whole session, not
// regenerated per request) lets the server upsert one Leads row instead of
// duplicating it on every Confirm Delivery resubmit, and lets the Meta
// Pixel/CAPI Lead events share one event_id for dedup. Entirely additive:
// never touches Cart/Orders/idempotency.
const Leads = {
  KEY: "hoja_lead_id",
  id() {
    let id;
    try { id = localStorage.getItem(this.KEY); } catch { id = null; }
    if (!id) {
      id = "lead-" + createIdempotencyKey();
      try { localStorage.setItem(this.KEY, id); } catch { /* ignore storage errors */ }
    }
    return id;
  },
  cookie(name) {
    const match = String(document.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  },
  // Shared with both save() and sendAttribution() so the two requests'
  // customer/items/attribution fields never drift apart.
  requestFields(delivery) {
    return {
      leadId: this.id(),
      visitorId: (typeof PushGrowth !== "undefined" && PushGrowth.visitorId()) || "",
      customer: delivery,
      items: Cart.flatLines().map(l => ({ productId: l.p.id, quantity: l.qty })),
      fbp: this.cookie("_fbp"),
      fbc: this.cookie("_fbc"),
      userAgent: (typeof navigator !== "undefined" && navigator.userAgent) || "",
      pageUrl: location.href,
      utmSource: new URLSearchParams(location.search).get("utm_source") || ""
    };
  },
  // Fires on a valid Confirm Delivery submission, before Payment. Never
  // blocks checkout: any failure resolves to null and the caller proceeds
  // to Payment regardless. HS-20260820-02: bounded with an 8s timeout
  // (this call now only does the essential Lead write server-side, so a
  // real response is expected in well under that -- a hang past 8s means
  // something is genuinely wrong, not just slow, and must fail visibly
  // rather than leave the button looking stuck forever) -- CAPI/push
  // attribution moved to the separate, non-awaited sendAttribution() call
  // below, so this response no longer waits on them.
  async save(delivery) {
    if (!CONFIG.SHEET_WEBHOOK_URL) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(CONFIG.SHEET_WEBHOOK_URL, {
        method: "POST",
        body: JSON.stringify({ type: "saveLead", ...this.requestFields(delivery) }),
        signal: controller.signal
      });
      return await res.json();
    } catch (e) { console.warn("Lead save failed, checkout continues:", e); return null; }
    finally { clearTimeout(timeout); }
  },
  // Non-awaited by design (HS-20260820-02) -- CAPI Lead + push
  // attribution, fired right after a successful, genuinely-new saveLead
  // response. Never blocks Payment navigation; any failure here is
  // invisible to the customer, matching the previous best-effort contract.
  sendAttribution(delivery) {
    if (!CONFIG.SHEET_WEBHOOK_URL) return;
    try {
      fetch(CONFIG.SHEET_WEBHOOK_URL, {
        method: "POST",
        body: JSON.stringify({ type: "leadAttribution", ...this.requestFields(delivery) })
      }).catch(() => {});
    } catch { /* best-effort only */ }
  },
  // Abandonment-reason telemetry -- best-effort, non-blocking, never fires
  // another Meta Lead event.
  async updateStatus(status, abandonReason) {
    if (!CONFIG.SHEET_WEBHOOK_URL) return null;
    try {
      const res = await fetch(CONFIG.SHEET_WEBHOOK_URL, {
        method: "POST",
        body: JSON.stringify({ type: "updateLeadStatus", leadId: this.id(), status, abandonReason: abandonReason || "" })
      });
      return await res.json();
    } catch (e) { console.warn("Lead status update failed:", e); return null; }
  }
};

const Toast = {
  show(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(this._timer);
    this._timer = setTimeout(() => t.classList.remove("show"), 2200);
  }
};

// ---- Analytics: GA4 (gtag) + Meta Pixel, mirrored events, deduplicated ----
// Both trackers are no-ops until CONFIG.GA4_MEASUREMENT_ID / META_PIXEL_ID
// are filled in (see js/config.js) — calling these functions is always
// safe even with nothing configured.
//
// Dedup strategy:
//  - SPA page_view is fired exactly once per route change here, with the
//    initial automatic gtag pageview disabled (send_page_view:false in
//    index.html) — otherwise the first route gets counted twice.
//  - add_to_cart / remove_from_cart only fire on an actual quantity delta
//    (never on a plain re-render), so ordinary UI redraws can't replay them.
//  - view_cart only fires on real navigation into the Summary page, not on
//    every quantity edit made while already there.
//  - purchase/Purchase fires once per order, keyed by a single generated
//    orderId used as BOTH the GA4 transaction_id and the Meta eventID —
//    the standard way to prevent Pixel/Conversions-API double counting if
//    server-side tracking is added later. The submit button is disabled
//    during submission so a double click can't fire it twice either.
const Analytics = {
  hasGA() { return typeof window.gtag === "function" && !!CONFIG.GA4_MEASUREMENT_ID; },
  hasMeta() { return typeof window.fbq === "function" && !!CONFIG.META_PIXEL_ID; },

  // Purchase-dedupe (HS-20260819-13): a small rolling list of Order IDs
  // this browser has already fired Purchase for, so a bfcache restore or
  // any other unexpected re-entry into the confirmation path can never
  // double-fire the same Order ID. Capped so it can't grow unbounded.
  PURCHASE_LOG_KEY: "hoja_purchase_fired",
  hasFiredPurchase(orderId) {
    try { return (JSON.parse(localStorage.getItem(this.PURCHASE_LOG_KEY)) || []).includes(orderId); }
    catch { return false; }
  },
  markPurchaseFired(orderId) {
    try {
      const log = (JSON.parse(localStorage.getItem(this.PURCHASE_LOG_KEY)) || []).filter(id => id !== orderId);
      log.push(orderId);
      localStorage.setItem(this.PURCHASE_LOG_KEY, JSON.stringify(log.slice(-20)));
    } catch { /* best-effort only */ }
  },

  gaItem(p, qty) {
    return { item_id: p.id, item_name: p.name, item_category: (CATEGORY_META[p.cat] || {}).label || p.cat, price: p.price, quantity: qty || 1 };
  },

  pageview(view, title) {
    if (this.hasGA()) gtag("event", "page_view", { page_path: "/" + view, page_title: title, page_location: location.href });
    if (this.hasMeta()) fbq("track", "PageView");
  },
  viewItemList(cat, products) {
    if (this.hasGA()) gtag("event", "view_item_list", {
      item_list_id: cat, item_list_name: CATEGORY_META[cat].label,
      items: products.map(p => this.gaItem(p))
    });
    if (this.hasMeta()) fbq("track", "ViewContent", { content_type: "product_group", content_category: cat, content_ids: products.map(p => p.id) });
  },
  addToCart(p, qty) {
    if (this.hasGA()) gtag("event", "add_to_cart", { currency: "PKR", value: p.price * qty, items: [this.gaItem(p, qty)] });
    if (this.hasMeta()) fbq("track", "AddToCart", { content_ids: [p.id], content_type: "product", value: p.price * qty, currency: "PKR" });
  },
  removeFromCart(p, qty) {
    if (this.hasGA()) gtag("event", "remove_from_cart", { currency: "PKR", value: p.price * qty, items: [this.gaItem(p, qty)] });
  },
  viewCart(lines, subtotal) {
    if (this.hasGA()) gtag("event", "view_cart", { currency: "PKR", value: subtotal, items: lines.map(l => this.gaItem(l.p, l.qty)) });
  },
  beginCheckout(lines, subtotal) {
    if (this.hasGA()) gtag("event", "begin_checkout", { currency: "PKR", value: subtotal, items: lines.map(l => this.gaItem(l.p, l.qty)) });
    if (this.hasMeta()) fbq("track", "InitiateCheckout", { value: subtotal, currency: "PKR", contents: lines.map(l => ({ id: l.p.id, quantity: l.qty })), content_type: "product" });
  },
  addShippingInfo(lines, subtotal) {
    if (this.hasGA()) gtag("event", "add_shipping_info", { currency: "PKR", value: subtotal, items: lines.map(l => this.gaItem(l.p, l.qty)) });
  },
  // Primary Meta campaign-optimization signal (HS-20260819-02): fires only
  // after the checkout Lead is confirmed saved server-side -- never on
  // form validation alone. One event per leadId (the caller only invokes
  // this on a genuinely new/confirmed save); LEAD-<leadId> is shared with
  // the server-side CAPI Lead call for Pixel/CAPI dedup.
  generateLead(leadId, lines, subtotal) {
    if (this.hasGA()) gtag("event", "generate_lead", { currency: "PKR", value: subtotal, items: lines.map(l => this.gaItem(l.p, l.qty)) });
    if (this.hasMeta()) fbq("track", "Lead", { currency: "PKR", value: subtotal, content_ids: lines.map(l => l.p.id), content_type: "product" }, { eventID: "LEAD-" + leadId });
  },
  addPaymentInfo(lines, subtotal, paymentMethod) {
    if (this.hasGA()) gtag("event", "add_payment_info", { currency: "PKR", value: subtotal, payment_type: paymentMethod, items: lines.map(l => this.gaItem(l.p, l.qty)) });
    if (this.hasMeta()) fbq("track", "AddPaymentInfo", { value: subtotal, currency: "PKR", contents: lines.map(l => ({ id: l.p.id, quantity: l.qty })) });
  },
  purchase(orderId, payload, lines) {
    if (this.hasGA()) gtag("event", "purchase", {
      transaction_id: orderId, currency: "PKR", value: payload.total, shipping: payload.deliveryFee,
      items: lines.map(l => this.gaItem(l.p, l.qty))
    });
    if (this.hasMeta()) fbq("track", "Purchase",
      { value: payload.total, currency: "PKR", contents: lines.map(l => ({ id: l.p.id, quantity: l.qty })), content_type: "product" },
      { eventID: "ORDER-" + orderId }
    );
  }
};

// ---- Sticky bottom commerce bar ----
// Label + action change with context: "View Cart" while browsing,
// "Continue to Delivery" on Summary, "Confirm Delivery" on the Delivery
// step (gated — it won't advance until the form is valid), then "Confirm
// & Place Order" on Payment.
function refreshStickyBar() {
  const bar = document.getElementById("stickyBar");
  const countEl = document.getElementById("sbCount");
  const totalEl = document.getElementById("sbTotal");
  const btn = document.getElementById("sbAction");
  if (!bar) return;
  const view = Router.current;
  const count = Cart.count();

  if (count === 0 || view === "confirmation" || view === "payment") {
    bar.style.display = "none";
    document.body.classList.remove("has-sticky-bar");
    return;
  }

  const subtotal = Cart.totalAmount();
  btn.disabled = false;
  btn.removeAttribute("form");
  btn.setAttribute("type", "button");
  btn.onclick = null;

  if (view === "delivery") {
    countEl.textContent = `${count} item${count === 1 ? "" : "s"}`;
    totalEl.textContent = `${CONFIG.CURRENCY} ${subtotal}`;
    btn.textContent = "Confirm Delivery";
    btn.setAttribute("form", "deliveryForm");
    btn.setAttribute("type", "submit");
  } else if (view === "payment" && Views._order) {
    countEl.textContent = `${count} item${count === 1 ? "" : "s"}`;
    totalEl.textContent = `${CONFIG.CURRENCY} ${Views._order.total}`;
    btn.textContent = "Review order below";
    btn.disabled = true;
    btn.removeAttribute("form");
    btn.setAttribute("type", "button");
    btn.classList.add("sticky-bar-status");
  } else if (view === "cart") {
    countEl.textContent = `${count} item${count === 1 ? "" : "s"}`;
    totalEl.textContent = `${CONFIG.CURRENCY} ${subtotal}`;
    btn.textContent = "Continue to Delivery →";
    btn.onclick = () => Router.go("delivery");
  } else {
    countEl.textContent = `${count} item${count === 1 ? "" : "s"}`;
    totalEl.textContent = `${CONFIG.CURRENCY} ${subtotal}`;
    btn.textContent = "View Cart & Checkout →";
    btn.onclick = () => Router.go("cart");
  }
  if (view !== "payment") btn.classList.remove("sticky-bar-status");
  bar.style.display = "flex";
  document.body.classList.add("has-sticky-bar");
}

// ---- Journey / progress indicator (Summary, Delivery, Payment, Confirmed) ----
function journeyBarHTML(step) {
  const labels = ["Summary", "Delivery", "Payment", "Confirmed"];
  return `<div class="journey-bar">${labels.map((label, i) => {
    const n = i + 1;
    let cls = "";
    if (step === 4) cls = "done";
    else if (n < step) cls = "done";
    else if (n === step) cls = "active";
    const symbol = cls === "done" ? "✓" : n;
    const line = i < labels.length - 1 ? `<div class="journey-line"></div>` : "";
    return `<div class="journey-step ${cls}"><span class="jn">${symbol}</span><span class="jl">${label}</span></div>${line}`;
  }).join("")}</div>`;
}

// Delivery-page free-delivery conversion notice. Threshold/fee always read
// live from Settings — never hardcoded — so a Super Admin change is
// reflected immediately. Advance-only; never implies COD gets free delivery.
function deliveryUpsellHTML(subtotal) {
  const r = Settings.get();
  if (subtotal >= r.FREE_DELIVERY_THRESHOLD) {
    return `<div class="delivery-upsell qualified"><span class="du-icon" aria-hidden="true">✓</span><span class="du-text">Your order qualifies for FREE delivery with Advance Payment.</span></div>`;
  }
  const remaining = r.FREE_DELIVERY_THRESHOLD - subtotal;
  return `<div class="delivery-upsell">
    <div class="du-head"><span class="du-icon" aria-hidden="true">🚚</span><div class="du-text">Add ${CONFIG.CURRENCY} ${remaining} more and pay in advance to unlock FREE delivery.</div></div>
    <div class="du-sub">Advance delivery below ${CONFIG.CURRENCY} ${r.FREE_DELIVERY_THRESHOLD}: ${CONFIG.CURRENCY} ${r.ADVANCE_DELIVERY_FEE}</div>
    <button type="button" class="btn btn-secondary du-btn" onclick="Router.go(Router.lastCategory)">Add More Seeds</button>
  </div>`;
}

// Status chips shown under the journey bar on Delivery/Payment/Confirmed —
// makes it obvious at a glance what's already locked in.
function flowStatusHTML(deliveryConfirmed, paymentConfirmed) {
  return `<div class="flow-status">
    <span class="fs-item ${deliveryConfirmed ? "done" : ""}">Delivery: ${deliveryConfirmed ? "Confirmed ✓" : "Pending"}</span>
    <span class="fs-item ${paymentConfirmed ? "done" : ""}">Payment: ${paymentConfirmed ? "Confirmed ✓" : "Pending"}</span>
  </div>`;
}

// ---- Router ----
const PAGE_TITLES = {
  home: "Hoja Seeds — Vegetable, Flower & Mix Seeds",
  vegetables: "Vegetable Seeds — Hoja Seeds",
  flowers: "Flower Seeds — Hoja Seeds",
  mix: "Mix Seed Kits — Hoja Seeds",
  fertilizer: "Fertilizer — Hoja Seeds",
  contact: "Contact — Hoja Seeds",
  cart: "Your Cart — Hoja Seeds",
  delivery: "Delivery Details — Hoja Seeds",
  payment: "Payment — Hoja Seeds",
  confirmation: "Order Confirmed — Hoja Seeds"
};

function popularGridHTML(popular) {
  return popular.map(p => `
    <article class="popular-card">
      <div class="popular-media">${p.image_url ? `<img src="${p.image_url}" alt="${escapeHTML(p.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">` : p.icon}</div>
      <span class="popular-name">${escapeHTML(p.name)}</span>
      <span class="popular-price mono">${CONFIG.CURRENCY} ${p.price}</span>
      <button class="popular-add" onclick="Router.go('${p.cat}')">Add</button>
    </article>`).join("");
}

// ---- Rotating category hero (HS-20260818-31) ----
// Reuses the same existing R2 category photos already used by the category
// tiles below — no new/scraped imagery. First slide loads eager+high
// priority (it is the page's LCP element); the other three are
// loading="lazy" so they never compete with it on first paint. Fixed
// aspect-ratio box (see CSS) avoids CLS regardless of which slide is active.
const HERO_SLIDES = [
  { cat: "vegetables", label: "Vegetable Seeds", img: "https://images.hojaseeds.pk/categories/vegetable-seeds.webp" },
  { cat: "flowers", label: "Flower Seeds", img: "https://images.hojaseeds.pk/categories/flower-seeds.webp" },
  { cat: "mix", label: "Mix Seeds", img: "https://images.hojaseeds.pk/categories/mix-seeds.webp" },
  { cat: "fertilizer", label: "Fertilizer", img: "https://images.hojaseeds.pk/categories/fertilizer.webp" }
];

// Slides 1-3 use data-src, not src: they sit absolutely-stacked in the same
// on-screen box as the active slide (only opacity differs), so the browser
// treats them as already in-viewport and native loading="lazy" does NOT
// defer them there — measured via Lighthouse network trace, all 4 hero
// photos (~309KB) were fetching on first load. HeroCarousel.hydrateRest()
// swaps data-src -> src after the page settles, well before the 5s
// autoplay can reach them.
function heroCarouselHTML() {
  const slides = HERO_SLIDES.map((s, i) => `
    <button type="button" class="hero-slide${i === 0 ? " active" : ""}" data-idx="${i}" onclick="Router.go('${s.cat}')" aria-label="Shop ${s.label}">
      <img ${i === 0 ? `src="${s.img}" loading="eager" fetchpriority="high"` : `data-src="${s.img}"`} alt="${s.label}" decoding="async">
      <span class="hero-slide-label">${s.label}</span>
    </button>`).join("");
  const dots = HERO_SLIDES.map((s, i) => `<button type="button" class="hero-dot${i === 0 ? " active" : ""}" data-idx="${i}" role="tab" aria-selected="${i === 0}" aria-label="Show ${s.label} slide" onclick="HeroCarousel.goTo(${i})"></button>`).join("");
  return `
    <div class="hero-carousel" id="heroCarousel" role="region" aria-roledescription="carousel" aria-label="Featured categories">
      <div class="hero-slides">${slides}</div>
      <button type="button" class="hero-nav prev" aria-label="Previous slide" onclick="HeroCarousel.prev()">‹</button>
      <button type="button" class="hero-nav next" aria-label="Next slide" onclick="HeroCarousel.next()">›</button>
      <div class="hero-carousel-controls">
        <div class="hero-dots" role="tablist" aria-label="Choose slide">${dots}</div>
      </div>
      <button type="button" class="hero-pause" id="heroPause" aria-label="Pause slideshow" aria-pressed="false" onclick="HeroCarousel.togglePause()">⏸</button>
    </div>`;
}

const HeroCarousel = {
  index: 0,
  timer: null,
  paused: false,
  root: null,

  init() {
    this.root = document.getElementById("heroCarousel");
    if (!this.root) return;
    this.index = 0;
    this.paused = false;
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.root.addEventListener("mouseenter", () => this.pause(false));
    this.root.addEventListener("mouseleave", () => this.resume(false));
    this.root.addEventListener("focusin", () => this.pause(false));
    this.root.addEventListener("focusout", () => this.resume(false));
    let touchStartX = null;
    this.root.addEventListener("touchstart", e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    this.root.addEventListener("touchend", e => {
      if (touchStartX == null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      touchStartX = null;
      if (Math.abs(dx) < 40) return;
      this.userInteract();
      if (dx < 0) this.next(); else this.prev();
    }, { passive: true });
    if (!reduceMotion) this.start();
    // Defer the other 3 slide photos until the page has settled (idle, or a
    // short timeout as a fallback) so they never compete with the first
    // slide — the actual LCP resource — on initial load.
    const hydrate = () => this.hydrateRest();
    if ("requestIdleCallback" in window) window.requestIdleCallback(hydrate, { timeout: 2000 });
    else setTimeout(hydrate, 1500);
  },
  hydrateRest() {
    if (!this.root || !this.root.querySelectorAll) return;
    this.root.querySelectorAll(".hero-slide img[data-src]").forEach(img => {
      img.src = img.dataset.src;
      img.removeAttribute("data-src");
    });
  },
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.root = null;
  },
  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.next(), 5000);
  },
  pause(manual) {
    clearInterval(this.timer);
    this.timer = null;
    if (manual) {
      this.paused = true;
      const btn = document.getElementById("heroPause");
      if (btn) { btn.textContent = "▶"; btn.setAttribute("aria-label", "Resume slideshow"); btn.setAttribute("aria-pressed", "true"); }
    }
  },
  resume(manual) {
    if (this.paused && !manual) return; // stays paused until the user explicitly resumes
    if (manual) {
      this.paused = false;
      const btn = document.getElementById("heroPause");
      if (btn) { btn.textContent = "⏸"; btn.setAttribute("aria-label", "Pause slideshow"); btn.setAttribute("aria-pressed", "false"); }
    }
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!this.paused && !reduceMotion) this.start();
  },
  togglePause() { if (this.paused) this.resume(true); else this.pause(true); },
  userInteract() { this.start(); }, // manual nav resets the auto-rotate timer without leaving it paused
  goTo(i) {
    if (!this.root) return;
    this.index = (i + HERO_SLIDES.length) % HERO_SLIDES.length;
    // Safety net: if the user navigates (dots/swipe/keyboard) before the
    // idle hydration above has run, load that specific slide's photo now
    // instead of showing it blank.
    const targetImg = this.root.querySelector ? this.root.querySelector(`.hero-slide[data-idx="${this.index}"] img[data-src]`) : null;
    if (targetImg) { targetImg.src = targetImg.dataset.src; targetImg.removeAttribute("data-src"); }
    const slides = this.root.querySelectorAll ? this.root.querySelectorAll(".hero-slide") : [];
    slides.forEach((el, idx) => el.classList.toggle("active", idx === this.index));
    const dots = this.root.querySelectorAll ? this.root.querySelectorAll(".hero-dot") : [];
    dots.forEach((el, idx) => {
      el.classList.toggle("active", idx === this.index);
      el.setAttribute("aria-selected", idx === this.index);
    });
    if (!this.paused) this.userInteract();
  },
  next() { this.goTo(this.index + 1); },
  prev() { this.goTo(this.index - 1); }
};

function exploreMoreHTML(currentCategory) {
  const categories = ["vegetables", "flowers", "mix", "fertilizer"].filter(cat => cat !== currentCategory);
  return `<section class="explore-more" aria-labelledby="explore-more-title">
    <h3 id="explore-more-title">Explore More</h3>
    <div class="explore-more-grid">
      ${categories.map(cat => `
        <button class="explore-card" data-cat="${cat}" type="button" onclick="Router.go('${cat}')" aria-label="Browse ${CATEGORY_META[cat].label}">
          <span class="explore-card-label">${CATEGORY_META[cat].tagline}</span>
          <span class="explore-card-name">${CATEGORY_META[cat].label}<span class="explore-card-arrow">→</span></span>
        </button>`).join("")}
    </div>
  </section>`;
}

const Router = {
  current: "home",
  lastCategory: "vegetables",
  go(view) {
    this.current = view;
    document.querySelectorAll(".nav-tab").forEach(b => b.classList.toggle("active", b.dataset.cat === view));
    document.querySelectorAll(".quick-category-btn").forEach(b => b.classList.toggle("active", b.dataset.cat === view));
    document.getElementById("navTabs").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.title = PAGE_TITLES[view] || "Hoja Seeds";
    Views.render(view);
    refreshStickyBar();
    Analytics.pageview(view, document.title);
  }
};

// ---- Views ----
const Views = {
  // Accumulates delivery + payment details across the Delivery/Payment
  // steps so a back-navigation doesn't lose what was already entered.
  _order: null,

  render(view) {
    const app = document.getElementById("app");
    if (view !== "home") HeroCarousel.stop();
    if (view === "home") {
      const html = this.home();
      // Skip a redundant full-page reflow when the fallback-vs-live-data
      // render is actually byte-identical -- the common case (live Sheet
      // catalog matches the local fallback unless Admin has changed
      // something). Router.go("home") runs twice during boot (immediate
      // fallback, then again once Prices/Settings resolve); replacing
      // #app.innerHTML a second time with identical content was a
      // confirmed CLS source (HS-20260818-32/33: a large single-frame
      // layout recalculation around the footer). A real content change
      // (e.g. an Admin price update) still produces a different string
      // and re-renders normally.
      if (this._lastHomeHTML !== html) {
        this._lastHomeHTML = html;
        app.innerHTML = html;
        HeroCarousel.init();
      }
      if (!Popularity.get()) this.refreshPopular();
      return;
    }
    if (["vegetables", "flowers", "mix", "fertilizer"].includes(view)) return this.category(view);
    if (view === "contact") return app.innerHTML = this.contact();
    if (view === "cart") return this.cart();
    if (view === "delivery") return this.delivery();
    if (view === "payment") return this.payment();
  },

  home() {
    const products = Prices.get();
    const catCounts = {};
    products.forEach(p => catCounts[p.cat] = (catCounts[p.cat] || 0) + 1);
    const popular = pickPopularProducts(products, Popularity.get());
    return `
      <section class="hero">
        ${heroCarouselHTML()}
        <div class="hero-panel">
          <div class="hero-inner">
            <h1>Good seeds. Better harvests.</h1>
            <p>Seeds for home gardens across Pakistan.</p>
            <div class="cta-row">
              <button class="btn btn-primary" onclick="Router.go('vegetables')">Shop Seeds</button>
              <button class="btn btn-secondary" onclick="Router.go('mix')">Browse Mix Kits</button>
            </div>
          </div>
        </div>
      </section>
      <div class="cat-grid">
        ${["vegetables", "flowers", "mix", "fertilizer"].map(cat => `
          <div class="cat-tile" data-cat="${cat}">
            <button class="cat-tile-btn" onclick="Router.go('${cat}')" aria-label="${CATEGORY_META[cat].label}"></button>
            <div class="cat-tile-photo"></div>
            <div class="cat-tile-content">
              <span class="name">${CATEGORY_META[cat].label}</span>
              <span class="count">${catCounts[cat] || 0} varieties</span>
            </div>
          </div>`).join("")}
      </div>
      <section class="popular-strip" aria-labelledby="popular-title">
        <h2 class="section-title" id="popular-title">Popular Seeds</h2>
        <div class="popular-grid" id="popularGrid">
          ${popularGridHTML(popular)}
        </div>
      </section>
      <div class="trust-row">
        <div class="trust-chip"><span class="ic">🚚</span>Nationwide Delivery</div>
        <div class="trust-chip"><span class="ic">💵</span>Cash on Delivery</div>
        <div class="trust-chip"><span class="ic">🌱</span>Fresh Seed Stock</div>
      </div>`;
  },

  // Fetches the real sold-quantity ranking in the background and re-sorts
  // the already-rendered Popular Seeds grid in place — never blocks or
  // re-renders the header/hero/categories, and no-ops if the customer has
  // since navigated away from home.
  async refreshPopular() {
    const ranking = await Popularity.load();
    if (!ranking || Router.current !== "home") return;
    const grid = document.getElementById("popularGrid");
    if (!grid) return;
    grid.innerHTML = popularGridHTML(pickPopularProducts(Prices.get(), ranking));
  },

  category(cat) {
    const app = document.getElementById("app");
    const meta = CATEGORY_META[cat];
    const products = Prices.get().filter(p => p.cat === cat);
    const items = Cart.items();
    const r = Settings.get();
    Router.lastCategory = cat;
    app.innerHTML = `
      <section class="page">
        <div class="page-head">
          <div class="eyebrow">${meta.label}</div>
          <h2>${meta.label}</h2>
          <p class="tagline">${meta.tagline}</p>
        </div>
        <div class="commerce-info-bar" aria-label="Delivery and payment information">
          ${r.COD_ALLOWED && cat !== "vegetables" && cat !== "flowers" ? `<div class="trust-chip"><span class="ic">💵</span>COD Available</div>` : ""}
          <div class="trust-chip"><span class="ic">🚚</span>Advance Delivery ${CONFIG.CURRENCY} ${r.ADVANCE_DELIVERY_FEE}</div>
          <div class="trust-chip"><span class="ic">🌱</span>Free Delivery ${CONFIG.CURRENCY} ${r.FREE_DELIVERY_THRESHOLD}+</div>
        </div>
        <div class="product-list">
          ${products.map(p => {
            const qty = items[p.id] || 0;
             return commerceProductCardHTML(p, qty);
          }).join("")}
        </div>
        ${exploreMoreHTML(cat)}
      </section>`;
    Analytics.viewItemList(cat, products);
  },

  changeQty(id, delta) {
    const current = Cart.qtyOf(id);
    const next = Math.max(0, current + delta);
    Cart.setQty(id, next);

    const qtyEl = document.getElementById(`qty-${id}`);
    const selEl = document.getElementById(`sel-${id}`);
    const totEl = document.getElementById(`tot-${id}`);
    const p = Prices.get().find(p => p.id === id);
    if (qtyEl) qtyEl.textContent = next;
    if (selEl) {
      selEl.innerHTML = inCartStatusHTML(next);
      selEl.style.display = next > 0 ? "" : "none";
    }
    if (totEl) {
      totEl.innerHTML = selectedTotalHTML(next * p.price);
      totEl.style.display = "";
    }
    const row = document.querySelector(`[data-product-id="${id}"]`);
    if (row) {
      row.classList.toggle("in-cart", next > 0);
      row.setAttribute("aria-label", `${p.name}${next > 0 ? `, in cart, ${next} packet${next === 1 ? "" : "s"}, ${CONFIG.CURRENCY} ${next * p.price} selected` : ""}`);
    }
    const live = document.getElementById("liveAnnouncement");
    if (live) live.textContent = `${p.name}: ${next > 0 ? `In cart, quantity ${next}` : "removed from cart"}`;
    if (next > current) Analytics.addToCart(p, next - current);
    else if (next < current) Analytics.removeFromCart(p, current - next);
    if (current === 0 && next === 1) Toast.show("Added to cart");
  },

  contact() {
    return `
      <section class="page">
        <div class="page-head">
          <div class="eyebrow">Contact</div>
          <h2>Get in touch</h2>
          <p class="tagline">Questions about an order, bulk pricing, or planting advice — we're happy to help.</p>
        </div>
        <div class="contact-grid">
          <div class="contact-info-card">
            <div class="row"><span class="ic">📞</span><div><strong>Phone / WhatsApp</strong><br>+92 3XX XXXXXXX</div></div>
            <div class="row"><span class="ic">✉️</span><div><strong>Email</strong><br>hello@hojaseeds.pk</div></div>
            <div class="row"><span class="ic">🕒</span><div><strong>Hours</strong><br>Mon–Sat, 10am–7pm</div></div>
            <div class="row"><span class="ic">🚚</span><div><strong>Delivery</strong><br>Nationwide — pay Cash on Delivery, or send an advance via JazzCash, EasyPaisa or bank transfer</div></div>
          </div>
          <div class="form-card">
            <h3>Send a message</h3>
            <form onsubmit="Views.submitContact(event)">
              <div class="field"><label for="c-name">Name</label><input id="c-name" required></div>
              <div class="field"><label for="c-phone">Phone</label><input id="c-phone" required></div>
              <div class="field"><label for="c-msg">Message</label><textarea id="c-msg" rows="4" required></textarea></div>
              <button class="inline-submit" type="submit">Send Message</button>
              <div id="contactStatus"></div>
            </form>
          </div>
        </div>
      </section>`;
  },

  async submitContact(e) {
    e.preventDefault();
    const payload = {
      type: "contact",
      name: document.getElementById("c-name").value,
      phone: document.getElementById("c-phone").value,
      message: document.getElementById("c-msg").value,
      timestamp: new Date().toISOString()
    };
    const status = document.getElementById("contactStatus");
    const result = await Orders.submit(payload);
    status.innerHTML = result.ok
      ? `<div class="order-status ok">Thanks — we'll get back to you shortly.</div>`
      : `<div class="order-status err">Couldn't send right now. Please WhatsApp/call us instead.</div>`;
    if (result.ok) e.target.reset();
  },

  // ── Step 1: Order Summary — grouped by category, not a mixed list ──
  cart(trackView = true) {
    const app = document.getElementById("app");
    const byCat = Cart.linesByCategory();
    const cats = Object.keys(byCat);
    let subtotal = 0;
    cats.forEach(cat => byCat[cat].forEach(l => subtotal += l.line));

    const groupsHTML = cats.map(cat => {
      const catSubtotal = byCat[cat].reduce((s, l) => s + l.line, 0);
       const rows = byCat[cat].map(({ p, qty }) => commerceProductCardHTML(p, qty, "cart")).join("");
      return `<div class="cat-group-title">${CATEGORY_META[cat].label}</div>${rows}<div class="cat-group-subtotal">Subtotal: ${CONFIG.CURRENCY} ${catSubtotal}</div>`;
    }).join("");

    app.innerHTML = `
      <section class="page narrow">
        ${journeyBarHTML(1)}
        <div class="page-head"><h2>Your Cart</h2>${cats.length ? `<p class="tagline">Review your seeds before delivery</p>` : ""}${Cart.hasCustomDraft() ? `<button type="button" class="btn-text-secondary" onclick="Views.restoreCustomOrder()">Restore Custom Order</button>` : ""}</div>
        ${cats.length ? `
          <div id="cartLines">${groupsHTML}</div>
          <div class="cart-summary-card">
            <div class="summary-line"><span>Items</span><span class="mono">${Cart.count()}</span></div>
            <div class="summary-line"><span>Items subtotal</span><span class="mono">${CONFIG.CURRENCY} ${subtotal}</span></div>
            <div class="summary-line"><span>Delivery</span><span>Calculated at payment</span></div>
            <div class="summary-line total"><span>Current payable</span><span class="mono">${CONFIG.CURRENCY} ${subtotal} + delivery</span></div>
          </div>
          <div class="cta-split">
            <button class="btn btn-secondary" style="background:var(--kraft);color:var(--ink);border:1px solid var(--kraft-dark)" onclick="Router.go('${Router.lastCategory}')">← Continue Shopping</button>
            <button class="btn btn-primary" onclick="Router.go('delivery')">Continue to Delivery →</button>
          </div>
        ` : `
          <div class="empty-cart-block">
            <span class="ic">🧺</span>
            <p>Your cart is empty</p>
            <div class="cta-split" style="margin-top:14px">
              <button class="btn btn-primary" onclick="Router.go('vegetables')">Shop Vegetable Seeds</button>
              <button class="btn btn-secondary" style="background:var(--kraft);color:var(--ink);border:1px solid var(--kraft-dark)" onclick="Router.go('flowers')">Explore Flower Seeds</button>
            </div>
          </div>`}
      </section>`;

    if (trackView && cats.length) Analytics.viewCart(Cart.flatLines(), subtotal);
  },

  cartChangeQty(id, delta) {
    const current = Cart.qtyOf(id);
    const next = Math.max(0, current + delta);
    const p = Prices.get().find(p => p.id === id);
    Cart.setQty(id, next);
    if (next > current) Analytics.addToCart(p, next - current);
    else if (next < current) Analytics.removeFromCart(p, current - next);
    this.cart(false); // re-render to stay in sync, but don't refire view_cart for a plain edit
  },

  // ── Step 2: Delivery — gated; button stays "Confirm Delivery" until valid ──
  delivery() {
    const app = document.getElementById("app");
    const lines = Cart.flatLines();
    if (!lines.length) {
      app.innerHTML = `<section class="page narrow">${journeyBarHTML(2)}
        <div class="page-head"><h2>Your cart's empty</h2><p class="tagline">Add some seeds before entering delivery details.</p></div>
        <button class="btn btn-primary" onclick="Router.go('vegetables')">Browse Vegetable Seeds</button></section>`;
      return;
    }
    const d = (this._order && this._order.delivery) || {};
    const subtotal = Cart.totalAmount();
    app.innerHTML = `
      <section class="page narrow">
        ${journeyBarHTML(2)}
        ${flowStatusHTML(false, false)}
        <div class="step-nav-row"><button class="back-link" onclick="Router.go('cart')">← Back to Summary</button></div>
        <div class="page-head"><h2>Delivery Details</h2><p class="tagline">Where should we send your order?</p></div>
        ${deliveryUpsellHTML(subtotal)}
        <div class="form-card">
          <form id="deliveryForm" onsubmit="Views.confirmDelivery(event)">
            <div class="field"><label for="o-name">Full name</label><input id="o-name" value="${escapeHTML(d.name || "")}" autocomplete="name" required><div class="field-error" id="o-name-error"></div></div>
            <div class="field"><label for="o-address">Delivery address</label><textarea id="o-address" rows="2" required>${escapeHTML(d.address || "")}</textarea><div class="field-error" id="o-address-error"></div></div>
            <div class="field-row">
              <div class="field"><label for="o-city">City</label><input id="o-city" value="${escapeHTML(d.city || "")}" autocomplete="address-level2" required><div class="field-error" id="o-city-error"></div></div>
              <div class="field"><label for="o-postal">Postal code (optional)</label><input id="o-postal" value="${escapeHTML(d.postal || "")}" inputmode="numeric" autocomplete="postal-code" maxlength="5"><div class="field-error" id="o-postal-error"></div></div>
            </div>
            <div class="field"><label for="o-phone">Phone number</label><input id="o-phone" type="tel" value="${escapeHTML(formatPakistanMobile(d.phone || ""))}" inputmode="numeric" autocomplete="tel" placeholder="0335-4299783" maxlength="12" oninput="formatPakistanMobileInput(this)" required><div class="field-error" id="o-phone-error"></div></div>
            <div class="field"><label for="o-notes">Order notes (optional)</label><textarea id="o-notes" rows="2" maxlength="500">${escapeHTML(d.notes || "")}</textarea></div>
            <button class="inline-submit" type="submit" id="deliverySubmitBtn">Confirm Delivery</button>
            <div id="deliveryStatus"></div>
          </form>
          <div class="step-actions-secondary">
            <button type="button" class="btn-text-secondary" onclick="Router.go('cart')">← Back to Order Summary</button>
            <button type="button" class="btn-text-tertiary" onclick="Router.go(Router.lastCategory)">Continue Shopping</button>
          </div>
        </div>
      </section>`;

    this._order = this._order || {};
    if (!this._order.beganCheckoutTracked) {
      Analytics.beginCheckout(lines, Cart.totalAmount());
      this._order.beganCheckoutTracked = true;
    }
  },

  async confirmDelivery(e) {
    e.preventDefault();
    const delivery = {
      name: document.getElementById("o-name").value.trim(),
      phone: formatPakistanMobile(document.getElementById("o-phone").value),
      address: document.getElementById("o-address").value.trim(),
      city: document.getElementById("o-city").value.trim(),
      postal: document.getElementById("o-postal").value.trim(),
      notes: document.getElementById("o-notes").value.trim(),
    };
    const errors = validateDelivery(delivery);
    document.querySelectorAll(".field-error").forEach(el => el.textContent = "");
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      Object.entries(errors).forEach(([field, message]) => {
        const errorEl = document.getElementById(`o-${field}-error`);
        if (errorEl) errorEl.textContent = message;
      });
      document.getElementById(`o-${firstError}`)?.focus();
      document.getElementById("deliveryStatus").innerHTML = `<div class="order-status err">Please correct the highlighted delivery details.</div>`;
      return;
    }
    // Single-flight guard (HS-20260820-02): a rapid double-click on
    // Confirm Delivery must never start a second saveLead request while
    // the first is still in flight.
    if (this._confirmingDelivery) return;
    this._confirmingDelivery = true;

    this._order = this._order || {};
    this._order.delivery = delivery;

    // Save the checkout Lead server-side BEFORE Payment (HS-20260819-02).
    // This never blocks checkout: a save failure still lets the customer
    // continue to Payment, it just skips the Lead-specific analytics below
    // (which must only fire once the details are confirmed saved).
    // HS-20260820-02: immediate visible busy state (previously only
    // `disabled` with no label/spinner change -- DevTools-traced evidence
    // showed the button silently doing nothing for ~5.6s, which is
    // exactly what "appears stuck" means from the customer's side).
    const submitBtn = document.getElementById("deliverySubmitBtn");
    const stickyBtn = document.getElementById("sbAction");
    const originalSubmitLabel = submitBtn ? submitBtn.textContent : "";
    const originalStickyLabel = stickyBtn ? stickyBtn.textContent : "";
    if (submitBtn) { submitBtn.disabled = true; submitBtn.setAttribute("aria-busy", "true"); submitBtn.textContent = "Saving delivery…"; }
    if (stickyBtn) { stickyBtn.disabled = true; stickyBtn.setAttribute("aria-busy", "true"); stickyBtn.textContent = "Saving delivery…"; }
    let leadResult = null;
    try { leadResult = await Leads.save(delivery); }
    finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.removeAttribute("aria-busy"); submitBtn.textContent = originalSubmitLabel; }
      if (stickyBtn) { stickyBtn.disabled = false; stickyBtn.removeAttribute("aria-busy"); stickyBtn.textContent = originalStickyLabel; }
      this._confirmingDelivery = false;
    }

    Analytics.addShippingInfo(Cart.flatLines(), Cart.totalAmount());
    if (leadResult && leadResult.ok) {
      Analytics.generateLead(Leads.id(), Cart.flatLines(), Cart.totalAmount());
      // Fire-and-forget (HS-20260820-02): CAPI Lead + push attribution no
      // longer block this navigation -- same "only on a genuinely new
      // lead" gate the server used to apply internally.
      if (leadResult.isNew) Leads.sendAttribution(delivery);
    }
    Router.go("payment");
  },

  // ── Step 3: Payment ──────────────────────────────────────
  payment() {
    const app = document.getElementById("app");
    const lines = Cart.flatLines();
    if (!lines.length) {
      app.innerHTML = `<section class="page narrow">${journeyBarHTML(3)}
        <div class="page-head"><h2>Your cart's empty</h2></div>
        <button class="btn btn-primary" onclick="Router.go('vegetables')">Browse Vegetable Seeds</button></section>`;
      return;
    }
    if (!this._order || !this._order.delivery) {
      // Guard: don't allow reaching Payment without a confirmed delivery step.
      Router.go("delivery");
      return;
    }
    const r = Settings.get();
    const hasCustomized = lines.some(l => l.p.type === "customized-collection");
    // Cart-based payment-policy matrix: "cod" carts (fixed Mix Packs and/or
    // Fertilizer — nothing individually-selected) may use Cash on Delivery;
    // "advance_or_split"/"advance_only" carts (any individually selected
    // vegetable/flower packet, or a customized-collection kit) may not.
    const cartPolicy = cartPaymentPolicy(lines);
    const codAllowed = cartPolicy === "cod" && r.COD_ALLOWED;
    const splitAllowed = cartPolicy === "advance_or_split";
    const containsMixPack = lines.some(l => productPaymentPolicy(l.p) === "cod" && l.p.cat === "mix");
    const subtotal = lines.reduce((s, l) => s + l.line, 0);
    const defaultMethod = codAllowed ? "Cash on Delivery" : "Advance Payment";
    const defaultPreview = paymentPreview(defaultMethod, subtotal);
    this._order.subtotal = subtotal;
    this._order.deliveryFee = defaultPreview.deliveryFee;
    this._order.total = defaultPreview.orderTotal;
    this._order.codAllowed = codAllowed;
    this._order.splitAllowed = splitAllowed;
    const paymentSettings = Settings.get();
    const advanceMethods = [
      { id: "JazzCash", label: "JazzCash", enabled: paymentSettings.JAZZCASH_ENABLED },
      { id: "EasyPaisa", label: "EasyPaisa", enabled: paymentSettings.EASYPAISA_ENABLED },
      { id: "Bank Transfer", label: "Bank Transfer", enabled: paymentSettings.BANK_ENABLED },
      // Triple-gated (HS-20260820-01, tightened HS-20260821-08):
      // CONFIG.APG_SANDBOX_MODE (frontend build flag) AND the server's
      // own APG_ENABLED Settings flag AND an explicit ?apg_test=1 in the
      // URL must ALL be true. The third gate exists specifically so
      // APG_ENABLED can be turned on for a real controlled sandbox test
      // without instantly exposing the tab to every ordinary visitor
      // browsing the live site at that moment -- only someone who was
      // given the test link sees it. Never shown to real customers until
      // sandbox E2E has fully passed and this gate is deliberately
      // relaxed.
      { id: "Bank Alfalah APG", label: "Card / Bank / Wallet (Bank Alfalah)", enabled: CONFIG.APG_SANDBOX_MODE && paymentSettings.APG_ENABLED && apgTestAccessGranted() }
    ].filter(method => method.enabled);
    // Collapsed by default (HS-20260819-04): no advance channel is
    // pre-selected on first load of this page in a session — only a
    // channel the customer already explicitly clicked earlier this same
    // checkout is remembered across a back-and-forth to Delivery/Cart.
    const selectedAdvanceMethod = this._order.advanceMethod && advanceMethods.some(method => method.id === this._order.advanceMethod)
      ? this._order.advanceMethod : "";
    this._order.advanceMethod = selectedAdvanceMethod;

// Restricted note: customized-collection keeps its existing strict
  // advance-only copy; a custom-selection cart (vegetables/flowers) gets
  // the new explanatory copy instead of the old generic COD-unavailable line.
  const restrictedNote = !codAllowed
      ? `<div class="payment-restricted-note">${hasCustomized
          ? "Your selected seed packets are packed specially for your order. Choose Full Advance or Partial Advance below."
          : "Your selected seed packets are packed specially for your order. Choose Full Advance or Partial Advance below."}</div>`
      : (containsMixPack ? `<div class="pay-cod-banner premium-cod-card"><span class="pay-cod-badge premium-cod-badge">✓</span><div><strong>100% Cash on Delivery Available</strong><p>Pay nothing now · Pay ${CONFIG.CURRENCY} ${this._order.total} at your doorstep.</p></div></div>` : "");

    const codMixUpsell = !codAllowed ? this.codMixPackUpsellHTML() : "";

    // Per-method preview — each payment option, the summary, and the CTA all
    // read these same three paymentPreview() results (see module scope above).
    const codPreview = paymentPreview("Cash on Delivery", subtotal);
    const advancePreview = paymentPreview("Advance Payment", subtotal);
    const splitPreview = paymentPreview("Split Payment", subtotal);

    app.innerHTML = `
      <section class="page narrow">
        ${journeyBarHTML(3)}
        ${flowStatusHTML(true, false)}
        <div class="step-nav-row"><button class="back-link" onclick="Router.go('delivery')">← Back to Delivery</button></div>
        <div class="page-head"><h2>Payment</h2><p class="tagline">Choose how you'd like to pay, then confirm below</p></div>
        <form id="paymentForm" onsubmit="Views.submitOrder(event)">
          <div class="checkout-grid payment-sequence">
            <div class="form-card">
              <h3>Payment Method</h3>
              ${restrictedNote}
              ${codAllowed ? `<div class="cod-recovery-hint"><span>💵 Cash on Delivery is available for this order.</span><button type="button" class="btn-text-secondary" onclick="Views.selectPay('payCOD','payAdvance,paySplit')">Use Cash on Delivery</button></div>` : ""}
              <div class="pay-options">
                ${codAllowed ? `
                <label class="pay-option premium-cod-card" id="payCOD">
                  <input type="radio" name="pay" value="Cash on Delivery" ${defaultMethod === "Cash on Delivery" ? "checked" : ""} onchange="Views.selectPay('payCOD','payAdvance,paySplit')">
                  <span class="pay-option-icon" aria-hidden="true">💵</span><div class="pay-option-copy"><div class="pay-option-title">Cash on Delivery</div>
                  <div class="payment-payable-delivery">Delivery: ${CONFIG.CURRENCY} ${codPreview.deliveryFee}</div>
                  <div class="payment-payable-paynow">Pay now: ${CONFIG.CURRENCY} 0</div>
                  <div class="payment-payable-due">Pay at doorstep: ${CONFIG.CURRENCY} ${codPreview.orderTotal}</div>
                  </div>
                </label>` : ""}
                 <label class="pay-option ${codAllowed ? "" : "selected"}" id="payAdvance">
                  <input type="radio" name="pay" value="Advance Payment" ${codAllowed ? "" : "checked"} onchange="Views.selectPay('payAdvance','payCOD,paySplit')">
                   <span class="pay-option-icon" aria-hidden="true">🌱</span><div class="pay-option-copy"><div class="pay-option-title">PAY FULL AMOUNT NOW ${advancePreview.freeDeliveryQualified ? '<span class="payment-benefit">FREE DELIVERY</span>' : ''}</div>
                   <div class="payment-payable-delivery">Delivery: ${advancePreview.freeDeliveryQualified ? "FREE" : CONFIG.CURRENCY + " " + advancePreview.deliveryFee}</div>
                   <div class="payment-payable-total">Order total: ${CONFIG.CURRENCY} ${advancePreview.orderTotal}</div>
                   <div class="payment-payable-paynow premium-advance-card">Pay now: ${CONFIG.CURRENCY} ${advancePreview.payNow}</div>
                   </div>
                 </label>
                ${splitAllowed ? `
                <label class="pay-option" id="paySplit">
                  <input type="radio" name="pay" value="Split Payment" onchange="Views.selectPay('paySplit','payCOD,payAdvance')">
                   <span class="pay-option-icon" aria-hidden="true">🔀</span><div class="pay-option-copy"><div class="pay-option-title">Pay ${splitPreview.advancePercent}% Now, ${splitPreview.deliveryPercent}% at Delivery</div>
                    <div class="payment-payable-delivery">Delivery: ${CONFIG.CURRENCY} ${splitPreview.deliveryFee}</div>
                    <div class="payment-payable-total">Order total: ${CONFIG.CURRENCY} ${splitPreview.orderTotal}</div>
                    <div class="payment-payable-paynow">Pay now: ${CONFIG.CURRENCY} ${splitPreview.payNow}</div>
                    <div class="payment-payable-due">Pay at doorstep: ${CONFIG.CURRENCY} ${splitPreview.codDue}</div>
                    <p class="payment-friendly-note">The standard delivery fee is already included in the order total.</p>
                   </div>
                </label>` : ""}
              </div>

               ${codMixUpsell}
            </div>
            <div class="summary-card">
              <h3>Order Summary</h3>
              ${lines.map(l => `<div class="summary-line"><span>${l.p.name} × ${l.qty}</span><span class="mono">${CONFIG.CURRENCY} ${l.line}</span></div>`).join("")}
              <div class="summary-line"><span>Items subtotal</span><span class="mono">${CONFIG.CURRENCY} ${subtotal}</span></div>
              <div class="summary-line"><span>Delivery</span><span class="mono" id="summaryDeliveryFee">${CONFIG.CURRENCY} ${defaultPreview.deliveryFee}</span></div>
              <div class="summary-line"><span>Payment method</span><span id="summaryPaymentMethod">${defaultMethod}</span></div>
              <div class="summary-line total"><span>Order total</span><span class="mono" id="summaryTotal">${CONFIG.CURRENCY} ${defaultPreview.orderTotal}</span></div>
               <div class="summary-line" id="summaryPayNowRow"><span id="payableLabel">${payableLabelText(defaultMethod)}</span><span class="mono" id="summaryPayNow"></span></div>
               <div class="summary-line" id="summaryCodDueRow"><span>Pay on delivery</span><span class="mono" id="summaryCodDue"></span></div>
               <div class="advance-details" id="advanceDetails" style="display:${codAllowed ? "none" : "block"}">
                 <div class="free-delivery-progress" id="freeDeliveryProgress"></div>
                 <h4>Choose payment method</h4>
                 <div class="advance-method-tabs" id="advanceMethodTabs" role="tablist" aria-label="Advance payment method" style="display:${selectedAdvanceMethod ? "none" : ""}">
                   ${advanceMethods.map(method => `<button type="button" class="advance-method-tab${method.id === selectedAdvanceMethod ? " selected" : ""}" data-method="${method.id}" role="tab" aria-selected="${method.id === selectedAdvanceMethod}" aria-expanded="${method.id === selectedAdvanceMethod}" aria-controls="advanceMethodDetails" onclick="Views.selectAdvanceMethod('${method.id}')">${method.label}</button>`).join("") || `<p class="payment-restricted-note">No advance payment method is currently enabled. Please contact the store.</p>`}
                 </div>
                 <div class="advance-method-selected-bar" id="advanceMethodSelectedBar" style="display:${selectedAdvanceMethod ? "flex" : "none"}">
                   <span class="advance-method-selected-label">Selected payment method: <strong id="advanceMethodSelectedName">${escapeHTML(selectedAdvanceMethod)}</strong></span>
                   <button type="button" class="advance-method-change" onclick="Views.changeAdvanceMethod()" aria-controls="advanceMethodTabs">Change payment method</button>
                 </div>
                 <input type="hidden" id="o-advance-method" value="${selectedAdvanceMethod}">
                 <div id="advanceMethodDetails" role="tabpanel"></div>
                 <div class="field" id="advanceTxnRefField" style="display:${selectedAdvanceMethod ? "block" : "none"}"><label for="o-txn-ref">Transaction ID / reference</label><input id="o-txn-ref" placeholder="e.g. TXN123456"></div>
                 <p class="advance-note" id="advanceNote" style="display:${selectedAdvanceMethod ? "block" : "none"}">We'll confirm your payment and dispatch your order once received.</p>
               </div>
               <button class="inline-submit" type="submit" id="submitBtn" style="display:${(defaultMethod === "Cash on Delivery" || selectedAdvanceMethod) ? "" : "none"}"></button>
              <p class="admin-muted" id="splitSubnote" style="text-align:center;margin-top:8px"></p>
              <div id="orderStatus"></div>
            </div>
          </div>
          <div class="step-actions-secondary">
            <button type="button" class="btn-text-secondary" onclick="Router.go('delivery')">← Back to Delivery</button>
            <button type="button" class="btn-text-tertiary" onclick="Router.go(Router.lastCategory)">Continue Shopping</button>
          </div>
          <details class="payment-recovery">
            <summary>Can't complete payment right now?</summary>
            <div class="payment-recovery-chips">
              ${[
                ["Prefer Cash on Delivery", "COD_REQUESTED"],
                ["Advance payment is difficult", "PAYMENT_ABANDONED"],
                ["Payment method unavailable", "PAYMENT_ABANDONED"],
                ["Delivery charge", "PAYMENT_ABANDONED"],
                ["Need more time", "PAYMENT_ABANDONED"],
                ["Call/WhatsApp me", "CALLBACK_REQUESTED"]
              ].map(([label, status]) => `<button type="button" class="payment-recovery-chip" onclick="Views.saveAbandonReason(this,'${status}','${label}')">${label}</button>`).join("")}
            </div>
          </details>
        </form>
      </section>`;

    if (codAllowed) document.getElementById("payCOD").classList.add("selected");
    this.renderAdvanceMethod(selectedAdvanceMethod);
    this.updateDeliveryFee();
    Analytics.addPaymentInfo(lines, subtotal, defaultMethod);
  },

  // Section 7: for a custom-selection order (COD unavailable), show the
  // actual current fixed Mix Pack products (standard-collection, cat mix)
  // as a COD-eligible alternative. Real names/prices only; navigating to
  // Mix Seeds never mutates or replaces the customer's existing cart.
  codMixPackUpsellHTML() {
    const mixPacks = Prices.get().filter(p => p.cat === "mix" && p.type === "standard-collection").slice(0, 3);
    if (!mixPacks.length) return "";
    const restoreDraft = Cart.hasCustomDraft() ? `<button type="button" class="btn-text-secondary" onclick="Views.restoreCustomOrder()">Restore Custom Order</button>` : "";
    const total = this._order?.total || 0;
    return `
      <div class="cod-mixpack-upsell">
        <p class="cod-mixpack-question"><strong>Want Cash on Delivery?</strong><br>Choose a ready-made Mix Pack instead.</p>
        <button type="button" class="btn btn-secondary premium-cod-card" style="background:var(--kraft);color:var(--ink);border:1px solid var(--kraft-dark)" onclick="Router.go('mix')">Choose a Mix Pack</button>
        <button type="button" class="btn-text-tertiary" onclick="Router.go('mix')">Keep Custom Order</button>${restoreDraft}
        <div class="cod-mixpack-grid">
           ${mixPacks.map(p => `<button type="button" class="cod-mixpack-card premium-cod-card" onclick="Views.convertToCodMixPack('${p.id}')"><span class="cod-mixpack-badge premium-cod-badge">100% COD</span><span class="cod-mixpack-icon" aria-hidden="true">${p.icon || "🧺"}</span><span class="cod-mixpack-name">${escapeHTML(p.name)}</span><span class="cod-mixpack-price mono">${CONFIG.CURRENCY} ${p.price}</span><span class="cod-mixpack-action">Convert to this COD Mix Pack</span></button>`).join("")}
        </div>
      </div>`;
  },

  convertToCodMixPack(productId) {
    Cart.saveCustomDraft();
    Cart.save({ [productId]: 1 });
    Router.go("cart");
    Toast.show("Your custom order is saved. You can restore it anytime.");
  },

  restoreCustomOrder() {
    if (Cart.restoreCustomDraft()) {
      Toast.show("Your saved custom order was restored.");
      Router.go("cart");
    }
  },

  // One-tap payment-abandonment reason (HS-20260819-02). Non-blocking,
  // non-aggressive: saves best-effort against the checkout Lead and never
  // navigates away or fires another Meta Lead event.
  saveAbandonReason(btn, status, label) {
    if (btn) { btn.disabled = true; btn.classList.add("selected"); }
    Leads.updateStatus(status, label);
    Toast.show("Got it — we've saved your preference.");
  },

  paymentDisplaySettings() {
    return Settings.get();
  },

  selectAdvanceMethod(method) {
    const allowed = { JazzCash: "JAZZCASH_ENABLED", EasyPaisa: "EASYPAISA_ENABLED", "Bank Transfer": "BANK_ENABLED", "Bank Alfalah APG": "APG_ENABLED" };
    const settings = this.paymentDisplaySettings();
    if (!allowed[method] || !settings[allowed[method]]) return;
    if (method === "Bank Alfalah APG" && (!CONFIG.APG_SANDBOX_MODE || !apgTestAccessGranted())) return;
    // Switching channel (e.g. JazzCash -> Bank Transfer) clears any
    // already-typed reference -- prevents submitting the wrong channel's
    // reference against the newly selected one.
    if (this._order.advanceMethod && this._order.advanceMethod !== method) {
      const ref = document.getElementById("o-txn-ref");
      if (ref) ref.value = "";
    }
    this._order.advanceMethod = method;
    document.querySelectorAll(".advance-method-tab").forEach(button => {
      const isSelected = button.dataset.method === method;
      button.classList.toggle("selected", isSelected);
      button.setAttribute("aria-selected", isSelected);
      button.setAttribute("aria-expanded", isSelected);
    });
    const input = document.getElementById("o-advance-method");
    if (input) input.value = method;
    const txnField = document.getElementById("advanceTxnRefField");
    const note = document.getElementById("advanceNote");
    const isGateway = method === "Bank Alfalah APG";
    // APG is a real redirect gateway -- there is no customer-typed
    // reference to collect; the server fills gatewayTransactionId in
    // authoritatively once APG itself confirms payment.
    if (txnField) txnField.style.display = isGateway ? "none" : "block";
    if (note) { note.style.display = "block"; note.textContent = isGateway ? "You'll be redirected to Bank Alfalah's secure payment page to complete this payment." : "We'll confirm your payment and dispatch your order once received."; }
    const submitBtn = document.getElementById("submitBtn");
    if (submitBtn) submitBtn.style.display = "";
    // HS-20260819-05: once a channel is chosen, hide the other two method
    // buttons entirely (not just visually de-emphasize) and show a compact
    // "Selected payment method: X / Change payment method" bar instead.
    const tabs = document.getElementById("advanceMethodTabs");
    if (tabs) tabs.style.display = "none";
    const bar = document.getElementById("advanceMethodSelectedBar");
    if (bar) bar.style.display = "flex";
    const nameEl = document.getElementById("advanceMethodSelectedName");
    if (nameEl) nameEl.textContent = method;
    this.renderAdvanceMethod(method);
  },

  // "Change payment method" -- collapses the selected-method view and
  // restores all enabled method buttons so the customer can pick a
  // different one. Clears the previously-selected channel and any typed
  // reference so nothing can be submitted against the wrong channel.
  changeAdvanceMethod() {
    this._order.advanceMethod = "";
    const input = document.getElementById("o-advance-method");
    if (input) input.value = "";
    const ref = document.getElementById("o-txn-ref");
    if (ref) ref.value = "";
    document.querySelectorAll(".advance-method-tab").forEach(button => {
      button.classList.remove("selected");
      button.setAttribute("aria-selected", "false");
      button.setAttribute("aria-expanded", "false");
    });
    const tabs = document.getElementById("advanceMethodTabs");
    if (tabs) tabs.style.display = "";
    const bar = document.getElementById("advanceMethodSelectedBar");
    if (bar) bar.style.display = "none";
    const txnField = document.getElementById("advanceTxnRefField");
    const note = document.getElementById("advanceNote");
    if (txnField) txnField.style.display = "none";
    if (note) note.style.display = "none";
    const submitBtn = document.getElementById("submitBtn");
    if (submitBtn) submitBtn.style.display = "none";
    const container = document.getElementById("advanceMethodDetails");
    if (container) container.innerHTML = `<p class="admin-muted">Select an enabled advance payment method.</p>`;
    const first = document.querySelector(".advance-method-tab");
    if (first) first.focus();
  },

  renderAdvanceMethod(method) {
    const container = document.getElementById("advanceMethodDetails");
    if (!container) return;
    const s = this.paymentDisplaySettings();
    const definitions = {
      JazzCash: { number: s.JAZZCASH_NUMBER, title: s.JAZZCASH_ACCOUNT_TITLE, qr: s.JAZZCASH_QR_URL },
      EasyPaisa: { number: s.EASYPAISA_NUMBER, title: s.EASYPAISA_ACCOUNT_TITLE, qr: s.EASYPAISA_QR_URL },
      "Bank Transfer": { bank: s.BANK_NAME, title: s.BANK_ACCOUNT_TITLE, number: s.BANK_ACCOUNT_NUMBER, iban: s.BANK_IBAN, qr: s.BANK_QR_URL }
    };
    const details = definitions[method];
    if (!details) { container.innerHTML = `<p class="admin-muted">Select an enabled advance payment method.</p>`; return; }
    const selectedMethod = document.querySelector('input[name="pay"]:checked')?.value || "Advance Payment";
    const preview = paymentPreview(selectedMethod, this._order?.subtotal || 0);
    const payable = `<div class="payment-payable"><strong>Pay now with ${escapeHTML(method)}: ${CONFIG.CURRENCY} ${preview.payNow}</strong><span>Pay on delivery: ${CONFIG.CURRENCY} ${preview.codDue}</span></div>`;
    const qr = typeof details.qr === "string" && /^https?:\/\//i.test(details.qr)
      ? `<img class="payment-qr" src="${escapeHTML(details.qr)}" alt="${escapeHTML(method)} QR or barcode" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="payment-qr-fallback" hidden>QR image unavailable</span>` : "";
    container.innerHTML = method === "Bank Transfer"
       ? `<div class="selected-payment-card"><strong>${escapeHTML(method)}</strong><div class="payment-detail"><span>Bank</span><span>${escapeHTML(details.bank || "Not configured")}</span></div><div class="payment-detail"><span>Account title</span><span>${escapeHTML(details.title || "Not configured")}</span></div><div class="payment-detail"><span>Account number</span><span class="mono">${escapeHTML(details.number || "Not configured")}</span></div><div class="payment-detail"><span>IBAN</span><span class="mono">${escapeHTML(details.iban || "Not configured")}</span></div>${payable}${qr}</div>`
       : `<div class="selected-payment-card"><strong>${escapeHTML(method)}</strong><div class="payment-detail"><span>Number</span><span class="mono">${escapeHTML(details.number || "Not configured")}</span></div><div class="payment-detail"><span>Account title</span><span>${escapeHTML(details.title || "Not configured")}</span></div>${payable}${qr}</div>`;
  },

  // "Rs.320 more for FREE delivery" — only meaningful while paying 100%
  // advance (COD and Split's fees don't move with subtotal; Split never
  // qualifies for the advance free-delivery benefit).
  renderFreeDeliveryProgress(method, subtotal, hasCustomized) {
    const el = document.getElementById("freeDeliveryProgress");
    if (!el) return;
    const r = Settings.get();
    if (method === "Split Payment") {
       el.innerHTML = `<p class="admin-muted">Delivery ${CONFIG.CURRENCY} ${r.COD_DELIVERY_FEE} is included in your order total.</p>`;
      return;
    }
    if (method !== "Advance Payment" && !hasCustomized) { el.innerHTML = ""; return; }
    const pct = Math.min(100, Math.round((subtotal / r.FREE_DELIVERY_THRESHOLD) * 100));
    if (subtotal >= r.FREE_DELIVERY_THRESHOLD) {
      el.innerHTML = `<div class="fdp-callout unlocked"><span class="fdp-badge">FREE DELIVERY</span><span class="fdp-text">Advance payment qualifies this order for free delivery.</span></div><div class="fdp-track"><div class="fdp-fill" style="width:100%"></div></div>`;
      return;
    }
    const remaining = r.FREE_DELIVERY_THRESHOLD - subtotal;
    el.innerHTML = `
      <div class="fdp-callout"><span class="fdp-badge">🌱 FREE DELIVERY</span><span class="fdp-text">Only ${CONFIG.CURRENCY} ${remaining} away from free delivery.</span></div>
      <div class="fdp-track"><div class="fdp-fill" style="width:${pct}%"></div></div>`;
  },

  selectPay(onId, offIds) {
    document.getElementById(onId).classList.add("selected");
    String(offIds || "").split(",").filter(Boolean).forEach(id => document.getElementById(id)?.classList.remove("selected"));
    this.updateDeliveryFee();
    if (onId === "payAdvance" || onId === "paySplit") this.renderAdvanceMethod(this._order.advanceMethod);
    refreshStickyBar();
  },

  // Renders the Section 8/10 money breakdown (Order total / Pay now / Pay on
  // delivery) and the Section 10 confirm-button copy for whichever payment
  // method is selected. Split's payNow/codDue are computed client-side only
  // for display — the server recomputes and enforces the real amounts.
  updateDeliveryFee() {
    const method = document.querySelector('input[name="pay"]:checked').value;
    const hasCustomized = Cart.flatLines().some(l => l.p.type === "customized-collection");
    const subtotal = this._order.subtotal;
    const preview = paymentPreview(method, subtotal);
    document.getElementById("summaryDeliveryFee").textContent = `${CONFIG.CURRENCY} ${preview.deliveryFee}`;
    document.getElementById("summaryPaymentMethod").textContent = method;
    document.getElementById("summaryTotal").textContent = `${CONFIG.CURRENCY} ${preview.orderTotal}`;
    document.getElementById("advanceDetails").style.display = method === "Cash on Delivery" ? "none" : "block";
    this._order.deliveryFee = preview.deliveryFee;
    this._order.total = preview.orderTotal;
    this.renderFreeDeliveryProgress(method, subtotal, hasCustomized);

    const payNowRow = document.getElementById("summaryPayNowRow");
    const codDueRow = document.getElementById("summaryCodDueRow");
    const payableLabel = document.getElementById("payableLabel");
    const payNowEl = document.getElementById("summaryPayNow");
    const codDueEl = document.getElementById("summaryCodDue");
    const submitBtn = document.getElementById("submitBtn");
    const splitSubnote = document.getElementById("splitSubnote");
    // Collapsed-by-default (HS-20260819-04): for Advance/Split, the final
    // CTA and the reference/note only appear once a channel is chosen;
    // COD has no channel step, so its CTA is always visible.
    const channelChosen = method === "Cash on Delivery" || Boolean(this._order.advanceMethod);
    submitBtn.style.display = channelChosen ? "" : "none";
    const txnField = document.getElementById("advanceTxnRefField");
    const note = document.getElementById("advanceNote");
    if (txnField) txnField.style.display = channelChosen && method !== "Cash on Delivery" ? "block" : "none";
    if (note) note.style.display = channelChosen && method !== "Cash on Delivery" ? "block" : "none";
    if (method === "Cash on Delivery") {
      payNowRow.style.display = "none";
      codDueRow.style.display = "flex";
      codDueEl.textContent = `${CONFIG.CURRENCY} ${preview.codDue}`;
      submitBtn.textContent = `Place COD Order — Pay ${CONFIG.CURRENCY} ${preview.codDue} at Doorstep`;
      splitSubnote.textContent = "";
    } else if (method === "Advance Payment") {
      payNowRow.style.display = "flex";
      codDueRow.style.display = "none";
      payableLabel.textContent = payableLabelText(method);
      payNowEl.textContent = `${CONFIG.CURRENCY} ${preview.payNow}`;
      submitBtn.textContent = `Confirm Order — Pay ${CONFIG.CURRENCY} ${preview.payNow} Now`;
      splitSubnote.textContent = "";
    } else { // Split Payment
      payNowRow.style.display = "flex";
      codDueRow.style.display = "flex";
      payableLabel.textContent = "Pay now";
      payNowEl.textContent = `${CONFIG.CURRENCY} ${preview.payNow}`;
      codDueEl.textContent = `${CONFIG.CURRENCY} ${preview.codDue}`;
      submitBtn.textContent = `Confirm Order — Pay ${CONFIG.CURRENCY} ${preview.payNow} Now`;
       splitSubnote.textContent = `${CONFIG.CURRENCY} ${preview.codDue} will be paid at your doorstep.`;
    }

    this.renderFreeDeliveryProgress(method, subtotal, hasCustomized);
    Analytics.addPaymentInfo(Cart.flatLines(), subtotal, method);
  },

  async submitOrder(e) {
    e.preventDefault();
    // Single-flight guard (HS-20260820-02), on top of the button-disable
    // below -- explicit belt-and-suspenders against a rapid-click burst.
    if (this._submittingOrder) return;
    const status = document.getElementById("orderStatus");
    let paymentMethod = document.querySelector('input[name="pay"]:checked').value;
    // Defensive safety net only — COD/Split radios simply aren't rendered
    // when this._order.codAllowed/splitAllowed are false, so this should
    // never actually trigger in normal use.
    if (paymentMethod === "Cash on Delivery" && this._order && this._order.codAllowed === false) paymentMethod = "Advance Payment";
    if (paymentMethod === "Split Payment" && this._order && this._order.splitAllowed === false) paymentMethod = "Advance Payment";

    const requiresAdvanceChannel = paymentMethod === "Advance Payment" || paymentMethod === "Split Payment";
    const selectedAdvanceMethod = requiresAdvanceChannel ? document.getElementById("o-advance-method").value : "";
    const isApgGateway = selectedAdvanceMethod === "Bank Alfalah APG";
    const transactionReference = requiresAdvanceChannel && !isApgGateway ? document.getElementById("o-txn-ref").value.trim() : "";
    if (requiresAdvanceChannel && !isApgGateway && transactionReference.length < 3) {
      this.showOrderError(status, "Please add a valid transaction ID so we can verify the payment.");
      return;
    }

    let normalizedPhone;
    try {
      normalizedPhone = normalizePakistanMobile(this._order.delivery.phone);
    } catch (error) {
      this.showOrderError(status, error.message);
      return;
    }

    this._submittingOrder = true;
    const inlineBtn = document.getElementById("submitBtn");
    const stickyBtn = document.getElementById("sbAction");
    inlineBtn.disabled = true;
    inlineBtn.setAttribute("aria-busy", "true");
    inlineBtn.textContent = "Placing order…";
    if (stickyBtn) { stickyBtn.disabled = true; stickyBtn.setAttribute("aria-busy", "true"); stickyBtn.textContent = "Placing order…"; }

    const lines = Cart.flatLines();
    const delivery = this._order.delivery;
    const request = {
      type: "order",
      customer: {
        name: delivery.name.trim(),
        phone: normalizedPhone,
        address: delivery.address.trim(),
        city: delivery.city.trim(),
        postal: delivery.postal.trim(),
        notes: delivery.notes.trim()
      },
      payment: {
        method: paymentMethod,
        advanceMethod: selectedAdvanceMethod,
        transactionReference
      },
      items: lines.map(line => ({ productId: line.p.id, quantity: line.qty })),
      // Growth-funnel context only (HS-20260819-02): lets the server link
      // this order back to its checkout Lead and fire Meta CAPI Purchase
      // with real match data. Never read/used by pricing, validation, or
      // idempotency -- purely additive fields.
      leadId: Leads.id(),
      visitorId: (typeof PushGrowth !== "undefined" && PushGrowth.visitorId()) || "",
      fbp: Leads.cookie("_fbp"),
      fbc: Leads.cookie("_fbc"),
      userAgent: (typeof navigator !== "undefined" && navigator.userAgent) || "",
      pageUrl: location.href
    };
    const requestSignature = JSON.stringify(request);
    if (!this._order.idempotencyKey || this._order.idempotencyRequestSignature !== requestSignature) {
      this._order.idempotencyKey = createIdempotencyKey();
      this._order.idempotencyRequestSignature = requestSignature;
    }
    request.idempotencyKey = this._order.idempotencyKey;

    // Written just before the request goes out, cleared on any definitive
    // response below (HS-20260819-13). If the tab closes/backgrounds
    // between here and the response, the next visit's boot-time
    // reconciliation can find out whether this exact idempotencyKey
    // actually went through, without ever generating a second key.
    PendingOrder.save(request.idempotencyKey, paymentMethod);

    const result = await Orders.submit(request);
    if (result.ok && isApgGateway) {
      // Real order already exists server-side (PENDING gateway state) --
      // now hand off to Bank Alfalah APG. Purchase/confirmation only ever
      // happens later, on the Return page, after authoritative server
      // verification (HS-20260820-01) -- never here.
      PendingOrder.clear();
      ApgFlow.save(result.orderId);
      Cart.clearSubmitted(result.items);
      this._order = null;
      const handshake = await Orders.submit({ type: "apgStartHandshake", orderId: result.orderId });
      if (!handshake.ok) {
        this._submittingOrder = false;
        this.showOrderError(status, handshake.error?.message || "Couldn't start the Bank Alfalah payment. Please try again.");
        inlineBtn.disabled = false;
        inlineBtn.removeAttribute("aria-busy");
        if (stickyBtn) { stickyBtn.disabled = false; stickyBtn.removeAttribute("aria-busy"); stickyBtn.textContent = "Confirm & Place Order"; }
        return;
      }
      // Section 8: distinct label for the redirect hop -- the button stays
      // busy/disabled through the real navigation away from this site, so
      // _submittingOrder is deliberately NOT reset here (there is no "back
      // to idle" state before the page unloads).
      inlineBtn.textContent = "Opening secure payment…";
      if (stickyBtn) stickyBtn.textContent = "Opening secure payment…";
      submitHiddenFormAndNavigate(handshake.action, handshake.fields);
      return;
    }
    if (result.ok) {
      const confirmedLines = result.items.map(item => {
        const localProduct = Prices.get().find(product => product.id === item.productId) || {};
        return {
          p: { ...localProduct, id: item.productId, name: item.name, price: item.unitPrice, cat: item.category || localProduct.cat },
          qty: item.quantity,
          line: item.lineTotal
        };
      });
      PendingOrder.clear();
      this.showOrderConfirmation(result);
      Cart.clearSubmitted(result.items);
      this._order = null;
      // Dedupe against a rare bfcache/reconciliation replay firing twice
      // for the same Order ID (HS-20260819-13) -- Purchase must fire
      // exactly once per real order.
      if (!Analytics.hasFiredPurchase(result.orderId)) {
        try {
          Analytics.purchase(result.orderId, result, confirmedLines);
          Analytics.markPurchaseFired(result.orderId);
        } catch (error) {
          console.error("Purchase analytics failed:", error);
        }
      }
    } else {
      // A definitive server response (even a rejection) means we know the
      // true state -- only a genuine network/timeout failure leaves real
      // uncertainty worth keeping the pending marker for.
      if (result.error?.code !== "ORDER_TIMEOUT" && result.error?.code !== "ORDER_NETWORK_ERROR") PendingOrder.clear();
      this.showOrderError(status, result.error?.message || "Couldn't place the order. Please try again shortly.");
      inlineBtn.disabled = false;
      inlineBtn.removeAttribute("aria-busy");
      this.updateDeliveryFee(); // restores the method-specific submit-button copy
      if (stickyBtn) { stickyBtn.disabled = false; stickyBtn.removeAttribute("aria-busy"); stickyBtn.textContent = "Confirm & Place Order"; }
    }
    this._submittingOrder = false;
  },

  showOrderError(status, message) {
    status.replaceChildren();
    const box = document.createElement("div");
    box.className = "order-status err";
    box.textContent = message;
    if (CONFIG.WHATSAPP_NUMBER) {
      box.appendChild(document.createTextNode(" "));
      const link = document.createElement("a");
      link.href = `https://wa.me/${encodeURIComponent(CONFIG.WHATSAPP_NUMBER)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Send the order on WhatsApp instead.";
      box.appendChild(link);
    }
    status.appendChild(box);
  },

  // ── Step 4: Confirmation ──────────────────────────────────────────
  showOrderConfirmation(payload) {
    Router.current = "confirmation";
    document.title = PAGE_TITLES.confirmation;
    document.querySelectorAll(".nav-tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".quick-category-btn").forEach(b => b.classList.remove("active"));
    window.scrollTo({ top: 0, behavior: "smooth" });
    const isCOD = payload.paymentMethod === "Cash on Delivery";
    const isSplit = payload.paymentMethod === "Split Payment";
    const customer = payload.customer || {};
    const itemSummary = payload.items.map(item => `${item.name} x${item.quantity}`).join(", ");
    // Section 11: COD shows one "Pay on delivery" amount; full Advance shows
    // one "Advance payment submitted" amount (never "paid" — pending
    // verification); Split shows both amounts prominently, side by side.
    const amountBlockHTML = isSplit
      ? `<div class="ps-amount-split">
           <div class="ps-amount advance"><span class="ps-amount-label">Advance submitted</span><span class="ps-amount-value">${CONFIG.CURRENCY} ${payload.payNow}</span></div>
           <div class="ps-amount cod"><span class="ps-amount-label">Pay on delivery</span><span class="ps-amount-value">${CONFIG.CURRENCY} ${payload.codDue}</span></div>
         </div>`
      : `<div class="ps-amount ${isCOD ? "cod" : "advance"}">
           <span class="ps-amount-label">${isCOD ? "Pay on delivery" : "Advance payment submitted"}</span>
           <span class="ps-amount-value">${CONFIG.CURRENCY} ${payload.total}</span>
         </div>`;
    document.getElementById("app").innerHTML = `
      <section class="page narrow">
        ${journeyBarHTML(4)}
        ${flowStatusHTML(true, false)}
        <div class="confirm-hero">
          <div class="confirm-icon">🌱</div>
          <h2>Thanks, ${escapeHTML(customer.name)} — your order is in!</h2>
          <p class="tagline">We'll call ${escapeHTML(customer.phone)} shortly to confirm delivery to ${escapeHTML(customer.city)}.</p>
        </div>
        <div class="payment-summary-card">
          <div class="ps-row"><span>Order ID</span><span class="mono">${escapeHTML(payload.orderId)}</span></div>
          ${amountBlockHTML}
          <div class="ps-row"><span>Payment method</span><span>${escapeHTML(payload.paymentMethod)}${payload.advanceMethod ? " — " + escapeHTML(payload.advanceMethod) : ""}</span></div>
          <p class="advance-note">${isCOD
            ? "Have this amount ready in cash when your order arrives."
            : isSplit
              ? "Your advance is awaiting verification; the remaining amount is payable in cash when your order arrives."
              : "Your payment is awaiting verification. We'll dispatch after it is verified."}</p>
        </div>
        <details class="order-details-card">
          <summary>Order details</summary>
          <div class="summary-line"><span>Items</span><span style="text-align:right;max-width:60%">${escapeHTML(itemSummary)}</span></div>
          <div class="summary-line"><span>Items subtotal</span><span class="mono">${CONFIG.CURRENCY} ${payload.subtotal}</span></div>
          <div class="summary-line"><span>Delivery fee</span><span class="mono">${CONFIG.CURRENCY} ${payload.deliveryFee}</span></div>
          <div class="summary-line"><span>Payment status</span><span>${escapeHTML(payload.paymentStatus)}</span></div>
          ${payload.transactionReference ? `<div class="summary-line"><span>Transaction ref</span><span class="mono">${escapeHTML(payload.transactionReference)}</span></div>` : ""}
        </details>
        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:18px" onclick="Router.go('vegetables')">Continue shopping</button>
      </section>`;
    refreshStickyBar();
    try {
      Analytics.pageview("confirmation", document.title);
    } catch (error) {
      console.error("Confirmation page analytics failed:", error);
    }
  },

  // ── Bank Alfalah APG Return URL (HS-20260820-01) ──────────────────
  // This page is reached twice in a normal flow: once right after the
  // handshake (URL carries ?auth_token=...), and once again after the
  // customer actually pays on APG's own hosted page (no auth_token, and
  // whatever query params APG appends there are NEVER treated as proof --
  // only the server-side status inquiry below is authoritative).
  paymentReturn() {
    Router.current = "payment-return";
    document.title = "Verifying payment — Hoja Seeds";
    this.renderPaymentReturnState("verifying", "Verifying payment…", "Please wait while we confirm your payment with Bank Alfalah.");

    const flow = ApgFlow.get();
    const authToken = new URLSearchParams(location.search).get("auth_token");

    (async () => {
      if (!flow || !flow.orderId) {
        this.renderPaymentReturnState("unable", "Unable to verify payment", "We couldn't find a payment in progress for this browser. If you completed a payment, check Order status from the link in your confirmation, or contact us.");
        return;
      }
      if (authToken) {
        // Hop 1 -> 2: hand off to the SSO step, which is itself another
        // real navigation (a successful SSO POST response IS a redirect
        // to APG's hosted checkout page).
        const sso = await Orders.submit({ type: "apgStartSso", orderId: flow.orderId, authToken });
        if (!sso.ok) {
          this.renderPaymentReturnState("unable", "Unable to start payment", sso.error?.message || "Please try checkout again.");
          return;
        }
        submitHiddenFormAndNavigate(sso.action, sso.fields);
        return;
      }
      // Hop 3: back from APG's own checkout page. Query params here
      // (TS/RC/RD/O per APG's docs, or none at all) are NEVER trusted --
      // only the server's own verified answer is.
      const result = await Orders.submit({ type: "apgVerifyStatus", orderId: flow.orderId });
      if (!result.ok) {
        this.renderPaymentReturnState("unable", "Unable to verify payment", result.error?.message || "Please refresh this page in a moment, or contact us with your Order ID.");
        return;
      }
      const state = result.state;
      if (state.gatewayStatus === "PAID") {
        ApgFlow.clear();
        this.renderPaymentReturnState("success", "Payment successful", `Order ${escapeHTML(state.orderId)} — ${CONFIG.CURRENCY} ${state.payNow} received. We'll dispatch your order shortly.`, state);
        if (!Analytics.hasFiredPurchase(state.orderId)) {
          try {
            const lines = (state.items || []).map(item => ({ p: { id: item.productId, name: item.name, price: item.unitPrice, cat: item.category }, qty: item.quantity }));
            Analytics.purchase(state.orderId, { total: state.total, deliveryFee: state.deliveryFee }, lines);
            Analytics.markPurchaseFired(state.orderId);
          } catch (error) { console.error("APG purchase analytics failed:", error); }
        }
      } else if (state.gatewayStatus === "FAILED" || state.gatewayStatus === "CANCELLED") {
        ApgFlow.clear();
        this.renderPaymentReturnState("failed", "Payment unsuccessful", `Order ${escapeHTML(state.orderId)} was not completed. No amount was charged by Bank Alfalah, or the payment was declined/cancelled. You can try again or choose a different payment method.`);
      } else {
        // PENDING/UNKNOWN -- genuinely don't know yet (inquiry itself
        // may have failed, or APG hasn't posted a final status yet).
        // Keep ApgFlow so a manual re-check or the Listener can still
        // resolve this without ever risking a duplicate order.
        this.renderPaymentReturnState("unable", "Unable to verify payment yet", `We're still waiting for confirmation from Bank Alfalah for Order ${escapeHTML(state.orderId)}. This page will not mark your payment complete until it's confirmed — you can safely check again in a moment.`, state, true);
      }
    })().catch(error => {
      console.error("Payment return verification failed:", error);
      this.renderPaymentReturnState("unable", "Unable to verify payment", "Something went wrong while checking your payment. Please try again in a moment or contact us with your Order ID.");
    });
  },

  renderPaymentReturnState(kind, title, message, state, allowRecheck) {
    const icon = { verifying: "⏳", success: "✅", failed: "❌", unable: "⚠️" }[kind] || "⏳";
    document.getElementById("app").innerHTML = `
      <section class="page narrow">
        <div class="confirm-hero">
          <div class="confirm-icon">${icon}</div>
          <h2>${escapeHTML(title)}</h2>
          <p class="tagline">${message}</p>
        </div>
        ${allowRecheck ? `<button class="btn btn-secondary" style="width:100%;justify-content:center;margin-top:12px" onclick="Views.paymentReturn()">Check again</button>` : ""}
        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:12px" onclick="ApgFlow.clear();Router.go('vegetables')">Continue shopping</button>
      </section>`;
    refreshStickyBar();
  }
};

// ---- Pending-order marker (HS-20260819-13) ----
// A minimal, non-PII local record written just before the final order
// POST and cleared on any definitive response. Its only purpose: if the
// tab closes/backgrounds between the click and the response, the next
// visit can ask the server "did idempotencyKey X actually go through?"
// (checkOrderStatus) instead of the customer unknowingly resubmitting
// with a brand-new key and risking a second real order. Never stores
// name/phone/address/items -- only what's needed to look the order up
// and show a generic "which payment method" hint in the reconciliation
// banner.
const PendingOrder = {
  KEY: "hoja_pending_order",
  save(idempotencyKey, paymentMethod) {
    try { localStorage.setItem(this.KEY, JSON.stringify({ idempotencyKey, paymentMethod, ts: Date.now() })); }
    catch { /* storage unavailable -- reconciliation just won't be available this session */ }
  },
  clear() { try { localStorage.removeItem(this.KEY); } catch { /* ignore */ } },
  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); } catch { return null; }
  },
  // Best-effort, runs once at boot. Never blocks rendering, never retries
  // automatically, never resubmits -- only asks the server for a status
  // and shows a small confirmation banner if the order is found.
  async reconcileOnBoot() {
    const pending = this.get();
    if (!pending || !pending.idempotencyKey) return;
    const result = await Orders.submit({ type: "orderStatus", idempotencyKey: pending.idempotencyKey }).catch(() => null);
    this.clear(); // either way, this check is one-shot -- don't re-ask forever
    if (result && result.ok && result.confirmed && result.orderId) {
      // Deliberately does NOT fire a Purchase analytics event here --
      // checkOrderStatus returns only confirmed/orderId (no value/items,
      // by design, to keep the endpoint PII-minimal), and firing Purchase
      // with fabricated or missing value data would corrupt analytics,
      // which is worse than the rare edge case of an under-reported
      // Purchase when a tab closed before the original response arrived.
      Toast.show(`Good news — your earlier order (${result.orderId}) went through successfully.`);
      Cart.clear();
    }
  }
};

// ---- Bank Alfalah APG round-trip context (HS-20260820-01) ----
// The customer's browser leaves this site entirely for the handshake/SSO
// hops, so orderId must survive across that real navigation -- localStorage,
// not memory. Never stores amount/customer details, only the orderId
// needed to ask the server (never the browser) what actually happened.
// HS-20260821-08: explicit test-access gate, checked ON TOP OF
// CONFIG.APG_SANDBOX_MODE + Settings.APG_ENABLED. This SPA never changes
// the URL after initial load (no pushState/hash routing), so a
// ?apg_test=1 present when the page first loads stays readable via
// location.search for the whole session -- letting a real controlled
// sandbox test happen (APG_ENABLED=true in Settings) without the tab
// appearing for ordinary visitors who load the site normally.
function apgTestAccessGranted() {
  try { return new URLSearchParams(location.search).get("apg_test") === "1"; } catch { return false; }
}

const ApgFlow = {
  KEY: "hoja_apg_flow",
  save(orderId) {
    try { localStorage.setItem(this.KEY, JSON.stringify({ orderId, ts: Date.now() })); } catch { /* ignore */ }
  },
  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); } catch { return null; }
  },
  clear() { try { localStorage.removeItem(this.KEY); } catch { /* ignore */ } }
};

// Real full-page POST (never fetch/XHR) -- APG's page-redirection mode
// requires an actual browser navigation so it can, in turn, redirect the
// browser onward (to the Return URL after handshake, or to its own hosted
// checkout page after SSO). The hash itself was already computed
// server-side; this only ever submits values the server returned.
function submitHiddenFormAndNavigate(action, fields) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value == null ? "" : String(value);
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

// ---- Order/contact submission (Google Sheet, with local fallback log) ----
const Orders = {
  async submit(payload) {
    if (!CONFIG.SHEET_WEBHOOK_URL) {
      if (payload.type === "contact") {
        const log = JSON.parse(localStorage.getItem("hoja_contacts") || "[]");
        log.push(payload);
        localStorage.setItem("hoja_contacts", JSON.stringify(log));
        return { ok: true, demo: true };
      }
      return { ok: false, error: { code: "ORDER_SERVICE_NOT_CONFIGURED", message: "Online ordering is not configured yet." } };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const body = JSON.stringify(payload);
      // keepalive (HS-20260819-13): lets the browser finish sending the
      // final order POST even if the tab closes/backgrounds right after
      // Confirm Order is clicked, instead of the request being aborted
      // mid-flight. Only for the actual order submission (not every
      // payload type), and only when the body is safely under the
      // browser's ~64KiB keepalive limit -- falls back to a normal
      // request otherwise rather than risk a silently-dropped send.
      const bodySize = typeof Blob !== "undefined" ? new Blob([body]).size : body.length;
      const useKeepalive = payload.type === "order" && bodySize < 60000;
      const response = await fetch(CONFIG.SHEET_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
        signal: controller.signal,
        ...(useKeepalive ? { keepalive: true } : {})
      });
      if (!response.ok) throw new Error(`Order service returned HTTP ${response.status}.`);
      const result = await response.json();
      if (!result || typeof result.ok !== "boolean") throw new Error("Order service returned an invalid response.");
      if (payload.type === "order" && result.ok && !isValidOrderResult(result)) {
        throw new Error("Order service returned an incomplete order confirmation.");
      }
      return result;
    } catch (e) {
      console.error("Order submit failed:", e);
      return {
        ok: false,
        error: {
          code: e.name === "AbortError" ? "ORDER_TIMEOUT" : "ORDER_NETWORK_ERROR",
          message: e.name === "AbortError"
            ? "The order request timed out. Please retry with the same order."
            : "Couldn't reach the order service. Check your connection and try again."
        }
      };
    } finally {
      clearTimeout(timeout);
    }
  }
};

function isValidOrderResult(result) {
  return typeof result.orderId === "string"
    && result.orderId.length > 0
    && typeof result.paymentStatus === "string"
    && Array.isArray(result.items)
    && result.items.every(item => item
      && typeof item.productId === "string"
      && typeof item.name === "string"
      && Number.isInteger(item.quantity)
      && item.quantity > 0
      && Number.isFinite(item.unitPrice)
      && Number.isFinite(item.lineTotal))
    && Number.isFinite(result.subtotal)
    && Number.isFinite(result.deliveryFee)
    && Number.isFinite(result.total);
}

function normalizePakistanMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  let normalized = digits;
  if (/^03\d{9}$/.test(digits)) normalized = "92" + digits.slice(1);
  else if (/^3\d{9}$/.test(digits)) normalized = "92" + digits;
  if (!/^923\d{9}$/.test(normalized)) throw new Error("Enter a valid Pakistan mobile number.");
  return normalized;
}

function formatPakistanMobile(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("92")) digits = `0${digits.slice(2)}`;
  if (digits.startsWith("3")) digits = `0${digits}`;
  digits = digits.slice(0, 11);
  return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
}

function formatPakistanMobileInput(input) {
  input.value = formatPakistanMobile(input.value);
}

function validateDelivery(delivery) {
  const errors = {};
  if (delivery.name.length < 2 || delivery.name.length > 80) errors.name = "Enter your full name.";
  if (delivery.address.length < 8 || delivery.address.length > 240) errors.address = "Enter a complete delivery address.";
  if (delivery.city.length < 2 || delivery.city.length > 80) errors.city = "Enter your city.";
  if (delivery.postal && !/^\d{5}$/.test(delivery.postal)) errors.postal = "Enter a 5-digit postal code.";
  if (!/^03\d{2}-\d{7}$/.test(delivery.phone)) errors.phone = "Enter a valid Pakistan mobile number, e.g. 0335-4299783.";
  return errors;
}

function createIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function escapeHTML(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- Init ----
document.getElementById("year").textContent = new Date().getFullYear();
document.getElementById("navToggle").addEventListener("click", () => {
  const open = document.getElementById("navTabs").classList.toggle("open");
  document.getElementById("navToggle").setAttribute("aria-expanded", open);
});
(async () => {
  Cart.renderCount();
  Router.go("home");
  // Never leave the storefront blank while the Apps Script reads are slow.
  // Fallback catalog/settings render immediately; settled live data refreshes
  // the active view without changing the current route or cart state.
  await Promise.allSettled([Prices.load(), Settings.load()]);
  Router.go(Router.current || "home");

  // Push-notification deep link (HS-20260819-03): a campaign's targetUrl
  // may carry ?hs_view=cart&campaignId=...&pushId=... to route the click
  // straight to the relevant page and restore context (e.g. the saved
  // cart) instead of dropping the customer on Home. Restricted to safe,
  // state-independent views only.
  if (typeof URLSearchParams !== "undefined" && typeof location !== "undefined") {
    const deepLinkView = new URLSearchParams(location.search).get("hs_view");
    if (["cart", "vegetables", "flowers", "mix", "fertilizer"].includes(deepLinkView)) {
      Router.go(deepLinkView);
    } else if (deepLinkView === "payment-return") {
      // Registered Bank Alfalah APG Return URL (HS-20260820-01) -- its own
      // dedicated render path, not a normal category route.
      Views.paymentReturn();
    }
  }
  // Best-effort, never blocks first paint or any of the above (HS-20260819-13).
  PendingOrder.reconcileOnBoot().catch(() => {});
})();
