const TYPE_PRICE_NORMAL = "normal";
const TYPE_PRICE_SPECIAL = "special";

export const EGG_INFO_FIELDS = [
  { key: "layingAge", label: "Age they lay eggs" },
  { key: "sexingAge", label: "Age you can sex them" },
  { key: "eggsPerYear", label: "Eggs per year" },
  { key: "colourTypes", label: "Colour types" },
  { key: "lifeSpan", label: "Life Span" },
  { key: "eggColour", label: "Egg Colour" },
  { key: "eggSize", label: "Egg Size" },
];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  if (typeof value === "string") {
    const floatParsed = Number.parseFloat(value);
    if (Number.isFinite(floatParsed)) return floatParsed;
  }
  return fallback;
};

const asString = (value) => (typeof value === "string" ? value : "");

const normalizeId = (value, fallback) => {
  const id = asString(value).trim();
  return id || fallback;
};

export const normalizePriceType = (priceType, specialPrice) => {
  if (priceType === TYPE_PRICE_SPECIAL || priceType === TYPE_PRICE_NORMAL) {
    return priceType;
  }
  return toNumber(specialPrice) > 0 ? TYPE_PRICE_SPECIAL : TYPE_PRICE_NORMAL;
};

export const resolveTypePrice = ({ priceType, price, specialPrice }) => {
  const resolvedPriceType = normalizePriceType(priceType, specialPrice);
  if (resolvedPriceType === TYPE_PRICE_SPECIAL && toNumber(specialPrice) > 0) {
    return toNumber(specialPrice);
  }
  return toNumber(price);
};

const sortImages = (images) =>
  images
    .slice()
    .sort((a, b) => {
      const aOrder = toNumber(a.order, Number.MAX_SAFE_INTEGER);
      const bOrder = toNumber(b.order, Number.MAX_SAFE_INTEGER);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return asString(a.name).localeCompare(asString(b.name));
    })
    .map((image, index) => ({
      ...image,
      order: index,
    }));

export const normalizeTypeImages = (docData = {}) => {
  const sourceImages = Array.isArray(docData.images) ? docData.images : [];
  const normalized = sourceImages
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const url = asString(entry.url).trim();
      if (!url) return null;
      return {
        id: normalizeId(entry.id, `img_${index}`),
        assetId: asString(entry.assetId).trim(),
        url,
        path: asString(entry.path).trim(),
        name: asString(entry.name).trim() || `Image ${index + 1}`,
        order: toNumber(entry.order, index),
        createdAt: entry.createdAt ?? Date.now(),
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) {
    return sortImages(normalized);
  }

  const legacyUrl = asString(docData.imageUrl).trim();
  if (!legacyUrl) return [];

  return [
    {
      id: "legacy_0",
      assetId: "",
      url: legacyUrl,
      path: asString(docData.imagePath).trim(),
      name: asString(docData.imageName).trim() || "Image 1",
      order: 0,
      createdAt: docData.imageUpdatedAt ?? Date.now(),
    },
  ];
};

export const buildPrimaryImageFields = (images = []) => {
  const first = images[0] ?? null;
  return {
    imageUrl: first?.url ?? "",
    imageName: first?.name ?? "",
    imagePath: first?.path ?? "",
  };
};

export const normalizeTypeDoc = (id, docData = {}) => {
  const title = normalizeId(docData.title ?? docData.label, "Unnamed");
  const shortDescription = asString(
    docData.shortDescription ?? docData.description ?? docData.shortDesc
  ).trim();
  const longDescription = asString(
    docData.longDescription ?? docData.longDesc
  ).trim();
  const priceType = normalizePriceType(docData.priceType, docData.specialPrice);
  const price = resolveTypePrice({
    priceType,
    price: docData.price,
    specialPrice: docData.specialPrice,
  });
  const images = normalizeTypeImages(docData);
  const { imageUrl, imageName, imagePath } = buildPrimaryImageFields(images);
  const eggInfo = EGG_INFO_FIELDS.reduce((acc, field) => {
    acc[field.key] = asString(docData[field.key]).trim();
    return acc;
  }, {});

  return {
    id,
    title,
    label: title,
    shortDescription,
    longDescription,
    priceType,
    price,
    legacyPrice: toNumber(docData.price),
    legacySpecialPrice:
      docData.specialPrice === null || docData.specialPrice === undefined
        ? null
        : toNumber(docData.specialPrice),
    order: toNumber(docData.order),
    categoryId: asString(docData.categoryId).trim(),
    categoryName: asString(docData.categoryName || docData.category).trim(),
    available: docData.available !== false,
    images,
    imageUrl,
    imageName,
    imagePath,
    ...eggInfo,
    raw: docData,
  };
};

export const getTypePriceLabel = (type) => {
  const kind =
    normalizePriceType(type?.priceType, type?.legacySpecialPrice) ===
    TYPE_PRICE_SPECIAL
      ? "Special"
      : "Normal";
  return `${kind} price: R${toNumber(type?.price).toFixed(2)}`;
};

export const createTypeDraft = () => ({
  title: "",
  shortDescription: "",
  longDescription: "",
  priceType: TYPE_PRICE_NORMAL,
  price: "",
  categoryId: "",
  available: true,
});

export const TYPE_PRICE_OPTIONS = [
  { id: TYPE_PRICE_NORMAL, label: "Normal" },
  { id: TYPE_PRICE_SPECIAL, label: "Special" },
];

export const MAX_TYPE_IMAGES = 10;
