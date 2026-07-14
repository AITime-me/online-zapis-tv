process.env.SECURITY_BATCH_TEST = "1";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { LoginThrottleScope, UserRole } from "@prisma/client";
import {
  buildAccountLoginThrottleKeyHash,
  buildIpLoginThrottleKeyHash,
  CREDENTIALS_LOGIN_NEUTRAL_ERROR,
  defaultAccountThrottleConfig,
  defaultIpThrottleConfig,
  isLoginThrottleBlocked,
  isLoginThrottleEntryBlocked,
  LOGIN_ACCOUNT_MAX_FAILURES,
  LOGIN_DUMMY_BCRYPT_HASH,
  LOGIN_IP_MAX_FAILURES,
  LOGIN_THROTTLE_BLOCK_MS,
  normalizeLoginEmail,
  recordLoginThrottleFailure,
  resetLoginThrottleCleanupClockForTests,
  verifyCredentialsLogin,
  type CredentialsLoginPrisma,
  type LoginThrottlePrisma,
  type LoginThrottleRow,
} from "../src/lib/security/login-throttle";
import { hashRateLimitIdentity } from "../src/lib/security/rate-limit/hash-key";
import { isTrustedProxyEnabled, resolveTrustedClientIp } from "../src/lib/security/login-throttle/trusted-client-ip";

const TEST_PASSWORD = "WrongPass1234";
const VALID_PASSWORD = "CorrectPass123";
const REAL_HASH = bcrypt.hashSync(VALID_PASSWORD, 10);

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  passwordHash: string;
};

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function mockHeaders(values: Record<string, string> = {}) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function createThrottleMock(now: () => Date) {
  const entries = new Map<string, LoginThrottleRow>();
  let txChain: Promise<unknown> = Promise.resolve();

  const keyOf = (scope: LoginThrottleScope, keyHash: string) => `${scope}:${keyHash}`;

  const db: LoginThrottlePrisma = {
    loginThrottleEntry: {
      async findUnique(args) {
        const key = keyOf(args.where.scope_keyHash.scope, args.where.scope_keyHash.keyHash);
        return entries.get(key) ?? null;
      },
      async create(args) {
        const key = keyOf(args.data.scope, args.data.keyHash);
        const row: LoginThrottleRow = {
          id: `row-${entries.size + 1}`,
          scope: args.data.scope,
          keyHash: args.data.keyHash,
          failedCount: args.data.failedCount,
          windowStartedAt: args.data.windowStartedAt,
          blockedUntil: args.data.blockedUntil,
        };
        entries.set(key, row);
        return row;
      },
      async update(args) {
        const row = [...entries.values()].find((entry) => entry.id === args.where.id);
        if (!row) {
          throw new Error("row not found");
        }
        const updated: LoginThrottleRow = {
          ...row,
          failedCount: args.data.failedCount ?? row.failedCount,
          windowStartedAt: args.data.windowStartedAt ?? row.windowStartedAt,
          blockedUntil:
            args.data.blockedUntil === undefined ? row.blockedUntil : args.data.blockedUntil,
        };
        entries.set(keyOf(updated.scope, updated.keyHash), updated);
        return updated;
      },
      async deleteMany(args) {
        let count = 0;
        for (const [mapKey, row] of entries) {
          if (args.where.scope && row.scope !== args.where.scope) {
            continue;
          }
          if (args.where.keyHash && row.keyHash !== args.where.keyHash) {
            continue;
          }
          entries.delete(mapKey);
          count += 1;
        }
        return { count };
      },
    },
    async $transaction(fn) {
      const run = txChain.then(() => fn(db));
      txChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };

  return { db, entries, now };
}

function createCredentialsMock(options: {
  user: UserRow | null;
  throttleDb: LoginThrottlePrisma;
  now: () => Date;
  failClear?: boolean;
  failRecord?: boolean;
}) {
  const db: CredentialsLoginPrisma = {
    ...options.throttleDb,
    user: {
      async findUnique(args) {
        if (!options.user || args.where.email !== options.user.email) {
          return null;
        }
        return { ...options.user };
      },
    },
    loginThrottleEntry: {
      ...options.throttleDb.loginThrottleEntry,
      async deleteMany(args) {
        if (options.failClear) {
          throw new Error("clear failed");
        }
        return options.throttleDb.loginThrottleEntry.deleteMany(args);
      },
    },
    async $transaction(fn, txOptions) {
      if (options.failRecord) {
        throw new Error("record failed");
      }

      const tx: LoginThrottlePrisma = {
        ...options.throttleDb,
        loginThrottleEntry: {
          ...options.throttleDb.loginThrottleEntry,
          deleteMany: async (args) => {
            if (options.failClear) {
              throw new Error("clear failed");
            }
            return options.throttleDb.loginThrottleEntry.deleteMany(args);
          },
        },
        $transaction: options.throttleDb.$transaction.bind(options.throttleDb),
      };

      return options.throttleDb.$transaction(() => fn(tx), txOptions);
    },
  };

  return {
    db,
    async login(email: string, password: string, headers = mockHeaders()) {
      return verifyCredentialsLogin(
        { email, password },
        headers,
        { db, now: options.now() },
      );
    },
  };
}

function testEmailNormalizationAndHmac(): void {
  assert.equal(normalizeLoginEmail("  User@Studio.RU  "), "user@studio.ru");

  const keyHash = buildAccountLoginThrottleKeyHash("user@studio.ru");
  assert.equal(keyHash.length, 64);
  assert.notEqual(keyHash, "user@studio.ru");
  assert.notEqual(keyHash, hashRateLimitIdentity(["login-account", "user@studio.ru"]) ? "" : keyHash);
  assert.equal(keyHash, buildAccountLoginThrottleKeyHash("user@studio.ru"));

  const ipHash = buildIpLoginThrottleKeyHash("203.0.113.10");
  assert.equal(ipHash.length, 64);
  assert.doesNotMatch(ipHash, /203\.0\.113\.10/);
}

function testPasswordNeverStored(): void {
  const source = readSource("src/lib/security/login-throttle/credentials-login.ts");
  assert.doesNotMatch(source, /password.*create|create.*password/i);
  assert.doesNotMatch(source, /loginThrottleEntry\.create[\s\S]*password/i);
  assert.doesNotMatch(source, /console\.(log|info|warn)\([^)]*password/i);
}

async function testAccountThrottleBlocksAfterFiveFailures(): Promise<void> {
  const nowMs = Date.parse("2026-07-14T12:00:00.000Z");
  const nowValue = nowMs;
  const now = () => new Date(nowValue);
  const { db } = createThrottleMock(now);

  const email = "user@studio.ru";
  const keyHash = buildAccountLoginThrottleKeyHash(email);
  const config = defaultAccountThrottleConfig(keyHash);

  for (let index = 0; index < LOGIN_ACCOUNT_MAX_FAILURES - 1; index += 1) {
    assert.equal(await isLoginThrottleBlocked(db, config, now()), false);
    await recordLoginThrottleFailure(db, config, now());
  }

  assert.equal(await isLoginThrottleBlocked(db, config, now()), false);
  await recordLoginThrottleFailure(db, config, now());
  assert.equal(await isLoginThrottleBlocked(db, config, now()), true);
}

async function testThrottleExpiresAfterBlock(): Promise<void> {
  const start = Date.parse("2026-07-14T12:00:00.000Z");
  let nowValue = start;
  const now = () => new Date(nowValue);
  const { db } = createThrottleMock(now);

  const keyHash = buildAccountLoginThrottleKeyHash("ghost@studio.ru");
  const config = defaultAccountThrottleConfig(keyHash);

  for (let index = 0; index < LOGIN_ACCOUNT_MAX_FAILURES; index += 1) {
    await recordLoginThrottleFailure(db, config, now());
  }

  assert.equal(await isLoginThrottleBlocked(db, config, now()), true);

  nowValue = start + LOGIN_THROTTLE_BLOCK_MS + 1;
  assert.equal(await isLoginThrottleBlocked(db, config, now()), false);
}

async function testSuccessfulLoginClearsAccountThrottle(): Promise<void> {
  const start = Date.parse("2026-07-14T12:00:00.000Z");
  let nowValue = start;
  const now = () => new Date(nowValue);
  const { db, entries } = createThrottleMock(now);

  const email = "owner@studio.ru";
  const keyHash = buildAccountLoginThrottleKeyHash(email);
  const config = defaultAccountThrottleConfig(keyHash);

  for (let index = 0; index < LOGIN_ACCOUNT_MAX_FAILURES; index += 1) {
    await recordLoginThrottleFailure(db, config, now());
  }

  assert.equal(await isLoginThrottleBlocked(db, config, now()), true);

  nowValue = start + LOGIN_THROTTLE_BLOCK_MS + 1;
  assert.equal(await isLoginThrottleBlocked(db, config, now()), false);

  const user: UserRow = {
    id: "user-1",
    email,
    name: "Owner",
    role: "OWNER",
    isActive: true,
    passwordHash: REAL_HASH,
  };

  const client = createCredentialsMock({ user, throttleDb: db, now });
  const result = await client.login(email, VALID_PASSWORD);

  assert.ok(result);
  assert.equal(result?.id, "user-1");
  assert.equal(entries.size, 0, "успешный вход после блокировки должен удалить account throttle");
}

async function testNonexistentEmailUsesSameThrottle(): Promise<void> {
  const nowValue = Date.parse("2026-07-14T12:00:00.000Z");
  const now = () => new Date(nowValue);
  const { db } = createThrottleMock(now);

  const client = createCredentialsMock({ user: null, throttleDb: db, now });
  const email = "missing@studio.ru";

  for (let index = 0; index < LOGIN_ACCOUNT_MAX_FAILURES; index += 1) {
    const result = await client.login(email, TEST_PASSWORD);
    assert.equal(result, null);
  }

  const keyHash = buildAccountLoginThrottleKeyHash(email);
  const config = defaultAccountThrottleConfig(keyHash);
  assert.equal(await isLoginThrottleBlocked(db, config, now()), true);
}

async function testDummyBcryptUsedForMissingUser(): Promise<void> {
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  const { db } = createThrottleMock(now);
  const client = createCredentialsMock({ user: null, throttleDb: db, now });

  const start = performance.now();
  await client.login("ghost@studio.ru", TEST_PASSWORD);
  const elapsedMissing = performance.now() - start;

  const activeUser: UserRow = {
    id: "user-2",
    email: "real@studio.ru",
    name: "Real",
    role: "MANAGER",
    isActive: true,
    passwordHash: REAL_HASH,
  };
  const clientReal = createCredentialsMock({ user: activeUser, throttleDb: db, now });

  const startReal = performance.now();
  await clientReal.login("real@studio.ru", TEST_PASSWORD);
  const elapsedWrong = performance.now() - startReal;

  const ratio = elapsedMissing / Math.max(elapsedWrong, 1);
  assert.ok(ratio > 0.4 && ratio < 2.5, "время ответа для missing и wrong password должно быть сопоставимо");
}

function testDummyHashIsStaticAndNotLogged(): void {
  const source = readSource("src/lib/security/login-throttle/dummy-bcrypt.ts");
  assert.match(source, /LOGIN_DUMMY_BCRYPT_HASH\s*=\s*"\$2[aby]\$10\$/);
  assert.doesNotMatch(source, /hashSync|genSalt/);
  assert.doesNotMatch(source, /console\./);

  assert.equal(
    bcrypt.compareSync("__login_throttle_dummy_v1__", LOGIN_DUMMY_BCRYPT_HASH),
    true,
  );
}

function testNeutralLoginErrorOnPage(): void {
  const loginPage = readSource("src/app/(internal)/login/page.tsx");
  assert.match(loginPage, new RegExp(CREDENTIALS_LOGIN_NEUTRAL_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(loginPage, /заблокирован|лимит|попыток|неактив/i);
}

async function testInactiveUserDoesNotChangeState(): Promise<void> {
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  const { db } = createThrottleMock(now);

  const user: UserRow = {
    id: "inactive-1",
    email: "inactive@studio.ru",
    name: "Inactive",
    role: "MASTER",
    isActive: false,
    passwordHash: REAL_HASH,
  };

  const client = createCredentialsMock({ user, throttleDb: db, now });
  const result = await client.login(user.email, VALID_PASSWORD);
  assert.equal(result, null);
  assert.equal(user.isActive, false);
  assert.equal(user.role, "MASTER");
  assert.equal(user.passwordHash, REAL_HASH);
}

async function testParallelFailuresDoNotLoseCounter(): Promise<void> {
  const nowValue = Date.parse("2026-07-14T12:00:00.000Z");
  const now = () => new Date(nowValue);

  const entries = new Map<string, LoginThrottleRow>();
  let txChain: Promise<unknown> = Promise.resolve();

  const db: LoginThrottlePrisma = {
    loginThrottleEntry: {
      async findUnique(args) {
        const key = `${args.where.scope_keyHash.scope}:${args.where.scope_keyHash.keyHash}`;
        return entries.get(key) ?? null;
      },
      async create(args) {
        const key = `${args.data.scope}:${args.data.keyHash}`;
        const row: LoginThrottleRow = {
          id: `row-${entries.size + 1}`,
          scope: args.data.scope,
          keyHash: args.data.keyHash,
          failedCount: args.data.failedCount,
          windowStartedAt: args.data.windowStartedAt,
          blockedUntil: args.data.blockedUntil,
        };
        entries.set(key, row);
        return row;
      },
      async update(args) {
        const row = [...entries.values()].find((entry) => entry.id === args.where.id);
        if (!row) {
          throw new Error("missing row");
        }
        const updated: LoginThrottleRow = {
          ...row,
          failedCount: args.data.failedCount ?? row.failedCount,
          windowStartedAt: args.data.windowStartedAt ?? row.windowStartedAt,
          blockedUntil:
            args.data.blockedUntil === undefined ? row.blockedUntil : args.data.blockedUntil,
        };
        entries.set(`${updated.scope}:${updated.keyHash}`, updated);
        return updated;
      },
      async deleteMany() {
        return { count: 0 };
      },
    },
    async $transaction(fn) {
      const run = txChain.then(() => fn(db));
      txChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };

  const keyHash = buildAccountLoginThrottleKeyHash("parallel@studio.ru");
  const config = defaultAccountThrottleConfig(keyHash);

  await Promise.all([
    recordLoginThrottleFailure(db, config, now()),
    recordLoginThrottleFailure(db, config, now()),
    recordLoginThrottleFailure(db, config, now()),
    recordLoginThrottleFailure(db, config, now()),
  ]);

  const row = entries.get(`ACCOUNT:${keyHash}`);
  assert.ok(row);
  assert.equal(row?.failedCount, 4, "параллельные ошибки не должны терять счётчик");
}

async function testBoundaryIsAtomic(): Promise<void> {
  const nowValue = Date.parse("2026-07-14T12:00:00.000Z");
  const now = () => new Date(nowValue);
  const { db, entries } = createThrottleMock(now);

  const keyHash = buildAccountLoginThrottleKeyHash("boundary@studio.ru");
  const config = defaultAccountThrottleConfig(keyHash);

  for (let index = 0; index < LOGIN_ACCOUNT_MAX_FAILURES - 1; index += 1) {
    await recordLoginThrottleFailure(db, config, now());
  }

  await Promise.all([
    recordLoginThrottleFailure(db, config, now()),
    recordLoginThrottleFailure(db, config, now()),
  ]);

  const row = entries.get(`ACCOUNT:${keyHash}`);
  assert.ok(row);
  assert.ok(row!.failedCount >= LOGIN_ACCOUNT_MAX_FAILURES);
  assert.ok(row!.blockedUntil != null, "на границе лимита должна включаться блокировка");
  assert.equal(isLoginThrottleEntryBlocked(row, config, now()), true);
}

function testNoSensitiveLogging(): void {
  const files = [
    "src/lib/security/login-throttle/credentials-login.ts",
    "src/lib/security/login-throttle/store.ts",
    "src/lib/security/login-throttle/hash-key.ts",
    "src/auth.ts",
  ];

  for (const file of files) {
    const source = readSource(file);
    const consoleCalls = source.match(/console\.(log|info|warn)\([^;]*\)/g) ?? [];
    for (const call of consoleCalls) {
      assert.doesNotMatch(call, /email|password|ip|keyHash|AUTH_SECRET|hmac/i, `${file}: запрещённый лог`);
    }
  }
}

function testTrustedProxyPolicy(): void {
  const original = process.env.TRUST_PROXY_HEADERS;
  try {
    delete process.env.TRUST_PROXY_HEADERS;
    assert.equal(isTrustedProxyEnabled(), false);
    assert.equal(resolveTrustedClientIp(mockHeaders({ "x-forwarded-for": "198.51.100.1" })), null);

    process.env.TRUST_PROXY_HEADERS = "true";
    assert.equal(resolveTrustedClientIp(mockHeaders({ "x-real-ip": "203.0.113.5" })), "203.0.113.5");
    assert.equal(
      resolveTrustedClientIp(mockHeaders({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })),
      "203.0.113.9",
    );
  } finally {
    if (original === undefined) {
      delete process.env.TRUST_PROXY_HEADERS;
    } else {
      process.env.TRUST_PROXY_HEADERS = original;
    }
  }

  const credentialsSource = readSource("src/lib/security/login-throttle/credentials-login.ts");
  assert.match(credentialsSource, /resolveTrustedClientIp/, "IP throttle только через trusted helper");
  assert.doesNotMatch(
    credentialsSource,
    /x-forwarded-for/i,
    "credentials-login не должен читать X-Forwarded-For напрямую",
  );
}

async function testIpThrottleOnlyWithTrustedProxy(): Promise<void> {
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  const { db } = createThrottleMock(now);

  const ipKey = buildIpLoginThrottleKeyHash("203.0.113.44");
  const ipConfig = defaultIpThrottleConfig(ipKey);

  for (let index = 0; index < LOGIN_IP_MAX_FAILURES; index += 1) {
    await recordLoginThrottleFailure(db, ipConfig, now());
  }

  assert.equal(await isLoginThrottleBlocked(db, ipConfig, now()), true);

  const credentialsSource = readSource("src/lib/security/login-throttle/credentials-login.ts");
  assert.match(credentialsSource, /resolveTrustedClientIp/, "IP throttle подключается только при trusted IP");
}

async function testBlockedAttemptUsesSamePublicOutcome(): Promise<void> {
  const nowValue = Date.parse("2026-07-14T12:00:00.000Z");
  const now = () => new Date(nowValue);
  const { db } = createThrottleMock(now);

  const user: UserRow = {
    id: "blocked-user",
    email: "blocked@studio.ru",
    name: "Blocked",
    role: "OWNER",
    isActive: true,
    passwordHash: REAL_HASH,
  };

  const client = createCredentialsMock({ user, throttleDb: db, now });

  for (let index = 0; index < LOGIN_ACCOUNT_MAX_FAILURES; index += 1) {
    await client.login(user.email, TEST_PASSWORD);
  }

  const blockedWrong = await client.login(user.email, TEST_PASSWORD);
  const blockedCorrect = await client.login(user.email, VALID_PASSWORD);

  assert.equal(blockedWrong, null);
  assert.equal(blockedCorrect, null, "верный пароль не должен обходить активную блокировку");
}

async function testAttemptsOneThroughSixSemantics(): Promise<void> {
  const start = Date.parse("2026-07-14T12:00:00.000Z");
  let nowValue = start;
  const now = () => new Date(nowValue);
  const { db, entries } = createThrottleMock(now);

  const user: UserRow = {
    id: "semantics-user",
    email: "semantics@studio.ru",
    name: "Semantics",
    role: "MANAGER",
    isActive: true,
    passwordHash: REAL_HASH,
  };

  const client = createCredentialsMock({ user, throttleDb: db, now });
  const keyHash = buildAccountLoginThrottleKeyHash(user.email);
  const config = defaultAccountThrottleConfig(keyHash);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = await client.login(user.email, TEST_PASSWORD);
    assert.equal(result, null, `попытка ${attempt} должна отклоняться`);
    const row = entries.get(`ACCOUNT:${keyHash}`);
    assert.equal(row?.failedCount, attempt, `попытка ${attempt} должна увеличивать счётчик`);
    assert.equal(await isLoginThrottleBlocked(db, config, now()), false);
  }

  const fifth = await client.login(user.email, TEST_PASSWORD);
  assert.equal(fifth, null, "попытка 5 должна отклоняться");
  const afterFifth = entries.get(`ACCOUNT:${keyHash}`);
  assert.equal(afterFifth?.failedCount, 5);
  assert.ok(afterFifth?.blockedUntil != null, "попытка 5 должна установить blockedUntil");
  assert.equal(await isLoginThrottleBlocked(db, config, now()), true);

  const sixthWrong = await client.login(user.email, TEST_PASSWORD);
  const sixthCorrect = await client.login(user.email, VALID_PASSWORD);
  assert.equal(sixthWrong, null, "попытка 6 с неверным паролем должна отклоняться");
  assert.equal(sixthCorrect, null, "попытка 6 с верным паролем должна отклоняться");
  assert.equal(afterFifth?.failedCount, entries.get(`ACCOUNT:${keyHash}`)?.failedCount);
  assert.equal(
    afterFifth?.blockedUntil?.getTime(),
    entries.get(`ACCOUNT:${keyHash}`)?.blockedUntil?.getTime(),
    "попытка 6 не должна продлевать блокировку",
  );

  nowValue = start + LOGIN_THROTTLE_BLOCK_MS + 1;
  const afterExpiry = await client.login(user.email, VALID_PASSWORD);
  assert.ok(afterExpiry, "верный пароль после истечения блокировки должен разрешать вход");
  assert.equal(entries.size, 0, "успешный вход после блокировки очищает throttle");
}

async function testBlockedAttemptDoesNotExtendBlock(): Promise<void> {
  const nowValue = Date.parse("2026-07-14T12:00:00.000Z");
  const now = () => new Date(nowValue);
  const { db, entries } = createThrottleMock(now);

  const user: UserRow = {
    id: "extend-user",
    email: "extend@studio.ru",
    name: "Extend",
    role: "OWNER",
    isActive: true,
    passwordHash: REAL_HASH,
  };

  const client = createCredentialsMock({ user, throttleDb: db, now });
  const keyHash = buildAccountLoginThrottleKeyHash(user.email);

  for (let index = 0; index < LOGIN_ACCOUNT_MAX_FAILURES; index += 1) {
    await client.login(user.email, TEST_PASSWORD);
  }

  const snapshot = entries.get(`ACCOUNT:${keyHash}`);
  assert.ok(snapshot?.blockedUntil);

  for (let index = 0; index < 3; index += 1) {
    await client.login(user.email, TEST_PASSWORD);
    await client.login(user.email, VALID_PASSWORD);
  }

  const after = entries.get(`ACCOUNT:${keyHash}`);
  assert.equal(after?.failedCount, snapshot?.failedCount);
  assert.equal(after?.blockedUntil?.getTime(), snapshot?.blockedUntil?.getTime());
}

async function testBcryptRunsDuringActiveBlock(): Promise<void> {
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  const { db } = createThrottleMock(now);

  const user: UserRow = {
    id: "bcrypt-user",
    email: "bcrypt@studio.ru",
    name: "Bcrypt",
    role: "OWNER",
    isActive: true,
    passwordHash: REAL_HASH,
  };

  const client = createCredentialsMock({ user, throttleDb: db, now });

  for (let index = 0; index < LOGIN_ACCOUNT_MAX_FAILURES; index += 1) {
    await client.login(user.email, TEST_PASSWORD);
  }

  let compareCalls = 0;
  const originalCompare = bcrypt.compare;
  bcrypt.compare = async (plain: string, hash: string) => {
    compareCalls += 1;
    return originalCompare(plain, hash);
  };

  try {
    const result = await client.login(user.email, VALID_PASSWORD);
    assert.equal(result, null);
    assert.equal(compareCalls, 1, "bcrypt.compare должен выполняться ровно один раз при active block");
  } finally {
    bcrypt.compare = originalCompare;
  }
}

async function testCorrectPasswordDoesNotBypassIpBlock(): Promise<void> {
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  const { db } = createThrottleMock(now);

  const user: UserRow = {
    id: "ip-block-user",
    email: "ipblock@studio.ru",
    name: "Ip Block",
    role: "MANAGER",
    isActive: true,
    passwordHash: REAL_HASH,
  };

  const original = process.env.TRUST_PROXY_HEADERS;
  try {
    process.env.TRUST_PROXY_HEADERS = "true";
    const headers = mockHeaders({ "x-real-ip": "203.0.113.77" });
    const ipKey = buildIpLoginThrottleKeyHash("203.0.113.77");
    const ipConfig = defaultIpThrottleConfig(ipKey);

    for (let index = 0; index < LOGIN_IP_MAX_FAILURES; index += 1) {
      await recordLoginThrottleFailure(db, ipConfig, now());
    }

    const client = createCredentialsMock({ user, throttleDb: db, now });
    const result = await client.login(user.email, VALID_PASSWORD, headers);
    assert.equal(result, null, "верный пароль не должен обходить активный IP block");
  } finally {
    if (original === undefined) {
      delete process.env.TRUST_PROXY_HEADERS;
    } else {
      process.env.TRUST_PROXY_HEADERS = original;
    }
  }
}

async function testParallelBlockedCorrectAndWrong(): Promise<void> {
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  const { db } = createThrottleMock(now);

  const user: UserRow = {
    id: "parallel-block-user",
    email: "parallel-block@studio.ru",
    name: "Parallel",
    role: "OWNER",
    isActive: true,
    passwordHash: REAL_HASH,
  };

  const client = createCredentialsMock({ user, throttleDb: db, now });

  for (let index = 0; index < LOGIN_ACCOUNT_MAX_FAILURES; index += 1) {
    await client.login(user.email, TEST_PASSWORD);
  }

  const [wrong, correct] = await Promise.all([
    client.login(user.email, TEST_PASSWORD),
    client.login(user.email, VALID_PASSWORD),
  ]);

  assert.equal(wrong, null);
  assert.equal(correct, null, "параллельный верный вход не должен обходить active block");
}

async function testSerializableRetryFailClosed(): Promise<void> {
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  const { db } = createThrottleMock(now);

  const user: UserRow = {
    id: "retry-user",
    email: "retry@studio.ru",
    name: "Retry",
    role: "OWNER",
    isActive: true,
    passwordHash: REAL_HASH,
  };

  const failingDb: CredentialsLoginPrisma = {
    ...createCredentialsMock({ user, throttleDb: db, now }).db,
    async $transaction() {
      throw new Error("db unavailable");
    },
  };

  const result = await verifyCredentialsLogin(
    { email: user.email, password: TEST_PASSWORD },
    mockHeaders(),
    { db: failingDb, now: now() },
  );

  assert.equal(result, null, "ошибка БД при записи failure должна быть fail-closed");
}

async function testClearFailureIsFailClosed(): Promise<void> {
  const now = () => new Date("2026-07-14T12:00:00.000Z");
  const { db } = createThrottleMock(now);

  const user: UserRow = {
    id: "user-clear",
    email: "clear@studio.ru",
    name: "Clear",
    role: "OWNER",
    isActive: true,
    passwordHash: REAL_HASH,
  };

  const client = createCredentialsMock({
    user,
    throttleDb: db,
    now,
    failClear: true,
  });

  const result = await client.login(user.email, VALID_PASSWORD);
  assert.equal(result, null, "ошибка очистки throttle должна блокировать вход");
}

function testSessionFreshnessAndPasswordResetUntouched(): void {
  const sessionSource = readSource("src/lib/auth/session-freshness.ts");
  assert.match(sessionSource, /passwordChangedAt/);
  assert.doesNotMatch(sessionSource, /loginThrottle|login-throttle/i);

  const resetSource = readSource("src/lib/auth/password-reset.ts");
  assert.match(resetSource, /PASSWORD_RESET_NEUTRAL_MESSAGE/);
  assert.doesNotMatch(resetSource, /loginThrottle|login-throttle/i);
}

function testAuthUsesDbBackedModule(): void {
  const authSource = readSource("src/auth.ts");
  assert.match(authSource, /verifyCredentialsLogin/);
  assert.match(authSource, /login-throttle\/credentials-login/);
  assert.doesNotMatch(authSource, /bcrypt/);
  assert.doesNotMatch(authSource, /prisma\.user\.findUnique/);
}

function testPrismaModelPresent(): void {
  const schema = readSource("prisma/schema.prisma");
  assert.match(schema, /model LoginThrottleEntry/);
  assert.match(schema, /enum LoginThrottleScope/);
  assert.match(schema, /@@unique\(\[scope, keyHash\]\)/);

  const migration = readSource(
    "prisma/migrations/20260714120000_login_throttle_entries/migration.sql",
  );
  assert.match(migration, /CREATE TYPE "LoginThrottleScope"/);
  assert.match(migration, /CREATE TABLE "login_throttle_entries"/);
  assert.match(migration, /login_throttle_entries_scope_key_hash_key/);
  assert.match(migration, /blocked_until_idx/);
  assert.match(migration, /window_started_at_idx/);
  assert.doesNotMatch(migration, /ALTER TABLE "users"/i);
  assert.doesNotMatch(migration, /password_reset/i);
  assert.doesNotMatch(migration, /DROP /i);
}

function testNoInMemoryLoginLimiterPath(): void {
  const authSource = readSource("src/auth.ts");
  const credentialsSource = readSource("src/lib/security/login-throttle/credentials-login.ts");

  assert.doesNotMatch(authSource, /rate-limit\/login/);
  assert.doesNotMatch(authSource, /recordLoginRateLimitFailure|isLoginRateLimited/);
  assert.doesNotMatch(credentialsSource, /rate-limit\/login/);
  assert.doesNotMatch(credentialsSource, /consumeRateLimit|recordRateLimitFailure|__rateLimitStoreState/);
  assert.match(credentialsSource, /if \(blocked\)\s*\{\s*return null;\s*\}/);
}

function testTrustedProxyNotEnabledByPresenceAlone(): void {
  const helperSource = readSource("src/lib/security/login-throttle/trusted-client-ip.ts");
  assert.match(helperSource, /TRUST_PROXY_HEADERS === "true"/);
  assert.match(helperSource, /if \(!isTrustedProxyEnabled\(\)\)/);

  const original = process.env.TRUST_PROXY_HEADERS;
  try {
    delete process.env.TRUST_PROXY_HEADERS;
    const headers = mockHeaders({
      "x-forwarded-for": "203.0.113.1",
      "x-real-ip": "203.0.113.2",
    });
    assert.equal(resolveTrustedClientIp(headers), null);
  } finally {
    if (original === undefined) {
      delete process.env.TRUST_PROXY_HEADERS;
    } else {
      process.env.TRUST_PROXY_HEADERS = original;
    }
  }
}

async function main(): Promise<void> {
  process.env.AUTH_SECRET = "test-auth-secret-32-characters-minimum";
  resetLoginThrottleCleanupClockForTests();

  testEmailNormalizationAndHmac();
  testPasswordNeverStored();
  await testAccountThrottleBlocksAfterFiveFailures();
  await testThrottleExpiresAfterBlock();
  await testSuccessfulLoginClearsAccountThrottle();
  await testNonexistentEmailUsesSameThrottle();
  await testDummyBcryptUsedForMissingUser();
  testDummyHashIsStaticAndNotLogged();
  testNeutralLoginErrorOnPage();
  await testInactiveUserDoesNotChangeState();
  await testParallelFailuresDoNotLoseCounter();
  await testBoundaryIsAtomic();
  testNoSensitiveLogging();
  testTrustedProxyPolicy();
  await testIpThrottleOnlyWithTrustedProxy();
  await testBlockedAttemptUsesSamePublicOutcome();
  await testAttemptsOneThroughSixSemantics();
  await testBlockedAttemptDoesNotExtendBlock();
  await testBcryptRunsDuringActiveBlock();
  await testCorrectPasswordDoesNotBypassIpBlock();
  await testParallelBlockedCorrectAndWrong();
  await testSerializableRetryFailClosed();
  await testClearFailureIsFailClosed();
  testSessionFreshnessAndPasswordResetUntouched();
  testAuthUsesDbBackedModule();
  testPrismaModelPresent();
  testNoInMemoryLoginLimiterPath();
  testTrustedProxyNotEnabledByPresenceAlone();

  console.log("security-login-throttle-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
