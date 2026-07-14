/**
 * Бизнес-логика восстановления пароля по email (запрос ссылки и установка нового пароля).
 *
 * Без side effects при импорте: Prisma и Mailer внедряются извне для тестов с моками.
 * Сырой token никогда не сохраняется в БД — только SHA-256 hash.
 */

import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  validateAuthUrlForRuntime,
  type AppEnv,
} from "@/lib/auth-url-policy";
import type { Mailer } from "@/lib/mail/mailer";
import { validatePasswordPolicy } from "./password-policy";

export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
export const PASSWORD_RESET_EMAIL_COOLDOWN_MS = 60 * 1000;

export const PASSWORD_RESET_NEUTRAL_MESSAGE =
  "Если пользователь с таким email существует, инструкция отправлена.";

const TOKEN_BYTE_LENGTH = 32;

export type PasswordResetErrorCode =
  | "invalid"
  | "expired"
  | "used"
  | "policy"
  | "mismatch";

export class PasswordResetError extends Error {
  readonly code: PasswordResetErrorCode;

  constructor(message: string, code: PasswordResetErrorCode) {
    super(message);
    this.name = "PasswordResetError";
    this.code = code;
  }
}

type ResetUserRow = {
  id: string;
  email: string;
  isActive: boolean;
};

const USER_SELECT = {
  id: true,
  email: true,
  isActive: true,
} as const;

type TokenRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  user: ResetUserRow;
};

type PasswordResetTxResult =
  | { kind: "rate_limited" }
  | { kind: "created"; id: string; rawToken: string };

type RequestTxClient = {
  passwordResetToken: {
    findFirst(args: {
      where: {
        userId: string;
        createdAt: { gte: Date };
      };
      orderBy: { createdAt: "desc" };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    deleteMany(args: {
      where: { userId: string; usedAt: null };
    }): Promise<{ count: number }>;
    create(args: {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    }): Promise<{ id: string }>;
  };
};

export type PasswordResetTransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
};

export type PasswordResetRequestPrisma = {
  user: {
    findUnique(args: {
      where: { email: string };
      select: typeof USER_SELECT;
    }): Promise<ResetUserRow | null>;
  };
  passwordResetToken: {
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  $transaction<T>(
    fn: (tx: RequestTxClient) => Promise<T>,
    options?: PasswordResetTransactionOptions,
  ): Promise<T>;
};

type CompleteTxClient = {
  passwordResetToken: {
    updateMany(args: {
      where: { id: string; usedAt: null; expiresAt: { gt: Date } };
      data: { usedAt: Date };
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { userId: string; usedAt: null; id?: { not: string } };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
      select: { usedAt: true; expiresAt: true };
    }): Promise<{ usedAt: Date | null; expiresAt: Date } | null>;
  };
  user: {
    update(args: {
      where: { id: string };
      data: { passwordHash: string; passwordChangedAt: Date };
    }): Promise<unknown>;
  };
};

export type PasswordResetCompletePrisma = {
  passwordResetToken: {
    findUnique(args: {
      where: { tokenHash: string };
      include: { user: { select: typeof USER_SELECT } };
    }): Promise<TokenRow | null>;
  };
  $transaction<T>(fn: (tx: CompleteTxClient) => Promise<T>): Promise<T>;
};

export type PasswordResetHashFn = (plainPassword: string) => Promise<string>;

export type PasswordResetRequestResult = {
  message: string;
  /** Для тестов: было ли создано письмо (не секрет). */
  emailDispatched: boolean;
};

export type PasswordResetCompleteResult = {
  email: string;
  invalidatedTokens: number;
};

export type PasswordResetMailContent = {
  subject: string;
  text: string;
};

export function normalizePasswordResetEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generatePasswordResetToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Абсолютная ссылка сброса только из доверенного AUTH_URL (не из Host запроса).
 */
export function buildPasswordResetUrl(authUrl: string, rawToken: string): string {
  const base = new URL(authUrl);
  base.pathname = "/reset-password";
  base.search = "";
  base.hash = "";
  base.searchParams.set("token", rawToken);
  return base.toString();
}

export function resolveTrustedAuthUrl(
  authUrl: string | undefined,
  appEnv: AppEnv | undefined,
): string {
  const trimmed = authUrl?.trim();
  if (!trimmed) {
    throw new PasswordResetError("AUTH_URL не настроен.", "invalid");
  }

  const result = validateAuthUrlForRuntime(trimmed, appEnv);
  if (!result.ok) {
    throw new PasswordResetError(result.message, "invalid");
  }

  return trimmed;
}

export function buildPasswordResetMailContent(resetUrl: string): PasswordResetMailContent {
  return {
    subject: "Смена пароля — Твоё время",
    text: [
      "Вы запросили смену пароля для входа в систему «Твоё время».",
      "",
      `Перейдите по ссылке, чтобы задать новый пароль (ссылка действует 30 минут):`,
      resetUrl,
      "",
      "Если вы не запрашивали смену пароля, это письмо можно проигнорировать.",
    ].join("\n"),
  };
}

export function validateNewResetPassword(password: string, confirmation: string): void {
  if (!password) {
    throw new PasswordResetError("Пароль не может быть пустым.", "policy");
  }

  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    throw new PasswordResetError(policyError, "policy");
  }

  if (password !== confirmation) {
    throw new PasswordResetError("Пароли не совпадают.", "mismatch");
  }
}

function isEligibleForResetRequest(user: ResetUserRow | null): user is ResetUserRow {
  return !!user?.isActive;
}

export function isPrismaSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034"
  );
}

async function createPasswordResetTokenInTransaction(
  tx: RequestTxClient,
  params: {
    userId: string;
    now: Date;
    generateToken: () => string;
  },
): Promise<PasswordResetTxResult> {
  const cooldownStart = new Date(
    params.now.getTime() - PASSWORD_RESET_EMAIL_COOLDOWN_MS,
  );

  const recentToken = await tx.passwordResetToken.findFirst({
    where: {
      userId: params.userId,
      createdAt: { gte: cooldownStart },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (recentToken) {
    return { kind: "rate_limited" };
  }

  await tx.passwordResetToken.deleteMany({
    where: { userId: params.userId, usedAt: null },
  });

  const rawToken = params.generateToken();
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = new Date(params.now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS);

  const created = await tx.passwordResetToken.create({
    data: {
      userId: params.userId,
      tokenHash,
      expiresAt,
    },
  });

  return { kind: "created", id: created.id, rawToken };
}

/**
 * Запрос восстановления: нейтральный ответ при отсутствии/неактивном пользователе,
 * rate limit и ошибке почты. Сырой token не сохраняется в БД.
 */
export async function requestPasswordReset(
  db: PasswordResetRequestPrisma,
  mailer: Mailer,
  params: {
    email: string;
    authUrl: string;
    appEnv?: AppEnv;
    now?: Date;
    generateToken?: () => string;
    logMailFailure?: (reason: string) => void;
  },
): Promise<PasswordResetRequestResult> {
  const now = params.now ?? new Date();
  const normalized = normalizePasswordResetEmail(params.email);
  const neutral = { message: PASSWORD_RESET_NEUTRAL_MESSAGE, emailDispatched: false };
  const generateToken = params.generateToken ?? generatePasswordResetToken;

  if (!normalized) {
    return neutral;
  }

  let trustedAuthUrl: string;
  try {
    trustedAuthUrl = resolveTrustedAuthUrl(params.authUrl, params.appEnv);
  } catch {
    params.logMailFailure?.("invalid auth url");
    return neutral;
  }

  const user = await db.user.findUnique({
    where: { email: normalized },
    select: USER_SELECT,
  });

  if (!isEligibleForResetRequest(user)) {
    return neutral;
  }

  let txResult: PasswordResetTxResult;
  try {
    txResult = await db.$transaction(
      async (tx) =>
        createPasswordResetTokenInTransaction(tx, {
          userId: user.id,
          now,
          generateToken,
        }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      },
    );
  } catch (error) {
    if (isPrismaSerializationFailure(error)) {
      return neutral;
    }
    throw error;
  }

  if (txResult.kind === "rate_limited") {
    return neutral;
  }

  const resetUrl = buildPasswordResetUrl(trustedAuthUrl, txResult.rawToken);
  const mail = buildPasswordResetMailContent(resetUrl);

  try {
    await mailer.sendMail({
      to: user.email,
      subject: mail.subject,
      text: mail.text,
    });
  } catch {
    await db.passwordResetToken.delete({ where: { id: txResult.id } }).catch(() => {});
    params.logMailFailure?.("mail delivery failed");
    return neutral;
  }

  return { message: PASSWORD_RESET_NEUTRAL_MESSAGE, emailDispatched: true };
}

function classifyStaleToken(
  token: { usedAt: Date | null; expiresAt: Date },
  now: Date,
): PasswordResetError {
  if (token.usedAt) {
    return new PasswordResetError("Ссылка уже использована.", "used");
  }
  if (token.expiresAt.getTime() <= now.getTime()) {
    return new PasswordResetError("Ссылка истекла.", "expired");
  }
  return new PasswordResetError("Ссылка недействительна.", "invalid");
}

/**
 * Установка нового пароля по одноразовому token (поиск только по SHA-256 hash).
 */
export async function applyPasswordReset(
  db: PasswordResetCompletePrisma,
  params: {
    rawToken: string;
    newPassword: string;
    confirmation: string;
    now?: Date;
  },
  hashPassword: PasswordResetHashFn,
): Promise<PasswordResetCompleteResult> {
  const now = params.now ?? new Date();
  const rawToken = params.rawToken.trim();

  if (!rawToken) {
    throw new PasswordResetError("Ссылка недействительна.", "invalid");
  }

  validateNewResetPassword(params.newPassword, params.confirmation);

  const tokenHash = hashPasswordResetToken(rawToken);
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: USER_SELECT } },
  });

  if (!record) {
    throw new PasswordResetError("Ссылка недействительна.", "invalid");
  }

  if (record.usedAt) {
    throw new PasswordResetError("Ссылка уже использована.", "used");
  }

  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new PasswordResetError("Ссылка истекла.", "expired");
  }

  if (!record.user.isActive) {
    throw new PasswordResetError("Ссылка недействительна.", "invalid");
  }

  const passwordHash = await hashPassword(params.newPassword);

  return db.$transaction(async (tx) => {
    const marked = await tx.passwordResetToken.updateMany({
      where: {
        id: record.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (marked.count !== 1) {
      const fresh = await tx.passwordResetToken.findUnique({
        where: { id: record.id },
        select: { usedAt: true, expiresAt: true },
      });
      if (fresh) {
        throw classifyStaleToken(fresh, now);
      }
      throw new PasswordResetError("Ссылка недействительна.", "invalid");
    }

    await tx.user.update({
      where: { id: record.user.id },
      data: { passwordHash, passwordChangedAt: now },
    });

    const invalidated = await tx.passwordResetToken.deleteMany({
      where: {
        userId: record.user.id,
        usedAt: null,
        id: { not: record.id },
      },
    });

    return {
      email: record.user.email,
      invalidatedTokens: invalidated.count,
    };
  });
}
