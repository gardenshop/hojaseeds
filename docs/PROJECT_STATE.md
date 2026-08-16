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
| Commercial rules engine | this session | `computeDeliveryFee()`, product `type` system (regular/premium/standard-collection/customized-collection), and the customized-order COD-block logic in `js/app.js`. |
| Visual design tokens | this session | Colour palette, type system (Fraunces/Inter/IBM Plex Mono), and component styles in `css/styles.css` `:root`. |
| Data schema | this session | `Products`/`Orders`/`Contact`/`Settings` Sheet tabs and their column order (`apps-script/Code.gs`). Changing this breaks existing Sheet setups. |
| Authoritative order submission | 2026-08-15 | Server current pricing/delivery calculation, customized advance enforcement, server order IDs, locked idempotency, readable success/failure JSON, cart clear only after confirmed success, and purchase analytics only after confirmed success. |
| Admin authorization | 2026-08-15 | Google Identity Services assertion in memory, independent Apps Script token verification, server-side approved email allowlist, and fail-closed mutation errors. |
| Sheet automation foundation | 2026-08-15 | Versioned additive schema, deterministic dry-run migration, target verification, ignored credentials, and guarded clasp remote actions. |

## Active
*The one thing currently in progress. Keep this to a single item — if a
new request isn't this, either finish/freeze this first or explicitly
replace it.*

- Nothing in progress right now. Last completed: server-authoritative,
  idempotent, reliable order submission.

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

- Production readiness: **97%** (up from 96%)
- Remaining: **3%**
- Expanded operations scope readiness: **90%**. The responsive admin shell,
  authenticated bounded reads, derived dashboard/customers views, delivery/
  analytics status panels, and additive AuditLog foundation are implemented.
- Expanded scope readiness remains **90%**: full product CRUD, order status
  mutations, customer status actions, trusted IP relay, and browser-authorized
  admin mutation/restore are not claimed complete.
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
