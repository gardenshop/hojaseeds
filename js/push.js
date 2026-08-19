// ── Hoja Seeds — Web Push growth module (HS-20260819-03) ──────────────
// Entirely additive and self-contained: never touches Cart/Orders/Leads
// business logic, only reads Router/Analytics/Leads for context. Loaded
// deferred and initialized on requestIdleCallback so it can never delay
// first paint/LCP. Inert end-to-end (no SW registration, no permission
// UI) whenever CONFIG.VAPID_PUBLIC_KEY is blank or the browser lacks
// Notification/PushManager/serviceWorker support.

const PushGrowth = {
  MAX_SOFT_PROMPTS_PER_VISIT: 2,
  COOLDOWN_DAYS_AFTER_CLOSE: 3, // configurable cooldown for future visits
  _shownThisVisit: 0,
  _secondOfferArmed: false,
  _secondOfferShown: false,

  supported() {
    return typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  },

  visitorId() {
    let id;
    try { id = localStorage.getItem("hoja_visitor_id"); } catch { id = null; }
    if (!id) {
      id = "visitor-" + createIdempotencyKey();
      try { localStorage.setItem("hoja_visitor_id", id); } catch { /* ignore */ }
    }
    return id;
  },

  // Cross-visit state, kept deliberately small: whether the customer ever
  // made a decisive choice (granted/denied), and when the card was last
  // closed (for the cooldown). Never a substitute for the real source of
  // truth, which is always Notification.permission itself.
  state() {
    try { return JSON.parse(localStorage.getItem("hoja_push_state")) || {}; }
    catch { return {}; }
  },
  saveState(patch) {
    const next = Object.assign(this.state(), patch, { updatedAt: Date.now() });
    try { localStorage.setItem("hoja_push_state", JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  },

  cooldownActive() {
    const s = this.state();
    if (!s.lastClosedAt) return false;
    return (Date.now() - s.lastClosedAt) < this.COOLDOWN_DAYS_AFTER_CLOSE * 86400000;
  },

  eligibleForSoftPrompt() {
    if (!this.supported()) return false;
    if (Notification.permission !== "default") return false; // already decided, natively
    if (this._shownThisVisit >= this.MAX_SOFT_PROMPTS_PER_VISIT) return false;
    if (this._shownThisVisit === 0 && this.cooldownActive()) return false;
    return true;
  },

  logEvent(eventType, campaignId, metadata) {
    if (!CONFIG.SHEET_WEBHOOK_URL) return;
    try {
      fetch(CONFIG.SHEET_WEBHOOK_URL, {
        method: "POST",
        body: JSON.stringify({ type: "pushEvent", visitorId: this.visitorId(), campaignId: campaignId || "", eventType, metadata: metadata || {} })
      }).catch(() => {});
    } catch { /* best-effort only */ }
  },

  init() {
    if (!this.supported() || !this.eligibleForSoftPrompt()) return;
    // First offer: 3-5s after useful content is visible (called once from
    // the Home render bootstrap, not on every route change).
    setTimeout(() => this.showSoftPrompt("first"), 3000 + Math.floor(Math.random() * 2000));
    this.armSecondOpportunity();
    this.reconcile();
  },

  // Exit-intent (desktop) + a generous inactivity fallback (works on
  // mobile, where a "leaving the tab" signal isn't reliably detectable) --
  // never uses beforeunload/unload to request anything.
  armSecondOpportunity() {
    if (this._secondOfferArmed) return;
    this._secondOfferArmed = true;
    let interacted = false;
    const markInteracted = () => { interacted = true; };
    document.addEventListener("pointerdown", markInteracted, { once: true, passive: true });
    document.addEventListener("keydown", markInteracted, { once: true });

    const tryShowSecond = () => {
      if (this._secondOfferShown || !interacted) return;
      if (!this.eligibleForSoftPrompt()) return;
      this._secondOfferShown = true;
      this.showSoftPrompt("second");
    };

    document.addEventListener("mouseout", e => {
      if (e.clientY <= 0 && e.relatedTarget === null) tryShowSecond();
    });
    setTimeout(tryShowSecond, 45000); // mobile-safe inactivity fallback
  },

  reconcile() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration("/push-sw.js").then(reg => {
      if (!reg) return;
      reg.pushManager.getSubscription().then(sub => {
        if (Notification.permission === "granted" && sub) {
          this.reportSubscription("granted", sub);
        } else if (Notification.permission === "denied") {
          this.reportSubscription("denied", null);
        }
      }).catch(() => {});
    }).catch(() => {});
  },

  showSoftPrompt(which) {
    if (document.getElementById("hojaPushCard")) return;
    this._shownThisVisit++;
    this.logEvent("prompt_view", "", { which });
    const card = document.createElement("div");
    card.id = "hojaPushCard";
    card.className = "push-offer-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Hoja Seeds offer alerts");
    card.innerHTML = which === "second" ? `
      <button type="button" class="push-offer-close" aria-label="Close">×</button>
      <div class="push-offer-title">🎁 Before You Go…</div>
      <p class="push-offer-body">Get Gift Seed, Free Delivery and seasonal Hoja offers.</p>
      <button type="button" class="btn btn-primary push-offer-cta">Enable Free Offer Alerts</button>
    ` : `
      <button type="button" class="push-offer-close" aria-label="Close">×</button>
      <div class="push-offer-title">🌱 Hoja Seeds Special Offers</div>
      <ul class="push-offer-list">
        <li>🎁 Gift Seeds</li>
        <li>🚚 Free Delivery Offers</li>
        <li>🌿 Seasonal Deals</li>
        <li>✨ New Arrivals</li>
      </ul>
      <p class="push-offer-body">Get useful seasonal alerts and special Hoja Seeds offers.</p>
      <button type="button" class="btn btn-primary push-offer-cta">Enable Free Offer Alerts</button>
    `;
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add("show"));

    card.querySelector(".push-offer-close").addEventListener("click", () => {
      this.logEvent("soft_close", "", { which });
      this.saveState({ lastClosedAt: Date.now() });
      card.remove();
    });
    card.querySelector(".push-offer-cta").addEventListener("click", () => {
      this.logEvent("soft_accept_click", "", { which });
      card.remove();
      this.requestNativePermission();
    });
  },

  // Native browser permission is invoked ONLY from here, which is ONLY
  // ever called from the CTA click handler above -- never on a timer,
  // never on page load.
  async requestNativePermission() {
    let permission;
    try { permission = await Notification.requestPermission(); }
    catch { permission = "default"; }

    if (permission === "granted") {
      this.logEvent("native_granted");
      await this.subscribe();
    } else if (permission === "denied") {
      this.logEvent("native_denied");
      this.reportSubscription("denied", null);
    } else {
      this.logEvent("native_default");
    }
  },

  async subscribe() {
    if (!CONFIG.VAPID_PUBLIC_KEY) {
      // Permission is real and worth recording even if no push provider
      // is configured yet -- the Admin dashboard should still reflect
      // genuine opt-in interest.
      this.reportSubscription("granted", null);
      return;
    }
    try {
      await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
      // register() can resolve while the worker is still "installing" --
      // pushManager.subscribe() requires an ACTIVE worker, so on a fresh
      // (first-ever) registration this raced and threw "no active Service
      // Worker" (HS-20260819-08: this was the actual reason zero real
      // subscriptions ever reached production). .ready resolves only once
      // a worker has activated for this scope.
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY)
      });
      this.logEvent("subscribed");
      this.reportSubscription("granted", sub);
    } catch (e) {
      console.warn("Push subscribe failed:", e);
      this.reportSubscription("granted", null);
    }
  },

  reportSubscription(permissionStatus, sub) {
    if (!CONFIG.SHEET_WEBHOOK_URL) return;
    const json = sub ? sub.toJSON() : {};
    try {
      fetch(CONFIG.SHEET_WEBHOOK_URL, {
        method: "POST",
        body: JSON.stringify({
          type: "pushSubscription",
          visitorId: this.visitorId(),
          permissionStatus,
          subscription: { endpoint: json.endpoint || "", p256dh: json.keys?.p256dh || "", auth: json.keys?.auth || "" },
          browserInfo: (navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/) || [""])[0],
          deviceInfo: /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop",
          utmSource: new URLSearchParams(location.search).get("utm_source") || ""
        })
      }).catch(() => {});
    } catch { /* best-effort only */ }
  }
};

// Standard VAPID key conversion (base64url -> Uint8Array) required by
// PushManager.subscribe's applicationServerKey.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Deferred script, executes after app.js's synchronous Home render --
// deliberately idle-scheduled so it can never compete with first paint.
(function bootPushGrowth() {
  const start = () => PushGrowth.init();
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 4000 });
  else setTimeout(start, 300);
})();
