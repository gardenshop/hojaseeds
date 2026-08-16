# Hoja Seeds Master Plan

This is the canonical implementation and launch plan for the Hoja Seeds
project. Future work follows:

`inspect -> smallest change -> test -> repair -> regression -> document -> protect`

## Architecture

- Static HTML/CSS/JS storefront; no framework or build step.
- `js/products.js` is fallback catalog data; Google Sheets is live catalog and
  settings authority when configured.
- Apps Script is the customer order/contact endpoint and the authority for
  product existence, current price, delivery fee, payment rules, and order ID.
- Browser cart is temporary guest state in `localStorage`.
- Admin uses Google Identity Services in the browser and sends a short-lived
  Google ID-token assertion only for mutation requests. Apps Script verifies
  the token, audience, expiry, verified email, and server-side email allowlist.
- `config/sheet-schema.json` is the code-managed additive Sheet schema source.
- `config/production-target.json` is the protected non-secret Hoja Seeds Sheet
  target; no alternate production Sheet is permitted without instruction.
- `scripts/sheets-verify.mjs` is read-only by default; migration requires an
  explicit `--apply` and verified Sheet credentials/ID.
- `.clasp.json` is intentionally local and ignored. Remote Apps Script actions
  require a verified Script ID, matching bound Sheet ID, and explicit `--remote`.
- Public contact fields are length/phone validated and formula-safe before
  writing to the Contact sheet.

## Business Rules

- Standard products may use COD when `COD_ALLOWED` is true.
- Advance payment supports JazzCash, EasyPaisa, and Bank Transfer.
- Advance orders below PKR 1,500 use the configured advance fee.
- Advance orders at or above PKR 1,500 receive free delivery.
- Customized collections are always advance-only; COD is rejected.
- COD fee remains the configured existing value and is not invented by tooling.
- COD is `COD Due`; advance payment is `Payment Verification` until checked.

## Sheet Authority

- Products and Settings are read from the current Sheet at order submission.
- Existing `Products`, `Orders`, `Contact`, and `Settings` names/columns are
  preserved.
- Migration adds missing sheets/headers only; it does not delete, rename, or
  rewrite existing data.
- `schema_version` is tracked as a Settings key/value row.
- Inventory and OrderItems are prepared by the schema foundation but are not
  activated as stock reservation or normalized order writes yet.

## Change Protocol

1. Inspect the relevant code and this document.
2. Confirm the change does not violate Protected Scope.
3. Make the smallest isolated change.
4. Run focused tests.
5. Repair failures and rerun.
6. Run checkout/cart/navigation/responsive regression checks.
7. Update documentation and readiness.
8. Add finalized behavior to Protected Scope.

Never place credentials, tokens, service-account keys, `.clasp.json`, or admin
secrets in tracked files. Never perform remote Sheet or Apps Script mutation
without verifying target identity and explicit operator authorization.

## Current Phases

- **Phase 1:** server-authoritative order submission completed; admin mutation
  authorization and code-managed Sheet/Apps Script tooling completed locally;
  live credentialed verification remains.
- **Phase 2:** product content, photography, search, filters, seasonal UX,
  and trust improvements.
- **Phase 3:** authenticated order operations, inventory reservation, payment
  verification, OrderItems writes, and order lifecycle management.
- **Phase 4:** crawlable category/product pages, structured data, analytics
  validation, performance, and growth.

## Protected Scope

- Mobile-first layout, earthy design, sticky cart, quantity behavior, category
  navigation, cart persistence, and four-step checkout.
- Server-authoritative product pricing and delivery calculation.
- Customized collection advance-only enforcement.
- Server-generated order IDs and LockService idempotency.
- Readable success/failure response contract.
- Cart clears only after confirmed server success.
- Purchase analytics only after confirmed success.
- Admin mutations require server-side Google identity authorization.
- No admin password or secret is present in frontend files.
- Sheet migrations are versioned, additive, deterministic, and dry-run first.
- Remote Sheet/Apps Script mutation requires verified target IDs.
- Apps Script target verification must confirm the Script title and its bound
  parent Sheet ID match the reviewed Hoja Seeds targets.
- The verified live identity is `gisupp@gmail.com`; the verified Apps Script
  ID and latest deployment are stored in `config/production-target.json`.
- The verified production deployment is anonymous for customer GET/POST
  requests and executes as the deploying owner; admin mutations remain token
  and allowlist protected.
- The 47-product production catalog is sourced only from `js/products.js`,
  appended additively by `scripts/products-migrate.mjs`, and must remain ID,
  price, unit, category, name, and type consistent with that approved source.
- The live production order contract (verified 2026-08-16 directly against
  the deployed `/exec` endpoint): COD fee, advance fee below Rs. 1,500,
  free delivery at/above Rs. 1,500, customized-collection COD rejection,
  customized-collection advance acceptance, idempotent replay returning the
  same order ID with no duplicate write, and idempotency-conflict rejection
  on a reused key with different items.
- The live anonymous-admin-rejection contract (verified 2026-08-16): no
  token, a forged/garbage token, and a forged `Origin` header are all
  rejected before any Sheet write; Apps Script CORS remains anonymous by
  design (`Access-Control-Allow-Origin: *`) with authorization enforced by
  token verification, not origin restriction.
- The Purchase/purchase analytics event contract: fires only after a
  confirmed `result.ok` server response, keyed by the server-generated
  `orderId` as both the GA4 `transaction_id` and the Meta `eventID` so a
  retried/duplicate client-side fire is deduplicated by the vendor.
- Real-browser baseline (Playwright Chromium, 2026-08-16) protects 360/390/412
  mobile, 768 tablet, and 1440 desktop layout behavior: no horizontal overflow,
  no sticky overlap, five-menu navigation, live category counts, cart persistence,
  server-confirmed checkout, and failure cart retention.
- Category pages use compact truthful payment chips, unambiguous unit pricing,
  and three-card `Explore More` cross-sell navigation excluding the current category.
- The canonical GitHub baseline is `gardenshop/hojaseeds` `main`; the public
  frontend is deployed to Cloudflare Pages project `hojaseeds` under the
  verified `gisupp@gmail.com` account. R2 is intentionally not used because
  launch images are safe local gradient/emoji fallbacks.
- The production GIS Web client is
  `804856718644-6eknoj1m8jcsbh5v9f6362p3gac9u5cs.apps.googleusercontent.com`;
  its approved JavaScript origins include `https://www.hojaseeds.pk` and
  `https://hojaseeds.pk`. The Apps Script audience and frontend client ID must
  remain identical.
- The launch-safe admin dashboard foundation provides responsive tabs for
  Dashboard, Products, Orders, Customers, Delivery & Payments, Analytics,
  Store Settings, and Audit Log. Sensitive reads and mutations remain behind
  the existing server-side Google authorization; order/customer views derive
  from bounded existing Sheets data without changing frozen order columns.
- The forensic responsive baseline (2026-08-16) covers 320/360/375/390/393/
  412/430/768/1024/1280/1366/1440/1920 widths and confirms no document
  overflow on storefront routes after the category-grid minmax repair.
- Cart/product-selection UX contract (verified 2026-08-16 via headless
  Chromium against a local static server): `Cart.totalAmount()`/
  `Cart.count()` always sum every item in `localStorage`, proven from the
  first added product onward through a third add and a quantity increase
  (Rs. 185 → Rs. 306 → Rs. 427 across three sequential adds, matching the
  sticky bar exactly at each step). Every category row with qty ≥ 1 shows a
  single consistent `✓ In Cart` badge plus a `N packet(s) · Rs. X selected`
  line — no separate "Line total" wording anywhere, no separate desktop
  Total column. Selected state derives from `localStorage` on every render,
  so it survives reload and return-from-Cart. The Cart page lists each item
  as a separated card labelled `Selected total: Rs. X` with a text `Remove`
  control, and the bottom summary reads `Items subtotal` / `Delivery:
  Calculated at payment` / `Current payable: Rs. X + delivery` — never an
  implied final total before a payment method is chosen.
- Delivery-page free-delivery upsell (verified 2026-08-16) reads
  `FREE_DELIVERY_THRESHOLD`/`ADVANCE_DELIVERY_FEE` live from Settings (never
  hardcoded), shows the exact remaining amount and an `Add More Seeds`
  control that returns to shopping without clearing the cart, and switches
  to a qualified state at/above the threshold — advance-payment only, never
  implying COD gets free delivery.
- Delivery and Payment step navigation (verified 2026-08-16) each keep a
  single primary submit (`Confirm Delivery` / `Confirm & Place Order`) plus
  secondary (`Back to Order Summary` / `Back to Delivery`) and tertiary
  (`Continue Shopping`) controls that are plain `type="button"` — no
  duplicate form submissions — and back-navigation preserves already-entered
  delivery form data and the cart.
- Explore More cross-sell (verified 2026-08-16) renders three gradient
  category cards (reusing the existing `cat-tile` gradient palette, no
  broken image requests) instead of plain text buttons, 2-column on mobile
  widths and 3-column at ≥520px.
- Post-fix responsive regression (2026-08-16, headless Chromium):
  320×568/375×812/768×1024/1440×900 across Vegetables/Flowers/Mix/Fertilizer
  report `document.documentElement.scrollWidth <= innerWidth` with zero
  console errors.
- Deploy-source contract (established 2026-08-16): Cloudflare Pages project
  `hojaseeds` has no GitHub integration — a GitHub push alone never
  redeploys production. Publishing requires an explicit `wrangler pages
  deploy` of a clean static artifact (`index.html`, `admin.html`,
  `robots.txt`, `sitemap.xml`, `css/`, `js/`, `assets/` only) against the
  existing `hojaseeds` project with `--branch=main` and
  `--commit-hash=<the pushed GitHub SHA>`, using the account verified by
  `wrangler whoami` (`gisupp@gmail.com`, account `85f6a618…a474`). Custom
  domains (`www.hojaseeds.pk`, `hojaseeds.pk`) serve the latest Production
  deployment immediately with no separate promote/cache-purge step. Never
  create a second Pages project and never touch DNS/domain/Apps
  Script/Sheet as part of a deploy. Production-served `js/app.js`/
  `css/styles.css` must be spot-checked against current source after every
  deploy — a GitHub push and a live production deploy are not the same
  event.
- Production-verified 2026-08-16 (direct browser tests against
  `www.hojaseeds.pk`, cleared `localStorage`): first-product selection
  shows the sticky bar immediately with the correct subtotal, a second
  product keeps both rows selected with a combined subtotal, quantity 2
  shows the packet count and selected amount with no `Line total` text and
  no desktop `Total` column anywhere in the DOM, state survives reload, and
  the three-card gradient Explore More renders with a background on every
  card. The 320–1440 × four-category overflow/console/network sweep passes
  live in production, not just locally.
- Payment/thank-you presentation contract (2026-08-16): the Payment page's
  `Payment Method` and `Order Summary` are two visually separate cards in
  one form; `Confirm & Place Order` lives only at the end of the Order
  Summary card, never inside Payment Method. The Order Summary payable line
  reads `Pay on delivery` for COD or `Advance payment amount` for Advance,
  driven by `payableLabelText()`. The confirmation page's primary view is a
  hero + a single-amount `payment-summary-card` (`Pay on delivery: Rs. X`
  for COD, `Advance payment submitted: Rs. X` for Advance — advance is
  described as "submitted", never "paid", since it is pending
  verification); the itemized breakdown lives in a secondary collapsible
  `<details>` card, not the main view.
- Premium product-card contract (2026-08-16): category pages render
  `.product-card` articles (`data-product-id`, keyed exactly as the prior
  table rows were) instead of a table — icon tile, name/badge, unit price
  on the left; a stepper and a `Selected total` box on the right; desktop
  ≥640px lays the three groups out in one row, mobile stacks stepper+total
  under the product details. Selected state is `✓ In Cart: N` (`#sel-{id}`)
  plus the `Selected total` box (`#tot-{id}`), both hidden at qty 0 with no
  "Line total" wording and no desktop Total column anywhere. `Cart.setQty`,
  `Cart.totalAmount`, and all cart/order behavior are unchanged — only the
  DOM the same ids/handlers render into changed. The header and sticky
  checkout bar use a deep-green gradient; the sticky bar adds a cart icon,
  a `Total Amount` caption, `View Cart & Checkout →` on the browsing
  action, and a `Secure checkout · Safe & Reliable` note shown at ≥640px
  only — the underlying route/action per step is unchanged. Verified
  locally: acceptance tests A–G (neutral qty-0 card, first-item sticky
  appearance, multi-item selection, qty-to-zero, reload persistence, Cart
  page, full Summary→Delivery→Payment→Confirmation flow) all pass, plus an
  11-viewport (320–1920) × four-category overflow sweep with zero console
  errors and zero failed requests.

## Launch Acceptance Gates

- [x] Google OAuth Web client ID configured for the approved admin origins.
- [ ] Protected Sheet target verified: `hoja-seeds-2026` /
      `1XKU3Q2r1dLxZVL0-OWOButHHp2MrFPIFA2V9ozhp6WY`.
- [ ] Apps Script Script Properties contain approved client ID and admin email allowlist.
- [ ] Apps Script target Script ID and Sheet ID independently verified as Hoja Seeds.
- [ ] `npm install` completed from the reviewed lock/configuration policy.
- [ ] `npm test` passes.
- [ ] `npm run sheets:verify` passes against the intended Sheet.
- [ ] Migration dry-run reviewed; apply run performed only with approval.
- [ ] Apps Script readable JSON response works from the production origin.
- [x] Anonymous price/settings mutations are rejected — reconfirmed live
      2026-08-16 with no token, a forged/garbage token (round-tripped
      through Google's tokeninfo endpoint), and a forged `Origin` header.
- [ ] Authorized price/settings mutations are accepted and audited — Web
      client synchronized; final interactive mutation/restore verification remains.
- [x] Public order and contact submissions work — full commercial order
      matrix (COD, advance below/at Rs. 1,500, customized-collection
      COD block/advance accept, idempotent replay, idempotency conflict,
      invalid product) verified live against the production `/exec`
      endpoint 2026-08-16.
- [ ] No credentials or secrets are tracked.
- [ ] Browser/device regression and live smoke tests pass — server/API-level
      and static-asset checks pass (2026-08-16); real-browser DOM, console,
      and network-tab verification is still outstanding (no browser tool
      available this session).
- [ ] Admin authentication, payment verification, inventory, and deployment
      operational policies are approved.
