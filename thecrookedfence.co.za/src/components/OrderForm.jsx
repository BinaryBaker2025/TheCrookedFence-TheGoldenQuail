import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions as cloudFunctions } from "../lib/firebase.js";
import {
  COUNTRY_CODES,
  DEFAULT_FORM_DELIVERY_OPTIONS,
  DEFAULT_LIVESTOCK_DELIVERY_OPTIONS,
  UNCATEGORIZED_LABEL,
} from "../data/defaults.js";
import { normalizeTypeDoc } from "../lib/typeCatalog.js";
import { useNetworkStatus } from "../hooks/useNetworkStatus.js";
import { useSubmissionQueue } from "../hooks/useSubmissionQueue.js";
import { Banner, Button, Dialog, ErrorMessage } from "./ui/index.js";
import { logError, logEvent } from "../lib/telemetry.js";

const cardClass =
  "bg-brandBeige shadow-lg rounded-2xl border border-brandGreen/10";
const inputClass =
  "w-full rounded-lg border border-brandGreen/20 bg-white/70 px-4 py-3 text-brandGreen placeholder:text-brandGreen/50 focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30";
const SA_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "Northern Cape",
  "North West",
  "Western Cape",
];
const indemnityText =
  "NO REFUNDS. We take great care in packaging all eggs to ensure they are shipped as safely as possible. However, once eggs leave our care, we cannot be held responsible for damage that may occur during transit, including cracked eggs. Hatch rates cannot be guaranteed. There are many factors beyond our control—such as handling during shipping, incubation conditions, and environmental variables—that may affect development. As eggs are considered livestock, purchasing hatching eggs involves an inherent risk that the buyer accepts at the time of purchase.\n\nAvailability Notice: Some eggs are subject to a 3–6 week waiting period and may not be available for immediate shipment. By placing an order, the buyer acknowledges and accepts this potential delay.\n\nExtra Eggs Disclaimer: Extra eggs are never guaranteed. While we may occasionally include additional eggs when available, this is done at our discretion and should not be expected or assumed as part of any order.";
const indemnityAcceptanceText = "I have read and accept the indemnity terms.";
const eggRestNoticeText =
  "Important: Hatching eggs must rest for at least 24 hours at room temperature before incubation.";

const createClientKey = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const createDefaultForm = (isLivestock) => ({
  name: "",
  surname: "",
  email: "",
  whatsapp: "",
  whatsappMatchesCellphone: true,
  countryCode: "+27",
  cellphone: "",
  streetAddress: "",
  suburb: "",
  city: "",
  province: "",
  postalCode: "",
  pudoBoxName: "",
  deliveryOption: isLivestock
    ? DEFAULT_LIVESTOCK_DELIVERY_OPTIONS[0].id
    : DEFAULT_FORM_DELIVERY_OPTIONS[0].id,
  otherDelivery: "",
  sendDate: "",
  notes: "",
  allowEggSubstitutions: isLivestock ? false : true,
});

const toQuantityMap = (items, existing = {}) => {
  const map = {};
  items.forEach((item) => {
    const isAvailable = item.available !== false;
    map[item.id] = isAvailable ? existing[item.id] ?? 0 : 0;
  });
  return map;
};

const normalizePhoneDigits = (value) => value.replace(/[^\d]/g, "");

const isValidCellphone = (value) => {
  const digits = normalizePhoneDigits(value);
  if (digits.length === 9) return true;
  if (digits.length === 10) return digits.startsWith("0");
  return false;
};

const isValidWhatsapp = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return true;
  const compact = trimmed.replace(/[\s()-]/g, "");
  const digits = normalizePhoneDigits(compact);
  if (compact.startsWith("+")) {
    return digits.length >= 9 && digits.length <= 15;
  }
  return digits.length >= 9 && digits.length <= 15;
};

const formatTwoDigits = (value) => String(value).padStart(2, "0");

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
  const normalized = trimmed.replace(/\./g, "/");
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

const CARD_INTERACTIVE_SELECTOR =
  "a,button,input,select,textarea,label,[role='button'],[data-no-card-nav='true']";

const formatPriceAmount = (value) => `R${Number(value ?? 0).toFixed(2)}`;

const isSpecialPriceType = (item) => item?.priceType === "special";

const shouldSkipCardNavigation = (target) =>
  target instanceof Element &&
  Boolean(target.closest(CARD_INTERACTIVE_SELECTOR));

const VALIDATION_ORDER = [
  "sendDate",
  "items",
  "name",
  "surname",
  "email",
  "whatsapp",
  "countryCode",
  "cellphone",
  "streetAddress",
  "city",
  "province",
  "postalCode",
  "deliveryOption",
  "otherDelivery",
  "indemnity",
];

export default function OrderForm({ variant = "eggs" }) {
  const isLivestock = variant === "livestock";
  const pageTitle = isLivestock
    ? "Livestock Order Form"
    : "Fertile Egg Order Form";
  const itemTitle = isLivestock
    ? "Livestock type & quantities"
    : "Egg types & quantities";
  const itemLabel = isLivestock ? "livestock type" : "egg type";
  const dateLabel = isLivestock
    ? "Preferred delivery/need-by date (optional)"
    : "Send date (optional)";
  const dateFormatHint = "Open the calendar and choose the date.";
  const dateHelper = isLivestock
    ? `Optional. Enter your preferred delivery or need-by date. ${dateFormatHint}`
    : `Optional. ${dateFormatHint}`;
  const typeDetailBase = isLivestock ? "/livestock" : "/eggs";
  const navigate = useNavigate();

  const initialItems = [];
  const { isOnline, statusLabel } = useNetworkStatus();
  const { isRetrying, runWithRetry } = useSubmissionQueue();
  const createPublicOrderCallable = useMemo(
    () => httpsCallable(cloudFunctions, "createPublicOrder"),
    []
  );

  const [items, setItems] = useState(initialItems);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(() => createDefaultForm(isLivestock));
  const [deliveryOptions, setDeliveryOptions] = useState(
    isLivestock
      ? DEFAULT_LIVESTOCK_DELIVERY_OPTIONS
      : DEFAULT_FORM_DELIVERY_OPTIONS
  );
  const [quantities, setQuantities] = useState(() => toQuantityMap(initialItems));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [queuedPayload, setQueuedPayload] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState(null);
  const [modalTitle, setModalTitle] = useState("Order placed");
  const [modalMessage, setModalMessage] = useState("");
  const [modalNote, setModalNote] = useState("");
  const [indemnityAccepted, setIndemnityAccepted] = useState(true);
  const [idempotencyKey, setIdempotencyKey] = useState(() => createClientKey());
  const [fieldErrors, setFieldErrors] = useState({});
  const fieldRefs = useRef({});
  const sendDatePickerRef = useRef(null);

  useEffect(() => {
    const ref = collection(db, isLivestock ? "livestockTypes" : "eggTypes");
    const typesQuery = query(ref, orderBy("order", "asc"));
    const unsubscribe = onSnapshot(
      typesQuery,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) =>
          normalizeTypeDoc(docSnap.id, docSnap.data())
        );
        setItems(data);
        setQuantities((prev) => toQuantityMap(data, prev));
      },
      (err) => {
        console.error("type load error", err);
        setItems([]);
        setQuantities({});
      }
    );

    return () => unsubscribe();
  }, [isLivestock]);

  useEffect(() => {
    const ref = collection(
      db,
      isLivestock ? "livestockCategories" : "eggCategories"
    );
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => {
          const docData = docSnap.data();
          const rawOrder = docData.order;
          return {
            id: docSnap.id,
            name: docData.name ?? "",
            description: docData.description ?? "",
            order:
              rawOrder === null || rawOrder === undefined ? null : Number(rawOrder),
          };
        });
        const sorted = data
          .slice()
          .sort((a, b) => {
            const aOrder = Number.isFinite(a.order)
              ? a.order
              : Number.POSITIVE_INFINITY;
            const bOrder = Number.isFinite(b.order)
              ? b.order
              : Number.POSITIVE_INFINITY;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.name.localeCompare(b.name);
          });
        setCategories(sorted);
      },
      (err) => {
        console.error("categories load error", err);
        setCategories([]);
      }
    );

    return () => unsubscribe();
  }, [isLivestock]);

  useEffect(() => {
    const ref = collection(
      db,
      isLivestock ? "livestockDeliveryOptions" : "deliveryOptions"
    );
    const deliveryQuery = query(ref, orderBy("order", "asc"));
    const fallback = isLivestock
      ? DEFAULT_LIVESTOCK_DELIVERY_OPTIONS
      : DEFAULT_FORM_DELIVERY_OPTIONS;
    const unsubscribe = onSnapshot(
      deliveryQuery,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => {
          const docData = docSnap.data();
          return {
            id: docSnap.id,
            label: docData.label ?? "Delivery",
            cost: Number(docData.cost ?? 0),
            order: docData.order ?? 0,
          };
        });
        const merged = data.length > 0 ? data : fallback;
        setDeliveryOptions(merged);
        if (!merged.find((option) => option.id === form.deliveryOption)) {
          setForm((prev) => ({ ...prev, deliveryOption: merged[0]?.id ?? "" }));
        }
      },
      (err) => {
        console.error("deliveryOptions load error", err);
        setDeliveryOptions(fallback);
      }
    );

    return () => unsubscribe();
  }, [form.deliveryOption, isLivestock]);

  const selectedItems = useMemo(
    () =>
      items.filter(
        (item) => item.available !== false && (quantities[item.id] ?? 0) > 0
      ),
    [items, quantities]
  );

  const subtotal = useMemo(
    () =>
      selectedItems.reduce((sum, item) => {
        const unitPrice = item.price ?? 0;
        const qty = quantities[item.id] ?? 0;
        return sum + unitPrice * qty;
      }, 0),
    [selectedItems, quantities]
  );

  const itemBreakdown = useMemo(
    () =>
      selectedItems.map((item) => {
        const unitPrice = item.price ?? 0;
        const qty = quantities[item.id] ?? 0;
        return {
          id: item.id,
          label: item.title ?? item.label,
          qty,
          unitPrice,
          lineTotal: unitPrice * qty,
        };
      }),
    [selectedItems, quantities]
  );

  const deliveryCost = useMemo(() => {
    const option = deliveryOptions.find(
      (opt) => opt.id === form.deliveryOption
    );
    return option ? option.cost : 0;
  }, [deliveryOptions, form.deliveryOption]);

  const selectedDeliveryOption = useMemo(
    () => deliveryOptions.find((opt) => opt.id === form.deliveryOption) ?? null,
    [deliveryOptions, form.deliveryOption]
  );

  const isPudoDelivery = Boolean(
    selectedDeliveryOption &&
      `${selectedDeliveryOption.id} ${selectedDeliveryOption.label}`
        .toLowerCase()
        .includes("pudo")
  );

  const total = subtotal + deliveryCost;

  const setField = (field, value) => {
    const shouldClearContactErrors =
      field === "email" ||
      field === "whatsapp" ||
      field === "whatsappMatchesCellphone" ||
      (form.whatsappMatchesCellphone &&
        (field === "cellphone" || field === "countryCode"));

    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      if (
        !prev[field] &&
        !(field === "deliveryOption" && prev.otherDelivery && value !== "other") &&
        !(field === "email" && prev.whatsapp) &&
        !(field === "whatsapp" && prev.email) &&
        !shouldClearContactErrors
      ) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      if (field === "deliveryOption" && value !== "other") {
        delete next.otherDelivery;
      }
      if (shouldClearContactErrors) {
        delete next.email;
        delete next.whatsapp;
      }
      return next;
    });
  };

  const clearFieldError = (field) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const formatCellphone = () => {
    const countryDigits = form.countryCode.replace(/[^\d]/g, "");
    const localDigits = normalizePhoneDigits(form.cellphone);
    if (!localDigits) return "";
    const prefix = countryDigits ? `+${countryDigits}` : "";
    return [prefix, localDigits].filter(Boolean).join(" ").trim();
  };

  const getWhatsappNumber = (cellphone = formatCellphone()) =>
    form.whatsappMatchesCellphone ? cellphone : form.whatsapp.trim();

  const buildValidationMessage = (errors, firstInvalidField) => {
    if (!firstInvalidField) return "Please fill in all required fields.";
    if (firstInvalidField === "sendDate") {
      return "Please choose a valid send date from the calendar.";
    }
    if (firstInvalidField === "items") {
      return `Please order at least one ${itemLabel} (quantities above 0).`;
    }
    if (firstInvalidField === "otherDelivery") {
      return "Please specify your other delivery option.";
    }
    if (firstInvalidField === "cellphone" && errors.cellphone === "invalid") {
      return "Cellphone number must be 9 digits, or 10 digits starting with 0.";
    }
    if (
      (firstInvalidField === "email" || firstInvalidField === "whatsapp") &&
      errors.email === "requiredEither" &&
      errors.whatsapp === "requiredEither"
    ) {
      return "Please provide either an email address or a WhatsApp number.";
    }
    if (firstInvalidField === "whatsapp" && errors.whatsapp === "invalid") {
      return "WhatsApp number looks invalid. Please include at least 9 digits.";
    }
    if (firstInvalidField === "indemnity") {
      return "Please accept the indemnity terms to continue.";
    }
    return "Please fill in all required fields.";
  };

  const validate = () => {
    const nextErrors = {};
    const email = form.email.trim();
    const whatsapp = getWhatsappNumber();
    const sendDateInput = form.sendDate.trim();
    const parsedSendDate = parseOrderDateInput(sendDateInput);
    if (
      !form.name.trim() ||
      !form.surname.trim() ||
      !form.countryCode.trim() ||
      !form.cellphone.trim() ||
      !form.streetAddress.trim() ||
      !form.city.trim() ||
      !form.province.trim() ||
      !form.postalCode.trim() ||
      !form.deliveryOption
    ) {
      if (!form.name.trim()) nextErrors.name = "required";
      if (!form.surname.trim()) nextErrors.surname = "required";
      if (!form.countryCode.trim()) nextErrors.countryCode = "required";
      if (!form.cellphone.trim()) nextErrors.cellphone = "required";
      if (!form.streetAddress.trim()) nextErrors.streetAddress = "required";
      if (!form.city.trim()) nextErrors.city = "required";
      if (!form.province.trim()) nextErrors.province = "required";
      if (!form.postalCode.trim()) nextErrors.postalCode = "required";
      if (!form.deliveryOption) nextErrors.deliveryOption = "required";
    }
    if (!form.whatsappMatchesCellphone && !email && !whatsapp) {
      nextErrors.email = "requiredEither";
      nextErrors.whatsapp = "requiredEither";
    }
    if (form.deliveryOption === "other" && !form.otherDelivery.trim()) {
      nextErrors.otherDelivery = "required";
    }
    if (sendDateInput && !parsedSendDate) {
      nextErrors.sendDate = "invalid";
    }
    if (form.cellphone.trim() && !isValidCellphone(form.cellphone)) {
      nextErrors.cellphone = "invalid";
    }
    if (!form.whatsappMatchesCellphone && whatsapp && !isValidWhatsapp(whatsapp)) {
      nextErrors.whatsapp = "invalid";
    }
    if (selectedItems.length === 0) {
      nextErrors.items = "required";
    }
    if (!indemnityAccepted) {
      nextErrors.indemnity = "required";
    }
    if (Object.keys(nextErrors).length === 0) {
      return { message: "", errors: {}, firstInvalidField: "" };
    }
    const firstInvalidField =
      VALIDATION_ORDER.find((key) => nextErrors[key]) ??
      Object.keys(nextErrors)[0];
    const message = buildValidationMessage(nextErrors, firstInvalidField);
    return { message, errors: nextErrors, firstInvalidField };
  };

  const scrollToField = (field) => {
    const element = fieldRefs.current[field];
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof element.focus === "function") {
      element.focus({ preventScroll: true });
    }
  };

  const showGroupedItems = isLivestock || categories.length > 0;

  const groupedItems = useMemo(() => {
    if (!showGroupedItems) return [];
    const categoryMap = new Map();
    const categoryIds = categories.map((cat) => cat.id);
    const categoryDescriptionMap = new Map(
      categories.map((cat) => [
        cat.name.trim().toLowerCase(),
        cat.description ?? "",
      ])
    );
    const fallbackLabel = isLivestock ? "Category" : UNCATEGORIZED_LABEL;

    items.forEach((item) => {
      const fallbackName = item.categoryName?.trim().length
        ? item.categoryName
        : fallbackLabel;
      const key = item.categoryId || `name:${fallbackName}`;
      const category = categories.find((cat) => cat.id === item.categoryId);
      const label = category?.name ?? fallbackName;
      const description =
        category?.description ??
        categoryDescriptionMap.get(fallbackName.trim().toLowerCase()) ??
        "";

      if (!categoryMap.has(key)) {
        categoryMap.set(key, { label, items: [], description });
      }
      categoryMap.get(key).items.push(item);
    });

    const orderedKeys = [
      ...categoryIds.filter((id) => categoryMap.has(id)),
      ...Array.from(categoryMap.keys()).filter(
        (id) => !categoryIds.includes(id)
      ),
    ];

    return orderedKeys.map((id) => ({ id, ...categoryMap.get(id) }));
  }, [categories, isLivestock, items, showGroupedItems]);

  const eagerThumbnailIds = useMemo(
    () => new Set(items.slice(0, 4).map((item) => item.id)),
    [items]
  );

  const listingHelperText = "Tap any item for details.";
  const categoryHelperText = "Tap any item for details.";

  const updateItemQuantity = (itemId, value) => {
    const nextValue = Math.max(0, Number(value));
    const hasAny =
      nextValue > 0 ||
      Object.entries(quantities).some(([id, qty]) => id !== itemId && qty > 0);
    if (hasAny) {
      clearFieldError("items");
    }
    setQuantities((prev) => ({
      ...prev,
      [itemId]: nextValue,
    }));
  };

  const handleCardNavigation = (itemId, event) => {
    if (shouldSkipCardNavigation(event.target)) {
      return;
    }
    navigate(`${typeDetailBase}/${itemId}`);
  };

  const handleCardKeyDown = (itemId, event) => {
    if (shouldSkipCardNavigation(event.target)) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    navigate(`${typeDetailBase}/${itemId}`);
  };

  const renderTypeCard = (item) => {
    const isAvailable = item.available !== false;
    const title = item.title ?? item.label;
    const hasSpecialPrice = isSpecialPriceType(item);
    const quantityInputId = `qty_${item.id}`;
    const quantity = Number(quantities[item.id] ?? 0);
    const isPriorityThumbnail = eagerThumbnailIds.has(item.id);

    return (
      <div
        key={item.id}
        role="link"
        tabIndex={0}
        aria-label={`View details for ${title}`}
        onClick={(event) => handleCardNavigation(item.id, event)}
        onKeyDown={(event) => handleCardKeyDown(item.id, event)}
        className={`cursor-pointer rounded-2xl border bg-brandBeige/35 p-2.5 shadow-sm transition hover:border-[#2C5F2D]/30 hover:bg-brandBeige/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C5F2D]/35 sm:p-3 ${
          isAvailable ? "border-brandGreen/15" : "border-brandGreen/10"
        }`}
      >
        <div className="flex items-start gap-2.5 max-[600px]:flex-col max-[600px]:items-stretch">
          <div className="flex w-full items-start justify-between gap-2.5 min-[601px]:contents">
            <div className="h-[58px] w-[58px] flex-shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-brandCream via-white to-brandBeige/50 min-[601px]:order-1 sm:h-[74px] sm:w-[74px]">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={title}
                  className="h-full w-full object-cover"
                  loading={isPriorityThumbnail ? "eager" : "lazy"}
                  fetchpriority={isPriorityThumbnail ? "high" : "auto"}
                  decoding="async"
                />
              ) : null}
            </div>

            <div
              data-no-card-nav="true"
              className="mt-0.5 flex flex-shrink-0 items-center gap-2 min-[601px]:order-3"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <label
                htmlFor={quantityInputId}
                className="text-xs font-semibold text-brandGreen/75"
              >
                Qty
              </label>
              <div className="relative w-20 sm:w-24">
                <input
                  id={quantityInputId}
                  type="number"
                  min={0}
                  disabled={!isAvailable}
                  className={`qty-stepper-input h-10 w-full rounded-md border pl-2 pr-6 text-center text-sm font-semibold text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 sm:h-11 ${
                    isAvailable
                      ? "border-brandGreen/20 bg-white/75"
                      : "border-brandGreen/15 bg-gray-100 text-brandGreen/50"
                  }`}
                  value={quantity}
                  onChange={(event) =>
                    updateItemQuantity(item.id, event.target.value)
                  }
                />
                <div
                  className={`absolute right-0 top-0 flex h-full w-5 flex-col overflow-hidden rounded-r-md border-l ${
                    isAvailable
                      ? "border-brandGreen/20"
                      : "border-brandGreen/15 bg-gray-100"
                  }`}
                >
                  <button
                    type="button"
                    disabled={!isAvailable}
                    data-no-card-nav="true"
                    className="flex h-1/2 items-center justify-center text-[9px] leading-none text-brandGreen transition hover:bg-brandBeige/40 disabled:cursor-not-allowed disabled:text-brandGreen/40"
                    aria-label={`Increase quantity for ${title}`}
                    onClick={() => updateItemQuantity(item.id, quantity + 1)}
                  >
                    <span aria-hidden="true">&#9650;</span>
                  </button>
                  <button
                    type="button"
                    disabled={!isAvailable || quantity <= 0}
                    data-no-card-nav="true"
                    className="flex h-1/2 items-center justify-center border-t border-brandGreen/20 text-[9px] leading-none text-brandGreen transition hover:bg-brandBeige/40 disabled:cursor-not-allowed disabled:text-brandGreen/40"
                    aria-label={`Decrease quantity for ${title}`}
                    onClick={() =>
                      updateItemQuantity(item.id, Math.max(0, quantity - 1))
                    }
                  >
                    <span aria-hidden="true">&#9660;</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 min-[601px]:order-2">
            <Link
              to={`${typeDetailBase}/${item.id}`}
              data-no-card-nav="true"
              className="inline-block max-w-full text-[15px] font-semibold leading-[1.25] text-[#2C5F2D] underline-offset-2 transition hover:underline sm:text-base"
            >
              <span className="whitespace-normal break-words">{title}</span>
            </Link>
            <p className="mt-0.5 text-xs font-semibold text-brandGreen sm:text-sm">
              {formatPriceAmount(item.price)}
              {hasSpecialPrice ? " (Special)" : ""}
            </p>
            <Link
              to={`${typeDetailBase}/${item.id}`}
              data-no-card-nav="true"
              className="mt-0.5 inline-block text-[11px] text-brandGreen/70 underline-offset-2 transition hover:text-[#2C5F2D] hover:underline sm:text-xs"
            >
              View details
            </Link>
            {!isAvailable ? (
              <p className="mt-0.5 text-[11px] font-semibold text-brandGreen/65 sm:text-xs">
                Unavailable for ordering
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const buildClientMeta = () => ({
    appVersion: String(import.meta.env.VITE_APP_VERSION || "web").slice(0, 50),
    timezone:
      Intl.DateTimeFormat?.().resolvedOptions?.().timeZone?.slice(0, 80) || "",
    locale:
      typeof navigator !== "undefined"
        ? String(navigator.language || "").slice(0, 30)
        : "",
    onlineStatus: isOnline ? "online" : "offline",
  });

  const handleSendDateChange = (event) => {
    const parsed = parseOrderDateInput(event.target.value);
    if (parsed) {
      setField("sendDate", parsed.dayMonthYear);
      return;
    }
    setField("sendDate", "");
  };

  const openSendDatePicker = () => {
    const picker = sendDatePickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
    }
  };

  const handleSendDateKeyDown = (event) => {
    if (event.key === "Tab") return;
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      openSendDatePicker();
      return;
    }
    event.preventDefault();
  };

  const buildSubmissionPayload = () => {
    const parsedSendDate = parseOrderDateInput(form.sendDate);
    if (form.sendDate.trim() && !parsedSendDate) {
      throw new Error("Invalid send date");
    }

    const selectedDelivery = selectedDeliveryOption;
    const email = form.email.trim();
    const cellphone = formatCellphone();
    const whatsapp = getWhatsappNumber(cellphone);
    return {
      formType: variant,
      idempotencyKey,
      submittedAtClient: new Date().toISOString(),
      contact: {
        name: form.name.trim(),
        surname: form.surname.trim(),
        email,
        whatsapp,
        cellphone,
      },
      address: {
        streetAddress: form.streetAddress.trim(),
        suburb: form.suburb.trim(),
        city: form.city.trim(),
        province: form.province.trim(),
        postalCode: form.postalCode.trim(),
        pudoBoxName: isPudoDelivery ? form.pudoBoxName.trim() : "",
      },
      delivery: {
        deliveryOptionId: form.deliveryOption,
        deliveryOption:
          form.deliveryOption === "other"
            ? `Other: ${form.otherDelivery.trim()}`
            : selectedDelivery?.label ?? "",
        deliveryCost: selectedDelivery?.cost ?? 0,
        otherDelivery:
          form.deliveryOption === "other" ? form.otherDelivery.trim() : "",
        sendDate: parsedSendDate?.iso ?? "",
      },
      lineItems: selectedItems.map((item) => ({
        id: item.id,
        label: item.title ?? item.label,
        quantity: quantities[item.id],
        price: item.price,
        priceType: item.priceType ?? "normal",
      })),
      notes: form.notes.trim(),
      allowEggSubstitutions:
        isLivestock || variant === "livestock"
          ? false
          : form.allowEggSubstitutions !== false,
      indemnityAccepted,
      clientMeta: buildClientMeta(),
    };
  };

  const createOrder = useCallback(
    async (payload) => {
      setIsSubmitting(true);
      setFieldErrors({});
      setError("");
      setSuccess("");
      setOrderNumber(null);
      try {
        const response = await runWithRetry(
          () => createPublicOrderCallable(payload),
          {
            retries: 2,
            baseDelayMs: 500,
          }
        );
        const result = response?.data || {};
        const createdOrderNumber = String(result.orderNumber || "").trim();
        const status = result.status === "duplicate" ? "duplicate" : "created";
        const customerEmailStatus = String(
          result.customerEmailStatus || "not_requested"
        ).trim();
        setOrderNumber(createdOrderNumber || null);
        if (status === "duplicate") {
          setModalTitle("Order already received");
          setModalMessage(
            createdOrderNumber
              ? `This order was already received as ${createdOrderNumber}.`
              : "This order was already received."
          );
          setModalNote("Please use your order number as your payment reference.");
        } else if (customerEmailStatus === "failed") {
          setModalTitle("Order placed");
          setModalMessage(
            "Your order has been placed, but we could not send the confirmation email."
          );
          setModalNote(
            "Please contact admin on WhatsApp or email if you do not hear from us shortly."
          );
        } else if (payload.contact.email) {
          setModalTitle("Order placed");
          setModalMessage(
            "Your order has been placed. A confirmation email will be sent shortly."
          );
          setModalNote("Please use your order number as your payment reference.");
        } else {
          setModalTitle("Order placed");
          setModalMessage(
            "Your order has been placed. We will use the contact details you provided to keep you updated."
          );
          setModalNote("Please use your order number as your payment reference.");
        }
        setSuccess("");
        setIsModalOpen(true);
        setForm(createDefaultForm(isLivestock));
        setQuantities(toQuantityMap(items, {}));
        setIndemnityAccepted(true);
        setFieldErrors({});
        setQueuedPayload(null);
        setIdempotencyKey(createClientKey());
        logEvent("order_submit_success", {
          variant,
          status,
          hasOrderNumber: Boolean(createdOrderNumber),
          customerEmailStatus,
        });
      } catch (err) {
        logError("order_submit_failed", err, { variant });
        const code = String(err?.code || "").toLowerCase();
        if (code.includes("permission-denied")) {
          setError(
            "Your order could not be submitted right now. Please contact admin on WhatsApp or email."
          );
        } else if (code.includes("invalid-argument")) {
          setError(
            "Some order details are invalid. Please check the highlighted fields and try again."
          );
        } else if (code.includes("unavailable")) {
          setError(
            "Network is unstable. Please keep this page open and try again in a moment. If the problem continues, contact admin."
          );
        } else {
          setError(
            "Something went wrong while submitting your order. Please contact admin if it keeps happening."
          );
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      createPublicOrderCallable,
      isLivestock,
      items,
      runWithRetry,
      variant,
    ]
  );

  useEffect(() => {
    if (!isOnline || !queuedPayload || isSubmitting) return;
    void createOrder(queuedPayload);
  }, [createOrder, isOnline, isSubmitting, queuedPayload]);

  const submitOrder = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setOrderNumber(null);

    const { message, errors, firstInvalidField } = validate();
    if (message) {
      setFieldErrors(errors);
      setError(message);
      if (firstInvalidField) {
        scrollToField(firstInvalidField);
      }
      return;
    }

    const payload = buildSubmissionPayload();
    logEvent("order_submit_attempt", {
      variant,
      lineItemCount: payload.lineItems.length,
      network: isOnline ? "online" : "offline",
    });

    if (!isOnline) {
      setQueuedPayload(payload);
      setSuccess(
        "You are offline. Keep this page open and we will submit your order automatically when your connection returns."
      );
      return;
    }

    await createOrder(payload);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className={`${cardClass} p-6 md:p-8`}>
        <div className="flex flex-col items-center gap-4 text-center">
          <img
            src="/assets/crookedfencelogosmall(1)-D2NbFJhG.png"
            alt="The Crooked Fence logo"
            className="h-32 w-auto object-contain"
          />
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-brandGreen/70">
              The Crooked Fence
            </p>
            <h1 className="text-3xl font-bold text-brandGreen">{pageTitle}</h1>
            <p className="text-brandGreen/80">
              Please complete this form so we can process your order quickly.
              Thank you for your support.
            </p>
          </div>
          <div className="w-full space-y-2 rounded-xl bg-white/70 p-4 text-left text-sm text-brandGreen shadow-inner">
            <p className="font-semibold text-red-700">
              Please follow up via WhatsApp (082 891 07612) for order updates
              and to confirm payment by sending proof of payment.
            </p>
            <p className="text-brandGreen/80">
              Support email:{" "}
              <a
                href="mailto:stolschristopher60@gmail.com"
                className="font-semibold underline"
              >
                stolschristopher60@gmail.com
              </a>
            </p>
            {isLivestock ? (
              <p className="text-brandGreen/80">
                Delivery prices are shown per option; livestock delivery differs
                from eggs.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <form
        onSubmit={submitOrder}
        className={`${cardClass} space-y-6 p-6 md:p-8`}
      >
        {!isOnline ? <Banner message={statusLabel} tone="warning" /> : null}

        {error ? <ErrorMessage message={error} /> : null}
        {success ? <Banner message={success} tone="success" /> : null}
        {isRetrying && !isSubmitting ? (
          <Banner
            message="Retrying submission due to network instability..."
            tone="warning"
          />
        ) : null}

        <div className={`${cardClass} space-y-4 p-4 md:p-5`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-brandGreen">{itemTitle}</h2>
              {!isLivestock ? (
                <>
                  <p className="text-sm text-brandGreen/70">
                    Limited Quantities of Chicken Breed. Orders can only be made
                    up to 20 at a time per breed.
                  </p>
                  <p className="text-sm text-brandGreen/70">
                    Bulk quantities available for Indian Runner Ducks and Quail.
                  </p>
                </>
              ) : null}
            </div>
            <div className="space-y-1 text-sm text-brandGreen/80">
              <p>
                <span className="font-semibold text-brandGreen">
                  {dateLabel}
                </span>
              </p>
              <input
                type="date"
                className={`${inputClass} md:w-56 ${
                  fieldErrors.sendDate
                    ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                    : ""
                }`}
                value={parseOrderDateInput(form.sendDate)?.iso ?? ""}
                onChange={handleSendDateChange}
                onClick={openSendDatePicker}
                onKeyDown={handleSendDateKeyDown}
                ref={(element) => {
                  sendDatePickerRef.current = element;
                  fieldRefs.current.sendDate = element;
                }}
                aria-invalid={Boolean(fieldErrors.sendDate)}
              />
              {dateHelper ? (
                <p className="text-xs text-brandGreen/70">{dateHelper}</p>
              ) : null}
            </div>
          </div>

          <div
            className={`space-y-6 ${
              fieldErrors.items ? "rounded-xl ring-2 ring-red-300" : ""
            }`}
            ref={(element) => {
              fieldRefs.current.items = element;
            }}
            aria-invalid={Boolean(fieldErrors.items)}
          >
            <div className="rounded-xl bg-white/65 px-4 py-3 text-sm text-brandGreen/75 shadow-sm">
              {listingHelperText}
            </div>

            {showGroupedItems ? (
              groupedItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
                  {isLivestock
                    ? "No livestock types found. Add some on the admin dashboard."
                    : "No egg types found. Add some on the admin dashboard."}
                </div>
              ) : (
                groupedItems.map((group) => (
                  <div
                    key={group.id}
                    className="space-y-3 rounded-2xl border border-brandGreen/10 bg-white/60 p-3 shadow-sm sm:space-y-4 sm:p-4"
                  >
                    <div className="space-y-1.5">
                      <p className="text-xl font-semibold text-brandGreen">
                        {group.label}
                        <span className="ml-2 text-sm font-medium text-brandGreen/65">
                          ({group.items.length} item
                          {group.items.length === 1 ? "" : "s"})
                        </span>
                      </p>
                      <p className="text-sm text-brandGreen/65">
                        {categoryHelperText}
                      </p>
                      {group.description ? (
                        <p className="text-sm text-brandGreen/80">
                          {group.description}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                      {group.items.map(renderTypeCard)}
                    </div>
                  </div>
                ))
              )
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                {items.length === 0 ? (
                  <div className="col-span-1 rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70 sm:col-span-2">
                    {isLivestock
                      ? "No livestock types found. Add some on the admin dashboard."
                      : "No egg types found. Add some on the admin dashboard."}
                  </div>
                ) : (
                  items.map(renderTypeCard)
                )}
              </div>
            )}
          </div>

          {!isLivestock ? (
            <div className="mt-4 space-y-2">
              <label className="block text-sm font-semibold text-brandGreen">
                Notes / comments (optional)
              </label>
              <textarea
                className={`${inputClass} min-h-28`}
                value={form.notes}
                onChange={(event) => setField("notes", event.target.value)}
                placeholder="Add any special requests or notes for the farm..."
              />
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-brandGreen">
              Name*
            </label>
            <input
              type="text"
              className={`${inputClass} ${
                fieldErrors.name
                  ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                  : ""
              }`}
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              ref={(element) => {
                fieldRefs.current.name = element;
              }}
              aria-invalid={Boolean(fieldErrors.name)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-brandGreen">
              Surname*
            </label>
            <input
              type="text"
              className={`${inputClass} ${
                fieldErrors.surname
                  ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                  : ""
              }`}
              value={form.surname}
              onChange={(event) => setField("surname", event.target.value)}
              ref={(element) => {
                fieldRefs.current.surname = element;
              }}
              aria-invalid={Boolean(fieldErrors.surname)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-brandGreen">
              Email
            </label>
            <input
              type="email"
              className={`${inputClass} ${
                fieldErrors.email
                  ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                  : ""
              }`}
              value={form.email}
              onChange={(event) => setField("email", event.target.value)}
              ref={(element) => {
                fieldRefs.current.email = element;
              }}
              aria-invalid={Boolean(fieldErrors.email)}
            />
            <p className="text-xs text-brandGreen/70">
              Email is optional if we can reach you on WhatsApp.
            </p>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-brandGreen">
              Cellphone number*
            </label>
            <div className="grid grid-cols-1 gap-2">
              <select
                className={`${inputClass} ${
                  fieldErrors.countryCode
                    ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                    : ""
                }`}
                value={form.countryCode}
                onChange={(event) =>
                  setField("countryCode", event.target.value)
                }
                ref={(element) => {
                  fieldRefs.current.countryCode = element;
                }}
                aria-invalid={Boolean(fieldErrors.countryCode)}
              >
                {COUNTRY_CODES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label} ({country.code})
                  </option>
                ))}
              </select>
              <input
                type="tel"
                className={`${inputClass} ${
                  fieldErrors.cellphone
                    ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                    : ""
                }`}
                value={form.cellphone}
                onChange={(event) => setField("cellphone", event.target.value)}
                placeholder="e.g. 82 123 4567"
                ref={(element) => {
                  fieldRefs.current.cellphone = element;
                }}
                aria-invalid={Boolean(fieldErrors.cellphone)}
                required
              />
            </div>
          </div>
          <div className="space-y-3 md:col-span-2">
            <div className="rounded-xl border border-brandGreen/15 bg-white/60 p-4">
              <p className="text-sm font-semibold text-brandGreen">
                Is this also your WhatsApp number?
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="inline-flex items-center gap-2 rounded-lg border border-brandGreen/20 bg-white px-3 py-2 text-sm text-brandGreen">
                  <input
                    type="radio"
                    name="whatsappMatchesCellphone"
                    className="h-4 w-4 accent-brandGreen"
                    checked={form.whatsappMatchesCellphone}
                    onChange={() => setField("whatsappMatchesCellphone", true)}
                  />
                  <span>Yes</span>
                </label>
                <label className="inline-flex items-center gap-2 rounded-lg border border-brandGreen/20 bg-white px-3 py-2 text-sm text-brandGreen">
                  <input
                    type="radio"
                    name="whatsappMatchesCellphone"
                    className="h-4 w-4 accent-brandGreen"
                    checked={!form.whatsappMatchesCellphone}
                    onChange={() => setField("whatsappMatchesCellphone", false)}
                  />
                  <span>No</span>
                </label>
              </div>
              <p className="mt-3 text-xs text-brandGreen/70">
                {form.whatsappMatchesCellphone
                  ? "We'll use your cellphone number for WhatsApp updates."
                  : "Add a different WhatsApp number below, or leave it blank if you'd rather use email for updates."}
              </p>
            </div>
          </div>
          {!form.whatsappMatchesCellphone ? (
            <div className="space-y-2 md:col-span-2">
              <label className="block text-sm font-semibold text-brandGreen">
                WhatsApp number
              </label>
              <input
                type="tel"
                className={`${inputClass} ${
                  fieldErrors.whatsapp
                    ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                    : ""
                }`}
                value={form.whatsapp}
                onChange={(event) => setField("whatsapp", event.target.value)}
                placeholder="e.g. +27 82 123 4567"
                ref={(element) => {
                  fieldRefs.current.whatsapp = element;
                }}
                aria-invalid={Boolean(fieldErrors.whatsapp)}
              />
            </div>
          ) : null}
          <div className="space-y-3 md:col-span-2">
            <label className="block text-sm font-semibold text-brandGreen">
              Delivery address details*
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-brandGreen/80">
                  Street name and house number*
                </label>
                <input
                  type="text"
                  className={`${inputClass} ${
                    fieldErrors.streetAddress
                      ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                      : ""
                  }`}
                  value={form.streetAddress}
                  onChange={(event) =>
                    setField("streetAddress", event.target.value)
                  }
                  placeholder="e.g. 14 Main Road"
                  ref={(element) => {
                    fieldRefs.current.streetAddress = element;
                  }}
                  aria-invalid={Boolean(fieldErrors.streetAddress)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-brandGreen/80">
                  Suburb
                </label>
                <input
                  type="text"
                  className={inputClass}
                  value={form.suburb}
                  onChange={(event) => setField("suburb", event.target.value)}
                  placeholder="e.g. Parkhurst"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-brandGreen/80">
                  City*
                </label>
                <input
                  type="text"
                  className={`${inputClass} ${
                    fieldErrors.city
                      ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                      : ""
                  }`}
                  value={form.city}
                  onChange={(event) => setField("city", event.target.value)}
                  placeholder="e.g. Johannesburg"
                  ref={(element) => {
                    fieldRefs.current.city = element;
                  }}
                  aria-invalid={Boolean(fieldErrors.city)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-brandGreen/80">
                  Province*
                </label>
                <select
                  className={`${inputClass} ${
                    fieldErrors.province
                      ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                      : ""
                  }`}
                  value={form.province}
                  onChange={(event) => setField("province", event.target.value)}
                  ref={(element) => {
                    fieldRefs.current.province = element;
                  }}
                  aria-invalid={Boolean(fieldErrors.province)}
                  required
                >
                  <option value="">Select province</option>
                  {SA_PROVINCES.map((province) => (
                    <option key={province} value={province}>
                      {province}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="block text-xs font-semibold text-brandGreen/80">
                  Postal code*
                </label>
                <input
                  type="text"
                  className={`${inputClass} ${
                    fieldErrors.postalCode
                      ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                      : ""
                  }`}
                  value={form.postalCode}
                  onChange={(event) => setField("postalCode", event.target.value)}
                  placeholder="e.g. 2193"
                  ref={(element) => {
                    fieldRefs.current.postalCode = element;
                  }}
                  aria-invalid={Boolean(fieldErrors.postalCode)}
                  required
                />
              </div>
            </div>
            <p className="text-xs text-brandGreen/70">
              Required: street name and house number, city, province, and postal
              code.
            </p>
          </div>
        </div>

        <div
          className={`${cardClass} p-4 md:p-5 ${
            fieldErrors.deliveryOption ? "ring-2 ring-red-300" : ""
          }`}
          ref={(element) => {
            fieldRefs.current.deliveryOption = element;
          }}
          aria-invalid={Boolean(fieldErrors.deliveryOption)}
        >
          <h2 className="text-lg font-bold text-brandGreen">
            Delivery options*
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {deliveryOptions.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer gap-3 rounded-lg border border-brandGreen/20 bg-white/70 p-3 transition hover:border-brandGreen"
              >
                <input
                  type="radio"
                  name="deliveryOption"
                  value={option.id}
                  checked={form.deliveryOption === option.id}
                  onChange={(event) =>
                    setField("deliveryOption", event.target.value)
                  }
                  className="mt-1 accent-brandGreen"
                />
                <div className="flex flex-col">
                  <span className="text-brandGreen">{option.label}</span>
                  <span className="text-xs text-brandGreen/70">
                    Cost: R{Number(option.cost ?? 0).toFixed(2)}
                  </span>
                </div>
              </label>
            ))}
          </div>
          {form.deliveryOption === "other" ? (
            <div className="mt-3">
              <label className="block text-sm font-semibold text-brandGreen">
                Please describe your delivery preference
              </label>
              <input
                type="text"
                className={`${inputClass} ${
                  fieldErrors.otherDelivery
                    ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                    : ""
                }`}
                value={form.otherDelivery}
                onChange={(event) =>
                  setField("otherDelivery", event.target.value)
                }
                placeholder="e.g. Meet at local pickup point"
                ref={(element) => {
                  fieldRefs.current.otherDelivery = element;
                }}
                aria-invalid={Boolean(fieldErrors.otherDelivery)}
              />
            </div>
          ) : null}
          {isPudoDelivery ? (
            <div className="mt-3 space-y-1.5">
              <label className="block text-sm font-semibold text-brandGreen">
                PUDO box name (optional)
              </label>
              <input
                type="text"
                className={inputClass}
                value={form.pudoBoxName}
                onChange={(event) => setField("pudoBoxName", event.target.value)}
                placeholder="e.g. PUDO Locker - Cresta Shopping Centre"
              />
              <p className="text-xs text-brandGreen/70">
                Not sure which box to use?{" "}
                <a
                  href="https://thecourierguy.co.za/locations/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  View PUDO locations
                </a>
                .
              </p>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-brandGreen/15 bg-white/80 px-4 py-3 text-sm text-brandGreen shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
            Order total (estimate)
          </p>
          {orderNumber ? (
            <p className="text-xs font-mono text-brandGreen/80">
              Order number: {orderNumber}
            </p>
          ) : null}
          <div className="mt-2 space-y-1">
            {itemBreakdown.map((line) => (
              <div
                key={line.id}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {line.label} - {line.qty} x R{line.unitPrice.toFixed(2)}
                </span>
                <span className="font-semibold">
                  R{line.lineTotal.toFixed(2)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-brandGreen/10 pt-1 text-sm">
              <span>Subtotal</span>
              <span className="font-semibold">R{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Delivery</span>
              <span className="font-semibold">R{deliveryCost.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-base font-bold text-brandGreen">
              <span>Total</span>
              <span>R{total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {!isLivestock ? (
          <div className="rounded-xl border border-brandGreen/15 bg-white/80 px-4 py-3 text-sm text-brandGreen shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
              Egg substitution preference
            </p>
            <p className="mt-2 text-sm text-brandGreen/80">
              If a selected egg type is short, we may substitute with another
              egg type from the same selected group so we can still fulfill the
              value of your order.
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm font-semibold text-brandGreen">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-brandGreen text-brandGreen focus:ring-brandGreen"
                checked={form.allowEggSubstitutions !== false}
                onChange={(event) =>
                  setField("allowEggSubstitutions", event.target.checked)
                }
              />
              <span>Allow substitutions within selected egg groups</span>
            </label>
          </div>
        ) : null}

        <div
          className={`rounded-xl border border-brandGreen/15 bg-white/80 px-4 py-3 text-sm text-brandGreen shadow-sm ${
            fieldErrors.indemnity ? "ring-2 ring-red-300" : ""
          }`}
          ref={(element) => {
            fieldRefs.current.indemnity = element;
          }}
          aria-invalid={Boolean(fieldErrors.indemnity)}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
            Indemnity
          </p>
          <p className="mt-2 whitespace-pre-line text-sm text-brandGreen/80">
            {indemnityText}
          </p>
          {!isLivestock ? (
            <p className="mt-2 text-sm font-semibold text-brandGreen/90">
              {eggRestNoticeText}
            </p>
          ) : null}
          <label className="mt-3 flex items-start gap-2 text-sm font-semibold text-brandGreen">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-brandGreen text-brandGreen focus:ring-brandGreen"
              checked={indemnityAccepted}
              onChange={(event) => {
                setIndemnityAccepted(event.target.checked);
                if (event.target.checked) {
                  clearFieldError("indemnity");
                }
              }}
              required
            />
            <span>{indemnityAcceptanceText}</span>
          </label>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <span className="text-sm text-brandGreen/70">
            You can update your order later by reaching out on WhatsApp.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSubmitting || isRetrying}>
              {isSubmitting || isRetrying ? "Submitting..." : "Submit order"}
            </Button>
          </div>
        </div>
      </form>

      <Dialog
        open={isModalOpen}
        title={modalTitle}
        onClose={() => setIsModalOpen(false)}
        closeLabel="Got it"
      >
        <p className="mt-2 text-sm text-brandGreen/80">{modalMessage}</p>
        {orderNumber ? (
          <p className="mt-2 text-sm font-semibold text-brandGreen">
            Your order number: {orderNumber}
          </p>
        ) : null}
        {modalNote ? (
          <p className="mt-2 text-sm text-brandGreen/75">{modalNote}</p>
        ) : null}
      </Dialog>

      <a
        href="https://wa.me/27828910761?text=Hi%2C%20I%20would%20like%20assistance"
        target="_blank"
        rel="noreferrer noopener"
        className="fixed bottom-4 right-4 z-50 flex items-center justify-center gap-2 rounded-full bg-brandCream px-5 py-3 text-sm font-semibold text-brandGreen shadow-xl transition hover:bg-brandCream/90 md:gap-3 md:px-4 md:py-2 md:text-xs"
        aria-label="Chat with us on WhatsApp"
      >
        <img
          src="/assets/whatsapp-call-icon-psd-editable_314999-3666%20-%20Edited-DksBPxqT.png"
          alt="WhatsApp"
          className="h-6 w-6 rounded-full bg-white/20 object-contain"
        />
        <span className="hidden md:inline">Send a WhatsApp</span>
      </a>
    </div>
  );
}
