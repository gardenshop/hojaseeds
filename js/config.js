// ── Hoja Seeds site config ─────────────────────────────────────────
// Fill SHEET_WEBHOOK_URL after you deploy apps-script/Code.gs as a
// Web App (see README.md, Step 2). Until it's filled in, the site
// runs fully in "demo mode": prices and orders are kept in the
// browser's localStorage so you can test everything end-to-end.

const CONFIG = {
  SHEET_WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbz2OLBzz6igtHiGlVmC3b4ANqmjikDbninRqYlTqiUC9a6PtnZD23bdwsWmMGd4pK0/exec",
  STORE_NAME: "Hoja Seeds",
  WHATSAPP_NUMBER: "", // e.g. "923001234567" (no + or leading 0) for the WhatsApp fallback link
  CURRENCY: "Rs.",
  // Public Google Identity Services client ID for the admin sign-in button.
  // This is not a secret. Leave blank until the Apps Script allowlist and
  // Google OAuth client have been configured.
  ADMIN_GOOGLE_CLIENT_ID: "804856718644-6eknoj1m8jcsbh5v9f6362p3gac9u5cs.apps.googleusercontent.com",

  // Bank Alfalah APG (HS-20260820-01): double-gated sandbox-only flag.
  // Even with this on, the payment tab only appears if the server's own
  // APG_ENABLED Settings flag is ALSO on -- flip this to false (or delete
  // it) before any real customer exposure; there is no separate
  // production flag yet, by design, until sandbox E2E has fully passed.
  APG_SANDBOX_MODE: true,

  // ── Commercial / pricing rules layer ──────────────────────────────
  // All of this is editable from Super Admin (admin.html) at runtime —
  // these are just the starting defaults. Logic that reads these lives
  // in js/app.js (see `Settings` and `computeDeliveryFee`).
  PRICING_RULES: {
    FREE_DELIVERY_THRESHOLD: 1500, // Advance orders at/above this subtotal ship free
    ADVANCE_DELIVERY_FEE: 100,     // Advance orders below the threshold
    COD_DELIVERY_FEE: 250,         // Normal courier charge for Cash on Delivery — set to your courier's real rate
    COD_ALLOWED: true,             // Global switch — turn off to require advance payment storewide
    SPLIT_ADVANCE_PERCENT: 50,     // Customer pays this percentage now; remainder is COD
    MIN_PARTIAL_ADVANCE: 250,      // Floor after Split COD rounding; never exceeds the order total
    CUSTOMIZED_REQUIRES_FULL_ADVANCE: true, // Customized-collection items always force 100% advance, no COD
  },

  PAYMENT_DISPLAY: {
    JAZZCASH_ENABLED: true,
    JAZZCASH_NUMBER: "0300-XXXXXXX",
    JAZZCASH_ACCOUNT_TITLE: "Hoja Seeds",
    JAZZCASH_QR_URL: "",
    EASYPAISA_ENABLED: true,
    EASYPAISA_NUMBER: "0300-XXXXXXX",
    EASYPAISA_ACCOUNT_TITLE: "Hoja Seeds",
    EASYPAISA_QR_URL: "",
    BANK_ENABLED: true,
    BANK_NAME: "HBL",
    BANK_ACCOUNT_TITLE: "Hoja Seeds",
    BANK_ACCOUNT_NUMBER: "XXXXXXXXXXXX",
    BANK_IBAN: "",
    BANK_QR_URL: ""
  },

  // Shown to customers who choose Advance Payment — fill in your real details.
  PAYMENT_ACCOUNTS: {
    JazzCash: "0300-XXXXXXX (Account title: Hoja Seeds)",
    EasyPaisa: "0300-XXXXXXX (Account title: Hoja Seeds)",
    "Bank Transfer": "HBL — Acc# XXXXXXXXXXXX — Hoja Seeds",
  },

  // Your live domain — used in canonical/Open Graph tags and sitemap.xml.
  SITE_URL: "https://www.hojaseeds.pk",

  // Analytics — leave blank to keep them off (no script loads, no events
  // fire, nothing breaks). Fill in your real IDs to turn tracking on.
  GA4_MEASUREMENT_ID: "G-LRMW9NMGW5", // Hoja Seeds GA4 property (owner-verified, HS-20260819-01)
  META_PIXEL_ID: "1467679375059082",  // Hoja Seeds Meta Pixel/Dataset (owner-verified, HS-20260819-01)

  // Web Push (HS-20260819-03) — leave blank to keep the whole feature
  // inert (no service worker registration attempted, no permission UI
  // shown, no subscription created). This is the VAPID *public* key only
  // — safe to publish, it's what PushManager.subscribe() sends to the
  // browser's push service. The matching private key never goes here —
  // see docs/PROJECT_STATE.md for where it belongs and how to generate
  // both (e.g. `npx web-push generate-vapid-keys`).
  VAPID_PUBLIC_KEY: "BA3MYrsBBQ8zugJG2bt9ObFdkvVEN75_knVH0kkv9ju3LIfLwT0exo0aWHcxj9Bu_pFvtwVZg8U0OfdwAaBJR2A",
};
