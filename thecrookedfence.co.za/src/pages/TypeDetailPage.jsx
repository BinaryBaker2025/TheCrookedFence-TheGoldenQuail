import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase.js";

const cardClass =
  "bg-brandBeige shadow-lg rounded-2xl border border-brandGreen/10";
const panelClass =
  "rounded-2xl border border-brandGreen/10 bg-white/80 p-6 shadow-inner";

const formatCurrency = (value) => `R${Number(value ?? 0).toFixed(2)}`;

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
          setTypeData({ id: snapshot.id, ...snapshot.data() });
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

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className={`${cardClass} p-6`}>
          <p className="text-sm font-semibold text-brandGreen">
            Loading details...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className={`${cardClass} p-6`}>
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
        <Link
          to={detailBase}
          className="inline-flex items-center rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen shadow-sm transition hover:bg-brandBeige"
        >
          Back to order form
        </Link>
      </div>
    );
  }

  if (!typeData) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className={`${cardClass} p-6`}>
          <p className="text-sm font-semibold text-brandGreen">
            This item could not be found.
          </p>
        </div>
        <Link
          to={detailBase}
          className="inline-flex items-center rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen shadow-sm transition hover:bg-brandBeige"
        >
          Back to order form
        </Link>
      </div>
    );
  }

  const price = Number(typeData.price ?? 0);
  const specialPrice = typeData.specialPrice;
  const hasSpecial =
    specialPrice !== null &&
    specialPrice !== undefined &&
    Number(specialPrice) > 0;
  const availabilityLabel =
    typeData.available === false ? "Unavailable" : "Available";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className={`${cardClass} p-6 md:p-8`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brandGreen/60">
              {isLivestock ? "Livestock" : "Eggs"}
            </p>
            <h1 className="text-3xl font-bold text-brandGreen">
              {typeData.label ?? "Item details"}
            </h1>
            <p className="text-sm text-brandGreen/70">
              Category: {categoryLabel}
            </p>
          </div>
          <Link
            to={detailBase}
            className="inline-flex items-center justify-center rounded-full bg-brandGreen px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg"
          >
            Order this item
          </Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
        <div className={panelClass}>
          <div className="overflow-hidden rounded-2xl border border-brandGreen/15 bg-white/80">
            {typeData.imageUrl ? (
              <img
                src={typeData.imageUrl}
                alt={typeData.label ?? "Type image"}
                className="h-64 w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-64 w-full items-center justify-center text-sm text-brandGreen/50">
                Image coming soon
              </div>
            )}
          </div>

          {category?.description ? (
            <p className="mt-4 text-sm text-brandGreen/80">
              {category.description}
            </p>
          ) : (
            <p className="mt-4 text-sm text-brandGreen/70">
              More details will be available soon.
            </p>
          )}
        </div>

        <div className={`${panelClass} space-y-4`}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
              Pricing
            </p>
            <div className="mt-2 space-y-1 text-sm text-brandGreen">
              <p>
                Normal price: <span className="font-semibold">{formatCurrency(price)}</span>
              </p>
              {hasSpecial ? (
                <p>
                  Special price:{" "}
                  <span className="font-semibold">
                    {formatCurrency(specialPrice)}
                  </span>
                </p>
              ) : (
                <p className="text-brandGreen/60">No special pricing.</p>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
              Availability
            </p>
            <span
              className={`mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                typeData.available === false
                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                  : "bg-emerald-100 text-emerald-800 border border-emerald-200"
              }`}
            >
              {availabilityLabel}
            </span>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/60">
              Category
            </p>
            <p className="mt-2 text-sm text-brandGreen">{categoryLabel}</p>
          </div>

          <Link
            to={detailBase}
            className="inline-flex w-full items-center justify-center rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen shadow-sm transition hover:bg-brandBeige"
          >
            Back to order form
          </Link>
        </div>
      </div>
    </div>
  );
}
