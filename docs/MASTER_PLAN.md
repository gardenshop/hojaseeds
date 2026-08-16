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

## Launch Acceptance Gates

- [ ] Google OAuth client ID configured for the approved admin origin.
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
- [ ] Authorized price/settings mutations are accepted and audited — blocked
      on a real Google sign-in as `gisupp@gmail.com`; no browser-automation
      or computer-use tool was available to complete interactive OAuth.
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
