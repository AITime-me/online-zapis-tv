import "server-only";

import {
  LegalDocumentVersionStatus,
  type LegalDocumentVersion,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashLegalDocumentContent } from "@/lib/legal-document/content-hash";
import {
  isRequiredPublishedLegalSlug,
  isSystemLegalDocumentSlug,
  LEGAL_DOCUMENT_ADMIN_TITLES,
  LEGAL_DOCUMENT_PUBLIC_PATHS,
  LEGAL_DOCUMENT_SEED_METADATA,
  REQUIRED_PUBLISHED_LEGAL_SLUGS,
  type SystemLegalDocumentSlug,
} from "@/lib/legal-document/defaults";
import type {
  LegalDocumentAdminDto,
  LegalDocumentDraftWriteInput,
  LegalDocumentListItemDto,
  LegalDocumentVersionDto,
  LegalReadinessDto,
  PublicLegalDocumentDto,
} from "@/types/legal-document";

export class LegalDocumentValidationError extends Error {}

export class LegalDocumentsNotReadyError extends Error {
  readonly missingSlugs: string[];

  constructor(missingSlugs: string[]) {
    super(
      "Юридические документы временно недоступны. Попробуйте отправить заявку позже.",
    );
    this.name = "LegalDocumentsNotReadyError";
    this.missingSlugs = missingSlugs;
  }
}

type Tx = Prisma.TransactionClient;

function mapVersion(row: LegalDocumentVersion): LegalDocumentVersionDto {
  return {
    id: row.id,
    documentId: row.documentId,
    versionNumber: row.versionNumber,
    title: row.title,
    content: row.content,
    contentHash: row.contentHash,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
  };
}

function formatUpdatedAt(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new LegalDocumentValidationError(`${label} не может быть пустым`);
  }
  return trimmed;
}

async function ensureSystemDocumentsExist(tx: Tx | typeof prisma = prisma) {
  for (const meta of LEGAL_DOCUMENT_SEED_METADATA) {
    const existing = await tx.legalDocument.findUnique({
      where: { slug: meta.slug },
      select: { id: true },
    });
    if (existing) continue;

    const created = await tx.legalDocument.create({
      data: {
        slug: meta.slug,
        title: meta.title,
        publicPath: meta.publicPath,
        content: "",
        isPublished: false,
      },
    });

    await tx.legalDocumentVersion.create({
      data: {
        documentId: created.id,
        versionNumber: 1,
        title: meta.title,
        content: "",
        contentHash: hashLegalDocumentContent(""),
        status: LegalDocumentVersionStatus.DRAFT,
      },
    });
  }
}

export async function listLegalDocumentsForAdmin(): Promise<
  LegalDocumentListItemDto[]
> {
  await ensureSystemDocumentsExist();

  const rows = await prisma.legalDocument.findMany({
    orderBy: { slug: "asc" },
    include: {
      currentPublishedVersion: true,
      versions: {
        where: { status: LegalDocumentVersionStatus.DRAFT },
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    publicPath: row.publicPath,
    isPublished: Boolean(row.currentPublishedVersionId),
    currentPublishedVersionNumber:
      row.currentPublishedVersion?.versionNumber ?? null,
    hasDraft: row.versions.length > 0,
    updatedAt: row.updatedAt.toISOString(),
    requiredForLaunch: isRequiredPublishedLegalSlug(row.slug),
  }));
}

export async function getLegalDocumentForAdmin(
  slug: string,
): Promise<LegalDocumentAdminDto | null> {
  await ensureSystemDocumentsExist();

  const row = await prisma.legalDocument.findUnique({
    where: { slug },
    include: {
      currentPublishedVersion: true,
      versions: {
        where: { status: LegalDocumentVersionStatus.DRAFT },
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    publicPath: row.publicPath,
    isPublished: Boolean(row.currentPublishedVersionId),
    requiredForLaunch: isRequiredPublishedLegalSlug(row.slug),
    currentPublishedVersion: row.currentPublishedVersion
      ? mapVersion(row.currentPublishedVersion)
      : null,
    draftVersion: row.versions[0] ? mapVersion(row.versions[0]) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getPublishedLegalDocument(
  slug: string,
): Promise<PublicLegalDocumentDto | null> {
  const row = await prisma.legalDocument.findUnique({
    where: { slug },
    include: { currentPublishedVersion: true },
  });

  const version = row?.currentPublishedVersion;
  if (!row || !version || version.status !== LegalDocumentVersionStatus.PUBLISHED) {
    return null;
  }

  return {
    slug: row.slug,
    title: version.title,
    content: version.content,
    versionNumber: version.versionNumber,
    contentHash: version.contentHash,
    updatedAt: (version.publishedAt ?? version.createdAt).toISOString(),
  };
}

export async function getPublishedVersionRow(slug: string) {
  const row = await prisma.legalDocument.findUnique({
    where: { slug },
    include: { currentPublishedVersion: true },
  });
  if (
    !row?.currentPublishedVersion ||
    row.currentPublishedVersion.status !== LegalDocumentVersionStatus.PUBLISHED
  ) {
    return null;
  }
  return {
    document: row,
    version: row.currentPublishedVersion,
  };
}

export async function saveLegalDocumentDraft(
  slug: string,
  input: LegalDocumentDraftWriteInput,
  createdByUserId?: string | null,
): Promise<LegalDocumentAdminDto> {
  const document = await prisma.legalDocument.findUnique({
    where: { slug },
    include: {
      currentPublishedVersion: true,
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
  });

  if (!document) {
    throw new LegalDocumentValidationError("Документ не найден");
  }

  const existingDraft = await prisma.legalDocumentVersion.findFirst({
    where: {
      documentId: document.id,
      status: LegalDocumentVersionStatus.DRAFT,
    },
    orderBy: { versionNumber: "desc" },
  });

  const baseTitle =
    input.title !== undefined
      ? requireNonEmpty(input.title, "Название документа")
      : existingDraft?.title ??
        document.currentPublishedVersion?.title ??
        document.title;

  const baseContent =
    input.content !== undefined
      ? input.content
      : (existingDraft?.content ?? document.currentPublishedVersion?.content ?? "");

  if (existingDraft) {
    await prisma.legalDocumentVersion.update({
      where: { id: existingDraft.id },
      data: {
        title: baseTitle,
        content: baseContent,
        contentHash: hashLegalDocumentContent(baseContent),
        ...(createdByUserId ? { createdByUserId } : {}),
      },
    });
  } else {
    const nextNumber =
      (document.versions[0]?.versionNumber ??
        document.currentPublishedVersion?.versionNumber ??
        0) + 1;

    await prisma.legalDocumentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: nextNumber,
        title: baseTitle,
        content: baseContent,
        contentHash: hashLegalDocumentContent(baseContent),
        status: LegalDocumentVersionStatus.DRAFT,
        createdByUserId: createdByUserId ?? null,
      },
    });
  }

  await prisma.legalDocument.update({
    where: { id: document.id },
    data: { title: baseTitle },
  });

  const updated = await getLegalDocumentForAdmin(slug);
  if (!updated) {
    throw new LegalDocumentValidationError("Документ не найден после сохранения");
  }
  return updated;
}

export async function createDraftFromPublished(
  slug: string,
  createdByUserId?: string | null,
): Promise<LegalDocumentAdminDto> {
  const document = await prisma.legalDocument.findUnique({
    where: { slug },
    include: { currentPublishedVersion: true },
  });

  if (!document) {
    throw new LegalDocumentValidationError("Документ не найден");
  }

  if (!document.currentPublishedVersion) {
    throw new LegalDocumentValidationError(
      "Нет опубликованной версии для создания черновика",
    );
  }

  const existingDraft = await prisma.legalDocumentVersion.findFirst({
    where: {
      documentId: document.id,
      status: LegalDocumentVersionStatus.DRAFT,
    },
  });

  if (existingDraft) {
    throw new LegalDocumentValidationError(
      "Черновик уже существует — отредактируйте его",
    );
  }

  const latest = await prisma.legalDocumentVersion.findFirst({
    where: { documentId: document.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });

  const published = document.currentPublishedVersion;
  await prisma.legalDocumentVersion.create({
    data: {
      documentId: document.id,
      versionNumber: (latest?.versionNumber ?? published.versionNumber) + 1,
      title: published.title,
      content: published.content,
      contentHash: hashLegalDocumentContent(published.content),
      status: LegalDocumentVersionStatus.DRAFT,
      createdByUserId: createdByUserId ?? null,
    },
  });

  const updated = await getLegalDocumentForAdmin(slug);
  if (!updated) {
    throw new LegalDocumentValidationError("Документ не найден");
  }
  return updated;
}

export async function publishLegalDocumentDraft(
  slug: string,
  createdByUserId?: string | null,
): Promise<LegalDocumentAdminDto> {
  const document = await prisma.legalDocument.findUnique({
    where: { slug },
  });

  if (!document) {
    throw new LegalDocumentValidationError("Документ не найден");
  }

  await prisma.$transaction(async (tx) => {
    const draft = await tx.legalDocumentVersion.findFirst({
      where: {
        documentId: document.id,
        status: LegalDocumentVersionStatus.DRAFT,
      },
      orderBy: { versionNumber: "desc" },
    });

    if (!draft) {
      throw new LegalDocumentValidationError("Нет черновика для публикации");
    }

    requireNonEmpty(draft.title, "Название документа");
    requireNonEmpty(draft.content, "Текст документа");

    if (document.currentPublishedVersionId) {
      await tx.legalDocumentVersion.update({
        where: { id: document.currentPublishedVersionId },
        data: { status: LegalDocumentVersionStatus.ARCHIVED },
      });
    }

    const now = new Date();
    await tx.legalDocumentVersion.update({
      where: { id: draft.id },
      data: {
        status: LegalDocumentVersionStatus.PUBLISHED,
        publishedAt: now,
        contentHash: hashLegalDocumentContent(draft.content),
        ...(createdByUserId ? { createdByUserId } : {}),
      },
    });

    // Legacy columns: sync snapshot only; readers use versions.
    await tx.legalDocument.update({
      where: { id: document.id },
      data: {
        title: draft.title,
        content: draft.content,
        isPublished: true,
        currentPublishedVersionId: draft.id,
      },
    });
  });

  const updated = await getLegalDocumentForAdmin(slug);
  if (!updated) {
    throw new LegalDocumentValidationError("Документ не найден после публикации");
  }
  return updated;
}

export async function getLegalDocumentsReadiness(): Promise<LegalReadinessDto> {
  await ensureSystemDocumentsExist();

  const rows = await prisma.legalDocument.findMany({
    where: {
      slug: { in: [...REQUIRED_PUBLISHED_LEGAL_SLUGS, "marketing-consent"] },
    },
    include: { currentPublishedVersion: true },
  });

  const bySlug = new Map(rows.map((row) => [row.slug, row]));

  const items = SYSTEM_ORDERED_FOR_READINESS.map((slug) => {
    const row = bySlug.get(slug);
    const title =
      row?.title ??
      (isSystemLegalDocumentSlug(slug)
        ? LEGAL_DOCUMENT_ADMIN_TITLES[slug]
        : slug);
    const hasPublishedVersion = Boolean(
      row?.currentPublishedVersion &&
        row.currentPublishedVersion.status ===
          LegalDocumentVersionStatus.PUBLISHED &&
        row.currentPublishedVersion.content.trim().length > 0,
    );

    return {
      slug,
      title,
      publicPath:
        row?.publicPath ??
        (isSystemLegalDocumentSlug(slug)
          ? LEGAL_DOCUMENT_PUBLIC_PATHS[slug]
          : null),
      requiredForLaunch: isRequiredPublishedLegalSlug(slug),
      hasPublishedVersion,
    };
  });

  const missingRequiredSlugs = items
    .filter((item) => item.requiredForLaunch && !item.hasPublishedVersion)
    .map((item) => item.slug);

  const ready = missingRequiredSlugs.length === 0;

  return {
    ready,
    missingRequiredSlugs,
    items,
    blockedPublicForms: ready
      ? []
      : [
          "онлайн-запись",
          "заявка менеджеру",
          "заявка на консультацию",
          "заявка из игры",
        ],
    hasCodeFallback: false,
  };
}

const SYSTEM_ORDERED_FOR_READINESS: SystemLegalDocumentSlug[] = [
  "privacy",
  "consent",
  "terms",
  "offer",
  "cookies",
  "promotions-game-rules",
  "marketing-consent",
];

export async function assertRequiredLegalDocumentsPublished(): Promise<void> {
  const readiness = await getLegalDocumentsReadiness();
  if (!readiness.ready) {
    throw new LegalDocumentsNotReadyError(readiness.missingRequiredSlugs);
  }
}

export function getLegalDocumentUpdatedLabel(updatedAt: string): string {
  return formatUpdatedAt(new Date(updatedAt));
}

export function canEditLegalDocumentSlug(slug: string): boolean {
  return isSystemLegalDocumentSlug(slug) || slug.trim().length > 0;
}

export { isSystemLegalDocumentSlug };
