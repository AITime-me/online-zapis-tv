import "server-only";

import type { GameSession } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveLazyExpirationStatus } from "@/lib/game/session/game-session-expiration-rules";

type DbClient = Pick<typeof prisma, "gameSession">;

export {
  resolveLazyExpirationStatus,
  shouldExpireActiveSession,
  shouldExpireCompletedSession,
} from "@/lib/game/session/game-session-expiration-rules";

export async function expireGameSessionIfNeededWithDb(
  session: GameSession,
  now: Date,
  db: DbClient = prisma,
): Promise<GameSession> {
  const nextStatus = resolveLazyExpirationStatus(session, now);
  if (nextStatus === session.status) {
    return session;
  }

  const updated = await db.gameSession.updateMany({
    where: {
      id: session.id,
      status: session.status,
    },
    data: {
      status: "EXPIRED",
    },
  });

  if (updated.count === 1) {
    return { ...session, status: "EXPIRED" };
  }

  return { ...session, status: "EXPIRED" };
}
