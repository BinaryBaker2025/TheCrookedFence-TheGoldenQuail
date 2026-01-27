import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase.js";
import {
  COUNTRY_CODES,
  DEFAULT_FORM_DELIVERY_OPTIONS,
  DEFAULT_LIVESTOCK_DELIVERY_OPTIONS,
  UNCATEGORIZED_LABEL,
} from "../data/defaults.js";

const cardClass =
  "bg-brandBeige shadow-lg rounded-2xl border border-brandGreen/10";
const inputClass =
  "w-full rounded-lg border border-brandGreen/20 bg-white/70 px-4 py-3 text-brandGreen placeholder:text-brandGreen/50 focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30";
const indemnityText =
  "NO REFUNDS. We take great care in packaging all eggs to ensure they are shipped as safely as possible. However, once eggs leave our care, we cannot be held responsible for damage that may occur during transit, including cracked eggs. Hatch rates cannot be guaranteed. There are many factors beyond our control—such as handling during shipping, incubation conditions, and environmental variables—that may affect development. As eggs are considered livestock, purchasing hatching eggs involves an inherent risk that the buyer accepts at the time of purchase.\n\nAvailability Notice: Some eggs are subject to a 3–6 week waiting period and may not be available for immediate shipment. By placing an order, the buyer acknowledges and accepts this potential delay.\n\nExtra Eggs Disclaimer: Extra eggs are never guaranteed. While we may occasionally include additional eggs when available, this is done at our discretion and should not be expected or assumed as part of any order.";
const indemnityAcceptanceText = "I have read and accept the indemnity terms.";

const createDefaultForm = (isLivestock) => ({
  name: "",
  surname: "",
  email: "",
  countryCode: "+27",
  cellphone: "",
  address: "",
  deliveryOption: isLivestock
    ? DEFAULT_LIVESTOCK_DELIVERY_OPTIONS[0].id
    : DEFAULT_FORM_DELIVERY_OPTIONS[0].id,
  otherDelivery: "",
  sendDate: "",
  notes: "",
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
    ? "Preferred delivery/need-by date*"
    : "Send date*";
  const dateHelper = isLivestock
    ? "Tell us when you need the livestock (e.g., next week Wednesday)."
    : "";
  const typeDetailBase = isLivestock ? "/livestock" : "/eggs";

  const initialItems = [];
  const [items, setItems] = useState(initialItems);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(() => createDefaultForm(isLivestock));
  const [deliveryOptions, setDeliveryOptions] = useState(
    isLivestock
      ? DEFAULT_LIVESTOCK_DELIVERY_OPTIONS
      : DEFAULT_FORM_DELIVERY_OPTIONS
  );
  const [quantities, setQuantities] = useState(() =>
    toQuantityMap(initialItems)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState(null);
  const [indemnityAccepted, setIndemnityAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const fieldRefs = useRef({});

  useEffect(() => {
    const ref = collection(db, isLivestock ? "livestockTypes" : "eggTypes");
    const typesQuery = query(ref, orderBy("order", "asc"));
    const unsubscribe = onSnapshot(
      typesQuery,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => {
          const docData = docSnap.data();
          return {
            id: docSnap.id,
            label: docData.label ?? "Unnamed",
            price: Number(docData.price ?? 0),
            specialPrice:
              docData.specialPrice === undefined
                ? null
                : Number(docData.specialPrice),
            order: docData.order ?? 0,
            categoryId: docData.categoryId ?? "",
            categoryName: docData.categoryName ?? docData.category ?? "",
            imageUrl: docData.imageUrl ?? "",
            available: docData.available !== false,
          };
        });
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
    const categoriesQuery = query(
      ref,
      orderBy(isLivestock ? "name" : "order", "asc")
    );
    const unsubscribe = onSnapshot(
      categoriesQuery,
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
            if (isLivestock) {
              return a.name.localeCompare(b.name);
            }
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
        const special = item.specialPrice ?? null;
        const unitPrice =
          special === null || special === 0 ? item.price ?? 0 : special;
        const qty = quantities[item.id] ?? 0;
        return sum + unitPrice * qty;
      }, 0),
    [selectedItems, quantities]
  );

  const itemBreakdown = useMemo(
    () =>
      selectedItems.map((item) => {
        const special = item.specialPrice ?? null;
        const unitPrice =
          special === null || special === 0 ? item.price ?? 0 : special;
        const qty = quantities[item.id] ?? 0;
        return {
          id: item.id,
          label: item.label,
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

  const total = subtotal + deliveryCost;

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      if (
        !prev[field] &&
        !(field === "deliveryOption" && prev.otherDelivery && value !== "other")
      ) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      if (field === "deliveryOption" && value !== "other") {
        delete next.otherDelivery;
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
    const prefix = countryDigits ? `+${countryDigits}` : "";
    const localDigits = normalizePhoneDigits(form.cellphone);
    return [prefix, localDigits].filter(Boolean).join(" ").trim();
  };

  const validate = () => {
    const nextErrors = {};
    if (
      !form.name.trim() ||
      !form.surname.trim() ||
      !form.email.trim() ||
      !form.countryCode.trim() ||
      !form.cellphone.trim() ||
      !form.address.trim() ||
      !form.deliveryOption ||
      !form.sendDate
    ) {
      if (!form.sendDate) nextErrors.sendDate = "required";
      if (!form.name.trim()) nextErrors.name = "required";
      if (!form.surname.trim()) nextErrors.surname = "required";
      if (!form.email.trim()) nextErrors.email = "required";
      if (!form.countryCode.trim()) nextErrors.countryCode = "required";
      if (!form.cellphone.trim()) nextErrors.cellphone = "required";
      if (!form.address.trim()) nextErrors.address = "required";
      if (!form.deliveryOption) nextErrors.deliveryOption = "required";
    }
    if (form.deliveryOption === "other" && !form.otherDelivery.trim()) {
      nextErrors.otherDelivery = "required";
    }
    if (form.cellphone.trim() && !isValidCellphone(form.cellphone)) {
      nextErrors.cellphone = "invalid";
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

    const orderedKeys = [
      "sendDate",
      "items",
      "name",
      "surname",
      "email",
      "countryCode",
      "cellphone",
      "address",
      "deliveryOption",
      "otherDelivery",
      "indemnity",
    ];
    const firstInvalidField =
      orderedKeys.find((key) => nextErrors[key]) ??
      Object.keys(nextErrors)[0];

    let message = "Please fill in all required fields.";
    if (firstInvalidField === "items") {
      message = `Please order at least one ${itemLabel} (quantities above 0).`;
    } else if (firstInvalidField === "otherDelivery") {
      message = "Please specify your other delivery option.";
    } else if (
      firstInvalidField === "cellphone" &&
      nextErrors.cellphone === "invalid"
    ) {
      message = "Cellphone number must be 9 digits, or 10 digits starting with 0.";
    } else if (firstInvalidField === "indemnity") {
      message = "Please accept the indemnity terms to continue.";
    }

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

    setIsSubmitting(true);
    setFieldErrors({});
    try {
      const selectedDelivery = deliveryOptions.find(
        (option) => option.id === form.deliveryOption
      );

      const payload = {
        name: form.name.trim(),
        surname: form.surname.trim(),
        email: form.email.trim(),
        cellphone: formatCellphone(),
        address: form.address.trim(),
        deliveryOptionId: form.deliveryOption,
        deliveryOption:
          form.deliveryOption === "other"
            ? `Other: ${form.otherDelivery.trim()}`
            : selectedDelivery?.label ?? "",
        deliveryCost: selectedDelivery?.cost ?? 0,
        otherDelivery:
          form.deliveryOption === "other" ? form.otherDelivery.trim() : "",
        sendDate: form.sendDate,
        eggs: selectedItems.map((item) => ({
          id: item.id,
          label: item.label,
          quantity: quantities[item.id],
          price: item.price,
          specialPrice: item.specialPrice ?? null,
        })),
        formType: variant,
        orderStatus: "pending",
        fulfilledEggs: [],
        trackingLink: "",
        notes: form.notes.trim(),
        paid: false,
        indemnityAccepted: true,
        indemnityAcceptedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      const collectionName = isLivestock ? "livestockOrders" : "eggOrders";
      const created = await addDoc(collection(db, collectionName), payload);

      let updatedOrderNumber = null;
      for (let i = 0; i < 5; i += 1) {
        const snapshot = await getDoc(doc(db, collectionName, created.id));
        const nextNumber = snapshot.data()?.orderNumber;
        if (nextNumber) {
          updatedOrderNumber = nextNumber;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      setOrderNumber(updatedOrderNumber);
      setSuccess(
        updatedOrderNumber
          ? `Order submitted! Your order number is ${updatedOrderNumber}. Please use it as your payment reference.`
          : "Order submitted successfully! Thank you for your support."
      );
      setIsModalOpen(true);
      setForm(createDefaultForm(isLivestock));
      setQuantities(
        items.reduce((acc, item) => ({ ...acc, [item.id]: 0 }), {})
      );
      setIndemnityAccepted(false);
      setFieldErrors({});
    } catch (err) {
      console.error("Order submit error:", err);
      const message =
        err?.code === "permission-denied"
          ? "Submission blocked by Firestore rules. Please allow creates to the target collection."
          : err?.message?.includes("Firebase")
          ? `Firebase error: ${err.message}`
          : "Something went wrong while submitting. Please try again.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
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
              Please help us keep track of our egg orders by filling in the
              following. Thank you so much for your support.
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
                value={form.sendDate}
                onChange={(event) => setField("sendDate", event.target.value)}
                ref={(element) => {
                  fieldRefs.current.sendDate = element;
                }}
                aria-invalid={Boolean(fieldErrors.sendDate)}
                required
              />
              {dateHelper ? (
                <p className="text-xs text-brandGreen/70">{dateHelper}</p>
              ) : null}
            </div>
          </div>

          {showGroupedItems ? (
            <div
              className={`space-y-4 ${
                fieldErrors.items ? "rounded-xl ring-2 ring-red-300" : ""
              }`}
              ref={(element) => {
                fieldRefs.current.items = element;
              }}
              aria-invalid={Boolean(fieldErrors.items)}
            >
              {groupedItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
                  {isLivestock
                    ? "No livestock types found. Add some on the admin dashboard."
                    : "No egg types found. Add some on the admin dashboard."}
                </div>
              ) : (
                groupedItems.map((group) => (
                  <div
                    key={group.id}
                    className="space-y-2 rounded-xl border border-brandGreen/15 bg-white/70 p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <p className="font-semibold text-brandGreen">
                          {group.label}
                        </p>
                        {group.description ? (
                          <p className="text-sm text-brandGreen/80">
                            {group.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-brandGreen/60">
                          {group.items.length} item
                          {group.items.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {group.items.map((item) => {
                        const isAvailable = item.available !== false;
                        return (
                          <div
                            key={item.id}
                            className={`rounded-lg border border-brandGreen/15 bg-brandBeige/40 p-3 shadow-sm ${
                              isAvailable ? "" : "opacity-60"
                            }`}
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div className="flex flex-1 gap-3">
                                <div className="h-20 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-brandGreen/20 bg-white/80">
                                  {item.imageUrl ? (
                                    <img
                                      src={item.imageUrl}
                                      alt={item.label}
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[11px] text-brandGreen/50">
                                      No image
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <Link
                                    to={`${typeDetailBase}/${item.id}`}
                                    className="font-semibold text-brandGreen transition hover:underline"
                                  >
                                    {item.label}
                                  </Link>
                                  <p className="text-sm text-brandGreen/70">
                                    Normal Price: R{item.price.toFixed(2)}
                                    {item.specialPrice !== null &&
                                    item.specialPrice !== undefined &&
                                    Number(item.specialPrice) > 0
                                      ? ` \u00b7 Special Price: R${item.specialPrice.toFixed(
                                          2
                                        )}`
                                      : ""}
                                  </p>
                                  {!isAvailable ? (
                                    <p className="text-xs font-semibold text-brandGreen/60">
                                      Unavailable
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex items-start justify-end">
                                <input
                                  type="number"
                                  min={0}
                                  disabled={!isAvailable}
                                  className={`w-24 rounded-lg border border-brandGreen/30 px-3 py-2 text-right font-semibold text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 ${
                                    isAvailable
                                      ? "bg-brandCream"
                                      : "bg-gray-100 text-brandGreen/50"
                                  }`}
                                  value={quantities[item.id] ?? 0}
                                  onChange={(event) => {
                                    const nextValue = Math.max(
                                      0,
                                      Number(event.target.value)
                                    );
                                    const hasAny =
                                      nextValue > 0 ||
                                      Object.entries(quantities).some(
                                        ([id, qty]) =>
                                          id !== item.id && qty > 0
                                      );
                                    if (hasAny) {
                                      clearFieldError("items");
                                    }
                                    setQuantities((prev) => ({
                                      ...prev,
                                      [item.id]: nextValue,
                                    }));
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div
              className={`grid gap-3 md:grid-cols-2 ${
                fieldErrors.items ? "rounded-xl ring-2 ring-red-300" : ""
              }`}
              ref={(element) => {
                fieldRefs.current.items = element;
              }}
              aria-invalid={Boolean(fieldErrors.items)}
            >
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-brandGreen/30 bg-white/70 px-4 py-6 text-sm text-brandGreen/70">
                  No egg types found. Add some on the admin dashboard.
                </div>
              ) : (
                items.map((item) => {
                  const isAvailable = item.available !== false;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg border border-brandGreen/15 bg-white/70 p-3 shadow-sm ${
                        isAvailable ? "" : "opacity-60"
                      }`}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="flex flex-1 gap-3">
                          <div className="h-20 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-brandGreen/20 bg-white/80">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.label}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[11px] text-brandGreen/50">
                                No image
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <Link
                              to={`${typeDetailBase}/${item.id}`}
                              className="font-semibold text-brandGreen transition hover:underline"
                            >
                              {item.label}
                            </Link>
                            <p className="text-sm text-brandGreen/70">
                              Normal Price: R{item.price.toFixed(2)}
                              {item.specialPrice !== null &&
                              item.specialPrice !== undefined &&
                              Number(item.specialPrice) > 0
                                ? ` \u00b7 Special Price: R${item.specialPrice.toFixed(
                                    2
                                  )}`
                                : ""}
                            </p>
                            {!isAvailable ? (
                              <p className="text-xs font-semibold text-brandGreen/60">
                                Unavailable
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-start justify-end">
                          <input
                            type="number"
                            min={0}
                            disabled={!isAvailable}
                            className={`w-24 rounded-lg border border-brandGreen/30 px-3 py-2 text-right font-semibold text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 ${
                              isAvailable
                                ? "bg-brandCream"
                                : "bg-gray-100 text-brandGreen/50"
                            }`}
                            value={quantities[item.id] ?? 0}
                            onChange={(event) => {
                              const nextValue = Math.max(
                                0,
                                Number(event.target.value)
                              );
                              const hasAny =
                                nextValue > 0 ||
                                Object.entries(quantities).some(
                                  ([id, qty]) => id !== item.id && qty > 0
                                );
                              if (hasAny) {
                                clearFieldError("items");
                              }
                              setQuantities((prev) => ({
                                ...prev,
                                [item.id]: nextValue,
                              }));
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

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
              Email*
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
              required
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-brandGreen">
              Cellphone number*
            </label>
            <div className="grid grid-cols-[200px_1fr] gap-2">
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
          <div className="space-y-2 md:col-span-2">
            <label className="block text-sm font-semibold text-brandGreen">
              Delivery address*
            </label>
            <textarea
              className={`${inputClass} min-h-28 ${
                fieldErrors.address
                  ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                  : ""
              }`}
              value={form.address}
              onChange={(event) => setField("address", event.target.value)}
              placeholder="Street name and number, Suburb, Town, Postal code. For PUDO please add the locker name. (PUDO IS FOR EGGS ONLY)"
              ref={(element) => {
                fieldRefs.current.address = element;
              }}
              aria-invalid={Boolean(fieldErrors.address)}
              required
            />
            <p className="text-xs text-brandGreen/70">
              Street name and number, Suburb, Town, Postal code. For PUDO please
              add the locker name. (PUDO IS FOR EGGS ONLY)
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

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-xl border border-brandGreen/20 bg-white px-4 py-3 text-sm text-brandGreen">
            {success}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <span className="text-sm text-brandGreen/70">
            You can update your order later by reaching out on WhatsApp.
          </span>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-full bg-brandGreen px-6 py-3 font-semibold text-white shadow-md transition hover:scale-[1.01] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Submitting..." : "Submit order"}
          </button>
        </div>
      </form>

      {isModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Order submitted"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-xl font-bold">Order received</h3>
            <p className="mt-2 text-sm text-brandGreen/80">
              Thank you! Your order has been submitted. You will receive an
              email confirmation and updates as we process and update the status
              of your order.
            </p>
            {orderNumber ? (
              <p className="mt-2 text-sm font-semibold text-brandGreen">
                Your order number: {orderNumber}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="mt-4 w-full rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}

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
