import { useEffect } from "react";

const SITE_NAME = "The Crooked Fence";
const DEFAULT_SITE_URL = "https://thecrookedfence.co.za";
const DEFAULT_DESCRIPTION =
  "Order fertile eggs and livestock from The Crooked Fence. Browse available types and submit your order online.";
const DEFAULT_IMAGE_PATH = "/TCFLogoWhiteBackground.png";

const normalizeBaseUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_SITE_URL;

  try {
    const parsed = new URL(raw);
    const normalizedPath =
      parsed.pathname === "/"
        ? ""
        : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${normalizedPath}`;
  } catch (_error) {
    return DEFAULT_SITE_URL;
  }
};

const SITE_URL = normalizeBaseUrl(
  import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL
);

const toAbsoluteUrl = (value, { preserveExternal = false } = {}) => {
  const raw = String(value || "").trim();
  if (!raw) return `${SITE_URL}/`;

  if (/^https?:\/\//i.test(raw)) {
    if (preserveExternal) return raw;
    try {
      const parsed = new URL(raw);
      const normalizedPath =
        parsed.pathname === "/"
          ? "/"
          : parsed.pathname.replace(/\/+$/, "");
      return `${SITE_URL}${normalizedPath}${parsed.search}${parsed.hash}`;
    } catch (_error) {
      return `${SITE_URL}/`;
    }
  }

  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const normalizedPath =
    withLeadingSlash === "/"
      ? "/"
      : withLeadingSlash.replace(/\/+$/, "");
  return `${SITE_URL}${normalizedPath}`;
};

const upsertMeta = (attr, key, content) => {
  if (!key || content === undefined || content === null) return;
  const value = String(content);
  const escapedKey = key.replace(/"/g, '\\"');
  let node = document.head.querySelector(`meta[${attr}="${escapedKey}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attr, key);
    document.head.appendChild(node);
  }
  node.setAttribute("content", value);
};

const upsertCanonical = (href) => {
  const rel = "canonical";
  let node = document.head.querySelector(`link[rel="${rel}"]`);
  if (!node) {
    node = document.createElement("link");
    node.setAttribute("rel", rel);
    document.head.appendChild(node);
  }
  node.setAttribute("href", href);
};

export const useSeo = ({
  title = SITE_NAME,
  description = DEFAULT_DESCRIPTION,
  path = "/",
  image = DEFAULT_IMAGE_PATH,
  type = "website",
  robots = "index,follow",
  twitterCard = "summary_large_image",
} = {}) => {
  useEffect(() => {
    const nextTitle = String(title || SITE_NAME).trim() || SITE_NAME;
    const nextDescription =
      String(description || DEFAULT_DESCRIPTION).trim() || DEFAULT_DESCRIPTION;
    const canonicalUrl = toAbsoluteUrl(path);
    const imageUrl = toAbsoluteUrl(image, { preserveExternal: true });

    document.title = nextTitle;

    upsertMeta("name", "description", nextDescription);
    upsertMeta("name", "robots", robots);

    upsertMeta("property", "og:title", nextTitle);
    upsertMeta("property", "og:description", nextDescription);
    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:url", canonicalUrl);
    upsertMeta("property", "og:image", imageUrl);
    upsertMeta("property", "og:site_name", SITE_NAME);

    upsertMeta("name", "twitter:card", twitterCard);
    upsertMeta("name", "twitter:title", nextTitle);
    upsertMeta("name", "twitter:description", nextDescription);
    upsertMeta("name", "twitter:image", imageUrl);

    upsertCanonical(canonicalUrl);
  }, [title, description, path, image, type, robots, twitterCard]);
};

export { DEFAULT_IMAGE_PATH, DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL };
