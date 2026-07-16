import "server-only";

import { prisma } from "@/lib/db";
import {
  resolveCommunicationsConnectorState,
  COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
} from "@/lib/communications/connector";
import { getCommunicationDeliveryProvider } from "@/lib/communications/delivery-provider";
import { COMM_TEST_SEND_BLOCKED_REASON } from "@/lib/communications/composer-labels";
import { ensureSystemSegments } from "@/services/CommunicationsSegmentService";

export const DEFAULT_COMMUNICATION_SETTINGS_ID = "default";

export async function ensureCommunicationSettings() {
  await prisma.communicationSettings.upsert({
    where: { id: DEFAULT_COMMUNICATION_SETTINGS_ID },
    create: {
      id: DEFAULT_COMMUNICATION_SETTINGS_ID,
      vkConnectorReady: false,
      workerReady: false,
      defaultCommunityId: "studio",
    },
    update: {},
  });
  await ensureSystemSegments();
}

export async function updateCommunicationSettings(input: {
  testContactId?: string | null;
}) {
  await ensureCommunicationSettings();
  if (input.testContactId) {
    const contact = await prisma.communicationContact.findUnique({
      where: { id: input.testContactId },
    });
    if (!contact) {
      throw new Error("Тестовый контакт не найден");
    }
  }
  return prisma.communicationSettings.update({
    where: { id: DEFAULT_COMMUNICATION_SETTINGS_ID },
    data: {
      ...(input.testContactId !== undefined
        ? { testContactId: input.testContactId }
        : {}),
    },
  });
}

export async function getCommunicationsFoundationState() {
  await ensureCommunicationSettings();
  const settings = await prisma.communicationSettings.findUniqueOrThrow({
    where: { id: DEFAULT_COMMUNICATION_SETTINGS_ID },
    include: {
      testContact: {
        select: {
          id: true,
          displayName: true,
          channel: true,
        },
      },
    },
  });

  const connector = resolveCommunicationsConnectorState(
    settings.vkConnectorReady,
  );
  const provider = getCommunicationDeliveryProvider();

  const [contactsTotal, eligibleHint, campaignsTotal, importJobsTotal] =
    await Promise.all([
      prisma.communicationContact.count(),
      prisma.communicationContact.count({
        where: {
          deliveryStatus: "ALLOWED",
          consentStatus: "CONFIRMED",
          isUnsubscribed: false,
        },
      }),
      prisma.communicationCampaign.count(),
      prisma.communicationImportJob.count(),
    ]);

  return {
    settings: {
      id: settings.id,
      vkConnectorReady: false,
      workerReady: false,
      defaultCommunityId: settings.defaultCommunityId,
      testContactId: settings.testContactId,
      testContact: settings.testContact
        ? {
            id: settings.testContact.id,
            displayName: settings.testContact.displayName,
            channel: settings.testContact.channel,
          }
        : null,
    },
    connector,
    provider: provider.getReadiness(),
    bannerMessage: COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
    testSendBlockedReason: COMM_TEST_SEND_BLOCKED_REASON,
    counts: {
      contactsTotal,
      eligibleHint,
      campaignsTotal,
      importJobsTotal,
    },
  };
}
