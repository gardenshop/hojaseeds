# Hoja Seeds — Project Plan

## What this is
A mobile-first ordering site for vegetable, flower and mix seed packets plus
fertilizer, built for the Pakistani market: Cash on Delivery + advance
payment (JazzCash/EasyPaisa/bank transfer), Google Sheets as the order/price
database, and no build step — plain HTML/CSS/JS that opens directly in a
browser or deploys to any static host.

## Tech stack & why
- **No framework, no build step.** Every file is plain HTML/CSS/JS so it can
  be opened directly, edited in VS Code, and deployed to literally any
  static host (GitHub Pages, Netlify, Vercel, cPanel — anything that serves
  files).
- **Google Sheets as the backend.** No server to maintain. `apps-script/Code.gs`
  turns a Sheet into a tiny JSON API (`GET ?action=products`,
  `GET ?action=settings`, `POST` for orders/contact/price+settings updates).
- **localStorage as the offline/demo fallback.** Every write (cart, admin
  price edits, orders) also lands in the browser's storage, so the whole
  site is testable before Google Sheets is even set up.

## Site map
```
/                    Home — hero, category tiles, "why us"
/ (route: vegetables) Vegetable Seeds — product table
/ (route: flowers)     Flower Seeds — product table
/ (route: mix)          Mix Seeds — product table (standard + customized collections)
/ (route: fertilizer)   Fertilizer — product table
/ (route: contact)      Contact form
/ (route: cart)         Order Summary — step 1 of checkout, grouped by category
/ (route: delivery)     Delivery Details — step 2, gated ("Confirm Delivery")
/ (route: payment)      Payment — step 3, COD/Advance with commercial rules
/ (route: confirmation) Order Confirmed — step 4
/admin.html             Super Admin — pricing, product types, store rules
```
This is a client-rendered single-page app (routes are virtual, not separate
files) — see README.md "SEO notes" for what that means for search ranking.

## Commercial rules layer (the part just added)
All of this lives in `js/config.js` (defaults) and is editable at runtime
from Super Admin — see `docs/WIREFRAMES.md` for the admin screen layout.

| Rule | Default | Where it's enforced |
|---|---|---|
| Free delivery threshold | Rs. 1,500 | `computeDeliveryFee()` in app.js |
| Advance delivery fee (below threshold) | Rs. 100 | same |
| COD delivery fee (flat) | Rs. 250 | same |
| COD allowed storewide | Yes | Payment step, gates the COD radio |
| Customized collections require 100% advance | Yes | Payment step, forces Advance + shows notice |

Product **type** (`regular` / `premium` / `standard-collection` /
`customized-collection`) drives two things: a small badge on the product
row, and — for `customized-collection` — forcing advance-only payment.

## Build order (what was done, in sequence)
1. Static storefront: 5-menu nav, tabular product listings, cart, COD-only checkout.
2. Advance payment option (JazzCash/EasyPaisa/bank) alongside COD.
3. Bug fixes: cart drawer blocking navigation, missing order confirmation.
4. Mobile-first redesign: sticky bottom action bar, journey/progress bar,
   real 4-step checkout (Summary → Delivery → Payment → Confirmed).
5. SEO (meta/OG/JSON-LD/sitemap) + GA4 + Meta Pixel with event deduplication.
6. This pass: commercial pricing/payment rules layer, back/continue-shopping
   navigation, icon-only remove control, badges, admin-configurable store
   settings.
7. Production order foundation: IDs/quantities-only frontend request,
   server-authoritative validation and totals, server order IDs, locked
   idempotency, readable JSON responses, and analytics/cart gating on
   confirmed success.

## Suggested next steps
- Real product photography (see `assets/images/README.md`).
- Configure the Google Identity client ID, Apps Script admin email allowlist,
  Sheet ID, and Apps Script Script ID outside tracked files; then run the
  guarded verify/migration/clasp workflow.
- If organic search ranking matters, look at prerendering (Prerender.io) or
  a static-site generator for individually indexable category pages.
- Real authentication for `/admin.html` before it handles meaningful volume
  (see README "Admin security note").
- Verify readable Apps Script POST responses against the real static-host
  origin; use a same-origin proxy if direct cross-origin reads are blocked.
