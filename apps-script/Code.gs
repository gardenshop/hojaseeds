/**
 * Hoja Seeds — Google Sheets backend
 *
 * Sheet tabs this script expects (create them with these exact names
 * and header rows — see README.md Step 1):
 *
 *   Products  | id | name | cat | unit | icon | price | type
 *   Orders    | timestamp | orderId | name | phone | address | city | postal | notes | paymentMethod | advanceMethod | transactionRef | items | subtotal | deliveryFee | total
 *   Contact   | timestamp | name | phone | message
 *   Settings  | key | value
 *     (rows: FREE_DELIVERY_THRESHOLD, ADVANCE_DELIVERY_FEE, COD_DELIVERY_FEE,
 *      COD_ALLOWED, CUSTOMIZED_REQUIRES_FULL_ADVANCE — see README.md Step 1)
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New
 * deployment > type "Web app" > Execute as "Me" > Who has access
 * "Anyone" > Deploy. Copy the Web App URL into js/config.js
 * (CONFIG.SHEET_WEBHOOK_URL).
 */

function doGet(e) {
  ensureAdminProperties();
  const action = e.parameter.action;
  if (action === "products") return jsonResponse(getProducts());
  if (action === "settings") return jsonResponse(getSettings());
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
  try {
    ensureAdminProperties();
    const payload = JSON.parse(e.postData.contents);
    if (payload.type === "order") return jsonResponse(submitOrder(payload));
    if (payload.type === "contact") logContact(payload);
    else if (payload.type === "priceUpdate") { requireAdmin(payload); updateProducts(payload.updates); }
    else if (payload.type === "settingsUpdate") { requireAdmin(payload); updateSettings(payload.rules); }
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

  const response = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
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
  COD_ALLOWED: true
};
const ORDER_PAYMENT_METHODS = ["Cash on Delivery", "Advance Payment"];
const ORDER_ADVANCE_METHODS = ["JazzCash", "EasyPaisa", "Bank Transfer"];
const PRODUCT_TYPES = ["regular", "premium", "standard-collection", "customized-collection"];

function OrderError(code, message) {
  this.name = "OrderError";
  this.code = code;
  this.message = message;
}
OrderError.prototype = Object.create(Error.prototype);

function submitOrder(payload) {
  const idempotencyKey = requiredText(payload.idempotencyKey, "Idempotency key", 16, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) {
    throw new OrderError("INVALID_IDEMPOTENCY_KEY", "The order request key is invalid.");
  }

  const fingerprint = requestFingerprint(payload);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new OrderError("ORDER_BUSY", "The order service is busy. Please retry with the same order request.");
  }

  try {
    const orderId = generateOrderId(idempotencyKey);
    const existingOrder = findMatchingOrder(orderId, fingerprint);
    if (existingOrder) return existingOrder;

    const order = buildAuthoritativeOrder(payload, getProducts(), getOrderSettings(), orderId);
    order.idempotencyFingerprint = fingerprint;
    logOrder(order);
    delete order.idempotencyFingerprint;
    return order;
  } finally {
    lock.releaseLock();
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
  const hasCustomized = orderItems.some(item => item.type === "customized-collection");
  if (paymentMethod === "Cash on Delivery" && (!settings.COD_ALLOWED || hasCustomized)) {
    throw new OrderError(
      hasCustomized ? "CUSTOMIZED_REQUIRES_ADVANCE" : "COD_UNAVAILABLE",
      hasCustomized ? "Customized collections require advance payment." : "Cash on Delivery is not available."
    );
  }

  let advanceMethod = "";
  let transactionReference = "";
  if (paymentMethod === "Advance Payment") {
    advanceMethod = requiredText(paymentInput.advanceMethod, "Advance payment method", 3, 40);
    if (ORDER_ADVANCE_METHODS.indexOf(advanceMethod) === -1) {
      throw new OrderError("INVALID_ADVANCE_METHOD", "Choose a supported advance payment method.");
    }
    transactionReference = requiredText(paymentInput.transactionReference, "Transaction reference", 3, 100);
  }

  const deliveryFee = paymentMethod === "Advance Payment"
    ? (subtotal >= settings.FREE_DELIVERY_THRESHOLD ? 0 : settings.ADVANCE_DELIVERY_FEE)
    : settings.COD_DELIVERY_FEE;
  return {
    ok: true,
    orderId: orderId || generateOrderId(payload.idempotencyKey),
    createdAt: new Date().toISOString(),
    customer: customer,
    paymentMethod: paymentMethod,
    advanceMethod: advanceMethod,
    transactionReference: transactionReference,
    paymentStatus: paymentMethod === "Advance Payment" ? "Payment Verification" : "COD Due",
    items: orderItems,
    subtotal: subtotal,
    deliveryFee: deliveryFee,
    total: subtotal + deliveryFee
  };
}

function getOrderSettings() {
  const rules = Object.assign({}, ORDER_DEFAULT_RULES, getSettings());
  ["FREE_DELIVERY_THRESHOLD", "ADVANCE_DELIVERY_FEE", "COD_DELIVERY_FEE"].forEach(key => {
    rules[key] = Number(rules[key]);
    if (!Number.isFinite(rules[key]) || rules[key] < 0) {
      throw new OrderError("INVALID_STORE_SETTINGS", "The store delivery settings are invalid.");
    }
  });
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

function updateProducts(updates) {
  if (!Array.isArray(updates) || updates.length > 1000) throw new OrderError("INVALID_ADMIN_UPDATE", "Product updates are invalid.");
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Products");
  const rows = sheet.getDataRange().getValues();
  const idCol = rows[0].indexOf("id");
  const priceCol = rows[0].indexOf("price");
  const typeCol = rows[0].indexOf("type");
  const idToRow = {};
  for (let i = 1; i < rows.length; i++) idToRow[rows[i][idCol]] = i + 1; // 1-indexed sheet row

  updates.forEach(u => {
    if (!u || typeof u.id !== "string") throw new OrderError("INVALID_ADMIN_UPDATE", "A product update is invalid.");
    if (u.price != null && (!Number.isFinite(Number(u.price)) || Number(u.price) < 0)) throw new OrderError("INVALID_ADMIN_UPDATE", "A product price is invalid.");
    if (u.type != null && PRODUCT_TYPES.indexOf(String(u.type)) === -1) throw new OrderError("INVALID_ADMIN_UPDATE", "A product type is invalid.");
    const row = idToRow[u.id];
    if (!row) return;
    if (u.price != null) sheet.getRange(row, priceCol + 1).setValue(u.price);
    if (u.type && typeCol > -1) sheet.getRange(row, typeCol + 1).setValue(u.type);
  });
}

// Settings sheet is just key/value rows — read them into a flat object,
// coercing "true"/"false" text and numeric strings back to real types.
function getSettings() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Settings");
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  rows.shift(); // header row: key | value
  const out = {};
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

function updateSettings(rules) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new OrderError("INVALID_ADMIN_UPDATE", "Store settings are invalid.");
  const allowedKeys = ["FREE_DELIVERY_THRESHOLD", "ADVANCE_DELIVERY_FEE", "COD_DELIVERY_FEE", "COD_ALLOWED", "CUSTOMIZED_REQUIRES_FULL_ADVANCE"];
  Object.keys(rules).forEach(key => {
    if (allowedKeys.indexOf(key) === -1) throw new OrderError("INVALID_ADMIN_UPDATE", "A store setting is not allowed.");
  });
  rules.CUSTOMIZED_REQUIRES_FULL_ADVANCE = true;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Settings");
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  const keyToRow = {};
  for (let i = 1; i < rows.length; i++) keyToRow[rows[i][0]] = i + 1;

  Object.keys(rules).forEach(key => {
    const row = keyToRow[key];
    if (row) sheet.getRange(row, 2).setValue(rules[key]);
    else sheet.appendRow([key, rules[key]]);
  });
}

function logOrder(o) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Orders");
  sheet.appendRow([
    o.createdAt, o.orderId,
    safeSheetText(o.customer.name), safeSheetText(o.customer.phone),
    safeSheetText(o.customer.address), safeSheetText(o.customer.city),
    safeSheetText(o.customer.postal), safeSheetText(o.customer.notes),
    o.paymentMethod, o.advanceMethod, safeSheetText(o.transactionReference),
    JSON.stringify({ fingerprint: o.idempotencyFingerprint, items: o.items }), o.subtotal, o.deliveryFee, o.total
  ]);
}

function findMatchingOrder(orderId, fingerprint) {
  const order = findOrderById(orderId);
  if (!order) return null;
  if (!order.idempotencyFingerprint) return null;
  if (order.idempotencyFingerprint !== fingerprint) {
    throw new OrderError("IDEMPOTENCY_CONFLICT", "This order request key was already used for different order details.");
  }
  delete order.idempotencyFingerprint;
  return order;
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
    paymentStatus: paymentMethod === "Advance Payment" ? "Payment Verification" : "COD Due",
    idempotencyFingerprint: fingerprint,
    items: items,
    subtotal: Number(value("subtotal")),
    deliveryFee: Number(value("deliveryFee")),
    total: Number(value("total"))
  };
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

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
