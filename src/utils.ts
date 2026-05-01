import crypto from "node:crypto";
import path from "node:path";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function sanitizeDriveName(value: string): string {
  const sanitized = normalizeWhitespace(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized.slice(0, 180) || "Amazon Product";
}

export function filenameFromImageUrl(imageUrl: string, index: number): string {
  let filename = `amazon-image-${String(index + 1).padStart(2, "0")}.jpg`;

  try {
    const url = new URL(imageUrl);
    const base = path.posix.basename(url.pathname);
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) {
      filename = decodeURIComponent(base);
    }
  } catch {
    return filename;
  }

  return sanitizeFilename(filename);
}

export function ensureUniqueFilename(
  filename: string,
  usedFilenames: Set<string>,
): string {
  if (!usedFilenames.has(filename)) {
    usedFilenames.add(filename);
    return filename;
  }

  const parsed = path.parse(filename);
  let attempt = 2;
  while (attempt < 10_000) {
    const candidate = `${parsed.name}-${attempt}${parsed.ext}`;
    if (!usedFilenames.has(candidate)) {
      usedFilenames.add(candidate);
      return candidate;
    }
    attempt += 1;
  }

  throw new Error(`Unable to create a unique filename for ${filename}`);
}

export function validateAmazonAeProductUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("URL is not valid.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAmazonAe = hostname === "amazon.ae" || hostname.endsWith(".amazon.ae");
  if (!isAmazonAe) {
    throw new Error("Only Amazon UAE URLs on amazon.ae are supported.");
  }

  const isProductPath = /\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:[/?#]|$)/i.test(
    parsed.pathname,
  );
  if (!isProductPath) {
    throw new Error("URL does not look like an Amazon product page.");
  }

  return parsed;
}

export function createBatchId(now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const suffix = crypto.randomUUID().slice(0, 8);
  return `batch_${stamp}_${suffix}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sanitizeFilename(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized.slice(0, 180) || "amazon-image.jpg";
}
