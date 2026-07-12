import "server-only";

import { prisma } from "@/lib/db";
import {
  buildCatalogSessionCookieName,
  readRequestCookie,
} from "@/lib/game/session/game-session-cookie";
import type { GamePlayBookingRow } from "@/lib/game/game-booking-consume-rules";

export {
  buildServerGameBookingComment,
  extractGameBookingCommentForPayload,
  GAME_BOOKING_UNAVAILABLE_MESSAGE,
  GAME_INVALID_REQUEST_CODE,
  resolveGameGiftFromPlay,
  resolveGamePlayIdInput,
  sessionTokenMatchesHash,
  validateGameBookingForFirstSubmit,
  validateGameBookingForIdempotentRetry,
  validateGamePlayIdFormat,
  type GamePlayBookingRow,
  type GamePlayIdResolution,
} from "@/lib/game/game-booking-consume-rules";

export function readGameSessionTokenFromRequest(
  request: Request,
  catalogSlug: string,
): string | null {
  const cookieHeader = request.headers.get("cookie");
  const cookieName = buildCatalogSessionCookieName(catalogSlug);
  return readRequestCookie(cookieHeader, cookieName);
}

export async function loadGamePlayForBooking(
  gamePlayId: string,
): Promise<GamePlayBookingRow | null> {
  return prisma.gamePlay.findUnique({
    where: { id: gamePlayId },
    select: {
      id: true,
      gameDirection: true,
      gameCatalogId: true,
      gameSessionId: true,
      selectedGiftId: true,
      leadId: true,
      consumedAt: true,
      giftSnapshot: true,
      rulesSnapshot: true,
      selectedGift: {
        select: { name: true, shortDescription: true },
      },
      gameCatalog: {
        select: { id: true, slug: true, title: true },
      },
      gameSession: {
        select: {
          id: true,
          gameCatalogId: true,
          tokenHash: true,
          status: true,
          claimExpiresAt: true,
          consumedAt: true,
        },
      },
    },
  });
}
