# Hoja Seeds — Setup Guide

A mobile-responsive vegetable/flower/mix-seed and fertilizer ordering site,
built as static HTML/CSS/JS (no build step, no hosting cost). Orders and
prices flow through a Google Sheet. It works fully in **demo mode** right
now (open `index.html`), and upgrades to **live mode** once you connect
Google Sheets.

See `docs/PLAN.md` for the project plan, `docs/WIREFRAMES.md` for a
screen-by-screen layout reference, and `docs/DESIGN.md` for the visual
design tokens — useful context if you're picking this up in VS Code.

## What's inside
```
index.html            Storefront shell (mobile-first: hamburger nav, sticky bottom bar)
admin.html             Super Admin — pricing, product types, store rules
css/styles.css          All styling, mobile-first responsive
js/products.js          Default product catalog (fallback data, includes `type`)
js/config.js            Sheet URL, WhatsApp number, public admin OAuth client ID, payment accounts, pricing rules
js/app.js               Storefront logic — Summary -> Delivery -> Payment -> Confirmation
js/admin.js             Admin panel logic
assets/images/           Drop your real product photos here (see its README)
apps-script/Code.gs     Google Apps Script backend (deploy into your Sheet)
scripts/                 Read-only Sheet verification, additive migration, and guarded clasp tooling
config/sheet-schema.json Code-managed versioned Sheet schema
docs/PLAN.md            Project plan
docs/WIREFRAMES.md      Text wireframes for every screen
docs/DESIGN.md          Design tokens and component reference
robots.txt / sitemap.xml
```

## Commercial rules layer
All configurable from Super Admin (`admin.html` → Store Settings), with
`js/config.js` `PRICING_RULES` as the starting defaults:

| Rule | Default |
|---|---|
| Free delivery threshold (advance orders) | Rs. 1,500 |
| Advance delivery fee below threshold | Rs. 100 |
| COD delivery fee (flat, "normal courier charge") | Rs. 250 |
| COD allowed storewide | Yes |
| Customized-collection orders require 100% advance | Yes |

Each product also carries a **type** (editable per-product in Super Admin):
`regular`, `premium` (gets a "★ Premium" badge), `standard-collection`
(COD + Advance both available, like any other product), or
`customized-collection` (forces advance-only payment and shows "Customized
orders are prepared specially for you and require 100% advance payment."
at checkout — automatically, no matter what else is in the cart).

While paying in advance, a live message ("Rs. 320 more for FREE delivery")
with a small progress bar nudges the cart toward the free-delivery
threshold — recalculates instantly as quantities or payment method change.

## The commerce flow
Built as a real 4-step checkout, with a progress bar and a status line
("Delivery: Pending/Confirmed ✓ · Payment: Pending/Confirmed ✓") shown on
every step:

1. **Browse** — category pages (Vegetable/Flower/Mix Seeds, Fertilizer).
   Tapping +/− on a product updates the cart immediately. A sticky bar
   appears at the bottom once the cart has items: **n items · Rs. total → View Cart**.
2. **Summary** (step 1) — full-page review, **grouped by category** (not one
   mixed list) with a subtotal per category, then an overall subtotal.
   Bottom bar becomes **Continue to Delivery**.
3. **Delivery** (step 2) — name, phone, address, city. This step is
   *gated*: the button reads **"Confirm Delivery"** and won't advance to
   Payment until the required fields are filled in.
4. **Payment** (step 3) — Cash on Delivery or Advance Payment (JazzCash /
   EasyPaisa / Bank Transfer), each with its own delivery fee. Bottom bar
   becomes **Confirm & Place Order**.
5. **Confirmation** (step 4) — full order summary with the server-generated
   order ID and authoritative totals. COD is shown as `COD Due`; advance
   payments remain `Payment Verification` until checked. The cart is cleared
   only after a valid `{ ok: true }` server response.

Reaching Payment without a confirmed Delivery step (e.g. via back button)
bounces back to Delivery automatically — the steps can't be skipped.

The top-right cart icon is just a quick link into the Summary page — the
bottom bar is the primary way through the flow, since most shoppers are on
mobile.

## SEO
- `index.html` has a real title/description, canonical tag, Open Graph +
  Twitter Card tags, and `OnlineStore` JSON-LD structured data. Update the
  placeholder domain (`www.hojaseeds.pk`) throughout once you have a real
  one — it appears in `index.html`, `js/config.js` (`SITE_URL`),
  `robots.txt`, and `sitemap.xml`.
- Each step also sets a real `document.title` as you navigate (e.g.
  "Vegetable Seeds — Hoja Seeds"), which helps analytics and anyone who
  bookmarks a step, even though it doesn't create separate crawlable URLs.
- **Honest limitation:** this is a client-rendered single-page app, so
  Google only ever sees one real URL (`/`) — the category pages aren't
  independently indexable the way separate HTML pages would be. If organic
  search ranking for "vegetable seeds Pakistan"-type queries matters to
  you, the next step is either a prerendering service (e.g. Prerender.io)
  or moving product pages to a lightweight static-site generator later.
  No code change here can promise a specific traffic number — that also
  depends on content, backlinks, and site speed.

## Analytics — GA4 + Meta Pixel, with deduplication
Both trackers stay completely off until you fill in `js/config.js`:
```js
GA4_MEASUREMENT_ID: "G-XXXXXXXXXX",
META_PIXEL_ID: "1234567890123456",
```
Once set, the full ecommerce funnel fires automatically: `view_item_list` /
`ViewContent` → `add_to_cart` / `AddToCart` → `view_cart` → `begin_checkout`
/ `InitiateCheckout` → `add_shipping_info` → `add_payment_info` /
`AddPaymentInfo` → `purchase` / `Purchase`.

**How duplicate events are avoided:**
- The SPA fires exactly one `page_view` per route change; GA4's automatic
  first pageview is disabled (`send_page_view: false`) so the homepage
  isn't counted twice.
- `add_to_cart` / `remove_from_cart` only fire on an actual quantity
  change, never on a plain re-render.
- `view_cart` only fires on real navigation into the Summary page, not on
  every quantity edit made while already there.
- Each order gets one server-generated `orderId` (also written to your Google Sheet)
  used as **both** the GA4 `transaction_id` and the Meta `eventID` — this
  is the standard way to keep Pixel and a future server-side Conversions
  API from double-counting the same purchase. The submit button is
  disabled during submission, and purchase events fire only after the
  server returns a complete successful order.

## Adding real product photos
The homepage hero and the four category tiles are wired to use real photos
if you provide them — see `assets/images/README.md` for the exact filenames
and sizes. Until then, each falls back to a clean gradient automatically, so
nothing ever looks broken. (I didn't hotlink stock photos found via search
into this build — their licensing wasn't clear enough for a live commercial
site; your own product photography is the safer and more authentic choice
here anyway.)

## Try it now (demo mode)
Just open `index.html` in a browser. Browsing, prices, cart, delivery, and
payment selection work locally. Order confirmation intentionally requires a
configured Apps Script endpoint so the browser cannot create an authoritative
order by itself. Admin price edits remain local in demo mode.

## Go live: connect Google Sheets

**Step 1 — Create the Sheet**
1. Create a new Google Sheet, e.g. "Hoja Seeds Orders".
2. Add four tabs with these exact names and header rows:
   - `Products`: `id | name | cat | unit | icon | price | type`
     — copy in your catalog (start from `js/products.js` for the values;
     `type` is one of `regular`, `premium`, `standard-collection`,
     `customized-collection`).
   - `Orders`: `timestamp | orderId | name | phone | address | city | postal | notes | paymentMethod | advanceMethod | transactionRef | items | subtotal | deliveryFee | total`
   - `Contact`: `timestamp | name | phone | message`
   - `Settings`: `key | value` — add one row per rule:
     `FREE_DELIVERY_THRESHOLD` (1500), `ADVANCE_DELIVERY_FEE` (100),
      `COD_DELIVERY_FEE` (250), `COD_ALLOWED` (TRUE), `CUSTOMIZED_REQUIRES_FULL_ADVANCE` (TRUE).
      Customized collections are always advance-only; the legacy setting
      must remain `TRUE`.

**Step 2 — Deploy the backend**
1. In the Sheet, go to **Extensions → Apps Script**.
2. Delete the placeholder code and paste in `apps-script/Code.gs`.
3. Click **Deploy → New deployment**. Type: **Web app**. Execute as: **Me**.
   Who has access: **Anyone**. Click **Deploy** and authorize when prompted.
4. Copy the Web App URL (ends in `/exec`).

**Step 3 — Connect the site**
1. Open `js/config.js`.
2. Paste the URL into `SHEET_WEBHOOK_URL`.
3. Set `WHATSAPP_NUMBER` (fallback if the Sheet is ever unreachable).
4. Fill in your real JazzCash/EasyPaisa/bank details in
   `CONFIG.PAYMENT_ACCOUNTS`, and adjust `CONFIG.PRICING_RULES` if your
   delivery fees or free-delivery threshold differ from the defaults —
   or just edit them later from Super Admin, no code change needed.

That's it — prices and types in the `Products` tab, and rules in the
`Settings` tab, now drive the storefront; orders land in `Orders`; and
every Super Admin change writes straight back to the sheet.

### Production-safe order contract

The storefront sends customer/payment fields, product IDs + quantities, and
a client idempotency key. It does not send trusted prices or totals. Apps
Script reloads Products and Settings, validates the request, recalculates all
amounts, enforces customized-collection advance payment, and generates the
order ID. Under `LockService`, a deterministic server order ID and request
fingerprint stored with the item snapshot in the existing `items` cell prevent
a repeated identical key from appending a second row. Existing Orders columns
remain unchanged, and reusing a key with changed details is rejected.

The POST response must be readable JSON. If the deployed Apps Script URL
cannot be read cross-origin from the final host, place a same-origin proxy in
front of it; do not restore `no-cors`, because that creates false success.
Live Apps Script, Google Sheet, and hosting-origin behavior must be tested in
the real deployment environment before launch.

Run the focused local contract and regression suite with:

```powershell
node tests/order-submission.test.js
```

## Admin security
`admin.html` uses Google Identity Services. The browser contains only the
public OAuth client ID and keeps the short-lived ID-token assertion in memory;
there is no admin password or secret in frontend files. Apps Script independently
verifies the token against Script Properties:

- `HOJA_GOOGLE_CLIENT_ID`: approved public OAuth client ID
- `HOJA_ADMIN_EMAILS`: comma-separated approved administrator emails

Only `priceUpdate` and `settingsUpdate` require this authorization. Customer
order and contact requests remain public. If either server setting is missing,
admin mutations fail closed with a structured error.

## Code-managed Sheets and Apps Script
The protected production target is `hoja-seeds-2026` with Sheet ID
`1XKU3Q2r1dLxZVL0-OWOButHHp2MrFPIFA2V9ozhp6WY`, stored in
`config/production-target.json`. No other production Sheet may be used without
explicit instruction.

The canonical schema is `config/sheet-schema.json`. These commands are safe by
default and do not require credentials for dry-run planning:

```powershell
npm install
npm test
npm run sheets:verify
npm run sheets:migrate
```

Set `HOJA_SHEET_ID` and Google Application Default Credentials only for a live
verify/migration. Use `--apply` for an explicitly approved additive migration.
Existing columns and data are not deleted or renamed; `schema_version` is
tracked in the Settings key/value rows.

Clasp configuration is intentionally local. Copy `.clasp.json.example` to
`.clasp.json` only after verifying the Hoja Seeds Apps Script ID, then set
`HOJA_EXPECTED_SCRIPT_ID` and use `--remote` for any remote action. The guarded
release command refuses unknown targets, missing credentials, or unverified
Sheet IDs. No live Google operation was performed during this phase.

## Hosting
Any static host works: GitHub Pages, Netlify, Vercel, or your existing
Pakistan-based hosting. Just upload the whole folder — no server needed.

## Suggested next steps
- Add real product photos (replace the emoji icons in `products.js`).
- Add SMS/WhatsApp order confirmation via the Apps Script (Twilio or
  WhatsApp Business API) once volume justifies it.
- Add simple order-status tracking (a `status` column in `Orders`,
  editable from Admin) once you're taking daily orders.
- Consider stock/inventory tracking in the `Products` sheet if any
  seed variety sells out seasonally.
