import type { ClientDuplicateReviewStatus, ClientStatus } from "@prisma/client";

export type DuplicateConfidence = "HIGH" | "MEDIUM" | "LOW";

export type DuplicateMatchReason =
  | "SAME_NORMALIZED_PHONE"
  | "SAME_EMAIL"
  | "SAME_PHONE_SUFFIX"
  | "SAME_NAME_WITH_CONTACT"
  | "SAME_NAME_DIFFERENT_CONTACTS";

export type ClientDuplicateMemberDto = {
  id: string;
  fullName: string;
  phone: string | null;
  normalizedPhone: string | null;
  email: string | null;
  status: ClientStatus;
  source: string | null;
  tags: string[];
  bookingRequestCount: number;
  lastContactAt: string | null;
  createdAt: string;
  isArchived: boolean;
};

export type ClientDuplicateGroupDto = {
  fingerprint: string;
  confidence: DuplicateConfidence;
  reasons: DuplicateMatchReason[];
  reviewStatus: ClientDuplicateReviewStatus;
  note: string | null;
  clients: ClientDuplicateMemberDto[];
};

export type ClientDuplicateSummaryDto = {
  totalGroups: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  needsReview: number;
  postponed: number;
  notDuplicate: number;
};

export type ClientDuplicateFilters = {
  confidence?: DuplicateConfidence | "all";
  reviewStatus?: ClientDuplicateReviewStatus | "all";
  q?: string;
};

export const DUPLICATE_REASON_LABELS: Record<DuplicateMatchReason, string> = {
  SAME_NORMALIZED_PHONE: "Одинаковый нормализованный телефон",
  SAME_EMAIL: "Одинаковый email",
  SAME_PHONE_SUFFIX: "Совпадают последние 10 цифр телефона",
  SAME_NAME_WITH_CONTACT: "Похожее ФИО и совпадение контакта",
  SAME_NAME_DIFFERENT_CONTACTS:
    "Очень похожее ФИО без совпадения контактов",
};

export const DUPLICATE_CONFIDENCE_LABELS: Record<DuplicateConfidence, string> = {
  HIGH: "Высокая",
  MEDIUM: "Средняя",
  LOW: "Низкая",
};

export const DUPLICATE_REVIEW_STATUS_LABELS: Record<
  ClientDuplicateReviewStatus,
  string
> = {
  REVIEW: "Требует проверки",
  NOT_DUPLICATE: "Не дубль",
  POSTPONED: "Отложено",
};
