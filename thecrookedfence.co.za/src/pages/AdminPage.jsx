import { useEffect, useMemo, useRef, useState } from "react";
import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { Link } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
  uploadBytesResumable,
} from "firebase/storage";
import { auth, db, functions, storage } from "../lib/firebase.js";
import {
  DEFAULT_DELIVERY_OPTIONS,
  DEFAULT_EGG_TYPES,
  DEFAULT_FORM_DELIVERY_OPTIONS,
  DEFAULT_LIVESTOCK_DELIVERY_OPTIONS,
  FINANCE_ATTACHMENTS,
  INVENTORY_SORT_OPTIONS,
  ORDER_STATUSES,
  STATUS_STYLES,
  UNCATEGORIZED_ID,
  UNCATEGORIZED_LABEL,
} from "../data/defaults.js";
import {
  EGG_INFO_FIELDS,
  MAX_TYPE_IMAGES,
  TYPE_PRICE_OPTIONS,
  buildPrimaryImageFields,
  createTypeDraft,
  getTypePriceLabel,
  normalizeTypeDoc,
  normalizeTypeImages,
} from "../lib/typeCatalog.js";
import { optimizeImageForUpload } from "../lib/imageOptimization.js";
import { useSeo } from "../lib/seo.js";
import {
  buildTypeImageFromLibraryAsset,
  normalizeLibraryAsset,
  toLibraryAssetDocId,
} from "../lib/typeImageLibrary.js";
import { useAuthRole } from "../lib/useAuthRole.js";

const cardClass =
  "bg-brandBeige shadow-lg rounded-2xl border border-brandGreen/10";
const panelClass =
  "rounded-2xl border border-brandGreen/10 bg-white/70 p-4 shadow-inner";
const inputClass =
  "w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen placeholder:text-brandGreen/50 focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30";
const mutedText = "text-brandGreen/70";
const STOCK_LOG_LIMIT = 25;
const REPORT_ORDER_STATUSES = ORDER_STATUSES.filter(
  (status) => status.id !== "archived"
);
const EGG_TYPE_SORT_OPTIONS = [
  { id: "order", label: "Order" },
  { id: "title", label: "Title" },
  { id: "category", label: "Category" },
  { id: "priceType", label: "Price type" },
  { id: "price", label: "Price" },
  { id: "available", label: "Availability" },
  { id: "images", label: "Images" },
  { id: "shortDescription", label: "Short description" },
  { id: "longDescription", label: "Long description" },
  { id: "updatedAt", label: "Last updated" },
];
const STOCK_UPDATE_SORT_OPTIONS = [
  { value: "name_asc", label: "Item (A -> Z)" },
  { value: "name_desc", label: "Item (Z -> A)" },
  { value: "category_asc", label: "Category (A -> Z)" },
  { value: "category_desc", label: "Category (Z -> A)" },
  { value: "current_qty_desc", label: "Current qty (high -> low)" },
  { value: "current_qty_asc", label: "Current qty (low -> high)" },
  { value: "pending_qty_desc", label: "Pending qty (high -> low)" },
  { value: "pending_qty_asc", label: "Pending qty (low -> high)" },
  { value: "change_desc", label: "Pending change (high -> low)" },
  { value: "change_asc", label: "Pending change (low -> high)" },
  { value: "updated_desc", label: "Last updated (newest)" },
  { value: "updated_asc", label: "Last updated (oldest)" },
];
const EGG_PRICE_TYPE_ORDER = {
  normal: 0,
  special: 1,
};
const createEggInfoDraft = () =>
  EGG_INFO_FIELDS.reduce((acc, field) => {
    acc[field.key] = "";
    return acc;
  }, {});
const createEggTypeDraft = () => ({
  ...createTypeDraft(),
  ...createEggInfoDraft(),
});
const INVOICE_BRAND = {
  name: "The Crooked Fence",
  email: "stolschristopher60@gmail.com",
  phone: "082 891 07612",
  website: "thecrookedfence.co.za",
};
const INVOICE_BANK = {
  bank: "FNB/RMB",
  accountName: "The Golden Quail",
  accountType: "Gold Business Account",
  accountNumber: "63049448219",
  branchCode: "250655",
};
const INVOICE_INDEMNITY =
  "NO REFUNDS. We take great care in packaging all eggs to ensure they are shipped as safely as possible. However, once eggs leave our care, we cannot be held responsible for damage that may occur during transit, including cracked eggs. Hatch rates cannot be guaranteed. There are many factors beyond our control—such as handling during shipping, incubation conditions, and environmental variables—that may affect development. As eggs are considered livestock, purchasing hatching eggs involves an inherent risk that the buyer accepts at the time of purchase.\n\nAvailability Notice: Some eggs are subject to a 3–6 week waiting period and may not be available for immediate shipment. By placing an order, the buyer acknowledges and accepts this potential delay.\n\nExtra Eggs Disclaimer: Extra eggs are never guaranteed. While we may occasionally include additional eggs when available, this is done at our discretion and should not be expected or assumed as part of any order.";
const INVOICE_LOGO_PATH = "/TCFLogoWhiteBackground.png";
let invoicePdfLibsPromise = null;
const ACTIVE_UPLOAD_CLOSE_CONFIRM_MESSAGE =
  "An upload is in progress. Close and cancel the upload?";

const createUploadCanceledError = (message = "Upload canceled.") => {
  const error = new Error(message);
  error.code = "storage/canceled";
  error.uploadCanceled = true;
  return error;
};

const isUploadCanceledError = (error) =>
  error?.uploadCanceled === true ||
  error?.code === "storage/canceled" ||
  error?.cause?.code === "storage/canceled";

const loadInvoicePdfLibs = async () => {
  if (!invoicePdfLibsPromise) {
    invoicePdfLibsPromise = Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ])
      .then(([jspdfModule, autoTableModule]) => ({
        jsPDF: jspdfModule.default,
        autoTable: autoTableModule.default,
      }))
      .catch((err) => {
        invoicePdfLibsPromise = null;
        throw err;
      });
  }
  return invoicePdfLibsPromise;
};

const formatTimestamp = (value) => {
  if (!value) return "-";
  if (value.toDate) return value.toDate().toLocaleString();
  if (value.seconds) return new Date(value.seconds * 1000).toLocaleString();
  return new Date(value).toLocaleString();
};

const getTimestampValue = (value) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (value.toDate) return value.toDate().getTime();
  if (value.seconds) return value.seconds * 1000;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const resolveTimestampDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.toDate) return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === "number") return new Date(value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

const formatTwoDigits = (value) => String(value).padStart(2, "0");

const formatDayMonthYear = (date) =>
  `${formatTwoDigits(date.getDate())}/${formatTwoDigits(
    date.getMonth() + 1
  )}/${date.getFullYear()}`;

const isValidCalendarDate = (year, month, day) => {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const parseOrderDateInput = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const [datePart] = trimmed.split("T");
  const normalized = datePart.replace(/\./g, "/");
  let year = null;
  let month = null;
  let day = null;

  let match = normalized.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }

  if (!isValidCalendarDate(year, month, day)) return null;
  return {
    iso: `${year}-${formatTwoDigits(month)}-${formatTwoDigits(day)}`,
    dayMonthYear: `${formatTwoDigits(day)}/${formatTwoDigits(month)}/${year}`,
  };
};

const toOrderDateInputValue = (value) => {
  if (!value) return "";
  const parsed = parseOrderDateInput(value);
  return parsed ? parsed.dayMonthYear : String(value);
};

const formatOrderDateDisplay = (value) => {
  if (!value) return "-";
  const parsed = parseOrderDateInput(value);
  return parsed ? parsed.dayMonthYear : String(value);
};

const getOrderDateSortValue = (value) => {
  const parsed = parseOrderDateInput(value);
  if (parsed) return parsed.iso;
  return String(value ?? "").trim();
};

const formatDate = (value) => {
  const date = resolveTimestampDate(value);
  if (!date) return "-";
  return formatDayMonthYear(date);
};

const formatDateValue = (value) => {
  const date = resolveTimestampDate(value);
  if (!date) return "";
  return date.toISOString().split("T")[0];
};

const formatCurrency = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return "-";
  return `R${Number(value).toFixed(2)}`;
};

const formatFileSize = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const clampNumber = (value, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
};

const sanitizeFileName = (name) =>
  String(name || "image")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "_");

const TYPE_IMAGE_CACHE_CONTROL = "public,max-age=31536000,immutable";

const toNumber = (value) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  if (typeof value === "string") {
    const floatParsed = Number.parseFloat(value);
    if (Number.isFinite(floatParsed)) return floatParsed;
  }
  return 0;
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

const buildInvoiceLines = (order) => {
  const items = Array.isArray(order.eggs) ? order.eggs : [];
  return items
    .filter((item) => toNumber(item.quantity) > 0)
    .map((item) => {
      const quantity = toNumber(item.quantity);
      const specialPrice = item.specialPrice;
      const unitPrice =
        specialPrice === null ||
        specialPrice === undefined ||
        toNumber(specialPrice) === 0
          ? toNumber(item.price)
          : toNumber(specialPrice);
      return {
        label: item.label ?? item.name ?? "Item",
        quantity,
        unitPrice,
        lineTotal: unitPrice * quantity,
      };
    });
};

const loadImageDataUrl = async (src) => {
  const response = await fetch(src);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
};

const generateInvoicePdf = async ({
  order,
  collectionName,
  eggsTotal,
  deliveryCost,
  totalCost,
  orderFullName,
  addressText,
  invoiceNumber,
  invoiceDateLabel,
  deliveryLabel,
  sendDateLabel,
}) => {
  const { jsPDF, autoTable } = await loadInvoicePdfLibs();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;
  let cursorY = 40;

  try {
    const logoData = await loadImageDataUrl(INVOICE_LOGO_PATH);
    doc.addImage(logoData, "PNG", marginX, cursorY, 56, 56);
  } catch (err) {
    // Logo is optional; continue without it.
  }

  doc.setFontSize(18);
  doc.setTextColor("#064e3b");
  doc.text("Invoice", pageWidth - marginX, cursorY + 20, { align: "right" });

  doc.setFontSize(10);
  doc.setTextColor("#334155");
  doc.text(`Invoice #: ${invoiceNumber}`, pageWidth - marginX, cursorY + 40, {
    align: "right",
  });
  doc.text(`Date: ${invoiceDateLabel}`, pageWidth - marginX, cursorY + 56, {
    align: "right",
  });

  doc.setFontSize(11);
  doc.setTextColor("#0f172a");
  const brandTextX = marginX + 70;
  doc.text(INVOICE_BRAND.name, brandTextX, cursorY + 18);
  doc.setFontSize(9);
  doc.setTextColor("#475569");
  doc.text(`Email: ${INVOICE_BRAND.email}`, brandTextX, cursorY + 34);
  doc.text(`WhatsApp: ${INVOICE_BRAND.phone}`, brandTextX, cursorY + 48);
  doc.text(`Website: ${INVOICE_BRAND.website}`, brandTextX, cursorY + 62);

  cursorY += 90;

  doc.setFontSize(11);
  doc.setTextColor("#064e3b");
  doc.text("Bill To", marginX, cursorY);
  doc.setFontSize(10);
  doc.setTextColor("#334155");
  const billToLines = doc.splitTextToSize(
    `${orderFullName || "Customer"}\n${order.email || ""}\n${
      order.cellphone || ""
    }`,
    240
  );
  doc.text(billToLines, marginX, cursorY + 16);

  const addressLines = doc.splitTextToSize(addressText || "", 240);
  doc.text(addressLines, marginX + 260, cursorY + 16);

  cursorY += 80;

  const lineItems = buildInvoiceLines(order);
  if (lineItems.length === 0) {
    lineItems.push({
      label:
        collectionName === "livestockOrders" ? "Livestock order" : "Egg order",
      quantity: 1,
      unitPrice: toNumber(totalCost),
      lineTotal: toNumber(totalCost),
    });
  }

  autoTable(doc, {
    startY: cursorY,
    head: [["Item", "Qty", "Unit price", "Line total"]],
    body: lineItems.map((line) => [
      line.label,
      String(line.quantity),
      formatCurrency(line.unitPrice),
      formatCurrency(line.lineTotal),
    ]),
    styles: { fontSize: 9, textColor: "#334155" },
    headStyles: { fillColor: "#064e3b", textColor: "#ffffff" },
    alternateRowStyles: { fillColor: "#f8fafc" },
    columnStyles: {
      1: { halign: "right", cellWidth: 50 },
      2: { halign: "right", cellWidth: 80 },
      3: { halign: "right", cellWidth: 90 },
    },
  });

  const tableY = doc.lastAutoTable?.finalY ?? cursorY;
  let totalsY = tableY + 16;
  doc.setFontSize(10);
  doc.setTextColor("#334155");
  doc.text(
    `Subtotal: ${formatCurrency(eggsTotal)}`,
    pageWidth - marginX,
    totalsY,
    {
      align: "right",
    }
  );
  totalsY += 14;
  doc.text(
    `Delivery: ${formatCurrency(deliveryCost)}`,
    pageWidth - marginX,
    totalsY,
    {
      align: "right",
    }
  );
  totalsY += 16;
  doc.setFontSize(12);
  doc.setTextColor("#064e3b");
  doc.text(
    `Total: ${formatCurrency(totalCost)}`,
    pageWidth - marginX,
    totalsY,
    {
      align: "right",
    }
  );

  doc.setFontSize(10);
  doc.setTextColor("#334155");
  doc.text(`Paid: ${order.paid ? "Yes" : "No"}`, marginX, totalsY);

  totalsY += 24;
  doc.setFontSize(10);
  doc.setTextColor("#064e3b");
  doc.text("Delivery details", marginX, totalsY);
  doc.setFontSize(9);
  doc.setTextColor("#334155");
  doc.text(`Delivery option: ${deliveryLabel || "-"}`, marginX, totalsY + 14);
  doc.text(`Send date: ${sendDateLabel || "-"}`, marginX, totalsY + 28);

  let paymentY = totalsY + 50;
  doc.setFontSize(10);
  doc.setTextColor("#064e3b");
  doc.text("Payment details", marginX, paymentY);
  doc.setFontSize(9);
  doc.setTextColor("#334155");
  const paymentLines = [
    `Bank: ${INVOICE_BANK.bank}`,
    `Account Name: ${INVOICE_BANK.accountName}`,
    `Account Type: ${INVOICE_BANK.accountType}`,
    `Account Number: ${INVOICE_BANK.accountNumber}`,
    `Branch Code: ${INVOICE_BANK.branchCode}`,
  ];
  doc.text(paymentLines, marginX, paymentY + 14);

  const indemnityY = paymentY + 80;
  doc.setFontSize(9);
  doc.setTextColor("#334155");
  const indemnityLines = doc.splitTextToSize(
    INVOICE_INDEMNITY,
    pageWidth - marginX * 2
  );
  doc.text(indemnityLines, marginX, indemnityY);

  return doc.output("blob");
};

const formatDuration = (totalSeconds) => {
  const safeSeconds = Number.isFinite(totalSeconds)
    ? Math.max(0, totalSeconds)
    : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const getVoiceNoteMimeType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
};

const extractCost = (label) => {
  if (!label) return 0;
  const match = label.match(/R\s*([\d.]+)/i);
  return match ? Number(match[1]) : 0;
};

const ORDER_ATTACHMENTS = FINANCE_ATTACHMENTS;

const resolveStockUpdateQuantity = (draft, currentQuantity) => {
  if (!draft || draft.quantity === "" || draft.quantity === undefined)
    return currentQuantity;
  const parsed = Number(draft.quantity);
  return Number.isFinite(parsed) ? parsed : currentQuantity;
};

const normalizeLogEntry = (entry = {}) => {
  if (Array.isArray(entry)) {
    const [name, fromQty, toQty, change] = entry;
    return normalizeLogEntry({ name, fromQty, toQty, change });
  }

  const name =
    entry.name ??
    entry.label ??
    entry.summary ??
    entry.itemName ??
    entry.item ??
    entry.itemLabel ??
    entry.item_name ??
    entry.product ??
    entry.stockItem ??
    entry.stockName ??
    entry.title ??
    "Item";

  const qtySource = entry.qty ?? entry.quantity ?? entry.quantities ?? {};
  const rawFrom =
    entry.fromQty ??
    entry.from ??
    entry.prevQty ??
    entry.previousQty ??
    entry.previous ??
    entry.before ??
    entry.beforeQty ??
    entry.beforeQuantity ??
    entry.oldQty ??
    entry.oldQuantity ??
    entry.old ??
    entry.startQty ??
    entry.startQuantity ??
    entry.start ??
    entry.qtyBefore ??
    entry.quantityBefore ??
    qtySource.from ??
    qtySource.before ??
    qtySource.start ??
    qtySource.previous;
  const rawTo =
    entry.toQty ??
    entry.to ??
    entry.nextQty ??
    entry.next ??
    entry.afterQty ??
    entry.after ??
    entry.afterQuantity ??
    entry.newQty ??
    entry.newQuantity ??
    entry.new ??
    entry.endQty ??
    entry.endQuantity ??
    entry.end ??
    entry.qtyAfter ??
    entry.quantityAfter ??
    qtySource.to ??
    qtySource.after ??
    qtySource.end ??
    qtySource.next;

  const parseQtyRange = (text) => {
    if (typeof text !== "string") return null;
    const match = text.match(/(-?\d+\.?\d*)\s*(?:→|->|to)\s*(-?\d+\.?\d*)/i);
    if (!match) return null;
    return { from: toNumber(match[1]), to: toNumber(match[2]) };
  };

  const qtyText =
    typeof qtySource === "string"
      ? qtySource
      : entry.qtyText ??
        entry.quantityText ??
        entry.qtyRange ??
        entry.range ??
        "";
  const rangeFromText =
    parseQtyRange(rawFrom) || parseQtyRange(rawTo) || parseQtyRange(qtyText);

  let fromQty = rangeFromText ? rangeFromText.from : toNumber(rawFrom);
  let toQty = rangeFromText ? rangeFromText.to : toNumber(rawTo);
  let hasQtyRange =
    Boolean(rangeFromText) || rawFrom !== undefined || rawTo !== undefined;

  const rawChange =
    entry.change ??
    entry.delta ??
    entry.diff ??
    entry.changeQty ??
    entry.qtyChange ??
    entry.changeAmount ??
    entry.changeValue ??
    entry.deltaQty ??
    entry.difference ??
    entry.amount ??
    entry.value ??
    entry.adjustment;
  let change = toNumber(rawChange);
  if (hasQtyRange) {
    change = toQty - fromQty;
  } else if (
    rawChange === undefined &&
    (rawFrom !== undefined || rawTo !== undefined)
  ) {
    change = toQty - fromQty;
  }

  return {
    name,
    change,
    fromQty,
    toQty,
    notes: entry.notes ?? entry.note ?? "",
  };
};

const normalizeEntryList = (entries) => {
  if (Array.isArray(entries))
    return entries.map((entry) => normalizeLogEntry(entry));
  if (entries && typeof entries === "object") {
    return Object.values(entries).map((entry) => normalizeLogEntry(entry));
  }
  return [];
};

const getLogEntries = (log) => {
  const sources = [log.items, log.entries, log.changes, log.updates];
  for (const source of sources) {
    const list = normalizeEntryList(source);
    if (list.length > 0) return list;
  }
  return [
    normalizeLogEntry({
      name: log.summary || log.name || "Stock update",
      change: log.change,
      fromQty: log.fromQty,
      toQty: log.toQty,
      notes: log.notes,
    }),
  ];
};

const getLogTitle = (log, entries) => {
  if (log.summary || log.name) return log.summary || log.name;
  if (entries.length > 1) return `Batch update (${entries.length} items)`;
  return entries[0]?.name || "Stock update";
};

const formatChangeValue = (value) => (value > 0 ? `+${value}` : `${value}`);

const getChangeColor = (value) => {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-700";
  return "text-brandGreen";
};

const createLineId = () =>
  `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const createBatchId = () =>
  `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const getStockUpdateGroupKey = (log) => {
  if (log.batchId) return `batch:${log.batchId}`;
  if (log.voiceNoteName) return `voice:${log.voiceNoteName}`;
  const timestamp = getTimestampValue(log.batchCreatedAt ?? log.createdAt);
  if (!timestamp) return `log:${log.id}`;
  const user = log.userEmail ?? log.updatedBy ?? "unknown";
  return `time:${Math.floor(timestamp / 1000)}|user:${user}`;
};

const groupStockLogs = (logs) => {
  const grouped = new Map();

  logs.forEach((log) => {
    if (log.logType !== "stockUpdateLogs") {
      grouped.set(`log:${log.id}`, log);
      return;
    }

    const key = getStockUpdateGroupKey(log);
    const existing = grouped.get(key);
    const entries = getLogEntries(log);

    if (!existing) {
      grouped.set(key, {
        ...log,
        entries: [...entries],
        summary: undefined,
        name: undefined,
        createdAt: log.batchCreatedAt ?? log.createdAt,
      });
      return;
    }

    existing.entries = existing.entries
      ? existing.entries.concat(entries)
      : entries;
    existing.summary = undefined;
    existing.name = undefined;

    const existingTs = getTimestampValue(existing.createdAt);
    const logTs = getTimestampValue(log.batchCreatedAt ?? log.createdAt);
    if (logTs > existingTs) {
      existing.createdAt = log.batchCreatedAt ?? log.createdAt;
    }

    if (existing.userEmail && log.userEmail && existing.userEmail !== log.userEmail) {
      existing.userEmail = "Multiple";
    } else if (!existing.userEmail) {
      existing.userEmail = log.userEmail ?? log.updatedBy ?? "";
    }
  });

  return Array.from(grouped.values()).sort(
    (a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt)
  );
};

export default function AdminPage() {
  const { user, role, loading, setRole } = useAuthRole();
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const adminSeoTitle = user
    ? "Admin Dashboard | The Crooked Fence"
    : "Admin Login | The Crooked Fence";

  useSeo({
    title: adminSeoTitle,
    description:
      "Administrative tools for The Crooked Fence orders, inventory, and updates.",
    path: "/admin",
  });

  useEffect(() => {
    if (!user) return;
    const ensureProfile = httpsCallable(functions, "ensureCurrentUserProfile");
    ensureProfile().catch((err) =>
      console.error("ensureCurrentUserProfile error", err)
    );
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const ref = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const nextRole = snapshot.data()?.role ?? null;
        if (!role && nextRole) setRole(nextRole);
      },
      (err) => console.error("role snapshot error", err)
    );
    return () => unsubscribe();
  }, [user, role, setRole]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(
        auth,
        loginForm.email.trim(),
        loginForm.password
      );
      setLoginForm({ email: "", password: "" });
    } catch (err) {
      console.error("login error", err);
      setLoginError("Login failed. Please check your credentials.");
    } finally {
      setLoginLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`${cardClass} p-6 text-sm ${mutedText}`}>
        Loading admin tools...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className={`${cardClass} p-6 text-center`}>
          <h1 className="text-2xl font-bold text-brandGreen">Admin Login</h1>
          <p className={`mt-2 text-sm ${mutedText}`}>
            Sign in with your admin or worker credentials.
          </p>
        </div>
        <form onSubmit={handleLogin} className={`${cardClass} space-y-4 p-6`}>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brandGreen">
              Email
            </label>
            <input
              type="email"
              className={inputClass}
              value={loginForm.email}
              onChange={(event) =>
                setLoginForm((prev) => ({ ...prev, email: event.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brandGreen">
              Password
            </label>
            <input
              type="password"
              className={inputClass}
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((prev) => ({
                  ...prev,
                  password: event.target.value,
                }))
              }
              required
            />
          </div>
          {loginError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {loginError}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={loginLoading}
            className="w-full rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loginLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  if (!role) {
    return (
      <div className={`${cardClass} p-6 text-sm ${mutedText}`}>
        Checking permissions...
      </div>
    );
  }

  return <AdminDashboard user={user} role={role} />;
}

function AdminDashboard({ user, role }) {
  const isAdmin = role === "admin" || role === "super_admin";
  const isWorker = role === "worker";
  const initialActiveTab = isWorker ? "stock_updates" : "orders";

  const [activeTab, setActiveTab] = useState(initialActiveTab);
  const [openMenu, setOpenMenu] = useState(null);

  useEffect(() => {
    if (isWorker && activeTab !== "stock_updates") {
      setActiveTab("stock_updates");
    }
  }, [isWorker, activeTab]);

  useEffect(() => {
    if (!openMenu) return undefined;
    const handleClick = () => setOpenMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openMenu]);

  const [eggOrders, setEggOrders] = useState([]);
  const [livestockOrders, setLivestockOrders] = useState([]);
  const [eggTypes, setEggTypes] = useState([]);
  const [eggCategories, setEggCategories] = useState([]);
  const [deliveryOptions, setDeliveryOptions] = useState([]);
  const [livestockDeliveryOptions, setLivestockDeliveryOptions] = useState([]);
  const [livestockCategories, setLivestockCategories] = useState([]);
  const [livestockTypes, setLivestockTypes] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [stockLogs, setStockLogs] = useState([]);
  const [stockUpdateLogs, setStockUpdateLogs] = useState([]);
  const [stockCategories, setStockCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [financeEntries, setFinanceEntries] = useState([]);
  const [typeImageLibraryAssets, setTypeImageLibraryAssets] = useState([]);
  const [typeImageLibrarySearch, setTypeImageLibrarySearch] = useState("");
  const [typeImageLibraryMessage, setTypeImageLibraryMessage] = useState("");
  const [typeImageLibraryError, setTypeImageLibraryError] = useState("");
  const [typeImageLibraryUploading, setTypeImageLibraryUploading] =
    useState(false);
  const [isLibraryPickerOpen, setIsLibraryPickerOpen] = useState(false);
  const [libraryPickerVariant, setLibraryPickerVariant] = useState("egg");
  const [libraryPickerTarget, setLibraryPickerTarget] = useState("add");
  const [libraryPickerTypeId, setLibraryPickerTypeId] = useState("");
  const [libraryPickerSelection, setLibraryPickerSelection] = useState({});
  const [libraryPickerSearch, setLibraryPickerSearch] = useState("");
  const [libraryPickerApplying, setLibraryPickerApplying] = useState(false);
  const [libraryPreviewAsset, setLibraryPreviewAsset] = useState(null);
  const [libraryPreviewZoom, setLibraryPreviewZoom] = useState(1);

  const [statusFilter, setStatusFilter] = useState("all");
  const [paidFilter, setPaidFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState("orderNumberDesc");
  const [orderActionMessage, setOrderActionMessage] = useState("");

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedOrderCollection, setSelectedOrderCollection] =
    useState("eggOrders");

  const [eggDraft, setEggDraft] = useState(() => createEggTypeDraft());
  const [eggDraftImages, setEggDraftImages] = useState([]);
  const [eggDraftLibraryImages, setEggDraftLibraryImages] = useState([]);
  const [eggDraftPreviews, setEggDraftPreviews] = useState([]);
  const [eggDraftImageUploading, setEggDraftImageUploading] = useState(false);
  const [eggImageUploads, setEggImageUploads] = useState({});
  const [eggEdits, setEggEdits] = useState({});
  const [eggMessage, setEggMessage] = useState("");
  const [eggError, setEggError] = useState("");
  const [eggCategoryDraft, setEggCategoryDraft] = useState({
    name: "",
    description: "",
    order: "",
  });
  const [eggCategoryMessage, setEggCategoryMessage] = useState("");
  const [eggCategoryError, setEggCategoryError] = useState("");
  const [isAddEggCategoryDialogOpen, setIsAddEggCategoryDialogOpen] =
    useState(false);
  const [isManageEggCategoriesDialogOpen, setIsManageEggCategoriesDialogOpen] =
    useState(false);
  const [isAddEggTypeDialogOpen, setIsAddEggTypeDialogOpen] = useState(false);
  const [isAddingEggType, setIsAddingEggType] = useState(false);
  const [editingEggTypeId, setEditingEggTypeId] = useState(null);
  const [eggTypeSearch, setEggTypeSearch] = useState("");
  const [eggTypeCategoryFilter, setEggTypeCategoryFilter] = useState("all");
  const [eggTypeAvailabilityFilter, setEggTypeAvailabilityFilter] =
    useState("all");
  const [eggTypePriceTypeFilter, setEggTypePriceTypeFilter] = useState("all");
  const [eggTypeHasImageFilter, setEggTypeHasImageFilter] = useState("all");
  const [eggTypeMinPrice, setEggTypeMinPrice] = useState("");
  const [eggTypeMaxPrice, setEggTypeMaxPrice] = useState("");
  const [eggTypeSortKey, setEggTypeSortKey] = useState("order");
  const [eggTypeSortDirection, setEggTypeSortDirection] = useState("asc");

  const [deliveryDraft, setDeliveryDraft] = useState({ label: "", cost: "" });
  const [deliveryEdits, setDeliveryEdits] = useState({});
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [deliveryError, setDeliveryError] = useState("");

  const [livestockDeliveryDraft, setLivestockDeliveryDraft] = useState({
    label: "",
    cost: "",
  });
  const [livestockDeliveryEdits, setLivestockDeliveryEdits] = useState({});
  const [livestockDeliveryMessage, setLivestockDeliveryMessage] = useState("");
  const [livestockDeliveryError, setLivestockDeliveryError] = useState("");

  const [categoryDraft, setCategoryDraft] = useState({
    name: "",
    description: "",
    order: "",
  });
  const [categoryMessage, setCategoryMessage] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [isAddLivestockCategoryDialogOpen, setIsAddLivestockCategoryDialogOpen] =
    useState(false);
  const [isManageLivestockCategoriesDialogOpen, setIsManageLivestockCategoriesDialogOpen] =
    useState(false);

  const [livestockDraft, setLivestockDraft] = useState(() => createTypeDraft());
  const [livestockDraftImages, setLivestockDraftImages] = useState([]);
  const [livestockDraftLibraryImages, setLivestockDraftLibraryImages] = useState([]);
  const [livestockDraftPreviews, setLivestockDraftPreviews] = useState([]);
  const [livestockDraftImageUploading, setLivestockDraftImageUploading] =
    useState(false);
  const [livestockImageUploads, setLivestockImageUploads] = useState({});
  const [livestockEdits, setLivestockEdits] = useState({});
  const [livestockMessage, setLivestockMessage] = useState("");
  const [livestockError, setLivestockError] = useState("");
  const [isAddLivestockTypeDialogOpen, setIsAddLivestockTypeDialogOpen] =
    useState(false);
  const [isAddingLivestockType, setIsAddingLivestockType] = useState(false);
  const [editingLivestockTypeId, setEditingLivestockTypeId] = useState(null);
  const [livestockTypeSearch, setLivestockTypeSearch] = useState("");
  const [livestockTypeCategoryFilter, setLivestockTypeCategoryFilter] =
    useState("all");
  const [livestockTypeAvailabilityFilter, setLivestockTypeAvailabilityFilter] =
    useState("all");
  const [livestockTypePriceTypeFilter, setLivestockTypePriceTypeFilter] =
    useState("all");
  const [livestockTypeHasImageFilter, setLivestockTypeHasImageFilter] =
    useState("all");
  const [livestockTypeMinPrice, setLivestockTypeMinPrice] = useState("");
  const [livestockTypeMaxPrice, setLivestockTypeMaxPrice] = useState("");
  const [livestockTypeSortKey, setLivestockTypeSortKey] = useState("order");
  const [livestockTypeSortDirection, setLivestockTypeSortDirection] =
    useState("asc");
  const [imageOptimizationRunning, setImageOptimizationRunning] =
    useState(false);
  const [imageOptimizationMessage, setImageOptimizationMessage] = useState("");
  const [imageOptimizationError, setImageOptimizationError] = useState("");

  const [stockCategoryDraft, setStockCategoryDraft] = useState({ name: "" });
  const [stockCategoryMessage, setStockCategoryMessage] = useState("");
  const [stockCategoryError, setStockCategoryError] = useState("");
  const [isAddStockCategoryDialogOpen, setIsAddStockCategoryDialogOpen] =
    useState(false);
  const [isManageStockCategoriesDialogOpen, setIsManageStockCategoriesDialogOpen] =
    useState(false);

  const [stockItemDraft, setStockItemDraft] = useState({
    name: "",
    categoryId: "",
    subCategory: "",
    quantity: "",
    threshold: "5",
    notes: "",
  });
  const [isAddStockItemDialogOpen, setIsAddStockItemDialogOpen] =
    useState(false);
  const [editingStockItemId, setEditingStockItemId] = useState(null);
  const [stockEdits, setStockEdits] = useState({});
  const [stockItemMessage, setStockItemMessage] = useState("");
  const [stockItemError, setStockItemError] = useState("");

  const [stockSearch, setStockSearch] = useState("");
  const [stockSort, setStockSort] = useState("name_asc");
  const [stockCategoryFilter, setStockCategoryFilter] = useState("all");
  const [stockUpdateSearch, setStockUpdateSearch] = useState("");
  const [stockUpdateCategoryFilter, setStockUpdateCategoryFilter] =
    useState("all");
  const [stockUpdateSort, setStockUpdateSort] = useState("name_asc");
  const [stockUpdateDrafts, setStockUpdateDrafts] = useState({});
  const [editingStockUpdateItemId, setEditingStockUpdateItemId] = useState(null);
  const [stockUpdateDialogDraft, setStockUpdateDialogDraft] = useState({
    quantity: "",
    notes: "",
  });
  const [stockUpdateDialogError, setStockUpdateDialogError] = useState("");
  const [stockUpdateSubmitting, setStockUpdateSubmitting] = useState(false);
  const [voiceNote, setVoiceNote] = useState(null);
  const [voiceNoteError, setVoiceNoteError] = useState("");
  const [isRecordingVoiceNote, setIsRecordingVoiceNote] = useState(false);
  const [voiceNoteDuration, setVoiceNoteDuration] = useState(0);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingStartRef = useRef(null);
  const [stockLogSearch, setStockLogSearch] = useState("");
  const [showAllStockLogs, setShowAllStockLogs] = useState(true);

  const [userDraft, setUserDraft] = useState({
    email: "",
    role: "worker",
    password: "",
  });
  const [userRoleEdits, setUserRoleEdits] = useState({});
  const [userMessage, setUserMessage] = useState("");
  const [userError, setUserError] = useState("");

  const [financeDraft, setFinanceDraft] = useState({
    type: "expense",
    amount: "",
    description: "",
    date: new Date().toISOString().split("T")[0],
    file: null,
  });
  const [financeTimeScope, setFinanceTimeScope] = useState("month");
  const [financeMonth, setFinanceMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [financeSort, setFinanceSort] = useState("dateDesc");
  const [financeMinAmount, setFinanceMinAmount] = useState("");
  const [financeMaxAmount, setFinanceMaxAmount] = useState("");
  const [financeHasReceipt, setFinanceHasReceipt] = useState(false);
  const [financeShowFilters, setFinanceShowFilters] = useState(true);
  const [showFinanceForm, setShowFinanceForm] = useState(false);
  const [financeMessage, setFinanceMessage] = useState("");
  const [financeError, setFinanceError] = useState("");
  const [reportTimeScope, setReportTimeScope] = useState("month");
  const [reportDay, setReportDay] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [reportWeekStart, setReportWeekStart] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [reportMonth, setReportMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [reportYear, setReportYear] = useState(
    new Date().getFullYear().toString()
  );
  const [reportCustomStart, setReportCustomStart] = useState("");
  const [reportCustomEnd, setReportCustomEnd] = useState("");
  const [reportPaidFilter, setReportPaidFilter] = useState("all");
  const [reportOrderType, setReportOrderType] = useState("all");
  const [reportStatusFilter, setReportStatusFilter] = useState(() =>
    REPORT_ORDER_STATUSES.map((status) => status.id)
  );
  const [reportIncludeArchived, setReportIncludeArchived] = useState(false);
  const [reportShowFilters, setReportShowFilters] = useState(true);
  const uploadTaskRegistryRef = useRef(new Map());
  const canceledUploadScopesRef = useRef(new Set());
  const getAddTypeUploadScopeKey = (variant) =>
    `add:${variant === "livestock" ? "livestock" : "egg"}`;
  const getEditTypeUploadScopeKey = (variant, typeId) =>
    `edit:${variant === "livestock" ? "livestock" : "egg"}:${typeId}`;

  const registerUploadTask = (scopeKey, task) => {
    if (!scopeKey || !task) return;
    const registry = uploadTaskRegistryRef.current;
    const existing = registry.get(scopeKey) ?? new Set();
    existing.add(task);
    registry.set(scopeKey, existing);
  };

  const unregisterUploadTask = (scopeKey, task) => {
    if (!scopeKey || !task) return;
    const registry = uploadTaskRegistryRef.current;
    const existing = registry.get(scopeKey);
    if (!existing) return;
    existing.delete(task);
    if (existing.size === 0) {
      registry.delete(scopeKey);
      return;
    }
    registry.set(scopeKey, existing);
  };

  const hasActiveUploadTasks = (scopeKey) =>
    Boolean(scopeKey && uploadTaskRegistryRef.current.get(scopeKey)?.size);

  const cancelUploadTasks = (scopeKey) => {
    if (!scopeKey) return;
    const tasks = uploadTaskRegistryRef.current.get(scopeKey);
    if (!tasks || tasks.size === 0) return;
    tasks.forEach((task) => {
      try {
        task.cancel();
      } catch (cancelErr) {
        console.warn("upload cancel warning", cancelErr);
      }
    });
  };

  const markUploadScopeCanceled = (scopeKey) => {
    if (!scopeKey) return;
    canceledUploadScopesRef.current.add(scopeKey);
    cancelUploadTasks(scopeKey);
  };

  const clearUploadScopeCanceled = (scopeKey) => {
    if (!scopeKey) return;
    canceledUploadScopesRef.current.delete(scopeKey);
  };

  const isUploadScopeCanceled = (scopeKey) =>
    Boolean(scopeKey && canceledUploadScopesRef.current.has(scopeKey));

  const cleanupUploadedImages = async (images = []) => {
    const paths = images
      .map((image) => String(image?.path || "").trim())
      .filter(Boolean);
    if (paths.length === 0) return;
    const results = await Promise.allSettled(
      paths.map((path) => deleteObject(storageRef(storage, path)))
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn("uploaded image cleanup warning", {
          path: paths[index],
          error: result.reason,
        });
      }
    });
  };

  useEffect(() => {
    return () => {
      uploadTaskRegistryRef.current.forEach((tasks) => {
        tasks.forEach((task) => {
          try {
            task.cancel();
          } catch (cancelErr) {
            console.warn("upload cancel on unmount warning", cancelErr);
          }
        });
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (voiceNote?.previewUrl) {
        URL.revokeObjectURL(voiceNote.previewUrl);
      }
    };
  }, [voiceNote?.previewUrl]);

  useEffect(() => {
    if (eggDraftImages.length === 0) {
      setEggDraftPreviews([]);
      return () => {};
    }
    const previews = eggDraftImages.map((file, index) => ({
      id: `${file.name}_${file.lastModified}_${index}`,
      name: file.name || `Image ${index + 1}`,
      url: URL.createObjectURL(file),
    }));
    setEggDraftPreviews(previews);
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [eggDraftImages]);

  useEffect(() => {
    if (livestockDraftImages.length === 0) {
      setLivestockDraftPreviews([]);
      return () => {};
    }
    const previews = livestockDraftImages.map((file, index) => ({
      id: `${file.name}_${file.lastModified}_${index}`,
      name: file.name || `Image ${index + 1}`,
      url: URL.createObjectURL(file),
    }));
    setLivestockDraftPreviews(previews);
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [livestockDraftImages]);

  useEffect(() => {
    if (!isAdmin) {
      setTypeImageLibraryAssets([]);
      return () => {};
    }
    const unsubscribe = onSnapshot(
      collection(db, "typeImageLibrary"),
      (snapshot) => {
        const assets = snapshot.docs
          .map((docSnap) => normalizeLibraryAsset(docSnap))
          .filter((asset) => asset.url || asset.path)
          .sort(
            (a, b) =>
              getTimestampValue(b.updatedAt || b.createdAt) -
              getTimestampValue(a.updatedAt || a.createdAt)
          );
        setTypeImageLibraryAssets(assets);
      },
      (err) => {
        console.error("type image library load error", err);
        setTypeImageLibraryAssets([]);
      }
    );
    return () => unsubscribe();
  }, [isAdmin]);

  useEffect(() => {
    const unsubEggOrders = onSnapshot(
      query(collection(db, "eggOrders"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setEggOrders(data);
      }
    );

    const unsubLivestockOrders = onSnapshot(
      query(collection(db, "livestockOrders"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setLivestockOrders(data);
      }
    );

    const unsubEggTypes = onSnapshot(
      query(collection(db, "eggTypes"), orderBy("order", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) =>
          normalizeTypeDoc(docSnap.id, docSnap.data())
        );
        setEggTypes(data);
      }
    );

    const unsubEggCategories = onSnapshot(
      query(collection(db, "eggCategories"), orderBy("order", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => {
          const docData = docSnap.data();
          const rawOrder = docData.order;
          return {
            id: docSnap.id,
            name: docData.name ?? "",
            description: docData.description ?? "",
            order:
              rawOrder === null || rawOrder === undefined ? "" : rawOrder,
          };
        });
        const sorted = data
          .slice()
          .sort((a, b) => {
            const aOrder = Number.isFinite(Number(a.order))
              ? Number(a.order)
              : Number.POSITIVE_INFINITY;
            const bOrder = Number.isFinite(Number(b.order))
              ? Number(b.order)
              : Number.POSITIVE_INFINITY;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.name.localeCompare(b.name);
          });
        setEggCategories(sorted);
      }
    );

    const unsubDelivery = onSnapshot(
      query(collection(db, "deliveryOptions"), orderBy("order", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setDeliveryOptions(data);
      }
    );

    const unsubLivestockDelivery = onSnapshot(
      query(
        collection(db, "livestockDeliveryOptions"),
        orderBy("order", "asc")
      ),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setLivestockDeliveryOptions(data);
      }
    );

    const unsubLivestockCategories = onSnapshot(
      collection(db, "livestockCategories"),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => {
          const docData = docSnap.data();
          const rawOrder = docData.order;
          return {
            id: docSnap.id,
            name: docData.name ?? "",
            description: docData.description ?? "",
            order:
              rawOrder === null || rawOrder === undefined ? "" : rawOrder,
          };
        });
        const sorted = data
          .slice()
          .sort((a, b) => {
            const aOrder = Number.isFinite(Number(a.order))
              ? Number(a.order)
              : Number.POSITIVE_INFINITY;
            const bOrder = Number.isFinite(Number(b.order))
              ? Number(b.order)
              : Number.POSITIVE_INFINITY;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.name.localeCompare(b.name);
          });
        setLivestockCategories(sorted);
      }
    );

    const unsubLivestockTypes = onSnapshot(
      query(collection(db, "livestockTypes"), orderBy("order", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) =>
          normalizeTypeDoc(docSnap.id, docSnap.data())
        );
        setLivestockTypes(data);
      }
    );

    const unsubStockItems = onSnapshot(
      query(collection(db, "stockItems"), orderBy("name", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setStockItems(data);
      }
    );

    const unsubStockLogs = onSnapshot(
      query(collection(db, "stockLogs"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setStockLogs(data);
      }
    );

    const unsubStockUpdateLogs = onSnapshot(
      query(collection(db, "stockUpdateLogs"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setStockUpdateLogs(data);
      }
    );

    const unsubStockCategories = onSnapshot(
      query(collection(db, "stockCategories"), orderBy("name", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setStockCategories(data);
      }
    );

    const unsubUsers = onSnapshot(
      query(collection(db, "users"), orderBy("email", "asc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setUsers(data);
      }
    );

    const unsubFinance = onSnapshot(
      query(collection(db, "financeEntries"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setFinanceEntries(data);
      }
    );

    return () => {
      unsubEggOrders();
      unsubLivestockOrders();
      unsubEggTypes();
      unsubEggCategories();
      unsubDelivery();
      unsubLivestockDelivery();
      unsubLivestockCategories();
      unsubLivestockTypes();
      unsubStockItems();
      unsubStockLogs();
      unsubStockUpdateLogs();
      unsubStockCategories();
      unsubUsers();
      unsubFinance();
    };
  }, []);

  const deliveryLookup = useMemo(() => {
    const lookup = new Map();
    const options =
      deliveryOptions.length > 0 ? deliveryOptions : DEFAULT_DELIVERY_OPTIONS;
    options.forEach((option) =>
      lookup.set(option.id, Number(option.cost ?? 0))
    );
    return lookup;
  }, [deliveryOptions]);

  const hydrateOrders = (orders, fallbackOptions, { isEgg = false } = {}) => {
    const fallbackLookup = new Map();
    fallbackOptions.forEach((option) =>
      fallbackLookup.set(option.id, option.cost)
    );

    return orders.map((order) => {
      const eggs = Array.isArray(order.eggs) ? order.eggs : [];
      const eggsTotal = eggs.reduce((sum, item) => {
        const price =
          item.specialPrice == null || item.specialPrice === 0
            ? item.price
            : item.specialPrice;
        return sum + Number(price ?? 0) * Number(item.quantity ?? 0);
      }, 0);

      const deliveryCost =
        typeof order.deliveryCost === "number"
          ? Number(order.deliveryCost)
          : deliveryLookup.get(order.deliveryOptionId ?? "") ??
            fallbackLookup.get(order.deliveryOptionId ?? "") ??
            extractCost(order.deliveryOption);

      const totalCost = eggsTotal + deliveryCost;
      const substitutionPreferenceRaw =
        order.allowEggSubstitutions ?? order.allowSubstitutions;
      const allowEggSubstitutions = isEgg
        ? substitutionPreferenceRaw !== false
        : false;
      const createdAtDate = order.createdAt?.toDate
        ? order.createdAt.toDate()
        : order.createdAt?.seconds
        ? new Date(order.createdAt.seconds * 1000)
        : null;

      return {
        ...order,
        eggsTotal,
        deliveryCost,
        totalCost,
        orderNumber: order.orderNumber ?? "",
        orderStatus: order.orderStatus ?? "pending",
        trackingLink: order.trackingLink ?? "",
        paid: Boolean(order.paid),
        allowEggSubstitutions,
        createdAtDate,
        eggSummary:
          eggs
            .filter((item) => (item.quantity ?? 0) > 0)
            .map((item) => `${item.label} x ${item.quantity}`)
            .join(", ") || "-",
      };
    });
  };

  const enrichedEggOrders = useMemo(
    () =>
      hydrateOrders(eggOrders, DEFAULT_FORM_DELIVERY_OPTIONS, { isEgg: true }),
    [eggOrders, deliveryLookup]
  );

  const enrichedLivestockOrders = useMemo(
    () => hydrateOrders(livestockOrders, DEFAULT_LIVESTOCK_DELIVERY_OPTIONS),
    [livestockOrders, deliveryLookup]
  );

  const resolvedEggDeliveryOptions =
    deliveryOptions.length > 0
      ? deliveryOptions
      : DEFAULT_FORM_DELIVERY_OPTIONS;
  const resolvedLivestockDeliveryOptions =
    livestockDeliveryOptions.length > 0
      ? livestockDeliveryOptions
      : DEFAULT_LIVESTOCK_DELIVERY_OPTIONS;
  const resolvedEggTypes =
    eggTypes.length > 0
      ? eggTypes
      : DEFAULT_EGG_TYPES.map((item) => normalizeTypeDoc(item.id, item));

  const eggCategoryById = useMemo(
    () => new Map(eggCategories.map((category) => [category.id, category])),
    [eggCategories]
  );

  const eggCategoryGroups = useMemo(() => {
    const normalized = eggCategories.map((category) => ({
      id: category.id,
      name: category.name ?? "Unnamed",
      description: category.description ?? "",
      order:
        category.order === null || category.order === undefined
          ? ""
          : category.order,
    }));
    const sorted = normalized
      .slice()
      .sort((a, b) => {
        const aOrder = Number.isFinite(Number(a.order))
          ? Number(a.order)
          : Number.POSITIVE_INFINITY;
        const bOrder = Number.isFinite(Number(b.order))
          ? Number(b.order)
          : Number.POSITIVE_INFINITY;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      });
    const hasUncategorized = eggTypes.some((item) => {
      if (!item.categoryId) return true;
      return !eggCategories.some((category) => category.id === item.categoryId);
    });
    if (hasUncategorized) {
      sorted.push({
        id: UNCATEGORIZED_ID,
        name: UNCATEGORIZED_LABEL,
        description: "",
      });
    }
    return sorted;
  }, [eggCategories, eggTypes]);

  const resolveEggTypeCategoryLabel = (item) => {
    if (item.categoryName) return item.categoryName;
    if (item.categoryId) {
      return eggCategoryById.get(item.categoryId)?.name ?? UNCATEGORIZED_LABEL;
    }
    return UNCATEGORIZED_LABEL;
  };

  const getEggTypeUpdatedValue = (item) =>
    item?.raw?.updatedAt ?? item?.raw?.imageUpdatedAt ?? null;

  const eggTypeCategoryOptions = useMemo(() => {
    const options = [{ id: "all", name: "All categories" }];
    eggCategoryGroups
      .filter((category) => category.id !== UNCATEGORIZED_ID)
      .forEach((category) => {
        options.push({ id: category.id, name: category.name });
      });
    if (eggCategoryGroups.some((category) => category.id === UNCATEGORIZED_ID)) {
      options.push({ id: UNCATEGORIZED_ID, name: UNCATEGORIZED_LABEL });
    }
    return options;
  }, [eggCategoryGroups]);

  const eggTypesFilteredSorted = useMemo(() => {
    const search = eggTypeSearch.trim().toLowerCase();
    const minPrice = Number(eggTypeMinPrice);
    const maxPrice = Number(eggTypeMaxPrice);
    const hasMinPrice = eggTypeMinPrice !== "" && Number.isFinite(minPrice);
    const hasMaxPrice = eggTypeMaxPrice !== "" && Number.isFinite(maxPrice);

    const filtered = eggTypes.filter((item) => {
      const categoryExists = item.categoryId
        ? eggCategoryById.has(item.categoryId)
        : false;
      const isUncategorized = !item.categoryId || !categoryExists;
      const hasImages = (item.images?.length ?? 0) > 0;
      const itemPrice = Number(item.price ?? 0);
      const itemPriceType = item.priceType === "special" ? "special" : "normal";

      if (search) {
        const haystack = [
          item.title ?? item.label ?? "",
          item.shortDescription ?? "",
          item.longDescription ?? "",
          resolveEggTypeCategoryLabel(item),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      if (eggTypeCategoryFilter === UNCATEGORIZED_ID && !isUncategorized) {
        return false;
      }
      if (
        eggTypeCategoryFilter !== "all" &&
        eggTypeCategoryFilter !== UNCATEGORIZED_ID &&
        item.categoryId !== eggTypeCategoryFilter
      ) {
        return false;
      }

      if (
        eggTypeAvailabilityFilter === "available" &&
        item.available === false
      ) {
        return false;
      }
      if (
        eggTypeAvailabilityFilter === "unavailable" &&
        item.available !== false
      ) {
        return false;
      }

      if (eggTypePriceTypeFilter !== "all" && itemPriceType !== eggTypePriceTypeFilter) {
        return false;
      }

      if (eggTypeHasImageFilter === "with" && !hasImages) return false;
      if (eggTypeHasImageFilter === "without" && hasImages) return false;

      if (hasMinPrice && itemPrice < minPrice) return false;
      if (hasMaxPrice && itemPrice > maxPrice) return false;

      return true;
    });

    const sorted = filtered.slice().sort((a, b) => {
      const aTitle = String(a.title ?? a.label ?? "");
      const bTitle = String(b.title ?? b.label ?? "");
      let result = 0;

      switch (eggTypeSortKey) {
        case "title":
          result = aTitle.localeCompare(bTitle);
          break;
        case "category":
          result = resolveEggTypeCategoryLabel(a).localeCompare(
            resolveEggTypeCategoryLabel(b)
          );
          break;
        case "priceType":
          result =
            (EGG_PRICE_TYPE_ORDER[a.priceType ?? "normal"] ?? 0) -
            (EGG_PRICE_TYPE_ORDER[b.priceType ?? "normal"] ?? 0);
          break;
        case "price":
          result = Number(a.price ?? 0) - Number(b.price ?? 0);
          break;
        case "available":
          result = Number(a.available === false) - Number(b.available === false);
          break;
        case "images":
          result = (a.images?.length ?? 0) - (b.images?.length ?? 0);
          break;
        case "shortDescription":
          result = String(a.shortDescription ?? "").localeCompare(
            String(b.shortDescription ?? "")
          );
          break;
        case "longDescription":
          result = String(a.longDescription ?? "").localeCompare(
            String(b.longDescription ?? "")
          );
          break;
        case "updatedAt":
          result =
            getTimestampValue(getEggTypeUpdatedValue(a)) -
            getTimestampValue(getEggTypeUpdatedValue(b));
          break;
        case "order":
        default:
          result = toNumber(a.order) - toNumber(b.order);
          break;
      }

      if (result === 0) {
        result = aTitle.localeCompare(bTitle);
      }
      return eggTypeSortDirection === "desc" ? -result : result;
    });

    return sorted;
  }, [
    eggCategories,
    eggCategoryById,
    eggTypeAvailabilityFilter,
    eggTypeCategoryFilter,
    eggTypeHasImageFilter,
    eggTypeMaxPrice,
    eggTypeMinPrice,
    eggTypePriceTypeFilter,
    eggTypeSearch,
    eggTypeSortDirection,
    eggTypeSortKey,
    eggTypes,
  ]);

  const editingEggType = useMemo(
    () => eggTypes.find((item) => item.id === editingEggTypeId) ?? null,
    [eggTypes, editingEggTypeId]
  );

  const livestockCategoryById = useMemo(
    () =>
      new Map(livestockCategories.map((category) => [category.id, category])),
    [livestockCategories]
  );

  const livestockCategoryGroups = useMemo(() => {
    const normalized = livestockCategories.map((category) => ({
      id: category.id,
      name: category.name ?? "Unnamed",
      description: category.description ?? "",
    }));
    const sorted = normalized
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const hasUncategorized = livestockTypes.some((item) => {
      if (!item.categoryId) return true;
      return !livestockCategories.some(
        (category) => category.id === item.categoryId
      );
    });
    if (hasUncategorized) {
      sorted.push({
        id: UNCATEGORIZED_ID,
        name: UNCATEGORIZED_LABEL,
        description: "",
      });
    }
    return sorted;
  }, [livestockCategories, livestockTypes]);

  const resolveLivestockTypeCategoryLabel = (item) => {
    if (item.categoryName) return item.categoryName;
    if (item.categoryId) {
      return (
        livestockCategoryById.get(item.categoryId)?.name ?? UNCATEGORIZED_LABEL
      );
    }
    return UNCATEGORIZED_LABEL;
  };

  const getLivestockTypeUpdatedValue = (item) =>
    item?.raw?.updatedAt ?? item?.raw?.imageUpdatedAt ?? null;

  const livestockTypeCategoryOptions = useMemo(() => {
    const options = [{ id: "all", name: "All categories" }];
    livestockCategoryGroups
      .filter((category) => category.id !== UNCATEGORIZED_ID)
      .forEach((category) => {
        options.push({ id: category.id, name: category.name });
      });
    if (
      livestockCategoryGroups.some((category) => category.id === UNCATEGORIZED_ID)
    ) {
      options.push({ id: UNCATEGORIZED_ID, name: UNCATEGORIZED_LABEL });
    }
    return options;
  }, [livestockCategoryGroups]);

  const livestockTypesFilteredSorted = useMemo(() => {
    const search = livestockTypeSearch.trim().toLowerCase();
    const minPrice = Number(livestockTypeMinPrice);
    const maxPrice = Number(livestockTypeMaxPrice);
    const hasMinPrice =
      livestockTypeMinPrice !== "" && Number.isFinite(minPrice);
    const hasMaxPrice =
      livestockTypeMaxPrice !== "" && Number.isFinite(maxPrice);

    const filtered = livestockTypes.filter((item) => {
      const categoryExists = item.categoryId
        ? livestockCategoryById.has(item.categoryId)
        : false;
      const isUncategorized = !item.categoryId || !categoryExists;
      const hasImages = (item.images?.length ?? 0) > 0;
      const itemPrice = Number(item.price ?? 0);
      const itemPriceType = item.priceType === "special" ? "special" : "normal";

      if (search) {
        const haystack = [
          item.title ?? item.label ?? "",
          item.shortDescription ?? "",
          item.longDescription ?? "",
          resolveLivestockTypeCategoryLabel(item),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      if (livestockTypeCategoryFilter === UNCATEGORIZED_ID && !isUncategorized) {
        return false;
      }
      if (
        livestockTypeCategoryFilter !== "all" &&
        livestockTypeCategoryFilter !== UNCATEGORIZED_ID &&
        item.categoryId !== livestockTypeCategoryFilter
      ) {
        return false;
      }

      if (
        livestockTypeAvailabilityFilter === "available" &&
        item.available === false
      ) {
        return false;
      }
      if (
        livestockTypeAvailabilityFilter === "unavailable" &&
        item.available !== false
      ) {
        return false;
      }

      if (
        livestockTypePriceTypeFilter !== "all" &&
        itemPriceType !== livestockTypePriceTypeFilter
      ) {
        return false;
      }

      if (livestockTypeHasImageFilter === "with" && !hasImages) return false;
      if (livestockTypeHasImageFilter === "without" && hasImages) return false;

      if (hasMinPrice && itemPrice < minPrice) return false;
      if (hasMaxPrice && itemPrice > maxPrice) return false;

      return true;
    });

    const sorted = filtered.slice().sort((a, b) => {
      const aTitle = String(a.title ?? a.label ?? "");
      const bTitle = String(b.title ?? b.label ?? "");
      let result = 0;

      switch (livestockTypeSortKey) {
        case "title":
          result = aTitle.localeCompare(bTitle);
          break;
        case "category":
          result = resolveLivestockTypeCategoryLabel(a).localeCompare(
            resolveLivestockTypeCategoryLabel(b)
          );
          break;
        case "priceType":
          result =
            (EGG_PRICE_TYPE_ORDER[a.priceType ?? "normal"] ?? 0) -
            (EGG_PRICE_TYPE_ORDER[b.priceType ?? "normal"] ?? 0);
          break;
        case "price":
          result = Number(a.price ?? 0) - Number(b.price ?? 0);
          break;
        case "available":
          result = Number(a.available === false) - Number(b.available === false);
          break;
        case "images":
          result = (a.images?.length ?? 0) - (b.images?.length ?? 0);
          break;
        case "shortDescription":
          result = String(a.shortDescription ?? "").localeCompare(
            String(b.shortDescription ?? "")
          );
          break;
        case "longDescription":
          result = String(a.longDescription ?? "").localeCompare(
            String(b.longDescription ?? "")
          );
          break;
        case "updatedAt":
          result =
            getTimestampValue(getLivestockTypeUpdatedValue(a)) -
            getTimestampValue(getLivestockTypeUpdatedValue(b));
          break;
        case "order":
        default:
          result = toNumber(a.order) - toNumber(b.order);
          break;
      }

      if (result === 0) {
        result = aTitle.localeCompare(bTitle);
      }
      return livestockTypeSortDirection === "desc" ? -result : result;
    });

    return sorted;
  }, [
    livestockCategories,
    livestockCategoryById,
    livestockTypeAvailabilityFilter,
    livestockTypeCategoryFilter,
    livestockTypeHasImageFilter,
    livestockTypeMaxPrice,
    livestockTypeMinPrice,
    livestockTypePriceTypeFilter,
    livestockTypeSearch,
    livestockTypeSortDirection,
    livestockTypeSortKey,
    livestockTypes,
  ]);

  const editingLivestockType = useMemo(
    () =>
      livestockTypes.find((item) => item.id === editingLivestockTypeId) ?? null,
    [livestockTypes, editingLivestockTypeId]
  );

  const applyOrderFilters = (orders) => {
    return orders
      .filter((order) => {
        if (statusFilter === "all") {
          if (
            order.orderStatus === "completed" ||
            order.orderStatus === "archived" ||
            order.orderStatus === "cancelled"
          ) {
            return false;
          }
        } else if (order.orderStatus !== statusFilter) {
          return false;
        }
        if (paidFilter === "paid" && !order.paid) return false;
        if (paidFilter === "unpaid" && order.paid) return false;
        if (!searchTerm.trim()) return true;
        const queryText = searchTerm.toLowerCase();
        return [
          order.name,
          order.surname,
          order.email,
          order.cellphone,
          order.deliveryOption,
          order.eggSummary,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(queryText);
      })
      .sort((a, b) => {
        switch (sortKey) {
          case "orderNumberAsc":
            return String(a.orderNumber).localeCompare(String(b.orderNumber));
          case "orderNumberDesc":
            return String(b.orderNumber).localeCompare(String(a.orderNumber));
          case "createdAsc":
            return (
              (a.createdAtDate?.getTime() ?? 0) -
              (b.createdAtDate?.getTime() ?? 0)
            );
          case "createdDesc":
            return (
              (b.createdAtDate?.getTime() ?? 0) -
              (a.createdAtDate?.getTime() ?? 0)
            );
          case "sendDateAsc":
            return getOrderDateSortValue(a.sendDate).localeCompare(
              getOrderDateSortValue(b.sendDate)
            );
          case "sendDateDesc":
            return getOrderDateSortValue(b.sendDate).localeCompare(
              getOrderDateSortValue(a.sendDate)
            );
          case "status":
            return String(a.orderStatus ?? "").localeCompare(
              String(b.orderStatus ?? "")
            );
          case "totalAsc":
            return (a.totalCost ?? 0) - (b.totalCost ?? 0);
          case "totalDesc":
            return (b.totalCost ?? 0) - (a.totalCost ?? 0);
          default:
            return 0;
        }
      });
  };

  const filteredEggOrders = useMemo(
    () => applyOrderFilters(enrichedEggOrders),
    [enrichedEggOrders, statusFilter, paidFilter, searchTerm, sortKey]
  );
  const filteredLivestockOrders = useMemo(
    () => applyOrderFilters(enrichedLivestockOrders),
    [enrichedLivestockOrders, statusFilter, paidFilter, searchTerm, sortKey]
  );

  useEffect(() => {
    if (
      eggTypeCategoryFilter === "all" ||
      eggTypeCategoryFilter === UNCATEGORIZED_ID
    ) {
      return;
    }
    if (!eggCategories.some((category) => category.id === eggTypeCategoryFilter)) {
      setEggTypeCategoryFilter("all");
    }
  }, [eggCategories, eggTypeCategoryFilter]);

  useEffect(() => {
    if (
      livestockTypeCategoryFilter === "all" ||
      livestockTypeCategoryFilter === UNCATEGORIZED_ID
    ) {
      return;
    }
    if (
      !livestockCategories.some(
        (category) => category.id === livestockTypeCategoryFilter
      )
    ) {
      setLivestockTypeCategoryFilter("all");
    }
  }, [livestockCategories, livestockTypeCategoryFilter]);

  useEffect(() => {
    if (!editingEggTypeId) return;
    if (eggTypes.some((item) => item.id === editingEggTypeId)) return;
    setEditingEggTypeId(null);
    setEggEdits((prev) => {
      if (!prev[editingEggTypeId]) return prev;
      const next = { ...prev };
      delete next[editingEggTypeId];
      return next;
    });
  }, [editingEggTypeId, eggTypes]);

  useEffect(() => {
    if (!editingLivestockTypeId) return;
    if (livestockTypes.some((item) => item.id === editingLivestockTypeId)) return;
    setEditingLivestockTypeId(null);
    setLivestockEdits((prev) => {
      if (!prev[editingLivestockTypeId]) return prev;
      const next = { ...prev };
      delete next[editingLivestockTypeId];
      return next;
    });
  }, [editingLivestockTypeId, livestockTypes]);

  useEffect(() => {
    if (!editingStockItemId) return;
    if (stockItems.some((item) => item.id === editingStockItemId)) return;
    setEditingStockItemId(null);
    setStockEdits((prev) => {
      if (!prev[editingStockItemId]) return prev;
      const next = { ...prev };
      delete next[editingStockItemId];
      return next;
    });
  }, [editingStockItemId, stockItems]);

  useEffect(() => {
    if (!editingStockUpdateItemId) return;
    if (stockItems.some((item) => item.id === editingStockUpdateItemId)) return;
    setEditingStockUpdateItemId(null);
    setStockUpdateDialogDraft({ quantity: "", notes: "" });
    setStockUpdateDialogError("");
  }, [editingStockUpdateItemId, stockItems]);

  useEffect(() => {
    const hasOpenDialog =
      Boolean(libraryPreviewAsset) ||
      isLibraryPickerOpen ||
      isAddEggCategoryDialogOpen ||
      isManageEggCategoriesDialogOpen ||
      isAddEggTypeDialogOpen ||
      editingEggTypeId ||
      isAddLivestockCategoryDialogOpen ||
      isManageLivestockCategoriesDialogOpen ||
      isAddLivestockTypeDialogOpen ||
      editingLivestockTypeId ||
      isAddStockCategoryDialogOpen ||
      isManageStockCategoriesDialogOpen ||
      isAddStockItemDialogOpen ||
      editingStockItemId ||
      editingStockUpdateItemId;
    if (!hasOpenDialog) return undefined;

    const handleDialogEscape = (event) => {
      if (event.key !== "Escape") return;
      if (libraryPreviewAsset) {
        setLibraryPreviewAsset(null);
        setLibraryPreviewZoom(1);
        return;
      }
      if (isLibraryPickerOpen) {
        if (libraryPickerApplying) return;
        setIsLibraryPickerOpen(false);
        setLibraryPickerSelection({});
        setLibraryPickerSearch("");
        setLibraryPickerTypeId("");
        return;
      }
      if (editingEggTypeId) {
        closeEggTypeEditDialog();
        return;
      }
      if (isAddEggTypeDialogOpen) {
        closeAddEggTypeDialog();
        return;
      }
      if (isAddEggCategoryDialogOpen) {
        setIsAddEggCategoryDialogOpen(false);
        setEggCategoryError("");
        setEggCategoryDraft({ name: "", description: "", order: "" });
        return;
      }
      if (isManageEggCategoriesDialogOpen) {
        setIsManageEggCategoriesDialogOpen(false);
        return;
      }
      if (editingLivestockTypeId) {
        closeLivestockTypeEditDialog();
        return;
      }
      if (isAddLivestockTypeDialogOpen) {
        closeAddLivestockTypeDialog();
        return;
      }
      if (isAddLivestockCategoryDialogOpen) {
        setIsAddLivestockCategoryDialogOpen(false);
        setCategoryError("");
        setCategoryDraft({ name: "", description: "", order: "" });
        return;
      }
      if (isManageLivestockCategoriesDialogOpen) {
        setIsManageLivestockCategoriesDialogOpen(false);
        return;
      }
      if (editingStockItemId) {
        setStockItemError("");
        setStockEdits((prev) => {
          if (!prev[editingStockItemId]) return prev;
          const next = { ...prev };
          delete next[editingStockItemId];
          return next;
        });
        setEditingStockItemId(null);
        return;
      }
      if (isAddStockItemDialogOpen) {
        setIsAddStockItemDialogOpen(false);
        setStockItemError("");
        setStockItemDraft({
          name: "",
          categoryId: "",
          subCategory: "",
          quantity: "",
          threshold: "5",
          notes: "",
        });
        return;
      }
      if (isAddStockCategoryDialogOpen) {
        setIsAddStockCategoryDialogOpen(false);
        setStockCategoryError("");
        setStockCategoryDraft({ name: "" });
        return;
      }
      if (isManageStockCategoriesDialogOpen) {
        setIsManageStockCategoriesDialogOpen(false);
        return;
      }
      if (editingStockUpdateItemId) {
        setEditingStockUpdateItemId(null);
        setStockUpdateDialogDraft({ quantity: "", notes: "" });
        setStockUpdateDialogError("");
      }
    };

    window.addEventListener("keydown", handleDialogEscape);
    return () => window.removeEventListener("keydown", handleDialogEscape);
  }, [
    libraryPreviewAsset,
    isLibraryPickerOpen,
    libraryPickerApplying,
    editingEggTypeId,
    editingLivestockTypeId,
    editingStockItemId,
    editingStockUpdateItemId,
    isAddEggCategoryDialogOpen,
    isManageEggCategoriesDialogOpen,
    isAddEggTypeDialogOpen,
    isAddingEggType,
    isAddLivestockCategoryDialogOpen,
    isManageLivestockCategoriesDialogOpen,
    isAddLivestockTypeDialogOpen,
    isAddingLivestockType,
    eggImageUploads,
    livestockImageUploads,
    isAddStockCategoryDialogOpen,
    isManageStockCategoriesDialogOpen,
    isAddStockItemDialogOpen,
  ]);

  useEffect(() => {
    if (!selectedOrder) return;
    const source =
      selectedOrderCollection === "livestockOrders"
        ? enrichedLivestockOrders
        : enrichedEggOrders;
    const updated = source.find((item) => item.id === selectedOrder.id);
    if (updated && updated !== selectedOrder) setSelectedOrder(updated);
  }, [
    selectedOrder,
    selectedOrderCollection,
    enrichedEggOrders,
    enrichedLivestockOrders,
  ]);

  const stockCategoryLookup = useMemo(() => {
    const lookup = new Map();
    stockCategories.forEach((category) => {
      lookup.set(category.id, category.name ?? "Unnamed");
    });
    return lookup;
  }, [stockCategories]);

  const stockCategoryOptions = useMemo(() => {
    const options = stockCategories.map((category) => ({
      id: category.id,
      name: category.name ?? "Unnamed",
    }));
    return [
      { id: "all", name: "All categories" },
      ...options,
      { id: UNCATEGORIZED_ID, name: UNCATEGORIZED_LABEL },
    ];
  }, [stockCategories]);

  const filteredStockItems = useMemo(() => {
    const queryText = stockSearch.trim().toLowerCase();
    const filtered = stockItems.filter((item) => {
      const matchesCategory =
        stockCategoryFilter === "all" ||
        (stockCategoryFilter === UNCATEGORIZED_ID && !item.categoryId) ||
        item.categoryId === stockCategoryFilter;
      if (!matchesCategory) return false;
      if (!queryText) return true;
      return [item.name, item.category, item.subCategory, item.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(queryText);
    });

    return filtered.sort((a, b) => {
      switch (stockSort) {
        case "name_desc":
          return String(b.name ?? "").localeCompare(String(a.name ?? ""));
        case "quantity_asc":
          return Number(a.quantity ?? 0) - Number(b.quantity ?? 0);
        case "quantity_desc":
          return Number(b.quantity ?? 0) - Number(a.quantity ?? 0);
        case "threshold_asc":
          return Number(a.threshold ?? 0) - Number(b.threshold ?? 0);
        case "threshold_desc":
          return Number(b.threshold ?? 0) - Number(a.threshold ?? 0);
        case "name_asc":
        default:
          return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      }
    });
  }, [stockItems, stockSearch, stockCategoryFilter, stockSort]);

  const editingStockItem = useMemo(
    () => stockItems.find((item) => item.id === editingStockItemId) ?? null,
    [stockItems, editingStockItemId]
  );

  useEffect(() => {
    if (
      stockCategoryFilter === "all" ||
      stockCategoryFilter === UNCATEGORIZED_ID
    ) {
      return;
    }
    if (!stockCategories.some((category) => category.id === stockCategoryFilter)) {
      setStockCategoryFilter("all");
    }
  }, [stockCategories, stockCategoryFilter]);

  const stockUpdateList = useMemo(() => {
    return stockItems.map((item) => {
      const categoryName = String(item.category ?? "").trim();
      const categoryKey =
        item.categoryId || (categoryName ? `name:${categoryName}` : UNCATEGORIZED_ID);
      const categoryLabel =
        stockCategoryLookup.get(item.categoryId) ||
        categoryName ||
        UNCATEGORIZED_LABEL;
      const subCategoryLabel = String(item.subCategory ?? "").trim();
      const currentQuantity = Number(item.quantity ?? 0);
      const draft = stockUpdateDrafts[item.id] ?? {};
      const pendingQuantity = resolveStockUpdateQuantity(draft, currentQuantity);
      const currentNotes = String(item.notes ?? "");
      const pendingNotes = String(draft.notes ?? currentNotes);
      const pendingChange = pendingQuantity - currentQuantity;
      return {
        item,
        id: item.id,
        name: String(item.name ?? "Unnamed"),
        categoryKey,
        categoryLabel,
        subCategoryLabel: subCategoryLabel || "-",
        currentQuantity,
        pendingQuantity,
        pendingChange,
        pendingNotes,
        updatedBy: item.updatedBy ?? "-",
        updatedAt: item.updatedAt ?? null,
        updatedAtValue: getTimestampValue(item.updatedAt),
        hasDraft: Boolean(stockUpdateDrafts[item.id]),
        hasPendingChange:
          pendingQuantity !== currentQuantity || pendingNotes !== currentNotes,
      };
    });
  }, [stockItems, stockCategoryLookup, stockUpdateDrafts]);

  const stockUpdateCategoryOptions = useMemo(() => {
    const categoryMap = new Map();
    stockUpdateList.forEach((item) => {
      categoryMap.set(item.categoryKey, item.categoryLabel);
    });
    const sorted = Array.from(categoryMap.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ id: "all", label: "All categories" }, ...sorted];
  }, [stockUpdateList]);

  useEffect(() => {
    if (stockUpdateCategoryFilter === "all") return;
    const stillValid = stockUpdateCategoryOptions.some(
      (option) => option.id === stockUpdateCategoryFilter
    );
    if (!stillValid) setStockUpdateCategoryFilter("all");
  }, [stockUpdateCategoryFilter, stockUpdateCategoryOptions]);

  const stockUpdatesFilteredSorted = useMemo(() => {
    const queryText = stockUpdateSearch.trim().toLowerCase();
    const filtered = stockUpdateList.filter((item) => {
      if (
        stockUpdateCategoryFilter !== "all" &&
        item.categoryKey !== stockUpdateCategoryFilter
      ) {
        return false;
      }
      if (!queryText) return true;
      const searchText = [
        item.name,
        item.categoryLabel,
        item.subCategoryLabel,
        item.pendingNotes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchText.includes(queryText);
    });

    return filtered.sort((a, b) => {
      const fallback = () => a.name.localeCompare(b.name);
      switch (stockUpdateSort) {
        case "name_desc":
          return b.name.localeCompare(a.name);
        case "category_asc": {
          const categoryOrder = a.categoryLabel.localeCompare(b.categoryLabel);
          return categoryOrder !== 0 ? categoryOrder : fallback();
        }
        case "category_desc": {
          const categoryOrder = b.categoryLabel.localeCompare(a.categoryLabel);
          return categoryOrder !== 0 ? categoryOrder : fallback();
        }
        case "current_qty_asc":
          return (
            a.currentQuantity - b.currentQuantity ||
            a.pendingQuantity - b.pendingQuantity ||
            fallback()
          );
        case "current_qty_desc":
          return (
            b.currentQuantity - a.currentQuantity ||
            b.pendingQuantity - a.pendingQuantity ||
            fallback()
          );
        case "pending_qty_asc":
          return a.pendingQuantity - b.pendingQuantity || fallback();
        case "pending_qty_desc":
          return b.pendingQuantity - a.pendingQuantity || fallback();
        case "change_asc":
          return a.pendingChange - b.pendingChange || fallback();
        case "change_desc":
          return b.pendingChange - a.pendingChange || fallback();
        case "updated_asc":
          return a.updatedAtValue - b.updatedAtValue || fallback();
        case "updated_desc":
          return b.updatedAtValue - a.updatedAtValue || fallback();
        case "name_asc":
        default:
          return fallback();
      }
    });
  }, [
    stockUpdateList,
    stockUpdateCategoryFilter,
    stockUpdateSearch,
    stockUpdateSort,
  ]);

  const editingStockUpdateItem = useMemo(
    () =>
      stockUpdateList.find((item) => item.id === editingStockUpdateItemId) ??
      null,
    [stockUpdateList, editingStockUpdateItemId]
  );

  const stockUpdatePendingCount = useMemo(
    () => stockUpdateList.filter((item) => item.hasPendingChange).length,
    [stockUpdateList]
  );

  const hasPendingStockUpdates = useMemo(() => {
    return stockUpdateList.some((item) => item.hasPendingChange);
  }, [stockUpdateList]);

  const allStockLogs = useMemo(() => {
    const merged = [
      ...stockLogs.map((log) => ({ ...log, logType: "stockLogs" })),
      ...stockUpdateLogs.map((log) => ({ ...log, logType: "stockUpdateLogs" })),
    ];
    return groupStockLogs(merged);
  }, [stockLogs, stockUpdateLogs]);

  const visibleStockLogs = useMemo(
    () =>
      showAllStockLogs
        ? allStockLogs
        : allStockLogs.slice(0, STOCK_LOG_LIMIT),
    [allStockLogs, showAllStockLogs]
  );

  const filteredStockLogs = useMemo(() => {
    const queryText = stockLogSearch.trim().toLowerCase();
    if (!queryText) return visibleStockLogs;
    return visibleStockLogs.filter((log) => {
      const entries = getLogEntries(log);
      const entryText = entries
        .map((entry) =>
          [
            entry.name,
            entry.notes,
            formatChangeValue(entry.change),
            entry.fromQty,
            entry.toQty,
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ");
      return [
        log.summary,
        log.name,
        log.notes,
        log.userEmail,
        log.updatedBy,
        formatChangeValue(toNumber(log.change)),
        log.fromQty,
        log.toQty,
        entryText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(queryText);
    });
  }, [visibleStockLogs, stockLogSearch]);

  const allReportOrders = useMemo(
    () => [
      ...enrichedEggOrders.map((order) => ({ ...order, orderType: "eggs" })),
      ...enrichedLivestockOrders.map((order) => ({
        ...order,
        orderType: "livestock",
      })),
    ],
    [enrichedEggOrders, enrichedLivestockOrders]
  );

  const reportDateRange = useMemo(() => {
    const parseDateValue = (value) => {
      if (!value) return null;
      const date = new Date(`${value}T00:00:00`);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const parseMonthValue = (value) => {
      if (!value) return null;
      const [year, month] = value.split("-").map(Number);
      if (!year || !month) return null;
      return new Date(year, month - 1, 1);
    };

    let start = null;
    let end = null;

    switch (reportTimeScope) {
      case "day": {
        start = parseDateValue(reportDay);
        if (start) {
          end = new Date(start);
          end.setDate(start.getDate() + 1);
        }
        break;
      }
      case "week": {
        start = parseDateValue(reportWeekStart);
        if (start) {
          end = new Date(start);
          end.setDate(start.getDate() + 7);
        }
        break;
      }
      case "year": {
        const year = Number(reportYear);
        if (Number.isFinite(year)) {
          start = new Date(year, 0, 1);
          end = new Date(year + 1, 0, 1);
        }
        break;
      }
      case "custom": {
        const customStart = parseDateValue(reportCustomStart);
        const customEnd = parseDateValue(reportCustomEnd);
        if (customStart && customEnd) {
          start = customStart;
          end = new Date(customEnd);
          end.setDate(customEnd.getDate() + 1);
        }
        break;
      }
      case "month":
      default: {
        start = parseMonthValue(reportMonth);
        if (start) {
          end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        }
        break;
      }
    }

    if (!start || !end) return null;
    return { start, end };
  }, [
    reportTimeScope,
    reportDay,
    reportWeekStart,
    reportMonth,
    reportYear,
    reportCustomStart,
    reportCustomEnd,
  ]);

  const reportOrders = useMemo(() => {
    const statusSet = new Set(reportStatusFilter);
    const hasStatusFilter = statusSet.size > 0;
    return allReportOrders.filter((order) => {
      const orderDate =
        order.createdAtDate ?? resolveTimestampDate(order.createdAt);
      if (reportDateRange) {
        if (!orderDate) return false;
        if (
          orderDate < reportDateRange.start ||
          orderDate >= reportDateRange.end
        ) {
          return false;
        }
      }
      if (reportOrderType !== "all" && order.orderType !== reportOrderType) {
        return false;
      }
      if (reportPaidFilter === "paid" && !order.paid) return false;
      if (reportPaidFilter === "unpaid" && order.paid) return false;

      if (order.orderStatus === "archived") {
        return reportIncludeArchived;
      }
      if (hasStatusFilter && !statusSet.has(order.orderStatus ?? "pending")) {
        return false;
      }
      return true;
    });
  }, [
    allReportOrders,
    reportDateRange,
    reportOrderType,
    reportPaidFilter,
    reportStatusFilter,
    reportIncludeArchived,
  ]);

  const archivedReportOrders = useMemo(() => {
    return allReportOrders.filter((order) => {
      if (order.orderStatus !== "archived") return false;
      const orderDate =
        order.createdAtDate ?? resolveTimestampDate(order.createdAt);
      if (reportDateRange) {
        if (!orderDate) return false;
        if (
          orderDate < reportDateRange.start ||
          orderDate >= reportDateRange.end
        ) {
          return false;
        }
      }
      if (reportOrderType !== "all" && order.orderType !== reportOrderType) {
        return false;
      }
      if (reportPaidFilter === "paid" && !order.paid) return false;
      if (reportPaidFilter === "unpaid" && order.paid) return false;
      return true;
    });
  }, [allReportOrders, reportDateRange, reportOrderType, reportPaidFilter]);

  const archivedOrdersSummary = useMemo(() => {
    const totalValue = archivedReportOrders.reduce(
      (sum, order) => sum + (order.totalCost ?? 0),
      0
    );
    return {
      totalOrders: archivedReportOrders.length,
      totalValue,
    };
  }, [archivedReportOrders]);

  const ordersSummary = useMemo(() => {
    const totalValue = reportOrders.reduce(
      (sum, order) => sum + (order.totalCost ?? 0),
      0
    );
    return {
      totalOrders: reportOrders.length,
      totalValue,
      paidCount: reportOrders.filter((order) => order.paid).length,
    };
  }, [reportOrders]);

  const financeOrders = useMemo(
    () => allReportOrders.filter((order) => order.orderStatus !== "archived"),
    [allReportOrders]
  );

  const readyDispatchEggCount = useMemo(() => {
    const readyStatuses = new Set(["packed", "scheduled_dispatch"]);
    return enrichedEggOrders.reduce((sum, order) => {
      if (!readyStatuses.has(order.orderStatus)) return sum;
      const eggs = Array.isArray(order.eggs) ? order.eggs : [];
      const orderCount = eggs.reduce(
        (eggSum, item) => eggSum + toNumber(item.quantity),
        0
      );
      return sum + orderCount;
    }, 0);
  }, [enrichedEggOrders]);

  const resolveFinanceEntryDate = (entry) => {
    if (entry.date) return new Date(`${entry.date}T00:00:00`);
    return resolveTimestampDate(entry.createdAt);
  };

  const resolveOrderIncomeDate = (order) => {
    if (order.orderStatus === "completed") {
      const completed = resolveTimestampDate(order.completedAt);
      if (completed) return completed;
    }
    if (order.paid) {
      const paid = resolveTimestampDate(order.paidAt);
      if (paid) return paid;
    }
    return resolveTimestampDate(order.createdAtDate ?? order.createdAt);
  };

  const orderIncomeEntries = useMemo(() => {
    return financeOrders
      .filter((order) => order.orderStatus !== "cancelled")
      .filter((order) => order.orderStatus === "completed" || order.paid)
      .map((order) => {
        const amount = toNumber(order.totalCost);
        const orderDate = resolveOrderIncomeDate(order);
        const customer = [order.name, order.surname]
          .filter(Boolean)
          .join(" ")
          .trim();
        const orderLabel = order.orderNumber
          ? `Order ${order.orderNumber}`
          : "Order";
        const description = [orderLabel, customer].filter(Boolean).join(" · ");
        return {
          id: `order-${order.id}`,
          type: "income",
          amount,
          description: description || "Order income",
          date: formatDateValue(orderDate),
          createdAt: orderDate ?? null,
          source: "order",
          orderId: order.id,
          orderNumber: order.orderNumber ?? "",
        };
      })
      .filter((entry) => entry.amount !== 0);
  }, [financeOrders]);

  const combinedFinanceEntries = useMemo(
    () => [...financeEntries, ...orderIncomeEntries],
    [financeEntries, orderIncomeEntries]
  );

  const financeSummary = useMemo(() => {
    return combinedFinanceEntries.reduce(
      (totals, entry) => {
        const amount = Number(entry.amount ?? 0);
        if (entry.type === "income") totals.income += amount;
        else totals.expense += amount;
        return totals;
      },
      { income: 0, expense: 0 }
    );
  }, [combinedFinanceEntries]);
  const financeSummaryBalance = financeSummary.income - financeSummary.expense;

  const financeDateRange = useMemo(() => {
    const now = new Date();
    const parseMonthValue = (value) => {
      if (!value) return null;
      const [year, month] = value.split("-").map(Number);
      if (!year || !month) return null;
      return new Date(year, month - 1, 1);
    };
    const monthStart =
      parseMonthValue(financeMonth) ||
      new Date(now.getFullYear(), now.getMonth(), 1);
    let start;
    let end;
    switch (financeTimeScope) {
      case "day": {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(start);
        end.setDate(start.getDate() + 1);
        break;
      }
      case "week": {
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        start = new Date(end);
        start.setDate(end.getDate() - 7);
        break;
      }
      case "year": {
        start = new Date(monthStart.getFullYear(), 0, 1);
        end = new Date(monthStart.getFullYear() + 1, 0, 1);
        break;
      }
      case "month":
      default: {
        start = monthStart;
        end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
        break;
      }
    }
    return { start, end };
  }, [financeMonth, financeTimeScope]);

  const filteredFinanceEntries = useMemo(() => {
    const minAmount = financeMinAmount === "" ? null : Number(financeMinAmount);
    const maxAmount = financeMaxAmount === "" ? null : Number(financeMaxAmount);
    const { start, end } = financeDateRange;

    const filtered = combinedFinanceEntries.filter((entry) => {
      const amount = Number(entry.amount ?? 0);
      if (
        minAmount !== null &&
        Number.isFinite(minAmount) &&
        amount < minAmount
      ) {
        return false;
      }
      if (
        maxAmount !== null &&
        Number.isFinite(maxAmount) &&
        amount > maxAmount
      ) {
        return false;
      }
      if (financeHasReceipt && !entry.attachmentUrl) return false;
      const entryDate = resolveFinanceEntryDate(entry);
      if (!entryDate) return false;
      if (entryDate < start || entryDate >= end) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      const amountA = Number(a.amount ?? 0);
      const amountB = Number(b.amount ?? 0);
      const dateA = resolveFinanceEntryDate(a)?.getTime() ?? 0;
      const dateB = resolveFinanceEntryDate(b)?.getTime() ?? 0;
      switch (financeSort) {
        case "amountAsc":
          return amountA - amountB;
        case "amountDesc":
          return amountB - amountA;
        case "dateAsc":
          return dateA - dateB;
        case "dateDesc":
        default:
          return dateB - dateA;
      }
    });
  }, [
    combinedFinanceEntries,
    financeDateRange,
    financeMinAmount,
    financeMaxAmount,
    financeHasReceipt,
    financeSort,
  ]);

  const financeTotals = useMemo(() => {
    return filteredFinanceEntries.reduce(
      (totals, entry) => {
        const amount = Number(entry.amount ?? 0);
        if (entry.type === "income") totals.income += amount;
        else totals.expense += amount;
        return totals;
      },
      { income: 0, expense: 0 }
    );
  }, [filteredFinanceEntries]);

  const financeIncomeEntries = useMemo(
    () => filteredFinanceEntries.filter((entry) => entry.type === "income"),
    [filteredFinanceEntries]
  );
  const financeExpenseEntries = useMemo(
    () => filteredFinanceEntries.filter((entry) => entry.type === "expense"),
    [filteredFinanceEntries]
  );
  const financeBalance = financeTotals.income - financeTotals.expense;

  const reportStatusOptions = useMemo(() => {
    if (reportStatusFilter.length === 0) {
      return reportIncludeArchived ? ORDER_STATUSES : REPORT_ORDER_STATUSES;
    }
    const selected = new Set(reportStatusFilter);
    const base = reportIncludeArchived ? ORDER_STATUSES : REPORT_ORDER_STATUSES;
    return base.filter((status) => {
      if (status.id === "archived") return reportIncludeArchived;
      return selected.has(status.id);
    });
  }, [reportIncludeArchived, reportStatusFilter]);

  const orderStatusDistribution = useMemo(() => {
    const counts = reportStatusOptions.reduce((acc, status) => {
      acc[status.id] = 0;
      return acc;
    }, {});
    reportOrders.forEach((order) => {
      const status = order.orderStatus ?? "pending";
      if (counts[status] === undefined) {
        counts[status] = 0;
      }
      counts[status] += 1;
    });
    const maxCount = Math.max(0, ...Object.values(counts));
    return reportStatusOptions.map((status) => {
      const count = counts[status.id] ?? 0;
      const percent = maxCount === 0 ? 0 : Math.round((count / maxCount) * 100);
      return { ...status, count, percent };
    });
  }, [reportOrders, reportStatusOptions]);

  const orderStatusAverageDays = useMemo(() => {
    const totals = reportStatusOptions.reduce((acc, status) => {
      acc[status.id] = { count: 0, sumDays: 0 };
      return acc;
    }, {});
    const now = Date.now();
    reportOrders.forEach((order) => {
      const status = order.orderStatus ?? "pending";
      const createdAt = order.createdAtDate;
      if (!createdAt) return;
      if (!totals[status]) totals[status] = { count: 0, sumDays: 0 };
      const days = (now - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      totals[status].count += 1;
      totals[status].sumDays += days;
    });
    return reportStatusOptions.map((status) => {
      const entry = totals[status.id] ?? { count: 0, sumDays: 0 };
      const avg = entry.count ? entry.sumDays / entry.count : 0;
      return { ...status, avgDays: avg };
    });
  }, [reportOrders, reportStatusOptions]);

  const stockSummary = useMemo(() => {
    const totalItems = stockItems.length;
    const lowStock = stockItems.filter((item) => {
      const quantity = Number(item.quantity ?? 0);
      const threshold = Number(item.threshold ?? 0);
      if (!Number.isFinite(threshold) || threshold <= 0) return false;
      return quantity <= threshold;
    }).length;
    const totalQuantity = stockItems.reduce(
      (sum, item) => sum + Number(item.quantity ?? 0),
      0
    );
    return { totalItems, lowStock, totalQuantity };
  }, [stockItems]);

  const stockCategoryBreakdown = useMemo(() => {
    const totals = new Map();
    stockItems.forEach((item) => {
      const label =
        stockCategoryLookup.get(item.categoryId) ??
        item.category?.trim() ??
        UNCATEGORIZED_LABEL;
      const quantity = Number(item.quantity ?? 0);
      totals.set(label, (totals.get(label) ?? 0) + quantity);
    });
    const entries = Array.from(totals.entries())
      .map(([label, quantity]) => ({ label, quantity }))
      .sort((a, b) => b.quantity - a.quantity);
    const maxRows = 5;
    const visible = entries.slice(0, maxRows);
    const remaining = entries.slice(maxRows);
    if (remaining.length > 0) {
      const otherTotal = remaining.reduce(
        (sum, entry) => sum + entry.quantity,
        0
      );
      visible.push({ label: "Other", quantity: otherTotal });
    }
    return visible;
  }, [stockItems, stockCategoryLookup]);

  const financeTrend = useMemo(() => {
    const totals = new Map();
    combinedFinanceEntries.forEach((entry) => {
      const date = resolveFinanceEntryDate(entry);
      if (!date) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        "0"
      )}`;
      const label = date.toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      });
      const current = totals.get(key) ?? {
        key,
        label,
        income: 0,
        expense: 0,
        date,
      };
      const amount = Number(entry.amount ?? 0);
      if (entry.type === "income") current.income += amount;
      else current.expense += amount;
      totals.set(key, current);
    });
    let entries = Array.from(totals.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
    if (entries.length === 0) {
      const now = new Date();
      entries = [
        {
          key: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
            2,
            "0"
          )}`,
          label: now.toLocaleString("en-US", {
            month: "short",
            year: "numeric",
          }),
          income: 0,
          expense: 0,
          date: now,
        },
      ];
    }
    const recent = entries.slice(-6);
    const maxAmount = Math.max(
      0,
      ...recent.map((entry) => Math.max(entry.income, entry.expense))
    );
    return recent.map((entry) => ({
      ...entry,
      incomePercent:
        maxAmount === 0 ? 0 : Math.round((entry.income / maxAmount) * 100),
      expensePercent:
        maxAmount === 0 ? 0 : Math.round((entry.expense / maxAmount) * 100),
    }));
  }, [combinedFinanceEntries]);

  const financeActivity = useMemo(() => {
    const sorted = [...combinedFinanceEntries].sort((a, b) => {
      const dateA = resolveFinanceEntryDate(a)?.getTime() ?? 0;
      const dateB = resolveFinanceEntryDate(b)?.getTime() ?? 0;
      return dateB - dateA;
    });
    const recent = sorted.slice(0, 4);
    const receipts = combinedFinanceEntries.filter(
      (entry) => entry.attachmentUrl
    ).length;
    const expenseEntries = combinedFinanceEntries.filter(
      (entry) => entry.type === "expense"
    );
    const averageExpense =
      expenseEntries.length === 0
        ? 0
        : expenseEntries.reduce(
            (sum, entry) => sum + Number(entry.amount ?? 0),
            0
          ) / expenseEntries.length;
    return {
      totalEntries: combinedFinanceEntries.length,
      receipts,
      averageExpense,
      recent,
    };
  }, [combinedFinanceEntries]);

  const handlePaidToggle = async (collectionName, order) => {
    try {
      const nextPaid = !order.paid;
      await updateDoc(doc(db, collectionName, order.id), {
        paid: nextPaid,
        paidAt: nextPaid ? serverTimestamp() : null,
      });
    } catch (err) {
      console.error("paid toggle error", err);
    }
  };

  const handleOrderUpdate = async (collectionName, orderId, updates) => {
    try {
      await updateDoc(doc(db, collectionName, orderId), updates);
    } catch (err) {
      console.error("order update error", err);
    }
  };

  const handleOrderDelete = async (collectionName, order) => {
    if (!isAdmin) return;
    if (!window.confirm(`Delete order ${order.orderNumber || ""}?`)) return;
    try {
      await deleteDoc(doc(db, collectionName, order.id));
      setSelectedOrder(null);
    } catch (err) {
      console.error("order delete error", err);
    }
  };

  const handleAddEggCategory = async () => {
    setEggCategoryError("");
    setEggCategoryMessage("");
    if (!eggCategoryDraft.name.trim()) {
      setEggCategoryError("Category name is required.");
      return;
    }
    const orderValue = Number(eggCategoryDraft.order);
    if (!Number.isFinite(orderValue) || orderValue < 1) {
      setEggCategoryError("Order number is required.");
      return;
    }
    try {
      await addDoc(collection(db, "eggCategories"), {
        name: eggCategoryDraft.name.trim(),
        description: eggCategoryDraft.description.trim(),
        order: orderValue,
      });
      setEggCategoryDraft({ name: "", description: "", order: "" });
      setEggCategoryMessage("Category added.");
      setIsAddEggCategoryDialogOpen(false);
    } catch (err) {
      console.error("add egg category error", err);
      setEggCategoryError("Unable to add category.");
    }
  };

  const handleSaveEggCategory = async (category) => {
    try {
      const updates = {
        name: category.name,
        description: category.description ?? "",
      };
      const orderValue = Number(category.order);
      if (Number.isFinite(orderValue) && orderValue > 0) {
        updates.order = orderValue;
      }
      await updateDoc(doc(db, "eggCategories", category.id), updates);
      setEggCategoryMessage("Category updated.");
    } catch (err) {
      console.error("save egg category error", err);
    }
  };

  const handleDeleteEggCategory = async (category) => {
    if (!window.confirm(`Delete category ${category.name}?`)) return;
    try {
      await deleteDoc(doc(db, "eggCategories", category.id));
    } catch (err) {
      console.error("delete egg category error", err);
    }
  };

  const getTypeCollectionName = (variant) =>
    variant === "livestock" ? "livestockTypes" : "eggTypes";

  const getLibraryDraftImages = (variant) =>
    variant === "livestock" ? livestockDraftLibraryImages : eggDraftLibraryImages;

  const getDeviceDraftImages = (variant) =>
    variant === "livestock" ? livestockDraftImages : eggDraftImages;

  const getDraftImageCount = (variant) =>
    getDeviceDraftImages(variant).length + getLibraryDraftImages(variant).length;

  const getDraftImageRemainingSlots = (variant) =>
    Math.max(0, MAX_TYPE_IMAGES - getDraftImageCount(variant));

  const readImageDimensions = (file) =>
    new Promise((resolve) => {
      if (!(file instanceof File)) {
        resolve({ width: null, height: null });
        return;
      }
      try {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve({
            width: Number(image.naturalWidth || image.width || 0) || null,
            height: Number(image.naturalHeight || image.height || 0) || null,
          });
        };
        image.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve({ width: null, height: null });
        };
        image.src = objectUrl;
      } catch (_error) {
        resolve({ width: null, height: null });
      }
    });

  const uploadImageAssetToLibrary = async ({
    file,
    scopeKey,
    source = "upload",
  }) => {
    const safeName = sanitizeFileName(file?.name || "image");
    const storageKey = `${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}_${safeName}`;
    const assetId = toLibraryAssetDocId(storageKey);
    const fileRef = storageRef(storage, `type-library/${assetId}/${storageKey}`);

    if (scopeKey && isUploadScopeCanceled(scopeKey)) {
      throw createUploadCanceledError();
    }

    const optimization = await optimizeImageForUpload(file, {
      maxLongEdge: 1920,
    });

    if (scopeKey && isUploadScopeCanceled(scopeKey)) {
      throw createUploadCanceledError();
    }

    const uploadFile = optimization.file ?? file;
    const uploadMetadata = {
      contentType: uploadFile.type || file.type || "image/jpeg",
      cacheControl: TYPE_IMAGE_CACHE_CONTROL,
      customMetadata: {
        tcfClientOptimized: optimization.optimized ? "1" : "0",
        tcfOriginalBytes: String(optimization.originalBytes || file.size || 0),
        tcfOptimizedBytes: String(
          optimization.optimizedBytes || uploadFile.size || 0
        ),
      },
    };
    const task = uploadBytesResumable(fileRef, uploadFile, uploadMetadata);
    registerUploadTask(scopeKey, task);

    const url = await new Promise((resolve, reject) => {
      const finalize = () => unregisterUploadTask(scopeKey, task);
      task.on(
        "state_changed",
        undefined,
        (error) => {
          finalize();
          reject(error);
        },
        async () => {
          try {
            const nextUrl = await getDownloadURL(task.snapshot.ref);
            finalize();
            resolve(nextUrl);
          } catch (error) {
            finalize();
            reject(error);
          }
        }
      );
    });

    if (scopeKey && isUploadScopeCanceled(scopeKey)) {
      throw createUploadCanceledError();
    }

    const dimensions = await readImageDimensions(uploadFile);
    const assetPayload = {
      name: String(file?.name || safeName).trim() || safeName,
      url,
      path: fileRef.fullPath,
      contentType: uploadFile.type || file.type || "image/jpeg",
      sizeBytes: Number(uploadFile.size || file.size || 0),
      width: dimensions.width ?? null,
      height: dimensions.height ?? null,
      createdByUid: user?.uid ?? "",
      createdByEmail: user?.email ?? "",
      source: source === "backfill" ? "backfill" : "upload",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, "typeImageLibrary", assetId), assetPayload, {
      merge: true,
    });

    const asset = normalizeLibraryAsset({
      id: assetId,
      ...assetPayload,
    });

    return {
      asset,
      typeImage: buildTypeImageFromLibraryAsset(asset, 0),
    };
  };

  const normalizeImagesForWrite = (images = []) =>
    normalizeTypeImages({ images })
      .slice(0, MAX_TYPE_IMAGES)
      .map((image, index) => ({
        id:
          String(image.id || "").trim() ||
          `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        assetId: String(image.assetId || "").trim(),
        url: String(image.url || "").trim(),
        path: String(image.path || "").trim(),
        name: String(image.name || `Image ${index + 1}`).trim(),
        order: index,
        createdAt: image.createdAt ?? Date.now(),
      }));

  const buildTypePayload = ({
    variant,
    draft,
    categoryName,
    orderValue,
    images = [],
    available = true,
  }) => {
    const normalizedImages = normalizeImagesForWrite(images);
    const primaryImage = buildPrimaryImageFields(normalizedImages);
    const payload = {
      title: draft.title.trim(),
      label: draft.title.trim(),
      shortDescription: draft.shortDescription.trim(),
      longDescription: draft.longDescription.trim(),
      priceType: draft.priceType === "special" ? "special" : "normal",
      price: Number(draft.price),
      specialPrice: null,
      order: orderValue,
      categoryId: draft.categoryId || "",
      categoryName: categoryName ?? "",
      available: available !== false,
      images: normalizedImages,
      ...primaryImage,
      imageUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (variant === "egg") {
      EGG_INFO_FIELDS.forEach((field) => {
        payload[field.key] = String(draft[field.key] ?? "").trim();
      });
    }
    return payload;
  };

  const uploadTypeImageFile = async ({
    variant,
    typeId,
    file,
    order,
    scopeKey,
  }) => {
    const uploaded = await uploadImageAssetToLibrary({
      file,
      scopeKey,
      source: "upload",
    });
    return {
      ...uploaded.typeImage,
      order,
      createdAt: Date.now(),
    };
  };

  const uploadTypeImages = async ({
    variant,
    typeId,
    files,
    existingImages = [],
    scopeKey,
  }) => {
    const current = normalizeImagesForWrite(existingImages);
    const remainingSlots = Math.max(0, MAX_TYPE_IMAGES - current.length);
    const filesToUpload = files.slice(0, remainingSlots);
    const uploaded = [];
    try {
      for (let index = 0; index < filesToUpload.length; index += 1) {
        if (scopeKey && isUploadScopeCanceled(scopeKey)) {
          throw createUploadCanceledError();
        }
        const file = filesToUpload[index];
        const uploadedImage = await uploadTypeImageFile({
          variant,
          typeId,
          file,
          order: current.length + index,
          scopeKey,
        });
        uploaded.push(uploadedImage);
      }
    } catch (err) {
      const uploadError = new Error("Type image upload failed.");
      uploadError.uploadedImages = uploaded;
      uploadError.uploadCanceled = isUploadCanceledError(err);
      uploadError.code = err?.code;
      uploadError.cause = err;
      throw uploadError;
    }
    return {
      nextImages: normalizeImagesForWrite(current.concat(uploaded)),
      uploadedImages: uploaded,
    };
  };

  const validateTypeDraft = (draft) => {
    if (!draft.title.trim()) return "Title is required.";
    if (!draft.shortDescription.trim()) return "Short description is required.";
    if (!draft.categoryId) return "Category is required.";
    if (!Number.isFinite(Number(draft.price)) || Number(draft.price) <= 0) {
      return "Price must be greater than 0.";
    }
    return "";
  };

  const handleDraftTypeImageSelect = ({ variant, files = [] }) => {
    const setImages =
      variant === "livestock" ? setLivestockDraftImages : setEggDraftImages;
    const setMessage =
      variant === "livestock" ? setLivestockMessage : setEggMessage;
    const setError =
      variant === "livestock" ? setLivestockError : setEggError;

    if (files.length === 0) return;
    const invalidFile = files.find(
      (file) => file.type && !file.type.startsWith("image/")
    );
    if (invalidFile) {
      setError("Please upload image files only.");
      return;
    }

    setError("");
    setMessage("");
    const remainingSlots = getDraftImageRemainingSlots(variant);
    if (remainingSlots === 0) {
      setError(`Maximum ${MAX_TYPE_IMAGES} images allowed per item.`);
      return;
    }
    const accepted = files.slice(0, remainingSlots);
    setImages((prev) => prev.concat(accepted));
    if (accepted.length < files.length) {
      setMessage(
        `Only ${MAX_TYPE_IMAGES} images are allowed. Extra files were skipped.`
      );
    }
  };

  const handleUploadDraftTypeImages = async ({ variant, files = [] }) => {
    if (files.length === 0) return;
    const normalizedVariant = variant === "livestock" ? "livestock" : "egg";
    const setMessage =
      normalizedVariant === "livestock" ? setLivestockMessage : setEggMessage;
    const setError =
      normalizedVariant === "livestock" ? setLivestockError : setEggError;
    const setImages =
      normalizedVariant === "livestock"
        ? setLivestockDraftLibraryImages
        : setEggDraftLibraryImages;
    const setUploading =
      normalizedVariant === "livestock"
        ? setLivestockDraftImageUploading
        : setEggDraftImageUploading;
    const existingImages = getLibraryDraftImages(normalizedVariant);

    const invalidFile = files.find(
      (file) => file.type && !file.type.startsWith("image/")
    );
    if (invalidFile) {
      setError("Please upload image files only.");
      return;
    }

    const remainingSlots = Math.max(0, MAX_TYPE_IMAGES - existingImages.length);
    if (remainingSlots === 0) {
      setError(`Maximum ${MAX_TYPE_IMAGES} images allowed per item.`);
      return;
    }

    const filesToUpload = files.slice(0, remainingSlots);
    const scopeKey = getAddTypeUploadScopeKey(normalizedVariant);
    clearUploadScopeCanceled(scopeKey);
    setUploading(true);
    setError("");
    setMessage("");

    let uploadedImages = [];
    try {
      const uploadResult = await uploadTypeImages({
        variant: normalizedVariant,
        typeId: `draft_${Date.now()}`,
        files: filesToUpload,
        existingImages,
        scopeKey,
      });
      uploadedImages = uploadResult.uploadedImages ?? [];
      if (scopeKey && isUploadScopeCanceled(scopeKey)) {
        throw createUploadCanceledError();
      }
      setImages(uploadResult.nextImages ?? existingImages);
      if (filesToUpload.length < files.length) {
        setMessage(
          `Uploaded ${filesToUpload.length} image(s). Extra files were skipped.`
        );
      } else {
        setMessage("Images uploaded.");
      }
    } catch (err) {
      const cleanupImages = Array.isArray(err?.uploadedImages)
        ? err.uploadedImages
        : uploadedImages;
      if (cleanupImages.length > 0) {
        await cleanupUploadedImages(cleanupImages);
      }
      console.error("draft image upload error", err);
      if (isUploadCanceledError(err)) {
        setMessage("Upload canceled.");
      } else {
        setError("Unable to upload images. Please try again.");
      }
    } finally {
      clearUploadScopeCanceled(scopeKey);
      setUploading(false);
    }
  };

  const handleRemoveDraftTypeImage = ({ variant, index }) => {
    const setImages =
      variant === "livestock" ? setLivestockDraftImages : setEggDraftImages;
    setImages((prev) => prev.filter((_file, fileIndex) => fileIndex !== index));
  };

  const clearDraftTypeImages = (variant) => {
    const normalizedVariant = variant === "livestock" ? "livestock" : "egg";
    const setDeviceImages =
      normalizedVariant === "livestock"
        ? setLivestockDraftImages
        : setEggDraftImages;
    const setLibraryImages =
      normalizedVariant === "livestock"
        ? setLivestockDraftLibraryImages
        : setEggDraftLibraryImages;
    const setMessage =
      normalizedVariant === "livestock" ? setLivestockMessage : setEggMessage;
    const setError =
      normalizedVariant === "livestock" ? setLivestockError : setEggError;
    const setUploading =
      normalizedVariant === "livestock"
        ? setLivestockDraftImageUploading
        : setEggDraftImageUploading;
    setDeviceImages([]);
    setLibraryImages([]);
    setUploading(false);
    setError("");
    setMessage("Selected images cleared.");
  };

  const handleRemoveDraftLibraryTypeImage = ({ variant, imageId }) => {
    const setImages =
      variant === "livestock"
        ? setLivestockDraftLibraryImages
        : setEggDraftLibraryImages;
    setImages((prev) => prev.filter((image) => image.id !== imageId));
  };

  const addDraftLibraryImages = ({ variant, images = [] }) => {
    if (images.length === 0) return;
    const setImages =
      variant === "livestock"
        ? setLivestockDraftLibraryImages
        : setEggDraftLibraryImages;
    const setMessage =
      variant === "livestock" ? setLivestockMessage : setEggMessage;
    const setError =
      variant === "livestock" ? setLivestockError : setEggError;
    const remainingSlots = getDraftImageRemainingSlots(variant);
    if (remainingSlots === 0) {
      setError(`Maximum ${MAX_TYPE_IMAGES} images allowed per item.`);
      return;
    }
    const accepted = images.slice(0, remainingSlots);
    setImages((prev) => prev.concat(accepted));
    if (accepted.length < images.length) {
      setMessage(
        `Only ${MAX_TYPE_IMAGES} images are allowed. Extra library images were skipped.`
      );
    }
  };

  const openLibraryPicker = ({ variant, target, typeId = "" }) => {
    setLibraryPickerVariant(variant === "livestock" ? "livestock" : "egg");
    setLibraryPickerTarget(target === "edit" ? "edit" : "add");
    setLibraryPickerTypeId(typeId || "");
    setLibraryPickerSearch("");
    setLibraryPickerSelection({});
    setIsLibraryPickerOpen(true);
  };

  const closeLibraryPicker = () => {
    if (libraryPickerApplying) return;
    setIsLibraryPickerOpen(false);
    setLibraryPickerSelection({});
    setLibraryPickerSearch("");
    setLibraryPickerTypeId("");
  };

  const toggleLibraryPickerAsset = (assetId) => {
    setLibraryPickerSelection((prev) => ({
      ...prev,
      [assetId]: !prev[assetId],
    }));
  };

  const handleAttachLibraryImagesToType = async ({
    variant,
    typeId,
    assets = [],
  }) => {
    if (!typeId || assets.length === 0) return;
    const setMessage =
      variant === "livestock" ? setLivestockMessage : setEggMessage;
    const setError =
      variant === "livestock" ? setLivestockError : setEggError;
    const collectionName = getTypeCollectionName(variant);
    const sourceItems = variant === "livestock" ? livestockTypes : eggTypes;
    const existing = sourceItems.find((item) => item.id === typeId);
    const currentImages = normalizeImagesForWrite(existing?.images ?? []);
    const remainingSlots = Math.max(0, MAX_TYPE_IMAGES - currentImages.length);
    if (remainingSlots === 0) {
      setError(`Maximum ${MAX_TYPE_IMAGES} images allowed per item.`);
      return;
    }
    const accepted = assets.slice(0, remainingSlots).map((asset, index) =>
      buildTypeImageFromLibraryAsset(asset, currentImages.length + index)
    );
    const nextImages = normalizeImagesForWrite(currentImages.concat(accepted));

    setError("");
    setMessage("");
    try {
      await updateDoc(doc(db, collectionName, typeId), {
        images: nextImages,
        ...buildPrimaryImageFields(nextImages),
        imageUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (accepted.length < assets.length) {
        setMessage(
          `Attached ${accepted.length} library image(s). Extra images were skipped.`
        );
      } else {
        setMessage("Library images attached.");
      }
    } catch (err) {
      console.error("attach library images error", err);
      setError("Unable to attach library images.");
    }
  };

  const handleApplyLibraryPickerSelection = async () => {
    const selectedAssets = typeImageLibraryAssets.filter(
      (asset) => libraryPickerSelection[asset.id]
    );
    if (selectedAssets.length === 0) {
      closeLibraryPicker();
      return;
    }
    setLibraryPickerApplying(true);
    try {
      if (libraryPickerTarget === "edit") {
        await handleAttachLibraryImagesToType({
          variant: libraryPickerVariant,
          typeId: libraryPickerTypeId,
          assets: selectedAssets,
        });
      } else {
        const mapped = selectedAssets.map((asset, index) =>
          buildTypeImageFromLibraryAsset(asset, index)
        );
        addDraftLibraryImages({
          variant: libraryPickerVariant,
          images: mapped,
        });
      }
      setIsLibraryPickerOpen(false);
      setLibraryPickerSelection({});
      setLibraryPickerSearch("");
      setLibraryPickerTypeId("");
    } finally {
      setLibraryPickerApplying(false);
    }
  };

  const handleTypeImageUpload = async ({
    variant,
    typeId,
    files = [],
    currentImages = [],
  }) => {
    if (!files.length) return;
    const setUploads =
      variant === "livestock" ? setLivestockImageUploads : setEggImageUploads;
    const setMessage =
      variant === "livestock" ? setLivestockMessage : setEggMessage;
    const setError =
      variant === "livestock" ? setLivestockError : setEggError;
    const collectionName = getTypeCollectionName(variant);

    const invalidFile = files.find(
      (file) => file.type && !file.type.startsWith("image/")
    );
    if (invalidFile) {
      setError("Please upload image files only.");
      return;
    }

    const remainingSlots = Math.max(0, MAX_TYPE_IMAGES - currentImages.length);
    if (remainingSlots === 0) {
      setError(`Maximum ${MAX_TYPE_IMAGES} images allowed per item.`);
      return;
    }

    const filesToUpload = files.slice(0, remainingSlots);
    const scopeKey = getEditTypeUploadScopeKey(variant, typeId);
    clearUploadScopeCanceled(scopeKey);
    let uploadedImages = [];
    setError("");
    setMessage("");
    setUploads((prev) => ({ ...prev, [typeId]: true }));
    try {
      const uploadResult = await uploadTypeImages({
        variant,
        typeId,
        files: filesToUpload,
        existingImages: currentImages,
        scopeKey,
      });
      const nextImages = uploadResult.nextImages;
      uploadedImages = uploadResult.uploadedImages ?? [];
      if (scopeKey && isUploadScopeCanceled(scopeKey)) {
        throw createUploadCanceledError();
      }
      await updateDoc(doc(db, collectionName, typeId), {
        images: nextImages,
        ...buildPrimaryImageFields(nextImages),
        imageUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (filesToUpload.length < files.length) {
        setMessage(
          `Uploaded ${filesToUpload.length} image(s). Extra files were skipped.`
        );
      } else {
        setMessage("Images uploaded.");
      }
    } catch (err) {
      const cleanupImages = Array.isArray(err?.uploadedImages)
        ? err.uploadedImages
        : uploadedImages;
      if (cleanupImages.length > 0) {
        await cleanupUploadedImages(cleanupImages);
      }
      console.error("type image upload error", err);
      if (isUploadCanceledError(err)) {
        setMessage("Upload canceled.");
      } else {
        setError("Unable to upload images. Please try again.");
      }
    } finally {
      clearUploadScopeCanceled(scopeKey);
      setUploads((prev) => ({ ...prev, [typeId]: false }));
    }
  };

  const isImagePathReferencedElsewhere = ({
    path,
    variant,
    typeId,
    imageId,
  }) => {
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath) return false;
    const collections = [
      { variant: "egg", items: eggTypes },
      { variant: "livestock", items: livestockTypes },
    ];
    return collections.some((group) =>
      group.items.some((item) => {
        if (!item || !Array.isArray(item.images)) return false;
        return item.images.some((image) => {
          if (String(image?.path || "").trim() !== normalizedPath) return false;
          const sameRecord =
            group.variant === variant &&
            item.id === typeId &&
            String(image?.id || "") === String(imageId || "");
          return !sameRecord;
        });
      })
    );
  };

  const handleRemoveTypeImage = async ({
    variant,
    typeId,
    imageId,
    currentImages = [],
  }) => {
    const setMessage =
      variant === "livestock" ? setLivestockMessage : setEggMessage;
    const setError =
      variant === "livestock" ? setLivestockError : setEggError;
    const collectionName = getTypeCollectionName(variant);
    const image = currentImages.find((entry) => entry.id === imageId);
    if (!image) return;

    setError("");
    setMessage("");
    try {
      const canDeleteStorageObject =
        Boolean(image.path) &&
        !String(image.assetId || "").trim() &&
        !isImagePathReferencedElsewhere({
          path: image.path,
          variant,
          typeId,
          imageId,
        });
      if (canDeleteStorageObject) {
        try {
          await deleteObject(storageRef(storage, image.path));
        } catch (storageErr) {
          console.warn("image delete warning", storageErr);
        }
      }
      const nextImages = normalizeImagesForWrite(
        currentImages.filter((entry) => entry.id !== imageId)
      );
      await updateDoc(doc(db, collectionName, typeId), {
        images: nextImages,
        ...buildPrimaryImageFields(nextImages),
        imageUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setMessage("Image removed.");
    } catch (err) {
      console.error("remove image error", err);
      setError("Unable to remove image.");
    }
  };

  const handleClearAllTypeImages = async ({
    variant,
    typeId,
    currentImages = [],
  }) => {
    const setMessage =
      variant === "livestock" ? setLivestockMessage : setEggMessage;
    const setError =
      variant === "livestock" ? setLivestockError : setEggError;
    const collectionName = getTypeCollectionName(variant);
    const hasImages = Array.isArray(currentImages) && currentImages.length > 0;
    if (!hasImages) return;
    const confirmed = window.confirm(
      "Remove all images from this product?"
    );
    if (!confirmed) return;

    setError("");
    setMessage("");
    try {
      const normalized = normalizeImagesForWrite(currentImages);
      const removableLegacyPaths = normalized
        .filter(
          (image) =>
            Boolean(image.path) &&
            !String(image.assetId || "").trim() &&
            !isImagePathReferencedElsewhere({
              path: image.path,
              variant,
              typeId,
              imageId: image.id,
            })
        )
        .map((image) => image.path);

      if (removableLegacyPaths.length > 0) {
        await Promise.allSettled(
          removableLegacyPaths.map((path) =>
            deleteObject(storageRef(storage, path))
          )
        );
      }

      const nextImages = [];
      await updateDoc(doc(db, collectionName, typeId), {
        images: nextImages,
        ...buildPrimaryImageFields(nextImages),
        imageUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setMessage("All images removed.");
    } catch (err) {
      console.error("clear all type images error", err);
      setError("Unable to remove all images.");
    }
  };

  const handleMoveTypeImage = async ({
    variant,
    typeId,
    imageId,
    direction,
    currentImages = [],
  }) => {
    const setMessage =
      variant === "livestock" ? setLivestockMessage : setEggMessage;
    const setError =
      variant === "livestock" ? setLivestockError : setEggError;
    const collectionName = getTypeCollectionName(variant);
    const normalized = normalizeImagesForWrite(currentImages);
    const fromIndex = normalized.findIndex((entry) => entry.id === imageId);
    if (fromIndex < 0) return;
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= normalized.length) return;
    const nextImages = normalized.slice();
    const [moved] = nextImages.splice(fromIndex, 1);
    nextImages.splice(toIndex, 0, moved);
    const resequenced = normalizeImagesForWrite(nextImages);

    setError("");
    setMessage("");
    try {
      await updateDoc(doc(db, collectionName, typeId), {
        images: resequenced,
        ...buildPrimaryImageFields(resequenced),
        imageUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setMessage("Image order updated.");
    } catch (err) {
      console.error("move image error", err);
      setError("Unable to reorder images.");
    }
  };

  const handleAddEggType = async () => {
    if (isAddingEggType || eggDraftImageUploading) return;
    setEggError("");
    setEggMessage("");
    const validationError = validateTypeDraft(eggDraft);
    if (validationError) {
      setEggError(validationError);
      return;
    }
    const scopeKey = getAddTypeUploadScopeKey("egg");
    clearUploadScopeCanceled(scopeKey);
    setIsAddingEggType(true);
    let uploadedImages = [];
    let finalImages = normalizeImagesForWrite(eggDraftLibraryImages);
    try {
      const category = eggCategories.find(
        (cat) => cat.id === eggDraft.categoryId
      );
      const typeDocRef = doc(collection(db, "eggTypes"));
      if (eggDraftImages.length > 0) {
        const uploadResult = await uploadTypeImages({
          variant: "egg",
          typeId: typeDocRef.id,
          files: eggDraftImages,
          existingImages: finalImages,
          scopeKey,
        });
        uploadedImages = uploadResult.uploadedImages ?? [];
        finalImages = uploadResult.nextImages ?? finalImages;
      }
      if (isUploadScopeCanceled(scopeKey)) {
        throw createUploadCanceledError();
      }
      await setDoc(
        typeDocRef,
        buildTypePayload({
          variant: "egg",
          draft: eggDraft,
          categoryName: category?.name ?? "",
          orderValue: eggTypes.length + 1,
          images: finalImages,
          available: eggDraft.available,
        })
      );
      setEggDraft(createEggTypeDraft());
      setEggDraftImages([]);
      setEggDraftLibraryImages([]);
      setEggMessage("Egg type added.");
      setIsAddEggTypeDialogOpen(false);
    } catch (err) {
      const cleanupImages = Array.isArray(err?.uploadedImages)
        ? err.uploadedImages
        : uploadedImages;
      if (cleanupImages.length > 0) {
        await cleanupUploadedImages(cleanupImages);
      }
      console.error("add egg type error", err);
      if (isUploadCanceledError(err)) {
        setEggMessage("Upload canceled.");
      } else {
        setEggError("Unable to add egg type. Please try again.");
      }
    } finally {
      clearUploadScopeCanceled(scopeKey);
      setIsAddingEggType(false);
    }
  };

  const handleToggleEggAvailability = async (item) => {
    setEggError("");
    setEggMessage("");
    const nextAvailable = item.available === false;
    try {
      await updateDoc(doc(db, "eggTypes", item.id), {
        available: nextAvailable,
        updatedAt: serverTimestamp(),
      });
      setEggMessage(
        nextAvailable
          ? "Egg type marked available."
          : "Egg type marked unavailable."
      );
    } catch (err) {
      console.error("toggle egg availability error", err);
      setEggError("Unable to update availability.");
    }
  };

  const handleSaveEggType = async (id) => {
    setEggError("");
    setEggMessage("");
    const update = eggEdits[id];
    if (!update) return;
    const validationError = validateTypeDraft(update);
    if (validationError) {
      setEggError(validationError);
      return;
    }
    try {
      const existing = eggTypes.find((item) => item.id === id);
      await updateDoc(
        doc(db, "eggTypes", id),
        buildTypePayload({
          variant: "egg",
          draft: update,
          categoryName:
            eggCategories.find((cat) => cat.id === update.categoryId)?.name ??
            "",
          orderValue: existing?.order ?? Date.now(),
          images: existing?.images ?? [],
          available: update.available ?? existing?.available ?? true,
        })
      );
      setEggMessage("Egg type saved.");
      setEditingEggTypeId(null);
      setEggEdits((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error("save egg type error", err);
      setEggError("Unable to save egg type.");
    }
  };

  const handleDeleteEggType = async (id) => {
    if (!window.confirm("Delete this egg type?")) return;
    try {
      await deleteDoc(doc(db, "eggTypes", id));
      if (editingEggTypeId === id) {
        setEditingEggTypeId(null);
      }
      setEggEdits((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error("delete egg type error", err);
    }
  };

  const buildEggTypeEditDraft = (item) => ({
    title: item.title ?? item.label ?? "",
    shortDescription: item.shortDescription ?? "",
    longDescription: item.longDescription ?? "",
    layingAge: item.layingAge ?? "",
    sexingAge: item.sexingAge ?? "",
    eggsPerYear: item.eggsPerYear ?? "",
    colourTypes: item.colourTypes ?? "",
    lifeSpan: item.lifeSpan ?? "",
    eggColour: item.eggColour ?? "",
    eggSize: item.eggSize ?? "",
    priceType: item.priceType ?? "normal",
    price: item.price ?? 0,
    categoryId: item.categoryId ?? "",
    available: item.available !== false,
    images: item.images ?? [],
  });

  const closeAddEggCategoryDialog = () => {
    setIsAddEggCategoryDialogOpen(false);
    setEggCategoryError("");
    setEggCategoryDraft({ name: "", description: "", order: "" });
  };

  const openManageEggCategoriesDialog = () => {
    setIsManageEggCategoriesDialogOpen(true);
  };

  const closeManageEggCategoriesDialog = () => {
    setIsManageEggCategoriesDialogOpen(false);
  };

  const closeAddEggTypeDialog = () => {
    const scopeKey = getAddTypeUploadScopeKey("egg");
    const uploadActive =
      isAddingEggType || hasActiveUploadTasks(scopeKey) || isUploadScopeCanceled(scopeKey);
    if (uploadActive) {
      const shouldClose = window.confirm(ACTIVE_UPLOAD_CLOSE_CONFIRM_MESSAGE);
      if (!shouldClose) return false;
      markUploadScopeCanceled(scopeKey);
    }
    setIsAddEggTypeDialogOpen(false);
    setEggError("");
    setEggDraft(createEggTypeDraft());
    setEggDraftImages([]);
    setEggDraftLibraryImages([]);
    setEggDraftImageUploading(false);
    return true;
  };

  const openEggTypeEditDialog = (item) => {
    setEggError("");
    setEggEdits((prev) => ({
      ...prev,
      [item.id]: prev[item.id] ?? buildEggTypeEditDraft(item),
    }));
    setEditingEggTypeId(item.id);
  };

  const closeEggTypeEditDialog = () => {
    const scopeKey = editingEggTypeId
      ? getEditTypeUploadScopeKey("egg", editingEggTypeId)
      : "";
    const uploadActive =
      Boolean(editingEggTypeId && eggImageUploads[editingEggTypeId]) ||
      hasActiveUploadTasks(scopeKey) ||
      isUploadScopeCanceled(scopeKey);
    if (uploadActive) {
      const shouldClose = window.confirm(ACTIVE_UPLOAD_CLOSE_CONFIRM_MESSAGE);
      if (!shouldClose) return false;
      markUploadScopeCanceled(scopeKey);
    }
    setEggError("");
    if (editingEggTypeId) {
      setEggEdits((prev) => {
        if (!prev[editingEggTypeId]) return prev;
        const next = { ...prev };
        delete next[editingEggTypeId];
        return next;
      });
    }
    setEditingEggTypeId(null);
    return true;
  };

  const resetEggTypeFilters = () => {
    setEggTypeSearch("");
    setEggTypeCategoryFilter("all");
    setEggTypeAvailabilityFilter("all");
    setEggTypePriceTypeFilter("all");
    setEggTypeHasImageFilter("all");
    setEggTypeMinPrice("");
    setEggTypeMaxPrice("");
    setEggTypeSortKey("order");
    setEggTypeSortDirection("asc");
  };

  const handleAddDeliveryOption = async (
    collectionName,
    draft,
    reset,
    setMessage,
    setError
  ) => {
    setError("");
    setMessage("");
    if (!draft.label.trim() || draft.cost === "") {
      setError("Label and cost are required.");
      return;
    }
    try {
      await addDoc(collection(db, collectionName), {
        label: draft.label.trim(),
        cost: Number(draft.cost),
        order: Date.now(),
      });
      reset({ label: "", cost: "" });
      setMessage("Delivery option added.");
    } catch (err) {
      console.error("add delivery option error", err);
      setError("Unable to add delivery option.");
    }
  };

  const handleSaveDeliveryOption = async (
    collectionName,
    id,
    edits,
    setMessage,
    setError
  ) => {
    setError("");
    setMessage("");
    const update = edits[id];
    if (!update) return;
    try {
      await updateDoc(doc(db, collectionName, id), {
        label: update.label,
        cost: Number(update.cost),
      });
      setMessage("Delivery option saved.");
    } catch (err) {
      console.error("save delivery option error", err);
      setError("Unable to save delivery option.");
    }
  };

  const handleDeleteDeliveryOption = async (collectionName, id) => {
    if (!window.confirm("Delete this delivery option?")) return;
    try {
      await deleteDoc(doc(db, collectionName, id));
    } catch (err) {
      console.error("delete delivery option error", err);
    }
  };

  const handleAddCategory = async () => {
    setCategoryError("");
    setCategoryMessage("");
    if (!categoryDraft.name.trim()) {
      setCategoryError("Category name is required.");
      return;
    }
    const orderValue = Number(categoryDraft.order);
    if (!Number.isFinite(orderValue) || orderValue < 1) {
      setCategoryError("Order number is required.");
      return;
    }
    try {
      await addDoc(collection(db, "livestockCategories"), {
        name: categoryDraft.name.trim(),
        description: categoryDraft.description.trim(),
        order: orderValue,
      });
      setCategoryDraft({ name: "", description: "", order: "" });
      setCategoryMessage("Category added.");
      setIsAddLivestockCategoryDialogOpen(false);
    } catch (err) {
      console.error("add category error", err);
      setCategoryError("Unable to add category.");
    }
  };

  const handleSaveCategory = async (category) => {
    try {
      const updates = {
        name: category.name,
        description: category.description ?? "",
      };
      const orderValue = Number(category.order);
      if (Number.isFinite(orderValue) && orderValue > 0) {
        updates.order = orderValue;
      }
      await updateDoc(doc(db, "livestockCategories", category.id), updates);
      setCategoryMessage("Category updated.");
    } catch (err) {
      console.error("save category error", err);
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!window.confirm(`Delete category ${category.name}?`)) return;
    try {
      await deleteDoc(doc(db, "livestockCategories", category.id));
    } catch (err) {
      console.error("delete category error", err);
    }
  };

  const handleAddLivestockType = async () => {
    if (isAddingLivestockType || livestockDraftImageUploading) return;
    setLivestockError("");
    setLivestockMessage("");
    const validationError = validateTypeDraft(livestockDraft);
    if (validationError) {
      setLivestockError(validationError);
      return;
    }
    const scopeKey = getAddTypeUploadScopeKey("livestock");
    clearUploadScopeCanceled(scopeKey);
    setIsAddingLivestockType(true);
    let uploadedImages = [];
    let finalImages = normalizeImagesForWrite(livestockDraftLibraryImages);
    try {
      const category = livestockCategories.find(
        (cat) => cat.id === livestockDraft.categoryId
      );
      const typeDocRef = doc(collection(db, "livestockTypes"));
      if (livestockDraftImages.length > 0) {
        const uploadResult = await uploadTypeImages({
          variant: "livestock",
          typeId: typeDocRef.id,
          files: livestockDraftImages,
          existingImages: finalImages,
          scopeKey,
        });
        uploadedImages = uploadResult.uploadedImages ?? [];
        finalImages = uploadResult.nextImages ?? finalImages;
      }
      if (isUploadScopeCanceled(scopeKey)) {
        throw createUploadCanceledError();
      }
      await setDoc(
        typeDocRef,
        buildTypePayload({
          variant: "livestock",
          draft: livestockDraft,
          categoryName: category?.name ?? "",
          orderValue: livestockTypes.length + 1,
          images: finalImages,
          available: livestockDraft.available,
        })
      );
      setLivestockDraft(createTypeDraft());
      setLivestockDraftImages([]);
      setLivestockDraftLibraryImages([]);
      setLivestockMessage("Livestock item added.");
      setIsAddLivestockTypeDialogOpen(false);
    } catch (err) {
      const cleanupImages = Array.isArray(err?.uploadedImages)
        ? err.uploadedImages
        : uploadedImages;
      if (cleanupImages.length > 0) {
        await cleanupUploadedImages(cleanupImages);
      }
      console.error("add livestock item error", err);
      if (isUploadCanceledError(err)) {
        setLivestockMessage("Upload canceled.");
      } else {
        setLivestockError("Unable to add livestock item. Please try again.");
      }
    } finally {
      clearUploadScopeCanceled(scopeKey);
      setIsAddingLivestockType(false);
    }
  };

  const handleToggleLivestockAvailability = async (item) => {
    setLivestockError("");
    setLivestockMessage("");
    const nextAvailable = item.available === false;
    try {
      await updateDoc(doc(db, "livestockTypes", item.id), {
        available: nextAvailable,
        updatedAt: serverTimestamp(),
      });
      setLivestockMessage(
        nextAvailable
          ? "Livestock item marked available."
          : "Livestock item marked unavailable."
      );
    } catch (err) {
      console.error("toggle livestock availability error", err);
      setLivestockError("Unable to update availability.");
    }
  };

  const handleSaveLivestockType = async (id) => {
    setLivestockError("");
    setLivestockMessage("");
    const update = livestockEdits[id];
    if (!update) return;
    const validationError = validateTypeDraft(update);
    if (validationError) {
      setLivestockError(validationError);
      return;
    }
    try {
      const existing = livestockTypes.find((item) => item.id === id);
      await updateDoc(
        doc(db, "livestockTypes", id),
        buildTypePayload({
          variant: "livestock",
          draft: update,
          categoryName:
            livestockCategories.find((cat) => cat.id === update.categoryId)
              ?.name ?? "",
          orderValue: existing?.order ?? Date.now(),
          images: existing?.images ?? [],
          available: update.available ?? existing?.available ?? true,
        })
      );
      setLivestockMessage("Livestock item saved.");
      setEditingLivestockTypeId(null);
      setLivestockEdits((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error("save livestock item error", err);
      setLivestockError("Unable to save livestock item.");
    }
  };

  const handleDeleteLivestockType = async (id) => {
    if (!window.confirm("Delete this livestock item?")) return;
    try {
      await deleteDoc(doc(db, "livestockTypes", id));
      if (editingLivestockTypeId === id) {
        setEditingLivestockTypeId(null);
      }
      setLivestockEdits((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error("delete livestock item error", err);
      setLivestockError("Unable to delete livestock item.");
    }
  };

  const buildLivestockTypeEditDraft = (item) => ({
    title: item.title ?? item.label ?? "",
    shortDescription: item.shortDescription ?? "",
    longDescription: item.longDescription ?? "",
    priceType: item.priceType ?? "normal",
    price: item.price ?? 0,
    categoryId: item.categoryId ?? "",
    available: item.available !== false,
    images: item.images ?? [],
  });

  const closeAddLivestockCategoryDialog = () => {
    setIsAddLivestockCategoryDialogOpen(false);
    setCategoryError("");
    setCategoryDraft({ name: "", description: "", order: "" });
  };

  const openManageLivestockCategoriesDialog = () => {
    setIsManageLivestockCategoriesDialogOpen(true);
  };

  const closeManageLivestockCategoriesDialog = () => {
    setIsManageLivestockCategoriesDialogOpen(false);
  };

  const closeAddLivestockTypeDialog = () => {
    const scopeKey = getAddTypeUploadScopeKey("livestock");
    const uploadActive =
      isAddingLivestockType ||
      hasActiveUploadTasks(scopeKey) ||
      isUploadScopeCanceled(scopeKey);
    if (uploadActive) {
      const shouldClose = window.confirm(ACTIVE_UPLOAD_CLOSE_CONFIRM_MESSAGE);
      if (!shouldClose) return false;
      markUploadScopeCanceled(scopeKey);
    }
    setIsAddLivestockTypeDialogOpen(false);
    setLivestockError("");
    setLivestockDraft(createTypeDraft());
    setLivestockDraftImages([]);
    setLivestockDraftLibraryImages([]);
    setLivestockDraftImageUploading(false);
    return true;
  };

  const openLivestockTypeEditDialog = (item) => {
    setLivestockError("");
    setLivestockEdits((prev) => ({
      ...prev,
      [item.id]: prev[item.id] ?? buildLivestockTypeEditDraft(item),
    }));
    setEditingLivestockTypeId(item.id);
  };

  const closeLivestockTypeEditDialog = () => {
    const scopeKey = editingLivestockTypeId
      ? getEditTypeUploadScopeKey("livestock", editingLivestockTypeId)
      : "";
    const uploadActive =
      Boolean(editingLivestockTypeId && livestockImageUploads[editingLivestockTypeId]) ||
      hasActiveUploadTasks(scopeKey) ||
      isUploadScopeCanceled(scopeKey);
    if (uploadActive) {
      const shouldClose = window.confirm(ACTIVE_UPLOAD_CLOSE_CONFIRM_MESSAGE);
      if (!shouldClose) return false;
      markUploadScopeCanceled(scopeKey);
    }
    setLivestockError("");
    if (editingLivestockTypeId) {
      setLivestockEdits((prev) => {
        if (!prev[editingLivestockTypeId]) return prev;
        const next = { ...prev };
        delete next[editingLivestockTypeId];
        return next;
      });
    }
    setEditingLivestockTypeId(null);
    return true;
  };

  const resetLivestockTypeFilters = () => {
    setLivestockTypeSearch("");
    setLivestockTypeCategoryFilter("all");
    setLivestockTypeAvailabilityFilter("all");
    setLivestockTypePriceTypeFilter("all");
    setLivestockTypeHasImageFilter("all");
    setLivestockTypeMinPrice("");
    setLivestockTypeMaxPrice("");
    setLivestockTypeSortKey("order");
    setLivestockTypeSortDirection("asc");
  };

  const openStockUpdateEditDialog = (item) => {
    const currentQuantity = Number(item.currentQuantity ?? item.quantity ?? 0);
    const existingDraft = stockUpdateDrafts[item.id] ?? {};
    setStockUpdateDialogError("");
    setStockUpdateDialogDraft({
      quantity:
        existingDraft.quantity === undefined || existingDraft.quantity === null
          ? String(currentQuantity)
          : String(existingDraft.quantity),
      notes: String(
        existingDraft.notes ?? item.pendingNotes ?? item.notes ?? ""
      ),
    });
    setEditingStockUpdateItemId(item.id);
  };

  const closeStockUpdateEditDialog = () => {
    setEditingStockUpdateItemId(null);
    setStockUpdateDialogDraft({ quantity: "", notes: "" });
    setStockUpdateDialogError("");
  };

  const saveStockUpdateDialogDraft = () => {
    if (!editingStockUpdateItem) return;
    const quantityRaw = stockUpdateDialogDraft.quantity;
    if (quantityRaw === "" || quantityRaw === null || quantityRaw === undefined) {
      setStockUpdateDialogError("Quantity is required.");
      return;
    }
    const parsedQuantity = Number(quantityRaw);
    if (!Number.isFinite(parsedQuantity)) {
      setStockUpdateDialogError("Quantity must be a valid number.");
      return;
    }

    setStockUpdateDrafts((prev) => ({
      ...prev,
      [editingStockUpdateItem.id]: {
        ...(prev[editingStockUpdateItem.id] ?? {}),
        quantity: parsedQuantity,
        notes: String(stockUpdateDialogDraft.notes ?? ""),
      },
    }));
    closeStockUpdateEditDialog();
  };

  const clearStockUpdatePending = (itemId) => {
    setStockUpdateDrafts((prev) => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    if (editingStockUpdateItemId === itemId) {
      closeStockUpdateEditDialog();
    }
  };

  const resetStockUpdateFilters = () => {
    setStockUpdateSearch("");
    setStockUpdateCategoryFilter("all");
    setStockUpdateSort("name_asc");
  };

  const startVoiceNoteRecording = async () => {
    setVoiceNoteError("");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceNoteError("Recording is not supported in this browser.");
      return;
    }
    try {
      if (voiceNote?.previewUrl) {
        URL.revokeObjectURL(voiceNote.previewUrl);
      }
      setVoiceNote(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordingChunksRef.current = [];
      recordingStartRef.current = Date.now();
      setVoiceNoteDuration(0);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      recordingTimerRef.current = setInterval(() => {
        const startedAt = recordingStartRef.current ?? Date.now();
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        setVoiceNoteDuration(seconds);
      }, 1000);

      const mimeType = getVoiceNoteMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
        }
        const recordedAt = recordingStartRef.current ?? Date.now();
        const durationSeconds = Math.max(
          1,
          Math.floor((Date.now() - recordedAt) / 1000)
        );
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        if (blob.size > 0) {
          const previewUrl = URL.createObjectURL(blob);
          setVoiceNote({
            blob,
            previewUrl,
            mimeType: blob.type,
            size: blob.size,
            duration: durationSeconds,
          });
        } else {
          setVoiceNoteError("Recording was empty. Please try again.");
        }
        setIsRecordingVoiceNote(false);
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
      };
      recorder.start();
      setIsRecordingVoiceNote(true);
    } catch (err) {
      console.error("voice note record error", err);
      setVoiceNoteError("Unable to start recording.");
      setIsRecordingVoiceNote(false);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    }
  };

  const stopVoiceNoteRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const clearVoiceNote = () => {
    if (voiceNote?.previewUrl) {
      URL.revokeObjectURL(voiceNote.previewUrl);
    }
    setVoiceNote(null);
    setVoiceNoteDuration(0);
    setVoiceNoteError("");
  };

  const handleSubmitStockUpdates = async () => {
    if (stockUpdateSubmitting) return;
    const updates = stockItems.reduce((acc, item) => {
      const draft = stockUpdateDrafts[item.id];
      if (!draft) return acc;
      const currentQuantity = Number(item.quantity ?? 0);
      const nextQuantity = resolveStockUpdateQuantity(draft, currentQuantity);
      const currentNotes = item.notes ?? "";
      const nextNotes = draft.notes ?? currentNotes;
      if (nextQuantity === currentQuantity && nextNotes === currentNotes)
        return acc;
      acc.push({ item, quantity: nextQuantity, notes: nextNotes });
      return acc;
    }, []);

    if (updates.length === 0) return;

    setStockUpdateSubmitting(true);
    try {
      const batchMeta = {
        batchId: createBatchId(),
        batchCreatedAt: new Date(),
      };
      let voiceNoteMeta = { ...batchMeta };
      if (voiceNote?.blob) {
        const extension = voiceNote.mimeType?.includes("ogg")
          ? "ogg"
          : voiceNote.mimeType?.includes("mp4")
          ? "mp4"
          : "webm";
        const fileName = `voice_note_${Date.now()}.${extension}`;
        const fileRef = storageRef(
          storage,
          `stock_updates/${user.uid ?? "unknown"}/${fileName}`
        );
        await uploadBytes(fileRef, voiceNote.blob, {
          contentType:
            voiceNote.mimeType ?? voiceNote.blob.type ?? "audio/webm",
        });
        const url = await getDownloadURL(fileRef);
        voiceNoteMeta = {
          ...batchMeta,
          voiceNoteUrl: url,
          voiceNoteName: fileName,
          voiceNoteType: voiceNote.mimeType ?? voiceNote.blob.type ?? "",
          voiceNoteSize: voiceNote.blob.size,
          voiceNoteDuration: voiceNote.duration ?? null,
          voiceNotePath: fileRef.fullPath,
        };
      }

      await Promise.all(
        updates.map(({ item, quantity, notes }) =>
          handleUpdateStockItem(
            item,
            { quantity, notes },
            "stockUpdateLogs",
            voiceNoteMeta
          )
        )
      );
      setStockUpdateDrafts({});
      setVoiceNote(null);
      setVoiceNoteDuration(0);
    } finally {
      setStockUpdateSubmitting(false);
    }
  };

  const handleUpdateStockItem = async (
    item,
    updates,
    logType = "stockLogs",
    logMeta = {},
    shouldThrow = false
  ) => {
    const fromQty = Number(item.quantity ?? 0);
    const toQty = Number(updates.quantity ?? fromQty);
    const change = toQty - fromQty;

    try {
      await updateDoc(doc(db, "stockItems", item.id), {
        ...updates,
        updatedAt: serverTimestamp(),
        updatedBy: user.email ?? "",
      });

      await addDoc(collection(db, logType), {
        itemId: item.id,
        name: updates.name ?? item.name ?? "",
        summary: updates.name ?? item.name ?? "",
        change,
        fromQty,
        toQty,
        notes: updates.notes ?? "",
        userEmail: user.email ?? "",
        createdAt: serverTimestamp(),
        ...logMeta,
      });
    } catch (err) {
      console.error("stock update error", err);
      if (shouldThrow) {
        throw err;
      }
    }
  };

  const handleAddStockCategory = async () => {
    setStockCategoryError("");
    setStockCategoryMessage("");
    if (!stockCategoryDraft.name.trim()) {
      setStockCategoryError("Category name is required.");
      return;
    }
    try {
      await addDoc(collection(db, "stockCategories"), {
        name: stockCategoryDraft.name.trim(),
      });
      setStockCategoryDraft({ name: "" });
      setStockCategoryMessage("Category added.");
      setIsAddStockCategoryDialogOpen(false);
    } catch (err) {
      console.error("add stock category error", err);
      setStockCategoryError("Unable to add category.");
    }
  };

  const handleSaveStockCategory = async (category) => {
    setStockCategoryError("");
    setStockCategoryMessage("");
    if (!String(category.name ?? "").trim()) {
      setStockCategoryError("Category name is required.");
      return;
    }
    try {
      await updateDoc(doc(db, "stockCategories", category.id), {
        name: String(category.name).trim(),
      });
      setStockCategoryMessage("Category saved.");
    } catch (err) {
      console.error("save stock category error", err);
      setStockCategoryError("Unable to save category.");
    }
  };

  const handleDeleteStockCategory = async (category) => {
    if (
      !window.confirm(
        `Delete category ${category.name}? This also removes items.`
      )
    )
      return;
    try {
      const callable = httpsCallable(functions, "deleteCategoryWithItems");
      await callable({ categoryId: category.id });
    } catch (err) {
      console.warn("deleteCategoryWithItems failed, falling back", err);
      const itemsToDelete = stockItems.filter(
        (item) => item.categoryId === category.id
      );
      await Promise.all(
        itemsToDelete.map((item) => deleteDoc(doc(db, "stockItems", item.id)))
      );
      await deleteDoc(doc(db, "stockCategories", category.id));
    }
  };

  const handleAddStockItem = async () => {
    setStockItemError("");
    setStockItemMessage("");
    if (!stockItemDraft.name.trim()) {
      setStockItemError("Item name is required.");
      return;
    }
    try {
      const category = stockCategories.find(
        (cat) => cat.id === stockItemDraft.categoryId
      );
      await addDoc(collection(db, "stockItems"), {
        name: stockItemDraft.name.trim(),
        categoryId: stockItemDraft.categoryId || "",
        category: category?.name ?? "",
        subCategory: stockItemDraft.subCategory.trim(),
        quantity: Number(stockItemDraft.quantity || 0),
        threshold: Number(stockItemDraft.threshold || 0),
        notes: stockItemDraft.notes.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: user.email ?? "",
      });
      setStockItemDraft({
        name: "",
        categoryId: "",
        subCategory: "",
        quantity: "",
        threshold: "5",
        notes: "",
      });
      setStockItemMessage("Stock item added.");
      setIsAddStockItemDialogOpen(false);
    } catch (err) {
      console.error("add stock item error", err);
      setStockItemError("Unable to add stock item.");
    }
  };

  const handleSaveStockItem = async (id) => {
    setStockItemError("");
    setStockItemMessage("");
    const update = stockEdits[id];
    if (!update) return;
    if (!String(update.name ?? "").trim()) {
      setStockItemError("Item name is required.");
      return;
    }
    const existing = stockItems.find((item) => item.id === id);
    if (!existing) return;
    try {
      const category = stockCategories.find((cat) => cat.id === update.categoryId);
      await handleUpdateStockItem(
        existing,
        {
          name: String(update.name ?? "").trim(),
          categoryId: update.categoryId || "",
          category: category?.name ?? "",
          subCategory: String(update.subCategory ?? "").trim(),
          quantity: Number(update.quantity || 0),
          threshold: Number(update.threshold || 0),
          notes: String(update.notes ?? "").trim(),
        },
        "stockLogs",
        {},
        true
      );
      setStockItemMessage("Stock item saved.");
      setEditingStockItemId(null);
      setStockEdits((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setStockItemError("Unable to save stock item.");
    }
  };

  const handleDeleteStockItem = async (id) => {
    const existing = stockItems.find((item) => item.id === id);
    if (!existing) return;
    if (!window.confirm(`Delete stock item ${existing.name}?`)) return;
    setStockItemError("");
    setStockItemMessage("");
    try {
      await deleteDoc(doc(db, "stockItems", id));
      setStockItemMessage("Stock item deleted.");
      if (editingStockItemId === id) {
        setEditingStockItemId(null);
      }
      setStockEdits((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error("delete stock item error", err);
      setStockItemError("Unable to delete stock item.");
    }
  };

  const buildStockItemEditDraft = (item) => ({
    name: item.name ?? "",
    categoryId: item.categoryId ?? "",
    subCategory: item.subCategory ?? "",
    quantity: item.quantity ?? 0,
    threshold: item.threshold ?? 0,
    notes: item.notes ?? "",
  });

  const closeAddStockCategoryDialog = () => {
    setIsAddStockCategoryDialogOpen(false);
    setStockCategoryError("");
    setStockCategoryDraft({ name: "" });
  };

  const openManageStockCategoriesDialog = () => {
    setIsManageStockCategoriesDialogOpen(true);
  };

  const closeManageStockCategoriesDialog = () => {
    setIsManageStockCategoriesDialogOpen(false);
  };

  const closeAddStockItemDialog = () => {
    setIsAddStockItemDialogOpen(false);
    setStockItemError("");
    setStockItemDraft({
      name: "",
      categoryId: "",
      subCategory: "",
      quantity: "",
      threshold: "5",
      notes: "",
    });
  };

  const openStockItemEditDialog = (item) => {
    setStockItemError("");
    setStockEdits((prev) => ({
      ...prev,
      [item.id]: prev[item.id] ?? buildStockItemEditDraft(item),
    }));
    setEditingStockItemId(item.id);
  };

  const closeStockItemEditDialog = () => {
    setStockItemError("");
    if (editingStockItemId) {
      setStockEdits((prev) => {
        if (!prev[editingStockItemId]) return prev;
        const next = { ...prev };
        delete next[editingStockItemId];
        return next;
      });
    }
    setEditingStockItemId(null);
  };

  const resetStockFilters = () => {
    setStockSearch("");
    setStockCategoryFilter("all");
    setStockSort("name_asc");
  };

  const handleCreateUser = async () => {
    setUserError("");
    setUserMessage("");
    if (!isAdmin) {
      setUserError("Only admins can manage users.");
      return;
    }
    if (!userDraft.email.trim()) {
      setUserError("Email is required.");
      return;
    }
    try {
      const callable = httpsCallable(functions, "createAuthUser");
      const result = await callable({
        email: userDraft.email.trim(),
        role: userDraft.role,
        password: userDraft.password.trim() || undefined,
      });
      const tempPassword = result?.data?.temporaryPassword;
      setUserMessage(
        tempPassword
          ? `User created. Temporary password: ${tempPassword}`
          : "User created."
      );
      setUserDraft({ email: "", role: "worker", password: "" });
    } catch (err) {
      console.error("create user error", err);
      setUserError("Unable to create user.");
    }
  };

  const handleToggleUserStatus = async (targetUser, disabled) => {
    if (!isAdmin) return;
    if (targetUser.id === user.uid) {
      setUserError("You cannot disable your own account.");
      return;
    }
    try {
      const callable = httpsCallable(functions, "updateAuthUserStatus");
      await callable({ uid: targetUser.id, disabled });
      setUserMessage(`User ${disabled ? "disabled" : "enabled"}.`);
    } catch (err) {
      console.error("update user status error", err);
      setUserError("Unable to update account status.");
    }
  };

  const handleDeleteUser = async (targetUser) => {
    if (!isAdmin) return;
    if (targetUser.id === user.uid) {
      setUserError("You cannot delete your own account.");
      return;
    }
    if (!window.confirm(`Delete account for ${targetUser.email}?`)) return;
    try {
      const callable = httpsCallable(functions, "deleteAuthUser");
      await callable({ uid: targetUser.id });
      setUserMessage("User deleted.");
    } catch (err) {
      console.error("delete user error", err);
      setUserError("Unable to delete account.");
    }
  };

  const handleUpdateUserRole = async (targetUser) => {
    setUserError("");
    setUserMessage("");
    if (!isAdmin) return;
    const selectedRole =
      userRoleEdits[targetUser.id] ?? targetUser.role ?? "worker";
    if (!selectedRole) {
      setUserError("Select a role.");
      return;
    }
    if (selectedRole === targetUser.role) {
      setUserMessage("Role unchanged.");
      return;
    }
    try {
      const callable = httpsCallable(functions, "updateAuthUserRole");
      await callable({ uid: targetUser.id, role: selectedRole });
      setUserMessage(`Role updated to ${selectedRole}.`);
      setUserRoleEdits((prev) => {
        const next = { ...prev };
        delete next[targetUser.id];
        return next;
      });
    } catch (err) {
      console.error("update user role error", err);
      setUserError("Unable to update role.");
    }
  };

  const handleAddFinance = async () => {
    setFinanceError("");
    setFinanceMessage("");
    if (!financeDraft.amount) {
      setFinanceError("Amount is required.");
      return;
    }

    let attachmentUrl = "";
    let attachmentName = "";

    try {
      if (financeDraft.file) {
        const fileRef = storageRef(
          storage,
          `finance/${Date.now()}_${financeDraft.file.name}`
        );
        await uploadBytes(fileRef, financeDraft.file);
        attachmentUrl = await getDownloadURL(fileRef);
        attachmentName = financeDraft.file.name;
      }

      await addDoc(collection(db, "financeEntries"), {
        type: financeDraft.type,
        amount: Number(financeDraft.amount),
        description: financeDraft.description.trim(),
        date: financeDraft.date,
        attachmentUrl,
        attachmentName,
        createdAt: serverTimestamp(),
      });

      setFinanceDraft({
        type: "expense",
        amount: "",
        description: "",
        date: new Date().toISOString().split("T")[0],
        file: null,
      });
      setFinanceMessage("Entry added.");
      setShowFinanceForm(false);
    } catch (err) {
      console.error("add finance error", err);
      setFinanceError("Unable to add finance entry.");
    }
  };

  const handleSendDispatchEmail = async (collectionName, order) => {
    try {
      const callable = httpsCallable(functions, "sendDispatchEmail");
      await callable({ collectionName, orderId: order.id });
    } catch (err) {
      console.error("send dispatch email error", err);
      throw err;
    }
  };

  const handleOptimizeExistingTypeImages = async () => {
    if (imageOptimizationRunning) return;
    setImageOptimizationError("");
    setImageOptimizationMessage("");
    setImageOptimizationRunning(true);

    try {
      const callable = httpsCallable(functions, "optimizeExistingTypeImages");
      const result = await callable({ variant: "all", force: false });
      const summary = result?.data ?? {};
      const scanned = toNumber(summary.scanned);
      const optimized = toNumber(summary.optimized);
      const skipped = toNumber(summary.skipped);
      const failed = toNumber(summary.failed);

      setImageOptimizationMessage(
        `Image optimization complete. Scanned: ${scanned}, optimized: ${optimized}, skipped: ${skipped}, failed: ${failed}.`
      );
      if (failed > 0) {
        setImageOptimizationError(
          "Some images failed to optimize. Check Cloud Functions logs for details."
        );
      }
    } catch (err) {
      console.error("optimize existing type images error", err);
      setImageOptimizationError("Unable to optimize existing images.");
    } finally {
      setImageOptimizationRunning(false);
    }
  };

  const handleTypeLibraryUploadSelect = async (files = []) => {
    if (!isAdmin) return;
    if (!files.length) return;
    const invalidFile = files.find(
      (file) => file.type && !file.type.startsWith("image/")
    );
    if (invalidFile) {
      setTypeImageLibraryError("Please upload image files only.");
      return;
    }

    setTypeImageLibraryError("");
    setTypeImageLibraryMessage("");
    setTypeImageLibraryUploading(true);

    let uploadedCount = 0;
    const errors = [];
    try {
      for (const file of files) {
        try {
          await uploadImageAssetToLibrary({
            file,
            source: "upload",
          });
          uploadedCount += 1;
        } catch (err) {
          errors.push(err);
        }
      }

      if (uploadedCount > 0) {
        setTypeImageLibraryMessage(`Uploaded ${uploadedCount} image(s) to library.`);
      }
      if (errors.length > 0) {
        setTypeImageLibraryError(
          `${errors.length} image(s) failed to upload. Please retry those files.`
        );
      }
    } finally {
      setTypeImageLibraryUploading(false);
    }
  };

  const handleTypeLibraryBackfill = async () => {
    if (!isAdmin) return;
    setTypeImageLibraryError("");
    setTypeImageLibraryMessage("");
    setTypeImageLibraryUploading(true);
    try {
      const callable = httpsCallable(functions, "backfillTypeImageLibrary");
      const result = await callable({});
      const summary = result?.data ?? {};
      setTypeImageLibraryMessage(
        `Backfill complete. Scanned: ${toNumber(summary.scanned)}, created: ${toNumber(
          summary.created
        )}, updated: ${toNumber(summary.updated)}, skipped: ${toNumber(
          summary.skipped
        )}, failed: ${toNumber(summary.failed)}.`
      );
      if (toNumber(summary.failed) > 0) {
        setTypeImageLibraryError(
          "Some assets failed to backfill. Check Cloud Functions logs for details."
        );
      }
    } catch (err) {
      console.error("type image library backfill error", err);
      setTypeImageLibraryError("Unable to backfill the image library.");
    } finally {
      setTypeImageLibraryUploading(false);
    }
  };

  const handleCopyTypeLibraryAssetLink = async (asset) => {
    const link = String(asset?.url || "").trim();
    if (!link) {
      setTypeImageLibraryError("No image link available to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setTypeImageLibraryError("");
      setTypeImageLibraryMessage("Image link copied.");
    } catch (err) {
      console.warn("copy type library link failed", err);
      window.prompt("Copy image link:", link);
      setTypeImageLibraryMessage("Image link ready to copy.");
    }
  };

  const openTypeLibraryPreview = (asset) => {
    if (!asset?.url) return;
    setLibraryPreviewAsset(asset);
    setLibraryPreviewZoom(1);
  };

  const closeTypeLibraryPreview = () => {
    setLibraryPreviewAsset(null);
    setLibraryPreviewZoom(1);
  };

  const adjustTypeLibraryPreviewZoom = (delta) => {
    setLibraryPreviewZoom((prev) =>
      clampNumber(Number((prev + delta).toFixed(2)), 1, 5)
    );
  };

  const resetTypeLibraryPreviewZoom = () => {
    setLibraryPreviewZoom(1);
  };

  const handleTypeLibraryPreviewWheel = (event) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    adjustTypeLibraryPreviewZoom(direction * 0.2);
  };

  const handleDeleteTypeLibraryAsset = async (asset) => {
    if (!isAdmin) return;
    if (!asset?.id) return;
    const confirmed = window.confirm(
      `Delete library image "${asset.name}"? This will be blocked if it is still used in products.`
    );
    if (!confirmed) return;

    setTypeImageLibraryError("");
    setTypeImageLibraryMessage("");
    try {
      const callable = httpsCallable(functions, "deleteTypeLibraryAsset");
      await callable({ assetId: asset.id });
      setTypeImageLibraryMessage("Library image deleted.");
    } catch (err) {
      console.error("delete type library asset error", err);
      const usageRows = Array.isArray(err?.details?.usages)
        ? err.details.usages
        : [];
      if (usageRows.length > 0) {
        const usageSummary = usageRows
          .slice(0, 4)
          .map((row) => `${row.collection}/${row.typeId}`)
          .join(", ");
        setTypeImageLibraryError(
          `Cannot delete: image is still used by ${usageRows.length} product record(s): ${usageSummary}`
        );
      } else {
        setTypeImageLibraryError("Unable to delete library image.");
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const showOrderActionMessage = (message) => {
    setOrderActionMessage(message);
    window.setTimeout(() => setOrderActionMessage(""), 2500);
  };

  const resolvedTab = isWorker ? "stock_updates" : activeTab;

  const getActiveFormLink = () => {
    const path = resolvedTab === "livestock_orders" ? "/livestock" : "/eggs";
    if (typeof window === "undefined") return path;
    return `${window.location.origin}${path}`;
  };

  const handleCopyFormLink = async () => {
    const link = getActiveFormLink();
    try {
      await navigator.clipboard.writeText(link);
      showOrderActionMessage("Form link copied.");
    } catch (err) {
      console.warn("copy form link failed", err);
      window.prompt("Copy form link:", link);
    }
  };

  const handleShareFormLink = () => {
    const link = getActiveFormLink();
    const text = `Order form: ${link}`;
    const shareUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const activeOrders =
    resolvedTab === "livestock_orders"
      ? filteredLivestockOrders
      : filteredEggOrders;
  const activeOrderTitle =
    resolvedTab === "livestock_orders"
      ? "Live Livestock Orders"
      : "Live Egg Orders";
  const activeOrderCollection =
    resolvedTab === "livestock_orders" ? "livestockOrders" : "eggOrders";
  const activeItemLabel =
    resolvedTab === "livestock_orders" ? "Livestock" : "Eggs";
  const modalDeliveryOptions =
    selectedOrderCollection === "livestockOrders"
      ? resolvedLivestockDeliveryOptions
      : resolvedEggDeliveryOptions;
  const modalItemOptions =
    selectedOrderCollection === "livestockOrders"
      ? livestockTypes
      : resolvedEggTypes;
  const editingEggTypeDraft =
    editingEggTypeId && editingEggType
      ? eggEdits[editingEggTypeId] ?? buildEggTypeEditDraft(editingEggType)
      : null;
  const editingLivestockTypeDraft =
    editingLivestockTypeId && editingLivestockType
      ? livestockEdits[editingLivestockTypeId] ??
        buildLivestockTypeEditDraft(editingLivestockType)
      : null;
  const editingStockItemDraft =
    editingStockItemId && editingStockItem
      ? stockEdits[editingStockItemId] ?? buildStockItemEditDraft(editingStockItem)
      : null;
  const stockUpdateDialogQuantityValue = stockUpdateDialogDraft.quantity;
  const stockUpdateDialogParsedQuantity = Number(stockUpdateDialogQuantityValue);
  const stockUpdateDialogHasValidQuantity =
    stockUpdateDialogQuantityValue !== "" &&
    stockUpdateDialogQuantityValue !== null &&
    stockUpdateDialogQuantityValue !== undefined &&
    Number.isFinite(stockUpdateDialogParsedQuantity);
  const stockUpdateDialogCurrentQuantity = Number(
    editingStockUpdateItem?.currentQuantity ?? 0
  );
  const stockUpdateDialogPreviewQuantity = stockUpdateDialogHasValidQuantity
    ? stockUpdateDialogParsedQuantity
    : stockUpdateDialogCurrentQuantity;
  const stockUpdateDialogPreviewChange =
    stockUpdateDialogPreviewQuantity - stockUpdateDialogCurrentQuantity;
  const hasEggTypeActiveFilters =
    eggTypeSearch.trim() ||
    eggTypeCategoryFilter !== "all" ||
    eggTypeAvailabilityFilter !== "all" ||
    eggTypePriceTypeFilter !== "all" ||
    eggTypeHasImageFilter !== "all" ||
    eggTypeMinPrice !== "" ||
    eggTypeMaxPrice !== "" ||
    eggTypeSortKey !== "order" ||
    eggTypeSortDirection !== "asc";
  const hasLivestockTypeActiveFilters =
    livestockTypeSearch.trim() ||
    livestockTypeCategoryFilter !== "all" ||
    livestockTypeAvailabilityFilter !== "all" ||
    livestockTypePriceTypeFilter !== "all" ||
    livestockTypeHasImageFilter !== "all" ||
    livestockTypeMinPrice !== "" ||
    livestockTypeMaxPrice !== "" ||
    livestockTypeSortKey !== "order" ||
    livestockTypeSortDirection !== "asc";
  const hasStockActiveFilters =
    stockSearch.trim() ||
    stockCategoryFilter !== "all" ||
    stockSort !== "name_asc";
  const hasStockUpdateActiveFilters =
    stockUpdateSearch.trim() ||
    stockUpdateCategoryFilter !== "all" ||
    stockUpdateSort !== "name_asc";
  const filteredTypeImageLibraryAssets = useMemo(() => {
    const search = typeImageLibrarySearch.trim().toLowerCase();
    if (!search) return typeImageLibraryAssets;
    return typeImageLibraryAssets.filter((asset) => {
      const haystack = [asset.name, asset.path, asset.url]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [typeImageLibraryAssets, typeImageLibrarySearch]);
  const pickerFilteredTypeImageLibraryAssets = useMemo(() => {
    const search = libraryPickerSearch.trim().toLowerCase();
    if (!search) return typeImageLibraryAssets;
    return typeImageLibraryAssets.filter((asset) => {
      const haystack = [asset.name, asset.path, asset.url]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [typeImageLibraryAssets, libraryPickerSearch]);
  const selectedLibraryPickerCount = useMemo(
    () =>
      Object.values(libraryPickerSelection).filter(Boolean).length,
    [libraryPickerSelection]
  );
  const isOrdersActive =
    resolvedTab === "orders" || resolvedTab === "livestock_orders";
  const isTypesActive =
    resolvedTab === "eggs" || resolvedTab === "livestock_types";
  const isDeliveryActive =
    resolvedTab === "delivery" || resolvedTab === "livestock_delivery";
  const canSeeTypes = isAdmin;
  const toggleMenu = (menuId) =>
    setOpenMenu((prev) => (prev === menuId ? null : menuId));

  const orderTabs = [
    { id: "orders", label: "Egg orders" },
    { id: "livestock_orders", label: "Livestock orders" },
  ];

  const typeTabs = [
    { id: "eggs", label: "Egg types", adminOnly: true },
    { id: "livestock_types", label: "Livestock types", adminOnly: true },
  ];

  const deliveryTabs = [
    { id: "delivery", label: "Delivery methods", adminOnly: true },
    { id: "livestock_delivery", label: "Livestock delivery", adminOnly: true },
  ];

  const tabs = [
    { id: "image_library", label: "Image library", adminOnly: true },
    { id: "inventory", label: "Inventory" },
    { id: "stock_logs", label: "Stock logs" },
    { id: "stock_updates", label: "Stock updates" },
    { id: "users", label: "Users", adminOnly: true },
    { id: "finance", label: "Finance", adminOnly: true },
    { id: "reports", label: "Reports", adminOnly: true },
  ];
  const visibleTabs = isWorker
    ? tabs.filter((tab) => tab.id === "stock_updates")
    : tabs.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
            Admin dashboard
          </p>
          <h1 className="text-2xl font-bold text-brandGreen">
            Operations Center
          </h1>
          <p className={mutedText}>Signed in as {user.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/operations"
            className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
          >
            Operations planner
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {!isWorker ? (
          <div
            className="relative"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => toggleMenu("orders")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "orders"}
              className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
                isOrdersActive
                  ? "bg-brandGreen text-white"
                  : "bg-white text-brandGreen border border-brandGreen/30"
              }`}
            >
              Orders ▾
            </button>
            {openMenu === "orders" ? (
              <div className="absolute left-0 z-20 mt-2 w-56 rounded-2xl border border-brandGreen/20 bg-white p-2 shadow-xl">
                {orderTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id);
                      setOpenMenu(null);
                    }}
                    className={`w-full rounded-full px-3 py-2 text-left text-sm font-semibold transition ${
                      resolvedTab === tab.id
                        ? "bg-brandGreen text-white"
                        : "text-brandGreen hover:bg-brandBeige"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {canSeeTypes && !isWorker ? (
          <div
            className="relative"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => toggleMenu("types")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "types"}
              className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
                isTypesActive
                  ? "bg-brandGreen text-white"
                  : "bg-white text-brandGreen border border-brandGreen/30"
              }`}
            >
              Types ▾
            </button>
            {openMenu === "types" ? (
              <div className="absolute left-0 z-20 mt-2 w-56 rounded-2xl border border-brandGreen/20 bg-white p-2 shadow-xl">
                {typeTabs
                  .filter((tab) => !tab.adminOnly || isAdmin)
                  .map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab.id);
                        setOpenMenu(null);
                      }}
                      className={`w-full rounded-full px-3 py-2 text-left text-sm font-semibold transition ${
                        resolvedTab === tab.id
                          ? "bg-brandGreen text-white"
                          : "text-brandGreen hover:bg-brandBeige"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {isAdmin && !isWorker ? (
          <div
            className="relative"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => toggleMenu("delivery")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "delivery"}
              className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
                isDeliveryActive
                  ? "bg-brandGreen text-white"
                  : "bg-white text-brandGreen border border-brandGreen/30"
              }`}
            >
              Delivery ▾
            </button>
            {openMenu === "delivery" ? (
              <div className="absolute left-0 z-20 mt-2 w-56 rounded-2xl border border-brandGreen/20 bg-white p-2 shadow-xl">
                {deliveryTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id);
                      setOpenMenu(null);
                    }}
                    className={`w-full rounded-full px-3 py-2 text-left text-sm font-semibold transition ${
                      resolvedTab === tab.id
                        ? "bg-brandGreen text-white"
                        : "text-brandGreen hover:bg-brandBeige"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition ${
              resolvedTab === tab.id
                ? "bg-brandGreen text-white"
                : "bg-white text-brandGreen border border-brandGreen/30"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(resolvedTab === "orders" || resolvedTab === "livestock_orders") && (
        <div className="space-y-3 rounded-2xl border border-brandGreen/10 bg-white/70 p-4 shadow-inner">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Admin dashboard
              </p>
              <h2 className="text-2xl font-bold text-brandGreen">
                {activeOrderTitle}
              </h2>
              <p className={mutedText}>
                Real-time feed and sorted by most recent.
              </p>
            </div>
            <div className="flex flex-col gap-2 text-sm text-brandGreen md:items-end">
              <div className="rounded-full bg-white/70 px-4 py-2 shadow-inner">
                Total orders:{" "}
                <span className="font-semibold">{activeOrders.length}</span>
              </div>
              {resolvedTab === "orders" ? (
                <div className="rounded-full bg-white/70 px-4 py-2 shadow-inner">
                  Eggs ready for dispatch:{" "}
                  <span className="font-semibold">{readyDispatchEggCount}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className={panelClass}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyFormLink}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Copy form link
              </button>
              <button
                type="button"
                onClick={handleShareFormLink}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen shadow-sm transition hover:bg-brandBeige"
              >
                Share form on WhatsApp
              </button>
              {orderActionMessage ? (
                <span className="text-xs font-semibold text-brandGreen/70">
                  {orderActionMessage}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="w-full rounded-lg border border-brandGreen/30 bg-brandCream px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 md:w-40"
                >
                  <option value="all">All</option>
                  {ORDER_STATUSES.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                  Paid
                </label>
                <select
                  value={paidFilter}
                  onChange={(event) => setPaidFilter(event.target.value)}
                  className="w-full rounded-lg border border-brandGreen/30 bg-brandCream px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 md:w-36"
                >
                  <option value="all">All</option>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                  Sort
                </label>
                <select
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value)}
                  className="w-full rounded-lg border border-brandGreen/30 bg-brandCream px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 md:w-44"
                >
                  <option value="orderNumberDesc">
                    Order # (latest first)
                  </option>
                  <option value="orderNumberAsc">Order # (oldest first)</option>
                  <option value="createdDesc">Created newest</option>
                  <option value="createdAsc">Oldest first</option>
                  <option value="sendDateAsc">Send date ascending</option>
                  <option value="sendDateDesc">Send date descending</option>
                  <option value="status">Status</option>
                  <option value="totalDesc">Total cost descending</option>
                  <option value="totalAsc">Total cost ascending</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-2 md:w-72">
              <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                Search (name, email, phone, delivery, items)
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="e.g. Runner, courier, 082..."
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {activeOrders.length === 0 ? (
              <div className="rounded-2xl border border-brandGreen/10 bg-white/70 p-4 text-center text-sm text-brandGreen/70 shadow-inner">
                No orders match your filters.
              </div>
            ) : (
              activeOrders.map((order) => (
                <div
                  key={order.id}
                  className="space-y-3 rounded-2xl border border-brandGreen/10 bg-white/70 p-4 shadow-inner"
                  onClick={() => {
                    setSelectedOrder(order);
                    setSelectedOrderCollection(activeOrderCollection);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-brandGreen/70">
                        {formatDate(order.createdAtDate)}
                      </p>
                      <p className="text-xs font-mono text-brandGreen">
                        {order.orderNumber || "-"}
                      </p>
                      <p className="font-semibold text-brandGreen">
                        {order.name} {order.surname}
                      </p>
                      <p className="text-xs text-brandGreen/70">
                        {[order.email, order.cellphone]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                          STATUS_STYLES[order.orderStatus] ||
                          "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {order.orderStatus}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedOrder(order);
                          setSelectedOrderCollection(activeOrderCollection);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brandGreen text-white shadow-sm transition hover:shadow-md"
                        aria-label="View order"
                      >
                        ...
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1 text-sm text-brandGreen">
                    <p className="font-semibold">
                      Delivery: {order.deliveryOption ?? "-"}
                    </p>
                    <p>Send date: {formatOrderDateDisplay(order.sendDate)}</p>
                    {activeOrderCollection === "eggOrders" ? (
                      <p>
                        <span className="font-semibold">Swap by value:</span>{" "}
                        {order.allowEggSubstitutions !== false
                          ? "Accepted"
                          : "Exact selected eggs only"}
                      </p>
                    ) : null}
                    <p className="font-semibold">
                      Total: {formatCurrency(order.totalCost)}
                    </p>
                    <p>
                      {activeItemLabel}: {order.eggSummary || "-"}
                    </p>
                    <p>
                      <span className="font-semibold">Paid:</span>{" "}
                      {order.paid ? "Yes" : "No"}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block">
            <div className="overflow-x-auto rounded-2xl border border-brandGreen/10">
              <table className="w-full min-w-[1500px] text-left text-sm text-brandGreen">
                <thead className="bg-brandGreen text-white">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Order #</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Email</th>
                    <th className="px-4 py-3 font-semibold">Cellphone</th>
                    <th className="px-4 py-3 font-semibold">Delivery</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Send date</th>
                    <th className="px-4 py-3 font-semibold">Total</th>
                    <th className="px-4 py-3 font-semibold">Paid</th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.length === 0 && (
                    <tr>
                      <td
                        colSpan={11}
                        className="px-4 py-6 text-center text-brandGreen/70"
                      >
                        No orders match your filters.
                      </td>
                    </tr>
                  )}
                  {activeOrders.map((order, index) => {
                    const rowClass =
                      index % 2 === 0 ? "bg-white" : "bg-brandBeige/60";
                    const internalNote =
                      typeof order.internalNote === "string"
                        ? order.internalNote.trim()
                        : "";
                    const noteTitle = internalNote
                      ? `Internal note: ${internalNote.replace(/\s+/g, " ")}`
                      : "";
                    return (
                      <tr
                        key={order.id}
                        className={`${rowClass} transition cursor-pointer`}
                        onClick={() => {
                          setSelectedOrder(order);
                          setSelectedOrderCollection(activeOrderCollection);
                        }}
                      >
                        <td className="px-4 py-3 align-top">
                          {formatDate(order.createdAtDate)}
                        </td>
                        <td className="px-4 py-3 align-top font-mono">
                          {order.orderNumber || "-"}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-semibold">
                            {order.name} {order.surname}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <a
                            href={`mailto:${order.email}`}
                            onClick={(event) => event.stopPropagation()}
                            className="text-brandGreen underline decoration-brandGreen/50 decoration-1 underline-offset-2"
                          >
                            {order.email}
                          </a>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <a
                            href={`tel:${order.cellphone}`}
                            onClick={(event) => event.stopPropagation()}
                            className="text-brandGreen"
                          >
                            {order.cellphone}
                          </a>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {order.deliveryOption ?? "-"}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                              STATUS_STYLES[order.orderStatus] ||
                              "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {order.orderStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {formatOrderDateDisplay(order.sendDate)}
                        </td>
                        <td className="px-4 py-3 align-top font-semibold">
                          {formatCurrency(order.totalCost)}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                              order.paid
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                : "bg-amber-100 text-amber-800 border border-amber-200"
                            }`}
                          >
                            {order.paid ? "Paid" : "Unpaid"}
                          </span>
                        </td>
                        <td className="relative px-4 py-3 align-top text-right">
                          <div className="flex items-center justify-end gap-2">
                            {internalNote ? (
                              <button
                                type="button"
                                title={noteTitle}
                                aria-label="View internal note"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedOrder(order);
                                  setSelectedOrderCollection(
                                    activeOrderCollection
                                  );
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-brandGreen/30 bg-white text-brandGreen shadow-sm transition hover:bg-brandBeige"
                              >
                                i
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedOrder(order);
                                setSelectedOrderCollection(
                                  activeOrderCollection
                                );
                              }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brandGreen text-white shadow-sm transition hover:shadow-md"
                              aria-label="View order"
                            >
                              ...
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {resolvedTab === "eggs" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Egg types
              </p>
              <h2 className="text-xl font-bold text-brandGreen">
                Catalog management
              </h2>
              <p className={mutedText}>
                Manage categories, type metadata, pricing, and image galleries.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEggCategoryError("");
                  setEggCategoryDraft({ name: "", description: "", order: "" });
                  setIsAddEggCategoryDialogOpen(true);
                }}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                Add category
              </button>
              <button
                type="button"
                onClick={openManageEggCategoriesDialog}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                Manage categories
              </button>
              <button
                type="button"
                onClick={() => {
                  setEggError("");
                  setEggDraft(createEggTypeDraft());
                  setEggDraftImages([]);
                  setEggDraftLibraryImages([]);
                  setEggDraftImageUploading(false);
                  setIsAddEggTypeDialogOpen(true);
                }}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Add egg type
              </button>
              <button
                type="button"
                onClick={handleOptimizeExistingTypeImages}
                disabled={imageOptimizationRunning}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-60"
              >
                {imageOptimizationRunning
                  ? "Optimizing images..."
                  : "Optimize existing type images"}
              </button>
              {eggCategoryMessage ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                  {eggCategoryMessage}
                </span>
              ) : null}
              {eggMessage ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                  {eggMessage}
                </span>
              ) : null}
            </div>
          </div>

          {eggCategoryError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {eggCategoryError}
            </div>
          ) : null}

          {eggError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {eggError}
            </div>
          ) : null}

          {imageOptimizationError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {imageOptimizationError}
            </div>
          ) : null}
          {imageOptimizationMessage ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {imageOptimizationMessage}
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-brandGreen/15 bg-brandBeige/50 p-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <input
                type="text"
                value={eggTypeSearch}
                onChange={(event) => setEggTypeSearch(event.target.value)}
                placeholder="Search title/category/descriptions"
                className={inputClass}
              />
              <select
                value={eggTypeCategoryFilter}
                onChange={(event) => setEggTypeCategoryFilter(event.target.value)}
                className={inputClass}
              >
                {eggTypeCategoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select
                value={eggTypeAvailabilityFilter}
                onChange={(event) => setEggTypeAvailabilityFilter(event.target.value)}
                className={inputClass}
              >
                <option value="all">All availability</option>
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
              </select>
              <select
                value={eggTypePriceTypeFilter}
                onChange={(event) => setEggTypePriceTypeFilter(event.target.value)}
                className={inputClass}
              >
                <option value="all">All price types</option>
                <option value="normal">Normal</option>
                <option value="special">Special</option>
              </select>
              <select
                value={eggTypeHasImageFilter}
                onChange={(event) => setEggTypeHasImageFilter(event.target.value)}
                className={inputClass}
              >
                <option value="all">All image states</option>
                <option value="with">With images</option>
                <option value="without">Without images</option>
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={eggTypeMinPrice}
                onChange={(event) => setEggTypeMinPrice(event.target.value)}
                placeholder="Min price"
                className={inputClass}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={eggTypeMaxPrice}
                onChange={(event) => setEggTypeMaxPrice(event.target.value)}
                placeholder="Max price"
                className={inputClass}
              />
              <div className="flex gap-2">
                <select
                  value={eggTypeSortKey}
                  onChange={(event) => setEggTypeSortKey(event.target.value)}
                  className={inputClass}
                >
                  {EGG_TYPE_SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      Sort by {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setEggTypeSortDirection((prev) =>
                      prev === "asc" ? "desc" : "asc"
                    )
                  }
                  className="rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-xs font-semibold text-brandGreen"
                >
                  {eggTypeSortDirection === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-brandGreen/70">
                Showing {eggTypesFilteredSorted.length} of {eggTypes.length} egg
                type{eggTypes.length === 1 ? "" : "s"}.
              </p>
              <button
                type="button"
                onClick={resetEggTypeFilters}
                disabled={!hasEggTypeActiveFilters}
                className="rounded-full border border-brandGreen/30 bg-white px-3 py-1 text-xs font-semibold text-brandGreen transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset filters
              </button>
            </div>
          </div>

          {eggTypesFilteredSorted.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
              No egg types match the current filters.
            </div>
          ) : (
            <>
              <div className="mt-4 hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1700px] text-left text-sm text-brandGreen">
                  <thead className="bg-brandGreen text-white">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Cover</th>
                      <th className="px-3 py-2 font-semibold">Title</th>
                      <th className="px-3 py-2 font-semibold">Category</th>
                      <th className="px-3 py-2 font-semibold">Price type</th>
                      <th className="px-3 py-2 font-semibold">Price</th>
                      <th className="px-3 py-2 font-semibold">Available</th>
                      <th className="px-3 py-2 font-semibold">Images</th>
                      <th className="px-3 py-2 font-semibold">Short description</th>
                      <th className="px-3 py-2 font-semibold">Long description</th>
                      <th className="px-3 py-2 font-semibold">Order</th>
                      <th className="px-3 py-2 font-semibold">Last updated</th>
                      <th className="px-3 py-2 font-semibold text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {eggTypesFilteredSorted.map((item, index) => {
                      const categoryLabel = resolveEggTypeCategoryLabel(item);
                      const imageCount = item.images?.length ?? 0;
                      const isAvailable = item.available !== false;
                      const updatedAt = getEggTypeUpdatedValue(item);
                      return (
                        <tr
                          key={item.id}
                          onClick={() => openEggTypeEditDialog(item)}
                          className={`cursor-pointer transition hover:bg-brandBeige/70 ${
                            index % 2 === 0 ? "bg-white" : "bg-brandBeige/40"
                          }`}
                        >
                          <td className="px-3 py-2 align-top">
                            <div className="h-14 w-16 overflow-hidden rounded-lg border border-brandGreen/15 bg-white">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.title ?? item.label}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] text-brandGreen/50">
                                  No image
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top font-semibold">
                            {item.title ?? item.label}
                          </td>
                          <td className="px-3 py-2 align-top">{categoryLabel}</td>
                          <td className="px-3 py-2 align-top capitalize">
                            {item.priceType ?? "normal"}
                          </td>
                          <td className="px-3 py-2 align-top">
                            R{Number(item.price ?? 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                isAvailable
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                  : "bg-amber-100 text-amber-800 border border-amber-200"
                              }`}
                            >
                              {isAvailable ? "Available" : "Unavailable"}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top">{imageCount}</td>
                          <td className="px-3 py-2 align-top">
                            <p className="max-w-[220px] truncate">
                              {item.shortDescription || "-"}
                            </p>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <p className="max-w-[240px] truncate">
                              {item.longDescription || "-"}
                            </p>
                          </td>
                          <td className="px-3 py-2 align-top">
                            {toNumber(item.order)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {updatedAt ? formatTimestamp(updatedAt) : "-"}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEggTypeEditDialog(item);
                                }}
                                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleToggleEggAvailability(item);
                                }}
                                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                              >
                                {isAvailable ? "Disable" : "Enable"}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteEggType(item.id);
                                }}
                                className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid gap-3 lg:hidden">
                {eggTypesFilteredSorted.map((item) => {
                  const categoryLabel = resolveEggTypeCategoryLabel(item);
                  const imageCount = item.images?.length ?? 0;
                  const isAvailable = item.available !== false;
                  const updatedAt = getEggTypeUpdatedValue(item);
                  return (
                    <div
                      key={item.id}
                      className="space-y-3 rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex gap-3">
                          <div className="h-16 w-20 overflow-hidden rounded-lg border border-brandGreen/15 bg-white">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.title ?? item.label}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[11px] text-brandGreen/50">
                                No image
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-brandGreen">
                              {item.title ?? item.label}
                            </p>
                            <p className="text-xs text-brandGreen/70">
                              {categoryLabel}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            isAvailable
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              : "bg-amber-100 text-amber-800 border border-amber-200"
                          }`}
                        >
                          {isAvailable ? "Available" : "Unavailable"}
                        </span>
                      </div>
                      <div className="grid gap-1 text-xs text-brandGreen/80">
                        <p>
                          <span className="font-semibold">Price type:</span>{" "}
                          {item.priceType ?? "normal"}
                        </p>
                        <p>
                          <span className="font-semibold">Price:</span> R
                          {Number(item.price ?? 0).toFixed(2)}
                        </p>
                        <p>
                          <span className="font-semibold">Images:</span> {imageCount}
                        </p>
                        <p>
                          <span className="font-semibold">Order:</span>{" "}
                          {toNumber(item.order)}
                        </p>
                        <p>
                          <span className="font-semibold">Updated:</span>{" "}
                          {updatedAt ? formatTimestamp(updatedAt) : "-"}
                        </p>
                        <p className="truncate">
                          <span className="font-semibold">Short:</span>{" "}
                          {item.shortDescription || "-"}
                        </p>
                        <p className="truncate">
                          <span className="font-semibold">Long:</span>{" "}
                          {item.longDescription || "-"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEggTypeEditDialog(item)}
                          className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleEggAvailability(item)}
                          className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                        >
                          {isAvailable ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEggType(item.id)}
                          className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="hidden">
            <div className="space-y-3 rounded-xl border border-brandGreen/15 bg-brandBeige/60 p-4">
              <h3 className="text-sm font-semibold text-brandGreen">
                Add category
              </h3>
              <div className="grid gap-2">
                <input
                  type="text"
                  value={eggCategoryDraft.name}
                  onChange={(event) =>
                    setEggCategoryDraft((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Duck eggs"
                  className={inputClass}
                />
                <input
                  type="number"
                  value={eggCategoryDraft.order}
                  onChange={(event) =>
                    setEggCategoryDraft((prev) => ({
                      ...prev,
                      order: event.target.value,
                    }))
                  }
                  placeholder="Order (e.g. 1)"
                  className={inputClass}
                  min={1}
                />
                <textarea
                  value={eggCategoryDraft.description}
                  onChange={(event) =>
                    setEggCategoryDraft((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Description (optional)"
                  className={inputClass}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddEggCategory}
                    className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {eggCategories.map((category) => (
                  <div
                    key={category.id}
                    className="space-y-2 rounded-lg border border-brandGreen/15 bg-white px-3 py-2"
                  >
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        type="text"
                        value={category.name}
                        onChange={(event) =>
                          setEggCategories((prev) =>
                            prev.map((item) =>
                              item.id === category.id
                                ? { ...item, name: event.target.value }
                                : item
                            )
                          )
                        }
                        className={inputClass}
                      />
                      <input
                        type="number"
                        value={category.order ?? ""}
                        onChange={(event) =>
                          setEggCategories((prev) =>
                            prev.map((item) =>
                              item.id === category.id
                                ? { ...item, order: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Order"
                        className={inputClass}
                        min={1}
                      />
                    </div>
                    <textarea
                      value={category.description ?? ""}
                      onChange={(event) =>
                        setEggCategories((prev) =>
                          prev.map((item) =>
                            item.id === category.id
                              ? { ...item, description: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Description (optional)"
                      className={inputClass}
                    />
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => handleSaveEggCategory(category)}
                        className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteEggCategory(category)}
                        className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {eggCategories.length === 0 ? (
                  <p className={mutedText}>No categories yet.</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-brandGreen/15 bg-brandBeige/60 p-4">
              <h3 className="text-sm font-semibold text-brandGreen">
                Add egg type
              </h3>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  type="text"
                  value={eggDraft.title}
                  onChange={(event) =>
                    setEggDraft((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Title *"
                  className={inputClass}
                />
                <select
                  value={eggDraft.categoryId}
                  onChange={(event) =>
                    setEggDraft((prev) => ({
                      ...prev,
                      categoryId: event.target.value,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="">Select category</option>
                  {eggCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <select
                  value={eggDraft.priceType}
                  onChange={(event) =>
                    setEggDraft((prev) => ({
                      ...prev,
                      priceType: event.target.value,
                    }))
                  }
                  className={inputClass}
                >
                  {TYPE_PRICE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} price
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={eggDraft.price}
                  onChange={(event) =>
                    setEggDraft((prev) => ({
                      ...prev,
                      price: event.target.value,
                    }))
                  }
                  placeholder="Price"
                  className={inputClass}
                />
                <div className="md:col-span-2">
                  <textarea
                    value={eggDraft.shortDescription}
                    onChange={(event) =>
                      setEggDraft((prev) => ({
                        ...prev,
                        shortDescription: event.target.value,
                      }))
                    }
                    placeholder="Short description *"
                    className={`${inputClass} min-h-20`}
                  />
                </div>
                <div className="md:col-span-2">
                  <textarea
                    value={eggDraft.longDescription}
                    onChange={(event) =>
                      setEggDraft((prev) => ({
                        ...prev,
                        longDescription: event.target.value,
                      }))
                    }
                    placeholder="Long description (optional)"
                    className={`${inputClass} min-h-24`}
                  />
                </div>
                <div className="md:col-span-2 flex items-center justify-between rounded-lg border border-brandGreen/20 bg-white px-3 py-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-brandGreen">
                    <input
                      type="checkbox"
                      checked={eggDraft.available !== false}
                      onChange={(event) =>
                        setEggDraft((prev) => ({
                          ...prev,
                          available: event.target.checked,
                        }))
                      }
                    />
                    Available on order form
                  </label>
                  <span className="text-xs text-brandGreen/70">
                    {eggDraftImages.length}/{MAX_TYPE_IMAGES} images
                  </span>
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs font-semibold text-brandGreen/70">
                    Images (optional)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-sm text-brandGreen file:mr-3 file:rounded-full file:border-0 file:bg-brandGreen file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      handleDraftTypeImageSelect({
                        variant: "egg",
                        files,
                      });
                      event.target.value = "";
                    }}
                  />
                  {eggDraftPreviews.length > 0 ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {eggDraftPreviews.map((preview, index) => (
                        <div
                          key={preview.id}
                          className="rounded-lg border border-brandGreen/15 bg-white/80 p-2"
                        >
                          <div className="h-24 overflow-hidden rounded-lg border border-brandGreen/15">
                            <img
                              src={preview.url}
                              alt={preview.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="truncate text-xs text-brandGreen/70">
                              {preview.name}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveDraftTypeImage({
                                  variant: "egg",
                                  index,
                                })
                              }
                              className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-brandGreen/60">
                      No images selected yet.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddEggType}
                  disabled={isAddingEggType}
                  className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAddingEggType ? "Adding egg type..." : "Add egg type"}
                </button>
              </div>
            </div>
          </div>

          <div className="hidden">
            <h3 className="text-sm font-semibold text-brandGreen">
              Existing egg types
            </h3>
            {eggTypes.length === 0 ? (
              <p className={mutedText}>No egg types yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {eggCategoryGroups.map((category) => {
                  const items =
                    category.id === UNCATEGORIZED_ID
                      ? eggTypes.filter((item) => {
                          if (!item.categoryId) return true;
                          return !eggCategories.some(
                            (cat) => cat.id === item.categoryId
                          );
                        })
                      : eggTypes.filter(
                          (item) => item.categoryId === category.id
                        );
                  return (
                    <div
                      key={category.id}
                      className="space-y-2 rounded-lg border border-brandGreen/15 bg-brandBeige/50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <p className="font-semibold text-brandGreen">
                            {category.name}
                          </p>
                          {category.description ? (
                            <p className="text-sm text-brandGreen/80">
                              {category.description}
                            </p>
                          ) : null}
                        </div>
                        <span className="text-xs text-brandGreen/60">
                          {items.length} item{items.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <p className={mutedText}>
                          No egg types in this category.
                        </p>
                      ) : (
                        items.map((item) => {
                          const edit = eggEdits[item.id] ?? {
                            title: item.title ?? item.label ?? "",
                            shortDescription: item.shortDescription ?? "",
                            longDescription: item.longDescription ?? "",
                            layingAge: item.layingAge ?? "",
                            sexingAge: item.sexingAge ?? "",
                            eggsPerYear: item.eggsPerYear ?? "",
                            colourTypes: item.colourTypes ?? "",
                            lifeSpan: item.lifeSpan ?? "",
                            eggColour: item.eggColour ?? "",
                            eggSize: item.eggSize ?? "",
                            priceType: item.priceType ?? "normal",
                            price: item.price ?? 0,
                            categoryId: item.categoryId ?? "",
                            available: item.available !== false,
                            images: item.images ?? [],
                          };
                          const isAvailable = item.available !== false;
                          const imageList = item.images ?? [];
                          return (
                            <div
                              key={item.id}
                              className={`rounded-lg border border-brandGreen/15 bg-white px-3 py-2 shadow-sm ${
                                isAvailable ? "" : "opacity-70"
                              }`}
                            >
                              <div className="grid gap-2 md:grid-cols-2">
                                <input
                                  type="text"
                                  value={edit.title}
                                  onChange={(event) =>
                                    setEggEdits((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...edit,
                                        title: event.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Title"
                                  className={inputClass}
                                />
                                <select
                                  value={edit.categoryId}
                                  onChange={(event) =>
                                    setEggEdits((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...edit,
                                        categoryId: event.target.value,
                                      },
                                    }))
                                  }
                                  className={inputClass}
                                >
                                  <option value="">Select category</option>
                                  {eggCategories.map((categoryOption) => (
                                    <option
                                      key={categoryOption.id}
                                      value={categoryOption.id}
                                    >
                                      {categoryOption.name}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={edit.priceType}
                                  onChange={(event) =>
                                    setEggEdits((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...edit,
                                        priceType: event.target.value,
                                      },
                                    }))
                                  }
                                  className={inputClass}
                                >
                                  {TYPE_PRICE_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label} price
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={edit.price}
                                  onChange={(event) =>
                                    setEggEdits((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...edit,
                                        price: event.target.value,
                                      },
                                    }))
                                  }
                                  className={inputClass}
                                />
                                <div className="md:col-span-2">
                                  <textarea
                                    value={edit.shortDescription}
                                    onChange={(event) =>
                                      setEggEdits((prev) => ({
                                        ...prev,
                                        [item.id]: {
                                          ...edit,
                                          shortDescription: event.target.value,
                                        },
                                      }))
                                    }
                                    className={`${inputClass} min-h-20`}
                                    placeholder="Short description"
                                  />
                                </div>
                                <div className="md:col-span-2">
                                  <textarea
                                    value={edit.longDescription}
                                    onChange={(event) =>
                                      setEggEdits((prev) => ({
                                        ...prev,
                                        [item.id]: {
                                          ...edit,
                                          longDescription: event.target.value,
                                        },
                                      }))
                                    }
                                    className={`${inputClass} min-h-24`}
                                    placeholder="Long description (optional)"
                                  />
                                </div>
                                <p className="md:col-span-2 text-xs font-semibold text-brandGreen/70">
                                  {getTypePriceLabel({
                                    priceType: edit.priceType,
                                    price: edit.price,
                                  })}
                                </p>
                              </div>
                              <div
                                className="mt-2 flex flex-wrap items-center gap-2"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <span
                                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                                    isAvailable
                                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                      : "bg-amber-100 text-amber-800 border border-amber-200"
                                  }`}
                                >
                                  {isAvailable ? "Available" : "Unavailable"}
                                </span>
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleMenu(`egg-type-${item.id}`);
                                    }}
                                    aria-haspopup="menu"
                                    aria-expanded={
                                      openMenu === `egg-type-${item.id}`
                                    }
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brandGreen text-white shadow-sm transition hover:shadow-md"
                                  >
                                    ...
                                  </button>
                                  {openMenu === `egg-type-${item.id}` ? (
                                    <div
                                      className="absolute right-0 z-20 mt-2 w-44 rounded-2xl border border-brandGreen/20 bg-white p-2 shadow-xl"
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleSaveEggType(item.id);
                                          setOpenMenu(null);
                                        }}
                                        className="w-full rounded-full px-3 py-2 text-left text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleToggleEggAvailability(item);
                                          setOpenMenu(null);
                                        }}
                                        className="w-full rounded-full px-3 py-2 text-left text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                                      >
                                        {isAvailable
                                          ? "Mark unavailable"
                                          : "Mark available"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleDeleteEggType(item.id);
                                          setOpenMenu(null);
                                        }}
                                        className="w-full rounded-full px-3 py-2 text-left text-xs font-semibold text-red-700 transition hover:bg-red-50"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              <div className="mt-3 space-y-2 rounded-lg border border-brandGreen/10 bg-brandCream/70 px-3 py-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-semibold text-brandGreen/70">
                                    Images ({imageList.length}/{MAX_TYPE_IMAGES})
                                  </p>
                                  <span className="text-[11px] text-brandGreen/60">
                                    {item.imageUrl ? "Cover image set" : "No cover image"}
                                  </span>
                                </div>
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  disabled={Boolean(eggImageUploads[item.id])}
                                  className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-xs text-brandGreen file:mr-2 file:rounded-full file:border-0 file:bg-brandGreen file:px-3 file:py-1 file:text-[10px] file:font-semibold file:text-white"
                                  onChange={(event) => {
                                    const files = Array.from(
                                      event.target.files ?? []
                                    );
                                    handleTypeImageUpload({
                                      variant: "egg",
                                      typeId: item.id,
                                      files,
                                      currentImages: imageList,
                                    });
                                    event.target.value = "";
                                  }}
                                />
                                {eggImageUploads[item.id] ? (
                                  <span className="text-[11px] text-brandGreen/60">
                                    Uploading...
                                  </span>
                                ) : null}
                                {imageList.length === 0 ? (
                                  <p className="text-xs text-brandGreen/60">
                                    No images uploaded yet.
                                  </p>
                                ) : (
                                  <div className="grid gap-2 md:grid-cols-2">
                                    {imageList.map((image, imageIndex) => (
                                      <div
                                        key={image.id}
                                        className="rounded-lg border border-brandGreen/15 bg-white p-2"
                                      >
                                        <div className="h-24 overflow-hidden rounded-lg border border-brandGreen/15 bg-white/80">
                                          <img
                                            src={image.url}
                                            alt={item.title ?? "Egg image"}
                                            className="h-full w-full object-cover"
                                          />
                                        </div>
                                        <p className="mt-1 truncate text-[11px] text-brandGreen/70">
                                          {image.name}
                                        </p>
                                        <div className="mt-2 flex items-center gap-1">
                                          <button
                                            type="button"
                                            disabled={imageIndex === 0}
                                            onClick={() =>
                                              handleMoveTypeImage({
                                                variant: "egg",
                                                typeId: item.id,
                                                imageId: image.id,
                                                direction: -1,
                                                currentImages: imageList,
                                              })
                                            }
                                            className="rounded-full border border-brandGreen/30 px-2 py-1 text-[10px] font-semibold text-brandGreen disabled:opacity-50"
                                          >
                                            Up
                                          </button>
                                          <button
                                            type="button"
                                            disabled={
                                              imageIndex === imageList.length - 1
                                            }
                                            onClick={() =>
                                              handleMoveTypeImage({
                                                variant: "egg",
                                                typeId: item.id,
                                                imageId: image.id,
                                                direction: 1,
                                                currentImages: imageList,
                                              })
                                            }
                                            className="rounded-full border border-brandGreen/30 px-2 py-1 text-[10px] font-semibold text-brandGreen disabled:opacity-50"
                                          >
                                            Down
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleRemoveTypeImage({
                                                variant: "egg",
                                                typeId: item.id,
                                                imageId: image.id,
                                                currentImages: imageList,
                                              })
                                            }
                                            className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-50"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {isManageEggCategoriesDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Manage egg categories"
          onClick={closeManageEggCategoriesDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Egg categories
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Manage categories
                </h3>
              </div>
              <button
                type="button"
                onClick={closeManageEggCategoriesDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {eggCategories.map((category) => (
                <div
                  key={category.id}
                  className="space-y-2 rounded-lg border border-brandGreen/15 bg-white px-3 py-2"
                >
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      type="text"
                      value={category.name}
                      onChange={(event) =>
                        setEggCategories((prev) =>
                          prev.map((item) =>
                            item.id === category.id
                              ? { ...item, name: event.target.value }
                              : item
                          )
                        )
                      }
                      className={inputClass}
                    />
                    <input
                      type="number"
                      min={1}
                      value={category.order ?? ""}
                      onChange={(event) =>
                        setEggCategories((prev) =>
                          prev.map((item) =>
                            item.id === category.id
                              ? { ...item, order: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Order"
                      className={inputClass}
                    />
                  </div>
                  <textarea
                    value={category.description ?? ""}
                    onChange={(event) =>
                      setEggCategories((prev) =>
                        prev.map((item) =>
                          item.id === category.id
                            ? { ...item, description: event.target.value }
                            : item
                        )
                      )
                    }
                    placeholder="Description (optional)"
                    className={inputClass}
                  />
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleSaveEggCategory(category)}
                      className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteEggCategory(category)}
                      className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {eggCategories.length === 0 ? (
                <p className={mutedText}>No categories yet.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isAddEggCategoryDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add egg category"
          onClick={closeAddEggCategoryDialog}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Egg categories
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Add category
                </h3>
              </div>
              <button
                type="button"
                onClick={closeAddEggCategoryDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              <input
                type="text"
                value={eggCategoryDraft.name}
                onChange={(event) =>
                  setEggCategoryDraft((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="e.g. Duck eggs"
                className={inputClass}
              />
              <input
                type="number"
                min={1}
                value={eggCategoryDraft.order}
                onChange={(event) =>
                  setEggCategoryDraft((prev) => ({
                    ...prev,
                    order: event.target.value,
                  }))
                }
                placeholder="Order (e.g. 1)"
                className={inputClass}
              />
              <textarea
                value={eggCategoryDraft.description}
                onChange={(event) =>
                  setEggCategoryDraft((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Description (optional)"
                className={inputClass}
              />
            </div>
            {eggCategoryError ? (
              <p className="mt-3 text-sm text-red-700">{eggCategoryError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAddEggCategoryDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddEggCategory}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Add category
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddEggTypeDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add egg type"
          onClick={closeAddEggTypeDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Egg types
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Add egg type
                </h3>
              </div>
              <button
                type="button"
                onClick={closeAddEggTypeDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <input
                type="text"
                value={eggDraft.title}
                onChange={(event) =>
                  setEggDraft((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
                placeholder="Title *"
                className={inputClass}
              />
              <select
                value={eggDraft.categoryId}
                onChange={(event) =>
                  setEggDraft((prev) => ({
                    ...prev,
                    categoryId: event.target.value,
                  }))
                }
                className={inputClass}
              >
                <option value="">Select category</option>
                {eggCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <select
                value={eggDraft.priceType}
                onChange={(event) =>
                  setEggDraft((prev) => ({
                    ...prev,
                    priceType: event.target.value,
                  }))
                }
                className={inputClass}
              >
                {TYPE_PRICE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} price
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={eggDraft.price}
                onChange={(event) =>
                  setEggDraft((prev) => ({
                    ...prev,
                    price: event.target.value,
                  }))
                }
                placeholder="Price *"
                className={inputClass}
              />
              <div className="md:col-span-2">
                <textarea
                  value={eggDraft.shortDescription}
                  onChange={(event) =>
                    setEggDraft((prev) => ({
                      ...prev,
                      shortDescription: event.target.value,
                    }))
                  }
                  placeholder="Short description *"
                  className={`${inputClass} min-h-20`}
                />
              </div>
              <div className="md:col-span-2">
                <textarea
                  value={eggDraft.longDescription}
                  onChange={(event) =>
                    setEggDraft((prev) => ({
                      ...prev,
                      longDescription: event.target.value,
                    }))
                  }
                  placeholder="Long description (optional)"
                  className={`${inputClass} min-h-24`}
                />
              </div>
              <div className="md:col-span-2 grid gap-2 md:grid-cols-2">
                {EGG_INFO_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-xs font-semibold text-brandGreen/70">
                      {field.label}
                    </label>
                    <input
                      type="text"
                      value={eggDraft[field.key] ?? ""}
                      onChange={(event) =>
                        setEggDraft((prev) => ({
                          ...prev,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.label}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
              <div className="md:col-span-2 flex items-center justify-between rounded-lg border border-brandGreen/20 bg-brandBeige/30 px-3 py-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-brandGreen">
                  <input
                    type="checkbox"
                    checked={eggDraft.available !== false}
                    onChange={(event) =>
                      setEggDraft((prev) => ({
                        ...prev,
                        available: event.target.checked,
                      }))
                    }
                  />
                  Available on order form
                </label>
                <span className="text-xs text-brandGreen/70">
                  {getDraftImageCount("egg")}/{MAX_TYPE_IMAGES} images
                </span>
              </div>
              <div className="md:col-span-2 space-y-2">
                <label className="text-xs font-semibold text-brandGreen/70">
                  Images (optional)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      openLibraryPicker({
                        variant: "egg",
                        target: "add",
                      })
                    }
                    className="rounded-full border border-brandGreen/30 bg-white px-3 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                  >
                    Select from library
                  </button>
                  <span className="text-xs font-semibold text-brandGreen/70">
                    Upload from device
                  </span>
                  {getDraftImageCount("egg") > 0 ? (
                    <button
                      type="button"
                      onClick={() => clearDraftTypeImages("egg")}
                      disabled={eggDraftImageUploading || isAddingEggType}
                      className="rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Clear selected images
                    </button>
                  ) : null}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={eggDraftImageUploading || isAddingEggType}
                  className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-sm text-brandGreen file:mr-3 file:rounded-full file:border-0 file:bg-brandGreen file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    handleUploadDraftTypeImages({
                      variant: "egg",
                      files,
                    });
                    event.target.value = "";
                  }}
                />
                {eggDraftImageUploading ? (
                  <p className="text-xs text-brandGreen/60">
                    Uploading device images...
                  </p>
                ) : null}
                {eggDraftPreviews.length > 0 || eggDraftLibraryImages.length > 0 ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {eggDraftLibraryImages.map((image) => (
                      <div
                        key={image.id}
                        className="rounded-lg border border-brandGreen/15 bg-white/80 p-2"
                      >
                        <div className="h-24 overflow-hidden rounded-lg border border-brandGreen/15">
                          <img
                            src={image.url}
                            alt={image.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-brandGreen/70">
                            {image.name}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveDraftLibraryTypeImage({
                                variant: "egg",
                                imageId: image.id,
                              })
                            }
                            className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                    {eggDraftPreviews.map((preview, index) => (
                      <div
                        key={preview.id}
                        className="rounded-lg border border-brandGreen/15 bg-white/80 p-2"
                      >
                        <div className="h-24 overflow-hidden rounded-lg border border-brandGreen/15">
                          <img
                            src={preview.url}
                            alt={preview.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-brandGreen/70">
                            {preview.name}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveDraftTypeImage({
                                variant: "egg",
                                index,
                              })
                            }
                            className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-brandGreen/60">
                    No images selected yet.
                  </p>
                )}
              </div>
            </div>
            {eggError ? <p className="mt-3 text-sm text-red-700">{eggError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAddEggTypeDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddEggType}
                disabled={isAddingEggType || eggDraftImageUploading}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAddingEggType
                  ? "Adding egg type..."
                  : eggDraftImageUploading
                    ? "Uploading images..."
                    : "Add egg type"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingEggType && editingEggTypeDraft ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit egg type"
          onClick={closeEggTypeEditDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Egg type
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Edit {editingEggType.title ?? editingEggType.label}
                </h3>
                <p className="text-xs text-brandGreen/70">
                  {resolveEggTypeCategoryLabel(editingEggType)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEggTypeEditDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <input
                type="text"
                value={editingEggTypeDraft.title}
                onChange={(event) =>
                  setEggEdits((prev) => ({
                    ...prev,
                    [editingEggType.id]: {
                      ...editingEggTypeDraft,
                      title: event.target.value,
                    },
                  }))
                }
                placeholder="Title *"
                className={inputClass}
              />
              <select
                value={editingEggTypeDraft.categoryId}
                onChange={(event) =>
                  setEggEdits((prev) => ({
                    ...prev,
                    [editingEggType.id]: {
                      ...editingEggTypeDraft,
                      categoryId: event.target.value,
                    },
                  }))
                }
                className={inputClass}
              >
                <option value="">Select category</option>
                {eggCategories.map((categoryOption) => (
                  <option key={categoryOption.id} value={categoryOption.id}>
                    {categoryOption.name}
                  </option>
                ))}
              </select>
              <select
                value={editingEggTypeDraft.priceType}
                onChange={(event) =>
                  setEggEdits((prev) => ({
                    ...prev,
                    [editingEggType.id]: {
                      ...editingEggTypeDraft,
                      priceType: event.target.value,
                    },
                  }))
                }
                className={inputClass}
              >
                {TYPE_PRICE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} price
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={editingEggTypeDraft.price}
                onChange={(event) =>
                  setEggEdits((prev) => ({
                    ...prev,
                    [editingEggType.id]: {
                      ...editingEggTypeDraft,
                      price: event.target.value,
                    },
                  }))
                }
                className={inputClass}
              />
              <div className="md:col-span-2">
                <textarea
                  value={editingEggTypeDraft.shortDescription}
                  onChange={(event) =>
                    setEggEdits((prev) => ({
                      ...prev,
                      [editingEggType.id]: {
                        ...editingEggTypeDraft,
                        shortDescription: event.target.value,
                      },
                    }))
                  }
                  className={`${inputClass} min-h-20`}
                  placeholder="Short description *"
                />
              </div>
              <div className="md:col-span-2">
                <textarea
                  value={editingEggTypeDraft.longDescription}
                  onChange={(event) =>
                    setEggEdits((prev) => ({
                      ...prev,
                      [editingEggType.id]: {
                        ...editingEggTypeDraft,
                        longDescription: event.target.value,
                      },
                    }))
                  }
                  className={`${inputClass} min-h-24`}
                  placeholder="Long description (optional)"
                />
              </div>
              <div className="md:col-span-2 grid gap-2 md:grid-cols-2">
                {EGG_INFO_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-xs font-semibold text-brandGreen/70">
                      {field.label}
                    </label>
                    <input
                      type="text"
                      value={editingEggTypeDraft[field.key] ?? ""}
                      onChange={(event) =>
                        setEggEdits((prev) => ({
                          ...prev,
                          [editingEggType.id]: {
                            ...editingEggTypeDraft,
                            [field.key]: event.target.value,
                          },
                        }))
                      }
                      placeholder={field.label}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
              <p className="md:col-span-2 text-xs font-semibold text-brandGreen/70">
                {getTypePriceLabel({
                  priceType: editingEggTypeDraft.priceType,
                  price: editingEggTypeDraft.price,
                })}
              </p>
            </div>

            <div className="mt-3 space-y-2 rounded-lg border border-brandGreen/10 bg-brandCream/70 px-3 py-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-brandGreen/70">
                  Images ({editingEggType.images?.length ?? 0}/{MAX_TYPE_IMAGES})
                </p>
                <span className="text-[11px] text-brandGreen/60">
                  {editingEggType.imageUrl ? "Cover image set" : "No cover image"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={Boolean(eggImageUploads[editingEggType.id])}
                  onClick={() =>
                    openLibraryPicker({
                      variant: "egg",
                      target: "edit",
                      typeId: editingEggType.id,
                    })
                  }
                  className="rounded-full border border-brandGreen/30 bg-white px-3 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select from library
                </button>
                <span className="text-xs font-semibold text-brandGreen/70">
                  Upload from device
                </span>
                <button
                  type="button"
                  disabled={
                    Boolean(eggImageUploads[editingEggType.id]) ||
                    (editingEggType.images?.length ?? 0) === 0
                  }
                  onClick={() =>
                    handleClearAllTypeImages({
                      variant: "egg",
                      typeId: editingEggType.id,
                      currentImages: editingEggType.images ?? [],
                    })
                  }
                  className="rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove all images
                </button>
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={Boolean(eggImageUploads[editingEggType.id])}
                className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-xs text-brandGreen file:mr-2 file:rounded-full file:border-0 file:bg-brandGreen file:px-3 file:py-1 file:text-[10px] file:font-semibold file:text-white"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  handleTypeImageUpload({
                    variant: "egg",
                    typeId: editingEggType.id,
                    files,
                    currentImages: editingEggType.images ?? [],
                  });
                  event.target.value = "";
                }}
              />
              {eggImageUploads[editingEggType.id] ? (
                <span className="text-[11px] text-brandGreen/60">Uploading...</span>
              ) : null}
              {(editingEggType.images?.length ?? 0) === 0 ? (
                <p className="text-xs text-brandGreen/60">No images uploaded yet.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {(editingEggType.images ?? []).map((image, imageIndex) => (
                    <div
                      key={image.id}
                      className="rounded-lg border border-brandGreen/15 bg-white p-2"
                    >
                      <div className="h-24 overflow-hidden rounded-lg border border-brandGreen/15 bg-white/80">
                        <img
                          src={image.url}
                          alt={editingEggType.title ?? "Egg image"}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-brandGreen/70">
                        {image.name}
                      </p>
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          type="button"
                          disabled={imageIndex === 0}
                          onClick={() =>
                            handleMoveTypeImage({
                              variant: "egg",
                              typeId: editingEggType.id,
                              imageId: image.id,
                              direction: -1,
                              currentImages: editingEggType.images ?? [],
                            })
                          }
                          className="rounded-full border border-brandGreen/30 px-2 py-1 text-[10px] font-semibold text-brandGreen disabled:opacity-50"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          disabled={
                            imageIndex === (editingEggType.images?.length ?? 0) - 1
                          }
                          onClick={() =>
                            handleMoveTypeImage({
                              variant: "egg",
                              typeId: editingEggType.id,
                              imageId: image.id,
                              direction: 1,
                              currentImages: editingEggType.images ?? [],
                            })
                          }
                          className="rounded-full border border-brandGreen/30 px-2 py-1 text-[10px] font-semibold text-brandGreen disabled:opacity-50"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleRemoveTypeImage({
                              variant: "egg",
                              typeId: editingEggType.id,
                              imageId: image.id,
                              currentImages: editingEggType.images ?? [],
                            })
                          }
                          className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {eggError ? <p className="mt-3 text-sm text-red-700">{eggError}</p> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => handleSaveEggType(editingEggType.id)}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => handleToggleEggAvailability(editingEggType)}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                {editingEggType.available === false
                  ? "Mark available"
                  : "Mark unavailable"}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteEggType(editingEggType.id)}
                className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={closeEggTypeEditDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resolvedTab === "delivery" && (
        <DeliveryOptionsPanel
          title="Delivery methods"
          description="Manage delivery options for egg orders."
          options={
            deliveryOptions.length > 0
              ? deliveryOptions
              : DEFAULT_DELIVERY_OPTIONS
          }
          draft={deliveryDraft}
          edits={deliveryEdits}
          setDraft={setDeliveryDraft}
          setEdits={setDeliveryEdits}
          message={deliveryMessage}
          error={deliveryError}
          onAdd={() =>
            handleAddDeliveryOption(
              "deliveryOptions",
              deliveryDraft,
              setDeliveryDraft,
              setDeliveryMessage,
              setDeliveryError
            )
          }
          onSave={(id) =>
            handleSaveDeliveryOption(
              "deliveryOptions",
              id,
              deliveryEdits,
              setDeliveryMessage,
              setDeliveryError
            )
          }
          onDelete={(id) => handleDeleteDeliveryOption("deliveryOptions", id)}
        />
      )}

      {resolvedTab === "livestock_delivery" && (
        <DeliveryOptionsPanel
          title="Livestock delivery methods"
          description="Manage delivery options for livestock orders."
          options={
            livestockDeliveryOptions.length > 0
              ? livestockDeliveryOptions
              : DEFAULT_LIVESTOCK_DELIVERY_OPTIONS
          }
          draft={livestockDeliveryDraft}
          edits={livestockDeliveryEdits}
          setDraft={setLivestockDeliveryDraft}
          setEdits={setLivestockDeliveryEdits}
          message={livestockDeliveryMessage}
          error={livestockDeliveryError}
          onAdd={() =>
            handleAddDeliveryOption(
              "livestockDeliveryOptions",
              livestockDeliveryDraft,
              setLivestockDeliveryDraft,
              setLivestockDeliveryMessage,
              setLivestockDeliveryError
            )
          }
          onSave={(id) =>
            handleSaveDeliveryOption(
              "livestockDeliveryOptions",
              id,
              livestockDeliveryEdits,
              setLivestockDeliveryMessage,
              setLivestockDeliveryError
            )
          }
          onDelete={(id) =>
            handleDeleteDeliveryOption("livestockDeliveryOptions", id)
          }
        />
      )}

      {resolvedTab === "image_library" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Product image library
              </p>
              <h2 className="text-xl font-bold text-brandGreen">
                Reusable image assets
              </h2>
              <p className={mutedText}>
                Upload once and reuse across egg and livestock products.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md">
                Upload from device
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  disabled={typeImageLibraryUploading}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    handleTypeLibraryUploadSelect(files);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={handleTypeLibraryBackfill}
                disabled={typeImageLibraryUploading}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-60"
              >
                Backfill existing images
              </button>
            </div>
          </div>

          {typeImageLibraryError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {typeImageLibraryError}
            </div>
          ) : null}
          {typeImageLibraryMessage ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {typeImageLibraryMessage}
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-brandGreen/15 bg-brandBeige/50 p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <input
                type="text"
                value={typeImageLibrarySearch}
                onChange={(event) =>
                  setTypeImageLibrarySearch(event.target.value)
                }
                placeholder="Search image name or path"
                className={inputClass}
              />
              <p className="text-xs font-semibold text-brandGreen/70 md:text-right">
                Showing {filteredTypeImageLibraryAssets.length} of{" "}
                {typeImageLibraryAssets.length} image
                {typeImageLibraryAssets.length === 1 ? "" : "s"}.
              </p>
            </div>
          </div>

          {filteredTypeImageLibraryAssets.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
              No library images found.
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-stretch gap-2">
              {filteredTypeImageLibraryAssets.map((asset) => (
                <article
                  key={asset.id}
                  className="w-[240px] rounded-xl border border-brandGreen/15 bg-white p-3 shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => openTypeLibraryPreview(asset)}
                    className="group mx-auto flex h-40 w-28 items-center justify-center overflow-hidden rounded-lg border border-brandGreen/15 bg-brandBeige/30 transition hover:border-brandGreen/30 sm:w-32"
                    title="Open image preview"
                  >
                    {asset.url ? (
                      <img
                        src={asset.url}
                        alt={asset.name}
                        className="h-full w-full object-contain transition group-hover:scale-[1.02]"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="text-xs text-brandGreen/60">
                        No preview
                      </span>
                    )}
                  </button>
                  <p className="mt-2 truncate text-sm font-semibold text-brandGreen">
                    {asset.name}
                  </p>
                  <p className="mt-1 text-[11px] text-brandGreen/60">
                    {formatFileSize(asset.sizeBytes)}
                    {asset.width && asset.height
                      ? ` | ${asset.width}x${asset.height}`
                      : ""}
                  </p>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyTypeLibraryAssetLink(asset)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-brandGreen/25 text-brandGreen transition hover:bg-brandBeige"
                      title="Copy image link"
                      aria-label={`Copy image link for ${asset.name}`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        aria-hidden="true"
                      >
                        <rect
                          x="9"
                          y="9"
                          width="10"
                          height="10"
                          rx="2"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTypeLibraryAsset(asset)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-300 text-red-700 transition hover:bg-red-50"
                      title="Delete image"
                      aria-label={`Delete ${asset.name}`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {resolvedTab === "livestock_types" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Livestock types
              </p>
              <h2 className="text-xl font-bold text-brandGreen">
                Catalog management
              </h2>
              <p className={mutedText}>
                Manage categories, type metadata, pricing, and image galleries.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCategoryError("");
                  setCategoryDraft({ name: "", description: "", order: "" });
                  setIsAddLivestockCategoryDialogOpen(true);
                }}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                Add category
              </button>
              <button
                type="button"
                onClick={openManageLivestockCategoriesDialog}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                Manage categories
              </button>
              <button
                type="button"
                onClick={() => {
                  setLivestockError("");
                  setLivestockDraft(createTypeDraft());
                  setLivestockDraftImages([]);
                  setLivestockDraftLibraryImages([]);
                  setLivestockDraftImageUploading(false);
                  setIsAddLivestockTypeDialogOpen(true);
                }}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Add livestock type
              </button>
              <button
                type="button"
                onClick={handleOptimizeExistingTypeImages}
                disabled={imageOptimizationRunning}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-60"
              >
                {imageOptimizationRunning
                  ? "Optimizing images..."
                  : "Optimize existing type images"}
              </button>
              {categoryMessage ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                  {categoryMessage}
                </span>
              ) : null}
              {livestockMessage ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                  {livestockMessage}
                </span>
              ) : null}
            </div>
          </div>

          {categoryError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {categoryError}
            </div>
          ) : null}
          {livestockError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {livestockError}
            </div>
          ) : null}
          {imageOptimizationError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {imageOptimizationError}
            </div>
          ) : null}
          {imageOptimizationMessage ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {imageOptimizationMessage}
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-brandGreen/15 bg-brandBeige/50 p-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <input
                type="text"
                value={livestockTypeSearch}
                onChange={(event) => setLivestockTypeSearch(event.target.value)}
                placeholder="Search title/category/descriptions"
                className={inputClass}
              />
              <select
                value={livestockTypeCategoryFilter}
                onChange={(event) =>
                  setLivestockTypeCategoryFilter(event.target.value)
                }
                className={inputClass}
              >
                {livestockTypeCategoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select
                value={livestockTypeAvailabilityFilter}
                onChange={(event) =>
                  setLivestockTypeAvailabilityFilter(event.target.value)
                }
                className={inputClass}
              >
                <option value="all">All availability</option>
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
              </select>
              <select
                value={livestockTypePriceTypeFilter}
                onChange={(event) =>
                  setLivestockTypePriceTypeFilter(event.target.value)
                }
                className={inputClass}
              >
                <option value="all">All price types</option>
                <option value="normal">Normal</option>
                <option value="special">Special</option>
              </select>
              <select
                value={livestockTypeHasImageFilter}
                onChange={(event) =>
                  setLivestockTypeHasImageFilter(event.target.value)
                }
                className={inputClass}
              >
                <option value="all">All image states</option>
                <option value="with">With images</option>
                <option value="without">Without images</option>
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={livestockTypeMinPrice}
                onChange={(event) => setLivestockTypeMinPrice(event.target.value)}
                placeholder="Min price"
                className={inputClass}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={livestockTypeMaxPrice}
                onChange={(event) => setLivestockTypeMaxPrice(event.target.value)}
                placeholder="Max price"
                className={inputClass}
              />
              <div className="flex gap-2">
                <select
                  value={livestockTypeSortKey}
                  onChange={(event) => setLivestockTypeSortKey(event.target.value)}
                  className={inputClass}
                >
                  {EGG_TYPE_SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      Sort by {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setLivestockTypeSortDirection((prev) =>
                      prev === "asc" ? "desc" : "asc"
                    )
                  }
                  className="rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-xs font-semibold text-brandGreen"
                >
                  {livestockTypeSortDirection === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-brandGreen/70">
                Showing {livestockTypesFilteredSorted.length} of {livestockTypes.length} livestock type
                {livestockTypes.length === 1 ? "" : "s"}.
              </p>
              <button
                type="button"
                onClick={resetLivestockTypeFilters}
                disabled={!hasLivestockTypeActiveFilters}
                className="rounded-full border border-brandGreen/30 bg-white px-3 py-1 text-xs font-semibold text-brandGreen transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset filters
              </button>
            </div>
          </div>

          {livestockTypesFilteredSorted.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
              No livestock types match the current filters.
            </div>
          ) : (
            <>
              <div className="mt-4 hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1700px] text-left text-sm text-brandGreen">
                  <thead className="bg-brandGreen text-white">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Cover</th>
                      <th className="px-3 py-2 font-semibold">Title</th>
                      <th className="px-3 py-2 font-semibold">Category</th>
                      <th className="px-3 py-2 font-semibold">Price type</th>
                      <th className="px-3 py-2 font-semibold">Price</th>
                      <th className="px-3 py-2 font-semibold">Available</th>
                      <th className="px-3 py-2 font-semibold">Images</th>
                      <th className="px-3 py-2 font-semibold">Short description</th>
                      <th className="px-3 py-2 font-semibold">Long description</th>
                      <th className="px-3 py-2 font-semibold">Order</th>
                      <th className="px-3 py-2 font-semibold">Last updated</th>
                      <th className="px-3 py-2 font-semibold text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {livestockTypesFilteredSorted.map((item, index) => {
                      const categoryLabel = resolveLivestockTypeCategoryLabel(item);
                      const imageCount = item.images?.length ?? 0;
                      const isAvailable = item.available !== false;
                      const updatedAt = getLivestockTypeUpdatedValue(item);
                      return (
                        <tr
                          key={item.id}
                          onClick={() => openLivestockTypeEditDialog(item)}
                          className={`cursor-pointer transition hover:bg-brandBeige/70 ${
                            index % 2 === 0 ? "bg-white" : "bg-brandBeige/40"
                          }`}
                        >
                          <td className="px-3 py-2 align-top">
                            <div className="h-14 w-16 overflow-hidden rounded-lg border border-brandGreen/15 bg-white">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.title ?? item.label}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] text-brandGreen/50">
                                  No image
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top font-semibold">
                            {item.title ?? item.label}
                          </td>
                          <td className="px-3 py-2 align-top">{categoryLabel}</td>
                          <td className="px-3 py-2 align-top capitalize">
                            {item.priceType ?? "normal"}
                          </td>
                          <td className="px-3 py-2 align-top">
                            R{Number(item.price ?? 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                isAvailable
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                  : "bg-amber-100 text-amber-800 border border-amber-200"
                              }`}
                            >
                              {isAvailable ? "Available" : "Unavailable"}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top">{imageCount}</td>
                          <td className="px-3 py-2 align-top">
                            <p className="max-w-[220px] truncate">
                              {item.shortDescription || "-"}
                            </p>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <p className="max-w-[240px] truncate">
                              {item.longDescription || "-"}
                            </p>
                          </td>
                          <td className="px-3 py-2 align-top">
                            {toNumber(item.order)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {updatedAt ? formatTimestamp(updatedAt) : "-"}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openLivestockTypeEditDialog(item);
                                }}
                                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleToggleLivestockAvailability(item);
                                }}
                                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                              >
                                {isAvailable ? "Disable" : "Enable"}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteLivestockType(item.id);
                                }}
                                className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid gap-3 lg:hidden">
                {livestockTypesFilteredSorted.map((item) => {
                  const categoryLabel = resolveLivestockTypeCategoryLabel(item);
                  const imageCount = item.images?.length ?? 0;
                  const isAvailable = item.available !== false;
                  const updatedAt = getLivestockTypeUpdatedValue(item);
                  return (
                    <div
                      key={item.id}
                      className="space-y-3 rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex gap-3">
                          <div className="h-16 w-20 overflow-hidden rounded-lg border border-brandGreen/15 bg-white">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.title ?? item.label}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[11px] text-brandGreen/50">
                                No image
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-brandGreen">
                              {item.title ?? item.label}
                            </p>
                            <p className="text-xs text-brandGreen/70">
                              {categoryLabel}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            isAvailable
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              : "bg-amber-100 text-amber-800 border border-amber-200"
                          }`}
                        >
                          {isAvailable ? "Available" : "Unavailable"}
                        </span>
                      </div>
                      <div className="grid gap-1 text-xs text-brandGreen/80">
                        <p>
                          <span className="font-semibold">Price type:</span>{" "}
                          {item.priceType ?? "normal"}
                        </p>
                        <p>
                          <span className="font-semibold">Price:</span> R
                          {Number(item.price ?? 0).toFixed(2)}
                        </p>
                        <p>
                          <span className="font-semibold">Images:</span> {imageCount}
                        </p>
                        <p>
                          <span className="font-semibold">Order:</span>{" "}
                          {toNumber(item.order)}
                        </p>
                        <p>
                          <span className="font-semibold">Updated:</span>{" "}
                          {updatedAt ? formatTimestamp(updatedAt) : "-"}
                        </p>
                        <p className="truncate">
                          <span className="font-semibold">Short:</span>{" "}
                          {item.shortDescription || "-"}
                        </p>
                        <p className="truncate">
                          <span className="font-semibold">Long:</span>{" "}
                          {item.longDescription || "-"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openLivestockTypeEditDialog(item)}
                          className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleLivestockAvailability(item)}
                          className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                        >
                          {isAvailable ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLivestockType(item.id)}
                          className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {isManageLivestockCategoriesDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Manage livestock categories"
          onClick={closeManageLivestockCategoriesDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Livestock categories
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Manage categories
                </h3>
              </div>
              <button
                type="button"
                onClick={closeManageLivestockCategoriesDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {livestockCategories.map((category) => (
                <div
                  key={category.id}
                  className="space-y-2 rounded-lg border border-brandGreen/15 bg-white px-3 py-2"
                >
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      type="text"
                      value={category.name}
                      onChange={(event) =>
                        setLivestockCategories((prev) =>
                          prev.map((item) =>
                            item.id === category.id
                              ? { ...item, name: event.target.value }
                              : item
                          )
                        )
                      }
                      className={inputClass}
                    />
                    <input
                      type="number"
                      min={1}
                      value={category.order ?? ""}
                      onChange={(event) =>
                        setLivestockCategories((prev) =>
                          prev.map((item) =>
                            item.id === category.id
                              ? { ...item, order: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Order"
                      className={inputClass}
                    />
                  </div>
                  <textarea
                    value={category.description ?? ""}
                    onChange={(event) =>
                      setLivestockCategories((prev) =>
                        prev.map((item) =>
                          item.id === category.id
                            ? { ...item, description: event.target.value }
                            : item
                        )
                      )
                    }
                    placeholder="Description (optional)"
                    className={inputClass}
                  />
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleSaveCategory(category)}
                      className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(category)}
                      className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {livestockCategories.length === 0 ? (
                <p className={mutedText}>No categories yet.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isAddLivestockCategoryDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add livestock category"
          onClick={closeAddLivestockCategoryDialog}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Livestock categories
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Add category
                </h3>
              </div>
              <button
                type="button"
                onClick={closeAddLivestockCategoryDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              <input
                type="text"
                value={categoryDraft.name}
                onChange={(event) =>
                  setCategoryDraft((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="e.g. Adult Chickens"
                className={inputClass}
              />
              <input
                type="number"
                min={1}
                value={categoryDraft.order}
                onChange={(event) =>
                  setCategoryDraft((prev) => ({
                    ...prev,
                    order: event.target.value,
                  }))
                }
                placeholder="Order (e.g. 1)"
                className={inputClass}
              />
              <textarea
                value={categoryDraft.description}
                onChange={(event) =>
                  setCategoryDraft((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Description (optional)"
                className={inputClass}
              />
            </div>
            {categoryError ? (
              <p className="mt-3 text-sm text-red-700">{categoryError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAddLivestockCategoryDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddCategory}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Add category
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddLivestockTypeDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add livestock type"
          onClick={closeAddLivestockTypeDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Livestock types
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Add livestock type
                </h3>
              </div>
              <button
                type="button"
                onClick={closeAddLivestockTypeDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <input
                type="text"
                value={livestockDraft.title}
                onChange={(event) =>
                  setLivestockDraft((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
                placeholder="Title *"
                className={inputClass}
              />
              <select
                value={livestockDraft.categoryId}
                onChange={(event) =>
                  setLivestockDraft((prev) => ({
                    ...prev,
                    categoryId: event.target.value,
                  }))
                }
                className={inputClass}
              >
                <option value="">Select category</option>
                {livestockCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <select
                value={livestockDraft.priceType}
                onChange={(event) =>
                  setLivestockDraft((prev) => ({
                    ...prev,
                    priceType: event.target.value,
                  }))
                }
                className={inputClass}
              >
                {TYPE_PRICE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} price
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={livestockDraft.price}
                onChange={(event) =>
                  setLivestockDraft((prev) => ({
                    ...prev,
                    price: event.target.value,
                  }))
                }
                placeholder="Price *"
                className={inputClass}
              />
              <div className="md:col-span-2">
                <textarea
                  value={livestockDraft.shortDescription}
                  onChange={(event) =>
                    setLivestockDraft((prev) => ({
                      ...prev,
                      shortDescription: event.target.value,
                    }))
                  }
                  placeholder="Short description *"
                  className={`${inputClass} min-h-20`}
                />
              </div>
              <div className="md:col-span-2">
                <textarea
                  value={livestockDraft.longDescription}
                  onChange={(event) =>
                    setLivestockDraft((prev) => ({
                      ...prev,
                      longDescription: event.target.value,
                    }))
                  }
                  placeholder="Long description (optional)"
                  className={`${inputClass} min-h-24`}
                />
              </div>
              <div className="md:col-span-2 flex items-center justify-between rounded-lg border border-brandGreen/20 bg-brandBeige/30 px-3 py-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-brandGreen">
                  <input
                    type="checkbox"
                    checked={livestockDraft.available !== false}
                    onChange={(event) =>
                      setLivestockDraft((prev) => ({
                        ...prev,
                        available: event.target.checked,
                      }))
                    }
                  />
                  Available on order form
                </label>
                <span className="text-xs text-brandGreen/70">
                  {getDraftImageCount("livestock")}/{MAX_TYPE_IMAGES} images
                </span>
              </div>
              <div className="md:col-span-2 space-y-2">
                <label className="text-xs font-semibold text-brandGreen/70">
                  Images (optional)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      openLibraryPicker({
                        variant: "livestock",
                        target: "add",
                      })
                    }
                    className="rounded-full border border-brandGreen/30 bg-white px-3 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                  >
                    Select from library
                  </button>
                  <span className="text-xs font-semibold text-brandGreen/70">
                    Upload from device
                  </span>
                  {getDraftImageCount("livestock") > 0 ? (
                    <button
                      type="button"
                      onClick={() => clearDraftTypeImages("livestock")}
                      disabled={
                        livestockDraftImageUploading || isAddingLivestockType
                      }
                      className="rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Clear selected images
                    </button>
                  ) : null}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={livestockDraftImageUploading || isAddingLivestockType}
                  className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-sm text-brandGreen file:mr-3 file:rounded-full file:border-0 file:bg-brandGreen file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    handleUploadDraftTypeImages({
                      variant: "livestock",
                      files,
                    });
                    event.target.value = "";
                  }}
                />
                {livestockDraftImageUploading ? (
                  <p className="text-xs text-brandGreen/60">
                    Uploading device images...
                  </p>
                ) : null}
                {livestockDraftPreviews.length > 0 ||
                livestockDraftLibraryImages.length > 0 ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {livestockDraftLibraryImages.map((image) => (
                      <div
                        key={image.id}
                        className="rounded-lg border border-brandGreen/15 bg-white/80 p-2"
                      >
                        <div className="h-24 overflow-hidden rounded-lg border border-brandGreen/15">
                          <img
                            src={image.url}
                            alt={image.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-brandGreen/70">
                            {image.name}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveDraftLibraryTypeImage({
                                variant: "livestock",
                                imageId: image.id,
                              })
                            }
                            className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                    {livestockDraftPreviews.map((preview, index) => (
                      <div
                        key={preview.id}
                        className="rounded-lg border border-brandGreen/15 bg-white/80 p-2"
                      >
                        <div className="h-24 overflow-hidden rounded-lg border border-brandGreen/15">
                          <img
                            src={preview.url}
                            alt={preview.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-brandGreen/70">
                            {preview.name}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveDraftTypeImage({
                                variant: "livestock",
                                index,
                              })
                            }
                            className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-brandGreen/60">
                    No images selected yet.
                  </p>
                )}
              </div>
            </div>
            {livestockError ? (
              <p className="mt-3 text-sm text-red-700">{livestockError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAddLivestockTypeDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddLivestockType}
                disabled={isAddingLivestockType || livestockDraftImageUploading}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAddingLivestockType
                  ? "Adding livestock type..."
                  : livestockDraftImageUploading
                    ? "Uploading images..."
                    : "Add livestock type"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingLivestockType && editingLivestockTypeDraft ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit livestock type"
          onClick={closeLivestockTypeEditDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Livestock type
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Edit {editingLivestockType.title ?? editingLivestockType.label}
                </h3>
                <p className="text-xs text-brandGreen/70">
                  {resolveLivestockTypeCategoryLabel(editingLivestockType)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeLivestockTypeEditDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <input
                type="text"
                value={editingLivestockTypeDraft.title}
                onChange={(event) =>
                  setLivestockEdits((prev) => ({
                    ...prev,
                    [editingLivestockType.id]: {
                      ...editingLivestockTypeDraft,
                      title: event.target.value,
                    },
                  }))
                }
                placeholder="Title *"
                className={inputClass}
              />
              <select
                value={editingLivestockTypeDraft.categoryId}
                onChange={(event) =>
                  setLivestockEdits((prev) => ({
                    ...prev,
                    [editingLivestockType.id]: {
                      ...editingLivestockTypeDraft,
                      categoryId: event.target.value,
                    },
                  }))
                }
                className={inputClass}
              >
                <option value="">Select category</option>
                {livestockCategories.map((categoryOption) => (
                  <option key={categoryOption.id} value={categoryOption.id}>
                    {categoryOption.name}
                  </option>
                ))}
              </select>
              <select
                value={editingLivestockTypeDraft.priceType}
                onChange={(event) =>
                  setLivestockEdits((prev) => ({
                    ...prev,
                    [editingLivestockType.id]: {
                      ...editingLivestockTypeDraft,
                      priceType: event.target.value,
                    },
                  }))
                }
                className={inputClass}
              >
                {TYPE_PRICE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} price
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={editingLivestockTypeDraft.price}
                onChange={(event) =>
                  setLivestockEdits((prev) => ({
                    ...prev,
                    [editingLivestockType.id]: {
                      ...editingLivestockTypeDraft,
                      price: event.target.value,
                    },
                  }))
                }
                className={inputClass}
              />
              <div className="md:col-span-2">
                <textarea
                  value={editingLivestockTypeDraft.shortDescription}
                  onChange={(event) =>
                    setLivestockEdits((prev) => ({
                      ...prev,
                      [editingLivestockType.id]: {
                        ...editingLivestockTypeDraft,
                        shortDescription: event.target.value,
                      },
                    }))
                  }
                  className={`${inputClass} min-h-20`}
                  placeholder="Short description *"
                />
              </div>
              <div className="md:col-span-2">
                <textarea
                  value={editingLivestockTypeDraft.longDescription}
                  onChange={(event) =>
                    setLivestockEdits((prev) => ({
                      ...prev,
                      [editingLivestockType.id]: {
                        ...editingLivestockTypeDraft,
                        longDescription: event.target.value,
                      },
                    }))
                  }
                  className={`${inputClass} min-h-24`}
                  placeholder="Long description (optional)"
                />
              </div>
              <p className="md:col-span-2 text-xs font-semibold text-brandGreen/70">
                {getTypePriceLabel({
                  priceType: editingLivestockTypeDraft.priceType,
                  price: editingLivestockTypeDraft.price,
                })}
              </p>
            </div>

            <div className="mt-3 space-y-2 rounded-lg border border-brandGreen/10 bg-brandCream/70 px-3 py-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-brandGreen/70">
                  Images ({editingLivestockType.images?.length ?? 0}/{MAX_TYPE_IMAGES})
                </p>
                <span className="text-[11px] text-brandGreen/60">
                  {editingLivestockType.imageUrl
                    ? "Cover image set"
                    : "No cover image"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={Boolean(livestockImageUploads[editingLivestockType.id])}
                  onClick={() =>
                    openLibraryPicker({
                      variant: "livestock",
                      target: "edit",
                      typeId: editingLivestockType.id,
                    })
                  }
                  className="rounded-full border border-brandGreen/30 bg-white px-3 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select from library
                </button>
                <span className="text-xs font-semibold text-brandGreen/70">
                  Upload from device
                </span>
                <button
                  type="button"
                  disabled={
                    Boolean(livestockImageUploads[editingLivestockType.id]) ||
                    (editingLivestockType.images?.length ?? 0) === 0
                  }
                  onClick={() =>
                    handleClearAllTypeImages({
                      variant: "livestock",
                      typeId: editingLivestockType.id,
                      currentImages: editingLivestockType.images ?? [],
                    })
                  }
                  className="rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove all images
                </button>
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={Boolean(livestockImageUploads[editingLivestockType.id])}
                className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-xs text-brandGreen file:mr-2 file:rounded-full file:border-0 file:bg-brandGreen file:px-3 file:py-1 file:text-[10px] file:font-semibold file:text-white"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  handleTypeImageUpload({
                    variant: "livestock",
                    typeId: editingLivestockType.id,
                    files,
                    currentImages: editingLivestockType.images ?? [],
                  });
                  event.target.value = "";
                }}
              />
              {livestockImageUploads[editingLivestockType.id] ? (
                <span className="text-[11px] text-brandGreen/60">
                  Uploading...
                </span>
              ) : null}
              {(editingLivestockType.images?.length ?? 0) === 0 ? (
                <p className="text-xs text-brandGreen/60">No images uploaded yet.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {(editingLivestockType.images ?? []).map((image, imageIndex) => (
                    <div
                      key={image.id}
                      className="rounded-lg border border-brandGreen/15 bg-white p-2"
                    >
                      <div className="h-24 overflow-hidden rounded-lg border border-brandGreen/15 bg-white/80">
                        <img
                          src={image.url}
                          alt={editingLivestockType.title ?? "Livestock image"}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-brandGreen/70">
                        {image.name}
                      </p>
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          type="button"
                          disabled={imageIndex === 0}
                          onClick={() =>
                            handleMoveTypeImage({
                              variant: "livestock",
                              typeId: editingLivestockType.id,
                              imageId: image.id,
                              direction: -1,
                              currentImages: editingLivestockType.images ?? [],
                            })
                          }
                          className="rounded-full border border-brandGreen/30 px-2 py-1 text-[10px] font-semibold text-brandGreen disabled:opacity-50"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          disabled={
                            imageIndex ===
                            (editingLivestockType.images?.length ?? 0) - 1
                          }
                          onClick={() =>
                            handleMoveTypeImage({
                              variant: "livestock",
                              typeId: editingLivestockType.id,
                              imageId: image.id,
                              direction: 1,
                              currentImages: editingLivestockType.images ?? [],
                            })
                          }
                          className="rounded-full border border-brandGreen/30 px-2 py-1 text-[10px] font-semibold text-brandGreen disabled:opacity-50"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleRemoveTypeImage({
                              variant: "livestock",
                              typeId: editingLivestockType.id,
                              imageId: image.id,
                              currentImages: editingLivestockType.images ?? [],
                            })
                          }
                          className="rounded-full border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {livestockError ? (
              <p className="mt-3 text-sm text-red-700">{livestockError}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => handleSaveLivestockType(editingLivestockType.id)}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => handleToggleLivestockAvailability(editingLivestockType)}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                {editingLivestockType.available === false
                  ? "Mark available"
                  : "Mark unavailable"}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteLivestockType(editingLivestockType.id)}
                className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={closeLivestockTypeEditDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isLibraryPickerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Select images from library"
          onClick={closeLibraryPicker}
        >
          <div
            className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Product image library
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Select from library
                </h3>
                <p className="text-xs text-brandGreen/70">
                  Attach selected images to{" "}
                  {libraryPickerTarget === "edit"
                    ? "this product"
                    : "the current draft"}{" "}
                  ({libraryPickerVariant === "livestock" ? "livestock" : "egg"}
                  ).
                </p>
              </div>
              <button
                type="button"
                onClick={closeLibraryPicker}
                disabled={libraryPickerApplying}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen disabled:cursor-not-allowed disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-brandGreen/15 bg-brandBeige/50 p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <input
                  type="text"
                  value={libraryPickerSearch}
                  onChange={(event) => setLibraryPickerSearch(event.target.value)}
                  placeholder="Search image name or path"
                  className={inputClass}
                />
                <p className="text-xs font-semibold text-brandGreen/70 md:text-right">
                  {selectedLibraryPickerCount} selected
                </p>
              </div>
            </div>

            {pickerFilteredTypeImageLibraryAssets.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
                No library images found.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {pickerFilteredTypeImageLibraryAssets.map((asset) => {
                  const selected = Boolean(libraryPickerSelection[asset.id]);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => toggleLibraryPickerAsset(asset.id)}
                      className={`rounded-xl border p-3 text-left shadow-sm transition ${
                        selected
                          ? "border-brandGreen bg-brandBeige/50 ring-2 ring-brandGreen/30"
                          : "border-brandGreen/15 bg-white hover:bg-brandBeige/40"
                      }`}
                    >
                      <div className="mx-auto flex h-44 w-32 items-center justify-center overflow-hidden rounded-lg border border-brandGreen/15 bg-white sm:w-36">
                        {asset.url ? (
                          <img
                            src={asset.url}
                            alt={asset.name}
                            className="h-full w-full object-contain"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="text-xs text-brandGreen/60">
                            No preview
                          </span>
                        )}
                      </div>
                      <p className="mt-2 truncate text-sm font-semibold text-brandGreen">
                        {asset.name}
                      </p>
                      <p className="mt-1 text-[11px] text-brandGreen/60">
                        {formatFileSize(asset.sizeBytes)}
                        {asset.width && asset.height
                          ? ` | ${asset.width}x${asset.height}`
                          : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeLibraryPicker}
                disabled={libraryPickerApplying}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyLibraryPickerSelection}
                disabled={libraryPickerApplying}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
              >
                {libraryPickerApplying
                  ? "Attaching..."
                  : `Attach selected (${selectedLibraryPickerCount})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {libraryPreviewAsset ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={closeTypeLibraryPreview}
        >
          <div
            className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-brandGreen/20 bg-white p-4 shadow-2xl md:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Image preview
                </p>
                <h3 className="truncate text-base font-semibold text-brandGreen md:text-lg">
                  {libraryPreviewAsset.name || "Library image"}
                </h3>
                <p className="text-xs text-brandGreen/70">
                  Zoom: {Math.round(libraryPreviewZoom * 100)}%
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => adjustTypeLibraryPreviewZoom(-0.2)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-brandGreen/30 text-brandGreen transition hover:bg-brandBeige"
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 12h14"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => adjustTypeLibraryPreviewZoom(0.2)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-brandGreen/30 text-brandGreen transition hover:bg-brandBeige"
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 5v14M5 12h14"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={resetTypeLibraryPreviewZoom}
                  className="rounded-full border border-brandGreen/30 px-3 py-1.5 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={closeTypeLibraryPreview}
                  className="rounded-full border border-brandGreen/30 px-3 py-1.5 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                >
                  Close
                </button>
              </div>
            </div>

            <div
              className="mt-4 h-[72vh] overflow-auto rounded-xl border border-brandGreen/15 bg-brandBeige/30"
              onWheel={handleTypeLibraryPreviewWheel}
            >
              {libraryPreviewAsset.url ? (
                <div className="flex min-h-full min-w-full items-center justify-center p-6">
                  <img
                    src={libraryPreviewAsset.url}
                    alt={libraryPreviewAsset.name || "Preview image"}
                    className="max-h-[calc(72vh-3rem)] max-w-full select-none object-contain"
                    style={{
                      transform: `scale(${libraryPreviewZoom})`,
                      transformOrigin: "center center",
                    }}
                    draggable={false}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-brandGreen/70">
                  No preview available
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-brandGreen/65">
              Tip: use the zoom controls or your mouse wheel to zoom in and out.
            </p>
          </div>
        </div>
      ) : null}

      {resolvedTab === "inventory" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Inventory
              </p>
              <h2 className="text-xl font-bold text-brandGreen">Stock items</h2>
              <p className={mutedText}>
                Track quantities, thresholds, and notes. Admins can add items;
                workers can update quantities and notes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStockCategoryError("");
                  setStockCategoryDraft({ name: "" });
                  setIsAddStockCategoryDialogOpen(true);
                }}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                Add category
              </button>
              <button
                type="button"
                onClick={openManageStockCategoriesDialog}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                Manage categories
              </button>
              <button
                type="button"
                onClick={() => {
                  setStockItemError("");
                  setStockItemDraft({
                    name: "",
                    categoryId: "",
                    subCategory: "",
                    quantity: "",
                    threshold: "5",
                    notes: "",
                  });
                  setIsAddStockItemDialogOpen(true);
                }}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Add stock item
              </button>
              {stockCategoryMessage ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                  {stockCategoryMessage}
                </span>
              ) : null}
              {stockItemMessage ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                  {stockItemMessage}
                </span>
              ) : null}
            </div>
          </div>

          {stockCategoryError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {stockCategoryError}
            </div>
          ) : null}
          {stockItemError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {stockItemError}
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-brandGreen/15 bg-brandBeige/50 p-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <input
                type="text"
                value={stockSearch}
                onChange={(event) => setStockSearch(event.target.value)}
                placeholder="Search inventory"
                className={inputClass}
              />
              <select
                value={stockCategoryFilter}
                onChange={(event) => setStockCategoryFilter(event.target.value)}
                className={inputClass}
              >
                {stockCategoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select
                value={stockSort}
                onChange={(event) => setStockSort(event.target.value)}
                className={inputClass}
              >
                {INVENTORY_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-brandGreen/70">
                Showing {filteredStockItems.length} of {stockItems.length} inventory item
                {stockItems.length === 1 ? "" : "s"}.
              </p>
              <button
                type="button"
                onClick={resetStockFilters}
                disabled={!hasStockActiveFilters}
                className="rounded-full border border-brandGreen/30 bg-white px-3 py-1 text-xs font-semibold text-brandGreen transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset filters
              </button>
            </div>
          </div>

          {filteredStockItems.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
              No inventory items found.
            </div>
          ) : (
            <>
              <div className="mt-4 hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1300px] text-left text-sm text-brandGreen">
                  <thead className="bg-brandGreen text-white">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 font-semibold">Category</th>
                      <th className="px-3 py-2 font-semibold">Subcategory</th>
                      <th className="px-3 py-2 font-semibold">Quantity</th>
                      <th className="px-3 py-2 font-semibold">Threshold</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Notes</th>
                      <th className="px-3 py-2 font-semibold">Last updated</th>
                      <th className="px-3 py-2 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStockItems.map((item, index) => {
                      const quantity = Number(item.quantity ?? 0);
                      const threshold = Number(item.threshold ?? 0);
                      const isLowStock = quantity <= threshold;
                      return (
                        <tr
                          key={item.id}
                          onClick={() => openStockItemEditDialog(item)}
                          className={`cursor-pointer transition hover:bg-brandBeige/70 ${
                            index % 2 === 0 ? "bg-white" : "bg-brandBeige/40"
                          }`}
                        >
                          <td className="px-3 py-2 align-top font-semibold">{item.name}</td>
                          <td className="px-3 py-2 align-top">
                            {item.category || UNCATEGORIZED_LABEL}
                          </td>
                          <td className="px-3 py-2 align-top">{item.subCategory || "-"}</td>
                          <td className="px-3 py-2 align-top">{quantity}</td>
                          <td className="px-3 py-2 align-top">{threshold}</td>
                          <td className="px-3 py-2 align-top">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                isLowStock
                                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                                  : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              }`}
                            >
                              {isLowStock ? "Low" : "OK"}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <p className="max-w-[280px] truncate">{item.notes || "-"}</p>
                          </td>
                          <td className="px-3 py-2 align-top">
                            {item.updatedAt ? formatTimestamp(item.updatedAt) : "-"}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openStockItemEditDialog(item);
                                }}
                                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteStockItem(item.id);
                                }}
                                className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid gap-3 lg:hidden">
                {filteredStockItems.map((item) => {
                  const quantity = Number(item.quantity ?? 0);
                  const threshold = Number(item.threshold ?? 0);
                  const isLowStock = quantity <= threshold;
                  return (
                    <div
                      key={item.id}
                      onClick={() => openStockItemEditDialog(item)}
                      className="cursor-pointer space-y-3 rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-brandGreen">{item.name}</p>
                          <p className="text-xs text-brandGreen/70">
                            {item.category || UNCATEGORIZED_LABEL}
                            {item.subCategory ? ` - ${item.subCategory}` : ""}
                          </p>
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            isLowStock
                              ? "bg-amber-100 text-amber-800 border border-amber-200"
                              : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          }`}
                        >
                          {isLowStock ? "Low" : "OK"}
                        </span>
                      </div>
                      <div className="grid gap-1 text-xs text-brandGreen/80">
                        <p>
                          <span className="font-semibold">Quantity:</span> {quantity}
                        </p>
                        <p>
                          <span className="font-semibold">Threshold:</span> {threshold}
                        </p>
                        <p className="truncate">
                          <span className="font-semibold">Notes:</span> {item.notes || "-"}
                        </p>
                        <p>
                          <span className="font-semibold">Updated:</span>{" "}
                          {item.updatedAt ? formatTimestamp(item.updatedAt) : "-"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => openStockItemEditDialog(item)}
                          className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteStockItem(item.id)}
                          className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {isManageStockCategoriesDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Manage stock categories"
          onClick={closeManageStockCategoriesDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Inventory categories
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Manage categories
                </h3>
              </div>
              <button
                type="button"
                onClick={closeManageStockCategoriesDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {stockCategories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center gap-2 rounded-lg border border-brandGreen/15 bg-white px-3 py-2"
                >
                  <input
                    type="text"
                    value={category.name ?? ""}
                    onChange={(event) =>
                      setStockCategories((prev) =>
                        prev.map((item) =>
                          item.id === category.id
                            ? { ...item, name: event.target.value }
                            : item
                        )
                      )
                    }
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveStockCategory(category)}
                    className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteStockCategory(category)}
                    className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              ))}
              {stockCategories.length === 0 ? (
                <p className={mutedText}>No categories yet.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isAddStockCategoryDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add stock category"
          onClick={closeAddStockCategoryDialog}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Inventory categories
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Add category
                </h3>
              </div>
              <button
                type="button"
                onClick={closeAddStockCategoryDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              <input
                type="text"
                value={stockCategoryDraft.name}
                onChange={(event) =>
                  setStockCategoryDraft((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="e.g. Feed"
                className={inputClass}
              />
            </div>
            {stockCategoryError ? (
              <p className="mt-3 text-sm text-red-700">{stockCategoryError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAddStockCategoryDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddStockCategory}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Add category
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddStockItemDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add stock item"
          onClick={closeAddStockItemDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Inventory
                </p>
                <h3 className="text-xl font-bold text-brandGreen">Add stock item</h3>
              </div>
              <button
                type="button"
                onClick={closeAddStockItemDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              <input
                type="text"
                value={stockItemDraft.name}
                onChange={(event) =>
                  setStockItemDraft((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="Item name"
                className={inputClass}
              />
              <select
                value={stockItemDraft.categoryId}
                onChange={(event) =>
                  setStockItemDraft((prev) => ({
                    ...prev,
                    categoryId: event.target.value,
                  }))
                }
                className={inputClass}
              >
                <option value="">Select category</option>
                {stockCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={stockItemDraft.subCategory}
                onChange={(event) =>
                  setStockItemDraft((prev) => ({
                    ...prev,
                    subCategory: event.target.value,
                  }))
                }
                placeholder="Subcategory (optional)"
                className={inputClass}
              />
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  type="number"
                  value={stockItemDraft.quantity}
                  onChange={(event) =>
                    setStockItemDraft((prev) => ({
                      ...prev,
                      quantity: event.target.value,
                    }))
                  }
                  placeholder="Quantity"
                  className={inputClass}
                />
                <input
                  type="number"
                  value={stockItemDraft.threshold}
                  onChange={(event) =>
                    setStockItemDraft((prev) => ({
                      ...prev,
                      threshold: event.target.value,
                    }))
                  }
                  placeholder="Threshold"
                  className={inputClass}
                />
              </div>
              <textarea
                value={stockItemDraft.notes}
                onChange={(event) =>
                  setStockItemDraft((prev) => ({
                    ...prev,
                    notes: event.target.value,
                  }))
                }
                placeholder="Notes"
                className={inputClass}
              />
            </div>
            {stockItemError ? (
              <p className="mt-3 text-sm text-red-700">{stockItemError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAddStockItemDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddStockItem}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Add stock item
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingStockItem && editingStockItemDraft ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit stock item"
          onClick={closeStockItemEditDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Inventory
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Edit {editingStockItem.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeStockItemEditDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-2">
              <input
                type="text"
                value={editingStockItemDraft.name}
                onChange={(event) =>
                  setStockEdits((prev) => ({
                    ...prev,
                    [editingStockItem.id]: {
                      ...editingStockItemDraft,
                      name: event.target.value,
                    },
                  }))
                }
                placeholder="Item name"
                className={inputClass}
              />
              <select
                value={editingStockItemDraft.categoryId}
                onChange={(event) =>
                  setStockEdits((prev) => ({
                    ...prev,
                    [editingStockItem.id]: {
                      ...editingStockItemDraft,
                      categoryId: event.target.value,
                    },
                  }))
                }
                className={inputClass}
              >
                <option value="">Select category</option>
                {stockCategories.map((categoryOption) => (
                  <option key={categoryOption.id} value={categoryOption.id}>
                    {categoryOption.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={editingStockItemDraft.subCategory}
                onChange={(event) =>
                  setStockEdits((prev) => ({
                    ...prev,
                    [editingStockItem.id]: {
                      ...editingStockItemDraft,
                      subCategory: event.target.value,
                    },
                  }))
                }
                placeholder="Subcategory (optional)"
                className={inputClass}
              />
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  type="number"
                  value={editingStockItemDraft.quantity}
                  onChange={(event) =>
                    setStockEdits((prev) => ({
                      ...prev,
                      [editingStockItem.id]: {
                        ...editingStockItemDraft,
                        quantity: event.target.value,
                      },
                    }))
                  }
                  placeholder="Quantity"
                  className={inputClass}
                />
                <input
                  type="number"
                  value={editingStockItemDraft.threshold}
                  onChange={(event) =>
                    setStockEdits((prev) => ({
                      ...prev,
                      [editingStockItem.id]: {
                        ...editingStockItemDraft,
                        threshold: event.target.value,
                      },
                    }))
                  }
                  placeholder="Threshold"
                  className={inputClass}
                />
              </div>
              <textarea
                value={editingStockItemDraft.notes}
                onChange={(event) =>
                  setStockEdits((prev) => ({
                    ...prev,
                    [editingStockItem.id]: {
                      ...editingStockItemDraft,
                      notes: event.target.value,
                    },
                  }))
                }
                placeholder="Notes"
                className={inputClass}
              />
            </div>

            {stockItemError ? (
              <p className="mt-3 text-sm text-red-700">{stockItemError}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => handleSaveStockItem(editingStockItem.id)}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => handleDeleteStockItem(editingStockItem.id)}
                className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={closeStockItemEditDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {resolvedTab === "stock_logs" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Stock history
              </p>
              <h2 className="text-xl font-bold text-brandGreen">Stock logs</h2>
              <p className={mutedText}>
                Track who changed inventory, when it happened, and any notes.
                Search scans the loaded logs; load all to search further back.
              </p>
            </div>
            <div className="flex flex-col gap-2 md:items-end">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setShowAllStockLogs((prev) => !prev)
                  }
                  disabled={allStockLogs.length <= STOCK_LOG_LIMIT}
                  className="rounded-full border border-brandGreen/30 px-4 py-2 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {showAllStockLogs ? "Show newest" : "Load all"}
                </button>
                <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-brandGreen shadow-inner">
                  {visibleStockLogs.length} logs loaded
                </span>
              </div>
              <p className="text-xs text-brandGreen/60">
                {showAllStockLogs || allStockLogs.length <= STOCK_LOG_LIMIT
                  ? "Showing all loaded entries."
                  : `Showing the newest ${STOCK_LOG_LIMIT} entries.`}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr] md:items-end">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                Search by item, user, or notes
              </label>
              <input
                placeholder="e.g. feed, John, -5, note text"
                className={inputClass}
                type="text"
                value={stockLogSearch}
                onChange={(event) => setStockLogSearch(event.target.value)}
              />
            </div>
            <div className="rounded-lg border border-brandGreen/10 bg-brandBeige/60 p-3 text-xs text-brandGreen/70">
              Search only covers the loaded entries.
              <br />
              Use "Load all" to search the full history.
            </div>
          </div>

          {allStockLogs.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
              No stock logs yet.
            </div>
          ) : (
            <>
              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] text-left text-sm text-brandGreen">
                  <thead className="bg-brandGreen text-white">
                    <tr>
                      <th className="px-3 py-2 font-semibold">When</th>
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 font-semibold">Change</th>
                      <th className="px-3 py-2 font-semibold">Qty</th>
                      <th className="px-3 py-2 font-semibold">User</th>
                      <th className="px-3 py-2 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStockLogs.map((log, index) => {
                      const entries = getLogEntries(log);
                      const title = getLogTitle(log, entries);
                      const user = log.userEmail ?? log.updatedBy ?? "-";
                      const rowClass =
                        index % 2 === 0 ? "bg-white" : "bg-brandBeige/60";
                      return (
                        <tr key={log.id} className={rowClass}>
                          <td className="whitespace-nowrap px-3 py-2 align-top">
                            {formatTimestamp(log.createdAt)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="font-semibold">{title}</div>
                            {entries.length === 1 && log.itemId ? (
                              <p className="text-xs text-brandGreen/60">
                                ID: {log.itemId}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="space-y-1">
                              {entries.map((entry, entryIndex) => (
                                <div
                                  key={`${log.id}-change-${entryIndex}`}
                                  className={`flex items-center justify-between gap-2 text-sm font-semibold ${getChangeColor(
                                    entry.change
                                  )}`}
                                >
                                  <span className="text-brandGreen">
                                    {entry.name}
                                  </span>
                                  <span>{formatChangeValue(entry.change)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="space-y-1 text-sm text-brandGreen">
                              {entries.map((entry, entryIndex) => (
                                <div
                                  key={`${log.id}-qty-${entryIndex}`}
                                  className="flex items-center justify-between gap-2"
                                >
                                  <span className="text-brandGreen/70">
                                    {entry.name}
                                  </span>
                                  <span className="font-semibold">
                                    {entry.fromQty} → {entry.toQty}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">{user}</td>
                          <td className="px-3 py-2 align-top">
                            {entries.length > 1 ? (
                              <div className="space-y-1 text-sm">
                                {entries.map((entry, entryIndex) => (
                                  <div
                                    key={`${log.id}-note-${entryIndex}`}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <span className="font-semibold text-brandGreen">
                                      {entry.name}
                                    </span>
                                    <span className="text-brandGreen/80">
                                      {formatChangeValue(entry.change)} (
                                      {entry.fromQty} → {entry.toQty})
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : log.notes ? (
                              <div className="space-y-1">
                                <p className="m-0 text-sm text-brandGreen/80">
                                  {log.notes}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-brandGreen/60">
                                -
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid gap-3 md:hidden">
                {filteredStockLogs.map((log) => {
                  const entries = getLogEntries(log);
                  const title = getLogTitle(log, entries);
                  const user = log.userEmail ?? log.updatedBy ?? "-";
                  return (
                    <div
                      key={log.id}
                      className="space-y-1 rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-brandGreen">
                          {title}
                        </div>
                        <span className="text-xs text-brandGreen/60">
                          {formatTimestamp(log.createdAt)}
                        </span>
                      </div>
                      <div className="space-y-1 text-sm">
                        {entries.map((entry, entryIndex) => (
                          <div
                            key={`${log.id}-mobile-${entryIndex}`}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="font-semibold text-brandGreen">
                              {entry.name}
                            </span>
                            <span className={getChangeColor(entry.change)}>
                              {formatChangeValue(entry.change)} ({entry.fromQty}{" "}
                              → {entry.toQty})
                            </span>
                          </div>
                        ))}
                        <p className="text-xs text-brandGreen/70">By {user}</p>
                        {entries.length === 1 && log.notes ? (
                          <p className="text-xs text-brandGreen/70">
                            Notes: {log.notes}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {resolvedTab === "stock_updates" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Daily updates
              </p>
              <h2 className="text-xl font-bold text-brandGreen">
                Inventory (admin-created categories)
              </h2>
              <p className={mutedText}>
                Workers can only update existing categories/items that admins
                created. If nothing shows, ask an admin to add inventory first.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-2xl border border-brandGreen/10 bg-brandBeige/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-brandGreen">
                  General voice note
                </p>
                <p className="text-xs text-brandGreen/70">
                  Optional. Attached to every stock log created in this
                  submission.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={
                  isRecordingVoiceNote
                    ? stopVoiceNoteRecording
                    : startVoiceNoteRecording
                }
                disabled={stockUpdateSubmitting}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen shadow-sm transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRecordingVoiceNote
                  ? `Stop recording (${formatDuration(voiceNoteDuration)})`
                  : voiceNote
                  ? "Record new voice note"
                  : "Record voice note"}
              </button>
              {voiceNote ? (
                <button
                  type="button"
                  onClick={clearVoiceNote}
                  disabled={stockUpdateSubmitting || isRecordingVoiceNote}
                  className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen shadow-sm transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear voice note
                </button>
              ) : null}
            </div>
            {voiceNoteError ? (
              <p className="text-xs text-red-700">{voiceNoteError}</p>
            ) : null}
            {isRecordingVoiceNote ? (
              <p className="text-xs text-brandGreen/70">Recording...</p>
            ) : voiceNote ? (
              <div className="flex flex-wrap items-center gap-3 text-xs text-brandGreen/70">
                <span>
                  Voice note ready ({formatDuration(voiceNote.duration ?? 0)})
                </span>
                {voiceNote.previewUrl ? (
                  <audio
                    controls
                    className="h-8 w-56"
                    src={voiceNote.previewUrl}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-xl border border-brandGreen/15 bg-brandBeige/50 p-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <input
                type="text"
                value={stockUpdateSearch}
                onChange={(event) => setStockUpdateSearch(event.target.value)}
                placeholder="Search stock updates"
                className={inputClass}
              />
              <select
                value={stockUpdateCategoryFilter}
                onChange={(event) =>
                  setStockUpdateCategoryFilter(event.target.value)
                }
                className={inputClass}
              >
                {stockUpdateCategoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={stockUpdateSort}
                onChange={(event) => setStockUpdateSort(event.target.value)}
                className={inputClass}
              >
                {STOCK_UPDATE_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={resetStockUpdateFilters}
                disabled={!hasStockUpdateActiveFilters}
                className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset filters
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-brandGreen/70">
                Showing {stockUpdatesFilteredSorted.length} of {stockUpdateList.length}{" "}
                item{stockUpdateList.length === 1 ? "" : "s"}.
              </p>
              <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-brandGreen shadow-inner">
                Pending updates: {stockUpdatePendingCount}
              </span>
            </div>
          </div>

          {stockUpdatesFilteredSorted.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
              No stock items to update.
            </div>
          ) : (
            <>
              <div className="mt-4 hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1300px] text-left text-sm text-brandGreen">
                  <thead className="bg-brandGreen text-white">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 font-semibold">Category</th>
                      <th className="px-3 py-2 font-semibold">Subcategory</th>
                      <th className="px-3 py-2 font-semibold">Current qty</th>
                      <th className="px-3 py-2 font-semibold">Pending qty</th>
                      <th className="px-3 py-2 font-semibold">Pending change</th>
                      <th className="px-3 py-2 font-semibold">Notes</th>
                      <th className="px-3 py-2 font-semibold">Updated by</th>
                      <th className="px-3 py-2 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockUpdatesFilteredSorted.map((item, index) => (
                      <tr
                        key={item.id}
                        onClick={() => openStockUpdateEditDialog(item)}
                        className={`cursor-pointer transition hover:bg-brandBeige/70 ${
                          index % 2 === 0 ? "bg-white" : "bg-brandBeige/40"
                        }`}
                      >
                        <td className="px-3 py-2 align-top font-semibold">{item.name}</td>
                        <td className="px-3 py-2 align-top">{item.categoryLabel}</td>
                        <td className="px-3 py-2 align-top">{item.subCategoryLabel}</td>
                        <td className="px-3 py-2 align-top">{item.currentQuantity}</td>
                        <td className="px-3 py-2 align-top">
                          <span
                            className={
                              item.hasPendingChange ? "font-semibold text-brandGreen" : ""
                            }
                          >
                            {item.pendingQuantity}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span
                            className={`font-semibold ${getChangeColor(
                              item.pendingChange
                            )}`}
                          >
                            {formatChangeValue(item.pendingChange)}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <p className="max-w-[260px] truncate">{item.pendingNotes || "-"}</p>
                        </td>
                        <td className="px-3 py-2 align-top">{item.updatedBy}</td>
                        <td className="px-3 py-2 align-top">
                          <div
                            className="flex justify-end gap-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => openStockUpdateEditDialog(item)}
                              className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                            >
                              Edit
                            </button>
                            {item.hasDraft ? (
                              <button
                                type="button"
                                onClick={() => clearStockUpdatePending(item.id)}
                                className="rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-800"
                              >
                                Clear pending
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid gap-3 lg:hidden">
                {stockUpdatesFilteredSorted.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => openStockUpdateEditDialog(item)}
                    className="cursor-pointer space-y-3 rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-brandGreen">{item.name}</p>
                        <p className="text-xs text-brandGreen/70">
                          {item.categoryLabel}
                          {item.subCategoryLabel !== "-" ? ` - ${item.subCategoryLabel}` : ""}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-semibold ${getChangeColor(
                          item.pendingChange
                        )}`}
                      >
                        {formatChangeValue(item.pendingChange)}
                      </span>
                    </div>
                    <div className="grid gap-1 text-xs text-brandGreen/80">
                      <p>
                        <span className="font-semibold">Current:</span>{" "}
                        {item.currentQuantity}
                      </p>
                      <p>
                        <span className="font-semibold">Pending:</span>{" "}
                        {item.pendingQuantity}
                      </p>
                      <p className="truncate">
                        <span className="font-semibold">Notes:</span>{" "}
                        {item.pendingNotes || "-"}
                      </p>
                      <p>
                        <span className="font-semibold">Updated by:</span>{" "}
                        {item.updatedBy}
                      </p>
                    </div>
                    <div
                      className="flex flex-wrap gap-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => openStockUpdateEditDialog(item)}
                        className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                      >
                        Edit
                      </button>
                      {item.hasDraft ? (
                        <button
                          type="button"
                          onClick={() => clearStockUpdatePending(item.id)}
                          className="rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-800"
                        >
                          Clear pending
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={handleSubmitStockUpdates}
              disabled={
                !hasPendingStockUpdates ||
                stockUpdateSubmitting ||
                isRecordingVoiceNote
              }
              className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              {stockUpdateSubmitting ? "Submitting..." : "Submit all updates"}
            </button>
          </div>
        </div>
      )}

      {editingStockUpdateItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit stock update"
          onClick={closeStockUpdateEditDialog}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Stock updates
                </p>
                <h3 className="text-xl font-bold text-brandGreen">
                  Edit {editingStockUpdateItem.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeStockUpdateEditDialog}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-2 rounded-xl border border-brandGreen/15 bg-brandBeige/40 p-3 text-sm text-brandGreen">
              <p>
                <span className="font-semibold">Category:</span>{" "}
                {editingStockUpdateItem.categoryLabel}
              </p>
              <p>
                <span className="font-semibold">Subcategory:</span>{" "}
                {editingStockUpdateItem.subCategoryLabel}
              </p>
              <p>
                <span className="font-semibold">Current quantity:</span>{" "}
                {editingStockUpdateItem.currentQuantity}
              </p>
              <p>
                <span className="font-semibold">Updated by:</span>{" "}
                {editingStockUpdateItem.updatedBy}
              </p>
            </div>

            <div className="mt-4 grid gap-2">
              <input
                type="number"
                value={stockUpdateDialogDraft.quantity}
                onChange={(event) => {
                  setStockUpdateDialogDraft((prev) => ({
                    ...prev,
                    quantity: event.target.value,
                  }));
                  setStockUpdateDialogError("");
                }}
                placeholder="Pending quantity"
                className={inputClass}
              />
              <textarea
                rows={3}
                value={stockUpdateDialogDraft.notes}
                onChange={(event) =>
                  setStockUpdateDialogDraft((prev) => ({
                    ...prev,
                    notes: event.target.value,
                  }))
                }
                placeholder="Notes (optional)"
                className={inputClass}
              />
            </div>

            <div className="mt-4 rounded-lg border border-brandGreen/15 bg-white px-3 py-2 text-sm">
              <p className="text-brandGreen/70">Pending preview</p>
              <p>
                Quantity:{" "}
                <span className="font-semibold">{stockUpdateDialogPreviewQuantity}</span>
              </p>
              <p>
                Change:{" "}
                <span
                  className={`font-semibold ${getChangeColor(
                    stockUpdateDialogPreviewChange
                  )}`}
                >
                  {formatChangeValue(stockUpdateDialogPreviewChange)}
                </span>
              </p>
            </div>

            {stockUpdateDialogError ? (
              <p className="mt-3 text-sm text-red-700">{stockUpdateDialogError}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={saveStockUpdateDialogDraft}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Save pending
              </button>
              {editingStockUpdateItem.hasDraft ? (
                <button
                  type="button"
                  onClick={() => clearStockUpdatePending(editingStockUpdateItem.id)}
                  className="rounded-full border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-800"
                >
                  Clear pending
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeStockUpdateEditDialog}
                className="rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resolvedTab === "users" && (
        <div className={panelClass}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Users
              </p>
              <h2 className="text-xl font-bold text-brandGreen">
                Manage accounts
              </h2>
              <p className={mutedText}>Create, disable, or delete users.</p>
            </div>
            {userMessage ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                {userMessage}
              </span>
            ) : null}
          </div>
          {userError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {userError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input
              type="email"
              className={inputClass}
              value={userDraft.email}
              onChange={(event) =>
                setUserDraft((prev) => ({ ...prev, email: event.target.value }))
              }
              placeholder="Email"
            />
            <select
              className={inputClass}
              value={userDraft.role}
              onChange={(event) =>
                setUserDraft((prev) => ({ ...prev, role: event.target.value }))
              }
            >
              <option value="worker">Worker</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super admin</option>
            </select>
            <input
              type="password"
              className={inputClass}
              value={userDraft.password}
              onChange={(event) =>
                setUserDraft((prev) => ({
                  ...prev,
                  password: event.target.value,
                }))
              }
              placeholder="Temporary password (optional)"
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleCreateUser}
              className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Create user
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {users.map((account) => (
              <div
                key={account.id}
                className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-brandGreen">
                      {account.email}
                    </p>
                    <p className="text-xs text-brandGreen/60">
                      Role: {account.role ?? "-"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-full border border-brandGreen/30 bg-white px-3 py-1 text-xs font-semibold text-brandGreen"
                      value={
                        userRoleEdits[account.id] ?? account.role ?? "worker"
                      }
                      onChange={(event) =>
                        setUserRoleEdits((prev) => ({
                          ...prev,
                          [account.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="worker">Worker</option>
                      <option value="admin">Admin</option>
                      <option value="super_admin">Super admin</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleUpdateUserRole(account)}
                      className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                    >
                      Update role
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleToggleUserStatus(account, !account.disabled)
                      }
                      className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                    >
                      {account.disabled ? "Enable" : "Disable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(account)}
                      className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolvedTab === "finance" && (
        <div className="space-y-4 rounded-2xl border border-brandGreen/10 bg-white/70 p-4 shadow-inner">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Finance
              </p>
              <h2 className="text-xl font-bold text-brandGreen">
                Record income & expenses
              </h2>
              <p className={mutedText}>
                Upload receipts or proofs next to each entry for future
                reporting.
              </p>
            </div>
            <div className="text-sm text-brandGreen/70">
              <p>
                Income:{" "}
                <span className="font-semibold text-emerald-700">
                  {formatCurrency(financeTotals.income)}
                </span>
              </p>
              <p>
                Expenses:{" "}
                <span className="font-semibold text-red-700">
                  {formatCurrency(financeTotals.expense)}
                </span>
              </p>
              <p>
                Balance:{" "}
                <span
                  className={`font-semibold ${
                    financeBalance >= 0 ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {formatCurrency(financeBalance)}
                </span>
              </p>
              <p className="text-xs text-brandGreen/60">
                Includes completed or paid orders.
              </p>
            </div>
          </div>

          {financeMessage ? (
            <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              {financeMessage}
            </span>
          ) : null}
          {financeError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {financeError}
            </div>
          ) : null}

          <div className="space-y-3 rounded-[32px] border border-brandGreen/30 bg-brandBeige/80 p-5 shadow-xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-brandGreen/70">
                Add income or expense entries to keep the ledger up to date.
              </p>
              <button
                type="button"
                onClick={() => setShowFinanceForm((prev) => !prev)}
                className="rounded-3xl bg-brandGreen px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(58,90,60,0.35)] transition hover:scale-[1.02] hover:bg-emerald-700"
              >
                {showFinanceForm ? "Hide entry form" : "Add entry"}
              </button>
            </div>
          </div>

          {showFinanceForm ? (
            <div className="space-y-3 rounded-xl border border-brandGreen/15 bg-white px-4 py-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-3">
                <select
                  className={inputClass}
                  value={financeDraft.type}
                  onChange={(event) =>
                    setFinanceDraft((prev) => ({
                      ...prev,
                      type: event.target.value,
                    }))
                  }
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
                <input
                  type="number"
                  className={inputClass}
                  value={financeDraft.amount}
                  onChange={(event) =>
                    setFinanceDraft((prev) => ({
                      ...prev,
                      amount: event.target.value,
                    }))
                  }
                  placeholder="Amount"
                />
                <input
                  type="date"
                  className={inputClass}
                  value={financeDraft.date}
                  onChange={(event) =>
                    setFinanceDraft((prev) => ({
                      ...prev,
                      date: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  type="text"
                  className={inputClass}
                  value={financeDraft.description}
                  onChange={(event) =>
                    setFinanceDraft((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Description"
                />
                <input
                  type="file"
                  className={inputClass}
                  onChange={(event) =>
                    setFinanceDraft((prev) => ({
                      ...prev,
                      file: event.target.files?.[0] ?? null,
                    }))
                  }
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddFinance}
                  className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
                >
                  Add entry
                </button>
              </div>
            </div>
          ) : null}

          <div className="space-y-4 rounded-xl border border-brandGreen/20 bg-white/95 px-4 py-4 shadow-lg">
            <div className="rounded-2xl border border-brandGreen/40 bg-brandCream/80 p-3 shadow-md">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Filters & sorting
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-brandGreen/70">
                    Showing {filteredFinanceEntries.length} records
                  </span>
                  <button
                    type="button"
                    onClick={() => setFinanceShowFilters((prev) => !prev)}
                    className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70"
                  >
                    {financeShowFilters ? "Hide filters" : "Show filters"}
                  </button>
                </div>
              </div>
              {financeShowFilters ? (
                <>
                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <div className="space-y-1 text-sm text-brandGreen">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                        Time scope
                      </label>
                      <select
                        className={inputClass}
                        value={financeTimeScope}
                        onChange={(event) =>
                          setFinanceTimeScope(event.target.value)
                        }
                      >
                        <option value="day">Day</option>
                        <option value="week">Week</option>
                        <option value="month">Month</option>
                        <option value="year">Year</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-sm text-brandGreen">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                        Month
                      </label>
                      <input
                        className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
                        type="month"
                        value={financeMonth}
                        onChange={(event) =>
                          setFinanceMonth(event.target.value)
                        }
                        disabled={
                          financeTimeScope === "day" ||
                          financeTimeScope === "week"
                        }
                      />
                    </div>
                    <div className="space-y-1 text-sm text-brandGreen">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                        Sort by
                      </label>
                      <select
                        className={inputClass}
                        value={financeSort}
                        onChange={(event) => setFinanceSort(event.target.value)}
                      >
                        <option value="dateDesc">Date ↓</option>
                        <option value="dateAsc">Date ↑</option>
                        <option value="amountDesc">Amount ↓</option>
                        <option value="amountAsc">Amount ↑</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="space-y-1 text-sm text-brandGreen">
                      <label
                        className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70"
                        htmlFor="finance-min-amount"
                      >
                        Min amount
                      </label>
                      <input
                        id="finance-min-amount"
                        step="0.01"
                        min="0"
                        className={inputClass}
                        type="number"
                        value={financeMinAmount}
                        onChange={(event) =>
                          setFinanceMinAmount(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1 text-sm text-brandGreen">
                      <label
                        className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70"
                        htmlFor="finance-max-amount"
                      >
                        Max amount
                      </label>
                      <input
                        id="finance-max-amount"
                        step="0.01"
                        min="0"
                        className={inputClass}
                        type="number"
                        value={financeMaxAmount}
                        onChange={(event) =>
                          setFinanceMaxAmount(event.target.value)
                        }
                      />
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-brandGreen">
                        <input
                          className="h-4 w-4 rounded border-brandGreen text-brandGreen focus:ring-brandGreen"
                          type="checkbox"
                          checked={financeHasReceipt}
                          onChange={(event) =>
                            setFinanceHasReceipt(event.target.checked)
                          }
                        />
                        Has receipt
                      </label>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                    Income entries
                  </p>
                  <span className="text-xs text-brandGreen/70">
                    {financeIncomeEntries.length} records
                  </span>
                </div>
                {financeIncomeEntries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-brandGreen/30 bg-white/80 px-4 py-6 text-sm text-brandGreen/70">
                    No income entries yet.
                  </div>
                ) : (
                  financeIncomeEntries.map((entry) => {
                    const incomeLabel =
                      entry.source === "order" ? "Order income" : "Income";
                    return (
                      <div
                        key={entry.id}
                        className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm"
                      >
                        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                              {incomeLabel} · {entry.date || "-"}
                            </p>
                            <p className="text-sm text-brandGreen">
                              {entry.description || "No description"}
                            </p>
                          </div>
                          <span className="text-lg font-semibold text-emerald-700">
                            {formatCurrency(Number(entry.amount ?? 0))}
                          </span>
                        </div>
                        {entry.attachmentUrl ? (
                          <a
                            href={entry.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-brandGreen underline decoration-brandGreen/40 underline-offset-4"
                          >
                            {entry.attachmentName ?? "View attachment"}
                          </a>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                    Expense entries
                  </p>
                  <span className="text-xs text-brandGreen/70">
                    {financeExpenseEntries.length} records
                  </span>
                </div>
                {financeExpenseEntries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-brandGreen/30 bg-white/80 px-4 py-6 text-sm text-brandGreen/70">
                    No expenses yet. Record one to keep books balanced.
                  </div>
                ) : (
                  financeExpenseEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                            Expense · {entry.date ?? "-"}
                          </p>
                          <p className="text-sm text-brandGreen">
                            {entry.description || "No description"}
                          </p>
                        </div>
                        <span className="text-lg font-semibold text-red-700">
                          {formatCurrency(Number(entry.amount ?? 0))}
                        </span>
                      </div>
                      {entry.attachmentUrl ? (
                        <a
                          href={entry.attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-brandGreen underline decoration-brandGreen/40 underline-offset-4"
                        >
                          {entry.attachmentName ?? "View attachment"}
                        </a>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {resolvedTab === "reports" && (
        <div className={`${panelClass} space-y-5`}>
          <div className="space-y-3 rounded-2xl border border-brandGreen/10 bg-white/80 p-4 shadow-inner">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Report filters
                </p>
                <p className="text-sm text-brandGreen/70">
                  Showing {reportOrders.length} orders that match the filters.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportShowFilters((prev) => !prev)}
                className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70"
              >
                {reportShowFilters ? "Hide filters" : "Show filters"}
              </button>
            </div>
            {reportShowFilters ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="space-y-1 text-sm text-brandGreen">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                      Time scope
                    </label>
                    <select
                      className={inputClass}
                      value={reportTimeScope}
                      onChange={(event) =>
                        setReportTimeScope(event.target.value)
                      }
                    >
                      <option value="day">Day</option>
                      <option value="week">Week</option>
                      <option value="month">Month</option>
                      <option value="year">Year</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  {reportTimeScope === "day" ? (
                    <div className="space-y-1 text-sm text-brandGreen">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                        Day
                      </label>
                      <input
                        className={inputClass}
                        type="date"
                        value={reportDay}
                        onChange={(event) => setReportDay(event.target.value)}
                      />
                    </div>
                  ) : null}
                  {reportTimeScope === "week" ? (
                    <div className="space-y-1 text-sm text-brandGreen">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                        Week starting
                      </label>
                      <input
                        className={inputClass}
                        type="date"
                        value={reportWeekStart}
                        onChange={(event) =>
                          setReportWeekStart(event.target.value)
                        }
                      />
                    </div>
                  ) : null}
                  {reportTimeScope === "month" ? (
                    <div className="space-y-1 text-sm text-brandGreen">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                        Month
                      </label>
                      <input
                        className={inputClass}
                        type="month"
                        value={reportMonth}
                        onChange={(event) => setReportMonth(event.target.value)}
                      />
                    </div>
                  ) : null}
                  {reportTimeScope === "year" ? (
                    <div className="space-y-1 text-sm text-brandGreen">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                        Year
                      </label>
                      <input
                        className={inputClass}
                        type="number"
                        min="2000"
                        max="2100"
                        value={reportYear}
                        onChange={(event) => setReportYear(event.target.value)}
                      />
                    </div>
                  ) : null}
                  {reportTimeScope === "custom" ? (
                    <>
                      <div className="space-y-1 text-sm text-brandGreen">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                          Start date
                        </label>
                        <input
                          className={inputClass}
                          type="date"
                          value={reportCustomStart}
                          onChange={(event) =>
                            setReportCustomStart(event.target.value)
                          }
                        />
                      </div>
                      <div className="space-y-1 text-sm text-brandGreen">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                          End date
                        </label>
                        <input
                          className={inputClass}
                          type="date"
                          value={reportCustomEnd}
                          onChange={(event) =>
                            setReportCustomEnd(event.target.value)
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="space-y-1 text-sm text-brandGreen">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                      Order type
                    </label>
                    <select
                      className={inputClass}
                      value={reportOrderType}
                      onChange={(event) =>
                        setReportOrderType(event.target.value)
                      }
                    >
                      <option value="all">All</option>
                      <option value="eggs">Eggs</option>
                      <option value="livestock">Livestock</option>
                    </select>
                  </div>
                  <div className="space-y-1 text-sm text-brandGreen">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                      Paid
                    </label>
                    <select
                      className={inputClass}
                      value={reportPaidFilter}
                      onChange={(event) =>
                        setReportPaidFilter(event.target.value)
                      }
                    >
                      <option value="all">All</option>
                      <option value="paid">Paid</option>
                      <option value="unpaid">Unpaid</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-brandGreen">
                      <input
                        className="h-4 w-4 rounded border-brandGreen text-brandGreen focus:ring-brandGreen"
                        type="checkbox"
                        checked={reportIncludeArchived}
                        onChange={(event) =>
                          setReportIncludeArchived(event.target.checked)
                        }
                      />
                      Include archived
                    </label>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                    Order statuses
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {REPORT_ORDER_STATUSES.map((status) => (
                      <label
                        key={status.id}
                        className="inline-flex items-center gap-2 rounded-full border border-brandGreen/20 bg-white px-3 py-1 text-xs font-semibold text-brandGreen"
                      >
                        <input
                          className="h-3.5 w-3.5 rounded border-brandGreen text-brandGreen focus:ring-brandGreen"
                          type="checkbox"
                          checked={reportStatusFilter.includes(status.id)}
                          onChange={() =>
                            setReportStatusFilter((prev) =>
                              prev.includes(status.id)
                                ? prev.filter((id) => id !== status.id)
                                : [...prev, status.id]
                            )
                          }
                        />
                        {status.label}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-brandGreen/10 bg-brandBeige/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Orders (filtered)
              </p>
              <p className="text-3xl font-bold text-brandGreen">
                {ordersSummary.totalOrders}
              </p>
              <p className="text-sm text-brandGreen/70">
                Total value: {formatCurrency(ordersSummary.totalValue)}
              </p>
              <p className="text-xs text-brandGreen/60">
                Filtered by report settings
              </p>
            </div>
            <div className="rounded-2xl border border-brandGreen/10 bg-white/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Archived orders (filtered)
              </p>
              <p className="text-3xl font-bold text-brandGreen">
                {archivedOrdersSummary.totalOrders}
              </p>
              <p className="text-sm text-brandGreen/70">
                Total value: {formatCurrency(archivedOrdersSummary.totalValue)}
              </p>
            </div>
            <div className="rounded-2xl border border-brandGreen/10 bg-brandBeige/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Stock
              </p>
              <p className="text-3xl font-bold text-brandGreen">
                {stockSummary.totalItems}
              </p>
              <p className="text-sm text-brandGreen/70">
                Low stock: {stockSummary.lowStock}
              </p>
            </div>
            <div className="rounded-2xl border border-brandGreen/10 bg-brandBeige/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Finance
              </p>
              <p
                className={`text-3xl font-bold ${
                  financeSummaryBalance >= 0
                    ? "text-emerald-700"
                    : "text-red-700"
                }`}
              >
                {formatCurrency(financeSummaryBalance)}
              </p>
              <p className="text-xs text-brandGreen/70">
                Expenses: {formatCurrency(financeSummary.expense)} · Balance:{" "}
                {formatCurrency(financeSummaryBalance)}
              </p>
              <p className="text-xs text-brandGreen/60">
                Includes completed or paid orders.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-2xl border border-brandGreen/10 bg-brandBeige/60 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Order status distribution
                </p>
                <span className="text-xs text-brandGreen/70">
                  {reportOrders.length} orders (filtered)
                </span>
              </div>
              <div className="space-y-2">
                {orderStatusDistribution.map((status) => (
                  <div key={status.id}>
                    <div className="flex items-center justify-between text-xs text-brandGreen/70">
                      <span>{status.label ?? status.id}</span>
                      <span>{status.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-brandGreen/10">
                      <div
                        className="h-2 rounded-full bg-brandGreen"
                        style={{ width: `${status.percent}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-brandGreen/10 bg-brandBeige/60 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Finance trend
                </p>
                <span className="text-xs text-brandGreen/70">
                  {financeTrend.length} months
                </span>
              </div>
              <div className="flex items-end justify-between gap-1">
                {financeTrend.map((entry) => (
                  <div
                    key={entry.key}
                    className="flex flex-col items-center gap-1 text-[0.65rem] text-brandGreen/70"
                  >
                    <div className="flex h-28 items-end gap-1">
                      <div
                        className="rounded-t-xl bg-emerald-500"
                        style={{
                          width: "8px",
                          height: `${entry.incomePercent}%`,
                        }}
                      ></div>
                      <div
                        className="rounded-t-xl bg-red-500"
                        style={{
                          width: "8px",
                          height: `${entry.expensePercent}%`,
                        }}
                      ></div>
                    </div>
                    <span className="text-[0.6rem]">{entry.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[0.65rem] text-brandGreen/60">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  Income
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-red-500"></span>
                  Expense
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-2xl border border-brandGreen/10 bg-brandBeige/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                Average days in status (since creation)
              </p>
              <div className="space-y-2">
                {orderStatusAverageDays.map((status) => (
                  <div
                    key={status.id}
                    className="flex justify-between text-sm text-brandGreen/70"
                  >
                    <span>{status.label ?? status.id}</span>
                    <span>{status.avgDays.toFixed(1)} days</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-2xl border border-brandGreen/10 bg-brandBeige/60 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Stock category breakdown
                </p>
                <span className="text-xs text-brandGreen/70">
                  Total quantity: {stockSummary.totalQuantity}
                </span>
              </div>
              <div className="space-y-2">
                {stockCategoryBreakdown.map((entry) => {
                  const percent =
                    stockSummary.totalQuantity === 0
                      ? 0
                      : Math.round(
                          (entry.quantity / stockSummary.totalQuantity) * 100
                        );
                  return (
                    <div key={entry.label}>
                      <div className="flex items-center justify-between text-xs text-brandGreen/70">
                        <span>{entry.label}</span>
                        <span>{entry.quantity}</span>
                      </div>
                      <div className="h-2 rounded-full bg-brandGreen/10">
                        <div
                          className="h-2 rounded-full bg-brandGreen"
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-[32px] border-2 border-brandGreen/30 bg-brandBeige/80 p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
                  Finance activity
                </p>
                <p className="text-base font-semibold text-brandGreen/90">
                  How well the business is tracking
                </p>
              </div>
              <span className="text-xs text-brandGreen/70">
                {financeActivity.totalEntries} entries logged
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-brandGreen/30 bg-white/80 p-3 text-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-brandGreen/50">
                  Income
                </p>
                <p className="text-2xl font-semibold text-emerald-700">
                  {formatCurrency(financeSummary.income)}
                </p>
                <p className="text-xs text-brandGreen/70">
                  {financeActivity.receipts} receipts attached
                </p>
              </div>
              <div className="rounded-xl border border-brandGreen/30 bg-white/80 p-3 text-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-brandGreen/50">
                  Expenses
                </p>
                <p className="text-2xl font-semibold text-red-700">
                  {formatCurrency(financeSummary.expense)}
                </p>
                <p className="text-xs text-brandGreen/70">
                  Average {formatCurrency(financeActivity.averageExpense)} per
                  entry
                </p>
              </div>
              <div className="rounded-xl border border-brandGreen/30 bg-white/80 p-3 text-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-brandGreen/50">
                  Net balance
                </p>
                <p
                  className={`text-2xl font-semibold ${
                    financeSummaryBalance >= 0
                      ? "text-emerald-700"
                      : "text-red-700"
                  }`}
                >
                  {formatCurrency(financeSummaryBalance)}
                </p>
                <p className="text-xs text-brandGreen/70">
                  {financeActivity.recent.length} most recent entries
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {financeActivity.recent.map((entry) => {
                const isExpense = entry.type === "expense";
                const entryDate =
                  entry.date ??
                  resolveFinanceEntryDate(entry)?.toISOString().slice(0, 10) ??
                  "-";
                return (
                  <div
                    key={entry.id}
                    className="flex flex-col gap-1 rounded-2xl border border-brandGreen/30 bg-white/90 p-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-brandGreen/70">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            isExpense ? "bg-red-500" : "bg-emerald-500"
                          }`}
                        ></span>
                        {isExpense ? "Expense" : "Income"}
                      </span>
                      <span
                        className={`font-semibold ${
                          isExpense ? "text-red-700" : "text-emerald-700"
                        }`}
                      >
                        {formatCurrency(entry.amount ?? 0)}
                      </span>
                    </div>
                    <p className="text-xs text-brandGreen/60">
                      {entry.description || "Finance entry"} · {entryDate}
                    </p>
                  </div>
                );
              })}
              {financeActivity.recent.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-brandGreen/30 bg-white/80 p-3 text-xs text-brandGreen/60">
                  No finance activity yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {selectedOrder ? (
        <OrderDetailModal
          order={selectedOrder}
          collectionName={selectedOrderCollection}
          deliveryOptions={modalDeliveryOptions}
          itemOptions={modalItemOptions}
          onPaidToggle={(order) =>
            handlePaidToggle(selectedOrderCollection, order)
          }
          onSendDispatchEmail={(order) =>
            handleSendDispatchEmail(selectedOrderCollection, order)
          }
          onClose={() => setSelectedOrder(null)}
          onUpdate={(updates) =>
            handleOrderUpdate(
              selectedOrderCollection,
              selectedOrder.id,
              updates
            )
          }
          onDelete={() =>
            handleOrderDelete(selectedOrderCollection, selectedOrder)
          }
        />
      ) : null}
    </div>
  );
}

function DeliveryOptionsPanel({
  title,
  description,
  options,
  draft,
  edits,
  setDraft,
  setEdits,
  message,
  error,
  onAdd,
  onSave,
  onDelete,
}) {
  return (
    <div className={panelClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
            Delivery
          </p>
          <h2 className="text-xl font-bold text-brandGreen">{title}</h2>
          <p className={mutedText}>{description}</p>
        </div>
        {message ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            {message}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <input
          type="text"
          value={draft.label}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, label: event.target.value }))
          }
          placeholder="Label"
          className={inputClass}
        />
        <input
          type="number"
          value={draft.cost}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, cost: event.target.value }))
          }
          placeholder="Cost"
          className={inputClass}
        />
        <div className="flex items-end justify-end">
          <button
            type="button"
            onClick={onAdd}
            className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
          >
            Add option
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {options.length === 0 ? (
          <div className="rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
            No delivery options found.
          </div>
        ) : (
          options.map((option) => {
            const edit = edits[option.id] ?? {
              label: option.label ?? "",
              cost: option.cost ?? 0,
            };
            return (
              <div
                key={option.id}
                className="rounded-xl border border-brandGreen/15 bg-white px-4 py-3 shadow-sm"
              >
                <div className="grid gap-2 md:grid-cols-3">
                  <input
                    type="text"
                    className={inputClass}
                    value={edit.label}
                    onChange={(event) =>
                      setEdits((prev) => ({
                        ...prev,
                        [option.id]: { ...edit, label: event.target.value },
                      }))
                    }
                  />
                  <input
                    type="number"
                    className={inputClass}
                    value={edit.cost}
                    onChange={(event) =>
                      setEdits((prev) => ({
                        ...prev,
                        [option.id]: { ...edit, cost: event.target.value },
                      }))
                    }
                  />
                  <div className="flex gap-2 md:justify-end">
                    <button
                      type="button"
                      onClick={() => onSave(option.id)}
                      className="rounded-full bg-brandGreen px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(option.id)}
                      className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function OrderDetailModal({
  order,
  collectionName,
  deliveryOptions = [],
  itemOptions = [],
  onClose,
  onUpdate,
  onDelete,
  onPaidToggle,
  onSendDispatchEmail,
}) {
  const [draft, setDraft] = useState({
    orderStatus: order.orderStatus ?? "pending",
    deliveryOptionId: order.deliveryOptionId ?? "",
    sendDate: toOrderDateInputValue(order.sendDate),
    trackingLink: order.trackingLink ?? "",
    notes: order.notes ?? "",
    internalNote: order.internalNote ?? "",
  });
  const [lineItems, setLineItems] = useState([]);
  const [copyNotice, setCopyNotice] = useState("");
  const [internalNoteMessage, setInternalNoteMessage] = useState("");
  const [internalNoteSaving, setInternalNoteSaving] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("");
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [sendDateMessage, setSendDateMessage] = useState("");
  const [dispatchMessage, setDispatchMessage] = useState("");
  const [dispatchSending, setDispatchSending] = useState(false);
  const [uploadingKey, setUploadingKey] = useState("");
  const [invoiceMessage, setInvoiceMessage] = useState("");
  const [invoiceGenerating, setInvoiceGenerating] = useState(false);
  const [invoiceEmailSending, setInvoiceEmailSending] = useState(false);

  const isLivestock = collectionName === "livestockOrders";
  const itemLabelSingular = isLivestock ? "livestock" : "egg";
  const breakdownTitle = isLivestock ? "Livestock breakdown" : "Egg breakdown";
  const normalizedItemOptions = useMemo(
    () =>
      itemOptions.map((option) =>
        normalizeTypeDoc(option.id ?? "", option.raw ?? option)
      ),
    [itemOptions]
  );

  useEffect(() => {
    setDraft({
      orderStatus: order.orderStatus ?? "pending",
      deliveryOptionId: order.deliveryOptionId ?? "",
      sendDate: toOrderDateInputValue(order.sendDate),
      trackingLink: order.trackingLink ?? "",
      notes: order.notes ?? "",
      internalNote: order.internalNote ?? "",
    });
    const resolveLinePrice = (item) => {
      const special = Number(item.specialPrice ?? 0);
      if (Number.isFinite(special) && special > 0) {
        return special;
      }
      return Number(item.price ?? 0);
    };
    const baseLines = Array.isArray(order.eggs)
      ? order.eggs.map((item) => ({
          lineId: createLineId(),
          itemId: item.id ?? "",
          label: item.label ?? item.name ?? "",
          price: resolveLinePrice(item),
          priceType: item.priceType ?? "normal",
          quantity: item.quantity ?? 0,
        }))
      : [];
    if (baseLines.length === 0) {
      const fallback = normalizedItemOptions[0];
      baseLines.push({
        lineId: createLineId(),
        itemId: fallback?.id ?? "",
        label: fallback?.title ?? fallback?.label ?? "",
        price: Number(fallback?.price ?? 0),
        priceType: fallback?.priceType ?? "normal",
        quantity: 0,
      });
    }
    setLineItems(baseLines);
    setCopyNotice("");
    setDispatchMessage("");
    setSendDateMessage("");
    setInternalNoteMessage("");
    setTrackingMessage("");
    setInvoiceMessage("");
  }, [order, normalizedItemOptions]);

  const eggsTotal =
    typeof order.eggsTotal === "number"
      ? order.eggsTotal
      : Array.isArray(order.eggs)
      ? order.eggs.reduce((sum, item) => {
          const price =
            item.specialPrice === null ||
            item.specialPrice === undefined ||
            item.specialPrice === 0
              ? item.price
              : item.specialPrice;
          return sum + Number(price ?? 0) * Number(item.quantity ?? 0);
        }, 0)
      : 0;

  const deliveryCost =
    typeof order.deliveryCost === "number"
      ? order.deliveryCost
      : deliveryOptions.find((option) => option.id === order.deliveryOptionId)
          ?.cost ?? extractCost(order.deliveryOption);

  const totalCost =
    typeof order.totalCost === "number"
      ? order.totalCost
      : Number(eggsTotal) + Number(deliveryCost);

  const orderFullName = [order.name, order.surname]
    .filter(Boolean)
    .join(" ")
    .trim();
  const contactLine = [order.email, order.cellphone]
    .filter(Boolean)
    .join(" · ");
  const streetAddress = order.streetAddress?.trim() || "";
  const suburb = order.suburb?.trim() || "";
  const city = order.city?.trim() || "";
  const province = order.province?.trim() || "";
  const postalCode = order.postalCode?.trim() || "";
  const legacyAddress = order.address?.trim() || "";
  const legacyPudoMatch = legacyAddress.match(/\|\s*PUDO Box:\s*(.+)$/i);
  const legacyPudoBox = legacyPudoMatch?.[1]?.trim() || "";
  const legacyAddressBase = legacyAddress
    .replace(/\s*\|\s*PUDO Box:\s*.+$/i, "")
    .trim();
  const pudoBoxName = order.pudoBoxName?.trim() || legacyPudoBox;
  const hasStructuredAddress = Boolean(
    streetAddress || suburb || city || province || postalCode
  );
  const addressLines = hasStructuredAddress
    ? [
        { label: "Street", value: streetAddress },
        { label: "Suburb", value: suburb },
        { label: "City", value: city },
        { label: "Province", value: province },
        { label: "Postal code", value: postalCode },
      ].filter((line) => line.value)
    : [];
  const addressText = hasStructuredAddress
    ? [
        streetAddress,
        suburb,
        city,
        [province, postalCode].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ")
    : legacyAddressBase || "No address provided.";
  const addressCopyText =
    [addressText, pudoBoxName ? `PUDO Box: ${pudoBoxName}` : ""]
      .filter(Boolean)
      .join(" | ") || "No address provided.";

  const selectClass =
    "w-full rounded-lg border border-brandGreen/30 bg-brandCream px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30";

  const handleCopy = async (value, label) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyNotice(`${label} copied.`);
    } catch (err) {
      console.warn("copy failed", err);
      setCopyNotice("Copy failed.");
    }
    setTimeout(() => setCopyNotice(""), 2000);
  };

  const handleStatusChange = async (value) => {
    setDraft((prev) => ({ ...prev, orderStatus: value }));
    try {
      const updates = { orderStatus: value };
      if (value === "completed") {
        updates.completedAt = serverTimestamp();
      }
      await onUpdate(updates);
    } catch (err) {
      console.error("order status update error", err);
    }
  };

  const handleDeliveryChange = async (value) => {
    setDraft((prev) => ({ ...prev, deliveryOptionId: value }));
    const selected = deliveryOptions.find((option) => option.id === value);
    if (!selected) return;
    try {
      await onUpdate({
        deliveryOptionId: value,
        deliveryOption: selected.label ?? "",
        deliveryCost: Number(selected.cost ?? 0),
      });
    } catch (err) {
      console.error("delivery update error", err);
    }
  };

  const handleSendDateChange = (value) => {
    setDraft((prev) => ({ ...prev, sendDate: value }));
    setSendDateMessage("");
  };

  const saveSendDate = async ({ showSuccessMessage = false } = {}) => {
    if (!draft.sendDate.trim()) {
      const currentValue = String(order.sendDate ?? "").trim();
      if (!currentValue) {
        if (showSuccessMessage) setSendDateMessage("Send date cleared.");
        return "";
      }
      try {
        await onUpdate({ sendDate: "" });
        if (showSuccessMessage) setSendDateMessage("Send date cleared.");
        return "";
      } catch (err) {
        console.error("send date update error", err);
        setSendDateMessage("Unable to save send date.");
        return null;
      }
    }

    const parsed = parseOrderDateInput(draft.sendDate);
    if (!parsed) {
      setSendDateMessage("Use DD/MM/YYYY or YYYY/MM/DD.");
      return null;
    }

    const normalizedIso = parsed.iso;
    const currentIso =
      parseOrderDateInput(order.sendDate)?.iso ??
      String(order.sendDate ?? "").trim();

    setDraft((prev) => ({ ...prev, sendDate: parsed.dayMonthYear }));
    if (currentIso === normalizedIso) {
      if (showSuccessMessage) setSendDateMessage("Send date saved.");
      return normalizedIso;
    }

    try {
      await onUpdate({ sendDate: normalizedIso });
      if (showSuccessMessage) setSendDateMessage("Send date saved.");
      return normalizedIso;
    } catch (err) {
      console.error("send date update error", err);
      setSendDateMessage("Unable to save send date.");
      return null;
    }
  };

  const handleSendDateBlur = async () => {
    await saveSendDate();
  };

  const handleInternalNoteSave = async () => {
    setInternalNoteSaving(true);
    setInternalNoteMessage("");
    try {
      await onUpdate({ internalNote: draft.internalNote });
      setInternalNoteMessage("Internal note saved.");
    } catch (err) {
      console.error("internal note update error", err);
      setInternalNoteMessage("Unable to save internal note.");
    } finally {
      setInternalNoteSaving(false);
    }
  };

  const handleTrackingSave = async () => {
    setTrackingSaving(true);
    setTrackingMessage("");
    try {
      await onUpdate({ trackingLink: draft.trackingLink.trim() });
      setTrackingMessage("Tracking link saved.");
    } catch (err) {
      console.error("tracking link update error", err);
      setTrackingMessage("Unable to save tracking link.");
    } finally {
      setTrackingSaving(false);
    }
  };

  const handleLineChange = (lineId, updates) => {
    setLineItems((prev) =>
      prev.map((line) =>
        line.lineId === lineId ? { ...line, ...updates } : line
      )
    );
  };

  const handleSelectItem = (lineId, value) => {
    const selected = normalizedItemOptions.find((item) => item.id === value);
    handleLineChange(lineId, {
      itemId: value,
      label: selected?.title ?? selected?.label ?? "",
      price: Number(selected?.price ?? 0),
      priceType: selected?.priceType ?? "normal",
    });
  };

  const handleAddLine = () => {
    const fallback = normalizedItemOptions[0];
    setLineItems((prev) => [
      ...prev,
      {
        lineId: createLineId(),
        itemId: fallback?.id ?? "",
        label: fallback?.title ?? fallback?.label ?? "",
        price: Number(fallback?.price ?? 0),
        priceType: fallback?.priceType ?? "normal",
        quantity: 0,
      },
    ]);
  };

  const handleRemoveLine = (lineId) => {
    setLineItems((prev) => prev.filter((line) => line.lineId !== lineId));
  };

  const handleUpdateLines = async () => {
    const nextEggs = lineItems
      .filter(
        (line) => Number(line.quantity ?? 0) > 0 && (line.itemId || line.label)
      )
      .map((line) => ({
        id: line.itemId,
        label: line.label,
        quantity: Number(line.quantity ?? 0),
        price: Number(line.price ?? 0),
        specialPrice: null,
        priceType: line.priceType ?? "normal",
      }));
    try {
      await onUpdate({ eggs: nextEggs });
    } catch (err) {
      console.error("egg breakdown update error", err);
    }
  };

  const handleAttachmentUpload = async (attachment, file) => {
    if (!file) return;
    setUploadingKey(attachment.key);
    try {
      const fileRef = storageRef(
        storage,
        `orders/${collectionName}/${order.id}/${attachment.key}_${Date.now()}_${
          file.name
        }`
      );
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      await onUpdate({
        [attachment.urlField]: url,
        [attachment.nameField]: file.name,
      });
    } catch (err) {
      console.error("attachment upload error", err);
    } finally {
      setUploadingKey("");
    }
  };

  const handleGenerateInvoice = async () => {
    setInvoiceGenerating(true);
    setInvoiceMessage("");
    try {
      const invoiceNumber = buildInvoiceNumber(order);
      const invoiceDateLabel = new Date().toLocaleDateString();
      const deliveryLabel = order.deliveryOption ?? "";
      const sendDateLabel = formatOrderDateDisplay(order.sendDate);
      const pdfBlob = await generateInvoicePdf({
        order,
        collectionName,
        eggsTotal,
        deliveryCost,
        totalCost,
        orderFullName,
        addressText: addressCopyText,
        invoiceNumber,
        invoiceDateLabel,
        deliveryLabel,
        sendDateLabel,
      });

      const safeInvoiceNumber = invoiceNumber.replace(/[^A-Za-z0-9_-]/g, "");
      const fileName = `Invoice_${safeInvoiceNumber}.pdf`;
      const fileRef = storageRef(
        storage,
        `orders/${collectionName}/${order.id}/invoice_${Date.now()}_${fileName}`
      );
      await uploadBytes(fileRef, pdfBlob, { contentType: "application/pdf" });
      const url = await getDownloadURL(fileRef);
      await onUpdate({
        invoiceUrl: url,
        invoiceFileName: fileName,
        invoiceNumber,
        invoiceCreatedAt: serverTimestamp(),
      });
      setInvoiceMessage("Invoice generated.");
    } catch (err) {
      console.error("invoice generation error", err);
      setInvoiceMessage("Unable to generate invoice.");
    } finally {
      setInvoiceGenerating(false);
    }
  };

  const handleSendInvoiceEmail = async () => {
    if (!order.invoiceUrl) {
      setInvoiceMessage("Generate an invoice first.");
      return;
    }
    setInvoiceEmailSending(true);
    setInvoiceMessage("");
    try {
      const callable = httpsCallable(functions, "sendInvoiceEmail");
      await callable({ collectionName, orderId: order.id });
      setInvoiceMessage("Invoice email sent.");
    } catch (err) {
      console.error("send invoice email error", err);
      setInvoiceMessage("Unable to send invoice email.");
    } finally {
      setInvoiceEmailSending(false);
    }
  };

  const handleShareInvoice = () => {
    if (!order.invoiceUrl) return;
    const label = order.invoiceNumber || order.orderNumber || "invoice";
    const message = `Here is your ${label} from ${INVOICE_BRAND.name}: ${order.invoiceUrl}`;
    const link = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(link, "_blank", "noopener,noreferrer");
  };

  const handleDispatchEmail = async () => {
    const normalizedSendDate = await saveSendDate({ showSuccessMessage: true });
    if (normalizedSendDate === null) return;
    setDispatchSending(true);
    setDispatchMessage("");
    try {
      await onSendDispatchEmail(order);
      setDispatchMessage("Dispatch email sent.");
    } catch (err) {
      setDispatchMessage("Unable to send dispatch email.");
    } finally {
      setDispatchSending(false);
    }
  };

  const canSendDispatch = Boolean(order.email);
  const allowEggSubstitutions =
    !isLivestock &&
    (order.allowEggSubstitutions ?? order.allowSubstitutions) !== false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/70">
              Order details
            </p>
            <h3 className="text-2xl font-bold text-brandGreen">
              {orderFullName || "Customer"}
            </h3>
            <p className="text-sm font-mono text-brandGreen">
              {order.orderNumber || "-"}
            </p>
            <p className="text-brandGreen/70">{contactLine || "-"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPaidToggle(order)}
              className="rounded-full border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              {order.paid ? "Mark unpaid" : "Mark paid"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-brandGreen px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Close
            </button>
          </div>
        </div>

        {copyNotice ? (
          <p className="mt-2 text-xs font-semibold text-brandGreen/70">
            {copyNotice}
          </p>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Status
            </p>
            <select
              value={draft.orderStatus}
              onChange={(event) => handleStatusChange(event.target.value)}
              className={selectClass}
            >
              {ORDER_STATUSES.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                Tracking link (optional)
              </label>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <input
                  type="url"
                  value={draft.trackingLink}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      trackingLink: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen placeholder:text-brandGreen/50 focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                  placeholder="https://..."
                />
                <button
                  type="button"
                  onClick={handleTrackingSave}
                  disabled={trackingSaving}
                  className="rounded-full bg-brandGreen px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {trackingSaving ? "Saving..." : "Save"}
                </button>
              </div>
              {trackingMessage ? (
                <p className="text-xs font-semibold text-brandGreen/70">
                  {trackingMessage}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2 text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Totals
            </p>
            <div className="space-y-1 text-sm text-brandGreen">
              <p>
                Subtotal:{" "}
                <span className="font-semibold">
                  {formatCurrency(eggsTotal)}
                </span>
              </p>
              <p>
                Delivery:{" "}
                <span className="font-semibold">
                  {formatCurrency(deliveryCost)}
                </span>
              </p>
              <p className="text-lg font-bold text-brandGreen">
                Total: {formatCurrency(totalCost)}
              </p>
            </div>
            <p className="text-sm text-brandGreen">
              Paid: {order.paid ? "Yes" : "No"}
            </p>
            <p className="text-sm text-brandGreen">
              Delivery: {order.deliveryOption ?? "-"}
            </p>
            <p className="text-sm text-brandGreen">
              Send date: {formatOrderDateDisplay(order.sendDate)}
            </p>
            {!isLivestock ? (
              <p className="text-sm text-brandGreen">
                Swap by value:{" "}
                <span className="font-semibold">
                  {allowEggSubstitutions
                    ? "Accepted"
                    : "Exact selected eggs only"}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                Delivery address
              </p>
              <button
                type="button"
                aria-label="Copy address"
                onClick={() => handleCopy(addressCopyText, "Address")}
                className="rounded-full border border-brandGreen/30 px-2 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                Copy
              </button>
            </div>
            <div className="rounded-xl border border-brandGreen/15 bg-brandBeige/40 p-3">
              {addressLines.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {addressLines.map((line) => (
                    <div key={line.label} className="space-y-0.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-brandGreen/60">
                        {line.label}
                      </p>
                      <p className="text-sm font-medium text-brandGreen">
                        {line.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-brandGreen whitespace-pre-line break-words">
                  {addressText}
                </p>
              )}
              {pudoBoxName ? (
                <div className="mt-2 rounded-lg border border-brandGreen/15 bg-white/70 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-brandGreen/60">
                    PUDO box
                  </p>
                  <p className="text-sm font-semibold text-brandGreen">
                    {pudoBoxName}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Contact
            </p>
            <div className="space-y-1 text-brandGreen">
              <div className="flex items-center gap-2">
                <span className="font-semibold">
                  {orderFullName || "Customer"}
                </span>
                <button
                  type="button"
                  aria-label="Copy name"
                  onClick={() => handleCopy(orderFullName, "Name")}
                  className="rounded-full border border-brandGreen/30 px-2 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                >
                  Copy
                </button>
              </div>
              {order.email ? (
                <div className="flex items-center gap-2">
                  <a className="underline" href={`mailto:${order.email}`}>
                    {order.email}
                  </a>
                  <button
                    type="button"
                    aria-label="Copy email"
                    onClick={() => handleCopy(order.email, "Email")}
                    className="rounded-full border border-brandGreen/30 px-2 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                  >
                    Copy
                  </button>
                </div>
              ) : null}
              {order.cellphone ? (
                <div className="flex items-center gap-2">
                  <a className="underline" href={`tel:${order.cellphone}`}>
                    {order.cellphone}
                  </a>
                  <button
                    type="button"
                    aria-label="Copy phone"
                    onClick={() => handleCopy(order.cellphone, "Phone")}
                    className="rounded-full border border-brandGreen/30 px-2 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                  >
                    Copy
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            Bookkeeping attachments (optional)
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {ORDER_ATTACHMENTS.map((attachment) => {
              const attachmentUrl = order[attachment.urlField];
              const attachmentName = order[attachment.nameField];
              const isUploading = uploadingKey === attachment.key;
              return (
                <div
                  key={attachment.key}
                  className="rounded-2xl border border-brandGreen/10 bg-brandBeige/40 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                        {attachment.label}
                      </p>
                      {attachmentUrl ? (
                        <a
                          className="text-sm text-brandGreen underline decoration-brandGreen/40 underline-offset-4"
                          href={attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {attachmentName || "View file"}
                        </a>
                      ) : (
                        <p className="text-sm text-brandGreen/70">
                          Not uploaded yet.
                        </p>
                      )}
                    </div>
                    <label
                      className={`inline-flex items-center gap-2 rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige ${
                        isUploading
                          ? "cursor-not-allowed opacity-60"
                          : "cursor-pointer"
                      }`}
                    >
                      <input
                        className="sr-only"
                        accept="application/pdf,image/*"
                        type="file"
                        disabled={isUploading}
                        onChange={(event) =>
                          handleAttachmentUpload(
                            attachment,
                            event.target.files?.[0]
                          )
                        }
                      />
                      {isUploading ? "Uploading..." : "Upload file"}
                    </label>
                  </div>
                  <p className="text-xs text-brandGreen/60">
                    {attachment.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 space-y-2 rounded-2xl border border-brandGreen/10 bg-white/70 p-4 shadow-inner">
          <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            Invoice
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleGenerateInvoice}
              disabled={invoiceGenerating}
              className="rounded-full bg-brandGreen px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
            >
              {invoiceGenerating
                ? "Generating..."
                : order.invoiceUrl
                ? "Regenerate invoice"
                : "Generate invoice"}
            </button>
            {order.invoiceUrl ? (
              <>
                <a
                  href={order.invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-brandGreen/30 px-4 py-2 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                >
                  Download invoice
                </a>
                <button
                  type="button"
                  onClick={handleSendInvoiceEmail}
                  disabled={invoiceEmailSending}
                  className="rounded-full border border-brandGreen/30 px-4 py-2 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {invoiceEmailSending ? "Sending..." : "Email invoice"}
                </button>
                <button
                  type="button"
                  onClick={handleShareInvoice}
                  className="rounded-full border border-brandGreen/30 px-4 py-2 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
                >
                  Share on WhatsApp
                </button>
              </>
            ) : null}
          </div>
          {invoiceMessage ? (
            <p className="text-xs font-semibold text-brandGreen/70">
              {invoiceMessage}
            </p>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Delivery option
            </p>
            <select
              className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
              value={draft.deliveryOptionId}
              onChange={(event) => handleDeliveryChange(event.target.value)}
            >
              <option value="">Select delivery</option>
              {deliveryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} ({formatCurrency(option.cost)})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
              Send date
            </p>
            <div className="space-y-2">
              <input
                className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/YYYY or YYYY/MM/DD"
                value={draft.sendDate}
                onChange={(event) => handleSendDateChange(event.target.value)}
                onBlur={handleSendDateBlur}
              />
              <p className="text-xs text-brandGreen/70">
                Use DD/MM/YYYY or YYYY/MM/DD.
              </p>
              {sendDateMessage ? (
                <p
                  className={`text-xs font-semibold ${
                    sendDateMessage.includes("saved")
                      ? "text-brandGreen/70"
                      : "text-red-700"
                  }`}
                >
                  {sendDateMessage}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDispatchEmail}
                  disabled={!canSendDispatch || dispatchSending}
                  className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {dispatchSending ? "Sending..." : "Send dispatch email"}
                </button>
                {dispatchMessage ? (
                  <span className="text-xs font-semibold text-brandGreen/70">
                    {dispatchMessage}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            Notes / comments
          </p>
          <textarea
            className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
            value={draft.notes}
            readOnly
            rows={3}
          />
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            Internal note (not emailed to customer)
          </p>
          <textarea
            placeholder="Add private admin notes. This saves to the order but does not send an email."
            className="w-full rounded-lg border border-brandGreen/30 bg-brandBeige/40 px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
            value={draft.internalNote}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                internalNote: event.target.value,
              }))
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-brandGreen/70">
              {internalNoteMessage}
            </span>
            <button
              type="button"
              onClick={handleInternalNoteSave}
              disabled={internalNoteSaving}
              className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
            >
              {internalNoteSaving ? "Saving..." : "Save internal note"}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            {breakdownTitle}
          </p>
          <div className="space-y-2">
            {lineItems.map((line) => {
              const optionExists = normalizedItemOptions.some(
                (item) => item.id === line.itemId
              );
              return (
                <div
                  key={line.lineId}
                  className="flex flex-col gap-2 rounded-lg border border-brandGreen/15 bg-brandBeige/40 p-3 md:flex-row md:items-center"
                >
                  <select
                    className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30"
                    value={line.itemId}
                    onChange={(event) =>
                      handleSelectItem(line.lineId, event.target.value)
                    }
                  >
                    <option value="">{`Select ${itemLabelSingular}`}</option>
                    {normalizedItemOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title ?? option.label}
                      </option>
                    ))}
                    {!optionExists && line.itemId ? (
                      <option value={line.itemId}>
                        {line.label || "Unknown"}
                      </option>
                    ) : null}
                  </select>
                  <input
                    placeholder="Qty"
                    className="w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 md:w-32"
                    type="number"
                    value={line.quantity}
                    onChange={(event) =>
                      handleLineChange(line.lineId, {
                        quantity:
                          event.target.value === ""
                            ? ""
                            : Number(event.target.value),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveLine(line.lineId)}
                    className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <div className="flex justify-between">
              <button
                type="button"
                onClick={handleAddLine}
                className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen transition hover:bg-brandBeige"
              >
                {`Add ${itemLabelSingular} line`}
              </button>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleUpdateLines}
                  className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
          >
            Delete order
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onPaidToggle(order)}
              className="rounded-full border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              {order.paid ? "Mark unpaid" : "Mark paid"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
