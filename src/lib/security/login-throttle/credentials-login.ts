import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";
import {
  LOGIN_ACCOUNT_MAX_FAILURES,
  LOGIN_IP_MAX_FAILURES,
  LOGIN_THROTTLE_BLOCK_MS,
  LOGIN_THROTTLE_WINDOW_MS,
} from "./constants";
import { LOGIN_DUMMY_BCRYPT_HASH } from "./dummy-bcrypt";
import {
  buildAccountLoginThrottleKeyHash,
  buildIpLoginThrottleKeyHash,
  normalizeLoginEmail,
} from "./hash-key";
import { LoginThrottleUnavailableError } from "./hmac-secret";
import {
  clearAccountThrottleIfNotBlocked,
  defaultAccountThrottleConfig,
  defaultIpThrottleConfig,
  isLoginThrottleBlocked,
  maybeCleanupLoginThrottleEntries,
  recordLoginThrottleFailure,
} from "./store";
import { resolveTrustedClientIp } from "./trusted-client-ip";
import type { LoginThrottlePrisma, LoginThrottleScopeConfig } from "./types";

type HeaderLike = {
  get(name: string): string | null;
};

type CredentialsUserRow = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  passwordHash: string;
};

export type CredentialsLoginPrisma = LoginThrottlePrisma & {
  user: {
    findUnique(args: {
      where: { email: string };
      select: {
        id: true;
        email: true;
        name: true;
        role: true;
        isActive: true;
        passwordHash: true;
      };
    }): Promise<CredentialsUserRow | null>;
  };
};

export type CredentialsLoginResult = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

function buildScopeConfigs(
  normalizedEmail: string,
  headers: HeaderLike,
): LoginThrottleScopeConfig[] {
  const configs: LoginThrottleScopeConfig[] = [
    {
      ...defaultAccountThrottleConfig(buildAccountLoginThrottleKeyHash(normalizedEmail)),
      maxFailures: LOGIN_ACCOUNT_MAX_FAILURES,
    },
  ];

  const clientIp = resolveTrustedClientIp(headers);
  if (clientIp) {
    configs.push({
      ...defaultIpThrottleConfig(buildIpLoginThrottleKeyHash(clientIp)),
      maxFailures: LOGIN_IP_MAX_FAILURES,
    });
  }

  return configs;
}

function passwordHashForTiming(user: CredentialsUserRow | null): string {
  if (user?.isActive && user.passwordHash) {
    return user.passwordHash;
  }

  return LOGIN_DUMMY_BCRYPT_HASH;
}

async function isAnyThrottleBlocked(
  db: LoginThrottlePrisma,
  configs: LoginThrottleScopeConfig[],
  now: Date,
): Promise<boolean> {
  for (const config of configs) {
    if (await isLoginThrottleBlocked(db, config, now)) {
      return true;
    }
  }

  return false;
}

async function recordThrottleFailures(
  db: LoginThrottlePrisma,
  configs: LoginThrottleScopeConfig[],
  now: Date,
): Promise<void> {
  for (const config of configs) {
    await recordLoginThrottleFailure(db, config, now);
  }
}

async function clearAccountThrottle(
  db: LoginThrottlePrisma,
  normalizedEmail: string,
  allScopeConfigs: LoginThrottleScopeConfig[],
  now: Date,
): Promise<boolean> {
  return clearAccountThrottleIfNotBlocked(
    db,
    {
      scope: "ACCOUNT",
      keyHash: buildAccountLoginThrottleKeyHash(normalizedEmail),
    },
    allScopeConfigs,
    now,
  );
}

/**
 * Проверка credentials-login с DB-backed throttle и выравниванием времени ответа.
 * Возвращает null при любой ошибке — без утечки причины.
 */
export async function verifyCredentialsLogin(
  credentials: Partial<Record<string, unknown>> | undefined,
  headers: HeaderLike,
  options?: {
    db?: CredentialsLoginPrisma;
    now?: Date;
  },
): Promise<CredentialsLoginResult | null> {
  const normalizedEmail = normalizeLoginEmail(String(credentials?.email ?? ""));
  const password = String(credentials?.password ?? "");

  if (!normalizedEmail || !password) {
    return null;
  }

  const now = options?.now ?? new Date();
  const db =
    options?.db ??
    ((await import("@/lib/db")).prisma as unknown as CredentialsLoginPrisma);

  let scopeConfigs: LoginThrottleScopeConfig[];
  try {
    scopeConfigs = buildScopeConfigs(normalizedEmail, headers);
  } catch (error) {
    if (error instanceof LoginThrottleUnavailableError) {
      console.error("[login-throttle] identity protection unavailable");
      return null;
    }
    throw error;
  }

  void maybeCleanupLoginThrottleEntries(db, now);

  const user = await db.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      passwordHash: true,
    },
  });

  const hashForCompare = passwordHashForTiming(user);
  const passwordMatches = await bcrypt.compare(password, hashForCompare);

  const blocked = await isAnyThrottleBlocked(db, scopeConfigs, now);

  if (blocked) {
    return null;
  }

  if (!user?.isActive || !user.passwordHash || !passwordMatches) {
    try {
      await recordThrottleFailures(db, scopeConfigs, now);
    } catch {
      console.error("[login-throttle] failed to record login failure");
      return null;
    }

    return null;
  }

  try {
    const cleared = await clearAccountThrottle(db, normalizedEmail, scopeConfigs, now);
    if (!cleared) {
      return null;
    }
  } catch {
    console.error("[login-throttle] failed to clear throttle on successful login");
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export {
  LOGIN_THROTTLE_BLOCK_MS,
  LOGIN_THROTTLE_WINDOW_MS,
  LOGIN_ACCOUNT_MAX_FAILURES,
  LOGIN_IP_MAX_FAILURES,
};
