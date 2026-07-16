import "server-only";

import { prisma } from "@/lib/db";
import {
  buildPublicRedirectPath,
  buildTrackedRedirectTarget,
  COMM_REDIRECT_TOKEN_TTL_MS,
  generateOpaqueRedirectToken,
  hashRedirectToken,
} from "@/lib/communications/redirect-token";

export class CommunicationsRedirectValidationError extends Error {}

/**
 * Создаёт непрозрачный redirect token. Связь campaign/contact/button хранится на сервере.
 * Токен не содержит и не отдаёт PII.
 */
export async function createRedirectToken(input: {
  campaignId: string;
  contactId?: string | null;
  buttonKey: string;
  targetUrl: string;
  campaignSlug: string;
  utmSource?: string;
  utmMedium?: string;
}): Promise<{ token: string; publicPath: string; expiresAt: Date }> {
  const campaign = await prisma.communicationCampaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, slug: true },
  });
  if (!campaign) {
    throw new CommunicationsRedirectValidationError("Кампания не найдена");
  }

  const targetPath = buildTrackedRedirectTarget({
    targetUrl: input.targetUrl,
    campaignSlug: input.campaignSlug || campaign.slug,
    buttonKey: input.buttonKey,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
  });

  const token = generateOpaqueRedirectToken();
  const tokenHash = hashRedirectToken(token);
  const expiresAt = new Date(Date.now() + COMM_REDIRECT_TOKEN_TTL_MS);

  await prisma.communicationRedirectToken.create({
    data: {
      tokenHash,
      campaignId: input.campaignId,
      contactId: input.contactId ?? null,
      buttonKey: input.buttonKey,
      targetPath,
      expiresAt,
    },
  });

  return {
    token,
    publicPath: buildPublicRedirectPath(token),
    expiresAt,
  };
}

export async function resolveRedirectToken(token: string): Promise<{
  targetPath: string;
  expired: boolean;
}> {
  if (!token || token.length < 16 || token.length > 128) {
    throw new CommunicationsRedirectValidationError("Некорректный токен");
  }

  const tokenHash = hashRedirectToken(token);
  const row = await prisma.communicationRedirectToken.findUnique({
    where: { tokenHash },
  });

  if (!row) {
    throw new CommunicationsRedirectValidationError("Токен не найден");
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return { targetPath: "/", expired: true };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.communicationRedirectToken.update({
      where: { id: row.id },
      data: {
        clickCount: { increment: 1 },
        firstClickedAt: row.firstClickedAt ?? now,
        lastClickedAt: now,
      },
    });

    await tx.communicationEvent.create({
      data: {
        type: "LINK_OPENED",
        campaignId: row.campaignId,
        contactId: row.contactId,
        buttonKey: row.buttonKey,
        metadata: {
          clickCountAfter: row.clickCount + 1,
        },
      },
    });
  });

  return { targetPath: row.targetPath, expired: false };
}
