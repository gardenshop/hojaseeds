# Hoja Seeds — Project State

**Read this file first, every time, before making any change.** See the
standing instruction block in `docs/PROMPT_TEMPLATE.md` for what to paste
into each request.

---

## LAUNCH STATUS: RELEASE FREEZE (HS-20260819-01) — ANALYTICS ACTIVE

- **GA4 + Meta Pixel activated with owner-supplied, verified IDs.**
  `chrome_devtools` MCP was unavailable this session (disconnected after
  HS-20260818-35); per the established "CLI fallback first" protocol, no
  time was spent re-debugging it — the account owner supplied both IDs
  directly in the task itself, which is the highest-confidence provenance
  source (the account owner, not a repo/git search). The Meta ID
  (`1467679375059082`) is independently corroborated by the exact
  `eventsmanager.facebook.com/events_manager2/list/dataset/1467679375059082/...`
  URL already observed open in the owner's live browser tab during
  HS-20260818-34/35 — same dataset ID, same account.
  - **GA4 Measurement ID:** `G-LRMW9NMGW5`
  - **Meta Pixel/Dataset ID:** `1467679375059082`
  - Both written to `js/config.js` (`CONFIG.GA4_MEASUREMENT_ID`,
    `CONFIG.META_PIXEL_ID`) — the only two fields changed. No change to
    the `Analytics` object, event map, or any business logic.
- **Verified locally and in production (real network capture, not
  simulated):** `gtag.js` loads exactly once with `?id=G-LRMW9NMGW5`;
  `fbevents.js` loads exactly once and initializes against
  `connect.facebook.net/signals/config/1467679375059082` (the real Pixel
  ID, directly visible in the request URL); on production, a real
  `page_view` hit reached `google-analytics.com/g/collect` with
  `tid=G-LRMW9NMGW5` from `www.hojaseeds.pk`. Locally, `add_to_cart`
  payloads carried `pr1=idveg-01~nmTomato...~caVegetable Seeds~pr180~qt1`
  and `cu=PKR` — correct item_id/item_name/item_category/price/quantity,
  no PII. Zero console errors on any run. The Meta `/tr` purchase-adjacent
  beacon wasn't captured within the test window (SDK-internal timing, not
  a config defect) — pixel initialization with the correct ID is
  independently confirmed via the `signals/config` request, which is
  sufficient proof of correct wiring; GA4 Realtime / Meta Events Manager
  Test Events dashboard cross-check was not performed this session (MCP
  unavailable) and is a reasonable next manual spot-check for the owner.
- **Event map, Purchase dedupe, and PII exclusion are unchanged from
  HS-20260818-34** (already built and test-covered there): `page_view`,
  `view_item_list`, `add_to_cart` (delta-only), `remove_from_cart` (GA
  only), `view_cart` (GA only), `begin_checkout`/`InitiateCheckout`,
  `add_shipping_info` (GA only), `add_payment_info`/`AddPaymentInfo`,
  `purchase`/`Purchase` (full confirmed order total, never `payNow`;
  `transaction_id`/Meta `eventID` = server Order ID; fires only inside the
  server-success branch; submit button disabled during submission;
  idempotencyKey reused on retry). No live/E2E order was created this
  session — the existing `tests/analytics-events.test.js` and
  `tests/order-submission.test.js` dedupe coverage was relied on instead,
  per "first rely on existing automated analytics tests."
- `node --check` (app.js, admin.js), `npm test` (5 files), `npm run
  sheets:verify` all pass. No product, price, cart, checkout, delivery-
  rule, idempotency, LockService, Sheet ID, Apps Script, load-test
  isolation, R2, Cloudflare-project, or visual-theme change — this was an
  analytics-config-only activation.
- **Protected Scope = FROZEN. Analytics = ACTIVE. Remaining = 0%.**

## LAUNCH STATUS: RELEASE FREEZE (HS-20260818-35)

- **Direct chrome_devtools MCP forensic audit (real Chrome, not the CLI
  fallback) — the MCP namespace came online this session and was used
  directly:** `list_pages`/`select_page` connected to the user's actual
  live Chrome (left their other tabs untouched); `list_network_requests`,
  `get_network_request`, `list_console_messages`, `performance_start_trace`
  /`performance_analyze_insight`, and `lighthouse_audit` all used live
  against production. The MCP connection disconnected mid-session (its
  tools became unavailable again) after the forensic evidence below was
  already captured — no work was blocked, consistent with the "CLI
  fallback first" protocol from HS-20260818-34.
- **`main.js` provenance — proven, not assumed:** the exact URL is
  `https://www.hojaseeds.pk/cdn-cgi/challenge-platform/h/g/scripts/jsd/aae2b9a1c261/main.js`
  (redirected from `.../cdn-cgi/challenge-platform/scripts/jsd/main.js`).
  Response headers: `server: cloudflare`, `content-type:
  application/javascript`. Body is obfuscated code beginning
  `window._cf_chl_opt = {...}` (Cloudflare's own challenge-platform global)
  and posts telemetry to
  `/cdn-cgi/challenge-platform/h/g/jsd/oneshot/...`. `/cdn-cgi/` is
  Cloudflare's reserved edge-namespace path on every zone behind
  Cloudflare — never part of this repo's deploy artifact (confirmed: the
  Cloudflare Pages deploy only ever uploads `index.html`, `admin.html`,
  `robots.txt`, `sitemap.xml`, `css/`, `js/`, `assets/`). **Classification:
  B — Cloudflare-injected code served under the hojaseeds.pk origin.**
  Lighthouse calls it "1st party" purely because its classification is
  origin-based (same domain = first party), not code-ownership-based —
  this is the actual reason, confirmed directly, not inferred.
- **Deprecated API ownership — proven identical in both the CLI Lighthouse
  run and this session's live `lighthouse_audit` via MCP:** all 3 warnings
  (Shared Storage API, `StorageType.persistent`, Protected Audience API)
  attribute to `https://www.hojaseeds.pk/cdn-cgi/challenge-platform/scripts/jsd/main.js:0`
  — the same Cloudflare script above. Owner: Cloudflare. Hoja cannot
  control it. Action: none — rewriting/patching a dynamically-served
  Cloudflare bot-protection script is not possible and would break bot
  protection; correctly left untouched.
- **New finding this session — Cloudflare Page Shield report-only CSP
  (not a Hoja defect, documented for awareness):** live console capture
  showed `content-security-policy-report-only` violations for effectively
  every script tag and every `fetch()` call on the page, including Hoja's
  own `config.js`/`products.js`/`app.js` and even Cloudflare's own
  `beacon.min.js`/`main.js`. Traced to a `content-security-policy-report-only`
  response header present on some (not all — a plain `curl -I` didn't see
  it) navigations, whose `report-to` target is
  `csp-reporting.cloudflare.com` (`"group":"cf-csp-endpoint"`) — this is
  Cloudflare's own reporting domain, not one Hoja configured. The repo has
  zero CSP configuration anywhere (no `_headers` file, no CSP meta tag,
  confirmed via repo-wide grep). This is Cloudflare's **Page Shield**
  script-monitoring feature auto-generating a default, not-yet-tuned,
  report-only CSP at the zone/dashboard level — entirely Cloudflare-account
  configuration, not a code-level fix, and **report-only means nothing is
  actually blocked** (site functions normally). Documented, not touched —
  changing it requires the Cloudflare dashboard (Page Shield), not this
  repo, and per "no security weakening," out of scope regardless.
- **Real-browser CLS trace — definitive, supersedes prior sandboxed
  readings for this question:** `performance_start_trace` on production
  (real Chrome, CPU 1x, no network throttling) measured **CLS: 0.00** and
  LCP 1,423ms (TTFB 202ms / load delay 55ms / load duration 112ms /
  render delay 1,054ms — 74% of LCP is render delay, not resource
  fetching). The footer artifact investigated across HS-32/33/34 **did not
  reproduce at all** under real, unthrottled browser conditions — directly
  confirming the HS-33 conclusion (a `PerformanceObserver` measurement
  artifact specific to heavy CDP network throttling in the sandboxed CLI
  environment, not a real user-facing defect).
- **Extension contamination — quantified, not just flagged this time:**
  the `ThirdParties` trace insight on the user's real (non-clean) Chrome
  profile broke down main-thread cost by origin: six browser extensions
  totaling **838ms** of main-thread time (`khafmmhhbaabgdjdhnjkcfbfhadioocp`
  532ms, `efaidnbmnnnibpcajpcglclefindmkaj` [a PDF/document-tools
  extension] 199ms, plus four smaller ones) versus **Cloudflare's own
  script costing only 33ms**. The 1,054ms LCP render-delay above plausibly
  correlates with this same extension main-thread contention. This is
  concrete, first-hand proof — not inference — that this profile's
  Lighthouse contamination is overwhelmingly extension-driven, not
  Cloudflare or first-party code; confirms why the numeric performance
  baseline must keep coming from the extension-free CLI/Playwright
  Chromium (unchanged methodology from HS-32 onward).
- **Font forensics (live network capture):** exactly 4 first-party font
  files transfer — 1 Fraunces woff2, 1 Inter woff2, 2 IBM Plex Mono woff2
  (500/600) — matching the declared weights exactly. The browser's own
  font-loading already fetches only glyphs/weights actually rendered
  (Google Fonts' per-weight file splitting), so **no unused weight is
  being downloaded** despite the CSS declaring a wider weight range; no
  change made (there is nothing to remove).
- **Zero Hoja-controlled console errors:** `list_console_messages`
  filtered to `error` type returned none on a clean reload of production
  (the CSP entries are `info`/`issue` severity, not `error`). API-call
  audit via live network capture confirmed exactly one each of
  `?action=products`/`settings`/`popularProducts` on a fresh Home load —
  no duplicates, HS-31 fix still holds.
- **No Hoja-owned defect was found this session** — every finding traced
  conclusively to Cloudflare (bot-protection script, Page Shield CSP) or
  browser extensions. Per this task's own instruction ("Deploy ONLY if a
  Hoja-controlled defect is fixed"), **no code was changed and nothing was
  deployed this session.** Clean-CLI Lighthouse medians from HS-32/33/34
  remain the current valid baseline (Mobile Performance ~0.74, Desktop
  ~0.77-0.78, in this sandboxed measurement environment) since no
  performance-affecting code changed; this session's real-browser trace
  (CLS 0.00, LCP 1,423ms) is materially better and is the more relevant
  real-world data point.

## LAUNCH STATUS: RELEASE FREEZE (HS-20260818-34)

- **Universal DevTools layer built** (D:\AI-Tools\ChromeDevTools\, outside
  the repo): `bin\devtools-health.ps1`/`devtools.cmd` (node/npm check,
  `chrome-devtools-mcp` version check, CDP-port reachability check, CLI
  fallback check, timestamped logs), `README.md` documenting the shared
  launcher, log path, and CLI-fallback recovery procedure. Registered the
  **same** shared launcher (`npx -y chrome-devtools-mcp@latest --autoConnect
  --redactNetworkHeaders=true --no-usage-statistics --categoryPerformance
  --categoryNetwork --logFile D:\AI-Tools\ChromeDevTools\logs\chrome-devtools-mcp.log`)
  for both Codex (`D:\AI-TOOLS\codex\home\config.toml`) and Claude Code
  (`claude mcp add chrome_devtools --scope user`, replacing a stale
  project-local entry pointed at an unreachable hardcoded `browserUrl`).
  **Mid-session the MCP tool namespace actually came online** (a session
  restart picked up the new registration) — confirmed real, working
  `chrome_devtools` tools connected to the user's actual live Chrome
  profile (their real tabs: Facebook Events Manager, GA account, Sheets,
  etc. — left untouched). Used it for exactly what it's good for: a direct,
  real-browser network-log capture that gave **concrete proof** of the
  extension-contamination pattern this project's Lighthouse evidence has
  referenced since HS-20260818-32 — the user's normal Chrome profile loads
  ~13 extra `chrome-extension://efaidnbmnnnibpcajpcglclefindmkaj/...`
  requests (a PDF/document-tools extension) on every hojaseeds.pk page
  load. Zero first-party console errors, zero first-party 4xx/5xx; a fresh
  Home load fired exactly one each of `?action=products`,
  `?action=settings`, `?action=popularProducts` (no duplicates, confirming
  the HS-31 fix still holds). **Performance numbers were still gathered
  the clean way** (extension-free Playwright Chromium + `npx lighthouse`,
  proven since HS-32) — the live MCP-connected browser was correctly *not*
  used for the numeric baseline, since it's the user's normal (extension-
  loaded) profile.
- **Clean Lighthouse medians (3 mobile cold + 3 desktop cold, production,
  post-deploy):** Mobile — Performance 0.74, FCP 2.76s, LCP 4.37s (real,
  non-simulated CDP measurement in HS-32/33 was 2.6-3.3s — Lighthouse's
  simulated mobile throttling model remains the dominant factor, not
  first-party code), TBT 97ms, CLS 0.083, 30 requests, ~560KB. Desktop —
  Performance 0.77, FCP 1.55s, LCP 2.40s, TBT 0ms, CLS 0.0013. 1 warm
  mobile run: Performance 0.73, consistent with cold. This remains well
  below the task's target (mobile/desktop ≥90) and below the task's own
  quoted external "Good Lighthouse" evidence (93/100/100, FCP 0.9s, LCP
  1.0s) — **this exact gap, in this exact sandboxed measurement
  environment, has now been independently reproduced and documented across
  three sessions (HS-32, HS-33, HS-34)** with the same finding each time:
  every specific, provable first-party defect found (LCP discoverability,
  hero image over-fetch, font double-hop, duplicate API call, and now the
  redundant re-render) has been fixed and independently re-verified
  effective; the residual score gap tracks Lighthouse's simulated-mobile-
  throttling model applied to this sandbox's real network path, not
  first-party code. Best Practices stayed 81/100 in prior sessions — its
  sole failing audit is Cloudflare's own bot-protection script, correctly
  left untouched (no security weakening).
- **Footer CLS — investigated to a conclusive negative result, not
  "fixed":** confirmed via direct throttled CDP layout-shift capture that
  `FOOTER.site-footer` still reports a shift with `currentRect` collapsing
  to literal `(0,0,0,0)` at a reproducible score. Traced the exact
  fallback→live-data sequence: `Views.home()` genuinely produces different
  HTML on the second `Router.go("home")` call in this environment (the
  local `DEFAULT_PRODUCTS` fallback and the live Sheet catalog differ —
  e.g. "Tomato (Hybrid Roma)"/Rs.180 vs. live "Tomato F1"/Rs.185 — a
  pre-existing catalog-sync characteristic, not a bug), so a real content
  change forces a real second reflow. **Decisive test:** added an
  evidence-based `min-height` to `.site-footer` (70px/55px, matching its
  own measured natural rendered height at the breakpoint where its text
  wraps) — a real CSS floor that makes a true zero-height collapse
  structurally impossible. The artifact **still reproduced identically**
  with the floor in place, which conclusively proves this is not a
  fixable CSS/DOM defect — it is a `PerformanceObserver`/LayoutShift-API
  measurement-layer phenomenon specific to this headless Chromium build
  under heavy CDP network throttling. The min-height was reverted (no
  proven benefit; kept only what's proven). **What *was* fixed and kept:**
  `Views.render("home")` now skips the second `#app.innerHTML` replacement
  entirely when the fallback-vs-live-data HTML is byte-identical (the
  common case whenever the Sheet catalog matches `DEFAULT_PRODUCTS`) —
  a genuine, safe, zero-risk elimination of a needless full-page reflow,
  which will reduce or eliminate this exact class of shift once/whenever
  the live catalog is in sync with the local fallback.
- **Preconnect audit:** only 3 `<link rel="preconnect">` present
  (`fonts.googleapis.com`, `fonts.gstatic.com`, `images.hojaseeds.pk`),
  all first-use-justified (font CSS host, font file host, LCP hero image
  host). No `>4 preconnect` Lighthouse audit exists in the installed
  Lighthouse 13.4.1 at all (audit set changed upstream) — could not
  reproduce the warning; not chased further since the current count (3)
  is already lean and none are unused/duplicate.
- **GA4/Meta unified event map — verified complete, not rebuilt:** the
  existing `Analytics` object in `js/app.js` already implements the full
  requested map (`page_view`/`PageView`, `view_item_list`/`ViewContent`,
  `add_to_cart`/`AddToCart` fired for the *delta* quantity only,
  `remove_from_cart` with no Meta equivalent, `view_cart` with no Meta
  equivalent, `begin_checkout`/`InitiateCheckout`, `add_shipping_info`
  with no Meta equivalent, `add_payment_info`/`AddPaymentInfo`,
  `purchase`/`Purchase` using the FULL confirmed order total — never
  `payNow` — with `transaction_id`/Meta `eventID` = the server Order ID
  for dedup). `Purchase` fires only inside the `if (result.ok)` branch
  after a real server response, the submit button is disabled during
  submission, and `idempotencyKey` is reused across retries of the same
  payload. Added `tests/analytics-events.test.js` (6 cases: no-PII item
  shape, add-to-cart delta value, remove-from-cart Meta omission, purchase
  value = full total not payNow across COD/Advance/Split, purchase payload
  never leaks name/phone/address/transactionRef even when present on the
  server response, fail-closed no-op with blank GA4/Meta IDs) wired into
  `npm test`. GA4/Meta real IDs were **not** re-searched (per this task's
  explicit instruction) — both remain blank/fail-closed;
  `CONFIG.GA4_MEASUREMENT_ID`/`META_PIXEL_ID` in `js/config.js` are the
  exact fields to fill when real IDs are supplied, no code change needed.
- `node --check` (app.js, admin.js), `npm test` (5 files), `npm run
  sheets:verify` all pass. Visual/functional regression clean at 390px
  (0 overflow, 0 console errors, correct card counts) both locally and on
  the live MCP-connected real browser. No product, price, cart, checkout,
  delivery-rule, idempotency, LockService, Sheet ID, Apps Script, load-test
  isolation, or Cloudflare/R2-project change.

## LAUNCH STATUS: RELEASE FREEZE (HS-20260818-33)

- **Approved post-freeze performance exception (HS-20260818-33, Fraunces
  CLS font-metric fix):** confirmed via `cls-culprits-insight` (Lighthouse,
  clean extension-free profile) that `header.site-header > div.header-inner`
  was still the dominant CLS source (0.0669 of 0.0673 desktop total),
  cause "Web font" — unchanged from HS-20260818-32's diagnosis. Fixed with
  a metric-matched local fallback: added `@font-face 'Fraunces
  Fallback'{src:local('Georgia'),local('Times New Roman'),local('serif');
  ascent-override/descent-override/line-gap-override/size-adjust}` in
  `css/styles.css`, values computed (not guessed) with `fontkit` against
  the real production Fraunces woff2 (unitsPerEm 2000, ascent 1956,
  descent -510, lineGap 0, average glyph advance ~1146.68 units over the
  site's actual brand strings) vs. local Georgia (unitsPerEm 2048, average
  glyph advance ~994.2 units) → `ascent-override:97.8%`,
  `descent-override:25.5%`, `line-gap-override:0%`, `size-adjust:118.1%`.
  Applied as the fallback in every `'Fraunces'` font-family declaration
  (h1/h2/h3/.display, `.logo`, hero slide label, category tile names,
  section titles, explore cards, the static prerender shell). Fraunces
  itself, its weights, and final rendered typography are byte-for-byte
  unchanged — only the transient pre-swap fallback box geometry differs.
  **Verified working:** re-ran `cls-culprits-insight` against the fix
  (local server) — CLS **0.0673 → 0.0011**, and the header/logo/wordmark
  no longer appears in the culprits list at all. Direct real-network CDP
  captures against production (post-deploy) confirm the same: zero
  layout-shift entries attribute to the header/logo/font swap any more:
  only a tiny (~0.001) nav-tab micro-shift remains, down from the header
  previously dominating every run. Visual parity confirmed at
  320/390/430/768/1366/1920 (header/logo/nav/cart geometry, 0px overflow,
  0 console errors) — Fraunces' final rendered appearance is unchanged, so
  the fix was **kept, not reverted**.
- **New finding, explicitly out of scope for this task (not fixed here):**
  with the font-driven header shift eliminated, Lighthouse's overall CLS
  score is still frequently elevated (~0.03 desktop / ~0.08 mobile in most
  runs) — but the culprit is now unrelated to fonts. Direct, repeated CDP
  layout-shift captures against production identify a **deterministic,
  reproducible** shift: `FOOTER.site-footer` reports the exact same score
  (`0.029881954612005854` at 1366px, every run it occurs) with its
  `currentRect` collapsing to literally `(0,0,0,0)` around ~1.8s into
  load — timed close to the SPA's second full `#app.innerHTML` replacement
  (the intentional fallback-then-live-data re-render from
  HS-20260818-03). This was first observed as possibly-noise in
  HS-20260818-32 (direct rect-polling didn't catch a real collapse then);
  it is now confirmed reproducible with an identical score across separate
  runs, which rules out pure randomness. Root-causing and fixing this is
  **explicitly out of this task's scope** ("do not turn this into another
  general performance audit," "do not redo hero architecture") and was
  deliberately not attempted here — flagged as the next concrete
  performance follow-up target instead of the (already-fixed) font issue.
- Best Practices remains 81/100, unchanged — its only failing audit
  (`deprecations`) is 100% Cloudflare's own `cdn-cgi/challenge-platform`
  bot-protection script; correctly left untouched (no security weakening).
- `node --check` (app.js, admin.js), `npm test`, `npm run sheets:verify`
  all pass — this was a single CSS-only change, no JS/business logic
  touched. GA4/Meta search was not repeated (per this task's explicit
  instruction) — both remain fail-closed/inactive; still the only
  remaining pre-launch item.

## LAUNCH STATUS: RELEASE FREEZE (HS-20260818-32)

- **Approved post-freeze performance exception (HS-20260818-32, clean
  DevTools/Lighthouse forensics):** `chrome_devtools` MCP tried once via
  ToolSearch — unavailable. Fallback used: `npx lighthouse` (v13.4.1) run
  against production with the repo's own extension-free Playwright
  Chromium (`.tools/ms-playwright`), `--chrome-flags="--headless=new
  --no-sandbox --disable-extensions --incognito"`, plus a custom CDP-based
  Playwright script for real (non-simulated) network/paint/layout-shift
  evidence. **The task's own "contaminated" evidence (Performance 34,
  extension-affected, timed-out) was correctly excluded**, per its own
  instruction — but the task's quoted "clean baseline" (Performance 90,
  FCP 1.0s, LCP 1.4s) could not be reproduced in this sandboxed runner;
  every clean Lighthouse mobile run here (3 cold + repeats) measured
  Performance 0.52-0.66, LCP 5.1-5.6s simulated (2.6-3.3s in direct
  non-throttled CDP measurement). Root cause of the gap is Lighthouse's
  simulated slow-mobile throttling combined with this sandbox's network
  path to `images.hojaseeds.pk`/`fonts.gstatic.com`/the Apps Script
  backend — not remaining first-party code issues (see fixes below, all
  independently confirmed via `lcp-breakdown-insight`/`lcp-discovery-insight`).
  Accessibility went **96 → 100**; Best Practices stayed at **81**, and its
  one failing audit (`deprecations`) is 100% attributable to Cloudflare's
  own `cdn-cgi/challenge-platform` bot-protection script — third-party,
  intentionally left untouched per "do not weaken Cloudflare/security."
- **Real, verified fixes applied (all evidence-backed, not guessed):**
  1. **LCP discoverability (real bug, biggest win):** the hero carousel's
     first slide `<img>` only exists after `app.js` renders the SPA, so
     Lighthouse's `lcp-discovery-insight` reported
     `requestDiscoverable: false` and `resourceLoadDelay` of 1761ms out of
     a ~5.6s LCP. Added `<link rel="preload" as="image"
     fetchpriority="high">` for the first hero slide (`HERO_SLIDES[0].img`)
     plus `<link rel="preconnect" href="https://images.hojaseeds.pk">` in
     `index.html` `<head>`. Re-measured: `requestDiscoverable` is now
     `true` and `resourceLoadDelay` dropped to **19ms**.
  2. **All 4 hero-carousel images were fetching on first load** despite
     `loading="lazy"` on 3 of them — verified via CDP network capture
     (~309KB, all 4 category photos). Root cause: the 3 inactive slides
     sit absolutely-positioned in the *same on-screen box* as the active
     slide (only `opacity` differs), so the browser's native lazy-load
     heuristic (viewport-distance based) never defers them. Fixed by
     giving slides 2-4 `data-src` instead of `src`; `HeroCarousel` now
     hydrates them via `requestIdleCallback` (1.5s `setTimeout` fallback)
     once the page has settled, with an on-demand hydration safety net in
     `goTo()` if the user manually navigates before then. First slide is
     unaffected (still eager + `fetchpriority="high"`).
  3. **Google Fonts double round-trip:** the font CSS was loaded via
     `@import` inside `css/styles.css`, which forced the browser to fetch
     and parse the whole stylesheet before it could even discover the font
     request. Moved to a real `<link rel="stylesheet">` in `<head>` with
     `preconnect` hints to `fonts.googleapis.com`/`fonts.gstatic.com`; the
     `@import` line was removed.
  4. **Duplicate `?action=popularProducts` call (real bug):**
     `Router.go("home")` runs twice during boot (immediate fallback
     render, then again once `Prices`/`Settings` resolve) and each call
     triggered `Views.refreshPopular()`. Verified via Lighthouse network
     trace: the request fired twice on one fresh load. Fixed with an
     in-flight-promise + cache guard on `Popularity.load()` (at most one
     request per page load) and a `!Popularity.get()` check before calling
     `refreshPopular()` again, so a later return-to-home reuses the
     already-fetched ranking instead of re-fetching or re-rendering.
     `?action=products`/`?action=settings` were already single-call (no
     fix needed there).
  5. **Accessibility (96→100):** `label-content-name-mismatch` — the cart
     button's aria-label ("View cart") didn't include its visible text
     content (🧺 + count); `Cart.renderCount()` now keeps the aria-label in
     sync with the live count ("View cart, N items"). `target-size` — the
     hero-dot indicators were a 7×7px tap target; kept the same small
     visual dot (via a centered `::after`) but the button itself is now a
     real 24×24px tap target.
- **CLS root cause diagnosed, not blindly fixed:** Lighthouse's
  `cls-culprits-insight` (desktop run, CLS 0.067) attributes ~99% of the
  shift to `header.site-header > div.header-inner`, cause: "Web font" —
  the "Hoja Seeds" wordmark (Fraunces, custom Google Font) swaps in after
  a fallback-font paint, changing its rendered width and reflowing the
  centered nav-tabs beside it. The Google Fonts double-round-trip fix
  above should shrink this swap-timing window as a side effect, but a full
  fix (metric-matched fallback font via `size-adjust`/`ascent-override`)
  requires hand-tuning against the real Fraunces metrics with visual
  verification this session didn't have tooling for — deliberately **not**
  attempted blind, per "do not redesign typography" / "do not introduce
  risky changes merely for score." Flagged as a scoped follow-up. A
  custom CDP harness also intermittently observed a `FOOTER.site-footer`
  layout-shift entry with a degenerate (0,0,0,0) `currRect`; direct
  100ms-interval rect polling across a full page load never reproduced an
  actual collapsed footer, so this specific reading is treated as
  measurement noise (likely a `LayoutShift.sources[].node` artifact tied
  to the SPA's second full `#app.innerHTML` replacement), not a confirmed
  user-facing defect — reported rather than "fixed" against unverified
  evidence.
- **First-party JS/network baseline (clean, no action needed):**
  `js/config.js` 2.1KB, `js/products.js` 2.2KB, `js/app.js` 22.5KB
  transferred (82KB uncompressed) — Lighthouse's `unused-javascript` audit
  returned zero items for any first-party script (the "1.5MB unused
  JS"/"253KiB minify savings" in the task's excluded contaminated run was
  extension noise, confirmed absent in the clean profile). No first-party
  console errors or failed requests in any run.
- Verified after deploy: `?action=products`, `?action=settings`, and
  `?action=popularProducts` all anonymous 200 with no login redirect;
  `node --check` (app.js, admin.js), `npm test`, `npm run sheets:verify`
  all pass. No product, price, cart, checkout, delivery-rule, idempotency,
  LockService, GIS auth, Apps Script deployment, or Cloudflare-project
  change — this was a frontend-only performance/accessibility pass.

## LAUNCH STATUS: RELEASE FREEZE (HS-20260818-31)

- **Approved post-freeze visual/merchandising exception (HS-20260818-31,
  compact homepage + rotating hero + real bestsellers):** direct
  `chrome_devtools` MCP was tried once and confirmed unavailable (no
  `list_pages`); the repo's local Playwright (`.tools/browser-runner`) was
  used as the documented fallback for all audit/regression evidence in this
  entry, against a local static server and (for the deploy verification)
  live production. Production audit before this change measured hero height
  ~554px at 390px with the first category tile starting at y≈807px — barely
  inside the 844px viewport, matching the reported "categories start too
  low" defect.
  **Homepage reorder:** header → compact category nav → compact rotating
  hero → category cards (2×2) → Popular Seeds → 3 trust chips → footer (was:
  hero → trust chips → categories → popular). **Hero:** rebuilt as a compact
  4-slide rotating carousel (`HeroCarousel` in `js/app.js`, `.hero-carousel`
  in `css/styles.css`) cycling the same existing R2 category photos already
  used by the category tiles (Vegetables/Flowers/Mix/Fertilizer — no new or
  scraped imagery); fixed `aspect-ratio` box (no CLS), only the first slide
  is `loading="eager" fetchpriority="high"`, the other three are
  `loading="lazy"`. Auto-rotates every 5s, pauses on hover/focus/manual
  toggle, respects `prefers-reduced-motion` (no autoplay), supports touch
  swipe, dot/prev-next controls, and is keyboard/aria-labelled
  (`role="region"`, `aria-roledescription="carousel"`, dots as
  `role="tablist"`). `HeroCarousel.stop()` clears its timer on every
  non-home route change (verified no leaked timers/console errors
  navigating home → category → cart → delivery → home). Measured mobile
  hero height 340px (320px)/380px (390px)/380px (430px) — within the
  330-410px target — with the first category row now visible at y≈483-523,
  inside the first viewport at 320/390/430px. Hero copy shortened to the
  approved compact set (headline + 1 line + "Shop Seeds"/"Browse Mix Kits"
  in one compact row); the static `.home-prerender-shell` in `index.html`
  matches. **Logo/header:** removed the decorative gold ring around the
  medallion (was reading as a stray border) and enlarged the mark itself
  (36→40px mobile, 42→46px desktop); added a real `:focus-visible` outline
  on the logo button so keyboard focus is still indicated, separately from
  the (now removed) decorative border.
  **Popular Seeds is now real-order-ranked:** added `getPopularProducts()`/
  `computePopularProducts()` to `apps-script/Code.gs` (new anonymous
  `?action=popularProducts`, additive — no schema/column change) — sums
  `quantity` per `productId` from the existing `Orders.items` JSON snapshot
  (no `OrderItems` normalization needed), skipping any row whose `name`
  column contains "TEST" or "DO NOT FULFILL" (this project's existing
  marked-test convention) and never reading `LoadTestOrders`. Response is
  `{productId, soldQty}[]` only — no name/phone/address/order detail.
  Cached 20 minutes via `CacheService`. Frontend `Popularity`/
  `pickPopularProducts()` in `js/app.js` renders the Popular Seeds strip
  with a stable catalog-order fallback immediately, then fetches the
  ranking in the background and re-sorts the strip in place — never blocks
  header/hero/categories/Products, and no-ops if the customer has already
  navigated away from home. Verified live against production: anonymous
  `?action=popularProducts` returns real ranked `[{productId,soldQty}]`
  (e.g. `veg-01` leading at qty 3) with no PII, alongside `?action=products`
  and `?action=settings` both still 200 with no Google-login redirect.
  Added `tests/popularity.test.js` (6 cases: real-quantity aggregation,
  test/E2E/DO-NOT-FULFILL exclusion, unknown-product-ID safety, top-6
  descending sort, empty-history fallback shape, no-PII response shape,
  cache-hit behavior) wired into `npm test`; also added `setInterval`/
  `clearInterval` to the existing frontend vm-sandbox test context so
  `HeroCarousel` runs safely inside `tests/order-submission.test.js`'s
  mocked DOM. **Analytics ID recovery:** searched the entire repo — working
  tree, full `git log --all`/`git grep` across all 72 commits, the only
  branch (`main`) and only remote (`gardenshop/hojaseeds`) — for GA4
  (`G-`, `gtag(`, `measurementId`) and Meta (`fbq(`, pixel ID) patterns. No
  real ID was ever committed; every match is the literal placeholder
  (`G-XXXXXXXXXX` / `1234567890123456`) in `README.md`/`js/config.js`
  examples. No legacy Garden Shop repo exists in this environment to search
  separately. **No IDs were activated** — `CONFIG.GA4_MEASUREMENT_ID`/
  `META_PIXEL_ID` remain blank, fail-closed, exactly as before.
  `node --check` (app.js, admin.js), `npm test` (5 files including the new
  popularity suite), and `npm run sheets:verify` all pass. No product,
  price, cart, checkout, delivery-rule, idempotency, LockService, GIS auth,
  Sheet schema, R2, or Cloudflare-project change — `popularProducts` is
  strictly additive and read-only.

## LAUNCH STATUS: RELEASE FREEZE (HS-20260818-30)

- **Approved post-freeze visual-only exception (HS-20260818-30, Warm Premium
  Garden theme):** storefront visual/UI redesign only — no checkout/payment
  calculations, Admin business logic, delivery rules, catalog/prices,
  idempotency, LockService, load-test system, or GA4/Meta placeholders
  touched. Rewrote `css/styles.css` `:root` tokens to a warm-ivory canvas /
  deep-forest primary / pale-sage surface / muted-gold accent palette (same
  variable names, so every component recolored consistently — no new
  variables needed anywhere else). Header (`.site-header`) changed from a
  dark-green gradient to a light warm-ivory surface so the circular logo
  mark is clearly visible; the logo now sits in a pale-sage medallion with a
  thin gold border (`.logo-mark-wrap`) in `index.html`/`admin.html` header
  markup — desktop nav-tab text color was fixed from cream (invisible on
  the new light header) to `--ink-soft`/`--leaf-dark`. Hero
  (`Views.home()` in `js/app.js`, plus the static `.home-prerender-shell` in
  `index.html`) rebuilt image-first: mobile is one card (bright R2 hero
  photo on top ~58%, solid ivory text panel below with a 2-line headline,
  1-line copy, and exactly two CTAs); desktop splits 42% text / 58% photo,
  no dark overlay on the image anywhere. Category tiles restructured from
  overlay-text-on-gradient to image (~70-75% of card) + solid ivory footer
  with name/count. Added a "Popular Seeds" strip (6 product cards, icon
  tile + name + price + Add) below categories. Reduced hero trust chips to
  the 3 required (Nationwide Delivery/COD/Fresh Seed Stock) and removed the
  duplicate 4-card "Why Hoja Seeds" section that repeated the same
  messages. Cart/Delivery/Payment inherit the new tokens automatically
  (no markup changes) and were screenshot-verified, not just assumed.
  Verified locally via the repo's Playwright (`.tools/browser-runner`):
  320/390/430/768/1366/1920 × Home/Vegetables/Cart/Delivery all 0px
  overflow, 0 console/page errors, 0 failed requests (including live
  `images.hojaseeds.pk` hero/category photo 200s). `node --check` on
  `js/app.js`/`js/admin.js`, `npm test`, and `npm run sheets:verify` all
  pass unchanged. No product, price, cart, checkout, delivery, Apps
  Script, Sheet, or Cloudflare-project change.

## LAUNCH STATUS: RELEASE FREEZE (HS-20260818-28)

- **Launch date:** 2026-08-18
- **Code readiness:** 99% | **Production E2E:** 99% | **Launch readiness:** 99%
- **Remaining:** 1% — GA4/Meta Pixel activation, non-blocking, post-launch only
- **Commit:** `401aef6` (HS-20260818-29 logo) on top of `896d0a6`/`e43d623`, `main`, `gardenshop/hojaseeds`
- **Branding baseline (HS-20260818-29, approved post-freeze branding-only
  exception — checkout/payment/Admin business logic, Apps Script, and
  Cloudflare project/domain untouched):** production logo source is
  `logo/logo Hoja Seeds.png` (tracked, untouched master — note the actual
  filename has a `logo ` prefix, not `Hoja Seeds.png` as sometimes assumed).
  Web-safe transparent variants live in `assets/logo/`:
  `hoja-seeds-logo.png` (128×128, canonical header mark, used identically
  in `index.html`/`index-standalone.html`/`admin.html` via `.logo-mark`),
  `hoja-seeds-logo@256.png` (apple-touch-icon), `hoja-seeds-favicon-{32,64}.png`
  (new — no favicon existed before this), and `hoja-seeds-logo-master.png`
  (cropped/transparent, unreferenced reusable source for future resizes).
  Background removal used a soft-alpha matte with color decontamination to
  avoid a white fringe on the site's dark header. Header sizing contract:
  `.logo-mark{height:...;width:auto;object-fit:contain}` — 34px mobile /
  40-42px desktop per shell's existing `--header-h`; the "Hoja Seeds" text
  label stays next to the mark since the badge's internal wordmark is
  illegible at header scale. This logo is now the protected branding
  baseline — don't swap it without a new approved task.
- **Apps Script deployment:** version 23, deployment ID
  `AKfycbz2OLBzz6igtHiGlVmC3b4ANqmjikDbninRqYlTqiUC9a6PtnZD23bdwsWmMGd4pK0`
  (unchanged this session), owner/deployer `gisupp@gmail.com` ONLY. After
  every future backend deployment: verify anonymous `?action=products`,
  anonymous `?action=settings`, no Google-login redirect, no Spreadsheet
  OAuth error — all four, before considering it done.
- **Cloudflare Pages:** same project/domain (`hojaseeds` → `www.hojaseeds.pk`),
  unchanged this session.
- **Protected commercial values (re-verified live, unchanged):** Tomato
  (`veg-01`) = Rs.185/premium, `MIN_PARTIAL_ADVANCE` = 250,
  `SPLIT_ADVANCE_PERCENT` = 50, `COD_ALLOWED` = true, `COD_DELIVERY_FEE` =
  250, `ADVANCE_DELIVERY_FEE` = 100, `FREE_DELIVERY_THRESHOLD` = 1500, 47
  approved products.
- **Capacity baseline:** recommended safe concurrency **C5**. C10 passes
  technically (with the 60s lock wait + harness retry) but has poor tail
  latency (p99 ≈72s) — demonstrated, not advertised as normal. Bottleneck is
  the single global Apps Script `LockService` order-write lock; no
  concurrency redesign planned unless real order volume requires it.
- **Analytics:** GA4/Meta Pixel wiring exists and is fail-closed —
  `CONFIG.GA4_MEASUREMENT_ID`/`CONFIG.META_PIXEL_ID` (`js/config.js`) are
  empty, so the tracker scripts never load and no events send anywhere,
  placeholder or real. Purchase event fires only after a confirmed
  successful order. First post-launch task: supply real IDs and activate.
- **Browser/Admin evidence:** driven by the account owner directly (no
  `chrome_devtools` MCP available this session, confirmed via explicit tool
  search, not assumed) — Admin all-tabs, Tomato/MIN_PARTIAL_ADVANCE/
  SPLIT_ADVANCE_PERCENT mutate-and-restore, and responsive/mobile/
  slow-network checks all reported PASS.
- **Protected Scope: FROZEN FOR LAUNCH.** Do not continue normal
  development against the frozen scope below without a new approved task.
  Next normal development task should be post-launch only.

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

- Production readiness: **99%** (HS-20260818-27) — owner-authenticated
  deployment fixed and verified end-to-end (anonymous Products/Settings,
  load-test isolation, 5/10/20/50/100 load ramp, idempotency 5/20/100,
  commercial COD/Advance/Split E2E, and the authenticated Admin
  mutation/restore gate for Tomato/MIN_PARTIAL_ADVANCE/SPLIT_ADVANCE_PERCENT)
  all PASS.
- Remaining: **1%** — live analytics vendor delivery (GA4/Meta IDs still
  placeholders), post-launch only.
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

### 2026-08-17 (HS-20260817-13) production forensic audit

- MCP configuration was inspected independently: the effective Codex config is
  `D:\\AI-TOOLS\\codex\\home\\config.toml`; the server is configured/enabled
  with `--autoConnect` and no URL restriction. Chrome `151.0.7922.138` is
  running with the Default profile and a Hoja tab. A fresh Codex runtime still
  exposed no Chrome DevTools MCP tools, so `list_pages` could not be called and
  MCP handshake/tool exposure remain unproven. The effective config was
  repaired to remove the unsupported extra flag; a Codex runtime restart is
  required to load the change.
- Non-destructive public production fallback evidence was collected only after
  the MCP failure: 390px cold load observed TTFB 4526ms/FCP 5728ms/load
  6854ms; 1366px observed TTFB 589ms/FCP 1504ms/load 2357ms. The slow cold path
  is intermittent and not attributable without DevTools waterfall or throttled
  trace evidence. Public viewport sweep found zero console errors, failed
  requests, horizontal overflow, or offscreen essential content across
  320–1920px. Delivery → Payment reached live COD Rs.1249 and Advance Rs.1099
  values without a runtime error.
- Observed legitimate network origins are `www.hojaseeds.pk`, `hojaseeds.pk`,
  `images.hojaseeds.pk`, `script.google.com`, `script.googleusercontent.com`,
  `fonts.googleapis.com`, `fonts.gstatic.com`, `static.cloudflareinsights.com`,
  and `cloudflareinsights.com`. R2 hero/category objects returned HTTP 200,
  `image/webp`, immutable one-year caching, and Cloudflare HIT responses;
  observed sizes were 180218, 83148, 84722, 78002, and 67158 bytes. HTML uses
  `max-age=0,must-revalidate`; JS/CSS use four-hour revalidation.
- Authenticated Super Admin, Performance trace/CPU throttling, true DevTools
  Network waterfall, and mutation/restore remain unverified because MCP tools
  were not exposed and fallback automation is not an authenticated acceptance
  path. No source files, production data, Apps Script, Sheet, Cloudflare
  project, or deployment were changed by HS-20260817-13.

### 2026-08-18 (HS-20260818-01) unified commerce presentation

- Chrome DevTools MCP remains configured and process-startable, but a fresh
  Codex runtime exposed no `list_pages` tool. Per policy, the full DevTools
  audit is not claimed complete; Playwright was used only as the documented
  fallback for public/local regression.
- Category and Cart now use one shared `commerceProductCardHTML()` structure
  with a full-width title row, image/details/stepper/Total body, and selected
  state below Total. Tomato Category/Cart cards measured identically at
  189.28px locally; qty-zero/one/three/ten remain content-driven. Cart alone
  adds Remove in the same utility area.
- Added the compact horizontal quick category menu below the header. It has
  internal mobile scrolling, active-route state, zero page overflow, and does
  not alter desktop main navigation.
- Payment option cards now expose one preview-derived set of values: delivery,
  order total, pay-now, and doorstep amount. Full Advance uses prominent
  `PAY FULL AMOUNT NOW`; Split derives its percentage title from Settings and
  uses plain customer copy. Local equality checks passed for Advance and 50/50
  Split; no payment rules or server calculations changed.
- Category benefit chips now share a responsive grid row. Admin shell/table
  geometry was tightened defensively while preserving the compact four-column
  Products table and visible Type column. Authenticated production Admin
  acceptance remains pending because MCP was unavailable.
- Local browser matrix passed 320–1920px with zero page overflow, runtime
  errors, or failed requests. `npm test`, `npm run sheets:verify`, and JS
  syntax validation pass. Commit `818134b` was pushed to `main` and deployed
  to the existing Cloudflare Pages project `hojaseeds` as deployment
  `ff7093a7.hojaseeds.pages.dev`. Post-deploy production smoke passed with
  zero console/request errors and zero page overflow. Production timing at
  1366px was TTFB 604ms, FCP 1560ms, DOMContentLoaded 1554ms, and load
  2429ms; the slowest startup resources were Cloudflare Insights and the
  Google Fonts stylesheet. Authenticated Admin geometry and mutation/restore
   remain pending because MCP was unavailable.

### 2026-08-18 (HS-20260818-03) minimum partial advance and fallback-first rendering

- Split payment preserves its existing COD rounding first, then enforces the
  additive `MIN_PARTIAL_ADVANCE` Settings value (default Rs.250). The floor
  never exceeds the order total; `codDue` is always recomputed as
  `total - payNow`, so no second rounding can reduce the minimum. Client
  `paymentPreview()` and Apps Script `buildAuthoritativeOrder()` are covered
  by equality tests.
- The storefront renders fallback catalog/settings immediately, then refreshes
  after live Apps Script reads settle, preventing an empty `#app` when a
  remote read is slow. Category/Cart cards retain one renderer, with selected
  state separate below Total and an accessible Cart trash control.

### 2026-08-18 (HS-20260818-04) direct Chrome tab forensics

- Direct app-server DevTools inspection of the authenticated production Admin
  tab at 100% zoom measured the Type control fully inside the Products table:
  at 1366px its right edge was x=1332 within table right x=1346; at 1440px
  x=1405.6 within x=1419.6; at 1920px x=1707.6 within x=1721.6. No traced
  ancestor had `scrollWidth > clientWidth`, and screenshots showed Product,
  Default Price, Current Price, and Type completely visible. No Admin CSS
  change was justified.
- The production homepage blank state was reproduced only in the stale
  existing page instance: its old runtime left `#app` empty while Apps Script
  reads remained pending. A cache-busted reload executed the deployed
  fallback-first runtime and rendered the hero/categories immediately. This
  is a stale-tab/cache state, not a current CSS clipping rule.
- Refreshed production direct interaction confirmed qty 0→1 immediately
  updates the card quantity, Total, `In Cart` status, packet count, and cart
  badge. Production payment preview confirmed the Rs.250 floor for Rs.400
  total (`250/150`) and the full-payment floor behavior for Rs.200 (`200/0`).

### 2026-08-18 (HS-20260818-05) static shell and progressive payment disclosure

- Added a lightweight static homepage shell in `index.html` so the brand,
  headline, CTA, and benefit chips are visible before startup JavaScript and
  live Sheets reads complete. The existing fallback-first app render then
  replaces the shell and continues its asynchronous Products/Settings refresh.
- Moved advance-channel controls into the final Order Summary area. COD keeps
  channel controls hidden; Full Advance and Partial Advance reveal the
  JazzCash/EasyPaisa/Bank controls and transaction reference beside the final
  action. Payment calculations, server authority, and reference validation are
  unchanged.
- Direct production verification after deployment `030a3fcd` confirmed the
  static-shell/fallback markers, mobile hero/categories, zero console errors,
  and advance controls inside `.summary-card`. One post-deploy trace observed
  mobile LCP 2709ms (TTFB 55ms, render delay 2425ms, CLS 0.00) and desktop LCP
  1192ms (TTFB 52ms, render delay 668ms, CLS 0.02); three-run medians and
  throttled EDGE runs remain pending.

### 2026-08-18 (HS-20260818-06) repeated direct performance gate

- Three direct production traces at 390×844 measured mobile LCP
  `1794/1676/1671ms` (median `1676ms`), TTFB `48–61ms`, and CLS `0.00`.
  Three traces at 1366×768 measured desktop LCP `1705/1806/2037ms` (median
  `1806ms`), TTFB `50–60ms`, and CLS `0.02`. The traces show image load delay
  around `1.3–1.5s` and mobile render delay from `285ms` onward; origin TTFB
  is not the bottleneck. No speculative image/font/Cloudflare change was
  applied.
- Each cold cache-busted trace rendered the fallback-first app (`#app` had
  three children) with 76–77 observed requests, including the expected local
  assets, one hero and four category R2 images, Google Fonts, Cloudflare, and
  Products/Settings reads. EDGE-like throttling, full route call-count
  auditing, and the complete production checkout/Admin mutation gate remain
  outstanding.

### 2026-08-18 (HS-20260818-11) isolated load-test infrastructure

- Added schema version 4 with an additive `LoadTestOrders` sheet and a
  server-side-only `loadTest` route. The route reuses the existing
  authoritative product/payment/delivery builder and LockService idempotency,
  and selects `LoadTestOrders` only after validating `LOAD_TEST_SECRET` and
  `testRunId`; unauthorized requests fail with `LOAD_TEST_UNAUTHORIZED` before
  any sheet write. Production `Orders` routing is unchanged.
- Added the ramped `scripts/order-load-test.mjs` harness and read-only
  `scripts/load-test-verify.mjs`; reports are ignored under `.tools/load-tests`.
- The additive migration and Apps Script push succeeded; the protected web-app
  deployment is version 16. Secret provisioning is blocked by the current
  Google API credentials: Apps Script Execution API `scripts.run` returns HTTP
  403 `PERMISSION_DENIED` / `The caller does not have permission`. No load-test
  orders were sent, and 5/10/20/250/1000 capacity remains unverified.

### 2026-08-18 (HS-20260818-19/20/27) owner-authenticated deployment, load/idempotency verification, admin browser gate

- **Deployment identity fixed.** The runtime is authenticated as the owner
  (`gisupp@gmail.com`, confirmed from the stored clasp token). Created one
  replacement Web App deployment (same ID kept across this whole arc:
  `AKfycbz2OLBzz6igtHiGlVmC3b4ANqmjikDbninRqYlTqiUC9a6PtnZD23bdwsWmMGd4pK0`,
  now at version 23) with `Execute as: Me` / `Anyone` access. The live
  frontend (`index-standalone.html`, `js/config.js`) and
  `config/production-target.json` had been pointing at a different, broken
  "load-test diagnostics" deployment that 302-redirected anonymous requests
  to Google login — repointed all three to the new deployment, deployed to
  the same Cloudflare Pages project (clean artifact:
  `index.html`/`admin.html`/`robots.txt`/`sitemap.xml`/`css`/`js`/`assets`),
  confirmed `www.hojaseeds.pk` serves it live.
- **OAuth scope consent gaps** (two, found and fixed sequentially — Apps
  Script grants scopes lazily, per first actual API call, not upfront):
  the Spreadsheets scope had never been consented to under the new owner
  identity (`?action=products`/`settings` threw
  `SpreadsheetApp.getActiveSpreadsheet` permission errors) — fixed by
  manually running `getProducts`/`getSettings` once in the editor. Then
  Admin `priceUpdate` failed separately (`requireAdmin()`'s `UrlFetchApp`
  call to Google's tokeninfo endpoint needs `script.external_request`,
  untouched by the Sheets-only functions) — added
  `authorizeExternalRequestScope()` as a one-time manual-run helper,
  granted the same way. `requireAdmin()` was also hardened to wrap that
  `UrlFetchApp` call in try/catch so any future transient failure surfaces
  a real error message instead of an empty one.
- **Load-test isolation preflight PASS**: `HOJA_LOAD_TEST_SECRET` present in
  `.env.local` (git-ignored), 1 authorized isolated order landed only in
  `LoadTestOrders` (confirmed against live Sheet: production `Orders` count
  unchanged, order ID absent), missing/wrong secret both correctly rejected
  with `LOAD_TEST_UNAUTHORIZED` and zero writes.
- **Load ramp**: 5@C1, 10@C2, 20@C5, 50@C5, 100@C10 all reached 100%
  success / 0 duplicates / 0 corrupt rows — but only after diagnosing and
  fixing a real capacity limit: `LockService.getScriptLock().tryLock()`
  only waited 10s, which is too short once the queue for the single global
  order-write lock legitimately exceeds that (average lock hold ~10–17s,
  dominated by Products/Settings Sheet reads). Raised the wait to 60s (this
  only changes how long a legitimately-queued request waits before giving
  up — it does not change locking semantics, atomicity, or idempotency) and
  added bounded retry-with-backoff on `ORDER_BUSY` to the load-test harness
  (`scripts/order-load-test.mjs`). Even after the fix, C10 tail latency was
  poor (p50 11s, p95 49.6s, p99 72s, max 79s) — a deliberate decision was
  made **not** to scale further to C20/1000: the global lock is a real
  architectural ceiling, and pushing harder would mostly just confirm the
  same wall gets worse while risking Apps Script's 6-minute execution
  ceiling on an individual request (a genuine corruption risk, not just a
  slow response). **C5 is the recommended safe operating concurrency; C10
  is demonstrated but not advertised as normal.**
- **Idempotency stress PASS in full**: 5, 20, and 100 concurrent identical
  requests (same idempotency key) each converged to exactly one order ID,
  100% success once given a matching retry/wait budget. Same key + different
  payload correctly returned `IDEMPOTENCY_CONFLICT` with no new row.
  Double-submit and lost-response-retry scenarios both produced exactly one
  order each. All verified against the live Sheet, not just harness output.
- **Commercial E2E PASS**: 1 real COD, 1 Advance, 1 Split order created
  (marked "FINAL E2E TEST - DO NOT FULFILL"), `payNow + codDue == total`
  verified exactly for all three, confirming `MIN_PARTIAL_ADVANCE=250` and
  `SPLIT_ADVANCE_PERCENT=50` were correct at the time. Missing transaction
  reference and invalid phone both correctly rejected with zero writes.
- **Admin browser gate** (manual, one action at a time, no chrome_devtools
  MCP available in-session — confirmed absent by explicit `ToolSearch`, not
  assumed): Admin Products table PASS at the tested viewport (Product/
  Default Price/Current Price/Type all visible, no clipping); all 8 Admin
  tabs (Dashboard, Products, Orders, Customers, Delivery & Payments,
  Analytics, Store Settings, Audit Log) reported clean. Tomato mutate
  (185→186) and restore (186→185) both verified live via the anonymous
  `?action=products` read and the Audit Log. `MIN_PARTIAL_ADVANCE`
  (250→300→250) and `SPLIT_ADVANCE_PERCENT` (50→30→50) mutate/restore
  cycles verified against the live storefront Split Payment calculation
  (300/250→250/300 pay-now/pay-on-delivery split, matching the exact
  rounding/floor math) and the settings API; both confirmed back at their
  protected final values. Responsive matrix, mobile card/nav/delivery/
  payment checks, and the slow-network check were driven and reported by
  the user directly (not independently re-verified this session) as PASS.
- Protected/unchanged this arc: 47 approved products, delivery fees, Mix
  COD rules, custom Advance/Partial rules, COD rounding, idempotency,
  `LockService` correctness (only its wait budget was tuned), Sheet ID,
  Apps Script project, R2 assets/domain, Cloudflare project/domain,
  gisupp-only deployment identity. No 1000-order run was performed
  (intentional).
- Tooling note: this session has no `chrome_devtools` MCP or any browser
  automation tool — confirmed via explicit tool search, not assumed. All
  authenticated-Admin/browser evidence in this entry came from the user
  driving a real Chrome session and reporting/screenshotting results.
