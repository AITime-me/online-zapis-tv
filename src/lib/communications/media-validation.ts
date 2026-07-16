/**
 * Безопасная проверка изображений: MIME + magic bytes. Без network.
 */

export const COMM_MEDIA_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const COMM_MEDIA_MAX_STORED_BYTES = 1_500_000;
export const COMM_MEDIA_MAX_WIDTH = 4096;
export const COMM_MEDIA_MAX_HEIGHT = 4096;
export const COMM_MEDIA_MAX_ASSETS = 200;

export type AllowedCommImageMime = "image/jpeg" | "image/png" | "image/webp";

export class CommMediaValidationError extends Error {}

function hasJpegMagic(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function hasPngMagic(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function hasWebpMagic(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

export function detectImageMimeFromMagic(
  buffer: Buffer,
): AllowedCommImageMime | null {
  if (hasJpegMagic(buffer)) {
    return "image/jpeg";
  }
  if (hasPngMagic(buffer)) {
    return "image/png";
  }
  if (hasWebpMagic(buffer)) {
    return "image/webp";
  }
  return null;
}

export function assertAllowedImageUpload(input: {
  buffer: Buffer;
  declaredMime?: string | null;
  fileName?: string | null;
}): AllowedCommImageMime {
  if (input.buffer.length === 0) {
    throw new CommMediaValidationError("Пустой файл изображения");
  }
  if (input.buffer.length > COMM_MEDIA_MAX_UPLOAD_BYTES) {
    throw new CommMediaValidationError(
      "Файл слишком большой. Максимум 5 МБ.",
    );
  }

  const fileName = (input.fileName ?? "").toLowerCase();
  if (
    fileName.includes("..") ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("\0")
  ) {
    throw new CommMediaValidationError("Некорректное имя файла");
  }
  if (/\.(svg|html?|js|exe|dll|bat|cmd|php|sh)$/i.test(fileName)) {
    throw new CommMediaValidationError("Этот тип файла запрещён");
  }

  const magicMime = detectImageMimeFromMagic(input.buffer);
  if (!magicMime) {
    throw new CommMediaValidationError(
      "Разрешены только JPEG, PNG и WebP. SVG и другие форматы запрещены.",
    );
  }

  const declared = (input.declaredMime ?? "").toLowerCase().trim();
  if (declared && declared !== magicMime) {
    // Поддельное расширение/MIME
    if (
      declared === "image/svg+xml" ||
      declared === "text/html" ||
      declared === "application/octet-stream"
    ) {
      throw new CommMediaValidationError("Недопустимый тип изображения");
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/jpg"].includes(declared)) {
      throw new CommMediaValidationError(
        "MIME не соответствует содержимому файла",
      );
    }
    if (declared === "image/jpg" && magicMime === "image/jpeg") {
      return magicMime;
    }
    if (declared !== magicMime) {
      throw new CommMediaValidationError(
        "MIME не соответствует содержимому файла",
      );
    }
  }

  return magicMime;
}
