import "server-only";

import type {
  CommConsentStatus,
  CommDeliveryStatus,
  Prisma,
} from "@prisma/client";
import { parseCsvContent } from "@/lib/csv/parse-csv";
import { prisma } from "@/lib/db";
import { isEligibleForPromotionalBroadcast } from "@/lib/communications/eligibility";
import { extractSingleCsvFromZip, SafeZipError } from "@/lib/communications/safe-zip";
import {
  isVkMessenger,
  mapSalebotHeaders,
  normalizeVkUserId,
  parseOptionalDateTime,
  parseTruthyFlag,
} from "@/lib/communications/salebot-columns";
import type {
  CommImportCommitResult,
  CommImportPreviewResult,
  CommImportSummary,
} from "@/types/communications";

export const COMM_IMPORT_MAX_ROWS = 10_000;
export const COMM_IMPORT_MAX_CHARS = 5_000_000;
export const COMM_IMPORT_PREVIEW_SAMPLE = 30;
export const DEFAULT_VK_COMMUNITY_ID = "studio";

export class CommunicationsImportValidationError extends Error {}

type ParsedContactRow = {
  rowNumber: number;
  channelUserId: string;
  communityId: string;
  displayName: string | null;
  deliveryStatus: CommDeliveryStatus;
  consentStatus: CommConsentStatus;
  isUnsubscribed: boolean;
  exclusionReason: string | null;
  firstInteractionAt: Date | null;
  lastInteractionAt: Date | null;
  lastInboundAt: Date | null;
  skipReason: string | null;
};

function emptySummary(): CommImportSummary {
  return {
    totalRows: 0,
    vkRows: 0,
    validUniqueVkIds: 0,
    newCount: 0,
    updateCount: 0,
    duplicateInFile: 0,
    blockedCount: 0,
    unsubscribedCount: 0,
    skippedCount: 0,
    potentiallyEligible: 0,
    ineligibleForPromo: 0,
    suppressedPreserved: 0,
  };
}

function cell(
  row: string[],
  index: number | undefined,
): string | null {
  if (index == null) {
    return null;
  }
  const value = row[index];
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodeCsvInput(csvText: string): string {
  if (csvText.length > COMM_IMPORT_MAX_CHARS) {
    throw new CommunicationsImportValidationError(
      "CSV слишком большой. Уменьшите файл и повторите импорт.",
    );
  }
  // UTF-8 уже ожидается; отклоняем NUL.
  if (csvText.includes("\u0000")) {
    throw new CommunicationsImportValidationError(
      "Некорректная кодировка файла",
    );
  }
  return csvText;
}

function parseSalebotCsv(csvText: string): {
  rows: ParsedContactRow[];
  summary: CommImportSummary;
} {
  const decoded = decodeCsvInput(csvText);
  const parsed = parseCsvContent(decoded);
  const map = mapSalebotHeaders(parsed.headers);

  if (map.channelUserId == null && map.messenger == null) {
    throw new CommunicationsImportValidationError(
      "Не найдены обязательные колонки SaleBot (мессенджер / идентификатор)",
    );
  }

  const summary = emptySummary();
  summary.totalRows = parsed.rows.length;

  if (parsed.rows.length > COMM_IMPORT_MAX_ROWS) {
    throw new CommunicationsImportValidationError(
      `Слишком много строк (лимит ${COMM_IMPORT_MAX_ROWS})`,
    );
  }

  const byVkId = new Map<string, ParsedContactRow>();
  const skipped: ParsedContactRow[] = [];

  parsed.rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const messenger = cell(raw, map.messenger);
    const isVk = isVkMessenger(messenger);

    if (!isVk) {
      summary.skippedCount += 1;
      skipped.push({
        rowNumber,
        channelUserId: "",
        communityId: DEFAULT_VK_COMMUNITY_ID,
        displayName: cell(raw, map.name),
        deliveryStatus: "UNKNOWN",
        consentStatus: "UNKNOWN",
        isUnsubscribed: false,
        exclusionReason: "not_vk",
        firstInteractionAt: null,
        lastInteractionAt: null,
        lastInboundAt: null,
        skipReason: "not_vk",
      });
      return;
    }

    summary.vkRows += 1;
    const vkId = normalizeVkUserId(cell(raw, map.channelUserId));
    if (!vkId) {
      summary.skippedCount += 1;
      skipped.push({
        rowNumber,
        channelUserId: "",
        communityId: DEFAULT_VK_COMMUNITY_ID,
        displayName: cell(raw, map.name),
        deliveryStatus: "UNKNOWN",
        consentStatus: "UNKNOWN",
        isUnsubscribed: false,
        exclusionReason: "invalid_vk_id",
        firstInteractionAt: null,
        lastInteractionAt: null,
        lastInboundAt: null,
        skipReason: "invalid_vk_id",
      });
      return;
    }

    const clientBlocked = parseTruthyFlag(cell(raw, map.clientBlocked));
    const notSubscribed = parseTruthyFlag(cell(raw, map.notSubscribed));

    let deliveryStatus: CommDeliveryStatus = "UNKNOWN";
    let consentStatus: CommConsentStatus = "UNKNOWN";
    let isUnsubscribed = false;
    let exclusionReason: string | null = null;

    if (clientBlocked) {
      deliveryStatus = "BLOCKED";
      exclusionReason = "client_blocked";
      summary.blockedCount += 1;
    }

    if (notSubscribed) {
      isUnsubscribed = true;
      consentStatus = "REVOKED";
      exclusionReason = exclusionReason ?? "not_subscribed";
      summary.unsubscribedCount += 1;
    }

    // Отсутствие доказанного согласия ≠ CONFIRMED
    if (!notSubscribed && consentStatus === "UNKNOWN") {
      consentStatus = "UNKNOWN";
    }

    const row: ParsedContactRow = {
      rowNumber,
      channelUserId: vkId,
      communityId: DEFAULT_VK_COMMUNITY_ID,
      displayName: cell(raw, map.name),
      deliveryStatus,
      consentStatus,
      isUnsubscribed,
      exclusionReason,
      firstInteractionAt: parseOptionalDateTime(cell(raw, map.firstInteractionAt)),
      lastInteractionAt: parseOptionalDateTime(cell(raw, map.lastInteractionAt)),
      lastInboundAt: parseOptionalDateTime(cell(raw, map.lastInboundAt)),
      skipReason: null,
    };

    // Phone/email из SaleBot намеренно игнорируются — не пишем в CommunicationContact.
    void cell(raw, map.phone);
    void cell(raw, map.email);

    if (byVkId.has(vkId)) {
      summary.duplicateInFile += 1;
      // Последняя строка побеждает в файле, но считается дублем.
    }
    byVkId.set(vkId, row);
  });

  const uniqueRows = [...byVkId.values()];
  summary.validUniqueVkIds = uniqueRows.length;

  return { rows: uniqueRows, summary };
}

async function classifyAgainstDb(
  rows: ParsedContactRow[],
  summary: CommImportSummary,
): Promise<{
  summary: CommImportSummary;
  rows: ParsedContactRow[];
  suppressedKeys: Set<string>;
}> {
  if (rows.length === 0) {
    return { summary, rows, suppressedKeys: new Set() };
  }

  const channelUserIds = rows.map((row) => row.channelUserId);

  const [existing, suppressions] = await Promise.all([
    prisma.communicationContact.findMany({
      where: {
        channel: "VK",
        communityId: DEFAULT_VK_COMMUNITY_ID,
        channelUserId: { in: channelUserIds },
      },
      select: {
        channelUserId: true,
        deliveryStatus: true,
        consentStatus: true,
        isUnsubscribed: true,
        exclusionReason: true,
      },
    }),
    prisma.communicationSuppression.findMany({
      where: {
        channel: "VK",
        communityId: DEFAULT_VK_COMMUNITY_ID,
        channelUserId: { in: channelUserIds },
      },
      select: { channelUserId: true },
    }),
  ]);

  const existingMap = new Map(existing.map((row) => [row.channelUserId, row]));
  const suppressedKeys = new Set(suppressions.map((row) => row.channelUserId));

  for (const row of rows) {
    const prev = existingMap.get(row.channelUserId);
    if (prev) {
      summary.updateCount += 1;
    } else {
      summary.newCount += 1;
    }

    if (suppressedKeys.has(row.channelUserId)) {
      summary.suppressedPreserved += 1;
    }

    const effectiveDelivery = suppressedKeys.has(row.channelUserId)
      ? ("DENIED" as const)
      : row.deliveryStatus === "UNKNOWN" && prev
        ? prev.deliveryStatus
        : row.deliveryStatus;

    const effectiveConsent = suppressedKeys.has(row.channelUserId)
      ? ("REVOKED" as const)
      : row.consentStatus === "UNKNOWN" && prev?.consentStatus === "REVOKED"
        ? prev.consentStatus
        : row.isUnsubscribed
          ? row.consentStatus
          : prev?.consentStatus === "REVOKED"
            ? "REVOKED"
            : row.consentStatus;

    const effectiveUnsub =
      suppressedKeys.has(row.channelUserId) ||
      row.isUnsubscribed ||
      Boolean(prev?.isUnsubscribed);

    const eligible = isEligibleForPromotionalBroadcast({
      deliveryStatus: effectiveDelivery,
      consentStatus: effectiveConsent,
      isUnsubscribed: effectiveUnsub,
      suppressed: suppressedKeys.has(row.channelUserId),
    });

    if (eligible) {
      summary.potentiallyEligible += 1;
    } else {
      summary.ineligibleForPromo += 1;
    }
  }

  return { summary, rows, suppressedKeys };
}

export async function previewSalebotImport(input: {
  csvText?: string;
  zipBase64?: string;
  originalFileName?: string | null;
  createdByUserId?: string | null;
}): Promise<CommImportPreviewResult> {
  let csvText: string;
  let fileKind: "csv" | "zip" = "csv";
  let originalFileName = input.originalFileName?.trim() || null;

  try {
    if (input.zipBase64) {
      fileKind = "zip";
      const zipBuffer = Buffer.from(input.zipBase64, "base64");
      const extracted = extractSingleCsvFromZip(zipBuffer);
      csvText = extracted.csvText;
      originalFileName = originalFileName ?? extracted.fileName;
    } else if (input.csvText) {
      csvText = input.csvText;
    } else {
      throw new CommunicationsImportValidationError("Не передан файл импорта");
    }
  } catch (error) {
    if (error instanceof SafeZipError) {
      throw new CommunicationsImportValidationError(error.message);
    }
    throw error;
  }

  const parsed = parseSalebotCsv(csvText);
  const classified = await classifyAgainstDb(parsed.rows, parsed.summary);

  const job = await prisma.communicationImportJob.create({
    data: {
      status: "PREVIEWED",
      originalFileName,
      fileKind,
      summary: classified.summary as unknown as Prisma.InputJsonValue,
      createdByUserId: input.createdByUserId ?? null,
    },
  });

  // Строки для apply храним только в памяти следующего запроса через повторный parse —
  // исходный файл не сохраняем. Preview sample без channelUserId.
  const sampleRows = classified.rows.slice(0, COMM_IMPORT_PREVIEW_SAMPLE).map((row) => ({
    rowNumber: row.rowNumber,
    displayName: row.displayName,
    action: (classified.summary.updateCount > 0 && row
      ? "update"
      : "create") as "create" | "update" | "skip",
    reason: row.skipReason,
    deliveryStatus: row.deliveryStatus,
    consentStatus: row.consentStatus,
    isUnsubscribed: row.isUnsubscribed,
  }));

  // Более точный action для sample
  const existingIds = new Set(
    (
      await prisma.communicationContact.findMany({
        where: {
          channel: "VK",
          communityId: DEFAULT_VK_COMMUNITY_ID,
          channelUserId: {
            in: classified.rows
              .slice(0, COMM_IMPORT_PREVIEW_SAMPLE)
              .map((row) => row.channelUserId),
          },
        },
        select: { channelUserId: true },
      })
    ).map((row) => row.channelUserId),
  );

  const sample = classified.rows.slice(0, COMM_IMPORT_PREVIEW_SAMPLE).map((row) => ({
    rowNumber: row.rowNumber,
    displayName: row.displayName,
    action: (existingIds.has(row.channelUserId) ? "update" : "create") as
      | "create"
      | "update"
      | "skip",
    reason: row.skipReason,
    deliveryStatus: row.deliveryStatus,
    consentStatus: row.consentStatus,
    isUnsubscribed: row.isUnsubscribed,
  }));

  void sampleRows;

  return {
    jobId: job.id,
    fileKind,
    originalFileName,
    summary: classified.summary,
    sampleRows: sample,
  };
}

function mergePreservingSuppression(input: {
  incoming: ParsedContactRow;
  existing: {
    deliveryStatus: CommDeliveryStatus;
    consentStatus: CommConsentStatus;
    isUnsubscribed: boolean;
    exclusionReason: string | null;
    displayName: string | null;
    firstInteractionAt: Date | null;
    lastInteractionAt: Date | null;
    lastInboundAt: Date | null;
  } | null;
  suppressed: boolean;
}): {
  deliveryStatus: CommDeliveryStatus;
  consentStatus: CommConsentStatus;
  isUnsubscribed: boolean;
  exclusionReason: string | null;
  displayName: string | null;
  firstInteractionAt: Date | null;
  lastInteractionAt: Date | null;
  lastInboundAt: Date | null;
} {
  const existing = input.existing;

  if (input.suppressed) {
    return {
      deliveryStatus: "DENIED",
      consentStatus: "REVOKED",
      isUnsubscribed: true,
      exclusionReason: existing?.exclusionReason ?? input.incoming.exclusionReason ?? "suppression",
      displayName: input.incoming.displayName ?? existing?.displayName ?? null,
      firstInteractionAt:
        existing?.firstInteractionAt ?? input.incoming.firstInteractionAt,
      lastInteractionAt:
        input.incoming.lastInteractionAt ?? existing?.lastInteractionAt ?? null,
      lastInboundAt: input.incoming.lastInboundAt ?? existing?.lastInboundAt ?? null,
    };
  }

  // Suppression precedence: не снимаем ранее установленный запрет.
  const deliveryStatus: CommDeliveryStatus =
    existing?.deliveryStatus === "BLOCKED" || existing?.deliveryStatus === "DENIED"
      ? existing.deliveryStatus
      : input.incoming.deliveryStatus === "BLOCKED" ||
          input.incoming.deliveryStatus === "DENIED"
        ? input.incoming.deliveryStatus
        : existing?.deliveryStatus === "ALLOWED" &&
            input.incoming.deliveryStatus === "UNKNOWN"
          ? "ALLOWED"
          : input.incoming.deliveryStatus;

  const consentStatus: CommConsentStatus =
    existing?.consentStatus === "REVOKED" || input.incoming.consentStatus === "REVOKED"
      ? "REVOKED"
      : existing?.consentStatus === "CONFIRMED" &&
          input.incoming.consentStatus === "UNKNOWN"
        ? "CONFIRMED"
        : input.incoming.consentStatus;

  const isUnsubscribed =
    Boolean(existing?.isUnsubscribed) || input.incoming.isUnsubscribed;

  return {
    deliveryStatus,
    consentStatus,
    isUnsubscribed,
    exclusionReason:
      isUnsubscribed || deliveryStatus === "BLOCKED" || deliveryStatus === "DENIED"
        ? input.incoming.exclusionReason ?? existing?.exclusionReason ?? null
        : null,
    displayName: input.incoming.displayName ?? existing?.displayName ?? null,
    firstInteractionAt:
      existing?.firstInteractionAt ?? input.incoming.firstInteractionAt,
    lastInteractionAt:
      input.incoming.lastInteractionAt ?? existing?.lastInteractionAt ?? null,
    lastInboundAt: input.incoming.lastInboundAt ?? existing?.lastInboundAt ?? null,
  };
}

export async function commitSalebotImport(input: {
  csvText?: string;
  zipBase64?: string;
  originalFileName?: string | null;
  jobId?: string | null;
  createdByUserId?: string | null;
}): Promise<CommImportCommitResult> {
  let csvText: string;
  let fileKind: "csv" | "zip" = "csv";
  let originalFileName = input.originalFileName?.trim() || null;

  try {
    if (input.zipBase64) {
      fileKind = "zip";
      const extracted = extractSingleCsvFromZip(Buffer.from(input.zipBase64, "base64"));
      csvText = extracted.csvText;
      originalFileName = originalFileName ?? extracted.fileName;
    } else if (input.csvText) {
      csvText = input.csvText;
    } else {
      throw new CommunicationsImportValidationError("Не передан файл импорта");
    }
  } catch (error) {
    if (error instanceof SafeZipError) {
      throw new CommunicationsImportValidationError(error.message);
    }
    throw error;
  }

  const parsed = parseSalebotCsv(csvText);
  const classified = await classifyAgainstDb(parsed.rows, parsed.summary);

  let created = 0;
  let updated = 0;
  let suppressedUpserts = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of classified.rows) {
      const suppressed = classified.suppressedKeys.has(row.channelUserId);
      const existing = await tx.communicationContact.findUnique({
        where: {
          channel_communityId_channelUserId: {
            channel: "VK",
            communityId: row.communityId,
            channelUserId: row.channelUserId,
          },
        },
      });

      const merged = mergePreservingSuppression({
        incoming: row,
        existing,
        suppressed,
      });

      if (
        row.deliveryStatus === "BLOCKED" ||
        row.isUnsubscribed ||
        merged.consentStatus === "REVOKED" ||
        merged.deliveryStatus === "DENIED" ||
        merged.deliveryStatus === "BLOCKED"
      ) {
        await tx.communicationSuppression.upsert({
          where: {
            channel_communityId_channelUserId: {
              channel: "VK",
              communityId: row.communityId,
              channelUserId: row.channelUserId,
            },
          },
          create: {
            channel: "VK",
            communityId: row.communityId,
            channelUserId: row.channelUserId,
            reason: merged.exclusionReason ?? "import_exclusion",
            source: "SALEBOT_IMPORT",
          },
          update: {
            reason: merged.exclusionReason ?? "import_exclusion",
            source: "SALEBOT_IMPORT",
          },
        });
        suppressedUpserts += 1;
      }

      const data = {
        displayName: merged.displayName,
        source: "SALEBOT_IMPORT" as const,
        firstInteractionAt: merged.firstInteractionAt,
        lastInteractionAt: merged.lastInteractionAt,
        lastInboundAt: merged.lastInboundAt,
        deliveryStatus: merged.deliveryStatus,
        consentStatus: merged.consentStatus,
        consentSource: merged.consentStatus === "REVOKED" ? "SALEBOT_IMPORT" : null,
        consentVersion: null,
        consentActionAt: merged.consentStatus === "REVOKED" ? new Date() : null,
        consentAction: merged.consentStatus === "REVOKED" ? "REVOKED" : null,
        isUnsubscribed: merged.isUnsubscribed,
        exclusionReason: merged.exclusionReason,
        // Никогда не создаём Client автоматически.
        clientId: existing?.clientId ?? null,
      };

      if (existing) {
        await tx.communicationContact.update({
          where: { id: existing.id },
          data,
        });
        updated += 1;
        await tx.communicationEvent.create({
          data: {
            type: "IMPORTED",
            contactId: existing.id,
            metadata: { action: "update" },
          },
        });
      } else {
        const createdContact = await tx.communicationContact.create({
          data: {
            channel: "VK",
            communityId: row.communityId,
            channelUserId: row.channelUserId,
            ...data,
          },
        });
        created += 1;
        await tx.communicationEvent.create({
          data: {
            type: "IMPORTED",
            contactId: createdContact.id,
            metadata: { action: "create" },
          },
        });
      }
    }

    const summary: CommImportSummary = {
      ...classified.summary,
      newCount: created,
      updateCount: updated,
    };

    if (input.jobId) {
      await tx.communicationImportJob.update({
        where: { id: input.jobId },
        data: {
          status: "APPLIED",
          summary: summary as unknown as Prisma.InputJsonValue,
          appliedAt: new Date(),
          originalFileName,
          fileKind,
          createdByUserId: input.createdByUserId ?? undefined,
        },
      });
    } else {
      await tx.communicationImportJob.create({
        data: {
          status: "APPLIED",
          originalFileName,
          fileKind,
          summary: summary as unknown as Prisma.InputJsonValue,
          createdByUserId: input.createdByUserId ?? null,
          appliedAt: new Date(),
        },
      });
    }
  });

  return {
    jobId: input.jobId ?? "",
    status: "APPLIED",
    summary: {
      ...classified.summary,
      newCount: created,
      updateCount: updated,
    },
    created,
    updated,
    suppressedUpserts,
  };
}

export async function listImportJobs(limit = 20) {
  const jobs = await prisma.communicationImportJob.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      originalFileName: true,
      fileKind: true,
      summary: true,
      appliedAt: true,
      createdAt: true,
      errorMessage: true,
    },
  });
  return jobs;
}
