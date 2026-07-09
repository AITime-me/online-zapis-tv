import type { ClientStatus } from "@prisma/client";
import type { ClientImportColumnMapping } from "@/lib/clients/import-columns";

export type ClientImportRowAction =
  | "create"
  | "update"
  | "error"
  | "duplicate"
  | "skip";

export type ClientImportRowData = {
  fullName: string;
  phone: string | null;
  normalizedPhone: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  status: ClientStatus | null;
  source: string | null;
  tags: string[];
  notes: string | null;
  loyaltyLevel: string | null;
  bonusBalance: number | null;
  totalSpent: number | null;
  lastVisitAt: string | null;
  lastContactAt: string | null;
  isArchived: boolean | null;
};

export type ClientImportPreviewRow = {
  rowNumber: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  tags: string[];
  action: ClientImportRowAction;
  reason: string | null;
  existingClientId: string | null;
};

export type ClientImportCommitRow = {
  rowNumber: number;
  action: "create" | "update";
  existingClientId: string | null;
  data: ClientImportRowData;
};

export type ClientImportSummary = {
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  errors: number;
  duplicates: number;
  skipped: number;
  noContacts: number;
};

export type ClientImportPreviewResult = {
  delimiter: ";" | ",";
  columnMapping: ClientImportColumnMapping[];
  summary: ClientImportSummary;
  previewRows: ClientImportPreviewRow[];
  commitRows: ClientImportCommitRow[];
};

export type ClientImportCommitResult = {
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ rowNumber: number; error: string }>;
};
