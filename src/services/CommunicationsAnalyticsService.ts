import "server-only";

import type { CommEventType } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  COMM_CHANNEL_ACCEPT_LABEL,
  resolveReadStatusSemantics,
} from "@/lib/communications/read-status";
import type { CommAnalyticsSummary } from "@/types/communications";

async function countEvent(type: CommEventType): Promise<{
  total: number;
  uniqueContacts: number;
}> {
  const [total, unique] = await Promise.all([
    prisma.communicationEvent.count({ where: { type } }),
    prisma.communicationEvent.groupBy({
      by: ["contactId"],
      where: { type, contactId: { not: null } },
    }),
  ]);
  return {
    total,
    uniqueContacts: unique.length,
  };
}

export async function getCommunicationsAnalyticsSummary(): Promise<CommAnalyticsSummary> {
  const [
    imported,
    excluded,
    queued,
    acceptedByChannel,
    sendError,
    readConfirmed,
    buttonClicked,
    linkOpened,
    replied,
    unsubscribed,
    leadCreated,
    appointmentCreated,
  ] = await Promise.all([
    countEvent("IMPORTED"),
    countEvent("EXCLUDED"),
    countEvent("QUEUED"),
    countEvent("ACCEPTED_BY_CHANNEL"),
    countEvent("SEND_ERROR"),
    countEvent("READ_CONFIRMED"),
    countEvent("BUTTON_CLICKED"),
    countEvent("LINK_OPENED"),
    countEvent("REPLY_RECEIVED"),
    countEvent("UNSUBSCRIBED"),
    countEvent("LEAD_CREATED"),
    countEvent("APPOINTMENT_CREATED"),
  ]);

  const readSemantics = resolveReadStatusSemantics(readConfirmed.total > 0);

  return {
    imported,
    excluded,
    queued,
    acceptedByChannel: { ...acceptedByChannel, label: COMM_CHANNEL_ACCEPT_LABEL },
    sendError,
    readConfirmed: {
      ...readConfirmed,
      label: readSemantics.label,
    },
    readNotConfirmedLabel: resolveReadStatusSemantics(false).label,
    buttonClicked,
    linkOpened,
    replied,
    unsubscribed,
    leadCreated,
    appointmentCreated,
    note:
      "Реальные события SENT / READ_CONFIRMED / VK callback на этом этапе не генерируются. Показаны только события foundation (импорт и подготовка).",
  };
}
