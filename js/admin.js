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
    this.renderRules();
    this.renderTables();
  },

  // ── Store-wide commercial rules ──────────────────────────────
  renderRules() {
    const r = this.rules();
    document.getElementById("rulesForm").innerHTML = `
      <div class="field-row">
        <div class="field"><label for="r-cod-fee">COD delivery fee</label><input type="number" min="0" id="r-cod-fee" value="${r.COD_DELIVERY_FEE}" class="mono"></div>
        <div class="field"><label for="r-adv-fee">Advance delivery fee</label><input type="number" min="0" id="r-adv-fee" value="${r.ADVANCE_DELIVERY_FEE}" class="mono"></div>
      </div>
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
    `;
  },

  async saveRules() {
    const rules = {
      COD_DELIVERY_FEE: parseInt(document.getElementById("r-cod-fee").value, 10) || 0,
      ADVANCE_DELIVERY_FEE: parseInt(document.getElementById("r-adv-fee").value, 10) || 0,
      FREE_DELIVERY_THRESHOLD: parseInt(document.getElementById("r-threshold").value, 10) || 0,
      COD_ALLOWED: document.getElementById("r-cod-allowed").checked,
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

  // ── Per-product price + type ──────────────────────────────
  renderTables() {
    const ov = this.overrides();
    const byCat = {};
    DEFAULT_PRODUCTS.forEach(p => {
      byCat[p.cat] = byCat[p.cat] || [];
      byCat[p.cat].push(p);
    });
    const wrap = document.getElementById("tables");
    wrap.innerHTML = Object.keys(byCat).map(cat => `
      <div class="cat-group">${CATEGORY_META[cat].label}</div>
      <table class="admin-table">
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
      </table>
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
