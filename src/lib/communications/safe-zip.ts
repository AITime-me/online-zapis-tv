import { inflateRawSync } from "node:zlib";

export class SafeZipError extends Error {}

const MAX_ENTRIES = 8;
const MAX_COMPRESSED_ENTRY = 2_000_000;
const MAX_UNCOMPRESSED_TOTAL = 5_000_000;
const MAX_UNCOMPRESSED_ENTRY = 5_000_000;

type ZipLocalFile = {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
};

function readUInt16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function readUInt32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function parseLocalFiles(buf: Buffer): ZipLocalFile[] {
  const files: ZipLocalFile[] = [];
  let offset = 0;

  while (offset + 30 <= buf.length) {
    const signature = readUInt32LE(buf, offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const compressionMethod = readUInt16LE(buf, offset + 8);
    const compressedSize = readUInt32LE(buf, offset + 18);
    const uncompressedSize = readUInt32LE(buf, offset + 22);
    const fileNameLength = readUInt16LE(buf, offset + 26);
    const extraLength = readUInt16LE(buf, offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd + extraLength > buf.length) {
      throw new SafeZipError("Повреждённый ZIP-архив");
    }

    const fileName = buf.subarray(fileNameStart, fileNameEnd).toString("utf8");
    const dataOffset = fileNameEnd + extraLength;

    files.push({
      fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      dataOffset,
    });

    if (compressedSize === 0 && uncompressedSize === 0) {
      // Data descriptor / directory — остановимся, дальше central directory.
      break;
    }

    offset = dataOffset + compressedSize;
    if (files.length > MAX_ENTRIES) {
      throw new SafeZipError("В ZIP слишком много файлов");
    }
  }

  return files;
}

function assertSafeZipPath(fileName: string): void {
  const normalized = fileName.replace(/\\/g, "/");
  if (
    normalized.includes("..") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new SafeZipError("Обнаружен небезопасный путь внутри ZIP (zip-slip)");
  }
}

function inflateEntry(buf: Buffer, entry: ZipLocalFile): Buffer {
  if (entry.compressedSize > MAX_COMPRESSED_ENTRY) {
    throw new SafeZipError("Слишком большой сжатый файл в ZIP");
  }
  if (entry.uncompressedSize > MAX_UNCOMPRESSED_ENTRY) {
    throw new SafeZipError("Слишком большой распакованный файл в ZIP");
  }

  const compressed = buf.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  );

  let raw: Buffer;
  if (entry.compressionMethod === 0) {
    raw = Buffer.from(compressed);
  } else if (entry.compressionMethod === 8) {
    try {
      raw = inflateRawSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_ENTRY });
    } catch {
      throw new SafeZipError("Не удалось распаковать ZIP (возможен zip bomb)");
    }
  } else {
    throw new SafeZipError("Неподдерживаемый метод сжатия в ZIP");
  }

  if (raw.length > MAX_UNCOMPRESSED_ENTRY) {
    throw new SafeZipError("Превышен лимит распаковки ZIP");
  }

  return raw;
}

/**
 * Извлекает ровно один CSV из ZIP. Исходный буфер не сохраняется.
 */
export function extractSingleCsvFromZip(zipBuffer: Buffer): {
  fileName: string;
  csvText: string;
} {
  if (zipBuffer.length > 4_000_000) {
    throw new SafeZipError("ZIP-файл слишком большой");
  }

  const entries = parseLocalFiles(zipBuffer).filter(
    (entry) => !entry.fileName.endsWith("/") && entry.compressedSize > 0,
  );

  if (entries.length === 0) {
    throw new SafeZipError("В ZIP нет файлов");
  }
  if (entries.length > 1) {
    throw new SafeZipError("В ZIP разрешён только один CSV-файл");
  }

  const entry = entries[0]!;
  assertSafeZipPath(entry.fileName);

  if (!/\.csv$/i.test(entry.fileName)) {
    throw new SafeZipError("В ZIP ожидается файл с расширением .csv");
  }

  const raw = inflateEntry(zipBuffer, entry);
  if (raw.length > MAX_UNCOMPRESSED_TOTAL) {
    throw new SafeZipError("Превышен суммарный лимит распаковки");
  }

  // Проверка кодировки: отклоняем явный бинарный мусор.
  if (raw.includes(0)) {
    throw new SafeZipError("Некорректная кодировка CSV внутри ZIP");
  }

  const csvText = raw.toString("utf8");
  return { fileName: entry.fileName.replace(/^.*\//, ""), csvText };
}
