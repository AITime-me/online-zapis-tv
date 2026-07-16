import type {
  CommButtonStyle,
  CommButtonType,
  CommCampaignStatus,
  CommConsentStatus,
  CommContactSource,
  CommDeliveryStatus,
  CommEventType,
  CommImportJobStatus,
} from "@prisma/client";

export type CommContactListItem = {
  id: string;
  channel: "VK";
  communityId: string;
  /** Полный технический ID — только для OWNER UI, не для клиентских логов. */
  channelUserId: string;
  displayName: string | null;
  clientId: string | null;
  source: CommContactSource;
  deliveryStatus: CommDeliveryStatus;
  consentStatus: CommConsentStatus;
  isUnsubscribed: boolean;
  exclusionReason: string | null;
  tags: string[];
  firstInteractionAt: string | null;
  lastInteractionAt: string | null;
  lastInboundAt: string | null;
  eligibleForPromo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CommImportSummary = {
  totalRows: number;
  vkRows: number;
  validUniqueVkIds: number;
  newCount: number;
  updateCount: number;
  duplicateInFile: number;
  blockedCount: number;
  unsubscribedCount: number;
  skippedCount: number;
  potentiallyEligible: number;
  ineligibleForPromo: number;
  suppressedPreserved: number;
};

export type CommImportPreviewResult = {
  jobId: string;
  fileKind: "csv" | "zip";
  originalFileName: string | null;
  summary: CommImportSummary;
  sampleRows: Array<{
    rowNumber: number;
    displayName: string | null;
    action: "create" | "update" | "skip";
    reason: string | null;
    deliveryStatus: CommDeliveryStatus;
    consentStatus: CommConsentStatus;
    isUnsubscribed: boolean;
  }>;
};

export type CommImportCommitResult = {
  jobId: string;
  status: CommImportJobStatus;
  summary: CommImportSummary;
  created: number;
  updated: number;
  suppressedUpserts: number;
};

export type CommSegmentDto = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  definition: unknown;
  isSystem: boolean;
  estimatedCount: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CommCampaignButtonInput = {
  text: string;
  type: CommButtonType;
  buttonKey: string;
  action?: string | null;
  url?: string | null;
  promotionId?: string | null;
  sortOrder?: number;
  style?: CommButtonStyle;
};

export type CommCampaignButtonDto = CommCampaignButtonInput & {
  id: string;
  style: CommButtonStyle;
  sortOrder: number;
};

export type CommCampaignDto = {
  id: string;
  name: string;
  slug: string;
  status: CommCampaignStatus;
  segmentId: string | null;
  segmentKey: string | null;
  segmentName: string | null;
  messageText: string;
  imageUrl: string | null;
  scheduledAt: string | null;
  attributionWindowHours: number;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string | null;
  buttons: CommCampaignButtonDto[];
  audienceEstimate: number | null;
  stats: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CommCampaignPreview = {
  messageText: string;
  buttons: CommCampaignButtonDto[];
  imageUrl: string | null;
  audienceEstimate: number;
  connectorMessage: string;
  canSend: false;
};

export type CommAnalyticsSummary = {
  imported: { total: number; uniqueContacts: number };
  excluded: { total: number; uniqueContacts: number };
  queued: { total: number; uniqueContacts: number };
  acceptedByChannel: { total: number; uniqueContacts: number; label: string };
  sendError: { total: number; uniqueContacts: number };
  readConfirmed: { total: number; uniqueContacts: number; label: string };
  readNotConfirmedLabel: string;
  buttonClicked: { total: number; uniqueContacts: number };
  linkOpened: { total: number; uniqueContacts: number };
  replied: { total: number; uniqueContacts: number };
  unsubscribed: { total: number; uniqueContacts: number };
  leadCreated: { total: number; uniqueContacts: number };
  appointmentCreated: { total: number; uniqueContacts: number };
  note: string;
};

export type CommEventTypeLabel = Record<CommEventType, string>;

export const COMM_EVENT_TYPE_LABELS: CommEventTypeLabel = {
  IMPORTED: "Импортирован",
  EXCLUDED: "Исключён",
  QUEUED: "Поставлен в очередь",
  ACCEPTED_BY_CHANNEL: "Принято VK",
  SEND_ERROR: "Ошибка отправки",
  READ_CONFIRMED: "Прочтение подтверждено",
  BUTTON_CLICKED: "Нажали кнопку",
  LINK_OPENED: "Перешли по ссылке",
  REPLY_RECEIVED: "Ответили",
  UNSUBSCRIBED: "Отписка",
  LEAD_CREATED: "Оставили заявку",
  APPOINTMENT_CREATED: "Записались",
};

export const COMM_DELIVERY_STATUS_LABELS: Record<CommDeliveryStatus, string> = {
  UNKNOWN: "Неизвестно",
  ALLOWED: "Разрешена отправка",
  DENIED: "Запрещена",
  BLOCKED: "Заблокирован",
};

export const COMM_CONSENT_STATUS_LABELS: Record<CommConsentStatus, string> = {
  UNKNOWN: "Не подтверждено",
  CONFIRMED: "Подтверждено",
  REVOKED: "Отозвано",
};

export const COMM_SOURCE_LABELS: Record<CommContactSource, string> = {
  SALEBOT_IMPORT: "Импорт SaleBot",
  VK_WEBHOOK: "VK webhook",
  MANUAL: "Вручную",
};

export const COMM_CAMPAIGN_STATUS_LABELS: Record<CommCampaignStatus, string> = {
  DRAFT: "Черновик",
  READY: "Готова",
  SCHEDULED: "Запланирована",
  RUNNING: "Запущена",
  PAUSED: "Пауза",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
  FAILED: "Ошибка",
};

export const COMM_BUTTON_TYPE_LABELS: Record<CommButtonType, string> = {
  REPLY_TEXT: "Ответ текстом",
  CALLBACK: "Callback",
  OPEN_LINK: "Ссылка",
  UNSUBSCRIBE: "Отписка",
};

export const COMM_BUTTON_STYLE_LABELS: Record<CommButtonStyle, string> = {
  PRIMARY: "PRIMARY",
  POSITIVE: "POSITIVE",
  NEGATIVE: "NEGATIVE",
  SECONDARY: "SECONDARY",
};
