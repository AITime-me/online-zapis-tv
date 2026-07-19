/**
 * Server-side gift activation conditions (single paid service vs course).
 * Texts and validity are snapshotted at result time — never trust client body.
 */

export const GAME_GIFT_ACTIVATION_MODES = [
  "SINGLE_PAID_SERVICE",
  "COURSE_MIN_SESSIONS",
] as const;

export type GameGiftActivationMode = (typeof GAME_GIFT_ACTIVATION_MODES)[number];

export const GIFT_VALIDITY_DAYS = 30;
export const DEFAULT_COURSE_MIN_SESSIONS = 5;
export const MIN_COURSE_SESSIONS_MIN = 1;
export const MIN_COURSE_SESSIONS_MAX = 100;
/** Server-side max length for client-facing activation condition text. */
export const ACTIVATION_CONDITION_TEXT_MAX_LENGTH = 500;

export const LEGACY_ACTIVATION_CONDITION_TEXT =
  "Условие получения — по правилам подарка на момент игры (зафиксируйте у менеджера)";

/** Shown before play — exact condition appears with the result. */
export const PRE_GAME_ACTIVATION_HINT =
  "Условия получения зависят от выпавшего подарка и будут показаны вместе с результатом";

/** Shared stacking rule shown next to the gift-specific condition. */
export const GIFT_STACKING_RULE_TEXT =
  "Игровые подарки не суммируются: один подарок действует на одну разовую запись или один оплаченный курс";

export const GIFT_MANAGER_CONFIRMATION_TEXT =
  "Применение подарка подтверждает менеджер (оплата и факт покупки курса — вручную)";

export const SINGLE_PAID_SERVICE_CONDITION_TEXT =
  "Подарок предоставляется при записи на одну оплачиваемую процедуру по выпавшему направлению";

export function buildCourseMinSessionsConditionText(
  minSessions: number,
): string {
  return `Подарок предоставляется при покупке курса минимум из ${minSessions} процедур по выпавшему направлению. Один подарок действует на один оплаченный курс`;
}

export function isGameGiftActivationMode(
  value: unknown,
): value is GameGiftActivationMode {
  return (
    typeof value === "string" &&
    (GAME_GIFT_ACTIVATION_MODES as readonly string[]).includes(value)
  );
}

export function generateActivationConditionText(
  mode: GameGiftActivationMode,
  minCourseSessions: number | null,
): string {
  if (mode === "COURSE_MIN_SESSIONS") {
    const sessions =
      minCourseSessions && minCourseSessions > 0
        ? minCourseSessions
        : DEFAULT_COURSE_MIN_SESSIONS;
    return buildCourseMinSessionsConditionText(sessions);
  }
  return SINGLE_PAID_SERVICE_CONDITION_TEXT;
}

export type GiftActivationInput = {
  activationMode: GameGiftActivationMode;
  minCourseSessions: number | null;
  activationConditionText: string;
};

export type GiftActivationValidationResult =
  | { ok: true; value: GiftActivationInput }
  | { ok: false; error: string };

export function validateGiftActivationInput(input: {
  activationMode: unknown;
  minCourseSessions?: unknown;
  activationConditionText?: unknown;
}): GiftActivationValidationResult {
  if (!isGameGiftActivationMode(input.activationMode)) {
    return {
      ok: false,
      error:
        "Режим получения подарка должен быть SINGLE_PAID_SERVICE или COURSE_MIN_SESSIONS",
    };
  }

  const mode = input.activationMode;
  let minCourseSessions: number | null = null;

  if (mode === "SINGLE_PAID_SERVICE") {
    if (
      input.minCourseSessions !== undefined &&
      input.minCourseSessions !== null &&
      input.minCourseSessions !== ""
    ) {
      const parsed = toPositiveInt(input.minCourseSessions);
      if (parsed !== null) {
        // Ignore leftover course count when switching to single — normalize to null.
        minCourseSessions = null;
      }
    }
  } else {
    const parsed = toPositiveInt(input.minCourseSessions);
    if (parsed === null) {
      return {
        ok: false,
        error:
          "Для курса укажите минимальное количество процедур (целое число от 1 до 100)",
      };
    }
    if (parsed < MIN_COURSE_SESSIONS_MIN || parsed > MIN_COURSE_SESSIONS_MAX) {
      return {
        ok: false,
        error: `Минимальное количество процедур курса: от ${MIN_COURSE_SESSIONS_MIN} до ${MIN_COURSE_SESSIONS_MAX}`,
      };
    }
    minCourseSessions = parsed;
  }

  const rawText =
    typeof input.activationConditionText === "string"
      ? input.activationConditionText.trim()
      : "";
  if (rawText.length > ACTIVATION_CONDITION_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Текст условия получения не должен превышать ${ACTIVATION_CONDITION_TEXT_MAX_LENGTH} символов`,
    };
  }
  const activationConditionText =
    rawText || generateActivationConditionText(mode, minCourseSessions);

  if (!activationConditionText.trim()) {
    return { ok: false, error: "Текст условия получения не может быть пустым" };
  }
  if (activationConditionText.length > ACTIVATION_CONDITION_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Текст условия получения не должен превышать ${ACTIVATION_CONDITION_TEXT_MAX_LENGTH} символов`,
    };
  }

  return {
    ok: true,
    value: {
      activationMode: mode,
      minCourseSessions,
      activationConditionText,
    },
  };
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      const n = Math.trunc(parsed);
      return n > 0 ? n : null;
    }
  }
  return null;
}

/** Canonical activation rules for the four seeded Catch-Time gifts. */
export const CANONICAL_GIFT_ACTIVATION: Readonly<
  Record<
    string,
    {
      activationMode: GameGiftActivationMode;
      minCourseSessions: number | null;
    }
  >
> = {
  "11111111-1111-4111-8111-111111111111": {
    activationMode: "SINGLE_PAID_SERVICE",
    minCourseSessions: null,
  },
  "22222222-2222-4222-8222-222222222222": {
    activationMode: "COURSE_MIN_SESSIONS",
    minCourseSessions: DEFAULT_COURSE_MIN_SESSIONS,
  },
  "33333333-3333-4333-8333-333333333333": {
    activationMode: "COURSE_MIN_SESSIONS",
    minCourseSessions: DEFAULT_COURSE_MIN_SESSIONS,
  },
  "44444444-4444-4444-8444-444444444444": {
    activationMode: "COURSE_MIN_SESSIONS",
    minCourseSessions: DEFAULT_COURSE_MIN_SESSIONS,
  },
};

export function resolveCanonicalGiftActivation(giftId: string): {
  activationMode: GameGiftActivationMode;
  minCourseSessions: number | null;
  activationConditionText: string;
} | null {
  const rule = CANONICAL_GIFT_ACTIVATION[giftId];
  if (!rule) {
    return null;
  }
  return {
    activationMode: rule.activationMode,
    minCourseSessions: rule.minCourseSessions,
    activationConditionText: generateActivationConditionText(
      rule.activationMode,
      rule.minCourseSessions,
    ),
  };
}

/** Client body keys that must never drive gift activation / snapshot. */
export const FORBIDDEN_CLIENT_GIFT_ACTIVATION_KEYS = [
  "giftId",
  "giftSnapshot",
  "activationMode",
  "minCourseSessions",
  "activationConditionText",
  "validityDays",
  "activationCondition",
  "giftActivation",
] as const;

export function collectForbiddenClientGiftActivationKeys(
  body: Record<string, unknown>,
): string[] {
  return FORBIDDEN_CLIENT_GIFT_ACTIVATION_KEYS.filter((key) => key in body);
}

/**
 * Runtime reject for client-supplied gift activation / snapshot fields.
 * Returns a safe public error string (does not echo values).
 */
export function rejectForbiddenClientGiftActivationFields(
  body: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: true };
  }
  const forbidden = collectForbiddenClientGiftActivationKeys(
    body as Record<string, unknown>,
  );
  if (forbidden.length === 0) {
    return { ok: true };
  }
  const first = forbidden[0]!;
  return { ok: false, error: `${first} не поддерживается` };
}

export type GiftActivationSnapshotFields = {
  activationMode: GameGiftActivationMode;
  minCourseSessions: number | null;
  activationConditionText: string;
  validityDays: number;
};

export function buildGiftActivationSnapshotFields(gift: {
  activationMode: GameGiftActivationMode;
  minCourseSessions: number | null;
  activationConditionText: string;
}): GiftActivationSnapshotFields {
  const mode = gift.activationMode;
  const minCourseSessions =
    mode === "COURSE_MIN_SESSIONS"
      ? gift.minCourseSessions && gift.minCourseSessions > 0
        ? gift.minCourseSessions
        : DEFAULT_COURSE_MIN_SESSIONS
      : null;
  const trimmed = gift.activationConditionText.trim();
  if (trimmed.length > ACTIVATION_CONDITION_TEXT_MAX_LENGTH) {
    throw new Error("activationConditionText exceeds server maximum length");
  }
  const text =
    trimmed || generateActivationConditionText(mode, minCourseSessions);
  if (text.length > ACTIVATION_CONDITION_TEXT_MAX_LENGTH) {
    throw new Error("activationConditionText exceeds server maximum length");
  }

  return {
    activationMode: mode,
    minCourseSessions,
    activationConditionText: text,
    validityDays: GIFT_VALIDITY_DAYS,
  };
}
