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

// ---- Store settings (pricing rules): merges CONFIG.PRICING_RULES with
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
        if (data && Object.keys(data).length) return { ...CONFIG.PRICING_RULES, ...data };
      } catch (e) { console.warn("Sheet settings fetch failed, using local data:", e); }
    }
    return { ...CONFIG.PRICING_RULES, ...this.overrides() };
  },
  async load() { this._cache = await this.fetchRules(); return this._cache; },
  get() { return this._cache || { ...CONFIG.PRICING_RULES, ...this.overrides() }; }
};

// Payable-amount label: COD is money owed at the door; Advance is money the
// customer is submitting now (pending verification) — never call it "paid".
function payableLabelText(method) {
  return method === "Cash on Delivery" ? "Pay on delivery" : "Advance payment amount";
}

// Delivery fee follows the commercial rules: Advance orders (including
// every customized-collection order, which is always advance-only) get
// free delivery at the threshold; COD is a flat normal-courier charge.
function computeDeliveryFee(paymentMethod, subtotal, forceAdvance) {
  const r = Settings.get();
  if (paymentMethod === "Advance Payment" || forceAdvance) {
    return subtotal >= r.FREE_DELIVERY_THRESHOLD ? 0 : r.ADVANCE_DELIVERY_FEE;
  }
  return r.COD_DELIVERY_FEE;
}

// Left-side in-cart status ("✓ In Cart: N") and right-side "Selected total"
// box used on every product card — the only selected-state presentation;
// no separate "Line total" wording and no desktop Total column anywhere.
function inCartStatusHTML(qty) {
  if (qty <= 0) return "";
  return `<span class="in-cart-badge">✓ In Cart: ${qty}</span>`;
}
function selectedTotalHTML(amount) {
  return `<span class="pc-total-label">Selected total</span><span class="pc-total-value mono">${CONFIG.CURRENCY} ${amount}</span>`;
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
    if (countEl) countEl.textContent = this.count();
  }
};

// ---- Toast ----
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
      { eventID: orderId }
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

  if (count === 0 || view === "confirmation") {
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
    btn.textContent = "Confirm & Place Order";
    btn.setAttribute("form", "paymentForm");
    btn.setAttribute("type", "submit");
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
    return `<div class="delivery-upsell qualified">✓ Your order qualifies for FREE delivery with Advance Payment.</div>`;
  }
  const remaining = r.FREE_DELIVERY_THRESHOLD - subtotal;
  return `<div class="delivery-upsell">
    <div class="du-text">Add ${CONFIG.CURRENCY} ${remaining} more and pay in advance to unlock FREE delivery.</div>
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
    if (view === "home") return app.innerHTML = this.home();
    if (["vegetables", "flowers", "mix", "fertilizer"].includes(view)) return this.category(view);
    if (view === "contact") return app.innerHTML = this.contact();
    if (view === "cart") return this.cart();
    if (view === "delivery") return this.delivery();
    if (view === "payment") return this.payment();
  },

  home() {
    const catCounts = {};
    DEFAULT_PRODUCTS.forEach(p => catCounts[p.cat] = (catCounts[p.cat] || 0) + 1);
    return `
      <section class="hero">
        <div class="hero-inner">
          <div class="hero-badge">🌱 Hoja Seeds</div>
          <h1>Good seeds, delivered to your door.</h1>
          <p>Vegetable, flower and curated mix seed packets for home gardens across Pakistan — pay Cash on Delivery, or send an advance and save on delivery.</p>
          <div class="cta-row">
            <button class="btn btn-primary" onclick="Router.go('vegetables')">Shop Vegetable Seeds</button>
            <button class="btn btn-secondary" onclick="Router.go('mix')">Browse Mix Kits</button>
          </div>
          <div class="trust-row">
            <div class="trust-chip"><span class="ic">🚚</span>Nationwide delivery</div>
            <div class="trust-chip"><span class="ic">💵</span>Cash on Delivery</div>
            <div class="trust-chip"><span class="ic">🌱</span>Fresh seed stock</div>
          </div>
        </div>
      </section>
      <div class="cat-grid">
        ${["vegetables", "flowers", "mix", "fertilizer"].map(cat => `
          <div class="cat-tile" data-cat="${cat}">
            <button class="cat-tile-btn" onclick="Router.go('${cat}')" aria-label="${CATEGORY_META[cat].label}"></button>
            <div class="cat-tile-content">
              <span class="name">${CATEGORY_META[cat].label}</span>
              <span class="count">${catCounts[cat]} varieties</span>
            </div>
          </div>`).join("")}
      </div>
      <section class="page">
        <h3 class="section-title">Why Hoja Seeds</h3>
        <div class="why-grid">
          <div class="why-card"><span class="ic">🌱</span><h4>Fresh stock</h4><p>Seed packets sourced and packed for this season.</p></div>
          <div class="why-card"><span class="ic">💵</span><h4>Flexible payment</h4><p>COD, or pay in advance via JazzCash, EasyPaisa or bank transfer.</p></div>
          <div class="why-card"><span class="ic">🚚</span><h4>Nationwide</h4><p>We deliver across Pakistan, city or countryside.</p></div>
          <div class="why-card"><span class="ic">🌻</span><h4>For every garden</h4><p>From balcony pots to full kitchen plots.</p></div>
        </div>
      </section>`;
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
          ${r.COD_ALLOWED ? `<div class="trust-chip"><span class="ic">💵</span>COD Available</div>` : ""}
          <div class="trust-chip"><span class="ic">🚚</span>Advance Delivery ${CONFIG.CURRENCY} ${r.ADVANCE_DELIVERY_FEE}</div>
          <div class="trust-chip"><span class="ic">🌱</span>Free Delivery ${CONFIG.CURRENCY} ${r.FREE_DELIVERY_THRESHOLD}+</div>
        </div>
        <div class="product-list">
          ${products.map(p => {
            const qty = items[p.id] || 0;
            return `
            <article class="product-card${qty > 0 ? " in-cart" : ""}" data-product-id="${p.id}" aria-label="${qty > 0 ? `${p.name}, in cart, ${qty} packet${qty === 1 ? "" : "s"}, ${CONFIG.CURRENCY} ${qty * p.price} selected` : p.name}">
              <div class="pc-media">${p.icon}</div>
              <div class="pc-body">
                <div class="pc-name">${p.name}${productBadgeHTML(p)}</div>
                <div class="pc-unit">per ${p.unit}</div>
                <div class="pc-price">${CONFIG.CURRENCY} ${p.price} / ${p.unit}</div>
                <div class="pc-instock" id="sel-${p.id}"${qty > 0 ? "" : ' style="display:none"'}>${inCartStatusHTML(qty)}</div>
              </div>
              <div class="pc-actions">
                <div class="stepper">
                  <button onclick="Views.changeQty('${p.id}',-1)" aria-label="Decrease quantity">−</button>
                  <span class="qty-display" id="qty-${p.id}">${qty}</span>
                  <button onclick="Views.changeQty('${p.id}',1)" aria-label="Increase quantity">+</button>
                </div>
                <div class="pc-total" id="tot-${p.id}"${qty > 0 ? "" : ' style="display:none"'}>${selectedTotalHTML(qty * p.price)}</div>
              </div>
            </article>`;
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
      totEl.style.display = next > 0 ? "" : "none";
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
      const rows = byCat[cat].map(({ p, qty, line }) => `
        <article class="cart-line in-cart" data-pid="${p.id}">
          <div class="cl-media">${p.icon}</div>
          <div class="cl-body">
            <div class="cl-name">${p.name}${productBadgeHTML(p)}</div>
            <div class="cl-unit">per ${p.unit}</div>
            <div class="cl-price">${CONFIG.CURRENCY} ${p.price} / ${p.unit}</div>
            <div class="cl-instock"><span class="in-cart-badge">In cart: ${qty}</span></div>
          </div>
          <div class="cl-actions">
            <div class="stepper">
              <button onclick="Views.cartChangeQty('${p.id}',-1)" aria-label="Decrease quantity">−</button>
              <span class="qty-display">${qty}</span>
              <button onclick="Views.cartChangeQty('${p.id}',1)" aria-label="Increase quantity">+</button>
            </div>
            <div class="cl-total">
              <span class="cl-total-label">Selected total</span>
              <span class="cl-total-value mono">${CONFIG.CURRENCY} ${line}</span>
            </div>
            <button class="cart-remove-link" onclick="Views.cartChangeQty('${p.id}',${-qty})" aria-label="Remove ${p.name}">Remove</button>
          </div>
        </article>`).join("");
      return `<div class="cat-group-title">${CATEGORY_META[cat].label}</div>${rows}<div class="cat-group-subtotal">Subtotal: ${CONFIG.CURRENCY} ${catSubtotal}</div>`;
    }).join("");

    app.innerHTML = `
      <section class="page narrow">
        ${journeyBarHTML(1)}
        <div class="page-head"><h2>Your Cart</h2>${cats.length ? `<p class="tagline">Review your seeds before delivery</p>` : ""}</div>
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
            <div class="field-row">
              <div class="field"><label for="o-name">Full name</label><input id="o-name" value="${d.name || ""}" required></div>
              <div class="field"><label for="o-phone">Phone number</label><input id="o-phone" type="tel" value="${d.phone || ""}" required></div>
            </div>
            <div class="field"><label for="o-address">Delivery address</label><textarea id="o-address" rows="2" required>${d.address || ""}</textarea></div>
            <div class="field-row">
              <div class="field"><label for="o-city">City</label><input id="o-city" value="${d.city || ""}" required></div>
              <div class="field"><label for="o-postal">Postal code (optional)</label><input id="o-postal" value="${d.postal || ""}"></div>
            </div>
            <div class="field"><label for="o-notes">Order notes (optional)</label><textarea id="o-notes" rows="2">${d.notes || ""}</textarea></div>
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

  confirmDelivery(e) {
    e.preventDefault();
    // HTML5 required attributes already block invalid submits; this is the
    // explicit "not confirmed yet" gate the button represents.
    const delivery = {
      name: document.getElementById("o-name").value.trim(),
      phone: document.getElementById("o-phone").value.trim(),
      address: document.getElementById("o-address").value.trim(),
      city: document.getElementById("o-city").value.trim(),
      postal: document.getElementById("o-postal").value.trim(),
      notes: document.getElementById("o-notes").value.trim(),
    };
    if (!delivery.name || !delivery.phone || !delivery.address || !delivery.city) {
      document.getElementById("deliveryStatus").innerHTML = `<div class="order-status err">Please fill in all required delivery details.</div>`;
      return;
    }
    this._order = this._order || {};
    this._order.delivery = delivery;
    Analytics.addShippingInfo(Cart.flatLines(), Cart.totalAmount());
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
    const codAllowed = r.COD_ALLOWED && !hasCustomized;
    const subtotal = lines.reduce((s, l) => s + l.line, 0);
    const defaultMethod = codAllowed ? "Cash on Delivery" : "Advance Payment";
    const defaultFee = computeDeliveryFee(defaultMethod, subtotal, !codAllowed);
    this._order.subtotal = subtotal;
    this._order.deliveryFee = defaultFee;
    this._order.total = subtotal + defaultFee;
    this._order.codAllowed = codAllowed;
    const accounts = CONFIG.PAYMENT_ACCOUNTS;

    const restrictedNote = !codAllowed
      ? `<div class="payment-restricted-note">${hasCustomized
          ? "Customized orders are prepared specially for you and require 100% advance payment."
          : "Cash on Delivery isn't available right now — this order requires advance payment."}</div>`
      : "";

    app.innerHTML = `
      <section class="page narrow">
        ${journeyBarHTML(3)}
        ${flowStatusHTML(true, false)}
        <div class="step-nav-row"><button class="back-link" onclick="Router.go('delivery')">← Back to Delivery</button></div>
        <div class="page-head"><h2>Payment</h2><p class="tagline">Choose how you'd like to pay, then confirm below</p></div>
        <form id="paymentForm" onsubmit="Views.submitOrder(event)">
          <div class="checkout-grid">
            <div class="form-card">
              <h3>Payment Method</h3>
              ${restrictedNote}
              <div class="pay-options">
                ${codAllowed ? `
                <label class="pay-option" id="payCOD">
                  <input type="radio" name="pay" value="Cash on Delivery" checked onchange="Views.selectPay('payCOD','payAdvance')">
                  <div class="pay-option-title">Cash on Delivery</div>
                  <div class="pay-option-sub">Pay when it arrives · Delivery ${CONFIG.CURRENCY} ${r.COD_DELIVERY_FEE}</div>
                </label>` : ""}
                <label class="pay-option ${codAllowed ? "" : "selected"}" id="payAdvance">
                  <input type="radio" name="pay" value="Advance Payment" ${codAllowed ? "" : "checked"} onchange="Views.selectPay('payAdvance','payCOD')">
                  <div class="pay-option-title">Advance Payment</div>
                  <div class="pay-option-sub">JazzCash · EasyPaisa · Bank Transfer · Delivery ${CONFIG.CURRENCY} ${r.ADVANCE_DELIVERY_FEE} (free at ${CONFIG.CURRENCY} ${r.FREE_DELIVERY_THRESHOLD}+)</div>
                </label>
              </div>

              <div class="free-delivery-progress" id="freeDeliveryProgress"></div>

              <div class="advance-details" id="advanceDetails" style="display:${codAllowed ? "none" : "block"}">
                <h4>Send payment to one of these</h4>
                <div class="acct-row"><span>JazzCash</span><span class="mono">${accounts.JazzCash}</span></div>
                <div class="acct-row"><span>EasyPaisa</span><span class="mono">${accounts.EasyPaisa}</span></div>
                <div class="acct-row"><span>Bank Transfer</span><span class="mono">${accounts["Bank Transfer"]}</span></div>
                <div class="field" style="margin-top:12px"><label for="o-advance-method">Paid via</label>
                  <select id="o-advance-method">
                    <option value="JazzCash">JazzCash</option>
                    <option value="EasyPaisa">EasyPaisa</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>
                <div class="field"><label for="o-txn-ref">Transaction ID / reference</label><input id="o-txn-ref" placeholder="e.g. TXN123456"></div>
                <p class="advance-note">We'll confirm your payment and dispatch your order once received.</p>
              </div>
            </div>
            <div class="summary-card">
              <h3>Order Summary</h3>
              ${lines.map(l => `<div class="summary-line"><span>${l.p.name} × ${l.qty}</span><span class="mono">${CONFIG.CURRENCY} ${l.line}</span></div>`).join("")}
              <div class="summary-line"><span>Items subtotal</span><span class="mono">${CONFIG.CURRENCY} ${subtotal}</span></div>
              <div class="summary-line"><span>Delivery</span><span class="mono" id="summaryDeliveryFee">${CONFIG.CURRENCY} ${defaultFee}</span></div>
              <div class="summary-line"><span>Payment method</span><span id="summaryPaymentMethod">${defaultMethod}</span></div>
              <div class="summary-line total"><span id="payableLabel">${payableLabelText(defaultMethod)}</span><span id="summaryTotal">${CONFIG.CURRENCY} ${subtotal + defaultFee}</span></div>
              <button class="inline-submit" type="submit" id="submitBtn">Confirm & Place Order — ${CONFIG.CURRENCY} ${subtotal + defaultFee}</button>
              <div id="orderStatus"></div>
            </div>
          </div>
          <div class="step-actions-secondary">
            <button type="button" class="btn-text-secondary" onclick="Router.go('delivery')">← Back to Delivery</button>
            <button type="button" class="btn-text-tertiary" onclick="Router.go(Router.lastCategory)">Continue Shopping</button>
          </div>
        </form>
      </section>`;

    if (codAllowed) document.getElementById("payCOD").classList.add("selected");
    this.renderFreeDeliveryProgress(defaultMethod, subtotal, hasCustomized);
    Analytics.addPaymentInfo(lines, subtotal, defaultMethod);
  },

  // "Rs.320 more for FREE delivery" — only meaningful while paying in
  // advance (COD's fee doesn't move with subtotal).
  renderFreeDeliveryProgress(method, subtotal, hasCustomized) {
    const el = document.getElementById("freeDeliveryProgress");
    if (!el) return;
    const r = Settings.get();
    if (method !== "Advance Payment" && !hasCustomized) { el.innerHTML = ""; return; }
    const pct = Math.min(100, Math.round((subtotal / r.FREE_DELIVERY_THRESHOLD) * 100));
    if (subtotal >= r.FREE_DELIVERY_THRESHOLD) {
      el.innerHTML = `<div class="fdp-text unlocked">🎉 You've unlocked FREE delivery!</div>`;
      return;
    }
    const remaining = r.FREE_DELIVERY_THRESHOLD - subtotal;
    el.innerHTML = `
      <div class="fdp-text">${CONFIG.CURRENCY} ${remaining} more for FREE delivery</div>
      <div class="fdp-track"><div class="fdp-fill" style="width:${pct}%"></div></div>`;
  },

  selectPay(onId, offId) {
    document.getElementById(onId).classList.add("selected");
    document.getElementById(offId)?.classList.remove("selected");
    this.updateDeliveryFee();
    refreshStickyBar();
  },

  updateDeliveryFee() {
    const method = document.querySelector('input[name="pay"]:checked').value;
    const hasCustomized = Cart.flatLines().some(l => l.p.type === "customized-collection");
    const subtotal = this._order.subtotal;
    const fee = computeDeliveryFee(method, subtotal, hasCustomized && !this._order.codAllowed);
    const total = subtotal + fee;
    document.getElementById("summaryDeliveryFee").textContent = `${CONFIG.CURRENCY} ${fee}`;
    document.getElementById("summaryPaymentMethod").textContent = method;
    document.getElementById("payableLabel").textContent = payableLabelText(method);
    document.getElementById("summaryTotal").textContent = `${CONFIG.CURRENCY} ${total}`;
    document.getElementById("submitBtn").textContent = `Confirm & Place Order — ${CONFIG.CURRENCY} ${total}`;
    document.getElementById("advanceDetails").style.display = method === "Advance Payment" ? "block" : "none";
    this._order.deliveryFee = fee;
    this._order.total = total;
    this.renderFreeDeliveryProgress(method, subtotal, hasCustomized);
    Analytics.addPaymentInfo(Cart.flatLines(), subtotal, method);
  },

  async submitOrder(e) {
    e.preventDefault();
    const status = document.getElementById("orderStatus");
    let paymentMethod = document.querySelector('input[name="pay"]:checked').value;
    if (this._order && this._order.codAllowed === false) paymentMethod = "Advance Payment";

    const transactionReference = paymentMethod === "Advance Payment" ? document.getElementById("o-txn-ref").value.trim() : "";
    if (paymentMethod === "Advance Payment" && transactionReference.length < 3) {
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

    const inlineBtn = document.getElementById("submitBtn");
    const stickyBtn = document.getElementById("sbAction");
    inlineBtn.disabled = true;
    inlineBtn.textContent = "Placing order…";
    if (stickyBtn) { stickyBtn.disabled = true; stickyBtn.textContent = "Placing order…"; }

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
        advanceMethod: paymentMethod === "Advance Payment" ? document.getElementById("o-advance-method").value : "",
        transactionReference
      },
      items: lines.map(line => ({ productId: line.p.id, quantity: line.qty }))
    };
    const requestSignature = JSON.stringify(request);
    if (!this._order.idempotencyKey || this._order.idempotencyRequestSignature !== requestSignature) {
      this._order.idempotencyKey = createIdempotencyKey();
      this._order.idempotencyRequestSignature = requestSignature;
    }
    request.idempotencyKey = this._order.idempotencyKey;

    const result = await Orders.submit(request);
    if (result.ok) {
      const confirmedLines = result.items.map(item => {
        const localProduct = Prices.get().find(product => product.id === item.productId) || {};
        return {
          p: { ...localProduct, id: item.productId, name: item.name, price: item.unitPrice, cat: item.category || localProduct.cat },
          qty: item.quantity,
          line: item.lineTotal
        };
      });
      this.showOrderConfirmation(result);
      Cart.clearSubmitted(result.items);
      this._order = null;
      try {
        Analytics.purchase(result.orderId, result, confirmedLines);
      } catch (error) {
        console.error("Purchase analytics failed:", error);
      }
    } else {
      this.showOrderError(status, result.error?.message || "Couldn't place the order. Please try again shortly.");
      inlineBtn.disabled = false;
      inlineBtn.textContent = `Confirm & Place Order — ${CONFIG.CURRENCY} ${this._order.total}`;
      if (stickyBtn) { stickyBtn.disabled = false; stickyBtn.textContent = "Confirm & Place Order"; }
    }
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
    window.scrollTo({ top: 0, behavior: "smooth" });
    const isCOD = payload.paymentMethod === "Cash on Delivery";
    const customer = payload.customer || {};
    const itemSummary = payload.items.map(item => `${item.name} x${item.quantity}`).join(", ");
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
          <div class="ps-amount ${isCOD ? "cod" : "advance"}">
            <span class="ps-amount-label">${isCOD ? "Pay on delivery" : "Advance payment submitted"}</span>
            <span class="ps-amount-value">${CONFIG.CURRENCY} ${payload.total}</span>
          </div>
          <div class="ps-row"><span>Payment method</span><span>${escapeHTML(payload.paymentMethod)}${payload.advanceMethod ? " — " + escapeHTML(payload.advanceMethod) : ""}</span></div>
          <p class="advance-note">${isCOD
            ? "Have this amount ready in cash when your order arrives."
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
  }
};

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
      const response = await fetch(CONFIG.SHEET_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload),
        signal: controller.signal
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
  await Promise.all([Prices.load(), Settings.load()]);
  Cart.renderCount();
  Router.go("home");
})();
