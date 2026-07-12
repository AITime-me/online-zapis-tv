import type { GameSessionStatus } from "@prisma/client";

export function shouldExpireActiveSession(
  session: { status: GameSessionStatus; playExpiresAt: Date },
  now: Date,
): boolean {
  return session.status === "ACTIVE" && now.getTime() >= session.playExpiresAt.getTime();
}

export function shouldExpireCompletedSession(
  session: { status: GameSessionStatus; claimExpiresAt: Date | null },
  now: Date,
): boolean {
  return (
    session.status === "COMPLETED" &&
    session.claimExpiresAt !== null &&
    now.getTime() >= session.claimExpiresAt.getTime()
  );
}

export function resolveLazyExpirationStatus(
  session: {
    status: GameSessionStatus;
    playExpiresAt: Date;
    claimExpiresAt: Date | null;
  },
  now: Date,
): GameSessionStatus {
  if (shouldExpireActiveSession(session, now)) {
    return "EXPIRED";
  }
  if (shouldExpireCompletedSession(session, now)) {
    return "EXPIRED";
  }
  return session.status;
}
