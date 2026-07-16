import "server-only";

import { prisma } from "@/lib/db";
import {
  resolveCommunicationsConnectorState,
  COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
} from "@/lib/communications/connector";
import { ensureSystemSegments } from "@/services/CommunicationsSegmentService";

export const DEFAULT_COMMUNICATION_SETTINGS_ID = "default";

export async function ensureCommunicationSettings() {
  await prisma.communicationSettings.upsert({
    where: { id: DEFAULT_COMMUNICATION_SETTINGS_ID },
    create: {
      id: DEFAULT_COMMUNICATION_SETTINGS_ID,
      vkConnectorReady: false,
      defaultCommunityId: "studio",
    },
    update: {},
  });
  await ensureSystemSegments();
}

export async function getCommunicationsFoundationState() {
  await ensureCommunicationSettings();
  const settings = await prisma.communicationSettings.findUniqueOrThrow({
    where: { id: DEFAULT_COMMUNICATION_SETTINGS_ID },
  });

  const connector = resolveCommunicationsConnectorState(
    settings.vkConnectorReady,
  );

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
      defaultCommunityId: settings.defaultCommunityId,
    },
    connector,
    bannerMessage: COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
    counts: {
      contactsTotal,
      eligibleHint,
      campaignsTotal,
      importJobsTotal,
    },
  };
}
