/**
 * Hoja Seeds — Google Sheets backend
 *
 * Sheet tabs this script expects (create them with these exact names
 * and header rows — see README.md Step 1):
 *
 *   Products  | id | name | cat | unit | icon | price | type
 *   Orders    | timestamp | orderId | name | phone | address | city | postal | notes | paymentMethod | advanceMethod | transactionRef | items | subtotal | deliveryFee | total | payNow | codDue
 *     (paymentMethod is one of "Cash on Delivery" / "Advance Payment" /
 *      "Split Payment" — see the cart payment-policy matrix below)
 *   Contact   | timestamp | name | phone | message
 *   Settings  | key | value
 *     (rows: FREE_DELIVERY_THRESHOLD, ADVANCE_DELIVERY_FEE, COD_DELIVERY_FEE,
 *      COD_ALLOWED, CUSTOMIZED_REQUIRES_FULL_ADVANCE, and payment-display
 *      settings — see README.md Step 1)
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New
 * deployment > type "Web app" > Execute as "Me" > Who has access
 * "Anyone" > Deploy. Copy the Web App URL into js/config.js
 * (CONFIG.SHEET_WEBHOOK_URL).
 */

// One-time manual authorization helper: select this function in the
// editor toolbar and click Run once as gisupp@gmail.com, approving the
// consent dialog, to grant the script.external_request scope that
// requireAdmin()'s UrlFetchApp call to Google's tokeninfo endpoint
// needs. Safe to leave in place; it makes a harmless read-only request.
function authorizeExternalRequestScope() {
  const response = UrlFetchApp.fetch("https://www.googleapis.com/oauth2/v3/certs", { muteHttpExceptions: true });
  Logger.log("external_request scope check: HTTP " + response.getResponseCode());
}

function doGet(e) {
  const action = e.parameter.action;
  if (action === "bankAlfalahListener") return handleApgListener(e); // public, unauthenticated by design -- see handleApgListener
  ensureAdminProperties();
  if (action === "products") return jsonResponse(getProducts());
  if (action === "settings") return jsonResponse(getSettings());
  if (action === "popularProducts") return jsonResponse(getPopularProducts());
  return jsonResponse({ error: "Unknown action" });
}

// Run once through an authenticated Apps Script execution request. These
// values remain server-side Script Properties and are never returned by doGet.
function configureAdminProperties(clientId, adminEmail) {
  clientId = clientId || "804856718644-6eknoj1m8jcsbh5v9f6362p3gac9u5cs.apps.googleusercontent.com";
  adminEmail = adminEmail || "gisupp@gmail.com";
  if (String(adminEmail || "").toLowerCase() !== "gisupp@gmail.com") {
    throw new OrderError("INVALID_ADMIN_CONFIG", "The Hoja Seeds admin email is invalid.");
  }
  if (!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(String(clientId || ""))) {
    throw new OrderError("INVALID_ADMIN_CONFIG", "The Google OAuth client ID is invalid.");
  }
  PropertiesService.getScriptProperties().setProperties({
    HOJA_GOOGLE_CLIENT_ID: String(clientId),
    HOJA_ADMIN_EMAILS: "gisupp@gmail.com"
  });
  return { ok: true, adminEmail: "gisupp@gmail.com" };
}

function doPost(e) {
  // Bank Alfalah may POST its IPN callback (the registered Listener URL)
  // rather than GET it -- checked before any JSON body parsing, since
  // that POST's body is not our internal JSON protocol at all.
  if (e.parameter && e.parameter.action === "bankAlfalahListener") return handleApgListener(e);
  try {
    ensureAdminProperties();
    const payload = JSON.parse(e.postData.contents);
    if (payload.type === "order") return jsonResponse(submitOrder(payload));
    if (payload.type === "orderStatus") return jsonResponse(checkOrderStatus(payload));
    if (payload.type === "apgStartHandshake") return jsonResponse(apgStartHandshake(payload));
    if (payload.type === "apgStartSso") return jsonResponse(apgStartSso(payload));
    if (payload.type === "apgVerifyStatus") return jsonResponse(apgVerifyStatus(payload));
    if (payload.type === "saveLead") return jsonResponse(saveLead(payload));
    if (payload.type === "leadAttribution") return jsonResponse(leadAttribution(payload));
    if (payload.type === "updateLeadStatus") return jsonResponse(updateLeadStatus(payload));
    if (payload.type === "pushSubscription") return jsonResponse(savePushSubscription(payload));
    if (payload.type === "pushEvent") return jsonResponse(logPushEvent(payload));
    if (payload.type === "contact") logContact(payload);
    else if (payload.type === "adminRead") { requireAdmin(payload); return jsonResponse(readAdminResource(payload.resource, payload.limit)); }
    else if (payload.type === "priceUpdate") { const adminEmail = requireAdmin(payload); updateProducts(payload.updates, adminEmail); }
    else if (payload.type === "settingsUpdate") { const adminEmail = requireAdmin(payload); updateSettings(payload.rules, adminEmail); }
    else if (payload.type === "pushCampaignSave") { const adminEmail = requireAdmin(payload); return jsonResponse(savePushCampaign(payload.campaign, adminEmail)); }
    else if (payload.type === "pushCampaignSend") { const adminEmail = requireAdmin(payload); return jsonResponse(sendPushCampaign(payload.campaignId, adminEmail)); }
    else if (payload.type === "pushTestSend") { const adminEmail = requireAdmin(payload); return jsonResponse(pushTestSend(payload, adminEmail)); }
    else if (payload.type === "pushCampaignPause") { const adminEmail = requireAdmin(payload); return jsonResponse(setPushCampaignPause(payload.campaignId, true, adminEmail)); }
    else if (payload.type === "pushCampaignResume") { const adminEmail = requireAdmin(payload); return jsonResponse(setPushCampaignPause(payload.campaignId, false, adminEmail)); }
    else throw new OrderError("UNKNOWN_ACTION", "Unknown request type.");
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({
      ok: false,
      error: {
        code: error.code || "SERVER_ERROR",
        message: error.code ? error.message : "The order service could not process this request."
      }
    });
  }
}

function setLoadTestSecret(secret) {
  const email = Session.getActiveUser().getEmail();
  if (email !== "gisupp@gmail.com") throw new OrderError("ADMIN_UNAUTHORIZED", "Only the verified owner may set the load-test secret.");
  const value = requiredText(secret, "Load-test secret", 32, 200);
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(value)) throw new OrderError("INVALID_LOAD_TEST_SECRET", "The load-test secret format is invalid.");
  PropertiesService.getScriptProperties().setProperty("LOAD_TEST_SECRET", value);
  return { ok: true };
}

function ensureAdminProperties() {
  const properties = PropertiesService.getScriptProperties();
  const currentClientId = String(properties.getProperty("HOJA_GOOGLE_CLIENT_ID") || "");
  if (!currentClientId || currentClientId === "804856718644-9jbk23vd23rsrs9dci7gepcmtbmq40ob.apps.googleusercontent.com" || !properties.getProperty("HOJA_ADMIN_EMAILS")) {
    properties.setProperties({
      HOJA_GOOGLE_CLIENT_ID: "804856718644-6eknoj1m8jcsbh5v9f6362p3gac9u5cs.apps.googleusercontent.com",
      HOJA_ADMIN_EMAILS: "gisupp@gmail.com"
    });
  }
}

function requireAdmin(payload) {
  const token = String(payload.authToken || "");
  if (!token || token.length > 5000) throw new OrderError("ADMIN_UNAUTHORIZED", "Admin authorization is required.");

  const properties = PropertiesService.getScriptProperties();
  const clientId = String(properties.getProperty("HOJA_GOOGLE_CLIENT_ID") || "");
  const allowedEmails = String(properties.getProperty("HOJA_ADMIN_EMAILS") || "")
    .split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
  if (!clientId || !allowedEmails.length) {
    throw new OrderError("ADMIN_NOT_CONFIGURED", "Admin authorization is not configured.");
  }

  let response;
  try {
    response = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
  } catch (error) {
    throw new OrderError("ADMIN_VERIFICATION_FAILED", "Could not verify admin authorization. Please retry.");
  }
  if (response.getResponseCode() !== 200) {
    throw new OrderError("ADMIN_UNAUTHORIZED", "Admin authorization was rejected.");
  }
  let claims;
  try { claims = JSON.parse(response.getContentText()); }
  catch (error) { throw new OrderError("ADMIN_UNAUTHORIZED", "Admin authorization was rejected."); }

  const expiresAt = Number(claims.exp || 0) * 1000;
  const email = String(claims.email || "").toLowerCase();
  if (String(claims.aud || "") !== clientId || expiresAt <= Date.now() || claims.email_verified !== "true" || allowedEmails.indexOf(email) === -1) {
    throw new OrderError("ADMIN_UNAUTHORIZED", "Admin authorization was rejected.");
  }
  return email;
}

const ORDER_DEFAULT_RULES = {
  FREE_DELIVERY_THRESHOLD: 1500,
  ADVANCE_DELIVERY_FEE: 100,
  COD_DELIVERY_FEE: 250,
  COD_ALLOWED: true,
  SPLIT_ADVANCE_PERCENT: 50,
  MIN_PARTIAL_ADVANCE: 250
};
const ORDER_PAYMENT_METHODS = ["Cash on Delivery", "Advance Payment", "Split Payment"];
// "Bank Alfalah APG" (HS-20260820-01) is a real online redirect gateway,
// unlike the other three manual/offline advance methods -- it never
// requires the customer to type a transactionReference (see
// buildAuthoritativeOrder below), and is only offered while
// APG_SANDBOX_MODE is on (js/config.js) + APG_ENABLED (Settings sheet),
// both gates required before it appears in checkout at all.
const ORDER_ADVANCE_METHODS = ["JazzCash", "EasyPaisa", "Bank Transfer", "Bank Alfalah APG"];

// Cart-based payment-policy matrix (HS-20260817-04). Derived purely from the
// existing Products `cat`/`type` columns — no new Sheet column — so it stays
// server-authoritative and requires no product migration. Exact mapping:
//   cat === "mix" && type === "customized-collection" -> "advance_only"
//     (unchanged existing rule: advance only, no COD, no split)
//   cat === "mix" && type === "standard-collection"   -> "cod"
//     (approved fixed Mix Packs: 100% COD allowed, plus Advance if desired)
//   cat === "vegetables" || cat === "flowers"          -> "advance_or_split"
//     (individually selected packets: COD blocked; Advance or 50/50 Split)
//   anything else (Fertilizer, any other/ambiguous product) -> "existing"
//     (preserve current storewide COD_ALLOWED behavior, unchanged)
function productPaymentPolicy(product) {
  const cat = String(product.cat || product.category || "");
  const type = String(product.type || "regular");
  if (cat === "mix" && type === "customized-collection") return "advance_only";
  if (cat === "mix" && type === "standard-collection") return "cod";
  if (cat === "vegetables" || cat === "flowers") return "advance_or_split";
  return "existing";
}

// Cart-level policy is the single most restrictive item policy present.
// Precedence: advance_only > advance_or_split > cod/existing (both of which
// permit COD, subject to settings.COD_ALLOWED, and Advance).
function cartPaymentPolicy(orderItems) {
  const policies = orderItems.map(item => productPaymentPolicy(item));
  if (policies.indexOf("advance_only") !== -1) return "advance_only";
  if (policies.indexOf("advance_or_split") !== -1) return "advance_or_split";
  return "cod";
}
const PAYMENT_DISPLAY_DEFAULTS = {
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
  BANK_QR_URL: "",
  // Off by default (HS-20260820-01) -- an explicit admin opt-in on top of
  // the frontend's own CONFIG.APG_SANDBOX_MODE build flag, so real
  // customers can never see APG until both are turned on deliberately.
  APG_ENABLED: false
};
const PAYMENT_DISPLAY_KEYS = Object.keys(PAYMENT_DISPLAY_DEFAULTS);
const PRODUCT_TYPES = ["regular", "premium", "standard-collection", "customized-collection"];

function OrderError(code, message) {
  this.name = "OrderError";
  this.code = code;
  this.message = message;
}
OrderError.prototype = Object.create(Error.prototype);

function submitOrder(payload) {
  const startTime = Date.now();
  const loadTest = payload.loadTest === true;
  if (loadTest) requireLoadTestAuthorization(payload);
  const idempotencyKey = requiredText(payload.idempotencyKey, "Idempotency key", 16, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) {
    throw new OrderError("INVALID_IDEMPOTENCY_KEY", "The order request key is invalid.");
  }

  const fingerprint = requestFingerprint(payload);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    throw new OrderError("ORDER_BUSY", "The order service is busy. Please retry with the same order request.");
  }

  try {
    const orderId = generateOrderId(idempotencyKey);
    const existingOrder = findMatchingOrder(orderId, fingerprint, loadTest ? "LoadTestOrders" : "Orders");
    if (existingOrder) return existingOrder;

    const order = buildAuthoritativeOrder(payload, getProducts(), getOrderSettings(), orderId);
    order.idempotencyFingerprint = fingerprint;
    if (loadTest) {
      order.testRunId = requiredText(payload.testRunId, "Test run ID", 8, 100);
      order.sequence = Number(payload.sequence) || 0;
      order.idempotencyKey = idempotencyKey;
      order.processingMs = Date.now() - startTime;
      try {
        logLoadTestOrder(order);
      } catch (error) {
        throw new OrderError("LOAD_TEST_WRITE_FAILED", String(error && error.message || error).slice(0, 180));
      }
    } else {
      logOrder(order);
      // Best-effort only, after the order is durably written: link the
      // checkout Lead (if any) to this order and fire the server-side Meta
      // CAPI Purchase. Neither can ever fail the order itself -- both are
      // wrapped so a Sheet/network hiccup here never turns a successful
      // order into a failed checkout (HS-20260819-02).
      try { convertLeadOnOrder(payload.leadId, order, payload); } catch (growthError) { console.error(growthError); }
    }
    delete order.idempotencyFingerprint;
    return order;
  } finally {
    lock.releaseLock();
  }
}

// Pending-order reconciliation (HS-20260819-13): if a customer's tab
// closes/backgrounds between clicking Confirm Order and receiving the
// response, the client can ask "did this idempotencyKey actually go
// through?" on its next visit, without resubmitting anything and without
// generating a second key. Read-only, no lock needed (orderId is a
// deterministic SHA-256 of idempotencyKey, so a match is unambiguous).
// Deliberately minimal response -- confirmed/orderId only, never
// name/phone/address/items/amounts, so a leaked idempotencyKey (a random
// client-generated UUID, not guessable) still exposes nothing sensitive.
function checkOrderStatus(payload) {
  const idempotencyKey = requiredText(payload.idempotencyKey, "Idempotency key", 16, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) {
    throw new OrderError("INVALID_IDEMPOTENCY_KEY", "The order request key is invalid.");
  }
  const orderId = generateOrderId(idempotencyKey);
  const existing = findOrderById(orderId);
  return { ok: true, confirmed: Boolean(existing), orderId: existing ? orderId : null };
}

// ============================================================================
// Bank Alfalah APG (Alfa Payment Gateway) -- HS-20260820-01
//
// Contract extracted from the real "APG Merchant Integration Guide v1.1"
// PDF plus the ACTUAL executable sample code shown in the merchant
// portal's own Sandbox -> Integration -> Page Redirection page (the PDF's
// "see sample code attached" was never actually attached to the project
// -- this was retrieved directly from the portal itself, not guessed).
//
// Two-hop redirect flow:
//   1. Handshake: browser POSTs HS_* fields to {base}/HS/HS/HS. APG
//      redirects the browser back to HS_ReturnURL with ?auth_token=...
//   2. SSO: browser POSTs AuthToken + TransactionAmount/TransactionTypeId
//      to {base}/SSO/SSO/SSO. A successful response IS a redirect to
//      APG's own hosted checkout page (card/wallet/bank entry never
//      touches this site).
//   3. Customer pays on APG's page, APG redirects back to ReturnURL again.
//   4. Authoritative status: GET {base}/HS/api/IPN/OrderStatus/{merchantId}/
//      {storeId}/{orderId} -- ONLY this (or the listener relaying the same
//      inquiry) may ever mark an order Paid. Return URL query params are
//      never trusted alone.
//
// Hash algorithm (HS_RequestHash / RequestHash), exactly as APG's own
// sample computes it client-side with CryptoJS -- reimplemented here in
// pure JS server-side (Apps Script has no native AES) so the two secret
// keys (APG_KEY1/APG_KEY2) never reach the browser:
//   mapString = every form-input's `id=value` pair, in the SAME order the
//     official sample's form fields appear, joined with "&", trailing "&"
//     stripped.
//   hash = AES-128-CBC(key=APG_KEY1 as raw UTF-8 bytes,
//                       iv=APG_KEY2 as raw UTF-8 bytes,
//                       padding=PKCS7)(mapString), base64-encoded.
// Verified byte-for-byte against Node's native crypto.createCipheriv
// ("aes-128-cbc") across several vectors (empty string, unicode, exact
// block size) before ever being used against the real sandbox.
// ============================================================================

const APG_AES_SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
const APG_AES_RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function apgUtf8Bytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.codePointAt(i);
    if (code > 0xFFFF) i++;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}
function apgAesKeyExpansion(key) {
  const Nk = 4, Nr = 10, w = [];
  for (let i = 0; i < Nk; i++) w.push([key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]]);
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let temp = w[i-1].slice();
    if (i % Nk === 0) {
      temp = [temp[1], temp[2], temp[3], temp[0]].map(b => APG_AES_SBOX[b]);
      temp[0] ^= APG_AES_RCON[i/Nk - 1];
    }
    w.push(w[i-Nk].map((b, idx) => b ^ temp[idx]));
  }
  return w;
}
function apgAesSubBytes(s) { for (let i = 0; i < 16; i++) s[i] = APG_AES_SBOX[s[i]]; }
function apgAesShiftRows(s) { const t = s.slice(); for (let r=1;r<4;r++) for (let c=0;c<4;c++) s[c*4+r] = t[((c+r)%4)*4+r]; }
function apgAesMulGF(a, b) { let p=0; for (let i=0;i<8;i++){ if (b&1) p^=a; const hi=a&0x80; a=(a<<1)&0xff; if (hi) a^=0x1b; b>>=1; } return p&0xff; }
function apgAesMixColumns(s) {
  for (let c=0;c<4;c++) {
    const a0=s[c*4],a1=s[c*4+1],a2=s[c*4+2],a3=s[c*4+3];
    s[c*4]=apgAesMulGF(a0,2)^apgAesMulGF(a1,3)^a2^a3;
    s[c*4+1]=a0^apgAesMulGF(a1,2)^apgAesMulGF(a2,3)^a3;
    s[c*4+2]=a0^a1^apgAesMulGF(a2,2)^apgAesMulGF(a3,3);
    s[c*4+3]=apgAesMulGF(a0,3)^a1^a2^apgAesMulGF(a3,2);
  }
}
function apgAesAddRoundKey(s, w, round) { for (let c=0;c<4;c++) for (let r=0;r<4;r++) s[c*4+r] ^= w[round*4+c][r]; }
function apgAesEncryptBlock(input, w) {
  const s = input.slice();
  apgAesAddRoundKey(s, w, 0);
  for (let round = 1; round <= 9; round++) { apgAesSubBytes(s); apgAesShiftRows(s); apgAesMixColumns(s); apgAesAddRoundKey(s, w, round); }
  apgAesSubBytes(s); apgAesShiftRows(s); apgAesAddRoundKey(s, w, 10);
  return s;
}
function apgPkcs7Pad(bytes, blockSize) {
  const padLen = blockSize - (bytes.length % blockSize);
  const out = bytes.slice();
  for (let i = 0; i < padLen; i++) out.push(padLen);
  return out;
}
function apgBytesToBase64(bytes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i+1], b2 = bytes[i+2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? "=" : chars[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? "=" : chars[b2 & 63];
  }
  return out;
}
// Matches CryptoJS.AES.encrypt(plain, key, {iv, mode: CBC, padding: Pkcs7}).toString()
// exactly when key/iv are both 16-char UTF-8 strings (128-bit).
function apgAesEncryptBase64(plainText, keyStr, ivStr) {
  const key = apgUtf8Bytes(keyStr), iv = apgUtf8Bytes(ivStr);
  if (key.length !== 16 || iv.length !== 16) throw new OrderError("APG_NOT_CONFIGURED", "APG encryption keys are misconfigured.");
  const w = apgAesKeyExpansion(key);
  const padded = apgPkcs7Pad(apgUtf8Bytes(plainText), 16);
  let prev = iv, out = [];
  for (let off = 0; off < padded.length; off += 16) {
    const block = padded.slice(off, off + 16);
    const xored = block.map((b, i) => b ^ prev[i]);
    const enc = apgAesEncryptBlock(xored, w);
    out = out.concat(enc);
    prev = enc;
  }
  return apgBytesToBase64(out);
}

// Builds the exact `id=value&id=value...` string APG's own sample builds
// from live DOM input order, from a fixed, explicit [id, value] list --
// deterministic server-side equivalent, no DOM involved.
function apgMapString(pairs) {
  return pairs.map(([id, value]) => id + "=" + value).join("&");
}

function apgConfig() {
  const p = PropertiesService.getScriptProperties();
  const cfg = {
    base: p.getProperty("APG_SANDBOX_BASE") || "https://sandbox.bankalfalah.com",
    merchantId: p.getProperty("APG_MERCHANT_ID"),
    storeId: p.getProperty("APG_STORE_ID"),
    merchantHash: p.getProperty("APG_MERCHANT_HASH"),
    merchantUsername: p.getProperty("APG_MERCHANT_USERNAME"),
    merchantPassword: p.getProperty("APG_MERCHANT_PASSWORD"),
    key1: p.getProperty("APG_KEY1"),
    key2: p.getProperty("APG_KEY2")
  };
  const required = ["merchantId", "storeId", "merchantHash", "merchantUsername", "merchantPassword", "key1", "key2"];
  if (required.some(k => !cfg[k])) {
    throw new OrderError("APG_NOT_CONFIGURED", "Bank Alfalah APG is not configured yet (Script Properties missing).");
  }
  return cfg;
}

function apgFindOrderRow(gatewayOrderId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Orders");
  if (!sheet) return null;
  return findRowById(sheet, "orderId", gatewayOrderId);
}

// Step 1 -- customer already has a real PENDING gateway order (created via
// the normal submitOrder path, same idempotency/validation as every other
// payment method). This returns the exact field set + hash the frontend
// auto-submits as a real full-page POST to {base}/HS/HS/HS. Key1/Key2 and
// MerchantPassword's role in the hash never leave the server -- only the
// final computed hash does. (MerchantHash/Username/Password themselves
// DO travel in this POST, same as APG's own official sample -- that is
// how APG's page-redirection mode identifies the merchant; it is not a
// gap introduced here.)
function apgStartHandshake(payload) {
  const orderId = requiredText(payload.orderId, "Order ID", 8, 100);
  const found = apgFindOrderRow(orderId);
  if (!found) throw new OrderError("ORDER_NOT_FOUND", "Order not found.");
  const h = found.headers, row = found.row;
  if (String(row[h.indexOf("paymentGateway")]) !== "bank_alfalah_apg") {
    throw new OrderError("NOT_A_GATEWAY_ORDER", "This order is not a Bank Alfalah APG payment.");
  }
  const cfg = apgConfig();
  const returnUrl = "https://www.hojaseeds.pk/?hs_view=payment-return";
  const pairs = [
    ["HS_RequestHash", ""],
    ["HS_IsRedirectionRequest", "1"],
    ["HS_ChannelId", "1001"],
    ["HS_ReturnURL", returnUrl],
    ["HS_MerchantId", cfg.merchantId],
    ["HS_StoreId", cfg.storeId],
    ["HS_MerchantHash", cfg.merchantHash],
    ["HS_MerchantUsername", cfg.merchantUsername],
    ["HS_MerchantPassword", cfg.merchantPassword],
    ["HS_TransactionReferenceNumber", orderId]
  ];
  const hash = apgAesEncryptBase64(apgMapString(pairs), cfg.key1, cfg.key2);
  const fields = {};
  pairs.forEach(([id, value]) => { fields[id] = value; });
  fields.HS_RequestHash = hash;
  return { ok: true, action: cfg.base + "/HS/HS/HS", fields: fields };
}

// Step 2 -- customer's browser landed back on our Return URL with
// ?auth_token=... after a successful handshake. This returns the fields
// for a real full-page POST to {base}/SSO/SSO/SSO; APG's OWN successful
// response to that POST is a redirect to its hosted checkout page. The
// amount sent is always the server's own payNow for this order -- never
// a client-supplied amount.
function apgStartSso(payload) {
  const orderId = requiredText(payload.orderId, "Order ID", 8, 100);
  const authToken = requiredText(payload.authToken, "Auth token", 4, 4000);
  const found = apgFindOrderRow(orderId);
  if (!found) throw new OrderError("ORDER_NOT_FOUND", "Order not found.");
  const h = found.headers, row = found.row;
  if (String(row[h.indexOf("paymentGateway")]) !== "bank_alfalah_apg") {
    throw new OrderError("NOT_A_GATEWAY_ORDER", "This order is not a Bank Alfalah APG payment.");
  }
  if (String(row[h.indexOf("gatewayStatus")]) !== "PENDING") {
    throw new OrderError("GATEWAY_ORDER_NOT_PENDING", "This order is no longer awaiting payment.");
  }
  const amount = Number(row[h.indexOf("payNow")]);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    throw new OrderError("INVALID_GATEWAY_AMOUNT", "The order amount is invalid for a gateway payment.");
  }
  const cfg = apgConfig();
  const returnUrl = "https://www.hojaseeds.pk/?hs_view=payment-return";
  const pairs = [
    ["AuthToken", authToken],
    ["RequestHash", ""],
    ["ChannelId", "1001"],
    ["Currency", "PKR"],
    ["IsBIN", "0"],
    ["ReturnURL", returnUrl],
    ["MerchantId", cfg.merchantId],
    ["StoreId", cfg.storeId],
    ["MerchantHash", cfg.merchantHash],
    ["MerchantUsername", cfg.merchantUsername],
    ["MerchantPassword", cfg.merchantPassword],
    ["TransactionTypeId", ""], // empty = let the customer choose any APG-supported method
    ["TransactionReferenceNumber", orderId],
    ["TransactionAmount", String(amount)]
  ];
  const hash = apgAesEncryptBase64(apgMapString(pairs), cfg.key1, cfg.key2);
  const fields = {};
  pairs.forEach(([id, value]) => { fields[id] = value; });
  fields.RequestHash = hash;
  return { ok: true, action: cfg.base + "/SSO/SSO/SSO", fields: fields };
}

// The one authoritative source of truth for whether an APG order is
// actually paid. Handles the documented double-JSON-encoding quirk in
// APG's own response (confirmed from the portal's own C# IPN sample --
// not guessed): the raw body is a JSON STRING containing escaped JSON, so
// backslashes are stripped and the outer wrapping quote pair removed
// before parsing.
function apgStatusInquiryFromUrl(url) {
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return null;
  let text = resp.getContentText();
  text = text.split("\\").join("");
  if (text.length >= 2 && text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') {
    text = text.substring(1, text.length - 1);
  }
  try { return JSON.parse(text); } catch (e) { return null; }
}

function apgStatusInquiry(gatewayOrderId) {
  const cfg = apgConfig();
  const url = cfg.base + "/HS/api/IPN/OrderStatus/" + encodeURIComponent(cfg.merchantId) + "/" + encodeURIComponent(cfg.storeId) + "/" + encodeURIComponent(gatewayOrderId);
  return apgStatusInquiryFromUrl(url);
}

// Idempotent by construction (HS-20260820-01, section 7/8 of the task):
// once an order's gatewayStatus is a TERMINAL value (PAID/FAILED/
// CANCELLED) this is a pure no-op forever after, regardless of how many
// times the Return page or the Listener call it for the same order. A
// short CacheService lock closes the narrow race where both channels
// read PENDING at nearly the same instant.
function applyGatewayStatusUpdate(gatewayOrderId, statusData) {
  const lockKey = "apg_status_" + gatewayOrderId;
  const cache = CacheService.getScriptCache();
  if (cache.get(lockKey)) return apgReadGatewayState(gatewayOrderId); // another call is mid-update; don't race it
  cache.put(lockKey, "1", 20);
  try {
    const found = apgFindOrderRow(gatewayOrderId);
    if (!found) return null;
    const h = found.headers;
    const currentStatus = String(found.row[h.indexOf("gatewayStatus")] || "");
    if (["PAID", "FAILED", "CANCELLED"].indexOf(currentStatus) !== -1) {
      return apgReadGatewayState(gatewayOrderId); // already terminal -- never overwritten
    }
    const rawStatus = statusData ? String(statusData.TransactionStatus || "") : "";
    const newStatus = !statusData ? "UNKNOWN" : (rawStatus === "Paid" ? "PAID" : "FAILED");
    const now = new Date().toISOString();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Orders");
    setSheetField(sheet, found.rowIndex, h, "gatewayStatus", newStatus);
    setSheetField(sheet, found.rowIndex, h, "gatewayUpdatedAt", now);
    if (statusData && statusData.TransactionId) setSheetField(sheet, found.rowIndex, h, "gatewayTransactionId", safeSheetText(String(statusData.TransactionId)));
    if (newStatus === "PAID") setSheetField(sheet, found.rowIndex, h, "paidAt", now);
    return apgReadGatewayState(gatewayOrderId);
  } finally {
    cache.remove(lockKey);
  }
}

function setSheetField(sheet, rowIndex, headers, key, value) {
  const col = headers.indexOf(key);
  if (col === -1) return; // additive column not present on a very old sheet snapshot -- skip rather than throw
  sheet.getRange(rowIndex, col + 1).setValue(value);
}

function apgReadGatewayState(gatewayOrderId) {
  const found = apgFindOrderRow(gatewayOrderId);
  if (!found) return null;
  const h = found.headers, row = found.row;
  const paymentMethod = String(row[h.indexOf("paymentMethod")]);
  const gatewayStatus = String(row[h.indexOf("gatewayStatus")] || "");
  // Items included so the Return page can fire a proper item-level
  // Purchase event once PAID -- this is the customer's own order, the
  // same level of detail already returned to them by a normal submitOrder
  // success response for every other payment method.
  let items = [];
  try { const snapshot = JSON.parse(String(row[h.indexOf("items")] || "[]")); items = Array.isArray(snapshot) ? snapshot : (snapshot.items || []); } catch (e) { items = []; }
  return {
    orderId: gatewayOrderId,
    gatewayStatus: gatewayStatus,
    paymentStatus: derivePaymentStatus(paymentMethod, gatewayStatus),
    paymentMethod: paymentMethod,
    advanceMethod: String(row[h.indexOf("advanceMethod")] || ""),
    total: Number(row[h.indexOf("total")]),
    payNow: Number(row[h.indexOf("payNow")]),
    deliveryFee: Number(row[h.indexOf("deliveryFee")]),
    items: items
  };
}

// Customer-facing, called from the Return page. Re-verifies with APG
// itself every time it's called while still PENDING (safe/idempotent --
// see applyGatewayStatusUpdate); once terminal, returns the stored result
// without hitting APG again. Response is deliberately minimal: no
// name/phone/address, same principle as checkOrderStatus.
function apgVerifyStatus(payload) {
  const orderId = requiredText(payload.orderId, "Order ID", 8, 100);
  const found = apgFindOrderRow(orderId);
  if (!found) throw new OrderError("ORDER_NOT_FOUND", "Order not found.");
  const h = found.headers, row = found.row;
  if (String(row[h.indexOf("paymentGateway")]) !== "bank_alfalah_apg") {
    throw new OrderError("NOT_A_GATEWAY_ORDER", "This order is not a Bank Alfalah APG payment.");
  }
  const currentStatus = String(row[h.indexOf("gatewayStatus")] || "");
  if (["PAID", "FAILED", "CANCELLED"].indexOf(currentStatus) !== -1) {
    return { ok: true, state: apgReadGatewayState(orderId) };
  }
  const statusData = apgStatusInquiry(orderId);
  const state = applyGatewayStatusUpdate(orderId, statusData);
  return { ok: true, state: state };
}

// Listener/IPN entry point (registered Listener URL, ?action=bankAlfalahListener).
// Per the portal's own C# sample: APG POSTs with a `url` query param whose
// value IS the ready-to-call OrderStatus inquiry URL -- we GET exactly
// that URL (never reconstruct our own) and apply the same idempotent
// update used by the Return page. Always responds fast with a small body;
// never throws past this point (a listener failure must never surface as
// an error to APG's own systems).
function handleApgListener(e) {
  try {
    const rawUrl = e && e.parameter ? e.parameter.url : "";
    if (!rawUrl) return ContentService.createTextOutput("NO_URL");
    const statusUrl = decodeURIComponent(rawUrl);
    if (!/^https:\/\/(sandbox|payments)\.bankalfalah\.com\//.test(statusUrl)) {
      console.error("Listener rejected non-APG status URL");
      return ContentService.createTextOutput("REJECTED");
    }
    // The inquiry URL itself ends in .../OrderStatus/{merchantId}/{storeId}/{orderId}
    // -- check whether that order is already terminal BEFORE spending a
    // real sandbox call, so a duplicate/repeated listener POST for an
    // already-resolved order never re-hits APG at all, not just never
    // re-writes the Sheet.
    const urlOrderId = statusUrl.split("/").filter(Boolean).pop();
    if (urlOrderId) {
      const existing = apgFindOrderRow(urlOrderId);
      if (existing) {
        const existingStatus = String(existing.row[existing.headers.indexOf("gatewayStatus")] || "");
        if (["PAID", "FAILED", "CANCELLED"].indexOf(existingStatus) !== -1) return ContentService.createTextOutput("OK");
      }
    }
    const statusData = apgStatusInquiryFromUrl(statusUrl);
    const gatewayOrderId = statusData ? String(statusData.TransactionReferenceNumber || "") : "";
    if (gatewayOrderId) applyGatewayStatusUpdate(gatewayOrderId, statusData);
    return ContentService.createTextOutput("OK");
  } catch (error) {
    console.error(error);
    return ContentService.createTextOutput("ERROR");
  }
}

function requireLoadTestAuthorization(payload) {
  const configured = PropertiesService.getScriptProperties().getProperty("LOAD_TEST_SECRET");
  const supplied = String(payload.loadTestSecret || "");
  if (!configured || !supplied || supplied !== configured || payload.loadTest !== true || !/^[A-Za-z0-9_-]{8,100}$/.test(String(payload.testRunId || ""))) {
    throw new OrderError("LOAD_TEST_UNAUTHORIZED", "Load-test authorization is invalid.");
  }
}

function buildAuthoritativeOrder(payload, products, settings, orderId) {
  const customerInput = payload.customer || {};
  const paymentInput = payload.payment || {};
  const customer = {
    name: requiredText(customerInput.name, "Name", 2, 80),
    phone: normalizePakistanMobile(customerInput.phone),
    address: requiredText(customerInput.address, "Address", 10, 300),
    city: requiredText(customerInput.city, "City", 2, 80),
    postal: optionalText(customerInput.postal, "Postal code", 20),
    notes: optionalText(customerInput.notes, "Order notes", 500)
  };

  const paymentMethod = requiredText(paymentInput.method, "Payment method", 3, 40);
  if (ORDER_PAYMENT_METHODS.indexOf(paymentMethod) === -1) {
    throw new OrderError("INVALID_PAYMENT_METHOD", "Choose Cash on Delivery or Advance Payment.");
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 100) {
    throw new OrderError("INVALID_ITEMS", "The order must contain at least one valid product.");
  }

  const productsById = {};
  products.forEach(product => { productsById[String(product.id)] = product; });
  const seen = {};
  const orderItems = payload.items.map(item => {
    const productId = requiredText(item && item.productId, "Product ID", 1, 100);
    if (seen[productId]) throw new OrderError("DUPLICATE_PRODUCT", "Each product may appear only once in an order.");
    seen[productId] = true;
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 999) {
      throw new OrderError("INVALID_QUANTITY", "Product quantities must be positive whole numbers.");
    }

    const product = productsById[productId];
    if (!product) throw new OrderError("INVALID_PRODUCT", "One or more products are no longer available.");
    validateProductAvailability(product, quantity);
    const unitPrice = Number(product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new OrderError("INVALID_PRODUCT_PRICE", "A product has an invalid current price.");
    }
    return {
      productId: productId,
      name: String(product.name || productId),
      category: String(product.cat || ""),
      unit: String(product.unit || ""),
      type: String(product.type || "regular"),
      quantity: quantity,
      unitPrice: unitPrice,
      lineTotal: unitPrice * quantity
    };
  });

  const subtotal = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const cartPolicy = cartPaymentPolicy(orderItems);

  if (cartPolicy === "advance_only" && paymentMethod !== "Advance Payment") {
    throw new OrderError("CUSTOMIZED_REQUIRES_ADVANCE", "Customized collections require advance payment.");
  }
  if (cartPolicy === "advance_or_split") {
    if (paymentMethod === "Cash on Delivery") {
      throw new OrderError("CUSTOM_SELECTION_REQUIRES_ADVANCE", "Individually selected seed packets require advance payment or the configured split — Cash on Delivery is only available on ready-made Mix Packs.");
    }
  }
  if (cartPolicy === "cod") {
    if (paymentMethod === "Cash on Delivery" && !settings.COD_ALLOWED) {
      throw new OrderError("COD_UNAVAILABLE", "Cash on Delivery is not available.");
    }
    if (paymentMethod === "Split Payment") {
      throw new OrderError("SPLIT_NOT_APPLICABLE", "Split payment is not offered for this cart.");
    }
  }

  let advanceMethod = "";
  let transactionReference = "";
  let paymentGateway = "";
  if (paymentMethod === "Advance Payment" || paymentMethod === "Split Payment") {
    advanceMethod = requiredText(paymentInput.advanceMethod, "Advance payment method", 3, 40);
    if (ORDER_ADVANCE_METHODS.indexOf(advanceMethod) === -1) {
      throw new OrderError("INVALID_ADVANCE_METHOD", "Choose a supported advance payment method.");
    }
    const enabledKey = { JazzCash: "JAZZCASH_ENABLED", EasyPaisa: "EASYPAISA_ENABLED", "Bank Transfer": "BANK_ENABLED", "Bank Alfalah APG": "APG_ENABLED" }[advanceMethod];
    if (!booleanValue(settings[enabledKey])) throw new OrderError("ADVANCE_METHOD_DISABLED", "That advance payment method is not currently available.");
    if (advanceMethod === "Bank Alfalah APG") {
      // Real gateway redirect: there is no customer-typed reference to
      // validate here -- the gateway transaction ID/status is filled in
      // authoritatively later by applyGatewayStatusUpdate(), server-side
      // only, never trusted from the browser (see docs/PROJECT_STATE.md).
      paymentGateway = "bank_alfalah_apg";
    } else {
      transactionReference = requiredText(paymentInput.transactionReference, "Transaction reference", 3, 100);
    }
  }

  // Delivery fee: Advance keeps the existing free-delivery-threshold benefit.
  // Split does NOT qualify for that benefit — it uses the approved COD fee
  // (no separate SPLIT_DELIVERY_FEE has been approved for launch). COD (Mix
  // Pack) keeps the existing COD fee.
  const deliveryFee = paymentMethod === "Advance Payment"
    ? (subtotal >= settings.FREE_DELIVERY_THRESHOLD ? 0 : settings.ADVANCE_DELIVERY_FEE)
    : settings.COD_DELIVERY_FEE;
  const total = subtotal + deliveryFee;

  // Split is calculated server-side only, on the final total, with
  // deterministic rounding: pay-now rounds up, COD-due absorbs the
  // remainder — so payNow + codDue always equals total exactly.
  let payNow, codDue;
  if (paymentMethod === "Advance Payment") { payNow = total; codDue = 0; }
  else if (paymentMethod === "Cash on Delivery") { payNow = 0; codDue = total; }
  else {
    const splitPercent = Number(settings.SPLIT_ADVANCE_PERCENT);
    if (!Number.isInteger(splitPercent) || splitPercent < 1 || splitPercent > 99) {
      throw new OrderError("INVALID_SPLIT_PERCENT", "The split payment percentage is not configured correctly.");
    }
    const rawPayNow = Math.ceil(total * splitPercent / 100);
    const rawCodDue = total - rawPayNow;
    const roundingUnit = Math.max(100, Number(settings.SPLIT_COD_ROUNDING_UNIT) || 100);
    const roundedCodDue = Math.round(rawCodDue / roundingUnit) * roundingUnit;
    const normalPayNow = total - roundedCodDue;
    // Apply the floor after normal Split COD rounding. Do not re-round COD,
    // because that could put the advance back below the configured minimum.
    const minimumAdvance = Math.min(total, settings.MIN_PARTIAL_ADVANCE);
    payNow = Math.max(normalPayNow, minimumAdvance);
    codDue = total - payNow;
  }

  const resolvedOrderId = orderId || generateOrderId(payload.idempotencyKey);
  return {
    ok: true,
    orderId: resolvedOrderId,
    createdAt: new Date().toISOString(),
    customer: customer,
    paymentMethod: paymentMethod,
    advanceMethod: advanceMethod,
    transactionReference: transactionReference,
    paymentStatus: derivePaymentStatus(paymentMethod, paymentGateway ? "PENDING" : ""),
    items: orderItems,
    subtotal: subtotal,
    deliveryFee: deliveryFee,
    total: total,
    payNow: payNow,
    codDue: codDue,
    paymentGateway: paymentGateway,
    gatewayOrderId: paymentGateway ? resolvedOrderId : "",
    gatewayTransactionId: "",
    gatewayStatus: paymentGateway ? "PENDING" : "",
    gatewayUpdatedAt: "",
    paidAt: ""
  };
}

function getOrderSettings() {
  const rules = Object.assign({}, ORDER_DEFAULT_RULES, PAYMENT_DISPLAY_DEFAULTS, getSettings());
  ["FREE_DELIVERY_THRESHOLD", "ADVANCE_DELIVERY_FEE", "COD_DELIVERY_FEE"].forEach(key => {
    rules[key] = Number(rules[key]);
    if (!Number.isFinite(rules[key]) || rules[key] < 0) {
      throw new OrderError("INVALID_STORE_SETTINGS", "The store delivery settings are invalid.");
    }
  });
  rules.SPLIT_ADVANCE_PERCENT = Number(rules.SPLIT_ADVANCE_PERCENT);
  if (!Number.isInteger(rules.SPLIT_ADVANCE_PERCENT) || rules.SPLIT_ADVANCE_PERCENT < 1 || rules.SPLIT_ADVANCE_PERCENT > 99) {
    throw new OrderError("INVALID_STORE_SETTINGS", "The split payment percentage is invalid.");
  }
  rules.MIN_PARTIAL_ADVANCE = Number(rules.MIN_PARTIAL_ADVANCE);
  if (!Number.isInteger(rules.MIN_PARTIAL_ADVANCE) || rules.MIN_PARTIAL_ADVANCE < 1 || rules.MIN_PARTIAL_ADVANCE > 100000) {
    throw new OrderError("INVALID_STORE_SETTINGS", "The minimum partial advance is invalid.");
  }
  rules.COD_ALLOWED = booleanValue(rules.COD_ALLOWED);
  return rules;
}

function validateProductAvailability(product, quantity) {
  if (Object.prototype.hasOwnProperty.call(product, "active") && String(product.active).trim() !== "" && !booleanValue(product.active)) {
    throw new OrderError("INACTIVE_PRODUCT", "One or more products are inactive.");
  }
  if (Object.prototype.hasOwnProperty.call(product, "available") && !booleanValue(product.available)) {
    throw new OrderError("UNAVAILABLE_PRODUCT", "One or more products are unavailable.");
  }
  const stockStatus = String(product.stock_status || "").toLowerCase();
  if (["out of stock", "out-of-stock", "unavailable", "inactive"].indexOf(stockStatus) !== -1) {
    throw new OrderError("OUT_OF_STOCK", "One or more products are out of stock.");
  }
  const stockValue = firstDefined(product, ["available_quantity", "stock_quantity", "stock"]);
  if (stockValue !== null && stockValue !== "") {
    const stock = Number(stockValue);
    if (!Number.isFinite(stock) || stock < quantity) {
      throw new OrderError("INSUFFICIENT_STOCK", "The requested quantity is not available.");
    }
  }
}

function firstDefined(obj, keys) {
  for (let i = 0; i < keys.length; i++) {
    if (Object.prototype.hasOwnProperty.call(obj, keys[i])) return obj[keys[i]];
  }
  return null;
}

function booleanValue(value) {
  const normalized = String(value).toLowerCase();
  return value === true || value === 1 || normalized === "true" || normalized === "yes";
}

function requiredText(value, label, minLength, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (text.length < minLength || text.length > maxLength) {
    throw new OrderError("INVALID_FIELD", label + " is invalid.");
  }
  return text;
}

function optionalText(value, label, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (text.length > maxLength) throw new OrderError("INVALID_FIELD", label + " is too long.");
  return text;
}

function normalizePakistanMobile(value) {
  const digits = String(value == null ? "" : value).replace(/\D/g, "");
  let normalized = digits;
  if (/^03\d{9}$/.test(digits)) normalized = "92" + digits.slice(1);
  else if (/^3\d{9}$/.test(digits)) normalized = "92" + digits;
  if (!/^923\d{9}$/.test(normalized)) {
    throw new OrderError("INVALID_PHONE", "Enter a valid Pakistan mobile number.");
  }
  return normalized;
}

function requestFingerprint(payload) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, stableStringify(payload), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest);
}

function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function generateOrderId(idempotencyKey) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idempotencyKey, Utilities.Charset.UTF_8);
  return "HOJA-" + Utilities.base64EncodeWebSafe(digest).replace(/[^A-Za-z0-9]/g, "").slice(0, 16).toUpperCase();
}

function getProducts() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Products");
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  return rows
    .filter(r => r[0]) // skip blank rows
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = r[i]);
      return obj;
    });
}

// Read-only merchandising popularity ranking for the homepage "Popular
// Seeds" strip (HS-20260818-31). Public response is deliberately limited to
// {productId, soldQty} only — no customer name/phone/address/order detail
// ever leaves this function. Reads the real "Orders" sheet only (never
// LoadTestOrders) and skips any row whose customer-name column carries a
// test/diagnostic marker, matching this project's existing marked-test
// convention ("... DO NOT FULFILL", "... TEST ..."). Cached for 20 minutes
// so this never adds real per-request Sheet-read cost to the homepage.
function getPopularProducts() {
  const cache = CacheService.getScriptCache();
  const cacheKey = "popularProducts_v1";
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through and recompute */ }
  }
  const result = computePopularProducts();
  try { cache.put(cacheKey, JSON.stringify(result), 1200); } catch (e) { /* cache is best-effort */ }
  return result;
}

function computePopularProducts() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Orders");
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  const nameCol = headers.indexOf("name");
  const itemsCol = headers.indexOf("items");
  if (itemsCol === -1) return [];
  const totals = {};
  rows.forEach(function (row) {
    if (!row[itemsCol]) return;
    const customerName = String(nameCol > -1 ? row[nameCol] : "").toUpperCase();
    if (customerName.indexOf("TEST") !== -1 || customerName.indexOf("DO NOT FULFILL") !== -1) return;
    let parsed;
    try { parsed = JSON.parse(row[itemsCol]); } catch (e) { return; }
    const items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : []);
    items.forEach(function (item) {
      if (!item || !item.productId) return;
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) return;
      totals[item.productId] = (totals[item.productId] || 0) + qty;
    });
  });
  return Object.keys(totals)
    .map(function (productId) { return { productId: productId, soldQty: totals[productId] }; })
    .sort(function (a, b) { return b.soldQty - a.soldQty; })
    .slice(0, 6);
}

function updateProducts(updates, adminEmail) {
  if (!Array.isArray(updates) || updates.length > 1000) throw new OrderError("INVALID_ADMIN_UPDATE", "Product updates are invalid.");
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Products");
  const rows = sheet.getDataRange().getValues();
  const idCol = rows[0].indexOf("id");
  const priceCol = rows[0].indexOf("price");
  const typeCol = rows[0].indexOf("type");
  const idToRow = {};
  for (let i = 1; i < rows.length; i++) idToRow[rows[i][idCol]] = i + 1; // 1-indexed sheet row
  const before = updates.map(u => ({ id: u?.id, price: rows[idToRow[u?.id] - 1]?.[priceCol], type: rows[idToRow[u?.id] - 1]?.[typeCol] }));

  updates.forEach(u => {
    if (!u || typeof u.id !== "string") throw new OrderError("INVALID_ADMIN_UPDATE", "A product update is invalid.");
    if (u.price != null && (!Number.isFinite(Number(u.price)) || Number(u.price) < 0)) throw new OrderError("INVALID_ADMIN_UPDATE", "A product price is invalid.");
    if (u.type != null && PRODUCT_TYPES.indexOf(String(u.type)) === -1) throw new OrderError("INVALID_ADMIN_UPDATE", "A product type is invalid.");
    const row = idToRow[u.id];
    if (!row) return;
    if (u.price != null) sheet.getRange(row, priceCol + 1).setValue(u.price);
    if (u.type && typeCol > -1) sheet.getRange(row, typeCol + 1).setValue(u.type);
  });
  logAudit(adminEmail, "priceUpdate", "Product", updates.map(u => u.id).join(","), before, updates, "success");
}

// Settings sheet is just key/value rows — read them into a flat object,
// coercing "true"/"false" text and numeric strings back to real types.
function getSettings() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Settings");
  if (!sheet) return Object.assign({}, PAYMENT_DISPLAY_DEFAULTS, PUSH_SETTINGS_DEFAULTS);
  const rows = sheet.getDataRange().getValues();
  rows.shift(); // header row: key | value
  const out = Object.assign({}, PAYMENT_DISPLAY_DEFAULTS, PUSH_SETTINGS_DEFAULTS);
  rows.forEach(r => {
    if (!r[0]) return;
    let v = r[1];
    if (v === true || v === "TRUE" || v === "true") v = true;
    else if (v === false || v === "FALSE" || v === "false") v = false;
    else if (!isNaN(v) && v !== "") v = Number(v);
    out[r[0]] = v;
  });
  return out;
}

function updateSettings(rules, adminEmail) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new OrderError("INVALID_ADMIN_UPDATE", "Store settings are invalid.");
  const allowedKeys = ["FREE_DELIVERY_THRESHOLD", "ADVANCE_DELIVERY_FEE", "COD_DELIVERY_FEE", "COD_ALLOWED", "CUSTOMIZED_REQUIRES_FULL_ADVANCE", "SPLIT_ADVANCE_PERCENT", "MIN_PARTIAL_ADVANCE"].concat(PAYMENT_DISPLAY_KEYS).concat(Object.keys(PUSH_SETTINGS_DEFAULTS));
  Object.keys(rules).forEach(key => {
    if (allowedKeys.indexOf(key) === -1) throw new OrderError("INVALID_ADMIN_UPDATE", "A store setting is not allowed.");
  });
  rules = Object.assign({}, rules);
  rules.CUSTOMIZED_REQUIRES_FULL_ADVANCE = true;
  if ("SPLIT_ADVANCE_PERCENT" in rules) {
    rules.SPLIT_ADVANCE_PERCENT = Number(rules.SPLIT_ADVANCE_PERCENT);
    if (!Number.isInteger(rules.SPLIT_ADVANCE_PERCENT) || rules.SPLIT_ADVANCE_PERCENT < 1 || rules.SPLIT_ADVANCE_PERCENT > 99) throw new OrderError("INVALID_ADMIN_UPDATE", "SPLIT_ADVANCE_PERCENT must be an integer from 1 to 99.");
  }
  if ("MIN_PARTIAL_ADVANCE" in rules) {
    rules.MIN_PARTIAL_ADVANCE = Number(rules.MIN_PARTIAL_ADVANCE);
    if (!Number.isInteger(rules.MIN_PARTIAL_ADVANCE) || rules.MIN_PARTIAL_ADVANCE < 1 || rules.MIN_PARTIAL_ADVANCE > 100000) throw new OrderError("INVALID_ADMIN_UPDATE", "MIN_PARTIAL_ADVANCE must be a whole number from 1 to 100000.");
  }
  if ("MAX_PUSH_PER_DAY" in rules) {
    rules.MAX_PUSH_PER_DAY = Number(rules.MAX_PUSH_PER_DAY);
    if (!Number.isInteger(rules.MAX_PUSH_PER_DAY) || rules.MAX_PUSH_PER_DAY < 0 || rules.MAX_PUSH_PER_DAY > 10) throw new OrderError("INVALID_ADMIN_UPDATE", "MAX_PUSH_PER_DAY must be a whole number from 0 to 10.");
  }
  if ("MAX_PUSH_PER_WEEK" in rules) {
    rules.MAX_PUSH_PER_WEEK = Number(rules.MAX_PUSH_PER_WEEK);
    if (!Number.isInteger(rules.MAX_PUSH_PER_WEEK) || rules.MAX_PUSH_PER_WEEK < 0 || rules.MAX_PUSH_PER_WEEK > 30) throw new OrderError("INVALID_ADMIN_UPDATE", "MAX_PUSH_PER_WEEK must be a whole number from 0 to 30.");
  }
  if ("QUIET_HOURS_START" in rules && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(rules.QUIET_HOURS_START))) throw new OrderError("INVALID_ADMIN_UPDATE", "QUIET_HOURS_START must be HH:MM (24h).");
  if ("QUIET_HOURS_END" in rules && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(rules.QUIET_HOURS_END))) throw new OrderError("INVALID_ADMIN_UPDATE", "QUIET_HOURS_END must be HH:MM (24h).");
  PAYMENT_DISPLAY_KEYS.forEach(key => {
    if (!(key in rules)) return;
    if (key.endsWith("_ENABLED") && typeof rules[key] !== "boolean") throw new OrderError("INVALID_ADMIN_UPDATE", key + " must be true or false.");
    if (!key.endsWith("_ENABLED") && String(rules[key] || "").length > 500) throw new OrderError("INVALID_ADMIN_UPDATE", key + " is too long.");
    if (key.endsWith("_QR_URL") && rules[key] && !/^https?:\/\//i.test(String(rules[key]))) throw new OrderError("INVALID_ADMIN_UPDATE", key + " must be an http(s) image URL.");
  });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Settings");
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  const keyToRow = {};
  const beforeSettings = {};
  for (let i = 1; i < rows.length; i++) keyToRow[rows[i][0]] = i + 1;
  Object.keys(rules).forEach(key => { const row = keyToRow[key]; beforeSettings[key] = row ? rows[row - 1][1] : null; });

  Object.keys(rules).forEach(key => {
    const row = keyToRow[key];
    if (row) sheet.getRange(row, 2).setValue(rules[key]);
    else sheet.appendRow([key, rules[key]]);
  });
  logAudit(adminEmail, "settingsUpdate", "Settings", Object.keys(rules).join(","), beforeSettings, rules, "success");
}

function readAdminResource(resource, limit) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
  if (resource === "orders") return { ok: true, resource: resource, items: readAdminOrders(boundedLimit) };
  if (resource === "contacts") return { ok: true, resource: resource, items: readAdminRows("Contact", boundedLimit) };
  if (resource === "audit") return { ok: true, resource: resource, items: readAdminRows("AuditLog", boundedLimit) };
  if (resource === "settings") return { ok: true, resource: resource, settings: getSettings() };
  if (resource === "dashboard") return { ok: true, resource: resource, summary: buildAdminDashboard(boundedLimit) };
  if (resource === "leads") return { ok: true, resource: resource, items: readAdminRows("Leads", boundedLimit) };
  if (resource === "pushSubscriptions") return { ok: true, resource: resource, items: readPushSubscriptionsSafe(boundedLimit) };
  if (resource === "pushCampaigns") return { ok: true, resource: resource, items: readAdminRows("PushCampaigns", boundedLimit) };
  if (resource === "pushDashboard") return { ok: true, resource: resource, summary: buildPushDashboard() };
  throw new OrderError("INVALID_ADMIN_READ", "The requested admin resource is not available.");
}

function readAdminRows(sheetName, limit) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values.shift();
  return values.reverse().slice(0, limit).map(row => {
    const item = {};
    headers.forEach((header, index) => { item[header] = row[index] instanceof Date ? row[index].toISOString() : row[index]; });
    return item;
  });
}

function readAdminOrders(limit) {
  return readAdminRows("Orders", limit).map(order => {
    const rawItems = order.items;
    try {
      const snapshot = JSON.parse(String(rawItems || "[]"));
      order.items = Array.isArray(snapshot) ? snapshot : snapshot.items || [];
    } catch (error) { order.items = []; }
    delete order.idempotencyFingerprint;
    order.paymentStatus = derivePaymentStatus(order.paymentMethod, order.gatewayStatus || "");
    order.orderStatus = order.orderStatus || "New";
    return order;
  });
}

function buildAdminDashboard(limit) {
  const orders = readAdminOrders(Math.min(limit, 250));
  const today = new Date().toISOString().slice(0, 10);
  const summary = {
    totalProducts: getProducts().length,
    activeProducts: getProducts().filter(product => String(product.active || "").trim() !== "false").length,
    suspendedProducts: getProducts().filter(product => String(product.active || "").trim().toLowerCase() === "false").length,
    ordersToday: orders.filter(order => String(order.timestamp || "").slice(0, 10) === today).length,
    pendingOrders: orders.filter(order => ["New", "Pending Payment", "Payment Verification"].indexOf(order.orderStatus) !== -1).length,
    paymentVerificationPending: orders.filter(order => order.paymentStatus === "Payment Verification").length,
    codDue: orders.filter(order => order.paymentStatus === "COD Due").length,
    revenue: orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
    recentOrders: orders.slice(0, 10)
  };
  return summary;
}

// Admin never sees the raw endpoint/keys, even though they're stored
// server-side for eventual sending -- "do not expose endpoints/tokens
// publicly" applies to the Admin UI too, not just anonymous access.
// Safe failure visibility (HS-20260819-09): the most recent push_failed/
// push_expired/test_sent event's classification code + HTTP status per
// visitor, so Super Admin can see WHY a send failed without ever exposing
// endpoint/p256dh/authKey/secrets. Never guesses -- absent if no such
// event exists yet for that visitor.
function lastPushFailureByVisitor() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushEvents");
  const out = {};
  if (!sheet) return out;
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return out;
  const h = rows[0];
  const tsCol = h.indexOf("timestamp"), vCol = h.indexOf("visitorId"), typeCol = h.indexOf("eventType"), metaCol = h.indexOf("metadata");
  const relevant = ["push_failed", "push_expired", "test_sent"];
  for (let i = 1; i < rows.length; i++) {
    const type = String(rows[i][typeCol]);
    if (relevant.indexOf(type) === -1) continue;
    const vid = String(rows[i][vCol] || "");
    if (!vid) continue;
    let meta = {};
    try { meta = JSON.parse(rows[i][metaCol] || "{}"); } catch (e) { /* ignore malformed */ }
    if (!meta.code) continue; // pre-HS-09 events have no safe code recorded
    const existing = out[vid];
    if (!existing || new Date(rows[i][tsCol]) > new Date(existing.timestamp)) {
      out[vid] = { code: meta.code, httpStatus: meta.httpStatus, timestamp: rows[i][tsCol], eventType: type };
    }
  }
  return out;
}

function readPushSubscriptionsSafe(limit) {
  const failures = lastPushFailureByVisitor();
  return readAdminRows("PushSubscriptions", limit).map(row => {
    const clean = Object.assign({}, row);
    delete clean.endpoint;
    delete clean.p256dh;
    delete clean.authKey;
    const f = failures[row.visitorId];
    if (f) clean.lastFailure = f.code + (f.httpStatus ? " (HTTP " + f.httpStatus + ")" : "");
    return clean;
  });
}

function buildPushDashboard() {
  const subs = readAdminRows("PushSubscriptions", 5000);
  const events = readAdminRows("PushEvents", 5000);
  const campaigns = readAdminRows("PushCampaigns", 500);
  const countBy = (arr, key, value) => arr.filter(r => String(r[key]) === value).length;
  const promptImpressions = countBy(events, "eventType", "prompt_view");
  const granted = countBy(subs, "permissionStatus", "granted");
  const denied = countBy(subs, "permissionStatus", "denied");
  const defaultCount = countBy(subs, "permissionStatus", "default");
  const eligibleVisitors = new Set(events.map(e => e.visitorId).concat(subs.map(s => s.visitorId))).size;
  return {
    eligibleVisitors: eligibleVisitors,
    promptImpressions: promptImpressions,
    enableClicks: countBy(events, "eventType", "soft_accept_click"),
    permissionGranted: granted,
    permissionDenied: denied,
    permissionDefault: defaultCount,
    activeSubscribers: countBy(subs, "subscriptionStatus", "active"),
    unsubscribed: countBy(subs, "subscriptionStatus", "unsubscribed"),
    expiredSubscriptions: countBy(subs, "subscriptionStatus", "expired"),
    optInRate: promptImpressions > 0 ? Math.round((granted / promptImpressions) * 1000) / 10 : 0,
    campaigns: campaigns.length,
    pushAttempted: campaigns.reduce((s, c) => s + (Number(c.attempted) || 0), 0),
    pushAccepted: campaigns.reduce((s, c) => s + (Number(c.accepted) || 0), 0),
    pushFailed: campaigns.reduce((s, c) => s + (Number(c.failed) || 0), 0),
    pushClicked: campaigns.reduce((s, c) => s + (Number(c.clicked) || 0), 0),
    recoveredLeads: campaigns.reduce((s, c) => s + (Number(c.recoveredLeads) || 0), 0),
    recoveredOrders: campaigns.reduce((s, c) => s + (Number(c.recoveredOrders) || 0), 0),
    recoveredRevenue: campaigns.reduce((s, c) => s + (Number(c.recoveredRevenue) || 0), 0)
  };
}

function logAudit(adminEmail, action, entityType, entityId, before, after, result) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("AuditLog");
  if (!sheet) return;
  sheet.appendRow([
    new Date().toISOString(), safeSheetText(adminEmail || ""), safeSheetText(action),
    safeSheetText(entityType), safeSheetText(entityId), safeSheetText(JSON.stringify(before || {})),
    safeSheetText(JSON.stringify(after || {})), safeSheetText(result || "success")
  ]);
}

function logOrder(o) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Orders");
  sheet.appendRow([
    o.createdAt, o.orderId,
    safeSheetText(o.customer.name), safeSheetText(o.customer.phone),
    safeSheetText(o.customer.address), safeSheetText(o.customer.city),
    safeSheetText(o.customer.postal), safeSheetText(o.customer.notes),
    o.paymentMethod, o.advanceMethod, safeSheetText(o.transactionReference),
    JSON.stringify({ fingerprint: o.idempotencyFingerprint, items: o.items }), o.subtotal, o.deliveryFee, o.total,
    o.payNow, o.codDue,
    // Additive (HS-20260820-01, schema v8) -- empty string for every
    // non-gateway order, exactly like payNow/codDue's own additive rollout.
    safeSheetText(o.paymentGateway || ""), safeSheetText(o.gatewayOrderId || ""),
    safeSheetText(o.gatewayTransactionId || ""), safeSheetText(o.gatewayStatus || ""),
    safeSheetText(o.gatewayUpdatedAt || ""), safeSheetText(o.paidAt || "")
  ]);
}

function logLoadTestOrder(o) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LoadTestOrders");
  if (!sheet) throw new OrderError("LOAD_TEST_SHEET_MISSING", "The LoadTestOrders sheet is not configured.");
  sheet.appendRow([
    o.createdAt, safeSheetText(o.testRunId), o.sequence, o.orderId, safeSheetText(o.idempotencyKey),
    o.paymentMethod, safeSheetText(o.advanceMethod), JSON.stringify({ fingerprint: o.idempotencyFingerprint, items: o.items, response: o }),
    o.subtotal, o.deliveryFee, o.total, o.payNow, o.codDue, "accepted", safeSheetText(o.idempotencyFingerprint),
    o.processingMs, ""
  ]);
}

function findMatchingOrder(orderId, fingerprint, sheetName) {
  const order = sheetName === "LoadTestOrders"
    ? findLoadTestOrderById(orderId)
    : findOrderById(orderId);
  if (!order) return null;
  if (!order.idempotencyFingerprint) return null;
  if (order.idempotencyFingerprint !== fingerprint) {
    throw new OrderError("IDEMPOTENCY_CONFLICT", "This order request key was already used for different order details.");
  }
  delete order.idempotencyFingerprint;
  return order;
}

function findLoadTestOrderById(orderId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LoadTestOrders");
  if (!sheet) return null;
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return null;
  const headers = rows[0];
  const orderIdColumn = headers.indexOf("orderId");
  const itemsColumn = headers.indexOf("items");
  if (orderIdColumn < 0 || itemsColumn < 0) throw new OrderError("INVALID_LOAD_TEST_SHEET", "The LoadTestOrders sheet is missing required columns.");
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][orderIdColumn]) !== orderId) continue;
    try {
      const snapshot = JSON.parse(String(rows[i][itemsColumn] || "{}"));
      return snapshot.response || null;
    } catch (error) {
      throw new OrderError("INVALID_LOAD_TEST_RECORD", "The load-test order record is invalid.");
    }
  }
  return null;
}

function findOrderById(orderId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Orders");
  if (!sheet) return null;
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return null;
  const headers = rows[0];
  const orderIdColumn = headers.indexOf("orderId");
  if (orderIdColumn < 0) throw new OrderError("INVALID_ORDERS_SHEET", "The Orders sheet is missing the orderId column.");
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][orderIdColumn]) === orderId) return restoreOrder(headers, rows[i]);
  }
  return null;
}

function restoreOrder(headers, row) {
  const value = key => row[headers.indexOf(key)];
  let snapshot;
  try {
    snapshot = JSON.parse(String(value("items") || "[]"));
  } catch (error) {
    throw new OrderError("INVALID_ORDER_RECORD", "The original order record could not be restored.");
  }
  const items = Array.isArray(snapshot) ? snapshot : snapshot.items;
  const fingerprint = Array.isArray(snapshot) ? "" : String(snapshot.fingerprint || "");
  if (!Array.isArray(items)) throw new OrderError("INVALID_ORDER_RECORD", "The original order items are invalid.");
  const paymentMethod = String(value("paymentMethod"));
  const total = Number(value("total"));
  // payNow/codDue are additive columns; older rows written before the
  // schema migration derive the same values from paymentMethod + total so
  // idempotent replay of a pre-migration order still returns a consistent
  // amount breakdown.
  const hasPayNowColumn = headers.indexOf("payNow") !== -1;
  const payNow = hasPayNowColumn && value("payNow") !== "" && value("payNow") != null
    ? Number(value("payNow"))
    : (paymentMethod === "Cash on Delivery" ? 0 : total);
  const codDue = hasPayNowColumn && value("codDue") !== "" && value("codDue") != null
    ? Number(value("codDue"))
    : (paymentMethod === "Cash on Delivery" ? total : 0);
  return {
    ok: true,
    orderId: String(value("orderId")),
    createdAt: value("timestamp") instanceof Date ? value("timestamp").toISOString() : String(value("timestamp")),
    customer: {
      name: restoreSheetText(value("name")),
      phone: restoreSheetText(value("phone")),
      address: restoreSheetText(value("address")),
      city: restoreSheetText(value("city")),
      postal: restoreSheetText(value("postal")),
      notes: restoreSheetText(value("notes"))
    },
    paymentMethod: paymentMethod,
    advanceMethod: String(value("advanceMethod") || ""),
    transactionReference: restoreSheetText(value("transactionRef")),
    // Additive columns (schema v8) -- missing entirely on pre-HS-20260820-01
    // rows, which restoreSheetText/String both treat as "" safely.
    paymentGateway: String(value("paymentGateway") || ""),
    gatewayOrderId: String(value("gatewayOrderId") || ""),
    gatewayTransactionId: restoreSheetText(value("gatewayTransactionId")),
    gatewayStatus: String(value("gatewayStatus") || ""),
    gatewayUpdatedAt: String(value("gatewayUpdatedAt") || ""),
    paidAt: String(value("paidAt") || ""),
    paymentStatus: derivePaymentStatus(paymentMethod, String(value("gatewayStatus") || "")),
    idempotencyFingerprint: fingerprint,
    items: items,
    subtotal: Number(value("subtotal")),
    deliveryFee: Number(value("deliveryFee")),
    total: total,
    payNow: payNow,
    codDue: codDue
  };
}

// A gateway order's true paymentStatus tracks gatewayStatus, not just
// paymentMethod (HS-20260820-01) -- so an idempotent replay of an
// already-paid APG order reports "Paid", not a stale "Payment Verification".
function derivePaymentStatus(paymentMethod, gatewayStatus) {
  if (paymentMethod === "Cash on Delivery") return "COD Due";
  if (!gatewayStatus) return "Payment Verification";
  if (gatewayStatus === "PAID") return "Paid";
  if (gatewayStatus === "FAILED" || gatewayStatus === "CANCELLED") return "Payment Failed";
  if (gatewayStatus === "UNKNOWN") return "Payment Verification";
  return "Gateway Pending"; // PENDING
}

function safeSheetText(value) {
  const text = String(value == null ? "" : value);
  return /^\s*[=+\-@]/.test(text) ? "'" + text : text;
}

function restoreSheetText(value) {
  const text = String(value == null ? "" : value);
  return /^'\s*[=+\-@]/.test(text) ? text.slice(1) : text;
}

function logContact(c) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Contact");
  const name = requiredText(c.name, "Contact name", 2, 80);
  const phone = normalizePakistanMobile(c.phone);
  const message = requiredText(c.message, "Contact message", 1, 1000);
  sheet.appendRow([new Date().toISOString(), safeSheetText(name), safeSheetText(phone), safeSheetText(message)]);
}

// ══════════════ Checkout Leads + Meta CAPI (HS-20260819-02) ══════════════
// Post-launch conversion module, entirely additive: a new "Leads" sheet
// (self-healing -- created with headers on first use so no manual Sheet
// migration is required) plus server-side Meta Conversions API calls for
// Lead and Purchase. Never touches Orders/OrderItems/pricing/idempotency.
const LEAD_HEADERS = [
  "leadId", "createdAt", "updatedAt", "status", "fullName", "phone", "address",
  "city", "postalCode", "notes", "cartJson", "itemsSubtotal", "estimatedOrderTotal",
  "eligiblePaymentModes", "utmSource", "fbp", "fbc", "lastStep", "abandonReason", "convertedOrderId",
  "visitorId"
];
const LEAD_ABANDON_STATUSES = ["PAYMENT_ABANDONED", "COD_REQUESTED", "CALLBACK_REQUESTED"];

// ══════════════ Web Push (HS-20260819-03) ══════════════
const PUSH_SUB_HEADERS = [
  "subscriptionId", "visitorId", "endpoint", "p256dh", "authKey", "permissionStatus",
  "subscriptionStatus", "createdAt", "updatedAt", "lastSeenAt", "browserInfo", "deviceInfo",
  "utmSource", "lastPushAt", "clickCount", "linkedLeadId", "linkedOrderId"
];
const PUSH_CAMPAIGN_HEADERS = [
  "campaignId", "title", "body", "targetUrl", "imageUrl", "audience", "offerType", "status",
  "createdAt", "scheduledAt", "sentAt", "expiryAt", "attempted", "accepted", "failed", "clicked",
  "recoveredLeads", "recoveredOrders", "recoveredRevenue", "createdBy"
];
const PUSH_EVENT_HEADERS = ["timestamp", "visitorId", "campaignId", "eventType", "metadata"];
const PUSH_EVENT_TYPES = [
  "prompt_view", "soft_accept_click", "soft_close", "native_granted", "native_denied",
  "native_default", "subscribed", "unsubscribed", "notification_click",
  "push_sent", "push_expired", "push_failed", "test_sent"
];
// "Sent" was renamed "Completed" (HS-20260819-06) to match the real
// campaign lifecycle -- no campaign had ever reached that state before
// this task (send was fail-closed), so this is a safe rename, not a
// migration. "Partially Failed" added for a batch with a mix of
// accepted/failed subscriptions.
const PUSH_CAMPAIGN_STATUSES = ["Draft", "Scheduled", "Sending", "Paused", "Completed", "Partially Failed", "Failed", "Expired"];
const PUSH_AUDIENCES = [
  "all_active", "cart_abandoned", "lead_not_converted", "cod_requested",
  "interest_vegetables", "interest_flowers", "interest_mix", "interest_fertilizer", "previous_buyers"
];
// Only these two segments have a real, honest data linkage today (Leads
// rows carry visitorId + status/abandonReason, HS-20260819-06). The rest
// stay valid, editable campaign-form choices for forward-compatibility,
// but sendPushCampaign refuses to send to them rather than silently
// falling back to "everyone" or "nobody" -- see docs/PROJECT_STATE.md.
const PUSH_AUDIENCES_WITH_REAL_SEGMENT = ["all_active", "cart_abandoned", "cod_requested"];
// Frequency/quiet-hours defaults (HS-20260819-06) -- Asia/Karachi is fixed,
// not admin-editable (a single-market store; adding a timezone picker
// would be unused surface). Everything else is editable via Settings.
const PUSH_SETTINGS_DEFAULTS = {
  MAX_PUSH_PER_DAY: 1,
  MAX_PUSH_PER_WEEK: 3,
  QUIET_HOURS_START: "21:00",
  QUIET_HOURS_END: "08:00"
};
const PUSH_TIMEZONE = "Asia/Karachi";
const PUSH_SEND_BATCH_SIZE = 30; // bounded per Apps Script execution -- see sendPushCampaign
// Public Pixel/Dataset ID -- not a secret, already shipped client-side in
// js/config.js. Only the CAPI access token (Script Property) is sensitive.
const META_PIXEL_ID = "1467679375059082";

function ensureLeadsSheet() { return ensureSheetWithHeaders("Leads", LEAD_HEADERS); }

// Generic self-healing sheet helper, reused by Leads and the Push* sheets
// (HS-20260819-03) -- creates the tab with its header row on first use so
// no manual Sheet migration is ever required.
function ensureSheetWithHeaders(title, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(title);
  if (!sheet) {
    sheet = ss.insertSheet(title);
    sheet.appendRow(headers);
  }
  return sheet;
}

function findLeadRow(sheet, leadId) { return findRowById(sheet, "leadId", leadId); }

// Generic linear scan by ID column -- fine at the row counts these sheets
// realistically reach (subscriptions/leads/campaigns), consistent with the
// existing findOrderById pattern elsewhere in this file.
function findRowById(sheet, idColumn, idValue) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return null;
  const headers = rows[0];
  const idCol = headers.indexOf(idColumn);
  if (idCol < 0) return null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === idValue) return { rowIndex: i + 1, headers: headers, row: rows[i] };
  }
  return null;
}

// Lead is intentionally lenient about cart contents (a customer may reach
// Confirm Delivery with any cart state) -- unlike buildAuthoritativeOrder,
// an invalid/empty item is skipped rather than rejected, since a Lead must
// never block on catalog drift. Only real contact-detail validation
// (reused from the exact same order-validation helpers) can fail this.
function saveLead(payload) {
  const leadId = requiredText(payload.leadId, "Lead ID", 16, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(leadId)) throw new OrderError("INVALID_LEAD_ID", "The checkout session ID is invalid.");

  const customerInput = payload.customer || {};
  const fullName = requiredText(customerInput.name, "Name", 2, 80);
  const phone = normalizePakistanMobile(customerInput.phone);
  const address = requiredText(customerInput.address, "Address", 10, 300);
  const city = requiredText(customerInput.city, "City", 2, 80);
  const postal = optionalText(customerInput.postal, "Postal code", 20);
  const notes = optionalText(customerInput.notes, "Order notes", 500);

  const products = getProducts();
  const productsById = {};
  products.forEach(p => productsById[String(p.id)] = p);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const cartLines = [];
  let itemsSubtotal = 0;
  items.forEach(item => {
    const product = item && productsById[String(item.productId)];
    const quantity = Number(item && item.quantity);
    if (!product || !Number.isInteger(quantity) || quantity <= 0) return; // skip silently, never block a Lead
    const unitPrice = Number(product.price) || 0;
    itemsSubtotal += unitPrice * quantity;
    cartLines.push({ productId: String(product.id), quantity: quantity, unitPrice: unitPrice });
  });
  const cartPolicy = cartLines.length ? cartPaymentPolicy(cartLines.map(l => ({ productId: l.productId }))) : "";
  let settings;
  try { settings = getOrderSettings(); } catch (e) { settings = ORDER_DEFAULT_RULES; }
  const estimatedDeliveryFee = cartPolicy === "cod" ? Number(settings.COD_DELIVERY_FEE) || 0
    : (itemsSubtotal >= Number(settings.FREE_DELIVERY_THRESHOLD) ? 0 : Number(settings.ADVANCE_DELIVERY_FEE) || 0);
  const estimatedOrderTotal = itemsSubtotal + estimatedDeliveryFee;
  const eligiblePaymentModes = cartPolicy === "advance_only" ? "Advance Payment"
    : cartPolicy === "advance_or_split" ? "Advance Payment, Split Payment"
    : "Cash on Delivery, Advance Payment, Split Payment";

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new OrderError("LEAD_BUSY", "Please try again in a moment.");
  let isNew = true;
  let status = "NEW";
  try {
    const sheet = ensureLeadsSheet();
    const existing = findLeadRow(sheet, leadId);
    const now = new Date().toISOString();
    // Optional, additive (HS-20260819-06): the same PushGrowth.visitorId()
    // already sent with every Lead save, now actually stored so a Lead can
    // be matched back to a push subscription for Cart Abandoned / COD
    // Requested campaign audiences. Never required, never blocks a Lead.
    const visitorId = /^[A-Za-z0-9_-]{0,100}$/.test(String(payload.visitorId || "")) ? String(payload.visitorId || "") : "";
    if (existing) {
      isNew = false;
      // A duplicate Confirm Delivery updates the same row -- never
      // downgrades a further-along status (e.g. a stray resubmit after the
      // customer already converted to an order keeps ORDER_CONVERTED).
      const currentStatus = String(existing.row[existing.headers.indexOf("status")] || "NEW");
      status = (currentStatus === "ORDER_CONVERTED") ? currentStatus : "NEW";
      const values = [[
        leadId, existing.row[existing.headers.indexOf("createdAt")], now, status,
        safeSheetText(fullName), safeSheetText(phone), safeSheetText(address), safeSheetText(city),
        safeSheetText(postal), safeSheetText(notes), JSON.stringify(cartLines), itemsSubtotal, estimatedOrderTotal,
        eligiblePaymentModes, safeSheetText(optionalText(payload.utmSource, "UTM source", 200)),
        safeSheetText(optionalText(payload.fbp, "fbp", 200)), safeSheetText(optionalText(payload.fbc, "fbc", 200)),
        "delivery", existing.row[existing.headers.indexOf("abandonReason")], existing.row[existing.headers.indexOf("convertedOrderId")],
        visitorId || existing.row[existing.headers.indexOf("visitorId")] || ""
      ]];
      sheet.getRange(existing.rowIndex, 1, 1, LEAD_HEADERS.length).setValues(values);
    } else {
      sheet.appendRow([
        leadId, now, now, status,
        safeSheetText(fullName), safeSheetText(phone), safeSheetText(address), safeSheetText(city),
        safeSheetText(postal), safeSheetText(notes), JSON.stringify(cartLines), itemsSubtotal, estimatedOrderTotal,
        eligiblePaymentModes, safeSheetText(optionalText(payload.utmSource, "UTM source", 200)),
        safeSheetText(optionalText(payload.fbp, "fbp", 200)), safeSheetText(optionalText(payload.fbc, "fbc", 200)),
        "delivery", "", "", visitorId
      ]);
    }
  } finally {
    lock.releaseLock();
  }

  // HS-20260820-02: CAPI Lead + push attribution moved OUT of this
  // response's critical path -- DevTools-traced evidence showed this
  // single saveLead round trip taking ~4.85s of the customer's ~5.6s
  // "stuck" Confirm Delivery click, and code inspection confirmed why:
  // sendMetaCapiEvent is a real synchronous UrlFetchApp.fetch to Meta's
  // Graph API (1-4s+ from Apps Script's network stack), plus
  // attributePushConversion did a full PushEvents sheet scan, both
  // previously running before this function could return at all. The
  // Lead row itself is already durably committed above by this point --
  // everything below is genuinely non-critical attribution/analytics
  // work with no bearing on whether the customer can proceed to Payment.
  // The client now fires this as a separate, non-awaited follow-up
  // request (type: "leadAttribution") right after receiving THIS
  // response, so the customer's wait is only ever for the essential
  // write. Same CAPI contract, same event_id, same dedup guarantee --
  // only the timing changed, never weakened.
  return { ok: true, leadId: leadId, status: status, isNew: isNew };
}

// The CAPI Lead event + push attribution, split out of saveLead
// (HS-20260820-02) so the customer's Confirm Delivery click never waits
// on them. Fired by the client as a separate, non-awaited request
// immediately after a successful saveLead response -- never blocks
// checkout, never re-validates/re-writes the Lead row itself (that
// already happened, durably, in saveLead). Recomputes cartLines/
// itemsSubtotal from the same items+products inputs since this is a
// fresh request with no server-side memory of the prior call.
function leadAttribution(payload) {
  const leadId = requiredText(payload.leadId, "Lead ID", 16, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(leadId)) throw new OrderError("INVALID_LEAD_ID", "The checkout session ID is invalid.");
  const customerInput = payload.customer || {};
  let phone = "", city = "";
  try { phone = normalizePakistanMobile(customerInput.phone); } catch (e) { /* best-effort -- CAPI just omits ph */ }
  try { city = requiredText(customerInput.city, "City", 2, 80); } catch (e) { city = ""; }

  const products = getProducts();
  const productsById = {};
  products.forEach(p => productsById[String(p.id)] = p);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const cartLines = [];
  let itemsSubtotal = 0;
  items.forEach(item => {
    const product = item && productsById[String(item.productId)];
    const quantity = Number(item && item.quantity);
    if (!product || !Number.isInteger(quantity) || quantity <= 0) return;
    itemsSubtotal += (Number(product.price) || 0) * quantity;
    cartLines.push({ productId: String(product.id) });
  });

  const capi = phone ? sendMetaCapiEvent("Lead", "LEAD-" + leadId, {
    ph: [sha256Hex(phone)],
    ct: city ? [sha256Hex(city.toLowerCase())] : undefined,
    country: [sha256Hex("pk")],
    client_user_agent: optionalText(payload.userAgent, "User agent", 300) || undefined,
    fbp: optionalText(payload.fbp, "fbp", 200) || undefined,
    fbc: optionalText(payload.fbc, "fbc", 200) || undefined
  }, {
    currency: "PKR",
    value: itemsSubtotal,
    content_ids: cartLines.map(l => l.productId),
    num_items: cartLines.length,
    eventSourceUrl: optionalText(payload.pageUrl, "Page URL", 300) || "https://www.hojaseeds.pk/"
  }) : { ok: false, skipped: true };
  try { attributePushConversion(payload.visitorId, "lead", leadId); } catch (e) { console.error(e); }
  return { ok: true, capi: capi.ok };
}

// Best-effort, non-authenticated (same trust level as saveLead -- this is
// abandonment telemetry, not a security boundary). Never creates a lead,
// never throws: a missing/unknown leadId simply reports updated:false so
// the frontend never blocks navigation on this call.
function updateLeadStatus(payload) {
  const leadId = requiredText(payload.leadId, "Lead ID", 16, 100);
  const status = String(payload.status || "");
  if (LEAD_ABANDON_STATUSES.indexOf(status) === -1) throw new OrderError("INVALID_LEAD_STATUS", "That checkout status is not recognized.");
  const abandonReason = optionalText(payload.abandonReason, "Abandon reason", 200);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: true, updated: false };
  try {
    const sheet = ensureLeadsSheet();
    const existing = findLeadRow(sheet, leadId);
    if (!existing) return { ok: true, updated: false };
    const statusCol = existing.headers.indexOf("status") + 1;
    const updatedAtCol = existing.headers.indexOf("updatedAt") + 1;
    const reasonCol = existing.headers.indexOf("abandonReason") + 1;
    const currentStatus = String(existing.row[statusCol - 1] || "");
    if (currentStatus !== "ORDER_CONVERTED") sheet.getRange(existing.rowIndex, statusCol).setValue(status);
    sheet.getRange(existing.rowIndex, updatedAtCol).setValue(new Date().toISOString());
    if (abandonReason) sheet.getRange(existing.rowIndex, reasonCol).setValue(safeSheetText(abandonReason));
    return { ok: true, updated: true };
  } finally {
    lock.releaseLock();
  }
}

// Called from submitOrder() only after logOrder() has durably succeeded.
// Best-effort: any failure here is caught by the caller and never affects
// the order response already returned to the customer.
function convertLeadOnOrder(leadId, order, payload) {
  if (leadId) {
    const cleanLeadId = String(leadId);
    if (/^[A-Za-z0-9_-]{16,100}$/.test(cleanLeadId)) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(15000)) {
        try {
          const sheet = ensureLeadsSheet();
          const existing = findLeadRow(sheet, cleanLeadId);
          if (existing) {
            const statusCol = existing.headers.indexOf("status") + 1;
            const updatedAtCol = existing.headers.indexOf("updatedAt") + 1;
            const convertedCol = existing.headers.indexOf("convertedOrderId") + 1;
            sheet.getRange(existing.rowIndex, statusCol).setValue("ORDER_CONVERTED");
            sheet.getRange(existing.rowIndex, updatedAtCol).setValue(new Date().toISOString());
            sheet.getRange(existing.rowIndex, convertedCol).setValue(safeSheetText(order.orderId));
          }
        } finally {
          lock.releaseLock();
        }
      }
    }
  }

  try { attributePushConversion(payload && payload.visitorId, "order", order.orderId, order.total); } catch (e) { console.error(e); }

  sendMetaCapiEvent("Purchase", "ORDER-" + order.orderId, {
    ph: [sha256Hex(order.customer.phone)],
    country: [sha256Hex("pk")],
    client_user_agent: optionalText(payload && payload.userAgent, "User agent", 300) || undefined,
    fbp: optionalText(payload && payload.fbp, "fbp", 200) || undefined,
    fbc: optionalText(payload && payload.fbc, "fbc", 200) || undefined
  }, {
    currency: "PKR",
    value: order.total, // full confirmed order total -- never payNow, for COD/Advance/Split alike
    content_ids: order.items.map(i => i.productId),
    content_type: "product",
    num_items: order.items.length,
    eventSourceUrl: optionalText(payload && payload.pageUrl, "Page URL", 300) || "https://www.hojaseeds.pk/"
  });
}

// Fails closed for analytics only: a missing token, network error, or
// non-2xx response is swallowed and reported back as {ok:false} -- it
// never throws, so it can never block lead/order creation.
function sendMetaCapiEvent(eventName, eventId, userData, customData) {
  const token = PropertiesService.getScriptProperties().getProperty("META_CAPI_ACCESS_TOKEN");
  if (!token) return { ok: false, skipped: true };
  try {
    const cleanUserData = {};
    Object.keys(userData || {}).forEach(key => { if (userData[key] !== undefined) cleanUserData[key] = userData[key]; });
    const eventSourceUrl = customData.eventSourceUrl;
    const cleanCustomData = Object.assign({}, customData);
    delete cleanCustomData.eventSourceUrl;
    const body = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: eventSourceUrl,
        user_data: cleanUserData,
        custom_data: cleanCustomData
      }]
    };
    const response = UrlFetchApp.fetch(
      "https://graph.facebook.com/v21.0/" + META_PIXEL_ID + "/events?access_token=" + encodeURIComponent(token),
      { method: "post", contentType: "application/json", payload: JSON.stringify(body), muteHttpExceptions: true }
    );
    const code = response.getResponseCode();
    return { ok: code >= 200 && code < 300, status: code };
  } catch (error) {
    console.error("Meta CAPI send failed: " + error);
    return { ok: false, error: String(error && error.message || error) };
  }
}

// Subscription is upserted by visitorId -- one row per browser/device, not
// per subscribe attempt. Never blocks on Sheet contention as badly as an
// order write would: this is best-effort telemetry the storefront must
// never depend on to keep working.
function savePushSubscription(payload) {
  const visitorId = requiredText(payload.visitorId, "Visitor ID", 16, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(visitorId)) throw new OrderError("INVALID_VISITOR_ID", "The visitor session ID is invalid.");
  const permissionStatus = String(payload.permissionStatus || "default");
  if (["default", "granted", "denied"].indexOf(permissionStatus) === -1) throw new OrderError("INVALID_PERMISSION_STATUS", "Unknown permission status.");
  const sub = payload.subscription || {};
  const endpoint = optionalText(sub.endpoint, "Push endpoint", 500);
  const p256dh = optionalText(sub.p256dh, "Push key", 300);
  const authKey = optionalText(sub.auth, "Push auth secret", 300);
  // subscriptionStatus is derived server-side, never trusted from the
  // client: a real endpoint means active; denied permission always means
  // unsubscribed; granted-with-no-endpoint (no VAPID key configured yet,
  // or the subscribe call itself failed) is recorded honestly as
  // "unavailable" rather than faked as active.
  const subscriptionStatus = permissionStatus === "denied" ? "unsubscribed"
    : (endpoint ? "active" : (permissionStatus === "granted" ? "unavailable" : "none"));

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: true, saved: false };
  try {
    const sheet = ensureSheetWithHeaders("PushSubscriptions", PUSH_SUB_HEADERS);
    const existing = findRowById(sheet, "visitorId", visitorId);
    const now = new Date().toISOString();
    const browserInfo = optionalText(payload.browserInfo, "Browser info", 100);
    const deviceInfo = optionalText(payload.deviceInfo, "Device info", 100);
    const utmSource = optionalText(payload.utmSource, "UTM source", 200);
    if (existing) {
      const h = existing.headers;
      const row = existing.row;
      const values = [[
        row[h.indexOf("subscriptionId")] || ("sub-" + visitorId), visitorId,
        endpoint || row[h.indexOf("endpoint")], p256dh || row[h.indexOf("p256dh")], authKey || row[h.indexOf("authKey")],
        permissionStatus, subscriptionStatus, row[h.indexOf("createdAt")], now, now,
        browserInfo || row[h.indexOf("browserInfo")], deviceInfo || row[h.indexOf("deviceInfo")],
        utmSource || row[h.indexOf("utmSource")], row[h.indexOf("lastPushAt")], row[h.indexOf("clickCount")] || 0,
        row[h.indexOf("linkedLeadId")], row[h.indexOf("linkedOrderId")]
      ]];
      sheet.getRange(existing.rowIndex, 1, 1, PUSH_SUB_HEADERS.length).setValues(values);
    } else {
      sheet.appendRow([
        "sub-" + visitorId, visitorId, endpoint, p256dh, authKey, permissionStatus, subscriptionStatus,
        now, now, now, browserInfo, deviceInfo, utmSource, "", 0, "", ""
      ]);
    }
    return { ok: true, saved: true, subscriptionStatus: subscriptionStatus };
  } finally {
    lock.releaseLock();
  }
}

// Lightweight, best-effort lifecycle telemetry (prompt shown/closed,
// native permission result, notification click). Never throws in a way
// that could surface to the customer -- caller (frontend or the service
// worker) always treats this as fire-and-forget.
function logPushEvent(payload) {
  const visitorId = requiredText(payload.visitorId, "Visitor ID", 16, 100);
  const eventType = String(payload.eventType || "");
  if (PUSH_EVENT_TYPES.indexOf(eventType) === -1) throw new OrderError("INVALID_PUSH_EVENT", "Unknown push event type.");
  const campaignId = optionalText(payload.campaignId, "Campaign ID", 100);
  const metadata = optionalText(JSON.stringify(payload.metadata || {}), "Event metadata", 500);
  const sheet = ensureSheetWithHeaders("PushEvents", PUSH_EVENT_HEADERS);
  sheet.appendRow([new Date().toISOString(), visitorId, campaignId, eventType, safeSheetText(metadata)]);

  if (eventType === "notification_click" && campaignId) {
    // Dedupe (HS-20260819-14): one physical click must be one logical
    // click event. A short CacheService window per (visitor, campaign)
    // absorbs a service-worker fetch retry or a double focus/open call
    // without a full Sheet scan -- cheap and sufficient for this volume,
    // not meant to catch a click a full 10s+ after the first (that's a
    // second real click).
    const dedupeKey = "push_click_" + visitorId + "_" + campaignId;
    const cache = CacheService.getScriptCache();
    if (!cache.get(dedupeKey)) {
      cache.put(dedupeKey, "1", 10);
      try { incrementCampaignCounter(campaignId, "clicked"); } catch (e) { console.error(e); }
      try { linkClickToSubscription(visitorId, campaignId); } catch (e) { console.error(e); }
    }
  }
  return { ok: true };
}

function linkClickToSubscription(visitorId, campaignId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushSubscriptions");
  if (!sheet) return;
  const existing = findRowById(sheet, "visitorId", visitorId);
  if (!existing) return;
  const clickCol = existing.headers.indexOf("clickCount") + 1;
  const current = Number(existing.row[clickCol - 1]) || 0;
  sheet.getRange(existing.rowIndex, clickCol).setValue(current + 1);
}

function incrementCampaignCounter(campaignId, field) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushCampaigns");
  if (!sheet) return;
  const existing = findRowById(sheet, "campaignId", campaignId);
  if (!existing) return;
  const col = existing.headers.indexOf(field) + 1;
  if (col <= 0) return;
  const current = Number(existing.row[col - 1]) || 0;
  sheet.getRange(existing.rowIndex, col).setValue(current + 1);
}

function incrementCampaignRevenue(campaignId, amount) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushCampaigns");
  if (!sheet) return;
  const existing = findRowById(sheet, "campaignId", campaignId);
  if (!existing) return;
  const col = existing.headers.indexOf("recoveredRevenue") + 1;
  if (col <= 0) return;
  const current = Number(existing.row[col - 1]) || 0;
  sheet.getRange(existing.rowIndex, col).setValue(current + (Number(amount) || 0));
}

// Click -> recovered Lead/Order attribution (HS-20260819-03), 72h default
// window: finds this visitor's most recent notification_click, credits
// that campaign, and links the subscription row. Entirely best-effort --
// wrapped by every caller so it can never affect a Lead/Order outcome.
const PUSH_ATTRIBUTION_WINDOW_MS = 72 * 60 * 60 * 1000;
function attributePushConversion(visitorId, kind, refId, revenue) {
  if (!visitorId || !/^[A-Za-z0-9_-]+$/.test(String(visitorId))) return;
  const eventsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushEvents");
  if (!eventsSheet) return;
  const rows = eventsSheet.getDataRange().getValues();
  if (rows.length < 2) return;
  const headers = rows[0];
  const tsCol = headers.indexOf("timestamp"), vCol = headers.indexOf("visitorId"), typeCol = headers.indexOf("eventType"), campCol = headers.indexOf("campaignId");
  const now = Date.now();
  let campaignId = "", latestTs = 0;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][vCol]) !== visitorId || String(rows[i][typeCol]) !== "notification_click") continue;
    const ts = new Date(rows[i][tsCol]).getTime();
    if (now - ts > PUSH_ATTRIBUTION_WINDOW_MS) continue;
    if (ts > latestTs) { latestTs = ts; campaignId = String(rows[i][campCol] || ""); }
  }
  if (!campaignId) return;
  if (kind === "lead") incrementCampaignCounter(campaignId, "recoveredLeads");
  else if (kind === "order") { incrementCampaignCounter(campaignId, "recoveredOrders"); incrementCampaignRevenue(campaignId, revenue); }
  const subSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushSubscriptions");
  if (!subSheet) return;
  const existing = findRowById(subSheet, "visitorId", visitorId);
  if (!existing) return;
  const col = existing.headers.indexOf(kind === "lead" ? "linkedLeadId" : "linkedOrderId") + 1;
  if (col > 0) subSheet.getRange(existing.rowIndex, col).setValue(safeSheetText(refId));
}

// Admin-authored campaigns only (requireAdmin already checked by the
// caller in doPost). Sanitizes title/body to plain text -- a push
// notification body is rendered as text by the OS notification UI, not
// HTML, so stripping tags here also prevents any stored-injection concern
// in the Admin campaign table.
function stripTags(value) { return String(value == null ? "" : value).replace(/<[^>]*>/g, ""); }

function savePushCampaign(campaign, adminEmail) {
  if (!campaign || typeof campaign !== "object") throw new OrderError("INVALID_CAMPAIGN", "Campaign data is invalid.");
  const title = requiredText(stripTags(campaign.title), "Notification title", 3, 65);
  const body = requiredText(stripTags(campaign.body), "Message", 3, 200);
  const targetUrl = requiredText(campaign.targetUrl, "Target URL", 4, 300);
  if (!/^https:\/\/(www\.)?hojaseeds\.pk\//.test(targetUrl)) throw new OrderError("INVALID_TARGET_URL", "Target URL must be a hojaseeds.pk page.");
  const audience = String(campaign.audience || "all_active");
  if (PUSH_AUDIENCES.indexOf(audience) === -1) throw new OrderError("INVALID_AUDIENCE", "Unknown audience segment.");
  const offerType = optionalText(campaign.offerType, "Offer type", 40);
  const imageUrl = optionalText(campaign.imageUrl, "Image URL", 300);
  const status = ["Draft", "Scheduled"].indexOf(campaign.status) !== -1 ? campaign.status : "Draft";
  const scheduledAt = optionalText(campaign.scheduledAt, "Scheduled time", 40);
  const expiryAt = optionalText(campaign.expiryAt, "Expiry time", 40);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new OrderError("PUSH_BUSY", "Please try again in a moment.");
  try {
    const sheet = ensureSheetWithHeaders("PushCampaigns", PUSH_CAMPAIGN_HEADERS);
    const now = new Date().toISOString();
    const campaignId = optionalText(campaign.campaignId, "Campaign ID", 100);
    const existing = campaignId ? findRowById(sheet, "campaignId", campaignId) : null;
    if (existing) {
      const h = existing.headers, row = existing.row;
      sheet.getRange(existing.rowIndex, 1, 1, PUSH_CAMPAIGN_HEADERS.length).setValues([[
        campaignId, safeSheetText(title), safeSheetText(body), targetUrl, imageUrl, audience, offerType, status,
        row[h.indexOf("createdAt")], scheduledAt, row[h.indexOf("sentAt")], expiryAt,
        row[h.indexOf("attempted")] || 0, row[h.indexOf("accepted")] || 0, row[h.indexOf("failed")] || 0, row[h.indexOf("clicked")] || 0,
        row[h.indexOf("recoveredLeads")] || 0, row[h.indexOf("recoveredOrders")] || 0, row[h.indexOf("recoveredRevenue")] || 0,
        row[h.indexOf("createdBy")] || safeSheetText(adminEmail)
      ]]);
      return { ok: true, campaignId: campaignId, status: status };
    }
    const newId = "camp-" + Utilities.getUuid().replace(/-/g, "").slice(0, 16);
    sheet.appendRow([
      newId, safeSheetText(title), safeSheetText(body), targetUrl, imageUrl, audience, offerType, status,
      now, scheduledAt, "", expiryAt, 0, 0, 0, 0, 0, 0, 0, safeSheetText(adminEmail)
    ]);
    return { ok: true, campaignId: newId, status: status };
  } finally {
    lock.releaseLock();
  }
}

// ── Real Web Push sending (HS-20260819-06) ─────────────────────────────
// Apps Script never holds the VAPID private key or does the RFC 8291
// encryption itself -- it calls a small, dedicated Cloudflare Worker
// (worker/hoja-push-worker) that does exactly that, authenticated with a
// shared PUSH_SERVER_SECRET. Apps Script owns everything else: Super
// Admin auth, audience/frequency/quiet-hour rules, dedupe, batching, and
// campaign/subscription bookkeeping. Fails closed with a clear error at
// every stage that isn't configured or safe to proceed -- never fakes a
// send. Bounded to PUSH_SEND_BATCH_SIZE per call so one Send click can
// never blow the 6-minute Apps Script execution limit; a campaign whose
// eligible audience is larger than one batch is left in "Sending" status
// and the admin (or the Admin UI's auto-continue loop) calls Send again
// to process the next batch. There is no automatic time-driven scheduler
// for "Scheduled" campaigns -- see docs/PROJECT_STATE.md.
// Server-side single-flight guard (HS-20260819-13): client-side button
// disabling is not enough on its own (rapid double-click races, retries
// after a slow response, two admin tabs) -- a short CacheService lock per
// campaignId means a second concurrent sendPushCampaign call for the same
// campaign fails fast with PUSH_BUSY instead of racing the first call's
// batch/counter updates. 25s covers one realistic Apps Script batch
// round-trip; the lock is always released in the finally block below.
function sendPushCampaign(campaignId, adminEmail) {
  const id = requiredText(campaignId, "Campaign ID", 8, 100);
  const cache = CacheService.getScriptCache();
  const lockKey = "push_sending_" + id;
  if (cache.get(lockKey)) {
    throw new OrderError("PUSH_BUSY", "This campaign is already being sent. Please wait for it to finish.");
  }
  cache.put(lockKey, "1", 25);
  try {
    return sendPushCampaignLocked(id, adminEmail);
  } finally {
    cache.remove(lockKey);
  }
}

function sendPushCampaignLocked(id, adminEmail) {
  const props = PropertiesService.getScriptProperties();
  const workerUrl = props.getProperty("PUSH_WORKER_URL");
  const workerSecret = props.getProperty("PUSH_SERVER_SECRET");
  if (!workerUrl || !workerSecret) {
    throw new OrderError("PUSH_PROVIDER_NOT_CONFIGURED", "The Push Worker is not configured yet (PUSH_WORKER_URL / PUSH_SERVER_SECRET are not set in Script Properties). The campaign was not sent or marked failed -- configure the provider and try again.");
  }

  const campSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushCampaigns");
  if (!campSheet) throw new OrderError("CAMPAIGN_NOT_FOUND", "Campaign not found.");
  const existing = findRowById(campSheet, "campaignId", id);
  if (!existing) throw new OrderError("CAMPAIGN_NOT_FOUND", "Campaign not found.");
  const h = existing.headers, row = existing.row;
  const status = String(row[h.indexOf("status")] || "Draft");
  if (["Completed", "Failed", "Expired"].indexOf(status) !== -1) {
    throw new OrderError("CAMPAIGN_ALREADY_FINAL", "This campaign already finished sending (" + status + ") and cannot be sent again.");
  }
  if (status === "Paused") {
    throw new OrderError("CAMPAIGN_PAUSED", "This campaign is paused. Resume it before sending.");
  }
  const audience = String(row[h.indexOf("audience")] || "all_active");
  if (PUSH_AUDIENCES_WITH_REAL_SEGMENT.indexOf(audience) === -1) {
    throw new OrderError("AUDIENCE_NOT_YET_LINKED", "The \"" + audience + "\" audience segment has no real subscriber linkage yet -- only all_active, cart_abandoned, and cod_requested can be sent to today. Sending was refused rather than guessing the wrong recipients.");
  }

  const quietUntil = quietHoursActiveUntil();
  if (quietUntil) {
    return { ok: true, status: status, quietHours: true, message: "Quiet hours are active (" + PUSH_TIMEZONE + "); no push was sent. Try again after " + quietUntil + "." };
  }

  const title = String(row[h.indexOf("title")] || "");
  const body = String(row[h.indexOf("body")] || "");
  const targetUrl = String(row[h.indexOf("targetUrl")] || "");
  const imageUrl = String(row[h.indexOf("imageUrl")] || "");

  const eligible = computeEligibleSubscriptions(audience, id);
  const batch = eligible.slice(0, PUSH_SEND_BATCH_SIZE);
  const remaining = eligible.length - batch.length;

  if (batch.length === 0) {
    const finalStatus = remaining > 0 ? status : (Number(row[h.indexOf("attempted")]) > 0 ? finalizeCampaignStatus(row, h) : "Completed");
    setCampaignField(id, "status", finalStatus);
    if (finalStatus !== "Sending") setCampaignField(id, "sentAt", new Date().toISOString());
    return { ok: true, status: finalStatus, batch: { attempted: 0, accepted: 0, failed: 0 }, remaining: 0 };
  }

  setCampaignField(id, "status", "Sending");
  const webhookUrl = CONFIG_SHEET_WEBHOOK_URL_FOR_WORKER();
  const requests = batch.map(sub => ({
    url: workerUrl,
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + workerSecret },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      subscription: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.authKey },
      payload: {
        title: title, body: body, targetUrl: targetUrl, image: imageUrl || undefined,
        campaignId: id, visitorId: sub.visitorId, webhookUrl: webhookUrl
      },
      ttl: 4 * 60 * 60
    })
  }));

  const responses = UrlFetchApp.fetchAll(requests);
  let accepted = 0, failed = 0;
  const now = new Date().toISOString();
  const subSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushSubscriptions");
  responses.forEach((resp, i) => {
    const sub = batch[i];
    const diag = classifyWorkerResponse(resp);
    if (diag.pushStatus === "accepted") {
      accepted++;
      logPushEventInternal(sub.visitorId, id, "push_sent", diag);
      if (subSheet) setSubscriptionField(subSheet, sub.rowIndex, "lastPushAt", now);
    } else if (diag.pushStatus === "expired") {
      failed++;
      logPushEventInternal(sub.visitorId, id, "push_expired", diag);
      if (subSheet) setSubscriptionField(subSheet, sub.rowIndex, "subscriptionStatus", "expired");
    } else {
      failed++;
      logPushEventInternal(sub.visitorId, id, "push_failed", diag);
      // temporary failure -- subscription stays active, naturally eligible
      // for a retry on the next Send click (no push_sent event was logged)
    }
  });

  incrementCampaignCounterBy(id, "attempted", batch.length);
  incrementCampaignCounterBy(id, "accepted", accepted);
  incrementCampaignCounterBy(id, "failed", failed);
  logAudit(adminEmail, "pushCampaignSend", "PushCampaign", id, { status: status }, { attempted: batch.length, accepted: accepted, failed: failed, remaining: remaining }, "success");

  if (remaining > 0) {
    return { ok: true, status: "Sending", batch: { attempted: batch.length, accepted: accepted, failed: failed }, remaining: remaining };
  }
  const finalRow = findRowById(campSheet, "campaignId", id);
  const finalStatus = finalizeCampaignStatus(finalRow.row, finalRow.headers);
  setCampaignField(id, "status", finalStatus);
  setCampaignField(id, "sentAt", new Date().toISOString());
  return { ok: true, status: finalStatus, batch: { attempted: batch.length, accepted: accepted, failed: failed }, remaining: 0 };
}

// Pause stops a "Sending" (batch-in-progress) or "Scheduled" campaign from
// being sent further; resume only moves it back to "Scheduled" -- it never
// auto-sends (no scheduler exists), the admin must click Send again.
function setPushCampaignPause(campaignId, pause, adminEmail) {
  const id = requiredText(campaignId, "Campaign ID", 8, 100);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushCampaigns");
  if (!sheet) throw new OrderError("CAMPAIGN_NOT_FOUND", "Campaign not found.");
  const existing = findRowById(sheet, "campaignId", id);
  if (!existing) throw new OrderError("CAMPAIGN_NOT_FOUND", "Campaign not found.");
  const status = String(existing.row[existing.headers.indexOf("status")] || "Draft");
  if (pause) {
    if (["Sending", "Scheduled"].indexOf(status) === -1) throw new OrderError("INVALID_CAMPAIGN_STATE", "Only a Sending or Scheduled campaign can be paused.");
    setCampaignField(id, "status", "Paused");
    logAudit(adminEmail, "pushCampaignPause", "PushCampaign", id, { status: status }, { status: "Paused" }, "success");
    return { ok: true, status: "Paused" };
  }
  if (status !== "Paused") throw new OrderError("INVALID_CAMPAIGN_STATE", "Only a Paused campaign can be resumed.");
  setCampaignField(id, "status", "Scheduled");
  logAudit(adminEmail, "pushCampaignResume", "PushCampaign", id, { status: status }, { status: "Scheduled" }, "success");
  return { ok: true, status: "Scheduled" };
}

function finalizeCampaignStatus(row, h) {
  const attempted = Number(row[h.indexOf("attempted")]) || 0;
  const acceptedTotal = Number(row[h.indexOf("accepted")]) || 0;
  const failedTotal = Number(row[h.indexOf("failed")]) || 0;
  if (attempted === 0) return "Failed";
  if (failedTotal === 0) return "Completed";
  if (acceptedTotal === 0) return "Failed";
  return "Partially Failed";
}

function setCampaignField(campaignId, field, value) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushCampaigns");
  if (!sheet) return;
  const existing = findRowById(sheet, "campaignId", campaignId);
  if (!existing) return;
  const col = existing.headers.indexOf(field) + 1;
  if (col > 0) sheet.getRange(existing.rowIndex, col).setValue(value);
}

function setSubscriptionField(sheet, rowIndex, field, value) {
  const headers = sheet.getDataRange().getValues()[0];
  const col = headers.indexOf(field) + 1;
  if (col > 0) sheet.getRange(rowIndex, col).setValue(value);
}

function incrementCampaignCounterBy(campaignId, field, amount) {
  if (!amount) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushCampaigns");
  if (!sheet) return;
  const existing = findRowById(sheet, "campaignId", campaignId);
  if (!existing) return;
  const col = existing.headers.indexOf(field) + 1;
  if (col <= 0) return;
  const current = Number(existing.row[col - 1]) || 0;
  sheet.getRange(existing.rowIndex, col).setValue(current + amount);
}

// Best-effort event log used internally by the send pipeline -- same
// sheet/shape as logPushEvent, but never throws (a telemetry write should
// never fail a real send that already happened). `diag` (from
// classifyWorkerResponse) is safe-only: httpStatus + a short code, never
// endpoint/keys/secrets.
function logPushEventInternal(visitorId, campaignId, eventType, diag) {
  try {
    const sheet = ensureSheetWithHeaders("PushEvents", PUSH_EVENT_HEADERS);
    const metadata = diag ? JSON.stringify({ httpStatus: diag.httpStatus, code: diag.code }) : "";
    sheet.appendRow([new Date().toISOString(), String(visitorId || ""), String(campaignId || ""), eventType, metadata]);
  } catch (e) { console.error(e); }
}

// Turns one Worker HTTP response into a safe, admin-displayable diagnosis
// -- HS-20260819-09 (previously the exact failure reason for a "failed"
// send was invisible; every non-accepted result looked identical). Never
// includes endpoint/p256dh/authKey/PUSH_SERVER_SECRET/VAPID material --
// only an HTTP status and a short classification code.
function classifyWorkerResponse(resp) {
  const httpStatus = resp.getResponseCode();
  let body = {};
  try { body = JSON.parse(resp.getContentText()); } catch (e) { /* non-JSON body -- treat as unknown */ }
  if (body.pushStatus === "accepted") return { pushStatus: "accepted", httpStatus: httpStatus, code: "ACCEPTED" };
  if (body.pushStatus === "expired") return { pushStatus: "expired", httpStatus: httpStatus, code: "EXPIRED_SUBSCRIPTION" };
  if (httpStatus === 401 || body.error === "UNAUTHORIZED") return { pushStatus: "temporary_failure", httpStatus: httpStatus, code: "AUTH_FAILED" };
  if (httpStatus === 400) return { pushStatus: "temporary_failure", httpStatus: httpStatus, code: "PUSH_SERVICE_REJECTED" };
  if (httpStatus === 0 || !httpStatus) return { pushStatus: "temporary_failure", httpStatus: httpStatus || 0, code: "WORKER_UNREACHABLE" };
  return { pushStatus: "temporary_failure", httpStatus: httpStatus, code: "TEMPORARY_ERROR" };
}

function CONFIG_SHEET_WEBHOOK_URL_FOR_WORKER() {
  // The service worker's click telemetry needs this project's own Web App
  // URL, embedded per-notification (see push-sw.js) -- it has no other way
  // to reach it. This Apps Script deployment's own doPost URL.
  try { return ScriptApp.getService().getUrl(); } catch (e) { return ""; }
}

// Returns a human-readable "try again after HH:MM" string if Asia/Karachi
// local time is currently inside the configured quiet-hours window,
// otherwise null. Handles a window that wraps midnight (e.g. 21:00-08:00).
function quietHoursActiveUntil() {
  const settings = Object.assign({}, PUSH_SETTINGS_DEFAULTS, getSettings());
  const start = String(settings.QUIET_HOURS_START || "21:00");
  const end = String(settings.QUIET_HOURS_END || "08:00");
  const nowMinutes = karachiMinutesSinceMidnight(new Date());
  const startMinutes = hhmmToMinutes(start);
  const endMinutes = hhmmToMinutes(end);
  const inWindow = startMinutes <= endMinutes
    ? (nowMinutes >= startMinutes && nowMinutes < endMinutes)
    : (nowMinutes >= startMinutes || nowMinutes < endMinutes);
  return inWindow ? end + " " + PUSH_TIMEZONE : null;
}

function hhmmToMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function karachiMinutesSinceMidnight(date) {
  const formatted = Utilities.formatDate(date, PUSH_TIMEZONE, "HH:mm");
  return hhmmToMinutes(formatted);
}

// Resolves the real, eligible, deduped, frequency-capped subscriber list
// for a campaign send. Never invents recipients: all_active is every
// active subscription; cart_abandoned/cod_requested are matched by a real
// Leads.visitorId linkage (HS-20260819-06). Excludes: inactive/expired
// subscriptions, a subscription this exact campaign already reached
// (push_sent event on record), and any subscription over its daily/weekly
// frequency cap.
function computeEligibleSubscriptions(audience, campaignId) {
  const subSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushSubscriptions");
  if (!subSheet) return [];
  const subRows = subSheet.getDataRange().getValues();
  if (subRows.length < 2) return [];
  const sh = subRows[0];
  const active = [];
  for (let i = 1; i < subRows.length; i++) {
    if (String(subRows[i][sh.indexOf("subscriptionStatus")]) !== "active") continue;
    active.push({
      rowIndex: i + 1, visitorId: String(subRows[i][sh.indexOf("visitorId")] || ""),
      endpoint: String(subRows[i][sh.indexOf("endpoint")] || ""), p256dh: String(subRows[i][sh.indexOf("p256dh")] || ""),
      authKey: String(subRows[i][sh.indexOf("authKey")] || "")
    });
  }
  const segmentSet = audience === "all_active" ? null : computeAudienceVisitorSet(audience);
  const inSegment = active.filter(s => !segmentSet || segmentSet.has(s.visitorId));

  const settings = Object.assign({}, PUSH_SETTINGS_DEFAULTS, getSettings());
  const maxPerDay = Number(settings.MAX_PUSH_PER_DAY);
  const maxPerWeek = Number(settings.MAX_PUSH_PER_WEEK);
  const eventsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushEvents");
  const dayCounts = {}, weekCounts = {}, sentThisCampaign = new Set();
  if (eventsSheet) {
    const evRows = eventsSheet.getDataRange().getValues();
    if (evRows.length >= 2) {
      const eh = evRows[0];
      const tsCol = eh.indexOf("timestamp"), vCol = eh.indexOf("visitorId"), typeCol = eh.indexOf("eventType"), campCol = eh.indexOf("campaignId");
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000, weekMs = 7 * dayMs;
      for (let i = 1; i < evRows.length; i++) {
        if (String(evRows[i][typeCol]) !== "push_sent") continue;
        const vid = String(evRows[i][vCol] || "");
        const ts = new Date(evRows[i][tsCol]).getTime();
        if (now - ts < dayMs) dayCounts[vid] = (dayCounts[vid] || 0) + 1;
        if (now - ts < weekMs) weekCounts[vid] = (weekCounts[vid] || 0) + 1;
        if (String(evRows[i][campCol]) === campaignId) sentThisCampaign.add(vid);
      }
    }
  }

  return inSegment.filter(s => {
    if (sentThisCampaign.has(s.visitorId)) return false; // never resend same campaign/subscription pair
    if ((dayCounts[s.visitorId] || 0) >= maxPerDay) return false;
    if ((weekCounts[s.visitorId] || 0) >= maxPerWeek) return false;
    return true;
  });
}

// Real Leads-based segments only (HS-20260819-06): a Lead is matched to a
// subscription purely by the visitorId both already carry. A Lead whose
// status is ORDER_CONVERTED is excluded from cart_abandoned (it isn't
// abandoned, it converted) but cod_requested still honors an explicit
// COD_REQUESTED reason even post-conversion is moot since that can't
// coexist with ORDER_CONVERTED in practice.
function computeAudienceVisitorSet(audience) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Leads");
  const set = new Set();
  if (!sheet) return set;
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return set;
  const h = rows[0];
  const vCol = h.indexOf("visitorId"), sCol = h.indexOf("status"), rCol = h.indexOf("abandonReason");
  if (vCol < 0) return set;
  for (let i = 1; i < rows.length; i++) {
    const vid = String(rows[i][vCol] || "");
    if (!vid) continue;
    const status = String(rows[i][sCol] || "");
    const reason = String(rows[i][rCol] || "");
    if (audience === "cod_requested") { if (reason === "COD_REQUESTED") set.add(vid); continue; }
    if (audience === "cart_abandoned") { if (status !== "ORDER_CONVERTED") set.add(vid); continue; }
  }
  return set;
}

// Super Admin only (requireAdmin already checked by the caller). Sends to
// exactly ONE subscription, bypassing frequency/dedupe/quiet-hours (a
// single deliberate manual test is not a marketing send) -- but still
// requires the Worker to be configured and still logs a distinct
// "test_sent" event rather than touching any campaign's counters.
function pushTestSend(payload, adminEmail) {
  const visitorId = requiredText(payload.visitorId, "Visitor ID", 16, 100);
  const cache = CacheService.getScriptCache();
  const lockKey = "push_test_sending_" + visitorId;
  if (cache.get(lockKey)) throw new OrderError("PUSH_BUSY", "A test send to this subscriber is already in progress.");
  cache.put(lockKey, "1", 15);
  try {
    return pushTestSendLocked(payload, visitorId, adminEmail);
  } finally {
    cache.remove(lockKey);
  }
}

function pushTestSendLocked(payload, visitorId, adminEmail) {
  const props = PropertiesService.getScriptProperties();
  const workerUrl = props.getProperty("PUSH_WORKER_URL");
  const workerSecret = props.getProperty("PUSH_SERVER_SECRET");
  if (!workerUrl || !workerSecret) {
    throw new OrderError("PUSH_PROVIDER_NOT_CONFIGURED", "The Push Worker is not configured yet (PUSH_WORKER_URL / PUSH_SERVER_SECRET are not set in Script Properties).");
  }
  const subSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("PushSubscriptions");
  if (!subSheet) throw new OrderError("SUBSCRIPTION_NOT_FOUND", "No subscriptions recorded yet.");
  const existing = findRowById(subSheet, "visitorId", visitorId);
  if (!existing || String(existing.row[existing.headers.indexOf("subscriptionStatus")]) !== "active") {
    throw new OrderError("SUBSCRIPTION_NOT_FOUND", "That visitor does not have an active push subscription.");
  }
  const sub = {
    endpoint: String(existing.row[existing.headers.indexOf("endpoint")] || ""),
    p256dh: String(existing.row[existing.headers.indexOf("p256dh")] || ""),
    auth: String(existing.row[existing.headers.indexOf("authKey")] || "")
  };
  const resp = UrlFetchApp.fetch(workerUrl, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + workerSecret },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      subscription: sub,
      payload: {
        title: "🌱 Hoja Seeds Test", body: "Your browser notifications are working.",
        targetUrl: "https://www.hojaseeds.pk/", campaignId: "", visitorId: visitorId,
        webhookUrl: CONFIG_SHEET_WEBHOOK_URL_FOR_WORKER()
      },
      ttl: 300
    })
  });
  const diag = classifyWorkerResponse(resp);
  logPushEventInternal(visitorId, "", "test_sent", diag);
  logAudit(adminEmail, "pushTestSend", "PushSubscription", visitorId, null, { pushStatus: diag.pushStatus, httpStatus: diag.httpStatus, code: diag.code }, diag.pushStatus === "accepted" ? "success" : "failure");
  return { ok: diag.pushStatus === "accepted", pushStatus: diag.pushStatus, httpStatus: diag.httpStatus, code: diag.code };
}

function sha256Hex(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ""), Utilities.Charset.UTF_8);
  return digest.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, "0")).join("");
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
