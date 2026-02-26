import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase.js";
import { useSeo } from "../lib/seo.js";
import {
  EGG_INFO_FIELDS,
  normalizeTypeDoc,
} from "../lib/typeCatalog.js";

const pageSurfaceClass =
  "rounded-[20px] border border-[#e6e8e7] bg-gradient-to-br from-[#fbf7ef] via-[#f8f3e8] to-[#ffffff] p-6 shadow-[0_12px_30px_rgba(28,52,29,0.08)] md:p-8";
const panelClass =
  "rounded-[20px] border border-[#e6e8e7] bg-white p-5 shadow-[0_10px_25px_rgba(28,52,29,0.06)] md:p-6";
const sectionCardClass =
  "rounded-[18px] border border-[#e9ecea] bg-[#fafaf8] p-4 shadow-[0_4px_14px_rgba(28,52,29,0.04)]";
const carouselButtonClass =
  "inline-flex min-h-11 items-center rounded-full border border-[#d5ddd4] bg-white px-4 py-2 text-xs font-semibold text-[#2C5F2D] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#f5f8f3]";
const sectionLabelClass =
  "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#506a50]";
const statCardClass =
  "rounded-2xl border border-[#dfe6df] bg-white px-3 py-3 shadow-[0_3px_10px_rgba(28,52,29,0.04)]";

const formatCurrency = (value) => `R${Number(value ?? 0).toFixed(2)}`;

const formatEggInfoValue = (key, value) => {
  const trimmed = String(value ?? "").trim();
  if (key === "eggSize") {
    if (!trimmed) return "Not Specified";
    const lower = trimmed.toLowerCase();
    const numeric = Number.parseFloat(trimmed);
    if (lower.includes("cm") && Number.isFinite(numeric) && numeric >= 8) {
      return "Large";
    }
  }
  return trimmed || "Not specified";
};

function CheckIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoneyIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 9.5h.01M17 14.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DetailsIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 7h14M5 12h14M5 17h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DescriptionIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 4h12a2 2 0 0 1 2 2v12l-4-2-4 2-4-2-4 2V6a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 9h6M9 12h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EggInfoIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3c-3.5 0-6 5-6 9a6 6 0 1 0 12 0c0-4-2.5-9-6-9Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ArrowLeftIcon({ className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M19 12H5M11 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EggStatIcon({ fieldKey, className = "h-4 w-4" }) {
  const sharedProps = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
  };

  if (fieldKey === "layingAge") {
    return (
      <svg {...sharedProps}>
        <path
          d="M12 3c-3.5 0-6 5-6 9a6 6 0 1 0 12 0c0-4-2.5-9-6-9Z"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (fieldKey === "sexingAge") {
    return (
      <svg {...sharedProps}>
        <circle cx="11" cy="11" r="5" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M15 15l4 4M17 15h2v2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (fieldKey === "eggsPerYear") {
    return (
      <svg {...sharedProps}>
        <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 3v4M16 3v4M8 11h8M8 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (fieldKey === "colourTypes" || fieldKey === "eggColour") {
    return (
      <svg {...sharedProps}>
        <path
          d="M12 4c3.8 0 6 2.7 6 5.6 0 3.2-2.4 6.4-6 9.4-3.6-3-6-6.2-6-9.4C6 6.7 8.2 4 12 4Z"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (fieldKey === "lifeSpan") {
    return (
      <svg {...sharedProps}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 8v4l2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (fieldKey === "eggSize") {
    return (
      <svg {...sharedProps}>
        <path d="M4 18h16M8 18V8m8 10V6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg {...sharedProps}>
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export default function TypeDetailPage({ variant = "eggs" }) {
  const { typeId } = useParams();
  const isLivestock = variant === "livestock";
  const typeCollection = isLivestock ? "livestockTypes" : "eggTypes";
  const categoryCollection = isLivestock
    ? "livestockCategories"
    : "eggCategories";
  const [typeData, setTypeData] = useState(null);
  const [category, setCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  useEffect(() => {
    if (!typeId) return () => {};
    setLoading(true);
    setError("");
    const unsubscribe = onSnapshot(
      doc(db, typeCollection, typeId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setTypeData(null);
        } else {
          setTypeData(normalizeTypeDoc(snapshot.id, snapshot.data()));
        }
        setLoading(false);
      },
      (err) => {
        console.error("type detail load error", err);
        setError("Unable to load details. Please try again.");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [typeCollection, typeId]);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [typeData?.id]);

  useEffect(() => {
    const categoryId = typeData?.categoryId;
    if (!categoryId) {
      setCategory(null);
      return () => {};
    }
    const unsubscribe = onSnapshot(
      doc(db, categoryCollection, categoryId),
      (snapshot) => {
        setCategory(snapshot.exists() ? snapshot.data() : null);
      },
      (err) => {
        console.error("category detail load error", err);
        setCategory(null);
      }
    );
    return () => unsubscribe();
  }, [categoryCollection, typeData?.categoryId]);

  const detailBase = isLivestock ? "/livestock" : "/eggs";
  const categoryLabel = useMemo(() => {
    if (category?.name) return category.name;
    if (typeData?.categoryName) return typeData.categoryName;
    return "Uncategorized";
  }, [category?.name, typeData?.categoryName]);
  const availabilityLabel =
    typeData?.available === false ? "Unavailable" : "Available";

  const images = typeData?.images ?? [];
  const activeImage = images[activeImageIndex] ?? null;
  const canCarousel = images.length > 1;
  const seoPath = typeId
    ? `${detailBase}/${encodeURIComponent(typeId)}`
    : detailBase;
  const seoTitle = typeData?.title
    ? `${typeData.title} | ${
        isLivestock ? "Livestock Type" : "Fertile Egg Type"
      } | The Crooked Fence`
    : `${
        isLivestock ? "Livestock Type Details" : "Fertile Egg Type Details"
      } | The Crooked Fence`;
  const seoDescription =
    typeData?.shortDescription ||
    typeData?.longDescription ||
    category?.description ||
    (isLivestock
      ? "View livestock type details, pricing, and image gallery from The Crooked Fence."
      : "View fertile egg type details, pricing, and image gallery from The Crooked Fence.");
  const seoImage = activeImage?.url || typeData?.imageUrl || "/TCFLogoWhiteBackground.png";

  useSeo({
    title: seoTitle,
    description: seoDescription,
    path: seoPath,
    image: seoImage,
  });

  useEffect(() => {
    if (images.length === 0) return;
    const nextIndex = (activeImageIndex + 1) % images.length;
    const previousIndex =
      (activeImageIndex - 1 + images.length) % images.length;
    const preloadUrls = [
      images[activeImageIndex]?.url,
      images[nextIndex]?.url,
      images[previousIndex]?.url,
    ]
      .filter(Boolean)
      .filter((url, index, list) => list.indexOf(url) === index);

    preloadUrls.forEach((url) => {
      const img = new Image();
      img.src = url;
    });
  }, [activeImageIndex, images]);

  useEffect(() => {
    if (activeImageIndex >= images.length) {
      setActiveImageIndex(0);
    }
  }, [activeImageIndex, images.length]);

  const showPreviousImage = () => {
    setActiveImageIndex((prev) => {
      if (images.length === 0) return 0;
      return (prev - 1 + images.length) % images.length;
    });
  };

  const showNextImage = () => {
    setActiveImageIndex((prev) => {
      if (images.length === 0) return 0;
      return (prev + 1) % images.length;
    });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className={`${pageSurfaceClass} p-6`}>
          <p className="text-sm font-semibold text-[#2C5F2D]">
            Loading details...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className={`${pageSurfaceClass} p-6`}>
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
        <Link
          to={detailBase}
          className="inline-flex min-h-11 items-center rounded-full border border-[#2C5F2D]/30 bg-white px-4 py-2 text-sm font-semibold text-[#2C5F2D] shadow-sm transition hover:bg-[#f3f8f1]"
        >
          Back to order form
        </Link>
      </div>
    );
  }

  if (!typeData) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className={`${pageSurfaceClass} p-6`}>
          <p className="text-sm font-semibold text-[#2C5F2D]">
            This item could not be found.
          </p>
        </div>
        <Link
          to={detailBase}
          className="inline-flex min-h-11 items-center rounded-full border border-[#2C5F2D]/30 bg-white px-4 py-2 text-sm font-semibold text-[#2C5F2D] shadow-sm transition hover:bg-[#f3f8f1]"
        >
          Back to order form
        </Link>
      </div>
    );
  }

  const priceTypeLabel =
    typeData.priceType === "special" ? "Special price" : "Standard price";
  const priceValue = formatCurrency(typeData.price);
  const inStockLabel =
    typeData.available === false ? "Currently unavailable" : "In stock";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className={pageSurfaceClass}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5c765c]">
              {isLivestock ? "Livestock collection" : "Egg collection"}
            </p>
            <h1 className="mt-2 text-[22px] font-semibold text-[#2C5F2D] md:text-[24px]">
              Product details
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#5a685a]">
              Browse product details, compare key stats, and jump back to the
              order form when you are ready.
            </p>
          </div>
          <Link
            to={detailBase}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#2C5F2D]/30 bg-white px-6 py-3 text-sm font-semibold text-[#2C5F2D] shadow-sm transition hover:bg-[#f3f8f1]"
          >
            Order this item
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)] lg:items-start">
        <div className={panelClass}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className={sectionLabelClass}>
              <DetailsIcon className="h-4 w-4 text-[#2C5F2D]" />
              Product gallery
            </p>
            <p className="rounded-full border border-[#d8e0d7] bg-[#edf4eb] px-3 py-1 text-xs font-semibold text-[#2C5F2D]">
              {images.length} {images.length === 1 ? "image" : "images"}
            </p>
          </div>

          <div className="overflow-hidden rounded-[18px] border border-[#dde3dd] bg-gradient-to-br from-[#eef2ee] via-[#f8faf7] to-[#f2ecdf] p-3 shadow-inner sm:p-4">
            {activeImage ? (
              <div className="flex h-72 w-full items-center justify-center rounded-[14px] border border-[#e0e6de] bg-white/85 sm:h-80 lg:h-[30rem]">
                <img
                  src={activeImage.url}
                  alt={typeData.title ?? "Type image"}
                  className="h-full w-full object-contain"
                  loading="eager"
                  fetchpriority="high"
                  decoding="async"
                />
              </div>
            ) : (
              <div className="flex h-72 w-full items-center justify-center rounded-[14px] border border-[#e0e6de] bg-white/70 text-sm text-[#637263] sm:h-80 lg:h-[30rem]">
                Image coming soon
              </div>
            )}
          </div>

          {canCarousel ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={showPreviousImage}
                  className={carouselButtonClass}
                >
                  Previous
                </button>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#607260]">
                  Image {activeImageIndex + 1} of {images.length}
                </p>
                <button
                  type="button"
                  onClick={showNextImage}
                  className={carouselButtonClass}
                >
                  Next
                </button>
              </div>
              <div className="rounded-full border border-[#e3e9e2] bg-[#f8faf8] px-3 py-2">
                <div className="flex items-center justify-center gap-2">
                  {images.map((image, index) => (
                    <button
                      key={image.id || `dot_${index}`}
                      type="button"
                      onClick={() => setActiveImageIndex(index)}
                      aria-label={`View image ${index + 1}`}
                      className={`h-2.5 rounded-full transition ${
                        index === activeImageIndex
                          ? "w-6 bg-[#2C5F2D]"
                          : "w-2.5 bg-[#b8c5b6] hover:bg-[#7d977a]"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : images.length === 1 ? (
            <p className="mt-4 text-center text-xs font-semibold uppercase tracking-wide text-[#728172]">
              1 image
            </p>
          ) : null}
        </div>

        <div className={`${panelClass} space-y-5`}>
          <div className="rounded-[18px] border border-[#e0e7df] bg-gradient-to-br from-white via-[#f7f9f6] to-[#f3ede0] p-4 shadow-[0_6px_18px_rgba(28,52,29,0.05)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-[22px] font-semibold leading-tight text-[#2C5F2D]">
                  {typeData.title ?? "Item details"}
                </h2>
                <span
                  className={`mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${
                    typeData.available === false
                      ? "border-[#edd9b0] bg-[#fff5e3] text-[#8d6420]"
                      : "border-[#cfe2ce] bg-[#eaf5e8] text-[#2C5F2D]"
                  }`}
                >
                  <CheckIcon className="h-4 w-4" />
                  {inStockLabel}
                </span>
              </div>

              <div className="rounded-2xl border border-[#d9e3d8] bg-white px-4 py-3 text-left shadow-sm sm:text-right">
                <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5f775f]">
                  <MoneyIcon className="h-3.5 w-3.5 text-[#2C5F2D]" />
                  {priceTypeLabel}
                </p>
                <p className="mt-1 text-[26px] font-bold leading-none text-[#2C5F2D]">
                  {priceValue}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#cfe2ce] bg-[#e8f0e8] px-4 py-2 text-sm font-semibold text-[#2C5F2D]">
                <CheckIcon className="h-4 w-4" />
                {availabilityLabel}
              </span>
              <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#eadfca] bg-[#f8f2e4] px-4 py-2 text-sm font-semibold text-[#4f5f4f]">
                <DetailsIcon className="h-4 w-4 text-[#2C5F2D]" />
                Category: {categoryLabel}
              </span>
            </div>
          </div>

          <div className="h-px bg-[#e7ece6]" />

          <div className={`${sectionCardClass} border-[#d5e0d4]`}>
            <p className={sectionLabelClass}>
              <DescriptionIcon className="h-4 w-4 text-[#2C5F2D]" />
              Short description
            </p>
            <p className="mt-3 text-sm leading-7 text-[#334a33]">
              {typeData.shortDescription ||
                category?.description ||
                "No short description added."}
            </p>
          </div>

          <div className="rounded-[18px] border border-[#e6e9e6] bg-[#fffdf8] p-5 shadow-[0_6px_16px_rgba(28,52,29,0.04)]">
            <p className={sectionLabelClass}>
              <DetailsIcon className="h-4 w-4 text-[#2C5F2D]" />
              Long description
            </p>
            <p className="mt-3 whitespace-pre-line text-[15px] leading-8 text-[#445544]">
              {typeData.longDescription || "No long description added."}
            </p>
          </div>

          {!isLivestock ? (
            <div className={sectionCardClass}>
              <p className={sectionLabelClass}>
                <EggInfoIcon className="h-4 w-4 text-[#2C5F2D]" />
                Egg information
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {EGG_INFO_FIELDS.map((field) => (
                  <div key={field.key} className={statCardClass}>
                    <dt className="flex items-center gap-2 text-xs text-[#617561]">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#edf4ec] text-[#2C5F2D]">
                        <EggStatIcon fieldKey={field.key} className="h-4 w-4" />
                      </span>
                      <span className="font-semibold">{field.label}</span>
                    </dt>
                    <dd className="mt-2 text-base font-semibold text-[#2C5F2D]">
                      {formatEggInfoValue(field.key, typeData[field.key])}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="h-px bg-[#e7ece6]" />

          <Link
            to={detailBase}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#2C5F2D] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#244f25] active:translate-y-px"
          >
            <ArrowLeftIcon className="h-5 w-5" />
            Back to order form
          </Link>
        </div>
      </div>
    </div>
  );
}
