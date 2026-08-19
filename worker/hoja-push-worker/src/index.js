// Hoja Seeds — Web Push send Worker (HS-20260819-06).
//
// Single responsibility, no customer-facing business logic: receive one
// authorized send request from Apps Script, validate it, sign a VAPID JWT,
// encrypt the payload per RFC 8291 (aes128gcm), POST it to the browser's
// real push service, and return that service's HTTP result untouched. It
// never decides audience/frequency/quiet-hours/campaign logic -- that all
// stays in Apps Script, which is the only caller. It is never reachable
// from a browser: not attached to any hojaseeds.pk route, and every
// request must carry the shared PUSH_SERVER_SECRET.

const MAX_TITLE = 65;
const MAX_BODY = 200;
const TARGET_URL_RE = /^https:\/\/(www\.)?hojaseeds\.pk\//;
const DEFAULT_TTL = 4 * 60 * 60; // 4h -- a marketing push stale beyond this isn't worth the push service holding it

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return json({ ok: true, service: "hoja-push-worker" }, 200);
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const auth = request.headers.get("authorization") || "";
    if (!env.PUSH_SERVER_SECRET || !constantTimeEqual(auth, `Bearer ${env.PUSH_SERVER_SECRET}`)) {
      return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      return json({ ok: false, error: "VAPID_NOT_CONFIGURED" }, 500);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

    const validation = validateSendRequest(body);
    if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
    const { subscription, payload, ttl } = validation.value;

    try {
      const result = await sendWebPush(subscription, payload, ttl, env);
      return json(result, 200);
    } catch (e) {
      return json({ ok: false, error: "SEND_EXCEPTION", detail: String(e && e.message || e) }, 502);
    }
  }
};

function validateSendRequest(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "INVALID_BODY" };
  const sub = body.subscription || {};
  const endpoint = String(sub.endpoint || "");
  const p256dh = String(sub.p256dh || "");
  const auth = String(sub.auth || "");
  if (!/^https:\/\//.test(endpoint)) return { ok: false, error: "INVALID_SUBSCRIPTION_ENDPOINT" };
  if (!p256dh || p256dh.length < 20 || p256dh.length > 200) return { ok: false, error: "INVALID_SUBSCRIPTION_KEY" };
  if (!auth || auth.length < 8 || auth.length > 100) return { ok: false, error: "INVALID_SUBSCRIPTION_AUTH" };

  const p = body.payload || {};
  const title = stripTags(String(p.title || "")).slice(0, MAX_TITLE);
  const text = stripTags(String(p.body || "")).slice(0, MAX_BODY);
  if (!title || !text) return { ok: false, error: "INVALID_NOTIFICATION_TEXT" };
  const targetUrl = String(p.targetUrl || "https://www.hojaseeds.pk/");
  if (!TARGET_URL_RE.test(targetUrl)) return { ok: false, error: "INVALID_TARGET_URL" };
  const campaignId = /^[A-Za-z0-9_-]{0,100}$/.test(String(p.campaignId || "")) ? String(p.campaignId || "") : "";
  const visitorId = /^[A-Za-z0-9_-]{0,100}$/.test(String(p.visitorId || "")) ? String(p.visitorId || "") : "";
  const image = /^https:\/\//.test(String(p.image || "")) ? String(p.image) : undefined;
  const webhookUrl = /^https:\/\//.test(String(p.webhookUrl || "")) ? String(p.webhookUrl) : undefined;

  const ttl = Number.isFinite(Number(body.ttl)) ? Math.min(Math.max(Number(body.ttl), 60), 24 * 60 * 60) : DEFAULT_TTL;

  return {
    ok: true,
    value: {
      subscription: { endpoint, p256dh, auth },
      payload: { title, body: text, targetUrl, image, campaignId, visitorId, webhookUrl },
      ttl
    }
  };
}

function stripTags(value) { return value.replace(/<[^>]*>/g, ""); }

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

// ── base64url helpers ──────────────────────────────────────────────────
function b64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

// ── VAPID JWT (ES256) ──────────────────────────────────────────────────
async function importVapidPrivateKey(privB64url, pubB64url) {
  const pubBytes = b64urlToBytes(pubB64url); // 65 bytes: 0x04 || X(32) || Y(32)
  const x = bytesToB64url(pubBytes.slice(1, 33));
  const y = bytesToB64url(pubBytes.slice(33, 65));
  const d = privB64url.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwk = { kty: "EC", crv: "P-256", d, x, y, ext: true };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function signVapidJWT(privateKey, audience, subject) {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: subject };
  const encHeader = bytesToB64url(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = encHeader + "." + encPayload;
  const sigBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signingInput)
  );
  return signingInput + "." + bytesToB64url(new Uint8Array(sigBuf));
}

// ── RFC 8291 payload encryption (aes128gcm) ────────────────────────────
async function hkdf(ikmBytes, saltBytes, infoBytes, length) {
  const key = await crypto.subtle.importKey("raw", ikmBytes, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: saltBytes, info: infoBytes }, key, length * 8
  );
  return new Uint8Array(bits);
}

async function encryptPayload(plaintextObj, subscription) {
  const uaPublicRaw = b64urlToBytes(subscription.p256dh); // subscriber's public key, 65 bytes
  const authSecret = b64urlToBytes(subscription.auth); // 16 bytes

  const uaPublicKey = await crypto.subtle.importKey("raw", uaPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey)); // 65 bytes

  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, ephemeral.privateKey, 256));

  const keyInfo = concatBytes(
    new TextEncoder().encode("WebPush: info"), new Uint8Array([0x00]), uaPublicRaw, asPublicRaw
  );
  const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekBytes = await hkdf(ikm, salt, concatBytes(new TextEncoder().encode("Content-Encoding: aes128gcm"), new Uint8Array([0x00])), 16);
  const nonce = await hkdf(ikm, salt, concatBytes(new TextEncoder().encode("Content-Encoding: nonce"), new Uint8Array([0x00])), 12);

  const cekKey = await crypto.subtle.importKey("raw", cekBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const plaintext = concatBytes(new TextEncoder().encode(JSON.stringify(plaintextObj)), new Uint8Array([0x02])); // last-record delimiter
  const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cekKey, plaintext);
  const ciphertext = new Uint8Array(ciphertextBuf); // includes 16-byte GCM tag appended

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

async function sendWebPush(subscription, payload, ttl, env) {
  const body = await encryptPayload(payload, subscription);
  const audience = new URL(subscription.endpoint).origin;
  const subject = env.VAPID_SUBJECT || "mailto:support@hojaseeds.pk";
  const privateKey = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);
  const jwt = await signVapidJWT(privateKey, audience, subject);

  const resp = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": String(ttl),
      "Urgency": "normal",
      "Authorization": `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`
    },
    body
  });

  const httpStatus = resp.status;
  let pushStatus;
  if (httpStatus === 200 || httpStatus === 201) pushStatus = "accepted";
  else if (httpStatus === 404 || httpStatus === 410) pushStatus = "expired";
  else pushStatus = "temporary_failure";

  return { ok: pushStatus === "accepted", pushStatus, httpStatus };
}
