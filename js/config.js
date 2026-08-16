// ── Hoja Seeds site config ─────────────────────────────────────────
// Fill SHEET_WEBHOOK_URL after you deploy apps-script/Code.gs as a
// Web App (see README.md, Step 2). Until it's filled in, the site
// runs fully in "demo mode": prices and orders are kept in the
// browser's localStorage so you can test everything end-to-end.

const CONFIG = {
  SHEET_WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbzYM49XQ8xQmeuZN6N4rytg_BNnU8kXOTK-Q31y5jga8KzcxFH6mUuXSTwGJZJTDqIv/exec",
  STORE_NAME: "Hoja Seeds",
  WHATSAPP_NUMBER: "", // e.g. "923001234567" (no + or leading 0) for the WhatsApp fallback link
  CURRENCY: "Rs.",
  // Public Google Identity Services client ID for the admin sign-in button.
  // This is not a secret. Leave blank until the Apps Script allowlist and
  // Google OAuth client have been configured.
  ADMIN_GOOGLE_CLIENT_ID: "804856718644-9jbk23vd23rsrs9dci7gepcmtbmq40ob.apps.googleusercontent.com",

  // ── Commercial / pricing rules layer ──────────────────────────────
  // All of this is editable from Super Admin (admin.html) at runtime —
  // these are just the starting defaults. Logic that reads these lives
  // in js/app.js (see `Settings` and `computeDeliveryFee`).
  PRICING_RULES: {
    FREE_DELIVERY_THRESHOLD: 1500, // Advance orders at/above this subtotal ship free
    ADVANCE_DELIVERY_FEE: 100,     // Advance orders below the threshold
    COD_DELIVERY_FEE: 250,         // Normal courier charge for Cash on Delivery — set to your courier's real rate
    COD_ALLOWED: true,             // Global switch — turn off to require advance payment storewide
    CUSTOMIZED_REQUIRES_FULL_ADVANCE: true, // Customized-collection items always force 100% advance, no COD
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
  GA4_MEASUREMENT_ID: "", // e.g. "G-XXXXXXXXXX"
  META_PIXEL_ID: "",      // e.g. "1234567890123456"
};
