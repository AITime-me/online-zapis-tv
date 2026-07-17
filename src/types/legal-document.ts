export type LegalDocumentVersionStatusDto = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type LegalDocumentVersionDto = {
  id: string;
  documentId: string;
  versionNumber: number;
  title: string;
  content: string;
  contentHash: string;
  status: LegalDocumentVersionStatusDto;
  createdAt: string;
  publishedAt: string | null;
  createdByUserId: string | null;
};

export type LegalDocumentListItemDto = {
  id: string;
  slug: string;
  title: string;
  publicPath: string | null;
  isPublished: boolean;
  currentPublishedVersionNumber: number | null;
  hasDraft: boolean;
  updatedAt: string;
  requiredForLaunch: boolean;
};

export type LegalDocumentAdminDto = {
  id: string;
  slug: string;
  title: string;
  publicPath: string | null;
  isPublished: boolean;
  requiredForLaunch: boolean;
  currentPublishedVersion: LegalDocumentVersionDto | null;
  draftVersion: LegalDocumentVersionDto | null;
  updatedAt: string;
};

export type LegalDocumentDraftWriteInput = {
  title?: string;
  content?: string;
};

export type PublicLegalDocumentDto = {
  slug: string;
  title: string;
  content: string;
  versionNumber: number;
  contentHash: string;
  updatedAt: string;
};

export type LegalReadinessItemDto = {
  slug: string;
  title: string;
  publicPath: string | null;
  requiredForLaunch: boolean;
  hasPublishedVersion: boolean;
};

export type LegalReadinessDto = {
  ready: boolean;
  missingRequiredSlugs: string[];
  items: LegalReadinessItemDto[];
  blockedPublicForms: string[];
  hasCodeFallback: false;
};
