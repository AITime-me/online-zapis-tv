import { Prisma } from "@prisma/client";
import {
  LOGIN_ACCOUNT_MAX_FAILURES,
  LOGIN_IP_MAX_FAILURES,
  LOGIN_THROTTLE_BLOCK_MS,
  LOGIN_THROTTLE_CLEANUP_AGE_MS,
  LOGIN_THROTTLE_WINDOW_MS,
} from "./constants";
import type {
  LoginThrottlePrisma,
  LoginThrottleRow,
  LoginThrottleScopeConfig,
} from "./types";

const SERIALIZABLE_RETRIES = 3;

let lastCleanupAtMs = 0;

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034"
  );
}

function isLoginThrottleScopeKeyHashConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2002") {
    return false;
  }

  if (error.meta?.modelName === "LoginThrottleEntry") {
    return true;
  }

  const target = error.meta?.target;
  if (!target) {
    return false;
  }

  const fields = (Array.isArray(target) ? target : [target]).map((value) =>
    String(value).toLowerCase().replace(/_/g, ""),
  );

  return fields.includes("scope") && fields.some((field) => field.includes("keyhash"));
}

function isRetriableThrottleConcurrencyError(error: unknown): boolean {
  return isSerializationFailure(error) || isLoginThrottleScopeKeyHashConflict(error);
}

function isWindowExpired(windowStartedAt: Date, now: Date, windowMs: number): boolean {
  return now.getTime() - windowStartedAt.getTime() >= windowMs;
}

function isBlockActive(blockedUntil: Date | null, now: Date): boolean {
  return blockedUntil != null && blockedUntil.getTime() > now.getTime();
}

export function isLoginThrottleEntryBlocked(
  entry: LoginThrottleRow | null,
  _config: Pick<LoginThrottleScopeConfig, "maxFailures" | "windowMs">,
  now: Date,
): boolean {
  if (!entry) {
    return false;
  }

  return isBlockActive(entry.blockedUntil, now);
}

async function readThrottleEntry(
  db: LoginThrottlePrisma,
  config: Pick<LoginThrottleScopeConfig, "scope" | "keyHash">,
): Promise<LoginThrottleRow | null> {
  return db.loginThrottleEntry.findUnique({
    where: {
      scope_keyHash: {
        scope: config.scope,
        keyHash: config.keyHash,
      },
    },
  });
}

async function applyFailureInTransaction(
  tx: LoginThrottlePrisma,
  config: LoginThrottleScopeConfig,
  now: Date,
): Promise<void> {
  const existing = await readThrottleEntry(tx, config);

  if (!existing) {
    await tx.loginThrottleEntry.create({
      data: {
        scope: config.scope,
        keyHash: config.keyHash,
        failedCount: 1,
        windowStartedAt: now,
        blockedUntil: null,
      },
    });
    return;
  }

  if (isBlockActive(existing.blockedUntil, now)) {
    return;
  }

  if (isWindowExpired(existing.windowStartedAt, now, config.windowMs)) {
    await tx.loginThrottleEntry.update({
      where: { id: existing.id },
      data: {
        failedCount: 1,
        windowStartedAt: now,
        blockedUntil: null,
      },
    });
    return;
  }

  const nextCount = existing.failedCount + 1;
  const blockedUntil =
    nextCount >= config.maxFailures
      ? new Date(now.getTime() + config.blockMs)
      : null;

  await tx.loginThrottleEntry.update({
    where: { id: existing.id },
    data: {
      failedCount: nextCount,
      blockedUntil,
    },
  });
}

async function runSerializable<T>(
  db: LoginThrottlePrisma,
  fn: (tx: LoginThrottlePrisma) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isRetriableThrottleConcurrencyError(error) && attempt < SERIALIZABLE_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("login throttle transaction failed");
}

export async function isLoginThrottleBlocked(
  db: LoginThrottlePrisma,
  config: LoginThrottleScopeConfig,
  now: Date = new Date(),
): Promise<boolean> {
  const entry = await readThrottleEntry(db, config);
  return isLoginThrottleEntryBlocked(entry, config, now);
}

export async function recordLoginThrottleFailure(
  db: LoginThrottlePrisma,
  config: LoginThrottleScopeConfig,
  now: Date = new Date(),
): Promise<void> {
  await runSerializable(db, async (tx) => {
    await applyFailureInTransaction(tx, config, now);
  });
}

export async function clearLoginThrottleEntry(
  db: LoginThrottlePrisma,
  config: Pick<LoginThrottleScopeConfig, "scope" | "keyHash">,
): Promise<void> {
  await db.loginThrottleEntry.deleteMany({
    where: {
      scope: config.scope,
      keyHash: config.keyHash,
    },
  });
}

/**
 * Атомарно проверяет, что ни один scope не заблокирован, и очищает account-throttle.
 * Возвращает false, если блокировка появилась конкурентно (fail-closed для входа).
 */
export async function clearAccountThrottleIfNotBlocked(
  db: LoginThrottlePrisma,
  accountConfig: Pick<LoginThrottleScopeConfig, "scope" | "keyHash">,
  allScopeConfigs: LoginThrottleScopeConfig[],
  now: Date,
): Promise<boolean> {
  return runSerializable(db, async (tx) => {
    for (const config of allScopeConfigs) {
      const entry = await readThrottleEntry(tx, config);
      if (isLoginThrottleEntryBlocked(entry, config, now)) {
        return false;
      }
    }

    await clearLoginThrottleEntry(tx, accountConfig);
    return true;
  });
}

export async function maybeCleanupLoginThrottleEntries(
  db: LoginThrottlePrisma,
  now: Date = new Date(),
): Promise<void> {
  const nowMs = now.getTime();
  const shouldRun =
    Math.random() < 0.02 || nowMs - lastCleanupAtMs >= 60 * 60 * 1000;

  if (!shouldRun) {
    return;
  }

  lastCleanupAtMs = nowMs;
  const cutoff = new Date(nowMs - LOGIN_THROTTLE_CLEANUP_AGE_MS);

  try {
    await db.loginThrottleEntry.deleteMany({
      where: {
        OR: [
          { blockedUntil: { lt: cutoff } },
          {
            AND: [{ blockedUntil: null }, { windowStartedAt: { lt: cutoff } }],
          },
        ],
      },
    });
  } catch {
    console.error("[login-throttle] cleanup failed");
  }
}

export function defaultAccountThrottleConfig(keyHash: string): LoginThrottleScopeConfig {
  return {
    scope: "ACCOUNT",
    keyHash,
    maxFailures: LOGIN_ACCOUNT_MAX_FAILURES,
    windowMs: LOGIN_THROTTLE_WINDOW_MS,
    blockMs: LOGIN_THROTTLE_BLOCK_MS,
  };
}

export function defaultIpThrottleConfig(keyHash: string): LoginThrottleScopeConfig {
  return {
    scope: "IP",
    keyHash,
    maxFailures: LOGIN_IP_MAX_FAILURES,
    windowMs: LOGIN_THROTTLE_WINDOW_MS,
    blockMs: LOGIN_THROTTLE_BLOCK_MS,
  };
}

export function resetLoginThrottleCleanupClockForTests(): void {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.SECURITY_BATCH_TEST !== "1"
  ) {
    throw new Error("resetLoginThrottleCleanupClockForTests доступен только в test environment");
  }
  lastCleanupAtMs = 0;
}
