import "server-only";

import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import {
  assertAllowedImageUpload,
  COMM_MEDIA_MAX_ASSETS,
  COMM_MEDIA_MAX_HEIGHT,
  COMM_MEDIA_MAX_STORED_BYTES,
  COMM_MEDIA_MAX_WIDTH,
  CommMediaValidationError,
} from "@/lib/communications/media-validation";

export { CommMediaValidationError };

export type CommMediaAssetDto = {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  checksumSha256: string;
  createdAt: string;
};

export async function uploadCampaignImage(input: {
  buffer: Buffer;
  declaredMime?: string | null;
  fileName?: string | null;
  userId?: string | null;
}): Promise<CommMediaAssetDto> {
  const mime = assertAllowedImageUpload({
    buffer: input.buffer,
    declaredMime: input.declaredMime,
    fileName: input.fileName,
  });

  const count = await prisma.communicationMediaAsset.count();
  if (count >= COMM_MEDIA_MAX_ASSETS) {
    throw new CommMediaValidationError(
      "Достигнут лимит изображений. Удалите неиспользуемые.",
    );
  }

  let pipeline = sharp(input.buffer, { failOn: "error" }).rotate();
  const meta = await pipeline.metadata();
  if (!meta.width || !meta.height) {
    throw new CommMediaValidationError("Не удалось прочитать размеры изображения");
  }
  if (meta.width > COMM_MEDIA_MAX_WIDTH || meta.height > COMM_MEDIA_MAX_HEIGHT) {
    pipeline = pipeline.resize({
      width: COMM_MEDIA_MAX_WIDTH,
      height: COMM_MEDIA_MAX_HEIGHT,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // Перекодирование снимает EXIF/метаданные.
  let output: Buffer;
  let outMime: string;
  if (mime === "image/png") {
    output = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    outMime = "image/png";
  } else if (mime === "image/webp") {
    output = await pipeline.webp({ quality: 82 }).toBuffer();
    outMime = "image/webp";
  } else {
    output = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    outMime = "image/jpeg";
  }

  if (output.length > COMM_MEDIA_MAX_STORED_BYTES) {
    output = await sharp(output)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    outMime = "image/jpeg";
  }

  if (output.length > COMM_MEDIA_MAX_STORED_BYTES) {
    throw new CommMediaValidationError(
      "После оптимизации файл всё ещё слишком большой",
    );
  }

  const outMeta = await sharp(output).metadata();
  const checksum = createHash("sha256").update(output).digest("hex");

  const row = await prisma.communicationMediaAsset.create({
    data: {
      id: randomUUID(),
      mimeType: outMime,
      width: outMeta.width ?? 0,
      height: outMeta.height ?? 0,
      byteSize: output.length,
      checksumSha256: checksum,
      data: new Uint8Array(output),
      originalFileName: null,
      createdByUserId: input.userId ?? null,
    },
  });

  return {
    id: row.id,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getMediaAssetBytes(id: string): Promise<{
  mimeType: string;
  data: Buffer;
} | null> {
  const row = await prisma.communicationMediaAsset.findUnique({
    where: { id },
    select: { mimeType: true, data: true },
  });
  if (!row) {
    return null;
  }
  return { mimeType: row.mimeType, data: Buffer.from(row.data) };
}

export async function deleteMediaAsset(id: string): Promise<void> {
  const linked = await prisma.communicationCampaign.count({
    where: { mediaAssetId: id, status: { in: ["RUNNING", "SCHEDULED", "COMPLETED"] } },
  });
  if (linked > 0) {
    throw new CommMediaValidationError(
      "Нельзя удалить изображение, привязанное к активной или завершённой рассылке",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.communicationCampaign.updateMany({
      where: { mediaAssetId: id, status: { in: ["DRAFT", "READY"] } },
      data: { mediaAssetId: null, imageUrl: null },
    });
    await tx.communicationMediaAsset.delete({ where: { id } });
  });
}
