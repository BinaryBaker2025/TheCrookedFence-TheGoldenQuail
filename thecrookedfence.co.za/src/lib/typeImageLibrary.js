const asString = (value) => (typeof value === "string" ? value : "");

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stableHash = (value) => {
  const input = asString(value);
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
};

export const toLibraryAssetDocId = (pathOrStableKey) => {
  const normalized = asString(pathOrStableKey).trim().toLowerCase();
  if (!normalized) {
    return `asset_${Date.now().toString(36)}`;
  }
  return `asset_${stableHash(normalized)}`;
};

export const normalizeLibraryAsset = (docLike) => {
  const data = docLike?.data ? docLike.data() : docLike || {};
  const id = asString(docLike?.id || data.id).trim();
  return {
    id,
    name: asString(data.name).trim() || "Image",
    url: asString(data.url).trim(),
    path: asString(data.path).trim(),
    contentType: asString(data.contentType).trim(),
    sizeBytes: toNumber(data.sizeBytes, 0),
    width:
      data.width === null || data.width === undefined
        ? null
        : toNumber(data.width, null),
    height:
      data.height === null || data.height === undefined
        ? null
        : toNumber(data.height, null),
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    createdByUid: asString(data.createdByUid).trim(),
    createdByEmail: asString(data.createdByEmail).trim(),
    source: asString(data.source).trim() || "upload",
  };
};

export const buildTypeImageFromLibraryAsset = (asset, order = 0) => ({
  id:
    `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  assetId: asString(asset?.id).trim(),
  url: asString(asset?.url).trim(),
  path: asString(asset?.path).trim(),
  name: asString(asset?.name).trim() || `Image ${order + 1}`,
  order,
  createdAt: Date.now(),
});
