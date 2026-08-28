import type { BotSettingsPublicationPayloadV1 } from "@/lib/bot-settings/publication-contract";

export type BotSettingsPublicationStatusDto = "ACTIVE" | "SUPERSEDED";

export type BotSettingsPublicationSummaryDto = {
  id: string;
  versionNumber: number;
  status: BotSettingsPublicationStatusDto;
  schemaVersion: number;
  payloadChecksum: string;
  publishedAt: string;
  publishedByUserId: string | null;
  publishedByUserName: string | null;
  sourceUpdatedAt: string;
  supersededAt: string | null;
};

export type BotSettingsPublicationStateDto = {
  draftUpdatedAt: string;
  draftPayloadChecksum: string;
  active: BotSettingsPublicationSummaryDto | null;
  hasUnpublishedChanges: boolean;
  recentPublications: BotSettingsPublicationSummaryDto[];
};

export type BotSettingsPublishOutcome = "PUBLISHED" | "UNCHANGED";

export type BotSettingsPublishResultDto = {
  outcome: BotSettingsPublishOutcome;
  publication: BotSettingsPublicationSummaryDto;
};

export type BotSettingsRuntimePublicationDto = {
  schemaVersion: number;
  publicationId: string;
  version: number;
  checksum: string;
  publishedAt: string;
  sourceUpdatedAt: string;
  settings: BotSettingsPublicationPayloadV1;
};
