import { describe, expect, it } from "vitest";
import {
  buildPrimaryImageFields,
  normalizePriceType,
  normalizeTypeDoc,
  resolveTypePrice,
} from "./typeCatalog.js";

describe("typeCatalog", () => {
  it("defaults to normal pricing when no special price applies", () => {
    expect(normalizePriceType(undefined, 0)).toBe("normal");
    expect(resolveTypePrice({ priceType: "normal", price: 15, specialPrice: 40 })).toBe(15);
  });

  it("uses special pricing when special price is valid", () => {
    expect(normalizePriceType(undefined, 22)).toBe("special");
    expect(resolveTypePrice({ priceType: "special", price: 15, specialPrice: 22 })).toBe(22);
  });

  it("normalizes type docs and exposes primary image fields", () => {
    const doc = normalizeTypeDoc("type_1", {
      title: "Blue Layer",
      price: 12,
      images: [
        { id: "img1", url: "https://example.com/a.jpg", order: 1 },
        { id: "img0", url: "https://example.com/b.jpg", order: 0 },
      ],
    });

    expect(doc.id).toBe("type_1");
    expect(doc.title).toBe("Blue Layer");
    expect(doc.images[0].url).toBe("https://example.com/b.jpg");
    expect(buildPrimaryImageFields(doc.images)).toEqual({
      imageUrl: "https://example.com/b.jpg",
      imageName: "Image 2",
      imagePath: "",
    });
  });
});
