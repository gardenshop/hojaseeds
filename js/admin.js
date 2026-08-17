const PRODUCT_TYPES = {
  "regular": "Regular",
  "premium": "Premium",
  "standard-collection": "Standard Collection",
  "customized-collection": "Customized Collection (100% advance)",
};

const Admin = {
  OV_KEY: "hoja_admin_overrides",     // { [id]: { price?, type? } }
  RULES_KEY: "hoja_pricing_rules",    // pricing-rules override object
  idToken: "",
  liveSettings: null,
  activeTab: "dashboard",
  tabs: [
    ["dashboard", "Dashboard"], ["products", "Products"], ["orders", "Orders"],
    ["customers", "Customers"], ["delivery", "Delivery & Payments"], ["analytics", "Analytics"],
    ["settings", "Store Settings"], ["audit", "Audit Log"]
  ],

  login(response) {
    if (!response || !response.credential) return this.showError("Google sign-in did not return a credential.");
    this.idToken = response.credential;
    this.enter();
  },

  checkSession() {
    if (!CONFIG.ADMIN_GOOGLE_CLIENT_ID) {
      return this.showError("Admin sign-in is not configured for this environment.");
    }
    const start = () => {
      if (!window.google?.accounts?.id) return setTimeout(start, 100);
      google.accounts.id.initialize({
        client_id: CONFIG.ADMIN_GOOGLE_CLIENT_ID,
        callback: response => this.login(response),
        auto_select: false
      });
      google.accounts.id.renderButton(document.getElementById("googleSignIn"), {
        theme: "outline", size: "large", text: "signin_with", width: 280
      });
    };
    start();
  },

  showError(message) {
    const error = document.getElementById("loginError");
    if (!error) return;
    error.textContent = message;
    error.style.display = "block";
  },

  async authorizedPost(payload) {
    if (!this.idToken) throw new Error("Admin authorization is required.");
    if (!CONFIG.SHEET_WEBHOOK_URL) throw new Error("Admin backend is not configured.");
    const response = await fetch(CONFIG.SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...payload, authToken: this.idToken })
    });
    if (!response.ok) throw new Error(`Admin service returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!result || result.ok !== true) throw new Error(result.error?.message || "Admin update was rejected.");
    return result;
  },

  async authorizedRead(resource, limit = 100) {
    return this.authorizedPost({ type: "adminRead", resource, limit });
  },

  overrides() {
    try { return JSON.parse(localStorage.getItem(this.OV_KEY)) || {}; }
    catch { return {}; }
  },

  rules() {
    try { return { ...CONFIG.PRICING_RULES, ...(JSON.parse(localStorage.getItem(this.RULES_KEY)) || {}) }; }
    catch { return { ...CONFIG.PRICING_RULES }; }
  },

  enter() {
    document.getElementById("loginView").style.display = "none";
    document.getElementById("adminView").style.display = "block";
    document.getElementById("modeNote").textContent = CONFIG.SHEET_WEBHOOK_URL
      ? "(live — synced to Google Sheet)"
      : "(demo mode — saved in this browser only, see README to connect Google Sheets)";
    this.renderTabs();
    this.renderRules();
    this.renderTables();
    this.renderAnalytics();
    this.loadSettings();
    this.loadDashboard();
  },

  renderTabs() {
    const render = target => {
      target.innerHTML = this.tabs.map(([id, label]) => `<button class="admin-tab ${id === this.activeTab ? "active" : ""}" type="button" data-tab="${id}">${label}</button>`).join("");
      target.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => this.showTab(button.dataset.tab)));
    };
    render(document.getElementById("adminSidebar"));
    render(document.getElementById("adminTabbar"));
  },

  showTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll("[data-panel]").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === tab));
    document.querySelectorAll("[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
  },

  async loadDashboard() {
    const read = (resource, onSuccess, targetIds) => this.authorizedRead(resource, 100)
      .then(onSuccess)
      .catch(error => {
        const message = `<div class="admin-error"><strong>${escapeHTML(resource)} unavailable.</strong><br>${escapeHTML(error.message)}</div>`;
        targetIds.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = message; });
      });
    await Promise.all([
      read("dashboard", result => this.renderDashboard(result.summary || {}), ["dashboardContent"]),
      read("orders", result => { this.renderOrders(result.items || []); this.renderCustomers(result.items || []); }, ["ordersContent", "customersContent"]),
      read("contacts", result => this.renderContacts(result.items || []), []),
      read("audit", result => this.renderAudit(result.items || []), ["auditContent"])
    ]);
  },

  settings() {
    return { ...CONFIG.PRICING_RULES, ...CONFIG.PAYMENT_DISPLAY, ...this.rules(), ...(this.liveSettings || {}) };
  },

  async loadSettings() {
    try {
      const result = await this.authorizedRead("settings", 1);
      this.liveSettings = result.settings || {};
      this.renderRules();
    } catch (error) {
      const form = document.getElementById("rulesForm");
      if (form) form.insertAdjacentHTML("afterbegin", `<p class="admin-error">Live payment settings could not be loaded: ${escapeHTML(error.message)}</p>`);
    }
  },

  renderDashboard(summary) {
    const metrics = [
      ["Products", summary.totalProducts], ["Active products", summary.activeProducts],
      ["Suspended/out of stock", summary.suspendedProducts], ["Orders today", summary.ordersToday],
      ["Pending orders", summary.pendingOrders], ["Payment verification", summary.paymentVerificationPending],
      ["COD due", summary.codDue], ["Revenue (Rs.)", summary.revenue]
    ];
    document.getElementById("dashboardContent").innerHTML = `<div class="admin-metrics">${metrics.map(([label, value]) => `<div class="admin-metric"><strong>${escapeHTML(value ?? 0)}</strong><span>${label}</span></div>`).join("")}</div><div class="admin-data-card"><table class="admin-data-table"><thead><tr><th>Recent order</th><th>Customer</th><th>Status</th><th>Total</th></tr></thead><tbody>${(summary.recentOrders || []).map(order => `<tr><td>${escapeHTML(order.orderId)}</td><td>${escapeHTML(order.name)}<br><span class="admin-muted">${escapeHTML(order.city)}</span></td><td>${escapeHTML(order.orderStatus)}<br>${escapeHTML(order.paymentStatus)}</td><td>Rs. ${escapeHTML(order.total)}</td></tr>`).join("") || `<tr><td colspan="4">No orders yet.</td></tr>`}</tbody></table></div>`;
  },

  renderOrders(orders) {
    document.getElementById("ordersContent").innerHTML = `<div class="admin-data-card"><table class="admin-data-table"><thead><tr><th>Order</th><th>Timestamp</th><th>Customer</th><th>Payment</th><th>Total</th><th>Items</th></tr></thead><tbody>${orders.map(order => `<tr><td>${escapeHTML(order.orderId)}</td><td>${escapeHTML(order.timestamp)}</td><td>${escapeHTML(order.name)}<br>${escapeHTML(order.phone)}<br>${escapeHTML(order.city)}</td><td>${escapeHTML(order.paymentMethod)}<br>${escapeHTML(order.paymentStatus)}</td><td>Rs. ${escapeHTML(order.total)}<br><span class="admin-muted">${escapeHTML(order.orderStatus)}</span></td><td>${escapeHTML((order.items || []).map(item => `${item.name} × ${item.quantity}`).join(", "))}</td></tr>`).join("") || `<tr><td colspan="6">No orders yet.</td></tr>`}</tbody></table></div>`;
  },

  renderCustomers(orders) {
    const customers = {};
    orders.forEach(order => {
      const key = order.phone || order.name;
      const customer = customers[key] || { name: order.name, phone: order.phone, city: order.city, count: 0, spend: 0, first: order.timestamp, last: order.timestamp };
      customer.count += 1; customer.spend += Number(order.total) || 0;
      customer.first = customer.first < order.timestamp ? customer.first : order.timestamp;
      customer.last = customer.last > order.timestamp ? customer.last : order.timestamp;
      customers[key] = customer;
    });
    document.getElementById("customersContent").innerHTML = `<div class="admin-data-card"><table class="admin-data-table"><thead><tr><th>Customer</th><th>City</th><th>Orders</th><th>Total spend</th><th>First / Last</th></tr></thead><tbody>${Object.values(customers).map(c => `<tr><td>${escapeHTML(c.name)}<br>${escapeHTML(c.phone)}</td><td>${escapeHTML(c.city)}</td><td>${c.count}</td><td>Rs. ${c.spend}</td><td>${escapeHTML(c.first)}<br>${escapeHTML(c.last)}</td></tr>`).join("") || `<tr><td colspan="5">No customers yet.</td></tr>`}</tbody></table></div>`;
  },

  renderContacts(contacts) { this.contacts = contacts; },
  renderAudit(items) {
    document.getElementById("auditContent").innerHTML = `<div class="admin-data-card"><table class="admin-data-table"><thead><tr><th>Timestamp</th><th>Admin</th><th>Action</th><th>Entity</th><th>Result</th></tr></thead><tbody>${items.map(item => `<tr><td>${escapeHTML(item.timestamp)}</td><td>${escapeHTML(item.admin_email)}</td><td>${escapeHTML(item.action)}</td><td>${escapeHTML(item.entity_type)}: ${escapeHTML(item.entity_id)}</td><td>${escapeHTML(item.result)}</td></tr>`).join("") || `<tr><td colspan="5">No audit entries yet.</td></tr>`}</tbody></table></div>`;
  },

  renderAnalytics() {
    const ga4 = CONFIG.GA4_MEASUREMENT_ID || "Not configured";
    const meta = CONFIG.META_PIXEL_ID || "Not configured";
    document.getElementById("analyticsContent").innerHTML = `<div class="settings-card"><p><strong>GA4:</strong> ${escapeHTML(ga4)}</p><p><strong>Meta Pixel:</strong> ${escapeHTML(meta)}</p><p class="admin-muted">Purchase is emitted only after a confirmed authoritative order response.</p></div>`;
  },

  // ── Store-wide commercial rules ──────────────────────────────
  renderRules() {
    const r = this.settings();
    document.getElementById("rulesForm").innerHTML = `
      <div class="field-row">
        <div class="field"><label for="r-cod-fee">COD delivery fee</label><input type="number" min="0" id="r-cod-fee" value="${r.COD_DELIVERY_FEE}" class="mono"></div>
        <div class="field"><label for="r-adv-fee">Advance delivery fee</label><input type="number" min="0" id="r-adv-fee" value="${r.ADVANCE_DELIVERY_FEE}" class="mono"></div>
      </div>
      <div class="field"><label for="r-split-percent">Split payment: advance percentage (1–99)</label><input type="number" min="1" max="99" id="r-split-percent" value="${r.SPLIT_ADVANCE_PERCENT ?? 50}" class="mono"><small class="admin-muted">Customers pay this percentage now; the remainder is due on delivery.</small></div>
      <div class="field"><label for="r-min-partial-advance">Minimum partial advance</label><input type="number" min="1" max="100000" id="r-min-partial-advance" value="${r.MIN_PARTIAL_ADVANCE ?? 250}" class="mono"><small class="admin-muted">The advance is never lower than this amount after Split rounding.</small></div>
      <div class="field-row">
        <div class="field"><label for="r-threshold">Free delivery threshold</label><input type="number" min="0" id="r-threshold" value="${r.FREE_DELIVERY_THRESHOLD}" class="mono"></div>
        <div class="field"><label>&nbsp;</label>
          <label style="display:flex;align-items:center;gap:8px;font-weight:500;padding:11px 12px;border:1px solid var(--kraft-dark);border-radius:8px;background:var(--paper)">
            <input type="checkbox" id="r-cod-allowed" ${r.COD_ALLOWED ? "checked" : ""}> Cash on Delivery allowed storewide
          </label>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-weight:500;padding:11px 12px;border:1px solid var(--kraft-dark);border-radius:8px;background:var(--paper);margin-bottom:14px">
        <input type="checkbox" id="r-customized-advance" checked disabled> Customized-collection orders always require 100% advance (no COD)
      </label>
      <button class="btn btn-primary" onclick="Admin.saveRules()">Save store settings</button>
      <span class="save-note" id="rulesSaveNote"></span>
      <h3 class="payment-settings-heading">Payment method display</h3>
      <div class="payment-settings-grid">
        ${this.paymentEditorCard("JazzCash", r, [
          ["JAZZCASH_NUMBER", "Mobile / account number"], ["JAZZCASH_ACCOUNT_TITLE", "Account title"], ["JAZZCASH_QR_URL", "QR / barcode image URL"]
        ])}
        ${this.paymentEditorCard("EasyPaisa", r, [
          ["EASYPAISA_NUMBER", "Mobile / account number"], ["EASYPAISA_ACCOUNT_TITLE", "Account title"], ["EASYPAISA_QR_URL", "QR / barcode image URL"]
        ])}
        ${this.paymentEditorCard("Bank Transfer", r, [
          ["BANK_NAME", "Bank name"], ["BANK_ACCOUNT_TITLE", "Account title"], ["BANK_ACCOUNT_NUMBER", "Account number"], ["BANK_IBAN", "IBAN"], ["BANK_QR_URL", "QR / barcode image URL"]
        ])}
      </div>
      <button class="btn btn-primary" onclick="Admin.savePaymentSettings()">Save Payment Settings</button>
      <span class="save-note" id="paymentSaveNote"></span>
    `;
  },

  paymentEditorCard(method, settings, fields) {
    const prefix = method === "JazzCash" ? "JAZZCASH" : method === "EasyPaisa" ? "EASYPAISA" : "BANK";
    return `<div class="payment-settings-card"><div class="payment-settings-card-head"><h4>${method}</h4><label><input type="checkbox" id="${prefix}_ENABLED" ${settings[`${prefix}_ENABLED`] ? "checked" : ""}> Enabled</label></div>${fields.map(([key, label]) => `<div class="field"><label for="${key}">${label}</label><input id="${key}" value="${escapeHTML(settings[key] ?? "")}" ${key.endsWith("_QR_URL") ? "type=\"url\" placeholder=\"https://...\"" : ""}></div>`).join("")}<div class="payment-preview" id="preview-${prefix}">Preview updates after save.</div></div>`;
  },

  async saveRules() {
    const rules = {
      COD_DELIVERY_FEE: parseInt(document.getElementById("r-cod-fee").value, 10) || 0,
      ADVANCE_DELIVERY_FEE: parseInt(document.getElementById("r-adv-fee").value, 10) || 0,
      FREE_DELIVERY_THRESHOLD: parseInt(document.getElementById("r-threshold").value, 10) || 0,
      COD_ALLOWED: document.getElementById("r-cod-allowed").checked,
      SPLIT_ADVANCE_PERCENT: Math.min(99, Math.max(1, parseInt(document.getElementById("r-split-percent").value, 10) || 50)),
      MIN_PARTIAL_ADVANCE: Math.min(100000, Math.max(1, parseInt(document.getElementById("r-min-partial-advance").value, 10) || 250)),
      CUSTOMIZED_REQUIRES_FULL_ADVANCE: true,
    };
    const note = document.getElementById("rulesSaveNote");
    try {
      await this.authorizedPost({ type: "settingsUpdate", rules });
      localStorage.setItem(this.RULES_KEY, JSON.stringify(rules));
      note.textContent = "Saved and authorized by the server.";
    } catch (e) { note.textContent = e.message; }
    setTimeout(() => note.textContent = "", 4000);
  },

  async savePaymentSettings() {
    const keys = ["JAZZCASH_ENABLED", "JAZZCASH_NUMBER", "JAZZCASH_ACCOUNT_TITLE", "JAZZCASH_QR_URL", "EASYPAISA_ENABLED", "EASYPAISA_NUMBER", "EASYPAISA_ACCOUNT_TITLE", "EASYPAISA_QR_URL", "BANK_ENABLED", "BANK_NAME", "BANK_ACCOUNT_TITLE", "BANK_ACCOUNT_NUMBER", "BANK_IBAN", "BANK_QR_URL"];
    const settings = {};
    keys.forEach(key => {
      const el = document.getElementById(key);
      if (!el) return;
      settings[key] = el.type === "checkbox" ? el.checked : el.value.trim();
    });
    const note = document.getElementById("paymentSaveNote");
    try {
      await this.authorizedPost({ type: "settingsUpdate", rules: settings });
      this.liveSettings = { ...(this.liveSettings || {}), ...settings };
      this.renderRules();
      note.textContent = "Payment settings saved and authorized by the server.";
    } catch (e) { note.textContent = e.message; }
    setTimeout(() => { if (note) note.textContent = ""; }, 5000);
  },

  // ── Per-product price + type ──────────────────────────────
  renderTables() {
    const ov = this.overrides();
    const byCat = {};
    DEFAULT_PRODUCTS.forEach(p => { byCat[p.cat] = byCat[p.cat] || []; byCat[p.cat].push(p); });
    const wrap = document.getElementById("tables");
    wrap.innerHTML = Object.keys(byCat).map(cat => `
      <div class="cat-group">${CATEGORY_META[cat].label}</div>
      <div class="admin-data-card"><table class="admin-table">
        <thead><tr><th>Product</th><th>Default price</th><th>Current price</th><th>Type</th></tr></thead>
        <tbody>
          ${byCat[cat].map(p => {
            const o = ov[p.id] || {};
            const currentPrice = o.price != null ? o.price : p.price;
            const currentType = o.type || p.type;
            return `<tr>
              <td>${p.icon} ${p.name} <span style="color:#9a8f7a;font-size:.8rem">/${p.unit}</span></td>
              <td class="mono">${CONFIG.CURRENCY} ${p.price}</td>
              <td><input type="number" min="0" id="price-${p.id}" value="${currentPrice}" class="mono"></td>
              <td><select id="type-${p.id}">
                ${Object.entries(PRODUCT_TYPES).map(([val, label]) => `<option value="${val}" ${currentType === val ? "selected" : ""}>${label}</option>`).join("")}
              </select></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table></div>
    `).join("");
  },

  async saveAll() {
    const ov = {};
    DEFAULT_PRODUCTS.forEach(p => {
      const priceVal = parseInt(document.getElementById(`price-${p.id}`).value, 10);
      const typeVal = document.getElementById(`type-${p.id}`).value;
      const entry = {};
      if (!isNaN(priceVal) && priceVal !== p.price) entry.price = priceVal;
      if (typeVal && typeVal !== p.type) entry.type = typeVal;
      if (Object.keys(entry).length) ov[p.id] = entry;
    });
    const note = document.getElementById("saveNote");
    try {
      const updates = DEFAULT_PRODUCTS.map(p => ({
        id: p.id,
        price: ov[p.id]?.price != null ? ov[p.id].price : p.price,
        type: ov[p.id]?.type || p.type
      }));
      await this.authorizedPost({ type: "priceUpdate", updates });
      localStorage.setItem(this.OV_KEY, JSON.stringify(ov));
      note.textContent = "Saved and authorized by the server.";
    } catch (e) { note.textContent = e.message; }
    setTimeout(() => note.textContent = "", 4000);
  }
};

Admin.checkSession();

// Chrome (and other browsers) increment/decrement a focused number input on
// mouse-wheel scroll. In this admin table that can silently mutate a live
// price while an admin is just scrolling the page. Blur any number input
// before the wheel event changes its value, wherever it appears on this page.
document.addEventListener("wheel", event => {
  if (event.target instanceof HTMLInputElement && event.target.type === "number") {
    event.target.blur();
  }
}, { passive: true });

function escapeHTML(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
