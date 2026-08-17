# Hoja Seeds — Project State

**Read this file first, every time, before making any change.** See the
standing instruction block in `docs/PROMPT_TEMPLATE.md` for what to paste
into each request.

---

## Scope & non-goals
- Static HTML/CSS/JS site. No build step, no framework (React/Vue/etc.),
  no npm install required to run it. Keep it that way unless explicitly
  told to migrate.
- Google Sheets (via Apps Script) is the backend. Cloudflare Pages
  Functions may be added as a proxy in front of it later — see Active.
  Do not swap the data layer (e.g. to D1, Firebase, a real database)
  without an explicit instruction to do so.
- Mobile-first: ~95% of traffic is mobile. Any layout change must be
  designed for ~380px width first, desktop second.
- No user accounts / login for customers. Checkout is guest-only by design.

## Frozen
*Locked. Do not edit, rename, restructure, or "improve" anything below
without an explicit "unfreeze <item>" instruction.*

| Item | Frozen on | What's locked |
|---|---|---|
| Checkout flow structure | this session | 4-step flow: Summary (grouped by category) → Delivery (gated) → Payment → Confirmation. Step order, gating logic, and the sticky-bottom-bar-as-primary-CTA pattern are locked. |
| Commercial rules engine | this session | `paymentPreview()` (client single source of truth for delivery fee/order total/payNow/codDue, mirrors `apps-script/Code.gs`'s `computeOrderTotals` order — supersedes the old `computeDeliveryFee()`/`splitAmounts()` pair as of HS-20260817-11), product `type` system (regular/premium/standard-collection/customized-collection), and the customized-order COD-block logic in `js/app.js`. |
| Visual design tokens | this session | Colour palette, type system (Fraunces/Inter/IBM Plex Mono), and component styles in `css/styles.css` `:root`. |
| Data schema | this session | `Products`/`Orders`/`Contact`/`Settings` Sheet tabs and their column order (`apps-script/Code.gs`). Changing this breaks existing Sheet setups. |
| Authoritative order submission | 2026-08-15 | Server current pricing/delivery calculation, customized advance enforcement, server order IDs, locked idempotency, readable success/failure JSON, cart clear only after confirmed success, and purchase analytics only after confirmed success. |
| Admin authorization | 2026-08-15 | Google Identity Services assertion in memory, independent Apps Script token verification, server-side approved email allowlist, and fail-closed mutation errors. |
| Sheet automation foundation | 2026-08-15 | Versioned additive schema, deterministic dry-run migration, target verification, ignored credentials, and guarded clasp remote actions. |

## Active
*The one thing currently in progress. Keep this to a single item — if a
new request isn't this, either finish/freeze this first or explicitly
replace it.*

- **HS-20260817-07 production synchronization completed:** the stale clasp
  credential was repaired by completing OAuth on the approved Hoja account and
  normalizing the legacy credential wrapper for clasp 3.2.0. The protected
  Apps Script source was pushed and the existing deployment updated in place
  at version 12. Live marked API tests confirm Mix COD acceptance, custom and
  mixed Split acceptance at 50/50, and server-side custom COD rejection. The
  existing `hojaseeds` Pages project was manually deployed from descendant
  commit `ab8eaf0`; browser QA confirms R2 hero/category/Explore More images,
  selected-payment payable amounts, and custom-cart draft/restore behavior.
  Authorized admin mutation/restore remains the only launch-specific browser
  verification gap.

## Not yet done (known gaps, not currently active)
- Real product photography (placeholders documented in `assets/images/README.md`)
- Live admin identity configuration and credentialed verification
- Deployment to Cloudflare Pages + domain connection
- Optional: Cloudflare Pages Function as a proxy in front of the Apps
  Script webhook (discussed, not yet built)
- Live verification of readable Apps Script order POST responses, idempotency
  persistence, and Google Sheet order writes from the final hosting origin
- Google Identity admin client ID, Apps Script admin email allowlist, and
  verified Script/Sheet IDs are not configured locally
- Protected production Sheet target is configured locally as
  `hoja-seeds-2026` / `1XKU3Q2r1dLxZVL0-OWOButHHp2MrFPIFA2V9ozhp6WY`.
- Live Google verification is blocked because the active gcloud token lacks
  Sheets API scopes and Google Application Default Credentials are absent.
- ADC is now authenticated as `gisupp@gmail.com`; Google project `hoja-seeds`
  and the protected Sheet are verified. Apps Script
  `1svMHPDCBwZTfrEwcWXVtW6cwOS2E-zjXJP2lc9t7tWRh0XPxKnLPdXnZ` is bound to the
  Sheet and source-matched. The verified public deployment is recorded in
  `config/production-target.json`; anonymous `/exec`, Products/Settings reads,
  Contact write, and anonymous admin rejection pass. All 47 approved local
  catalog products are now present in Products. Authorized browser admin
  sign-in and full interactive-browser QA remain — see 2026-08-16 entry below;
  Playwright Chromium is installed under the ignored D-drive `.tools` path and
  drove the required real-browser baseline.

## Readiness

- HS-20260817-12 release gate: `40e3fdf` is live on the existing Pages project
  and Apps Script deployment version 14. Production asset signatures match the
  intended release: `app.js` contains `paymentPreview`; `admin.js` contains
  `admin-table` and no `admin-product-row`, `admin-products-grid`, or rejected
  card markers. Delivery → Payment has zero first-party runtime errors in the
  live browser. Live payment checks passed: Mix COD `1249/0/1249`, Mix Advance
  `1099/1099/0`, and custom Split subtotal 1545 with total 1795 and
  `895/900`; the backend retest after deployment confirmed rounded Split
  output and exact total preservation. Marked live E2E orders returned order
  IDs for Mix COD, custom Advance, and custom Split. Admin visual Products
  screenshots and authorized mutation/restore remain pending GIS sign-in.

- Production readiness: **96%** — payment-policy backend/frontend
  synchronization and requested payment/image UX are live and verified.
- Remaining: **4%** — authorized GIS admin sign-in + mutation/restore test
  (still requires a human or DevTools-MCP-capable session), plus live analytics
  vendor delivery (GA4/Meta IDs still placeholders)
- Expanded operations scope readiness: **92%** (unchanged this session — the
  admin width repair and payment-policy matrix land without moving this
  number since neither closes an expanded-scope gap). The responsive admin
  shell,
  authenticated bounded reads, derived dashboard/customers views, delivery/
  analytics status panels, and additive AuditLog foundation are implemented.
- Expanded scope readiness remains capped at 92%: full product CRUD, order
  status mutations, customer status actions, trusted IP relay, and
  browser-authorized admin mutation/restore are not claimed complete.
- Verified locally: COD and advance totals, free-delivery boundary,
  customized COD rejection, tamper resistance, invalid items/quantities,
  server order IDs, locked duplicate replay, readable JSON contract,
  network/server failure cart retention, analytics gating, anonymous admin
  mutation rejection, authorized admin mutation acceptance, contact safety,
  deterministic migration dry-runs, guarded remote actions, and basic cart,
  category, sticky-bar, and mobile CSS regression checks.
- Verified live against production (2026-08-16, direct HTTPS to the deployed
  `/exec` endpoint and real-domain Playwright browser): 47
  products and settings readable anonymously; COD order (correct COD fee/
  status); advance order below Rs. 1,500 (correct advance fee); advance order
  at exactly Rs. 1,500 (free delivery boundary, inclusive); customized
  collection + COD rejected (`CUSTOMIZED_REQUIRES_ADVANCE`); customized
  collection + advance accepted with free delivery; idempotent resubmit
  returns the same server order ID with no duplicate row; same idempotency
  key with different items rejected (`IDEMPOTENCY_CONFLICT`); invalid product
  ID rejected; admin mutation with no token, and with a forged/garbage token,
  both rejected (`ADMIN_UNAUTHORIZED`, the forged token was actually round-
  tripped through Google's tokeninfo endpoint and rejected); a forged
  `Origin` header does not bypass rejection; `npm test` and
  `npm run sheets:verify` pass; static storefront/admin HTML, CSS, and JS
  all serve correctly with no syntax errors from a local static server.
  All test writes to Orders used the same marked-test convention as prior
  sessions (customer name `LAUNCH TEST DO NOT FULFILL`) — safe to delete.
- Verified by Playwright Chromium: 360x800, 390x844, 412x915, 768x1024,
  1440x900; homepage, 47 live products, five-menu navigation, all categories,
  quantity controls, persistence, sticky cart, checkout success/failure,
  server order ID, no overflow, no sticky overlap, and no unexpected failed
  requests. Expected missing image assets were removed in favor of documented
  gradient/emoji fallbacks, so the browser audit is 404-clean.
- Forensic production/local matrix additionally covered 320x568, 360x640,
  375x667, 375x812, 393x852, 430x932, 1024x768, 1280x720, 1366x768, and
  1920x1080; all storefront routes reported scrollWidth within viewport after
  the category grid repair. One third-party Google Fonts 404 remains at a
  wide viewport; no first-party runtime/network errors were observed.
- Remaining: authorized admin Google browser flow, temporary price/settings
  mutation restore, and vendor Purchase delivery (GA4/Meta IDs remain blank).
- Production Web GIS client is synchronized in `js/config.js`, the standalone
  config, and Apps Script legacy-property migration; the old Desktop client is
  no longer used by production frontend or backend defaults. Final interactive
  admin mutation/restore capture remains pending.
- GitHub `gardenshop/hojaseeds` `main` is initialized, merged with remote
  history, and pushed at the finalized baseline. Cloudflare Pages project
  `hojaseeds` is deployed under `gisupp@gmail.com`; `hojaseeds.pages.dev`,
  `hojaseeds.pk`, and `www.hojaseeds.pk` return HTTPS 200 with canonical
  `www.hojaseeds.pk`. R2 was inspected and intentionally not used.

## Changelog
*Append-only. One line per session/change.*

- Initial build: 5-menu storefront, tabular product listings, cart, COD checkout, Google Sheets order submission, Super Admin price editor.
- Added Advance Payment option (JazzCash/EasyPaisa/bank) alongside COD.
- Fixed: cart drawer blocking checkout navigation; missing order confirmation screen.
- Mobile-first redesign: sticky bottom action bar, journey/progress bar, real step-based checkout.
- Added SEO (meta/OG/JSON-LD/sitemap) + GA4 + Meta Pixel with event deduplication.
- Added commercial pricing/payment rules layer (delivery fee rules, product types, COD gating, badges) — all Super-Admin configurable.
- Added back/continue-shopping navigation, icon-only remove control.
- Created `docs/PLAN.md`, `docs/WIREFRAMES.md`, `docs/DESIGN.md` for VS Code handoff.
- Added server-authoritative order validation/totals, server order IDs,
  Orders-row fingerprint idempotency under `LockService`, readable JSON responses,
  safe confirmation rendering, failure-safe cart behavior, focused tests, and
  accurate COD/payment-verification statuses.
- Replaced browser admin password authority with Google Identity Services
  assertions and Apps Script token verification; anonymous mutations are
  rejected and authorized writes use readable JSON.
- Added additive versioned Sheet schema, deterministic dry-run/verify/migrate
  tooling, guarded clasp release tooling, ignored credential paths, and the
  canonical `docs/MASTER_PLAN.md`.
- Verified ADC as `gisupp@gmail.com`, protected Sheet identity, created and
  bound the Hoja Seeds Apps Script, applied schema version 1, verified the
  second migration is a NOOP, pushed source, and created deployments.
- Verified the new public deployment, replaced the protected endpoint URL,
  added the approved Contact schema additively, confirmed Script Properties
  initialization through anonymous admin rejection, and completed a marked
  Contact write test.
- Migrated all 47 approved local catalog products additively with exact IDs,
  names, categories, prices, units, icons, and types; verified storefront read,
  live COD/advance threshold/tamper/idempotency behavior, and marked test rows.
- 2026-08-16: Launch smoke-test pass against the live production `/exec`
  endpoint — full commercial order matrix (COD, advance below/at Rs. 1,500,
  customized-collection COD block, customized-collection advance accept,
  idempotent replay, idempotency conflict, invalid product) all correct;
  anonymous admin rejection reconfirmed with a forged/garbage token (real
  Google tokeninfo round-trip) and a forged `Origin` header; CORS remains
  anonymous by design (Apps Script `Access-Control-Allow-Origin: *`, token-
  based authorization, not origin-based); `npm test` and
  `npm run sheets:verify` pass; static HTML/CSS/JS verified syntax-clean and
  served correctly from a local static server. Reviewed `apps-script/Code.gs`
  and confirmed `OrderItems` is schema-ready but not yet written by
  `logOrder()` — orders remain fulfillable today via the JSON item snapshot
  in the `Orders.items` column, so this is a documented gap, not a launch
  blocker (see Launch Blockers below). Could not complete real-browser DOM/
  console/network QA or the authorized admin sign-in + mutation + restore
  flow: no browser-automation or computer-use tool was available in this
  session to drive an actual browser or complete interactive Google OAuth.
  Readiness moved 85% → 90%.

### Launch blockers remaining
1. **Real-browser interactive QA** — someone (or an agent with a browser
   tool) needs to actually click through the storefront in a real browser:
   quantity controls, sticky cart, 4-step checkout, category nav, and check
   the console/network tabs for errors and confirm no `no-cors` requests.
   Code review found nothing that should fail this, but it has not been
   observed in a real browser.
2. **Authorized admin browser auth** — sign in as `gisupp@gmail.com` via the
   Google Identity button on `admin.html`, confirm the ID token is accepted
   server-side, perform one price mutation and one settings mutation, then
   restore the original values. Requires a human or a browser-capable agent;
   an ID token should never be pasted to an agent as a workaround.
3. **Live analytics vendor delivery** — GA4/Meta IDs are placeholders; fill
   them in and confirm real Purchase events land in each vendor once the
   above two are done.
4. **OrderItems normalization (not urgent)** — `config/sheet-schema.json`
   defines an `OrderItems` sheet (orderId/productId/productNameSnapshot/
   packSizeSnapshot/quantity/unitPrice/lineTotal) but `logOrder()` in
   `apps-script/Code.gs` never writes to it; per-order items only exist as a
   JSON blob in the `Orders.items` column. Current `Orders` rows are
   sufficient for manual fulfillment today. Normalizing into `OrderItems`
   (for reporting/inventory) is real but separate schema-migration work and
 should be its own task, not folded into a browser-smoke-test pass.
- Added launch-safe operations dashboard foundation: responsive eight-tab
  admin shell, authenticated bounded dashboard/orders/customers/audit reads,
  Delivery & Payments and Analytics status panels, additive AuditLog schema,
  and server-side mutation audit summaries. No frozen commerce columns/rules
  were changed; status mutation, IP relay, inventory, and OrderItems remain
  deferred.
- 2026-08-16: Storefront/cart UX repair pass (working readiness baseline
  corrected to 91% before this pass, per screenshot evidence of unresolved
  defects). Rebuilt category-row selected state to a consistent `✓ In Cart`
  badge + `N packet(s) · Rs. X selected` line for every qty ≥ 1 (removed the
  qty-1-shows-nothing gap and all "Line total"/desktop Total-column
  wording); confirmed `Cart.totalAmount()` already summed every cart item
  correctly (the "second-product-only" total was a rendering/visibility
  illusion from the old Line-total-only-above-qty-1 logic, not a calculation
  bug) and proved the full add-sequence live (Rs. 185 → 306 → 427) with
  automated browser assertions. Relabeled Cart-page line items (`Selected
  total: Rs. X`, text `Remove`) and the bottom summary (`Items subtotal` /
  `Delivery: Calculated at payment` / `Current payable: Rs. X + delivery`).
  Rebuilt Explore More as three gradient category cards. Added Delivery-page
  live-Settings free-delivery upsell with an `Add More Seeds` recovery
  control, and added secondary/tertiary bottom navigation (`Back to Order
  Summary`/`Continue Shopping` on Delivery, `Back to Delivery`/`Continue
  Shopping` on Payment) alongside the existing single primary submit on
  each step, confirming no duplicate submits and no data loss on back-nav.
  Verified with headless Chromium against a local static server: acceptance
  tests A–I (product selection, multi-item subtotal, quantity change,
  reload persistence, quantity-to-zero removal, Cart page separation,
  below/at-threshold upsell states, back/continue navigation) all pass, plus
  a 320/375/768/1440 overflow + zero-console-error regression sweep across
  all four category routes. `npm test` passes unchanged. Not yet done:
  re-running this same matrix against the live `www.hojaseeds.pk` production
  origin, and the git commit/push/Cloudflare redeploy — pending explicit
  go-ahead before touching the shared `main` branch and production.
- 2026-08-16 (deploy forensics): production still served the pre-`ef1a9b3`
  UI after the push above. Root cause: Cloudflare Pages project `hojaseeds`
  has **no GitHub integration** (`wrangler pages project list` shows Git
  Provider `No`) — every prior release was a manual `wrangler pages deploy`
  upload; pushing to `origin/main` alone never triggers a build. The last
  deployment (`81461a06…`, commit label `07eec42`) was two commits behind
  HEAD. Verified `wrangler whoami` resolves the approved `gisupp@gmail.com`
  / account `85f6a618…a474`. Fixed by running `wrangler pages deploy` with a
  clean artifact directory (`index.html`, `admin.html`, `robots.txt`,
  `sitemap.xml`, `css/`, `js/`, `assets/` only — no `node_modules`/`.git`/
  `docs`/`scripts`/secrets) against the existing `hojaseeds` project,
  `--branch=main`, `--commit-hash=ef1a9b3…`. New deployment `2ee92aab`
  promoted immediately to `www.hojaseeds.pk` (custom domains follow the
  latest Production deployment; no separate promote/cache-purge step was
  needed). Confirmed `www.hojaseeds.pk/js/app.js` and `/css/styles.css` now
  contain the current source (`selected-summary`, `explore-card-name`, no
  `Line total`, no `<th>Total</th>`). Re-ran the full acceptance matrix
  directly against production (headless Chromium, cleared localStorage):
  tests A–D, Explore More cards, and a 9-viewport (320–1440) × 4-route
  overflow/console/network sweep all pass live. `npm test` still passes. No
  DNS/domain/Apps Script/Sheet/other Pages project touched.
- 2026-08-16: Payment/thank-you presentation refinement. Payment page now
  splits into two clearly separate cards inside one `<form>` — `Payment
  Method` (radio choice, delivery-fee text, free-delivery progress, advance
  account details) and `Order Summary` (line items, items subtotal,
  delivery, selected payment method, a payable-amount line labelled `Pay on
  delivery` for COD / `Advance payment amount` for Advance) — with the
  single `Confirm & Place Order` submit moved to the end of the Order
  Summary card; desktop keeps the existing two-column `checkout-grid`,
  mobile stacks Payment Method above Order Summary. Confirmation
  (thank-you) page rebuilt around a compact hero (headline/customer/city),
  a `payment-summary-card` with one prominent amount block (`Pay on
  delivery: Rs. X` for COD, `Advance payment submitted: Rs. X` for Advance
  — never "paid", since advance is pending verification), and the item
  list/delivery-fee/payment-status/transaction-ref detail moved into a
  native `<details>` "Order details" secondary card. No backend/order-total
  logic, cart, sticky bar, or delivery-page navigation/upsell changed.
  Verified locally: acceptance tests A–E (separated payment/summary blocks,
  confirm-button position, COD/Advance payable labels, COD/Advance
  thank-you amount blocks, back/continue-shopping data retention) all pass,
  plus a 320–1440 × Payment/Cart/Delivery overflow sweep with zero console
  errors and zero failed requests. `npm test` passes.
- 2026-08-16: Premium product-card/sticky-bar restyle. Category pages now
  render rounded `.product-card` articles (icon/name/badge/unit price left,
  stepper + `Selected total` box right) instead of a table; selected state
  is `✓ In Cart: N` plus the `Selected total` box, both hidden at qty 0 —
  no "Line total" wording, no desktop Total column. `changeQty()` and
  `Cart.setQty()/totalAmount()` unchanged; only the DOM ids they already
  targeted (`qty-`, `sel-`, now also `tot-{id}`) moved into the new
  markup, plus a generic `[data-product-id]` selector replacing the old
  `tr[data-product-id]`. Header and sticky bar restyled to a deep-green
  gradient; sticky bar gained a cart icon, `Total Amount` caption, `View
  Cart & Checkout →` label on the browsing action, and a `Secure checkout ·
  Safe & Reliable` note at ≥640px — same underlying route/action per step.
  Cart page, checkout flow, delivery/payment logic, and all business rules
  untouched. Verified locally: acceptance tests A–G (neutral qty-0 card,
  immediate first-item sticky bar, multi-item + qty-2 selection, qty-to-
  zero, reload persistence, Cart page, full Summary→Delivery→Payment→
  Confirmation flow) all pass; 11-viewport (320–1920) × four-category
  overflow sweep, zero console errors, zero failed requests. `npm test`
  passes.
- 2026-08-16: Premium Cart-route restyle (Views.cart(), not the category
  product listing). Cart heading changed from "Order Summary" to "Your
  Cart" with a "Review your seeds before delivery" subtitle. Each selected
  item is now a rounded `.cart-line` card (icon tile, name/badge, unit
  price, `In cart: N` badge on the left; stepper + `Selected total` box +
  `Remove` on the right, image/details | quantity | total on desktop
  ≥640px). Summary card gained an explicit `Items` count row above `Items
  subtotal`/`Delivery: Calculated at payment`/`Current payable`. Empty
  state reads "Your cart is empty" with two recovery buttons (Shop
  Vegetable Seeds / Explore Flower Seeds) and no stray sticky bar.
  `Cart.setQty()`, `cartChangeQty()`, `Cart.totalAmount()`, localStorage
  shape, and the Continue-to-Delivery route are unchanged — only the DOM
  the same handlers render into changed. Verified locally against the
  exact spec sequence (Tomato qty1 Rs.185, Okra qty2 Rs.242, 3 items/Rs.427;
  Tomato→qty2 Rs.370, 4 items/Rs.612; remove Tomato → Okra remains, 2
  items/Rs.242; reload persists; Continue to Delivery unchanged; empty-cart
  state), an 11-viewport (320–1920) overflow sweep on the actual Cart
   route, and `npm test`.
- 2026-08-16: Corrected the target screen to the category product listing,
  not the Cart route. `Views.category(cat)` now shares one responsive premium
  card system across Vegetables, Flowers, Mix, and Fertilizer: larger current
  image/icon tile, details and live payment chips, vertical `+ / qty / −`
  stepper with accessible labels, visible zero-quantity Total block, nearby
  `✓ In Cart` plus packet-selection count, and selected-card accent. No Cart,
  checkout, pricing, settings, localStorage, server, Apps Script, or admin
  operations changed. Local and production Playwright checks passed at
  320×568, 360×800, 375×812, 390×844, 412×915, 430×932, 768×1024,
  1024×768, 1366×768, 1440×900, and 1920×1080; all four category routes
  passed overflow/network/console checks and category-to-Cart-to-Delivery
  regression. Production Pages deployment commit `1343b96` is live.
- 2026-08-16: Production visual-fidelity refinement completed in CSS only
  (`d6ee65a`). Category cards now match the target composition more closely:
  substantial fallback visual zone, stronger product-details hierarchy,
  aligned four-zone desktop/390px layout, centered vertical stepper, compact
  independent Total panel, selected-state surface treatment, deeper premium
  header, and readable grid-based sticky checkout bar. Production screenshots
  `production-visual-after-390.png` and `production-visual-after-1440.png`
  show Tomato qty2 at Rs.370 and Okra qty2 at Rs.242. The 11-viewport × four-
  category production matrix passed geometry, zero overflow, and zero
  first-party failures; category-to-Payment regression passed. A known
  third-party Google Fonts 404 can occur at one 412px font-range request.
- 2026-08-16: Unified category, actual Cart, Delivery, and Payment hierarchy
  refinement deployed in `233ff89`. Category and Cart now use full-width
  title rows with top-right badges, shared visual/body/stepper/Total zones,
  and selected status below the Total hierarchy. Delivery below-threshold
  upsell has a subtle `prefers-reduced-motion`-safe glow. Payment is a
  single-column Payment Method → Order Summary → final Confirm sequence; the
  sticky payment duplicate is removed. Production screenshots captured:
  `production-final-category-390.png`, `production-final-category-1440.png`,
  `production-final-cart-390.png`, `production-final-cart-1440.png`,
  `production-final-delivery-390.png`, `production-final-payment-390.png`,
  and `production-final-payment-1440.png`. The full 11-viewport production
 matrix passed overflow, route, sequence, and first-party network checks.
- 2026-08-16: Full-site forensic repair deployed in `1a9a415` to the existing
  Pages project deployment `4eeaba02`. Production Playwright covered Home,
  Vegetables, Flowers, Mix, Fertilizer, Contact, Cart, Delivery, Payment,
  Confirmation, and the admin shell at all 11 requested viewports. Category
  and Cart selected cards now measure approximately 181–190px at 390px+;
  mobile fallbacks remain contained at 320/360px. Admin 390/768/1024/1280/
  1366/1440/1920 layouts have no page overflow, responsive metrics, mobile
  tab navigation, and Products tables contained within `.admin-data-card`.
  All eight admin tabs, one Payment submit CTA, compact cards, checkout
  routing, and reduced-motion upsell behavior passed local and production
  browser checks. No commerce/backend rules changed.
- 2026-08-16: Payment-display Settings schema version 2 migrated live with 14
  additive keys; first apply added all keys and second apply added none.
  `sheets:verify` passes. Apps Script source was deployed to version 10 on the
  verified web-app deployment, and frontend payment UI deployed in `f320fcb`
  / Pages deployment `72057f0e`. Production confirms live settings, premium
  COD/Advance cards, selected-only JazzCash/EasyPaisa/Bank details, optional
  QR-safe rendering, exact FREE-delivery progress/qualified states, and one
  final payment submit CTA across the full viewport matrix. Authorized admin
  save/restore browser capture remains pending; no fake account values or QR
  URLs were introduced.
- 2026-08-17: Repaired the reproduced product-card geometry defect with one
  shared category/Cart renderer and content-driven title/body/footer rows;
  retained the 44px stepper controls and unchanged cart handlers. Admin reads
  now settle independently so Dashboard, Orders, Customers, and Audit render
  isolated error states instead of clearing unrelated panels. Local Playwright
  checks cover all requested storefront viewports with zero overflow and zero
  console/page errors; production deployment and authorized mutation/restore
  verification remain pending.
- 2026-08-17: Applied the limited Total/footer geometry refinement. Total now
  aligns upward within the body, both contexts reserve the same normal footer
  row, and Cart Remove remains in normal footer flow. Production Playwright
  verification across Home, all categories, Contact, Cart, Delivery, and
  Payment at 320–1920 found 0px overflow, zero console errors, zero failed
  first-party requests, and zero required geometry intersections. No product,
  cart, checkout, payment, admin, or business logic changed.
- 2026-08-17 (HS-20260817-02): The 2026-08-17 geometry above was rejected
  against a supplied visual target — it still produced ~270-300px cards via a
  three-row (title/body/footer) grid with a large empty middle zone. Rebuilt
  `commerceProductCardHTML()`'s markup and CSS to one single-row body grid
  (`visual | details | stepper | total`), with in-cart status/Remove as the
  last line inside details instead of a separate footer row. Deleted the dead
  legacy `.product-card`/`.pc-*` and `.cart-line`/`.cl-*` CSS and a stale
  duplicate `.commerce-product-card` block that was overriding the intended
  geometry via cascade order — that duplicate, not any JS logic, was the root
  cause of the regression. `Cart.setQty`, `changeQty`, `cartChangeQty`,
  `Cart.totalAmount`, and all order/checkout logic are byte-for-byte
  unchanged; only the DOM those handlers render into moved. Verified with the
  project's D-drive Playwright (`.tools/browser-runner`, DevTools MCP not
  exposed to this session) against a local static server and then directly
  against `www.hojaseeds.pk`: card height 156–231px mobile / flat 164px
  desktop-tablet for qty0/qty1/qty5, 0px overflow, 0 console/page errors, 0
  failed first-party requests across 10 viewports (320–1920) × 12 route
  states (Home, 4 categories, Cart, Delivery, Payment, Contact, each with and
  without cart items). `npm test` and a JS syntax check both pass. Separately
  investigated a reported Super Admin Products-table column cut-off: directly
  measured `.admin-shell/.admin-layout/.admin-content/.admin-data-card/
  .admin-table` rects against live production at 1024/1440/1920 and found
  zero overflow with all four columns (including Type) fully visible and
  contained — not reproducible, so no admin CSS/HTML was changed; the
  reported screenshot is attributed to a stale/cached browser tab. Deployed
  via `wrangler pages deploy` (clean `index.html`/`admin.html`/`robots.txt`/
  `sitemap.xml`/`css`/`js`/`assets` artifact) against the existing `hojaseeds`
  project under the verified `gisupp@gmail.com` account, `--branch=main`,
  `--commit-hash=ef7b0d9`; deployment `f0317ff5` confirmed live at
  `www.hojaseeds.pk/js/app.js` (contains `commerce-status`, no
  `commerce-footer`). Not done this session: the authorized GIS admin
  sign-in + Tomato price/payment-setting mutation-and-restore test (requires
  a human or interactive OAuth), and per-route screenshot capture at every
  one of the 10 requested viewports (the regression sweep covered all 10
  numerically for overflow/console/network; screenshots were captured for
  the specific card/admin states shown in this task's images, not the full
  matrix).
- 2026-08-17 (HS-20260817-03): Re-audited the Super Admin Products-table
  clipping report at 1024/1280/1366/1440/1600/1920, at true 100% zoom, and at
  a 125%-zoom-equivalent effective viewport for 1366/1440/1920 (9
  configurations total) directly against live production — 0px overflow and
  all four columns visible every time, confirmed with screenshots, not just
  rects. Root cause remains unreproduced, but hardened `.admin-shell` to
  `width:min(1400px, calc(100vw - 32px))` and `.admin-table` to
  `table-layout:fixed` with explicit percentage columns (44/17/18/21%) plus
  `width:100%`/`box-sizing:border-box` on every input/select at all desktop
  widths, removing any intrinsic-content-width dependency regardless of
  whether the report reflected live code. Separately: local image assets
  (`assets/01-04_*_hd.png`, four locked winter-seed category photos, see
  `assets/ASSET_DETAILS.md`) were optimized to WebP via a temporary local
  `sharp` install (not a project dependency) and uploaded to a new dedicated
  Cloudflare R2 bucket `hoja-seeds-images`, created under the same verified
  `gisupp@gmail.com`/`85f6a618…a474` account already used for Pages (confirmed
  distinct from that account's other project buckets before creating). Bound
  to the `images.hojaseeds.pk` custom domain on the existing `hojaseeds.pk`
  zone (verified HTTPS 200 on all 5 objects, correct content-type/cache
  headers). `.hero` and each `.cat-tile[data-cat]` now layer the real photo
  over the original brand gradient (gradient stays as the fallback layer, so
  an R2 failure never shows a broken image or blank tile) — no `<img>` tags
  introduced, category tile buttons already carry `aria-label`. Hero overlay
  darkened slightly for text contrast against the busier photo. No product,
  cart, checkout, pricing, or admin-mutation logic touched; card geometry
  from HS-20260817-02 left untouched. Verified: local Playwright (12s
  cold-cache wait confirmed all 5 R2 images do load, just with fresh-domain
  TLS/cold-cache latency in automated headless runs — not a code defect),
  then directly against `www.hojaseeds.pk` at 390/768/1366/1440/1920 for
  Home (0px overflow, hero+all 4 tiles confirmed loading from
  `images.hojaseeds.pk`, 0 console/page/request errors) and at
  1366/1440/1920 for Admin Products (0px overflow, all 4 columns visible).
  `npm test` passes. Deployed via `wrangler pages deploy` against the
  existing `hojaseeds` project, `--branch=main`, `--commit-hash=969b9c8`;
  deployment `46c49ce8` confirmed live (`css/styles.css` contains
  `images.hojaseeds.pk`, `admin.html` contains `table-layout:fixed`). Not
  done this session: the authorized GIS admin sign-in + Tomato price/payment-
  setting mutation-and-restore test — no DevTools MCP was exposed to attach
  to the user's existing Chrome session, and headless Playwright cannot
  complete interactive Google OAuth, so this remains a human-required step.
- 2026-08-17 (HS-20260817-04): Cart-based payment-policy matrix. Server
  (`apps-script/Code.gs`): `productPaymentPolicy()`/`cartPaymentPolicy()`
  derive eligibility from existing Products `cat`/`type` only — no new Sheet
  column — per the documented mapping (mix+customized-collection ->
  advance_only, unchanged; mix+standard-collection -> cod; vegetables/
  flowers -> advance_or_split; everything else -> existing/unchanged). New
  `Split Payment` order method: requires an enabled advance channel +
  transaction reference like full Advance; delivery fee uses the approved
  COD fee (no separate SPLIT_DELIVERY_FEE approved); amounts are
  server-computed only, `payNow = ceil(total/2)`, `codDue = total - payNow`.
  Orders sheet gained additive `payNow`/`codDue` columns, schema_version 3,
  applied live against the real Sheet (`sheets:verify` confirms nothing
  missing; a second `sheets-migrate.mjs` run is a confirmed NOOP).
  `tests/order-submission.test.js` rewritten: the shared `order()` fixture's
  default item moved from a vegetables product to a Fertilizer product
  (preserving every pre-existing dollar-amount assertion unchanged) since
  vegetables are no longer COD-eligible, plus the full PAY-A..J
  policy-matrix coverage from the task's test plan (Mix-only COD, custom
  vegetable/flower COD-block, mixed-cart stricter-rule, tamper rejection via
  `doPost`, even/odd split rounding, delivery-fee-per-method, Mix-Pack-only
  rejects Split, customized-collection still rejects Split not just COD).
  `npm test` passes.

  Frontend (`js/app.js`, presentation only): Payment page renders one of
  three cases (Mix-Pack-only COD banner; custom-selection Advance/Split with
  no COD and a "View COD Mix Packs" upsell showing real current Mix Pack
  names/prices, navigating to Mix Seeds without mutating the cart;
  customized-collection's existing strict advance-only note unchanged).
  Order Summary always shows Order total/Pay now/Pay on delivery; submit
  button and confirmation page copy match the spec's exact wording per
  method. Category info-bar's "COD Available" chip no longer renders on
  Vegetables/Flowers pages. Verified with local Playwright across all four
  cart-composition cases (screenshots captured) and the existing 10-viewport
  x 12-route regression sweep, 0px overflow / 0 errors throughout.

  Admin (`admin.html`): `.admin-shell` widened to `width:min(96vw,1540px)`
  (from a narrower centered max-width), `.admin-layout` gap 24px, Products
  columns rebalanced to 40/17/17/26%. The reported clipping remained
  unreproduced against live production (0px overflow, all 4 columns visible
  at 1024-1920, both before and after this change, with screenshot proof) —
  this uses substantially more available desktop width regardless.

  Deployed: git commit `e16da12` pushed to `main`; Cloudflare Pages
  deployment `37fbbd01` confirmed live (`css/styles.css`/`admin.html`
  contain the new rules). **Apps Script push is NOT deployed** — local
  `clasp` credentials are stale/broken (`clasp login --status` returns
  "logged in as an unknown user"; `push` fails retrieving an access token).
  Confirmed live against `www.hojaseeds.pk`: the Payment page correctly
  offers Split Payment for custom-selection carts, but a real Split
  submission is rejected by the still-old server with a readable
  `INVALID_PAYMENT_METHOD` error (fails safely, cart retained, no crash) —
  see the Active section above for the required next step. Authorized GIS
   admin sign-in + Tomato/payment-setting mutation-and-restore test was also
   not completed this session for the same reason (no interactive browser
   access).
- 2026-08-17 (HS-20260817-07): repaired clasp OAuth for clasp 3.2.0 by
  completing the approved-account callback and normalizing the legacy global
  credential wrapper. Pushed `apps-script/Code.gs` and updated the existing
  production deployment in place to version 12. Live marked tests passed for
  Mix-only COD, custom Split (50/50), mixed-cart Split, and custom-selection
  COD rejection. Published the frontend to the existing `hojaseeds` Pages
  project from `ab8eaf0` after fixing two production-observed UX gaps: Mix
  conversion cards now show `100% COD` and the explicit conversion action;
  selected advance-method details now show exact `Pay now with …` and `Pay on
  delivery` amounts. Production browser QA passed the six required viewports,
  R2 hero/category/Explore More image visibility, selected JazzCash/EasyPaisa/
  Bank-only detail rendering, custom-cart draft conversion, and restore. No
  product, price, cart math, checkout sequence, delivery values, or security
  rules changed. Authorized GIS admin mutation/restore remains pending.
- 2026-08-17 (HS-20260817-11): **`b8eb5ce`'s admin-grid Products layout
  (`.admin-products-grid`/`.admin-product-rows`/`.admin-product-row` card
  grid, one card per product with repeated Default/Current/Type labels) is
  superseded/rejected.** Restored the pre-`b8eb5ce` compact table renderer
  from parent `382e2d3` in `Admin.renderTables()` (`js/admin.js`) — one row
  per product across Product/Default price/Current price/Type — and removed
  the now-unused grid CSS plus the `.admin-table{display:table}`/
  `thead{display:none}` override `b8eb5ce` had added on top of it (that
  override was hiding the restored header row). `admin.html`'s existing
  inline `.admin-table` rules (`table-layout:fixed`, explicit 44/16/17/23%
  columns, `box-sizing:border-box` inputs/selects, `.admin-data-card{
  overflow-x:auto}` container) were untouched by `b8eb5ce` and already
  satisfy the responsive-containment requirement; screenshot-verified via
  local Playwright (`.tools/browser-runner`) at 1024/1280/1366/1440/1600/
  1920 — all 4 columns visible, `Type` column right edge inside the
  viewport, no page-level horizontal overflow at any width.

  Also fixed a live production crash in the Payment page: the prior commit
  (`20e12f3`) had deleted the `codPreview`/`advancePreview`/`splitPreview`
  declarations while the template still referenced them, and called the
  local `paymentPreview` before its own `const` declaration (TDZ
  `ReferenceError`) — the Payment step was throwing on every render.
  Replaced with a single module-level `paymentPreview(method, subtotal)` in
  `js/app.js` (mirrors `apps-script/Code.gs`'s `computeOrderTotals` order:
  subtotal → method-specific delivery fee → order total → payNow/codDue,
  split rounds `codDue` to the nearest Rs.100 with `payNow` absorbing the
  remainder) that the payment cards, the selected JazzCash/EasyPaisa/Bank
  channel panel, Order Summary, and the CTA all read from — replacing the
  previous duplicate, delivery-blind `splitAmounts()`/`computeDeliveryFee()`
  path that produced the reported Rs.898/897 (unrounded, pre-delivery) split
  numbers instead of the correct Rs.895/900. Each payment card now shows its
  own Delivery line. Removed the old
  "Split uses the standard delivery fee and isn't eligible for the Advance
  free-delivery benefit" technical note in favour of a live-fee "Delivery
  Rs.X is included in your order total." line.

  Added `tests/payment-preview.test.js`: exact CASE A-D matrix (Advance
  1545→free delivery/1545, Split 1545→250/1795/895/900, Advance
  999→100/1099, COD 999→250/1249) plus client/server equality against
  `apps-script/Code.gs`'s `submitOrder`. Also fixed two pre-existing,
  unrelated `tests/order-submission.test.js` bugs that were silently
  failing `npm test` before this session (a nonexistent `mix-01` product ID
  referenced by the PAY-K test, uncaught and killing the run) — both
  predate this ticket's regression. Full suite (`order-submission`,
  `payment-preview`, `tooling`) passes. End-to-end verified with local
  Playwright against `index.html` (Tomato ×9, Rs.1620 subtotal): Advance
  card/JazzCash panel/Summary/CTA all agree at Rs.1620 free delivery; Split
  card/JazzCash panel/Summary/CTA all agree at delivery Rs.250, order total
  Rs.1870, pay now Rs.970, doorstep Rs.900 — no mismatch anywhere.
  No Chrome DevTools MCP was exposed in this runtime; used the repo's
  existing local Playwright/Chromium install under `.tools/` (no live
  production browser session or authorized admin Google sign-in was
  available, so live production admin mutation/restore and the production
  Cloudflare/Apps Script deploy were not performed — code changes are
  committed to `main` but not yet deployed to `hojaseeds.pk` or the Apps
  Script production endpoint).
