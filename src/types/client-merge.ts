import type { ClientStatus } from "@prisma/client";

export type ClientMergePreviewClient = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: ClientStatus;
  isArchived: boolean;
  mergedIntoClientId: string | null;
  bookingRequestCount: number;
  appointmentCount: number;
  tags: string[];
  notes: string | null;
  bonusBalance: number;
  totalSpent: number;
  lastContactAt: string | null;
  createdAt: string;
};

export type ClientMergePreviewCounts = {
  bookingRequestsToMove: number;
  appointmentsToMove: number;
  tagsToMerge: number;
  notesToAppend: number;
  bonusBalanceTotal: number;
  totalSpentTotal: number;
};

export type ClientMergePreviewWarning =
  | "ARCHIVED_CLIENTS"
  | "ALREADY_MERGED"
  | "DIFFERENT_PHONES"
  | "DIFFERENT_EMAILS"
  | "DIFFERENT_NAMES"
  | "BONUS_WILL_SUM"
  | "TOTAL_SPENT_WILL_SUM";

export type ClientMergePreviewResult = {
  clients: ClientMergePreviewClient[];
  recommendedTargetClientId: string;
  counts: ClientMergePreviewCounts;
  warnings: ClientMergePreviewWarning[];
  mergedTagsPreview: string[];
  notesPreview: string | null;
};

export type ClientMergeCommitResult = {
  mergeLogId: string;
  targetClientId: string;
  sourceClientIds: string[];
};

export const MERGE_WARNING_LABELS: Record<ClientMergePreviewWarning, string> = {
  ARCHIVED_CLIENTS: "В группе есть архивные клиенты",
  ALREADY_MERGED: "Некоторые клиенты уже объединены в другого",
  DIFFERENT_PHONES: "У клиентов разные телефоны",
  DIFFERENT_EMAILS: "У клиентов разные email",
  DIFFERENT_NAMES: "У клиентов разные ФИО",
  BONUS_WILL_SUM: "Бонусные балансы будут сложены",
  TOTAL_SPENT_WILL_SUM: "Общие суммы будут сложены",
};
