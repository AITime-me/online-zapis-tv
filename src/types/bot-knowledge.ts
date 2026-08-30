import type { BotKnowledgeCategoryId } from "@/lib/bot-knowledge/publication-contract";

export type BotKnowledgeEntryDto = {
  id: string;
  stableKey: string;
  category: BotKnowledgeCategoryId;
  title: string;
  content: string;
  tags: string[];
  serviceId: string | null;
  servicePublicName: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  updatedByUserName: string | null;
};

export type BotKnowledgeEntryWriteInput = {
  stableKey?: string;
  category?: BotKnowledgeCategoryId;
  title?: string;
  content?: string;
  tags?: string[];
  serviceId?: string | null;
  isEnabled?: boolean;
};

export type BotKnowledgeEntryCreateInput = {
  stableKey: string;
  category: BotKnowledgeCategoryId;
  title: string;
  content: string;
  tags?: string[];
  serviceId?: string | null;
  isEnabled?: boolean;
};

export type BotKnowledgePublicationStatusDto = "ACTIVE" | "SUPERSEDED";

export type BotKnowledgePublicationSummaryDto = {
  id: string;
  versionNumber: number;
  status: BotKnowledgePublicationStatusDto;
  schemaVersion: number;
  payloadChecksum: string;
  publishedAt: string;
  publishedByUserId: string | null;
  publishedByUserName: string | null;
  entryCount: number;
  supersededAt: string | null;
};

export type BotKnowledgePublicationStateDto = {
  workspaceUpdatedAt: string | null;
  draftPayloadChecksum: string;
  active: BotKnowledgePublicationSummaryDto | null;
  hasUnpublishedChanges: boolean;
  recentPublications: BotKnowledgePublicationSummaryDto[];
  enabledEntryCount: number;
};

export type BotKnowledgePublishOutcome = "PUBLISHED" | "UNCHANGED";

export type BotKnowledgePublishResultDto = {
  outcome: BotKnowledgePublishOutcome;
  publication: BotKnowledgePublicationSummaryDto;
};

export type BotKnowledgeRuntimePublicationDto = {
  schemaVersion: number;
  knowledgePublicationId: string;
  version: number;
  checksum: string;
  publishedAt: string;
  entries: Array<{
    key: string;
    category: BotKnowledgeCategoryId;
    title: string;
    content: string;
    tags: string[];
    serviceId: string | null;
  }>;
};

export type BotKnowledgeServiceOptionDto = {
  id: string;
  publicName: string;
};

/** Managed KB draft import file (schemaVersion=1). Not a publication payload. */
export type BotKnowledgeImportEntryV1 = {
  key: string;
  category: BotKnowledgeCategoryId;
  title: string;
  content: string;
  tags: string[];
  serviceId: string | null;
};

export type BotKnowledgeImportFileV1 = {
  schemaVersion: 1;
  entries: BotKnowledgeImportEntryV1[];
};

export type BotKnowledgeImportResultDto = {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
};
