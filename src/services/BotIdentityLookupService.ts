import "server-only";

import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone/normalize-phone";

export type BotIdentityLookupResult =
  | { outcome: "UNIQUE"; clientId: string }
  | { outcome: "NONE" }
  | { outcome: "AMBIGUOUS" };

export function classifyBotIdentityLookupRows(
  rows: ReadonlyArray<{ id: string }>,
): BotIdentityLookupResult {
  if (rows.length === 0) return { outcome: "NONE" };
  if (rows.length !== 1) return { outcome: "AMBIGUOUS" };
  return { outcome: "UNIQUE", clientId: rows[0]!.id };
}

/**
 * Narrow bot-to-bot identity boundary. It deliberately returns no client
 * attributes: the caller receives an internal client UUID only after an exact,
 * unique normalized-phone match.
 */
export async function lookupClientIdForBotIdentity(
  phone: string,
): Promise<BotIdentityLookupResult> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { outcome: "NONE" };
  }

  const rows = await prisma.client.findMany({
    where: {
      normalizedPhone,
      isArchived: false,
      mergedIntoClientId: null,
    },
    select: { id: true },
    take: 2,
    orderBy: { id: "asc" },
  });

  return classifyBotIdentityLookupRows(rows);
}
