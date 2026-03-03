const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Resend } = require("resend");
const { RRule } = require("rrule");
const sharp = require("sharp");
const { createHash } = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const BOOTSTRAP_ADMINS = [
  "bradsgbaker14@gmail.com",
  "admin@thecrookedfence.co.za",
  "stolschristopher60@gmail.com",
  "bradley@binarybaker.co.za",
];

const ADMIN_EMAIL_EXCLUSIONS = new Set([
  "bradsgbaker14@gmail.com",
  "admin@thecrookedfence.co.za",
]);
const ADMIN_EMAIL_FALLBACKS = ["stolschristopher60@gmail.com"];

const ORDER_STATUS_LABELS = {
  pending: "Pending",
  waiting_list: "Waiting list",
  cancelled: "Cancelled",
  packed: "Packed",
  scheduled_dispatch: "Scheduled for Dispatch",
  shipped: "Shipped",
  completed: "Completed",
  archived: "Archived",
};

const ORDER_NUMBER_PAD = 4;
const WHATSAPP_NUMBER = "082 891 07612";
const BRAND_NAME = "The Crooked Fence";
const SITE_BASE_URL = "https://thecrookedfence.co.za";
const SITEMAP_STATIC_PATHS = ["/", "/eggs", "/livestock"];
const BRAND_LOGO_URL =
  "https://firebasestorage.googleapis.com/v0/b/thecrookedfence-7aea9.firebasestorage.app/o/TCFLogoWhiteBackground.png?alt=media&token=24e50702-a2b8-42e9-b620-659b5d06d554";

const PAYMENT_DETAILS = {
  bank: "FNB/RMB",
  accountName: "The Golden Quail",
  accountType: "Gold Business Account",
  accountNumber: "63049448219",
  branchCode: "250655",
};
const INDEMNITY_TEXT =
  "NO REFUNDS. We take great care in packaging all eggs to ensure they are shipped as safely as possible. However, once eggs leave our care, we cannot be held responsible for damage that may occur during transit, including cracked eggs. Hatch rates cannot be guaranteed. There are many factors beyond our control—such as handling during shipping, incubation conditions, and environmental variables—that may affect development. As eggs are considered livestock, purchasing hatching eggs involves an inherent risk that the buyer accepts at the time of purchase.\n \n Availability Notice: Some eggs are subject to a 3–6 week waiting period and may not be available for immediate shipment. By placing an order, the buyer acknowledges and accepts this potential delay.\n \nExtra Eggs Disclaimer: Extra eggs are never guaranteed. While we may occasionally include additional eggs when available, this is done at our discretion and should not be expected or assumed as part of any order.";

const EGG_REST_NOTICE_TEXT =
  "Important: Hatching eggs must rest for at least 24 hours at room temperature before incubation.";

const TYPE_IMAGE_MAX_EDGE = 1920;
const TYPE_IMAGE_CACHE_CONTROL = "public,max-age=31536000,immutable";
const TYPE_IMAGE_LIBRARY_COLLECTION = "typeImageLibrary";
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ORDER_DRAFTS_COLLECTION = "orderDrafts";
const ORDER_IDEMPOTENCY_COLLECTION = "orderIdempotency";
const PUBLIC_ORDER_ERRORS_COLLECTION = "publicOrderErrors";
const PUBLIC_ORDER_SCHEMA_VERSION = 1;
const PUBLIC_DRAFT_TTL_DAYS = 14;
const PUBLIC_ORDER_FORM_TYPES = new Set(["eggs", "livestock"]);

const EMAIL_STYLES = `
  body { margin:0; padding:0; background:#f8fafc; color:#0f172a; }
  .container { max-width:640px; margin:20px auto; padding:24px; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; font-family:'Helvetica Neue', Arial, sans-serif; }
  h1,h2,h3 { color:#064e3b; margin:0 0 12px; }
  p { margin:6px 0; color:#334155; line-height:1.5; }
  ul { margin:6px 0; padding-left:20px; color:#334155; }
  li { margin-bottom:4px; }
  .pill { display:inline-block; padding:4px 10px; border-radius:999px; background:#ecfdf3; color:#047857; font-weight:600; font-size:12px; }
  .summary { margin:16px 0; padding:14px; background:#f1f5f9; border-radius:12px; border:1px solid #e2e8f0; }
  .muted { color:#64748b; font-size:13px; }
  .total { font-size:18px; font-weight:700; color:#064e3b; }
  .divider { border-bottom:1px solid #e2e8f0; margin:16px 0; }
  a { color:#0f766e; }
`;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value) => `R${toNumber(value).toFixed(2)}`;

const formatDate = (value) => {
  if (!value) return "-";
  if (value.toDate) return value.toDate().toLocaleDateString();
  if (value.seconds) return new Date(value.seconds * 1000).toLocaleDateString();
  return new Date(value).toLocaleDateString();
};

const parseOrderNumber = (value) => {
  if (!value) return 0;
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : 0;
};

const formatOrderNumber = (value) =>
  `#${String(value).padStart(ORDER_NUMBER_PAD, "0")}`;

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeUrl = (value) => {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
};
const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const normalizeSitemapPath = (path) => {
  const raw = String(path || "/").trim();
  if (!raw || raw === "/") return "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
};

const toSitemapUrl = (path) => `${SITE_BASE_URL}${normalizeSitemapPath(path)}`;

const timestampToIso = (value) => {
  if (!value) return null;

  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

const buildSitemapEntry = (path, lastmod = null) => ({
  loc: toSitemapUrl(path),
  lastmod,
});

const renderSitemapXml = (entries) => {
  const body = entries
    .map((entry) => {
      const lastmodLine = entry.lastmod
        ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`
        : "";
      return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmodLine}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
};

const normalizeContentType = (value) =>
  String(value || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

const isSupportedImageType = (contentType) =>
  SUPPORTED_IMAGE_TYPES.has(normalizeContentType(contentType));

const isTypeImagePath = (path) => {
  const normalized = String(path || "").trim().replace(/^\/+/, "");
  return (
    normalized.startsWith("types/egg/") ||
    normalized.startsWith("types/livestock/") ||
    normalized.startsWith("type-library/")
  );
};

const extractPathFromFirebaseDownloadUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, "");
  }

  try {
    const parsed = new URL(raw);
    const encodedObjectPathMatch = parsed.pathname.match(/\/o\/(.+)$/);
    if (encodedObjectPathMatch?.[1]) {
      return decodeURIComponent(encodedObjectPathMatch[1]).replace(/^\/+/, "");
    }

    if (parsed.hostname === "storage.googleapis.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return decodeURIComponent(parts.slice(1).join("/")).replace(/^\/+/, "");
      }
    }
  } catch (_error) {
    return "";
  }

  return "";
};

const normalizeStoragePath = (value) =>
  String(value || "")
    .trim()
    .replace(/^\/+/, "");

const toLibraryAssetDocId = (pathOrStableKey) => {
  const normalized = String(pathOrStableKey || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return `asset_${Date.now().toString(36)}`;
  }
  const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 16);
  return `asset_${hash}`;
};

const buildFirebaseDownloadUrl = (bucketName, objectPath, metadata = {}) => {
  const normalizedPath = normalizeStoragePath(objectPath);
  if (!bucketName || !normalizedPath) return "";
  const encodedPath = encodeURIComponent(normalizedPath);
  const tokenField = String(metadata?.firebaseStorageDownloadTokens || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)[0];
  const tokenQuery = tokenField ? `&token=${encodeURIComponent(tokenField)}` : "";
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media${tokenQuery}`;
};

const inferImageNameFromPath = (path) => {
  const normalizedPath = normalizeStoragePath(path);
  if (!normalizedPath) return "Image";
  const fileName = normalizedPath.split("/").pop() || "Image";
  return fileName.replace(/[_-]+/g, " ").trim() || fileName;
};

const inferImageContentTypeFromPath = (path) => {
  const normalizedPath = normalizeStoragePath(path).toLowerCase();
  if (normalizedPath.endsWith(".png")) return "image/png";
  if (normalizedPath.endsWith(".webp")) return "image/webp";
  if (normalizedPath.endsWith(".jpg") || normalizedPath.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return "image/jpeg";
};

const collectTypeImageSourcesFromDoc = (docData = {}) => {
  const sources = [];
  const images = Array.isArray(docData.images) ? docData.images : [];

  images.forEach((image, index) => {
    const path = normalizeStoragePath(
      image?.path || extractPathFromFirebaseDownloadUrl(image?.url)
    );
    const url = String(image?.url || "").trim();
    if (!path && !url) return;
    sources.push({
      assetId: String(image?.assetId || "").trim(),
      path,
      url,
      name: String(image?.name || "").trim() || `Image ${index + 1}`,
      contentType: "",
      sizeBytes: null,
      width: null,
      height: null,
      source: "backfill",
    });
  });

  const legacyPath = normalizeStoragePath(docData.imagePath);
  const legacyUrl = String(docData.imageUrl || "").trim();
  if (legacyPath || legacyUrl) {
    sources.push({
      assetId: "",
      path: legacyPath || normalizeStoragePath(extractPathFromFirebaseDownloadUrl(legacyUrl)),
      url: legacyUrl,
      name: String(docData.imageName || "").trim() || "Image 1",
      contentType: "",
      sizeBytes: null,
      width: null,
      height: null,
      source: "backfill",
    });
  }

  return sources.filter((entry) => entry.path || entry.url);
};

const optimizeImageBufferKeepingFormat = async (buffer, contentType) => {
  const normalizedType = normalizeContentType(contentType);
  const base = sharp(buffer, { failOn: "none" }).rotate().resize({
    width: TYPE_IMAGE_MAX_EDGE,
    height: TYPE_IMAGE_MAX_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });

  if (normalizedType === "image/jpeg") {
    return {
      contentType: "image/jpeg",
      buffer: await base.jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
    };
  }

  if (normalizedType === "image/png") {
    return {
      contentType: "image/png",
      buffer: await base
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    };
  }

  if (normalizedType === "image/webp") {
    return {
      contentType: "image/webp",
      buffer: await base.webp({ quality: 82 }).toBuffer(),
    };
  }

  throw new Error(`Unsupported image type: ${contentType || "unknown"}`);
};

const optimizeStorageImageObject = async ({ bucketName, objectPath, force }) => {
  const normalizedPath = String(objectPath || "").trim().replace(/^\/+/, "");
  if (!isTypeImagePath(normalizedPath)) {
    return { status: "skipped", reason: "not_type_image_path" };
  }

  const bucket = bucketName
    ? admin.storage().bucket(bucketName)
    : admin.storage().bucket();
  const file = bucket.file(normalizedPath);
  const [metadata] = await file.getMetadata();
  const contentType = normalizeContentType(metadata.contentType);

  if (!isSupportedImageType(contentType)) {
    return { status: "skipped", reason: "unsupported_type" };
  }

  const existingCustomMetadata = { ...(metadata.metadata || {}) };
  if (!force && existingCustomMetadata.tcfOptimized === "1") {
    return { status: "skipped", reason: "already_optimized" };
  }

  const [originalBuffer] = await file.download();
  const optimizedOutput = await optimizeImageBufferKeepingFormat(
    originalBuffer,
    contentType
  );
  const finalBuffer =
    optimizedOutput.buffer.length < originalBuffer.length
      ? optimizedOutput.buffer
      : originalBuffer;
  const finalContentType =
    finalBuffer === optimizedOutput.buffer
      ? optimizedOutput.contentType
      : contentType;

  await file.save(finalBuffer, {
    resumable: false,
    metadata: {
      contentType: finalContentType,
      cacheControl: TYPE_IMAGE_CACHE_CONTROL,
      metadata: {
        ...existingCustomMetadata,
        tcfOptimized: "1",
        tcfOptimizedAt: new Date().toISOString(),
      },
    },
  });

  return {
    status: "optimized",
    originalBytes: originalBuffer.length,
    optimizedBytes: finalBuffer.length,
    reduced: finalBuffer.length < originalBuffer.length,
  };
};

const collectTypeImagePathsFromDoc = (docData = {}) => {
  const found = [];
  const images = Array.isArray(docData.images) ? docData.images : [];

  images.forEach((image) => {
    const explicitPath = String(image?.path || "").trim();
    if (explicitPath) {
      found.push(explicitPath);
      return;
    }
    const fallbackPath = extractPathFromFirebaseDownloadUrl(image?.url);
    if (fallbackPath) found.push(fallbackPath);
  });

  const legacyPath = String(docData.imagePath || "").trim();
  if (legacyPath) {
    found.push(legacyPath);
  } else {
    const legacyUrlPath = extractPathFromFirebaseDownloadUrl(docData.imageUrl);
    if (legacyUrlPath) found.push(legacyUrlPath);
  }

  return found
    .map((path) => String(path || "").trim().replace(/^\/+/, ""))
    .filter(Boolean);
};

const loadStorageObjectMetadata = async (path) => {
  const normalizedPath = normalizeStoragePath(path);
  if (!normalizedPath) return null;
  try {
    const file = admin.storage().bucket().file(normalizedPath);
    const [metadata] = await file.getMetadata();
    return metadata || null;
  } catch (_error) {
    return null;
  }
};

const buildLibraryAssetPayload = async ({
  entry,
  fallbackPath,
  fallbackUrl,
  fallbackName,
  source = "backfill",
  createdByUid = "",
  createdByEmail = "",
}) => {
  const path = normalizeStoragePath(entry?.path || fallbackPath);
  const metadata = path ? await loadStorageObjectMetadata(path) : null;
  const contentType =
    String(entry?.contentType || metadata?.contentType || "").trim() ||
    inferImageContentTypeFromPath(path);
  const sizeBytesRaw =
    entry?.sizeBytes ??
    metadata?.size ??
    metadata?.sizeBytes ??
    metadata?.metadata?.sizeBytes;
  const sizeBytes = Number(sizeBytesRaw);
  const widthRaw = entry?.width ?? metadata?.metadata?.width;
  const heightRaw = entry?.height ?? metadata?.metadata?.height;
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  const url =
    String(entry?.url || fallbackUrl || "").trim() ||
    buildFirebaseDownloadUrl(metadata?.bucket || admin.storage().bucket().name, path, metadata?.metadata);

  return {
    name:
      String(entry?.name || fallbackName || "").trim() ||
      inferImageNameFromPath(path) ||
      "Image",
    url,
    path,
    contentType,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    createdByUid: String(createdByUid || "").trim(),
    createdByEmail: String(createdByEmail || "").trim(),
    source: source === "backfill" ? "backfill" : "upload",
  };
};

const collectLibraryUsageForAsset = async ({ assetId, path }) => {
  const normalizedAssetId = String(assetId || "").trim();
  const normalizedPath = normalizeStoragePath(path);
  const usages = [];
  const collections = ["eggTypes", "livestockTypes"];

  for (const collectionName of collections) {
    const snapshot = await db.collection(collectionName).get();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const images = Array.isArray(data.images) ? data.images : [];
      const matches = images.filter((image) => {
        const imageAssetId = String(image?.assetId || "").trim();
        const imagePath = normalizeStoragePath(image?.path);
        return (
          (normalizedAssetId && imageAssetId === normalizedAssetId) ||
          (normalizedPath && imagePath === normalizedPath)
        );
      });
      if (matches.length === 0) return;
      usages.push({
        collection: collectionName,
        typeId: docSnap.id,
        title: String(data.title || data.label || "").trim() || "Unnamed",
        count: matches.length,
      });
    });
  }

  return usages;
};

const getCustomerName = (order) => {
  const full = [order?.name, order?.surname].filter(Boolean).join(" ").trim();
  return full || "Customer";
};

const getOrderStatusLabel = (status) =>
  ORDER_STATUS_LABELS[status] || status || "-";

const getPaidLabel = (order) => {
  const raw = order?.paid;
  if (raw === true) return "Yes";
  if (raw === false) return "No";
  if (raw === null || raw === undefined) return "No";
  const normalized = String(raw).trim().toLowerCase();
  if (["yes", "paid", "true"].includes(normalized)) return "Yes";
  if (["no", "unpaid", "false"].includes(normalized)) return "No";
  return String(raw);
};

const getUnitPrice = (item) => {
  const special = item?.specialPrice;
  const specialValue = toNumber(special);
  if (special === null || special === undefined || specialValue === 0) {
    return toNumber(item?.price);
  }
  return specialValue;
};

const buildItemBreakdownHtml = (items) => {
  const lines = (Array.isArray(items) ? items : [])
    .filter((item) => toNumber(item.quantity) > 0)
    .map((item) => {
      const qty = toNumber(item.quantity);
      const unitPrice = getUnitPrice(item);
      const lineTotal = unitPrice * qty;
      return `${escapeHtml(item.label)} x ${qty} @ ${formatCurrency(
        unitPrice
      )} = ${formatCurrency(lineTotal)}`;
    });
  return lines.length ? lines.join("<br/>") : "No items listed.";
};

const buildItemBreakdownListHtml = (items) => {
  const lines = (Array.isArray(items) ? items : [])
    .filter((item) => toNumber(item.quantity) > 0)
    .map((item) => {
      const qty = toNumber(item.quantity);
      const unitPrice = getUnitPrice(item);
      const lineTotal = unitPrice * qty;
      return `<li>${escapeHtml(item.label)} x ${qty} @ ${formatCurrency(
        unitPrice
      )} = ${formatCurrency(lineTotal)}</li>`;
    });
  if (lines.length === 0) return "<li>No items listed.</li>";
  return lines.join("");
};

const buildEmailHeaderHtml = () => `
  <div style="margin-bottom:12px; text-align:center;">
    <div style="display:inline-flex; align-items:center; justify-content:center; gap:12px;">
      <img src="${BRAND_LOGO_URL}" alt="${BRAND_NAME}" style="height:80px; width:auto; border-radius:12px; border:1px solid #e2e8f0;" />
      <span style="font-weight:700; color:#0f172a; font-size:20px;">${BRAND_NAME}</span>
    </div>
  </div>
`;

const buildEmailHtml = ({ title, intro, preheader, body, footer }) => `
  <!DOCTYPE html>
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
      <title>${escapeHtml(title || BRAND_NAME)}</title>
      <style>${EMAIL_STYLES}</style>
    </head>
    <body>
      <div class="container">
        ${
          preheader
            ? `<span style="display:none; font-size:1px; color:#f8fafc; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${escapeHtml(
                preheader
              )}</span>`
            : ""
        }
        ${intro ? `<p class="muted" style="margin-top:0;">${escapeHtml(intro)}</p>` : ""}
        ${buildEmailHeaderHtml()}
        ${title ? `<h2>${escapeHtml(title)}</h2>` : ""}
        ${body || ""}
        ${footer || ""}
      </div>
    </body>
  </html>
`;

const buildPaymentSectionHtml = (orderNumber) => {
  const reference = orderNumber
    ? `your name or order number (${escapeHtml(orderNumber)})`
    : "your name";
  return `
    <div class="divider"></div>
    <h3 style="margin: 0 0 8px;">Payment</h3>
    <p>We are an <strong>EFT and Cash Only</strong> business. Please use the details below to make an EFT payment:</p>
    <p style="margin: 0;"><strong>Bank:</strong> ${PAYMENT_DETAILS.bank}</p>
    <p style="margin: 0;"><strong>Account Name:</strong> ${PAYMENT_DETAILS.accountName}</p>
    <p style="margin: 0;"><strong>Account Type:</strong> ${PAYMENT_DETAILS.accountType}</p>
    <p style="margin: 0;"><strong>Account Number:</strong> ${PAYMENT_DETAILS.accountNumber}</p>
    <p style="margin: 0 0 4px 0;"><strong>Branch Code:</strong> ${PAYMENT_DETAILS.branchCode}</p>
    <p class="muted">Reference: ${reference}</p>
  `;
};

const buildIndemnitySectionHtml = ({ includeEggRestNotice = false } = {}) => `
  <div class="divider"></div>
  <h3 style="margin: 0 0 8px;">Indemnity</h3>
  <p>${escapeHtml(INDEMNITY_TEXT).replace(/\n/g, "<br/>")}</p>
  ${
    includeEggRestNotice
      ? `<p><strong>${escapeHtml(EGG_REST_NOTICE_TEXT)}</strong></p>`
      : ""
  }
  <p class="muted">By submitting an order you accept these terms.</p>
`;

const buildOrderSummaryCard = ({
  heading,
  items,
  totals,
  collectionName,
  paidLabel,
}) => {
  const itemLabel = collectionName === "livestockOrders" ? "Items" : "Eggs";
  const paidLine = paidLabel
    ? `<p><strong>Paid:</strong> ${escapeHtml(paidLabel)}</p>`
    : "";
  return `
    <div class="summary">
      <h3 style="margin: 0 0 8px;">${escapeHtml(heading)}</h3>
      <p style="margin: 0 0 8px;">${buildItemBreakdownHtml(items)}</p>
      <p><strong>${itemLabel} total:</strong> ${formatCurrency(totals.subtotal)}</p>
      <p><strong>Delivery:</strong> ${formatCurrency(totals.delivery)}</p>
      <p class="total">Grand total: ${formatCurrency(totals.total)}</p>
      ${paidLine}
    </div>
  `;
};

const buildInvoiceNumber = (order) => {
  if (order.invoiceNumber) return String(order.invoiceNumber);
  if (order.orderNumber) {
    const normalized = String(order.orderNumber).replace("#", "");
    return `INV-${normalized}`;
  }
  if (order.id) {
    return `INV-${String(order.id).slice(-6).toUpperCase()}`;
  }
  return `INV-${Date.now()}`;
};

const getRoleFromContext = (context) => {
  const email = context.auth?.token?.email?.toLowerCase?.() ?? "";
  const claimRole = context.auth?.token?.role ?? null;
  if (claimRole) return claimRole;
  if (BOOTSTRAP_ADMINS.includes(email)) return "admin";
  return null;
};

const requireAdmin = (context) => {
  const role = getRoleFromContext(context);
  if (role !== "admin" && role !== "super_admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin access required."
    );
  }
};

const requireStaff = (context) => {
  const role = getRoleFromContext(context);
  if (role !== "admin" && role !== "super_admin" && role !== "worker") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Staff access required."
    );
  }
};

const normalizeString = (value, maxLength = 500) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const normalizePublicFormType = (value) => {
  const formType = normalizeString(value, 20).toLowerCase();
  if (!PUBLIC_ORDER_FORM_TYPES.has(formType)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "formType must be eggs or livestock."
    );
  }
  return formType;
};

const normalizeIdempotencyKey = (value) => {
  const key = normalizeString(value, 128);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "idempotencyKey must be 16-128 chars using letters, numbers, _ or -."
    );
  }
  return key;
};

const normalizeOrderDateIso = (value) => {
  const raw = normalizeString(value, 20);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Send date must use YYYY-MM-DD."
    );
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
};

const normalizeEmail = (value) => {
  const email = normalizeString(value, 160).toLowerCase();
  if (!email) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Email format is invalid."
    );
  }
  return email;
};

const normalizeCellphone = (value) => {
  const cellphone = normalizeString(value, 32);
  if (!cellphone) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Cellphone number is required."
    );
  }
  if (!/^(\+\d{1,4}\s+)?(\d{9}|0\d{9})$/.test(cellphone)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Cellphone format is invalid."
    );
  }
  return cellphone;
};

const normalizeWhatsapp = (value) => {
  const whatsapp = normalizeString(value, 32);
  if (!whatsapp) return "";
  const digits = whatsapp.replace(/[^\d]/g, "");
  if (digits.length < 9 || digits.length > 15) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "WhatsApp number looks invalid."
    );
  }
  return whatsapp;
};

const normalizeLineItems = (lineItems) => {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "At least one line item is required."
    );
  }

  const normalizedItems = lineItems
    .map((item, index) => {
      const id = normalizeString(item?.id, 120);
      const label = normalizeString(item?.label, 200);
      const quantity = Math.max(0, toNumber(item?.quantity));
      const price = Math.max(0, toNumber(item?.price));
      const priceType = normalizeString(item?.priceType, 20) || "normal";

      if (!id || !label || !quantity) return null;
      return {
        id,
        label,
        quantity,
        price,
        specialPrice: null,
        priceType,
        order: index,
      };
    })
    .filter(Boolean);

  if (normalizedItems.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "At least one valid line item is required."
    );
  }

  return normalizedItems;
};

const resolvePublicOrderCollection = (formType) =>
  formType === "livestock" ? "livestockOrders" : "eggOrders";

const normalizeClientMeta = (value = {}) => ({
  appVersion: normalizeString(value.appVersion, 50),
  timezone: normalizeString(value.timezone, 80),
  locale: normalizeString(value.locale, 30),
  onlineStatus: normalizeString(value.onlineStatus, 20),
});

const serializePublicOrderError = (error) => {
  let details = "";
  if (error?.details !== undefined) {
    try {
      details = normalizeString(JSON.stringify(error.details), 4000);
    } catch (_serializationError) {
      details = normalizeString(String(error.details), 4000);
    }
  }

  return {
    code: normalizeString(error?.code, 120),
    message: normalizeString(error?.message, 2000) || "Unknown error.",
    details,
    stack: normalizeString(error?.stack, 8000),
  };
};

const logPublicOrderError = async ({
  context,
  target = "",
  formType = "",
  collectionName = "",
  orderId = "",
  orderNumber = "",
  idempotencyKey = "",
  error,
}) => {
  try {
    await db.collection(PUBLIC_ORDER_ERRORS_COLLECTION).add({
      context: normalizeString(context, 120),
      target: normalizeString(target, 120),
      formType: normalizeString(formType, 20),
      collectionName: normalizeString(collectionName, 40),
      orderId: normalizeString(orderId, 120),
      orderNumber: normalizeString(orderNumber, 40),
      idempotencyKey: normalizeString(idempotencyKey, 128),
      error: serializePublicOrderError(error),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (logFailure) {
    console.error("public order error log failed", logFailure);
  }
};

const buildPublicOrderPayload = (input) => {
  const formType = normalizePublicFormType(input?.formType);
  const collectionName = resolvePublicOrderCollection(formType);
  const idempotencyKey = normalizeIdempotencyKey(input?.idempotencyKey);
  const draftId = normalizeString(input?.draftId, 120) || null;
  const contact = input?.contact || {};
  const address = input?.address || {};
  const delivery = input?.delivery || {};
  const lineItems = normalizeLineItems(input?.lineItems);
  const clientMeta = normalizeClientMeta(input?.clientMeta);

  const name = normalizeString(contact.name, 120);
  const surname = normalizeString(contact.surname, 120);
  if (!name || !surname) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Name and surname are required."
    );
  }

  const email = normalizeEmail(contact.email);
  const whatsapp = normalizeWhatsapp(contact.whatsapp);
  if (!email && !whatsapp) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Provide either an email address or a WhatsApp number."
    );
  }

  const cellphone = normalizeCellphone(contact.cellphone);
  const sendDate = normalizeOrderDateIso(delivery.sendDate);
  const indemnityAccepted = Boolean(input?.indemnityAccepted);
  if (!indemnityAccepted) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Indemnity acceptance is required."
    );
  }

  const streetAddress = normalizeString(address.streetAddress, 200);
  const suburb = normalizeString(address.suburb, 120);
  const city = normalizeString(address.city, 120);
  const province = normalizeString(address.province, 120);
  const postalCode = normalizeString(address.postalCode, 32);
  const pudoBoxName = normalizeString(address.pudoBoxName, 160);
  const addressLine = [
    streetAddress,
    suburb,
    city,
    [province, postalCode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const fullAddress = pudoBoxName
    ? `${addressLine} | PUDO Box: ${pudoBoxName}`
    : addressLine;

  const deliveryOptionId = normalizeString(delivery.deliveryOptionId, 120);
  const deliveryOption = normalizeString(delivery.deliveryOption, 200);
  const deliveryCost = Math.max(0, toNumber(delivery.deliveryCost));
  const otherDelivery = normalizeString(delivery.otherDelivery, 200);

  return {
    formType,
    collectionName,
    idempotencyKey,
    draftId,
    payload: {
      name,
      surname,
      email,
      whatsapp,
      cellphone,
      address: fullAddress,
      streetAddress,
      suburb,
      city,
      province,
      postalCode,
      pudoBoxName,
      deliveryOptionId,
      deliveryOption,
      deliveryCost,
      otherDelivery,
      sendDate,
      eggs: lineItems,
      notes: normalizeString(input?.notes, 2000),
      allowEggSubstitutions:
        formType === "livestock"
          ? false
          : input?.allowEggSubstitutions !== false,
      formType,
      orderStatus: "pending",
      fulfilledEggs: [],
      trackingLink: "",
      paid: false,
      indemnityAccepted: true,
      indemnityAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      idempotencyKey,
      draftId,
      submissionSource: "callable:createPublicOrder",
      submittedAtClient: normalizeString(input?.submittedAtClient, 60),
      clientVersion: clientMeta.appVersion,
      networkState: clientMeta.onlineStatus,
      schemaVersion: PUBLIC_ORDER_SCHEMA_VERSION,
    },
  };
};

const getResendClient = () => {
  const apiKey =
    process.env.RESEND_API_KEY || functions.config()?.resend?.api_key;
  return apiKey ? new Resend(apiKey) : null;
};

const getResendFrom = () => {
  return (
    process.env.RESEND_FROM ||
    functions.config()?.resend?.from ||
    "The Crooked Fence <no-reply@thecrookedfence.co.za>"
  );
};

const getAdminRecipients = () => {
  const email =
    process.env.ADMIN_EMAIL || functions.config()?.admin?.email || "";
  if (!email) return [];
  const recipients = String(email)
    .split(/[;,\s]+/)
    .map((address) => address.trim())
    .filter(
      (address) => address && !ADMIN_EMAIL_EXCLUSIONS.has(address.toLowerCase())
    );
  return recipients.length > 0 ? recipients : ADMIN_EMAIL_FALLBACKS;
};

const sendEmail = async ({ to, subject, html, text }) => {
  const resend = getResendClient();
  if (!resend) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Resend API key is not configured."
    );
  }
  const recipients = Array.isArray(to) ? to : [to];
  const filtered = recipients.filter(Boolean);
  if (filtered.length === 0) return null;

  return resend.emails.send({
    from: getResendFrom(),
    to: filtered,
    subject,
    html,
    text,
  });
};

const getOrderItems = (order) => (Array.isArray(order.eggs) ? order.eggs : []);

const calculateOrderTotals = (order) => {
  const items = getOrderItems(order);
  const subtotal = items.reduce((sum, item) => {
    const qty = toNumber(item.quantity);
    if (!qty) return sum;
    const special = item.specialPrice;
    const unitPrice =
      special === null || special === undefined || toNumber(special) === 0
        ? toNumber(item.price)
        : toNumber(special);
    return sum + unitPrice * qty;
  }, 0);
  const delivery = toNumber(order.deliveryCost);
  return { subtotal, delivery, total: subtotal + delivery };
};

const buildItemSummary = (items) => {
  const lines = items
    .filter((item) => toNumber(item.quantity) > 0)
    .map((item) => `${item.label} x ${item.quantity}`);
  return lines.length ? lines.join(", ") : "No items listed";
};

const buildItemListHtml = (items) => buildItemBreakdownListHtml(items);

const assignOrderNumber = async (collectionName, orderRef) => {
  const counterRef = db.collection("orderCounters").doc(collectionName);
  const nextNumber = await db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    let lastNumber = 0;
    if (counterSnap.exists) {
      lastNumber = toNumber(counterSnap.data().lastNumber);
    } else {
      const latestQuery = db
        .collection(collectionName)
        .orderBy("orderNumber", "desc")
        .limit(1);
      const latestSnap = await tx.get(latestQuery);
      if (!latestSnap.empty) {
        lastNumber = parseOrderNumber(latestSnap.docs[0].data().orderNumber);
      }
    }
    const next = lastNumber + 1;
    tx.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });
  const formatted = formatOrderNumber(nextNumber);
  await orderRef.set({ orderNumber: formatted }, { merge: true });
  return formatted;
};

const ensureOrderNumber = async (collectionName, orderRef, orderData) => {
  if (orderData.orderNumber) return orderData.orderNumber;
  return assignOrderNumber(collectionName, orderRef);
};

const sendOrderCreatedEmails = async ({
  order,
  collectionName,
  orderRef = null,
  formType = "",
  idempotencyKey = "",
}) => {
  const items = getOrderItems(order);
  const totals = calculateOrderTotals(order);
  const name = getCustomerName(order);
  const orderNumber = order.orderNumber || "";
  const orderNumberLabel = orderNumber ? ` ${orderNumber}` : "";
  const deliveryLabel = order.deliveryOption || "";
  const sendDate = order.sendDate || "";
  const notes = order.notes || "";
  const statusLabel = getOrderStatusLabel(order.orderStatus || "pending");
  const paidLabel = getPaidLabel(order);
  const orderTypeLabel =
    collectionName === "livestockOrders" ? "livestock" : "egg";
  const intro = `We’ve received your ${orderTypeLabel} order and will keep you updated.`;
  const whatsappLine = `Please follow up via WhatsApp (${WHATSAPP_NUMBER}) for order updates and to confirm payment by sending proof of payment.`;

  const summaryCard = buildOrderSummaryCard({
    heading: "Your order",
    items,
    totals,
    collectionName,
    paidLabel,
  });

  const detailLines = `
    ${deliveryLabel ? `<p><strong>Delivery option:</strong> ${escapeHtml(deliveryLabel)}</p>` : ""}
    ${sendDate ? `<p><strong>Send date:</strong> ${escapeHtml(sendDate)}</p>` : ""}
    ${orderNumber ? `<p><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p>` : ""}
    <p><strong>Status:</strong> ${escapeHtml(statusLabel)}</p>
    ${notes ? `<p><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ""}
    <p class="muted">If you need to change anything, reply to this email.</p>
    <p class="muted">${escapeHtml(whatsappLine)}</p>
  `;

  const customerBody = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(intro)}</p>
    ${summaryCard}
    ${detailLines}
    ${buildPaymentSectionHtml(orderNumber)}
    ${buildIndemnitySectionHtml({
      includeEggRestNotice: collectionName === "eggOrders",
    })}
  `;

  const customerHtml = buildEmailHtml({
    title: "Thank you for your order!",
    intro,
    preheader: intro,
    body: customerBody,
  });

  const adminRecipients = getAdminRecipients();
  const adminIntro = `A new ${orderTypeLabel} order has been placed.`;
  const adminSummary = buildOrderSummaryCard({
    heading: "Order summary",
    items,
    totals,
    collectionName,
    paidLabel,
  });
  const adminBody = `
    <p><strong>Customer:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(order.email || "-")}</p>
    <p><strong>Cellphone:</strong> ${escapeHtml(order.cellphone || "-")}</p>
    <p><strong>Address:</strong> ${escapeHtml(order.address || "-")}</p>
    ${adminSummary}
    ${deliveryLabel ? `<p><strong>Delivery option:</strong> ${escapeHtml(deliveryLabel)}</p>` : ""}
    ${sendDate ? `<p><strong>Send date:</strong> ${escapeHtml(sendDate)}</p>` : ""}
    ${orderNumber ? `<p><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p>` : ""}
    <p><strong>Status:</strong> ${escapeHtml(statusLabel)}</p>
    ${notes ? `<p><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ""}
    <p><strong>Items:</strong></p>
    <ul>${buildItemListHtml(items)}</ul>
    <p><strong>Order ID:</strong> ${escapeHtml(order.id || "-")}</p>
  `;

  const adminHtml = buildEmailHtml({
    title: `New ${orderTypeLabel} order${orderNumberLabel}`,
    intro: adminIntro,
    preheader: adminIntro,
    body: adminBody,
  });

  const customerEmailResult = {
    status: order.email ? "failed" : "not_requested",
    errorMessage: "",
  };
  const adminEmailResult = {
    status: adminRecipients.length > 0 ? "failed" : "not_requested",
    errorMessage: "",
  };

  if (order.email) {
    try {
      await sendEmail({
        to: [order.email],
        subject: `Your order${orderNumberLabel} with ${BRAND_NAME}`,
        html: customerHtml,
      });
      customerEmailResult.status = "sent";
    } catch (error) {
      customerEmailResult.errorMessage =
        normalizeString(error?.message, 500) || "Unable to send confirmation email.";
      await logPublicOrderError({
        context: "order_created_email",
        target: "customer_confirmation",
        formType,
        collectionName,
        orderId: order.id,
        orderNumber,
        idempotencyKey,
        error,
      });
    }
  }

  if (adminRecipients.length > 0) {
    try {
      await sendEmail({
        to: adminRecipients,
        subject: `New ${orderTypeLabel} order${orderNumberLabel}`,
        html: adminHtml,
      });
      adminEmailResult.status = "sent";
    } catch (error) {
      adminEmailResult.errorMessage =
        normalizeString(error?.message, 500) || "Unable to send admin notification email.";
      await logPublicOrderError({
        context: "order_created_email",
        target: "admin_notification",
        formType,
        collectionName,
        orderId: order.id,
        orderNumber,
        idempotencyKey,
        error,
      });
    }
  }

  if (orderRef) {
    try {
      await orderRef.set(
        {
          customerConfirmationEmailStatus: customerEmailResult.status,
          customerConfirmationEmailError: customerEmailResult.errorMessage,
          adminNotificationEmailStatus: adminEmailResult.status,
          adminNotificationEmailError: adminEmailResult.errorMessage,
          orderCreatedEmailAttemptedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      await logPublicOrderError({
        context: "order_created_email_status",
        target: "order_status_update",
        formType,
        collectionName,
        orderId: order.id,
        orderNumber,
        idempotencyKey,
        error,
      });
    }
  }

  return {
    customerEmailStatus: customerEmailResult.status,
    adminEmailStatus: adminEmailResult.status,
  };
};

const sendOrderStatusEmails = async ({
  order,
  previousStatus,
  nextStatus,
  collectionName,
}) => {
  const suppressed = new Set(["archived", "cancelled"]);
  if (!nextStatus || suppressed.has(nextStatus)) return;

  const items = getOrderItems(order);
  const totals = calculateOrderTotals(order);
  const name = getCustomerName(order);
  const orderNumber = order.orderNumber || "";
  const orderNumberLabel = orderNumber ? ` ${orderNumber}` : "";
  const statusLabel = getOrderStatusLabel(nextStatus);
  const trackingLink = normalizeUrl(order.trackingLink || "");
  const deliveryLabel = order.deliveryOption || "";
  const sendDate = order.sendDate || "";
  const intro = `Your order status has been updated to ${statusLabel}.`;
  const paidLabel = getPaidLabel(order);
  const summaryCard = buildOrderSummaryCard({
    heading: "Order summary",
    items,
    totals,
    collectionName,
    paidLabel,
  });

  const trackingLine = trackingLink
    ? `<p><strong>Tracking:</strong> <a href="${escapeHtml(trackingLink)}">${escapeHtml(
        trackingLink
      )}</a></p>`
    : "";

  const customerBody = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your order${orderNumberLabel} status has been updated.</p>
    <p><span class="pill">${escapeHtml(statusLabel)}</span></p>
    ${summaryCard}
    ${deliveryLabel ? `<p><strong>Delivery option:</strong> ${escapeHtml(deliveryLabel)}</p>` : ""}
    ${sendDate ? `<p><strong>Send date:</strong> ${escapeHtml(sendDate)}</p>` : ""}
    ${trackingLine}
    <p class="muted">If you have questions, reply to this email.</p>
    ${buildIndemnitySectionHtml({
      includeEggRestNotice: collectionName === "eggOrders",
    })}
  `;

  const customerHtml = buildEmailHtml({
    title: "Order status update",
    intro,
    preheader: intro,
    body: customerBody,
  });

  const adminRecipients = getAdminRecipients();
  const adminIntro = `Order status updated to ${statusLabel}.`;
  const adminBody = `
    <p><strong>Order:</strong> ${escapeHtml(orderNumber || order.id || "-")}</p>
    <p><strong>Customer:</strong> ${escapeHtml(name)}</p>
    <p><strong>Previous status:</strong> ${escapeHtml(
      getOrderStatusLabel(previousStatus)
    )}</p>
    <p><strong>New status:</strong> ${escapeHtml(statusLabel)}</p>
    ${trackingLine}
    ${summaryCard}
  `;

  const adminHtml = buildEmailHtml({
    title: `Order status updated${orderNumberLabel}`,
    intro: adminIntro,
    preheader: adminIntro,
    body: adminBody,
  });

  if (order.email) {
    await sendEmail({
      to: [order.email],
      subject: `Your order${orderNumberLabel} status update`,
      html: customerHtml,
    });
  }

  if (adminRecipients.length > 0) {
    await sendEmail({
      to: adminRecipients,
      subject: `Order status updated${orderNumberLabel}`,
      html: adminHtml,
    });
  }
};

const loadStockData = async () => {
  const [itemsSnap, categoriesSnap] = await Promise.all([
    db.collection("stockItems").orderBy("name", "asc").get(),
    db.collection("stockCategories").orderBy("name", "asc").get(),
  ]);

  const categoryLookup = new Map();
  categoriesSnap.forEach((docSnap) => {
    categoryLookup.set(docSnap.id, docSnap.data().name || "Uncategorized");
  });

  const items = itemsSnap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      name: data.name || "Unnamed",
      category: categoryLookup.get(data.categoryId) || data.category || "",
      subCategory: data.subCategory || "",
      quantity: toNumber(data.quantity),
      threshold: toNumber(data.threshold),
      notes: data.notes || "",
    };
  });

  return items;
};

const buildStockSummaryHtml = (items, includeAll) => {
  const lowStock = items.filter(
    (item) => item.threshold > 0 && item.quantity <= item.threshold
  );
  const list = includeAll ? items : lowStock;

  const listHtml = list.length
    ? `<ul>${list
        .map((item) => {
          const categoryLabel = [item.category, item.subCategory]
            .filter(Boolean)
            .join(" / ");
          const label = categoryLabel
            ? `${escapeHtml(item.name)} (${escapeHtml(categoryLabel)})`
            : escapeHtml(item.name);
          const lowFlag =
            item.threshold > 0 && item.quantity <= item.threshold
              ? " <strong>(LOW)</strong>"
              : "";
          return `<li>${label}: ${item.quantity} (threshold ${item.threshold || "-"})${lowFlag}</li>`;
        })
        .join("")}</ul>`
    : "<p>No items to report.</p>";

  return `
    <div class="summary">
      <p><strong>Total items:</strong> ${items.length}</p>
      <p><strong>Low stock items:</strong> ${lowStock.length}</p>
      ${listHtml}
    </div>
  `;
};

const sendStockSummaryEmail = async ({ title, includeAll }) => {
  const items = await loadStockData();
  const adminRecipients = getAdminRecipients();
  if (adminRecipients.length === 0) return null;

  const intro = "Here is the latest stock summary report.";
  const html = buildEmailHtml({
    title,
    intro,
    preheader: intro,
    body: buildStockSummaryHtml(items, includeAll),
  });

  return sendEmail({
    to: adminRecipients,
    subject: title,
    html,
  });
};
exports.sitemap = functions.https.onRequest(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.set("Allow", "GET, HEAD");
    res.status(405).send("Method Not Allowed");
    return;
  }

  const staticEntries = SITEMAP_STATIC_PATHS.map((path) => buildSitemapEntry(path));
  const dynamicEntries = [];

  try {
    const [eggTypesSnapshot, livestockTypesSnapshot] = await Promise.all([
      db.collection("eggTypes").get(),
      db.collection("livestockTypes").get(),
    ]);

    eggTypesSnapshot.docs
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((docSnap) => {
        const data = docSnap.data() || {};
        const lastmod = timestampToIso(data.updatedAt) || timestampToIso(data.imageUpdatedAt);
        dynamicEntries.push(buildSitemapEntry(`/eggs/${encodeURIComponent(docSnap.id)}`, lastmod));
      });

    livestockTypesSnapshot.docs
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((docSnap) => {
        const data = docSnap.data() || {};
        const lastmod = timestampToIso(data.updatedAt) || timestampToIso(data.imageUpdatedAt);
        dynamicEntries.push(buildSitemapEntry(`/livestock/${encodeURIComponent(docSnap.id)}`, lastmod));
      });
  } catch (error) {
    console.error("sitemap dynamic load error", error);
  }

  const xml = renderSitemapXml([...staticEntries, ...dynamicEntries]);
  res.set("Content-Type", "application/xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }

  res.status(200).send(xml);
});

exports.ensureCurrentUserProfile = functions.https.onCall(
  async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Sign in required."
      );
    }

    const uid = context.auth.uid;
    const email = context.auth.token.email || "";
    let role = getRoleFromContext(context) ?? null;

    const userRef = db.collection("users").doc(uid);
    const snapshot = await userRef.get();
    const existingRole = snapshot.exists ? snapshot.data()?.role ?? null : null;
    const allowedRoles = new Set(["worker", "admin", "super_admin"]);

    if (!role && allowedRoles.has(String(existingRole || "").trim())) {
      role = String(existingRole || "").trim();
    }

    if (!snapshot.exists) {
      await userRef.set({
        email,
        role,
        disabled: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      await userRef.set(
        {
          email,
          role: role ?? existingRole ?? null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const tokenRole = String(context.auth.token.role || "").trim();
    if (role && tokenRole !== role) {
      const userRecord = await admin.auth().getUser(uid);
      const claims = { ...(userRecord.customClaims || {}), role };
      await admin.auth().setCustomUserClaims(uid, claims);
    }

    return { uid, email, role };
  }
);

exports.savePublicOrderDraft = functions.https.onCall(async (data) => {
  const formType = normalizePublicFormType(data?.formType);
  const draftPayload = data?.draft;
  if (!draftPayload || typeof draftPayload !== "object") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "draft payload is required."
    );
  }

  const draftId = normalizeString(data?.draftId, 120);
  const clientMeta = normalizeClientMeta(data?.clientMeta);
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + PUBLIC_DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  const draftRef = draftId
    ? db.collection(ORDER_DRAFTS_COLLECTION).doc(draftId)
    : db.collection(ORDER_DRAFTS_COLLECTION).doc();

  const existing = await draftRef.get();
  const currentResumeToken = existing.exists
    ? normalizeString(existing.data()?.resumeToken, 64)
    : "";
  const incomingResumeToken = normalizeString(data?.resumeToken, 64);
  if (existing.exists && incomingResumeToken && currentResumeToken) {
    if (incomingResumeToken !== currentResumeToken) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Invalid resume token."
      );
    }
  }

  const resumeToken =
    currentResumeToken ||
    createHash("sha1")
      .update(`${draftRef.id}_${Date.now()}_${Math.random()}`)
      .digest("hex")
      .slice(0, 32);

  const jsonDraft = JSON.stringify(draftPayload);
  if (jsonDraft.length > 120000) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Draft payload is too large."
    );
  }

  await draftRef.set(
    {
      formType,
      draft: draftPayload,
      draftHash: createHash("sha1").update(jsonDraft).digest("hex"),
      resumeToken,
      schemaVersion: PUBLIC_ORDER_SCHEMA_VERSION,
      submissionSource: "callable:savePublicOrderDraft",
      clientVersion: clientMeta.appVersion,
      networkState: clientMeta.onlineStatus,
      locale: clientMeta.locale,
      timezone: clientMeta.timezone,
      expiresAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: existing.exists
        ? existing.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    draftId: draftRef.id,
    resumeToken,
    expiresAt: expiresAt.toDate().toISOString(),
  };
});

exports.resumePublicOrderDraft = functions.https.onCall(async (data) => {
  const draftId = normalizeString(data?.draftId, 120);
  const resumeToken = normalizeString(data?.resumeToken, 64);
  if (!draftId || !resumeToken) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "draftId and resumeToken are required."
    );
  }

  const draftRef = db.collection(ORDER_DRAFTS_COLLECTION).doc(draftId);
  const snapshot = await draftRef.get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Draft not found.");
  }
  const payload = snapshot.data() || {};
  const storedResumeToken = normalizeString(payload.resumeToken, 64);
  if (!storedResumeToken || storedResumeToken !== resumeToken) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Invalid resume token."
    );
  }

  const expiresAtDate =
    payload.expiresAt?.toDate?.() ||
    (payload.expiresAt ? new Date(payload.expiresAt) : null);
  if (expiresAtDate && expiresAtDate.getTime() <= Date.now()) {
    await draftRef.delete();
    throw new functions.https.HttpsError("not-found", "Draft expired.");
  }

  return {
    draftId: snapshot.id,
    resumeToken: storedResumeToken,
    formType: PUBLIC_ORDER_FORM_TYPES.has(
      normalizeString(payload.formType, 20).toLowerCase()
    )
      ? normalizeString(payload.formType, 20).toLowerCase()
      : "eggs",
    draft: payload.draft || {},
    updatedAt: payload.updatedAt?.toDate?.()?.toISOString?.() || null,
  };
});

exports.createPublicOrder = functions.https.onCall(async (data) => {
  let prepared = null;
  let resolvedOrderId = "";
  let finalCollectionName = "";
  let orderNumber = "";

  try {
    prepared = buildPublicOrderPayload(data || {});
    const idempotencyRef = db
      .collection(ORDER_IDEMPOTENCY_COLLECTION)
      .doc(prepared.idempotencyKey);
    const newOrderRef = db.collection(prepared.collectionName).doc();

    const transactionResult = await db.runTransaction(async (tx) => {
      const existing = await tx.get(idempotencyRef);
      if (existing.exists) {
        const existingData = existing.data() || {};
        return {
          status: "duplicate",
          orderId: normalizeString(existingData.orderId, 120),
          collectionName:
            normalizeString(existingData.collectionName, 40) ||
            prepared.collectionName,
        };
      }

      tx.set(newOrderRef, prepared.payload);
      tx.set(
        idempotencyRef,
        {
          orderId: newOrderRef.id,
          collectionName: prepared.collectionName,
          draftId: prepared.draftId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        status: "created",
        orderId: newOrderRef.id,
        collectionName: prepared.collectionName,
      };
    });

    resolvedOrderId =
      transactionResult.orderId || normalizeString(data?.fallbackOrderId, 120);
    if (!resolvedOrderId) {
      throw new functions.https.HttpsError(
        "internal",
        "Unable to resolve order id."
      );
    }

    finalCollectionName =
      transactionResult.collectionName || prepared.collectionName;
    const finalOrderRef = db.collection(finalCollectionName).doc(resolvedOrderId);
    const finalOrderSnap = await finalOrderRef.get();
    if (!finalOrderSnap.exists) {
      throw new functions.https.HttpsError("internal", "Order write failed.");
    }
    const finalOrder = finalOrderSnap.data() || {};
    orderNumber = await ensureOrderNumber(
      finalCollectionName,
      finalOrderRef,
      finalOrder
    );

    if (prepared.draftId) {
      await db.collection(ORDER_DRAFTS_COLLECTION).doc(prepared.draftId).set(
        {
          submittedOrderId: resolvedOrderId,
          submittedOrderNumber: orderNumber,
          submittedCollection: finalCollectionName,
          submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    let customerEmailStatus = "not_attempted";
    if (transactionResult.status !== "duplicate") {
      try {
        const emailResult = await sendOrderCreatedEmails({
          order: { ...finalOrder, orderNumber, id: resolvedOrderId },
          collectionName: finalCollectionName,
          orderRef: finalOrderRef,
          formType: prepared.formType,
          idempotencyKey: prepared.idempotencyKey,
        });
        customerEmailStatus = emailResult.customerEmailStatus;
      } catch (error) {
        customerEmailStatus = finalOrder.email ? "failed" : "not_requested";
        await logPublicOrderError({
          context: "create_public_order_email",
          target: "email_pipeline",
          formType: prepared.formType,
          collectionName: finalCollectionName,
          orderId: resolvedOrderId,
          orderNumber,
          idempotencyKey: prepared.idempotencyKey,
          error,
        });
      }
    }

    return {
      status: transactionResult.status || "created",
      orderId: resolvedOrderId,
      orderNumber,
      customerEmailStatus,
    };
  } catch (error) {
    const isHttpsError = error instanceof functions.https.HttpsError;
    if (!isHttpsError || error.code !== "invalid-argument") {
      await logPublicOrderError({
        context: "create_public_order",
        target: "submission",
        formType: prepared?.formType || "",
        collectionName: finalCollectionName || prepared?.collectionName || "",
        orderId: resolvedOrderId,
        orderNumber,
        idempotencyKey: prepared?.idempotencyKey || "",
        error,
      });
    }
    if (isHttpsError) throw error;
    throw new functions.https.HttpsError(
      "internal",
      "Unable to place the order right now."
    );
  }
});

exports.createUserProfile = functions.auth.user().onCreate(async (user) => {
  const email = String(user.email || "").toLowerCase();
  let role = user.customClaims?.role ?? null;
  if (!role && BOOTSTRAP_ADMINS.includes(email)) {
    role = "admin";
    const claims = { ...(user.customClaims || {}) };
    if (!claims.role) {
      claims.role = role;
      await admin.auth().setCustomUserClaims(user.uid, claims);
    }
  }

  await db
    .collection("users")
    .doc(user.uid)
    .set(
      {
        email: user.email || "",
        role,
        disabled: Boolean(user.disabled),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
});

exports.createAuthUser = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const email = String(data.email || "")
    .trim()
    .toLowerCase();
  const role = String(data.role || "worker").trim();
  const password = String(data.password || "").trim();

  if (!email) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Email is required."
    );
  }

  const generatedPassword =
    password || `Temp${Math.random().toString(36).slice(-8)}!`;

  const userRecord = await admin.auth().createUser({
    email,
    password: generatedPassword,
  });

  await admin.auth().setCustomUserClaims(userRecord.uid, { role });

  await db.collection("users").doc(userRecord.uid).set({
    email,
    role,
    disabled: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    uid: userRecord.uid,
    temporaryPassword: password ? null : generatedPassword,
  };
});

exports.updateAuthUserStatus = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const uid = String(data.uid || "").trim();
  const disabled = Boolean(data.disabled);

  if (!uid) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "User id is required."
    );
  }

  await admin.auth().updateUser(uid, { disabled });

  await db.collection("users").doc(uid).set(
    {
      disabled,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { uid, disabled };
});

exports.updateAuthUserRole = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const uid = String(data.uid || "").trim();
  const role = String(data.role || "").trim();
  const allowedRoles = new Set(["worker", "admin", "super_admin"]);

  if (!uid || !allowedRoles.has(role)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Valid user id and role are required."
    );
  }

  const userRecord = await admin.auth().getUser(uid);
  const claims = { ...(userRecord.customClaims || {}), role };
  await admin.auth().setCustomUserClaims(uid, claims);

  await db.collection("users").doc(uid).set(
    {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { uid, role };
});

exports.deleteAuthUser = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const uid = String(data.uid || "").trim();
  if (!uid) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "User id is required."
    );
  }

  await admin.auth().deleteUser(uid);
  await db.collection("users").doc(uid).delete();

  return { uid };
});

exports.deleteCategoryWithItems = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);

    const categoryId = String(data.categoryId || "").trim();
    if (!categoryId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Category id is required."
      );
    }

    const itemsQuery = await db
      .collection("stockItems")
      .where("categoryId", "==", categoryId)
      .get();

    const batch = db.batch();
    itemsQuery.forEach((docSnap) => batch.delete(docSnap.ref));
    batch.delete(db.collection("stockCategories").doc(categoryId));

    await batch.commit();

    return { deletedItems: itemsQuery.size };
  }
);

exports.sendDispatchEmail = functions.https.onCall(async (data, context) => {
  requireStaff(context);

  const collectionName = String(data?.collectionName || "").trim();
  if (!["eggOrders", "livestockOrders"].includes(collectionName)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid collection name."
    );
  }

  const orderId = String(data?.orderId || "").trim();
  if (!orderId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Order id is required."
    );
  }

  const orderRef = db.collection(collectionName).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Order not found.");
  }

  const order = orderSnap.data() || {};
  const email = String(order.email || "").trim();
  if (!email) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Order email is missing."
    );
  }

  const name =
    [order.name, order.surname].filter(Boolean).join(" ").trim() || "Customer";
  const orderNumberLabel = order.orderNumber ? ` ${order.orderNumber}` : "";
  const sendDate = order.sendDate || "";
  const delivery = order.deliveryOption || "";
  const trackingLink = normalizeUrl(order.trackingLink || "");
  const items = getOrderItems(order);
  const totals = calculateOrderTotals(order);
  const paidLabel = getPaidLabel(order);
  const summaryCard = buildOrderSummaryCard({
    heading: "Order summary",
    items,
    totals,
    collectionName,
    paidLabel,
  });

  const trackingLine = trackingLink
    ? `<p><strong>Tracking:</strong> <a href="${escapeHtml(trackingLink)}">${escapeHtml(
        trackingLink
      )}</a></p>`
    : "";

  const intro = `Your order${orderNumberLabel} is being prepared for dispatch.`;
  const subject = `Your order${orderNumberLabel} update from ${BRAND_NAME}`;
  const html = buildEmailHtml({
    title: "Dispatch update",
    intro,
    preheader: intro,
    body: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your order${orderNumberLabel} is being prepared for dispatch.</p>
      ${summaryCard}
      ${delivery ? `<p><strong>Delivery option:</strong> ${escapeHtml(delivery)}</p>` : ""}
      ${sendDate ? `<p><strong>Send date:</strong> ${escapeHtml(sendDate)}</p>` : ""}
      ${trackingLine}
      <p class="muted">If you have questions, reply to this email.</p>
      ${buildIndemnitySectionHtml({
        includeEggRestNotice: collectionName === "eggOrders",
      })}
    `,
  });

  const result = await sendEmail({
    to: [email],
    subject,
    html,
  });

  await orderRef.set(
    { dispatchEmailSentAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return { id: result?.data?.id || null };
});

exports.sendInvoiceEmail = functions.https.onCall(async (data, context) => {
  requireStaff(context);

  const collectionName = String(data?.collectionName || "").trim();
  if (!["eggOrders", "livestockOrders"].includes(collectionName)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid collection name."
    );
  }

  const orderId = String(data?.orderId || "").trim();
  if (!orderId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Order id is required."
    );
  }

  const orderRef = db.collection(collectionName).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Order not found.");
  }

  const order = orderSnap.data() || {};
  const email = String(order.email || "").trim();
  if (!email) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Order email is missing."
    );
  }

  const invoiceUrl = String(order.invoiceUrl || "").trim();
  if (!invoiceUrl) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Invoice has not been generated."
    );
  }

  const items = getOrderItems(order);
  const totals = calculateOrderTotals(order);
  const name = getCustomerName(order);
  const paidLabel = getPaidLabel(order);
  const invoiceNumber = buildInvoiceNumber({ ...order, id: orderSnap.id });
  const orderTypeLabel =
    collectionName === "livestockOrders" ? "livestock" : "egg";
  const intro = `Here is your invoice ${invoiceNumber} from ${BRAND_NAME}.`;

  const summaryCard = buildOrderSummaryCard({
    heading: "Invoice summary",
    items,
    totals,
    collectionName,
    paidLabel,
  });

  const body = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Thanks for your ${orderTypeLabel} order. Your invoice is ready.</p>
    ${summaryCard}
    <p><strong>Invoice:</strong> <a href="${invoiceUrl}">Download invoice PDF</a></p>
    ${buildPaymentSectionHtml(order.orderNumber || invoiceNumber)}
    ${buildIndemnitySectionHtml({
      includeEggRestNotice: collectionName === "eggOrders",
    })}
  `;

  const html = buildEmailHtml({
    title: `Invoice ${invoiceNumber}`,
    intro,
    preheader: intro,
    body,
  });

  const result = await sendEmail({
    to: [email],
    subject: `Invoice ${invoiceNumber} from ${BRAND_NAME}`,
    html,
  });

  await orderRef.set(
    {
      invoiceNumber,
      invoiceEmailedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { id: result?.data?.id || null };
});

exports.sendTestEmail = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const to = Array.isArray(data?.to) ? data.to : [data?.to || ""];
  const subject = data?.subject || "The Crooked Fence test email";
  const rawHtml = data?.html || "<p>It works!</p>";
  const useRawHtml = Boolean(data?.useRawHtml);
  const html = useRawHtml
    ? rawHtml
    : buildEmailHtml({
        title: subject,
        intro: "Test email",
        preheader: "Test email",
        body: rawHtml,
      });

  const result = await sendEmail({ to, subject, html });

  return { id: result?.data?.id || null };
});

exports.backfillTypeImageLibrary = functions
  .runWith({ memory: "1GB", timeoutSeconds: 540 })
  .https.onCall(async (_data, context) => {
    requireAdmin(context);

    const response = {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };
    const errors = [];
    const collections = ["eggTypes", "livestockTypes"];
    const seenKeys = new Set();

    for (const collectionName of collections) {
      const snapshot = await db.collection(collectionName).get();
      for (const docSnap of snapshot.docs) {
        const docData = docSnap.data() || {};
        const sources = collectTypeImageSourcesFromDoc(docData);
        for (const source of sources) {
          response.scanned += 1;
          const dedupeKey =
            String(source.assetId || "").trim() ||
            normalizeStoragePath(source.path) ||
            String(source.url || "").trim();
          if (!dedupeKey) {
            response.skipped += 1;
            continue;
          }
          if (seenKeys.has(dedupeKey)) {
            response.skipped += 1;
            continue;
          }
          seenKeys.add(dedupeKey);

          try {
            const docId =
              String(source.assetId || "").trim() ||
              toLibraryAssetDocId(source.path || source.url || dedupeKey);
            const assetRef = db.collection(TYPE_IMAGE_LIBRARY_COLLECTION).doc(docId);
            const existing = await assetRef.get();
            const payload = await buildLibraryAssetPayload({
              entry: source,
              fallbackPath: source.path,
              fallbackUrl: source.url,
              fallbackName: source.name,
              source: "backfill",
              createdByUid: "",
              createdByEmail: "",
            });

            if (!payload.url && !payload.path) {
              response.skipped += 1;
              continue;
            }

            const writePayload = {
              ...payload,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            if (!existing.exists) {
              writePayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
            }
            await assetRef.set(writePayload, { merge: true });
            if (existing.exists) {
              response.updated += 1;
            } else {
              response.created += 1;
            }
          } catch (error) {
            response.failed += 1;
            if (errors.length < 100) {
              errors.push({
                collection: collectionName,
                typeId: docSnap.id,
                path: source.path || "",
                message: error?.message || "Unknown backfill error.",
              });
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      response.errors = errors;
    }
    return response;
  });

exports.deleteTypeLibraryAsset = functions.https.onCall(async (data, context) => {
  requireAdmin(context);

  const assetId = String(data?.assetId || "").trim();
  if (!assetId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "assetId is required."
    );
  }

  const assetRef = db.collection(TYPE_IMAGE_LIBRARY_COLLECTION).doc(assetId);
  const assetSnap = await assetRef.get();
  if (!assetSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Asset not found.");
  }

  const asset = assetSnap.data() || {};
  const path = normalizeStoragePath(asset.path);
  const usages = await collectLibraryUsageForAsset({ assetId, path });
  if (usages.length > 0) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Asset is still used by one or more products.",
      {
        usages: usages.slice(0, 100),
      }
    );
  }

  if (path) {
    try {
      await admin.storage().bucket().file(path).delete();
    } catch (error) {
      if (Number(error?.code) !== 404) {
        throw error;
      }
    }
  }

  await assetRef.delete();
  return { deleted: true };
});

exports.optimizeTypeImageOnFinalize = functions
  .runWith({ memory: "1GB", timeoutSeconds: 120 })
  .storage.object()
  .onFinalize(async (object) => {
    const objectPath = String(object?.name || "").trim();
    if (!objectPath || !isTypeImagePath(objectPath)) return null;
    if (!isSupportedImageType(object?.contentType)) return null;
    if (object?.metadata?.tcfOptimized === "1") return null;

    await optimizeStorageImageObject({
      bucketName: object.bucket,
      objectPath,
      force: false,
    });
    return null;
  });

exports.optimizeExistingTypeImages = functions
  .runWith({ memory: "1GB", timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);

    const variant = String(data?.variant || "all")
      .trim()
      .toLowerCase();
    if (!["all", "egg", "livestock"].includes(variant)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "variant must be one of: all, egg, livestock."
      );
    }

    const force = Boolean(data?.force);
    const collectionNames =
      variant === "egg"
        ? ["eggTypes"]
        : variant === "livestock"
          ? ["livestockTypes"]
          : ["eggTypes", "livestockTypes"];

    const paths = new Set();
    for (const collectionName of collectionNames) {
      const snapshot = await db.collection(collectionName).get();
      snapshot.forEach((docSnap) => {
        const docPaths = collectTypeImagePathsFromDoc(docSnap.data());
        docPaths.forEach((path) => {
          if (isTypeImagePath(path)) {
            paths.add(path);
          }
        });
      });
    }

    if (variant === "all") {
      const librarySnapshot = await db.collection(TYPE_IMAGE_LIBRARY_COLLECTION).get();
      librarySnapshot.forEach((docSnap) => {
        const docData = docSnap.data() || {};
        const path = normalizeStoragePath(
          docData.path || extractPathFromFirebaseDownloadUrl(docData.url)
        );
        if (path && isTypeImagePath(path)) {
          paths.add(path);
        }
      });
    }

    const response = {
      scanned: paths.size,
      optimized: 0,
      skipped: 0,
      failed: 0,
    };
    const errors = [];

    for (const objectPath of paths) {
      try {
        const result = await optimizeStorageImageObject({ objectPath, force });
        if (result.status === "optimized") {
          response.optimized += 1;
        } else {
          response.skipped += 1;
        }
      } catch (error) {
        response.failed += 1;
        if (errors.length < 100) {
          errors.push({
            path: objectPath,
            message: error?.message || "Unknown optimization error.",
          });
        }
      }
    }

    if (errors.length > 0) {
      response.errors = errors;
    }

    return response;
  });

exports.emailOnOrderCreate = functions.firestore
  .document("eggOrders/{orderId}")
  .onCreate(async (snap) => {
    const orderRef = snap.ref;
    const order = snap.data() || {};
    if (order.submissionSource === "callable:createPublicOrder") return null;
    const orderNumber = await ensureOrderNumber("eggOrders", orderRef, order);
    await sendOrderCreatedEmails({
      order: { ...order, orderNumber, id: snap.id },
      collectionName: "eggOrders",
      orderRef,
      formType: order.formType || "eggs",
      idempotencyKey: order.idempotencyKey || "",
    });
    return null;
  });

exports.emailOnLivestockOrderCreate = functions.firestore
  .document("livestockOrders/{orderId}")
  .onCreate(async (snap) => {
    const orderRef = snap.ref;
    const order = snap.data() || {};
    if (order.submissionSource === "callable:createPublicOrder") return null;
    const orderNumber = await ensureOrderNumber(
      "livestockOrders",
      orderRef,
      order
    );
    await sendOrderCreatedEmails({
      order: { ...order, orderNumber, id: snap.id },
      collectionName: "livestockOrders",
      orderRef,
      formType: order.formType || "livestock",
      idempotencyKey: order.idempotencyKey || "",
    });
    return null;
  });

exports.emailOnStatusChange = functions.firestore
  .document("eggOrders/{orderId}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (before.orderStatus === after.orderStatus) return null;

    const orderNumber = after.orderNumber || before.orderNumber || "";
    await sendOrderStatusEmails({
      order: { ...after, orderNumber, id: change.after.id },
      previousStatus: before.orderStatus,
      nextStatus: after.orderStatus,
      collectionName: "eggOrders",
    });
    return null;
  });

exports.emailOnLivestockStatusChange = functions.firestore
  .document("livestockOrders/{orderId}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (before.orderStatus === after.orderStatus) return null;

    const orderNumber = after.orderNumber || before.orderNumber || "";
    await sendOrderStatusEmails({
      order: { ...after, orderNumber, id: change.after.id },
      previousStatus: before.orderStatus,
      nextStatus: after.orderStatus,
      collectionName: "livestockOrders",
    });
    return null;
  });

exports.stockThresholdAlert = functions.firestore
  .document("stockItems/{itemId}")
  .onWrite(async (change) => {
    if (!change.after.exists) return null;
    const after = change.after.data() || {};
    const before = change.before.exists ? change.before.data() || {} : null;

    const threshold = toNumber(after.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) return null;

    const afterQty = toNumber(after.quantity);
    const beforeQty = before ? toNumber(before.quantity) : null;

    if (before && beforeQty <= threshold) {
      if (afterQty <= threshold) return null;
      return null;
    }

    if (
      (beforeQty === null || beforeQty > threshold) &&
      afterQty <= threshold
    ) {
      const adminRecipients = getAdminRecipients();
      if (adminRecipients.length === 0) return null;
      const name = escapeHtml(after.name || "Stock item");
      const subject = `Stock alert: ${after.name || "Item"} low`;
      const intro = `${after.name || "Item"} is now below threshold.`;
      const html = buildEmailHtml({
        title: "Stock threshold alert",
        intro,
        preheader: intro,
        body: `
          <p><strong>${name}</strong> is now below threshold.</p>
          <div class="summary">
            <p><strong>Quantity:</strong> ${afterQty}</p>
            <p><strong>Threshold:</strong> ${threshold}</p>
          </div>
        `,
      });
      await sendEmail({ to: adminRecipients, subject, html });
    }
    return null;
  });

exports.stockMorningSummary = functions.pubsub
  .schedule("0 8 * * *")
  .timeZone("Africa/Johannesburg")
  .onRun(() =>
    sendStockSummaryEmail({
      title: "Morning stock summary",
      includeAll: false,
    })
  );

exports.stockEveningSummary = functions.pubsub
  .schedule("0 18 * * *")
  .timeZone("Africa/Johannesburg")
  .onRun(() =>
    sendStockSummaryEmail({
      title: "Evening stock summary",
      includeAll: false,
    })
  );

exports.stockDailyFullSummary = functions.pubsub
  .schedule("0 20 * * *")
  .timeZone("Africa/Johannesburg")
  .onRun(() =>
    sendStockSummaryEmail({
      title: "Daily stock summary",
      includeAll: true,
    })
  );

exports.sendStockTestEmail = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const result = await sendStockSummaryEmail({
    title: "Stock summary test",
    includeAll: true,
  });
  return { id: result?.data?.id || null };
});

const chunkedWrite = async (docs, handler) => {
  const chunks = [];
  const size = 400;
  for (let i = 0; i < docs.length; i += size) {
    chunks.push(docs.slice(i, i + size));
  }
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((doc) => handler(batch, doc));
    await batch.commit();
  }
};

exports.syncAuthUsers = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);

  const allUsers = [];
  let nextPageToken;
  do {
    const result = await admin.auth().listUsers(1000, nextPageToken);
    allUsers.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  await chunkedWrite(allUsers, (batch, user) => {
    const claimRole = user.customClaims?.role;
    const payload = {
      email: user.email || "",
      disabled: Boolean(user.disabled),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (claimRole) {
      payload.role = claimRole;
    }
    const ref = db.collection("users").doc(user.uid);
    batch.set(ref, payload, { merge: true });
  });

  return { count: allUsers.length };
});

exports.promoteAllUsersToAdmin = functions.https.onCall(
  async (_data, context) => {
    requireAdmin(context);

    const allUsers = [];
    let nextPageToken;
    do {
      const result = await admin.auth().listUsers(1000, nextPageToken);
      allUsers.push(...result.users);
      nextPageToken = result.pageToken;
    } while (nextPageToken);

    for (const user of allUsers) {
      await admin.auth().setCustomUserClaims(user.uid, {
        ...(user.customClaims || {}),
        role: "admin",
      });
      await db.collection("users").doc(user.uid).set(
        {
          role: "admin",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return { count: allUsers.length };
  }
);

exports.sendLegacyCorrectionEmails = functions.https.onCall(
  async (data, context) => {
    requireAdmin(context);

    const collectionName = String(data?.collectionName || "eggOrders");
    const orderIds = Array.isArray(data?.orderIds) ? data.orderIds : [];
    if (!orderIds.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Order ids are required."
      );
    }

    const subject = data?.subject || "Order update from The Crooked Fence";
    const message = data?.message || "Please note an update to your order.";

    const results = [];
    for (const orderId of orderIds) {
      const snap = await db.collection(collectionName).doc(orderId).get();
      if (!snap.exists) continue;
      const order = snap.data() || {};
      if (!order.email) continue;
      const name =
        [order.name, order.surname].filter(Boolean).join(" ").trim() ||
        "Customer";
      const orderNumber = order.orderNumber || "";
      const body = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>${escapeHtml(message)}</p>
      ${orderNumber ? `<p><strong>Order reference:</strong> ${escapeHtml(orderNumber)}</p>` : ""}
      <p class="muted">If you have questions, reply to this email.</p>
      ${buildIndemnitySectionHtml({
        includeEggRestNotice: collectionName === "eggOrders",
      })}
    `;
      const html = buildEmailHtml({
        title: subject,
        intro: message,
        preheader: message,
        body,
      });
      const result = await sendEmail({ to: [order.email], subject, html });
      results.push({
        id: orderId,
        email: order.email,
        result: result?.data?.id || null,
      });
    }

    return { sent: results.length, results };
  }
);

// -----------------------------------------------------------------------------
// Operations planner
// -----------------------------------------------------------------------------
const OPERATIONS_TIMEZONE = "Africa/Johannesburg";
const OPERATIONS_TASKS_COLLECTION = "operationsTasks";
const OPERATIONS_EVENTS_COLLECTION = "operationsEvents";
const OPERATIONS_TASK_OCCURRENCES_COLLECTION = "operationsTaskOccurrences";
const OPERATIONS_EVENT_OCCURRENCES_COLLECTION = "operationsEventOccurrences";
const OPERATIONS_NOTIFICATIONS_COLLECTION = "operationsNotifications";
const OPERATIONS_REMINDER_OFFSETS = [60, 1440, 4320];
const OCCURRENCE_WINDOW_PAST_DAYS = 60;
const OCCURRENCE_WINDOW_FUTURE_DAYS = 180;
const OCCURRENCE_PRUNE_DAYS = 180;
const REMINDER_LOOKAHEAD_MS = 3 * 24 * 60 * 60 * 1000;
const REMINDER_TRIGGER_WINDOW_MS = 20 * 60 * 1000;

const RRULE_FREQ = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
};

const RRULE_WEEKDAY = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
};

const toDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

const normalizeReminderState = (state = {}) => ({
  email_60: Boolean(state.email_60),
  app_60: Boolean(state.app_60),
  email_1440: Boolean(state.email_1440),
  app_1440: Boolean(state.app_1440),
  email_4320: Boolean(state.email_4320),
  app_4320: Boolean(state.app_4320),
});

const normalizeReminderOffsets = (offsets) => {
  const raw = Array.isArray(offsets) ? offsets : OPERATIONS_REMINDER_OFFSETS;
  const normalized = raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : OPERATIONS_REMINDER_OFFSETS;
};

const buildOccurrenceId = (parentId, atDate) =>
  `${parentId}_${toDateValue(atDate)?.getTime?.() ?? 0}`;

const hasOverrideField = (override, key) =>
  override && Object.prototype.hasOwnProperty.call(override, key);

const applyTaskOccurrenceOverride = (payload, override) => {
  if (!override || typeof override !== "object") return payload;
  const next = { ...payload };
  if (hasOverrideField(override, "title")) {
    next.title = String(override.title || "").trim();
  }
  if (hasOverrideField(override, "notes")) {
    next.notes = String(override.notes || "").trim();
  }
  if (hasOverrideField(override, "dueAt")) {
    next.dueAt = toDateValue(override.dueAt);
  }
  if (hasOverrideField(override, "status")) {
    next.status = String(override.status || "todo");
  }
  if (hasOverrideField(override, "priority")) {
    next.priority = String(override.priority || "medium");
  }
  if (hasOverrideField(override, "categoryId")) {
    next.categoryId = String(override.categoryId || "");
  }
  if (hasOverrideField(override, "assigneeIds")) {
    next.assigneeIds = Array.isArray(override.assigneeIds)
      ? override.assigneeIds
      : [];
  }
  if (hasOverrideField(override, "assigneeEmails")) {
    next.assigneeEmails = Array.isArray(override.assigneeEmails)
      ? override.assigneeEmails
      : [];
  }
  return next;
};

const applyEventOccurrenceOverride = (payload, override) => {
  if (!override || typeof override !== "object") return payload;
  const next = { ...payload };
  if (hasOverrideField(override, "title")) {
    next.title = String(override.title || "").trim();
  }
  if (hasOverrideField(override, "notes")) {
    next.notes = String(override.notes || "").trim();
  }
  if (hasOverrideField(override, "location")) {
    next.location = String(override.location || "").trim();
  }
  if (hasOverrideField(override, "allDay")) {
    next.allDay = Boolean(override.allDay);
  }
  if (hasOverrideField(override, "startAt")) {
    next.startAt = toDateValue(override.startAt);
  }
  if (hasOverrideField(override, "endAt")) {
    next.endAt = toDateValue(override.endAt);
  }
  if (hasOverrideField(override, "categoryId")) {
    next.categoryId = String(override.categoryId || "");
  }
  if (hasOverrideField(override, "assignmentMode")) {
    next.assignmentMode = String(override.assignmentMode || "optional");
  }
  if (hasOverrideField(override, "assigneeIds")) {
    next.assigneeIds = Array.isArray(override.assigneeIds)
      ? override.assigneeIds
      : [];
  }
  if (hasOverrideField(override, "assigneeEmails")) {
    next.assigneeEmails = Array.isArray(override.assigneeEmails)
      ? override.assigneeEmails
      : [];
  }
  return next;
};

const buildRecurrenceDates = ({ baseDate, recurrence, windowStart, windowEnd }) => {
  const start = toDateValue(baseDate);
  if (!start) {
    return [];
  }
  if (!recurrence || !recurrence.freq || !RRULE_FREQ[recurrence.freq]) {
    return start >= windowStart && start <= windowEnd ? [start] : [];
  }

  const rule = new RRule({
    freq: RRULE_FREQ[recurrence.freq],
    dtstart: start,
    interval: Math.max(1, Number(recurrence.interval || 1)),
    byweekday: Array.isArray(recurrence.byWeekday)
      ? recurrence.byWeekday
          .map((day) => RRULE_WEEKDAY[String(day).toUpperCase()] || null)
          .filter(Boolean)
      : null,
    bymonthday:
      recurrence.byMonthDay !== null && recurrence.byMonthDay !== undefined
        ? Number(recurrence.byMonthDay)
        : null,
    until:
      recurrence.endType === "until" ? toDateValue(recurrence.untilAt) : null,
    count:
      recurrence.endType === "count"
        ? Math.max(1, Number(recurrence.count || 1))
        : null,
  });
  return rule.between(windowStart, windowEnd, true);
};

const commitInBatches = async (operations = []) => {
  if (operations.length === 0) return;
  for (let i = 0; i < operations.length; i += 400) {
    const batch = db.batch();
    operations.slice(i, i + 400).forEach((operation) => operation(batch));
    await batch.commit();
  }
};

const deleteByFieldValue = async (collectionName, field, value) => {
  const snapshot = await db.collection(collectionName).where(field, "==", value).get();
  const operations = snapshot.docs.map((docSnap) => (batch) => batch.delete(docSnap.ref));
  await commitInBatches(operations);
};

const syncTaskOccurrences = async (taskId, taskData) => {
  if (!taskData) {
    await deleteByFieldValue(OPERATIONS_TASK_OCCURRENCES_COLLECTION, "taskId", taskId);
    return;
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - OCCURRENCE_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + OCCURRENCE_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);
  const dueBase = toDateValue(taskData.dueAt);
  const dates = buildRecurrenceDates({
    baseDate: taskData.dueAt,
    recurrence: taskData.isRecurring ? taskData.recurrence : null,
    windowStart,
    windowEnd,
  });

  const existingSnapshot = await db
    .collection(OPERATIONS_TASK_OCCURRENCES_COLLECTION)
    .where("taskId", "==", taskId)
    .get();
  const existingById = new Map(
    existingSnapshot.docs.map((docSnap) => [docSnap.id, docSnap.data()])
  );
  const nextIds = new Set();
  const ops = [];

  dates.forEach((date) => {
    const occurrenceId = buildOccurrenceId(taskId, date);
    const existing = existingById.get(occurrenceId) || {};
    nextIds.add(occurrenceId);
    const payloadBase = {
      taskId,
      occurrenceKey: date.toISOString(),
      title: String(taskData.title || "").trim(),
      notes: String(taskData.notes || "").trim(),
      dueAt: date,
      status: String(existing.status || taskData.statusDefault || "todo"),
      progressNote: String(existing.progressNote || ""),
      priority: String(taskData.priority || "medium"),
      categoryId: String(taskData.categoryId || ""),
      assigneeIds: Array.isArray(taskData.assigneeIds) ? taskData.assigneeIds : [],
      assigneeEmails: Array.isArray(taskData.assigneeEmails) ? taskData.assigneeEmails : [],
      isRecurring: Boolean(taskData.isRecurring),
      reminderOffsetsMin: normalizeReminderOffsets(taskData.reminderOffsetsMin),
      reminderState: normalizeReminderState(existing.reminderState),
      completedAt: existing.completedAt || null,
      completedByUid: existing.completedByUid || "",
      isDeleted: Boolean(existing.isDeleted),
      deletedAt: existing.deletedAt || null,
      deletedByUid: existing.deletedByUid || "",
      occurrenceOverride:
        existing.occurrenceOverride && typeof existing.occurrenceOverride === "object"
          ? existing.occurrenceOverride
          : null,
      overrideUpdatedAt: existing.overrideUpdatedAt || null,
      overrideUpdatedByUid: existing.overrideUpdatedByUid || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: taskData.updatedByUid || "",
    };
    const payload = applyTaskOccurrenceOverride(
      payloadBase,
      existing.occurrenceOverride
    );
    const targetRef = db.collection(OPERATIONS_TASK_OCCURRENCES_COLLECTION).doc(occurrenceId);
    ops.push((batch) => batch.set(targetRef, payload, { merge: true }));
  });

  if (!taskData.isRecurring && !dueBase) {
    const occurrenceId = `${taskId}_no_due`;
    const existing = existingById.get(occurrenceId) || {};
    nextIds.add(occurrenceId);
    const payloadBase = {
      taskId,
      occurrenceKey: "no_due",
      title: String(taskData.title || "").trim(),
      notes: String(taskData.notes || "").trim(),
      dueAt: null,
      status: String(existing.status || taskData.statusDefault || "todo"),
      progressNote: String(existing.progressNote || ""),
      priority: String(taskData.priority || "medium"),
      categoryId: String(taskData.categoryId || ""),
      assigneeIds: Array.isArray(taskData.assigneeIds) ? taskData.assigneeIds : [],
      assigneeEmails: Array.isArray(taskData.assigneeEmails) ? taskData.assigneeEmails : [],
      isRecurring: false,
      reminderOffsetsMin: normalizeReminderOffsets(taskData.reminderOffsetsMin),
      reminderState: normalizeReminderState(existing.reminderState),
      completedAt: existing.completedAt || null,
      completedByUid: existing.completedByUid || "",
      isDeleted: Boolean(existing.isDeleted),
      deletedAt: existing.deletedAt || null,
      deletedByUid: existing.deletedByUid || "",
      occurrenceOverride:
        existing.occurrenceOverride && typeof existing.occurrenceOverride === "object"
          ? existing.occurrenceOverride
          : null,
      overrideUpdatedAt: existing.overrideUpdatedAt || null,
      overrideUpdatedByUid: existing.overrideUpdatedByUid || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: taskData.updatedByUid || "",
    };
    const payload = applyTaskOccurrenceOverride(
      payloadBase,
      existing.occurrenceOverride
    );
    const targetRef = db.collection(OPERATIONS_TASK_OCCURRENCES_COLLECTION).doc(occurrenceId);
    ops.push((batch) => batch.set(targetRef, payload, { merge: true }));
  }

  existingSnapshot.docs.forEach((docSnap) => {
    if (nextIds.has(docSnap.id)) return;
    ops.push((batch) => batch.delete(docSnap.ref));
  });

  await commitInBatches(ops);
};

const syncEventOccurrences = async (eventId, eventData) => {
  if (!eventData) {
    await deleteByFieldValue(OPERATIONS_EVENT_OCCURRENCES_COLLECTION, "eventId", eventId);
    return;
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - OCCURRENCE_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + OCCURRENCE_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);
  const dates = buildRecurrenceDates({
    baseDate: eventData.startAt,
    recurrence: eventData.isRecurring ? eventData.recurrence : null,
    windowStart,
    windowEnd,
  });

  const startBase = toDateValue(eventData.startAt);
  const endBase = toDateValue(eventData.endAt);
  const durationMs =
    startBase && endBase && endBase >= startBase
      ? endBase.getTime() - startBase.getTime()
      : 0;

  const existingSnapshot = await db
    .collection(OPERATIONS_EVENT_OCCURRENCES_COLLECTION)
    .where("eventId", "==", eventId)
    .get();
  const existingById = new Map(
    existingSnapshot.docs.map((docSnap) => [docSnap.id, docSnap.data()])
  );
  const nextIds = new Set();
  const ops = [];

  dates.forEach((startAt) => {
    const occurrenceId = buildOccurrenceId(eventId, startAt);
    const existing = existingById.get(occurrenceId) || {};
    const nextEndAt =
      durationMs > 0 ? new Date(startAt.getTime() + durationMs) : toDateValue(eventData.endAt);
    nextIds.add(occurrenceId);
    const payloadBase = {
      eventId,
      occurrenceKey: startAt.toISOString(),
      title: String(eventData.title || "").trim(),
      notes: String(eventData.notes || "").trim(),
      location: String(eventData.location || "").trim(),
      allDay: Boolean(eventData.allDay),
      startAt,
      endAt: nextEndAt || null,
      categoryId: String(eventData.categoryId || ""),
      assignmentMode: String(eventData.assignmentMode || "optional"),
      assigneeIds: Array.isArray(eventData.assigneeIds) ? eventData.assigneeIds : [],
      assigneeEmails: Array.isArray(eventData.assigneeEmails) ? eventData.assigneeEmails : [],
      isRecurring: Boolean(eventData.isRecurring),
      reminderOffsetsMin: normalizeReminderOffsets(eventData.reminderOffsetsMin),
      reminderState: normalizeReminderState(existing.reminderState),
      isDeleted: Boolean(existing.isDeleted),
      deletedAt: existing.deletedAt || null,
      deletedByUid: existing.deletedByUid || "",
      occurrenceOverride:
        existing.occurrenceOverride && typeof existing.occurrenceOverride === "object"
          ? existing.occurrenceOverride
          : null,
      overrideUpdatedAt: existing.overrideUpdatedAt || null,
      overrideUpdatedByUid: existing.overrideUpdatedByUid || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const payload = applyEventOccurrenceOverride(
      payloadBase,
      existing.occurrenceOverride
    );
    const targetRef = db.collection(OPERATIONS_EVENT_OCCURRENCES_COLLECTION).doc(occurrenceId);
    ops.push((batch) => batch.set(targetRef, payload, { merge: true }));
  });

  existingSnapshot.docs.forEach((docSnap) => {
    if (nextIds.has(docSnap.id)) return;
    ops.push((batch) => batch.delete(docSnap.ref));
  });

  await commitInBatches(ops);
};

const deleteOlderOccurrences = async (collectionName, dateField, olderThan) => {
  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .where(dateField, "<", olderThan)
      .orderBy(dateField, "asc")
      .limit(300)
      .get();
    if (snapshot.empty) break;
    await commitInBatches(snapshot.docs.map((docSnap) => (batch) => batch.delete(docSnap.ref)));
    if (snapshot.size < 300) break;
  }
};

const shouldTriggerReminder = (targetDate, offsetMin, now = Date.now()) => {
  const target = toDateValue(targetDate)?.getTime();
  if (!target) return false;
  const delta = target - now;
  const triggerAt = offsetMin * 60 * 1000;
  return delta <= triggerAt && delta > triggerAt - REMINDER_TRIGGER_WINDOW_MS;
};

const buildUserDirectory = async () => {
  const snapshot = await db.collection("users").get();
  const usersByEmail = new Map();
  const usersByUid = new Map();
  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const uid = String(docSnap.id || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const entry = {
      uid: docSnap.id,
      email,
      role: String(data.role || "").trim().toLowerCase(),
    };
    if (uid) {
      usersByUid.set(uid, entry);
    }
    if (email) {
      usersByEmail.set(email, entry);
    }
  });
  return { usersByEmail, usersByUid };
};

const buildReminderRecipients = ({
  assigneeIds = [],
  assigneeEmails = [],
  usersByEmail,
  usersByUid,
}) => {
  const recipients = new Map();
  assigneeEmails.forEach((email, index) => {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) return;
    recipients.set(normalized, {
      uid: assigneeIds[index] || usersByEmail.get(normalized)?.uid || "",
      email: normalized,
    });
  });

  assigneeIds.forEach((uid) => {
    const normalizedUid = String(uid || "").trim();
    if (!normalizedUid) return;
    const user = usersByUid.get(normalizedUid);
    const email = String(user?.email || "").trim().toLowerCase();
    if (!email) return;
    recipients.set(email, {
      uid: normalizedUid,
      email,
    });
  });

  getAdminRecipients().forEach((email) => {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) return;
    recipients.set(normalized, {
      uid: usersByEmail.get(normalized)?.uid || "",
      email: normalized,
    });
  });

  usersByEmail.forEach((entry, email) => {
    if (entry.role !== "admin" && entry.role !== "super_admin") return;
    recipients.set(email, { uid: entry.uid || "", email });
  });

  return Array.from(recipients.values());
};

const claimReminderDispatch = async ({
  ref,
  offset,
  nowMs,
  dateField,
}) =>
  db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    if (data.isDeleted) {
      return null;
    }
    if (!shouldTriggerReminder(data[dateField], offset, nowMs)) {
      return null;
    }
    const state = normalizeReminderState(data.reminderState);
    if (state[`email_${offset}`] && state[`app_${offset}`]) {
      return null;
    }
    transaction.set(
      ref,
      {
        reminderState: {
          ...state,
          [`email_${offset}`]: true,
          [`app_${offset}`]: true,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return data;
  });

const createReminderNotifications = async ({
  recipients,
  itemType,
  parentId,
  occurrenceId,
  offsetMin,
  title,
  message,
  linkPath,
}) => {
  const ops = recipients
    .filter((recipient) => recipient.uid)
    .map((recipient) => {
      const docId = `ops_${itemType}_${occurrenceId}_${offsetMin}_${recipient.uid}`;
      const ref = db.collection(OPERATIONS_NOTIFICATIONS_COLLECTION).doc(docId);
      return (batch) =>
        batch.set(
          ref,
          {
            userId: recipient.uid,
            userEmail: recipient.email,
            type: itemType,
            parentId,
            occurrenceId,
            title,
            message,
            triggerAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
            readAt: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            linkPath,
          },
          { merge: true }
        );
    });
  await commitInBatches(ops);
};

const runReminderPass = async ({ collectionName, itemType, dateField, titleField }) => {
  const now = Date.now();
  const until = new Date(now + REMINDER_LOOKAHEAD_MS);
  const snapshot = await db
    .collection(collectionName)
    .where(dateField, ">=", new Date(now - REMINDER_TRIGGER_WINDOW_MS))
    .where(dateField, "<=", until)
    .orderBy(dateField, "asc")
    .get();

  const { usersByEmail, usersByUid } = await buildUserDirectory();
  let remindersProcessed = 0;

  for (const docSnap of snapshot.docs) {
    const occurrenceData = docSnap.data() || {};
    if (occurrenceData.isDeleted) continue;
    const offsets = normalizeReminderOffsets(occurrenceData.reminderOffsetsMin);
    for (const offset of offsets) {
      const data = await claimReminderDispatch({
        ref: docSnap.ref,
        offset,
        nowMs: now,
        dateField,
      });
      if (!data) continue;

      const recipients = buildReminderRecipients({
        assigneeIds: Array.isArray(data.assigneeIds) ? data.assigneeIds : [],
        assigneeEmails: Array.isArray(data.assigneeEmails) ? data.assigneeEmails : [],
        usersByEmail,
        usersByUid,
      });
      if (recipients.length === 0) continue;

      const to = recipients.map((recipient) => recipient.email).filter(Boolean);
      const itemTitle = String(data[titleField] || `${itemType} reminder`).trim();
      const message = `${itemTitle} starts at ${formatDate(data[dateField])}.`;
      const html = buildEmailHtml({
        title: `${BRAND_NAME} ${itemType} reminder`,
        intro: message,
        preheader: message,
        body: `<p>${escapeHtml(message)}</p><p class="muted">Reminder offset: ${offset} minutes.</p>`,
      });
      await sendEmail({
        to,
        subject: `${BRAND_NAME} reminder: ${itemTitle}`,
        html,
      });
      await createReminderNotifications({
        recipients,
        itemType,
        parentId: itemType === "task" ? data.taskId || "" : data.eventId || "",
        occurrenceId: docSnap.id,
        offsetMin: offset,
        title: `${itemType === "task" ? "Task" : "Event"} reminder`,
        message,
        linkPath: "/operations?panel=alerts",
      });
      remindersProcessed += 1;
    }
  }
  return remindersProcessed;
};

exports.syncOperationsTaskOccurrences = functions.firestore
  .document("operationsTasks/{taskId}")
  .onWrite(async (change, context) => {
    const taskData = change.after.exists ? change.after.data() : null;
    await syncTaskOccurrences(context.params.taskId, taskData);
    return null;
  });

exports.syncOperationsEventOccurrences = functions.firestore
  .document("operationsEvents/{eventId}")
  .onWrite(async (change, context) => {
    const eventData = change.after.exists ? change.after.data() : null;
    await syncEventOccurrences(context.params.eventId, eventData);
    return null;
  });

exports.operationsOccurrenceMaintainer = functions.pubsub
  .schedule("0 2 * * *")
  .timeZone(OPERATIONS_TIMEZONE)
  .onRun(async () => {
    const [tasksSnapshot, eventsSnapshot] = await Promise.all([
      db.collection(OPERATIONS_TASKS_COLLECTION).get(),
      db.collection(OPERATIONS_EVENTS_COLLECTION).get(),
    ]);

    for (const docSnap of tasksSnapshot.docs) {
      await syncTaskOccurrences(docSnap.id, docSnap.data());
    }
    for (const docSnap of eventsSnapshot.docs) {
      await syncEventOccurrences(docSnap.id, docSnap.data());
    }

    const olderThan = new Date(Date.now() - OCCURRENCE_PRUNE_DAYS * 24 * 60 * 60 * 1000);
    await deleteOlderOccurrences(OPERATIONS_TASK_OCCURRENCES_COLLECTION, "dueAt", olderThan);
    await deleteOlderOccurrences(OPERATIONS_EVENT_OCCURRENCES_COLLECTION, "startAt", olderThan);
    return null;
  });

exports.operationsReminderDispatcher = functions.pubsub
  .schedule("every 15 minutes")
  .timeZone(OPERATIONS_TIMEZONE)
  .onRun(async () => {
    const [taskCount, eventCount] = await Promise.all([
      runReminderPass({
        collectionName: OPERATIONS_TASK_OCCURRENCES_COLLECTION,
        itemType: "task",
        dateField: "dueAt",
        titleField: "title",
      }),
      runReminderPass({
        collectionName: OPERATIONS_EVENT_OCCURRENCES_COLLECTION,
        itemType: "event",
        dateField: "startAt",
        titleField: "title",
      }),
    ]);
    return { taskCount, eventCount };
  });
