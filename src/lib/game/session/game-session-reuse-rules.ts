export type SessionPlayReuseSnapshot = {
  leadId: string | null;
  consumedAt: Date | null;
} | null;

export type SessionReuseInput = {
  status: string;
  play: SessionPlayReuseSnapshot;
};

export function isPlayRewardConsumed(play: SessionPlayReuseSnapshot): boolean {
  if (!play) {
    return false;
  }
  return play.leadId !== null || play.consumedAt !== null;
}

export function shouldReuseSessionForStart(input: SessionReuseInput): boolean {
  if (input.status === "ACTIVE") {
    return true;
  }

  if (input.status === "COMPLETED") {
    if (!input.play) {
      return false;
    }
    return !isPlayRewardConsumed(input.play);
  }

  return false;
}

export function isSessionTerminalForNewAttempt(status: string): boolean {
  return status === "CONSUMED" || status === "EXPIRED";
}

export function resolveEffectiveSessionStatus(input: {
  status: string;
  play: SessionPlayReuseSnapshot;
}): string {
  if (input.status === "COMPLETED" && isPlayRewardConsumed(input.play)) {
    return "CONSUMED";
  }
  return input.status;
}

export function canRestartSession(input: SessionReuseInput): boolean {
  const effectiveStatus = resolveEffectiveSessionStatus(input);
  if (effectiveStatus === "CONSUMED" || effectiveStatus === "EXPIRED") {
    return false;
  }
  if (isPlayRewardConsumed(input.play)) {
    return false;
  }
  return effectiveStatus === "ACTIVE" || effectiveStatus === "COMPLETED";
}
