import { prisma } from "@/lib/db";
import { isSystemLegalDocumentSlug } from "@/lib/legal-document/defaults";
import type {
  LegalDocumentDto,
  LegalDocumentListItemDto,
  LegalDocumentWriteInput,
  PublicLegalDocumentDto,
} from "@/types/legal-document";
import type { LegalDocument } from "@prisma/client";

export class LegalDocumentValidationError extends Error {}

function mapDocument(row: LegalDocument): LegalDocumentDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    isPublished: row.isPublished,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapListItem(row: LegalDocument): LegalDocumentListItemDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    isPublished: row.isPublished,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPublicDocument(row: LegalDocument): PublicLegalDocumentDto {
  return {
    slug: row.slug,
    title: row.title,
    content: row.content,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new LegalDocumentValidationError(`${label} не может быть пустым`);
  }
  return trimmed;
}

function formatUpdatedAt(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export async function listLegalDocumentsForAdmin(): Promise<LegalDocumentListItemDto[]> {
  const rows = await prisma.legalDocument.findMany({
    orderBy: { slug: "asc" },
  });
  return rows.map(mapListItem);
}

export async function getLegalDocumentForAdmin(
  slug: string,
): Promise<LegalDocumentDto | null> {
  const row = await prisma.legalDocument.findUnique({ where: { slug } });
  return row ? mapDocument(row) : null;
}

export async function getPublishedLegalDocument(
  slug: string,
): Promise<PublicLegalDocumentDto | null> {
  const row = await prisma.legalDocument.findUnique({ where: { slug } });
  if (!row || !row.isPublished) {
    return null;
  }
  return mapPublicDocument(row);
}

export async function updateLegalDocument(
  slug: string,
  input: LegalDocumentWriteInput,
): Promise<LegalDocumentDto> {
  const existing = await prisma.legalDocument.findUnique({ where: { slug } });
  if (!existing) {
    throw new LegalDocumentValidationError("Документ не найден");
  }

  const data: {
    title?: string;
    content?: string;
    isPublished?: boolean;
  } = {};

  if (input.title !== undefined) {
    data.title = requireNonEmpty(input.title, "Название документа");
  }
  if (input.content !== undefined) {
    data.content = requireNonEmpty(input.content, "Текст документа");
  }
  if (input.isPublished !== undefined) {
    data.isPublished = input.isPublished;
  }

  const updated = await prisma.legalDocument.update({
    where: { slug },
    data,
  });

  return mapDocument(updated);
}

export function getLegalDocumentUpdatedLabel(updatedAt: string): string {
  return formatUpdatedAt(new Date(updatedAt));
}

export function canEditLegalDocumentSlug(slug: string): boolean {
  return isSystemLegalDocumentSlug(slug) || slug.trim().length > 0;
}

export { isSystemLegalDocumentSlug };
