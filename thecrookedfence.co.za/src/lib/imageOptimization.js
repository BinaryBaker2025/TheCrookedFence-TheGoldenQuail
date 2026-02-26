const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const DEFAULT_MAX_LONG_EDGE = 1920;
const DEFAULT_QUALITY = 0.82;

const normalizeMimeType = (value) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "image/jpg") return "image/jpeg";
  return raw;
};

const loadImageFromFile = (file) =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode image file."));
    };

    image.src = objectUrl;
  });

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas export returned an empty blob."));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });

export const optimizeImageForUpload = async (file, options = {}) => {
  const originalBytes = Number(file?.size ?? 0);

  if (!(file instanceof File)) {
    return {
      file,
      optimized: false,
      originalBytes,
      optimizedBytes: originalBytes,
      reason: "not_a_file",
    };
  }

  const type = normalizeMimeType(file.type);
  if (!SUPPORTED_IMAGE_TYPES.has(type)) {
    return {
      file,
      optimized: false,
      originalBytes,
      optimizedBytes: originalBytes,
      reason: "unsupported_type",
    };
  }

  if (typeof document === "undefined") {
    return {
      file,
      optimized: false,
      originalBytes,
      optimizedBytes: originalBytes,
      reason: "non_browser_environment",
    };
  }

  const maxLongEdge = Number(options.maxLongEdge || DEFAULT_MAX_LONG_EDGE);
  const quality = Number(options.quality || DEFAULT_QUALITY);

  try {
    const image = await loadImageFromFile(file);
    const sourceWidth = Number(image.naturalWidth || image.width || 0);
    const sourceHeight = Number(image.naturalHeight || image.height || 0);
    if (!sourceWidth || !sourceHeight) {
      return {
        file,
        optimized: false,
        originalBytes,
        optimizedBytes: originalBytes,
        reason: "invalid_dimensions",
      };
    }

    const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
    const scale =
      sourceLongEdge > maxLongEdge ? maxLongEdge / sourceLongEdge : 1;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      return {
        file,
        optimized: false,
        originalBytes,
        optimizedBytes: originalBytes,
        reason: "context_unavailable",
      };
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const blob = await canvasToBlob(canvas, type, quality);

    const optimizedFile = new File([blob], file.name, {
      type,
      lastModified: Date.now(),
    });
    const optimizedBytes = Number(optimizedFile.size || 0);

    if (!optimizedBytes || optimizedBytes >= originalBytes) {
      return {
        file,
        optimized: false,
        originalBytes,
        optimizedBytes: originalBytes,
        reason: "not_smaller",
      };
    }

    return {
      file: optimizedFile,
      optimized: true,
      originalBytes,
      optimizedBytes,
      reason: "optimized",
    };
  } catch (_error) {
    return {
      file,
      optimized: false,
      originalBytes,
      optimizedBytes: originalBytes,
      reason: "optimization_failed",
    };
  }
};
