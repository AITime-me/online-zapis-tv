import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  applyPasswordReset,
  buildPasswordResetUrl,
  hashPasswordResetToken,
  isSyntacticallyValidPasswordResetEmail,
  parsePasswordResetTokenFromHash,
  PASSWORD_RESET_EMAIL_COOLDOWN_MS,
  PASSWORD_RESET_NEUTRAL_MESSAGE,
  PASSWORD_RESET_TOKEN_TTL_MS,
  PasswordResetError,
  requestPasswordReset,
  type PasswordResetCompletePrisma,
  type PasswordResetRequestPrisma,
  validateNewResetPassword,
} from "../src/lib/auth/password-reset";
import type { Mailer } from "../src/lib/mail/mailer";

const VALID_PASSWORD = "NewResetPass123";
const RAW_TOKEN = "test-raw-token-value";
const TOKEN_HASH = hashPasswordResetToken(RAW_TOKEN);
const AUTH_URL = "https://studio.example.ru";

type UserRow = {
  id: string;
  email: string;
  isActive: boolean;
};

type TokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function activeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-1",
    email: "user@studio.ru",
    isActive: true,
    ...overrides,
  };
}

function createRequestMock(options: {
  user: UserRow | null;
  tokens?: TokenRecord[];
  failCreate?: boolean;
  failDeleteUnused?: boolean;
  now?: Date;
}) {
  const tokens: TokenRecord[] = [...(options.tokens ?? [])];
  const now = options.now ?? new Date("2026-07-14T10:00:00.000Z");
  const logs: string[] = [];
  let mailCalls = 0;
  let mailShouldFail = false;
  let lastCreatedTokenId: string | null = null;
  const deletedTokenIds: string[] = [];
  let findFirstInTxCalls = 0;
  let deleteManyCalls = 0;
  let createCalls = 0;

  const mailer: Mailer = {
    async sendMail() {
      mailCalls += 1;
      if (mailShouldFail) {
        throw new Error("smtp down");
      }
    },
  };

  const db: PasswordResetRequestPrisma = {
    user: {
      async findUnique(args: { where: { email: string } }) {
        if (!options.user || args.where.email !== options.user.email) {
          return null;
        }
        return { ...options.user };
      },
    },
    passwordResetToken: {
      async delete(args: { where: { id: string } }) {
        deletedTokenIds.push(args.where.id);
        const index = tokens.findIndex((t) => t.id === args.where.id);
        if (index >= 0) {
          tokens.splice(index, 1);
        }
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        passwordResetToken: {
          async findFirst(args: {
            where: { userId: string; createdAt: { gte: Date } };
          }) {
            findFirstInTxCalls += 1;
            const match = tokens.find(
              (token) =>
                token.userId === args.where.userId &&
                token.createdAt.getTime() >= args.where.createdAt.gte.getTime(),
            );
            return match ? { id: match.id } : null;
          },
          async deleteMany() {
            deleteManyCalls += 1;
            if (options.failDeleteUnused) {
              throw new Error("delete failed");
            }
            const before = tokens.length;
            for (let i = tokens.length - 1; i >= 0; i -= 1) {
              if (tokens[i].usedAt === null) {
                tokens.splice(i, 1);
              }
            }
            return { count: before - tokens.length };
          },
          async create(args: {
            data: { userId: string; tokenHash: string; expiresAt: Date };
          }) {
            createCalls += 1;
            if (options.failCreate) {
              throw new Error("create failed");
            }
            assert.notEqual(
              args.data.tokenHash,
              RAW_TOKEN,
              "сырой token не должен сохраняться в БД",
            );
            assert.match(
              args.data.tokenHash,
              /^[a-f0-9]{64}$/i,
              "в БД должен храниться SHA-256 hash",
            );
            const record: TokenRecord = {
              id: `token-${tokens.length + 1}`,
              userId: args.data.userId,
              tokenHash: args.data.tokenHash,
              expiresAt: args.data.expiresAt,
              usedAt: null,
              createdAt: now,
            };
            tokens.push(record);
            lastCreatedTokenId = record.id;
            return { id: record.id };
          },
        },
      };
      return fn(tx);
    },
  };

  return {
    db,
    mailer,
    tokens,
    logs,
    get mailCalls() {
      return mailCalls;
    },
    set mailFails(value: boolean) {
      mailShouldFail = value;
    },
    get lastCreatedTokenId() {
      return lastCreatedTokenId;
    },
    get deletedTokenIds() {
      return deletedTokenIds;
    },
    get findFirstInTxCalls() {
      return findFirstInTxCalls;
    },
    get deleteManyCalls() {
      return deleteManyCalls;
    },
    get createCalls() {
      return createCalls;
    },
    logMailFailure(reason: string) {
      logs.push(reason);
    },
  };
}

function createSerializableRequestMock(user: UserRow, now = new Date("2026-07-14T10:00:00.000Z")) {
  const tokens: TokenRecord[] = [];
  let mailCalls = 0;
  let mailShouldFail = false;
  const deletedTokenIds: string[] = [];
  let txChain: Promise<unknown> = Promise.resolve();

  const mailer: Mailer = {
    async sendMail() {
      mailCalls += 1;
      if (mailShouldFail) {
        throw new Error("smtp down");
      }
    },
  };

  const db: PasswordResetRequestPrisma = {
    user: {
      async findUnique() {
        return user;
      },
    },
    passwordResetToken: {
      async delete(args: { where: { id: string } }) {
        deletedTokenIds.push(args.where.id);
        const index = tokens.findIndex((token) => token.id === args.where.id);
        if (index >= 0) {
          tokens.splice(index, 1);
        }
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const run = txChain.then(async () => {
        const tx = {
          passwordResetToken: {
            async findFirst(args: {
              where: { userId: string; createdAt: { gte: Date } };
            }) {
              const match = tokens.find(
                (token) =>
                  token.userId === args.where.userId &&
                  token.createdAt.getTime() >= args.where.createdAt.gte.getTime(),
              );
              return match ? { id: match.id } : null;
            },
            async deleteMany(args: { where: { userId: string; usedAt: null } }) {
              const before = tokens.length;
              for (let i = tokens.length - 1; i >= 0; i -= 1) {
                if (
                  tokens[i].userId === args.where.userId &&
                  tokens[i].usedAt === null
                ) {
                  tokens.splice(i, 1);
                }
              }
              return { count: before - tokens.length };
            },
            async create(args: {
              data: { userId: string; tokenHash: string; expiresAt: Date };
            }) {
              const record: TokenRecord = {
                id: `token-${tokens.length + 1}`,
                userId: args.data.userId,
                tokenHash: args.data.tokenHash,
                expiresAt: args.data.expiresAt,
                usedAt: null,
                createdAt: now,
              };
              tokens.push(record);
              return { id: record.id };
            },
          },
        };
        return fn(tx);
      });
      txChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };

  return {
    db,
    mailer,
    tokens,
    deletedTokenIds,
    get mailCalls() {
      return mailCalls;
    },
    set mailFails(value: boolean) {
      mailShouldFail = value;
    },
  };
}

function createCompleteMock(options: {
  token: TokenRecord | null;
  otherUnusedCount?: number;
  failMarkUsed?: boolean;
}) {
  const committed = {
    passwordHash: null as string | null,
    passwordChangedAt: null as Date | null,
    markedUsed: false,
    deletedOthers: 0,
    txCommitted: false,
  };

  const token = options.token ? { ...options.token } : null;

  const db: PasswordResetCompletePrisma = {
    passwordResetToken: {
      async findUnique(args: { where: { tokenHash: string } }) {
        if (!token || args.where.tokenHash !== token.tokenHash) {
          return null;
        }
        return {
          ...token,
          user: activeUser({ id: token.userId }),
        };
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const pending = {
        passwordHash: null as string | null,
        passwordChangedAt: null as Date | null,
        markedUsed: false,
        deletedOthers: 0,
      };

      const tx = {
        passwordResetToken: {
          async updateMany(args: {
            where: { id: string; usedAt: null; expiresAt: { gt: Date } };
            data: { usedAt: Date };
          }) {
            if (options.failMarkUsed) {
              throw new Error("update failed");
            }
            if (!token || token.id !== args.where.id || token.usedAt) {
              return { count: 0 };
            }
            if (token.expiresAt.getTime() <= args.where.expiresAt.gt.getTime()) {
              return { count: 0 };
            }
            token.usedAt = args.data.usedAt;
            pending.markedUsed = true;
            return { count: 1 };
          },
          async findUnique(args: { where: { id: string } }) {
            if (!token || token.id !== args.where.id) {
              return null;
            }
            return { usedAt: token.usedAt, expiresAt: token.expiresAt };
          },
          async deleteMany() {
            pending.deletedOthers = options.otherUnusedCount ?? 0;
            return { count: pending.deletedOthers };
          },
        },
        user: {
          async update(args: {
            data: { passwordHash: string; passwordChangedAt: Date };
          }) {
            pending.passwordHash = args.data.passwordHash;
            pending.passwordChangedAt = args.data.passwordChangedAt;
          },
        },
      };

      const result = await fn(tx);
      committed.passwordHash = pending.passwordHash;
      committed.passwordChangedAt = pending.passwordChangedAt;
      committed.markedUsed = pending.markedUsed;
      committed.deletedOthers = pending.deletedOthers;
      committed.txCommitted = true;
      return result;
    },
  };

  const hashPassword = async (plain: string) => `HASHED::${plain.length}`;

  return { db, committed, hashPassword, token };
}

async function testNeutralResponseSameForMissingAndExistingUser(): Promise<void> {
  const existing = createRequestMock({ user: activeUser() });
  const missing = createRequestMock({ user: null });
  const now = new Date("2026-07-14T10:00:00.000Z");

  const existingResult = await requestPasswordReset(existing.db, existing.mailer, {
    email: "user@studio.ru",
    authUrl: AUTH_URL,
    now,
    generateToken: () => RAW_TOKEN,
    logMailFailure: existing.logMailFailure,
  });

  const missingResult = await requestPasswordReset(missing.db, missing.mailer, {
    email: "ghost@studio.ru",
    authUrl: AUTH_URL,
    now,
    generateToken: () => RAW_TOKEN,
    logMailFailure: missing.logMailFailure,
  });

  assert.equal(existingResult.message, PASSWORD_RESET_NEUTRAL_MESSAGE);
  assert.equal(missingResult.message, PASSWORD_RESET_NEUTRAL_MESSAGE);
  assert.equal(existingResult.message, missingResult.message);
  assert.equal(existing.mailCalls, 1);
  assert.equal(missing.mailCalls, 0);
}

async function testInactiveUserGetsNeutralResponse(): Promise<void> {
  const mock = createRequestMock({ user: activeUser({ isActive: false }) });
  const result = await requestPasswordReset(mock.db, mock.mailer, {
    email: "user@studio.ru",
    authUrl: AUTH_URL,
    generateToken: () => RAW_TOKEN,
    logMailFailure: mock.logMailFailure,
  });

  assert.equal(result.message, PASSWORD_RESET_NEUTRAL_MESSAGE);
  assert.equal(result.emailDispatched, false);
  assert.equal(mock.mailCalls, 0);
}

async function testRateLimitNeutralResponse(): Promise<void> {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const recent: TokenRecord = {
    id: "recent-1",
    userId: "user-1",
    tokenHash: "recent-hash",
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    usedAt: null,
    createdAt: new Date(now.getTime() - 30_000),
  };
  const mock = createRequestMock({ user: activeUser(), tokens: [recent], now });
  const result = await requestPasswordReset(mock.db, mock.mailer, {
    email: "user@studio.ru",
    authUrl: AUTH_URL,
    now,
    generateToken: () => RAW_TOKEN,
    logMailFailure: mock.logMailFailure,
  });

  assert.equal(result.message, PASSWORD_RESET_NEUTRAL_MESSAGE);
  assert.equal(result.emailDispatched, false);
  assert.equal(mock.mailCalls, 0);
  assert.equal(mock.deleteManyCalls, 0, "rate limit не должен удалять токены");
  assert.equal(mock.createCalls, 0, "rate limit не должен создавать токен");
  assert.equal(mock.tokens.length, 1);
  assert.equal(mock.tokens[0].id, "recent-1");
}

async function testMailFailureRemovesToken(): Promise<void> {
  const mock = createRequestMock({ user: activeUser() });
  mock.mailFails = true;

  const result = await requestPasswordReset(mock.db, mock.mailer, {
    email: "user@studio.ru",
    authUrl: AUTH_URL,
    generateToken: () => RAW_TOKEN,
    logMailFailure: mock.logMailFailure,
  });

  assert.equal(result.emailDispatched, false);
  assert.equal(mock.tokens.length, 0, "после ошибки почты token не должен оставаться");
  assert.deepEqual(mock.deletedTokenIds, [mock.lastCreatedTokenId]);
  assert.match(mock.logs.join(" "), /mail delivery failed/);
}

async function testResetUrlBuiltFromAuthUrl(): Promise<void> {
  const url = buildPasswordResetUrl("https://trusted.example.ru/app/", RAW_TOKEN);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://trusted.example.ru");
  assert.equal(parsed.pathname, "/reset-password");
  assert.equal(parsed.search, "", "token не должен быть в query string");
  assert.doesNotMatch(url, /\?token=/, "сырой token не должен быть в query string");
  assert.match(url, /#token=/, "reset URL должен использовать fragment #token=");
  assert.equal(
    parsePasswordResetTokenFromHash(parsed.hash),
    RAW_TOKEN,
    "token должен извлекаться из fragment",
  );
  assert.doesNotMatch(url, /request\.headers|req\.headers|get\("host"\)/i);
}

function testParsePasswordResetTokenFromHash(): void {
  assert.equal(
    parsePasswordResetTokenFromHash(`#token=${encodeURIComponent(RAW_TOKEN)}`),
    RAW_TOKEN,
  );
  assert.equal(parsePasswordResetTokenFromHash(""), "");
  assert.equal(parsePasswordResetTokenFromHash("#other=value"), "");
}

async function testSuccessfulResetUpdatesPasswordChangedAt(): Promise<void> {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const tokenRecord: TokenRecord = {
    id: "token-1",
    userId: "user-1",
    tokenHash: TOKEN_HASH,
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    usedAt: null,
    createdAt: now,
  };
  const { db, committed, hashPassword } = createCompleteMock({
    token: tokenRecord,
    otherUnusedCount: 2,
  });

  const result = await applyPasswordReset(
    db,
    { rawToken: RAW_TOKEN, newPassword: VALID_PASSWORD, confirmation: VALID_PASSWORD, now },
    hashPassword,
  );

  assert.equal(committed.txCommitted, true);
  assert.equal(committed.markedUsed, true);
  assert.equal(committed.passwordChangedAt?.getTime(), now.getTime());
  assert.ok(committed.passwordHash?.startsWith("HASHED::"));
  assert.equal(result.invalidatedTokens, 2);
}

async function testExpiredTokenRejected(): Promise<void> {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const tokenRecord: TokenRecord = {
    id: "token-1",
    userId: "user-1",
    tokenHash: TOKEN_HASH,
    expiresAt: new Date(now.getTime() - 1000),
    usedAt: null,
    createdAt: now,
  };
  const { db, hashPassword } = createCompleteMock({ token: tokenRecord });

  await assert.rejects(
    applyPasswordReset(
      db,
      { rawToken: RAW_TOKEN, newPassword: VALID_PASSWORD, confirmation: VALID_PASSWORD, now },
      hashPassword,
    ),
    (error: unknown) => error instanceof PasswordResetError && error.code === "expired",
  );
}

async function testUsedTokenRejected(): Promise<void> {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const tokenRecord: TokenRecord = {
    id: "token-1",
    userId: "user-1",
    tokenHash: TOKEN_HASH,
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    usedAt: now,
    createdAt: now,
  };
  const { db, hashPassword } = createCompleteMock({ token: tokenRecord });

  await assert.rejects(
    applyPasswordReset(
      db,
      { rawToken: RAW_TOKEN, newPassword: VALID_PASSWORD, confirmation: VALID_PASSWORD, now },
      hashPassword,
    ),
    (error: unknown) => error instanceof PasswordResetError && error.code === "used",
  );
}

async function testInvalidTokenRejected(): Promise<void> {
  const { db, hashPassword } = createCompleteMock({ token: null });

  await assert.rejects(
    applyPasswordReset(
      db,
      { rawToken: "unknown-token", newPassword: VALID_PASSWORD, confirmation: VALID_PASSWORD },
      hashPassword,
    ),
    (error: unknown) => error instanceof PasswordResetError && error.code === "invalid",
  );
}

async function testTokenLookupByHashOnly(): Promise<void> {
  const source = readSource("src/lib/auth/password-reset.ts");
  assert.match(source, /hashPasswordResetToken\(rawToken\)/, "поиск token только по hash");
  assert.match(source, /where:\s*\{\s*tokenHash\s*\}/, "findUnique по tokenHash");
  assert.doesNotMatch(
    source,
    /tokenHash:\s*rawToken|token:\s*rawToken/,
    "сырой token не должен попадать в where БД",
  );
}

function testSourceNoSecretLogging(): void {
  const files = [
    "src/lib/auth/password-reset.ts",
    "src/services/PasswordResetService.ts",
    "src/app/api/auth/forgot-password/route.ts",
    "src/app/api/auth/reset-password/route.ts",
    "src/app/(internal)/forgot-password/page.tsx",
    "src/app/(internal)/reset-password/page.tsx",
  ];

  for (const file of files) {
    const source = readSource(file);
    const consoleCalls = source.match(/console\.(log|info|warn)\([^;]*\)/g) ?? [];
    for (const call of consoleCalls) {
      assert.doesNotMatch(call, /token|password|rawToken|SMTP_PASSWORD/i, `${file}: console не должен логировать секреты`);
    }
    assert.doesNotMatch(source, /console\.log\([^)]*rawToken/i, `${file} не должен логировать raw token`);
    assert.doesNotMatch(source, /console\.log\([^)]*password/i, `${file} не должен логировать password`);
  }

  const service = readSource("src/services/PasswordResetService.ts");
  assert.match(service, /\[password-reset\] mail delivery failed|logMailFailure/, "ошибка почты — обобщённый лог");
}

function testLoginPageHasForgotPasswordLink(): void {
  const login = readSource("src/app/(internal)/login/page.tsx");
  assert.match(login, /\/forgot-password/, "на странице входа должна быть ссылка на восстановление");
  assert.match(login, /Забыли пароль\?/, "текст ссылки «Забыли пароль?»");
}

function testAuthUrlNotFromHostHeader(): void {
  const lib = readSource("src/lib/auth/password-reset.ts");
  assert.match(lib, /base\.hash = `token=\$\{encodeURIComponent\(rawToken\)\}`/, "URL использует fragment");
  assert.doesNotMatch(lib, /searchParams\.set\("token"/, "buildPasswordResetUrl не должен использовать query");
  assert.doesNotMatch(lib, /headers\(\)|req\.headers|request\.headers|get\("host"\)/i, "Host заголовок не используется");

  const service = readSource("src/services/PasswordResetService.ts");
  assert.match(service, /process\.env\.AUTH_URL/, "AUTH_URL берётся из server env");
  assert.doesNotMatch(service, /headers\(\)|request\.headers/i, "service не читает Host");
}

function testSha256Implementation(): void {
  const source = readSource("src/lib/auth/password-reset.ts");
  assert.match(source, /createHash\("sha256"\)/, "SHA-256 для hash token");
  assert.equal(
    hashPasswordResetToken("sample-token"),
    hashPasswordResetToken("sample-token"),
    "hash детерминирован",
  );
  assert.notEqual(hashPasswordResetToken("a"), hashPasswordResetToken("b"));
}

function testCooldownConstant(): void {
  assert.equal(PASSWORD_RESET_EMAIL_COOLDOWN_MS, 60 * 1000, "не более одного письма в минуту");
  assert.equal(PASSWORD_RESET_TOKEN_TTL_MS, 30 * 60 * 1000, "срок ссылки 30 минут");
}

function testPasswordValidationReused(): void {
  assert.throws(
    () => validateNewResetPassword(VALID_PASSWORD, "OtherPass123"),
    (error: unknown) => error instanceof PasswordResetError && error.code === "mismatch",
  );
  assert.throws(
    () => validateNewResetPassword("short", "short"),
    (error: unknown) => error instanceof PasswordResetError && error.code === "policy",
  );
}

function testSyntacticallyValidEmailHelper(): void {
  assert.equal(isSyntacticallyValidPasswordResetEmail("user@studio.ru"), true);
  assert.equal(isSyntacticallyValidPasswordResetEmail("  User@Studio.RU  "), true);
  assert.equal(isSyntacticallyValidPasswordResetEmail(""), false);
  assert.equal(isSyntacticallyValidPasswordResetEmail("not-an-email"), false);
}

function testLibDoesNotImportRuntimePrisma(): void {
  const lib = readSource("src/lib/auth/password-reset.ts");
  assert.ok(!lib.includes("@/lib/db"), "password-reset.ts не должен импортировать prisma");
}

function testNoAutoSignInAfterReset(): void {
  const resetPage = readSource("src/app/(internal)/reset-password/page.tsx");
  const resetRoute = readSource("src/app/api/auth/reset-password/route.ts");
  assert.doesNotMatch(resetPage, /signIn\(/, "UI не выполняет автоматический вход");
  assert.doesNotMatch(resetRoute, /signIn\(/, "API не выполняет автоматический вход");
}

function testResetPageStripsTokenFromUrl(): void {
  const resetPage = readSource("src/app/(internal)/reset-password/page.tsx");

  assert.match(resetPage, /readFragmentCaptureOnce|captureTokenFromFragment/, "token считывается из fragment один раз");
  assert.match(resetPage, /window\.location\.hash/, "token читается из window.location.hash");
  assert.match(resetPage, /new URLSearchParams\(hash\)/, "token декодируется через URLSearchParams");
  assert.match(resetPage, /useSyncExternalStore/, "чтение fragment через client-only store");
  assert.doesNotMatch(resetPage, /searchParams\.get\("token"\)/, "query string ?token= не используется");
  assert.doesNotMatch(resetPage, /useSearchParams/, "страница не должна читать token из query через useSearchParams");
  assert.match(
    resetPage,
    /history\.replaceState\(null,\s*"",\s*"\/reset-password"\)/,
    "token должен удаляться из адресной строки",
  );
  assert.match(resetPage, /useState\(capture\.token\)/, "token сохраняется во внутреннем state");
  assert.match(resetPage, /Загрузка\.\.\./, "должно быть промежуточное состояние загрузки");
  assert.match(resetPage, /JSON\.stringify\(\{\s*token,/s, "POST использует token из state");
  assert.doesNotMatch(resetPage, /value=\{token\}/, "token не должен отображаться в DOM");
  assert.doesNotMatch(resetPage, />\{token\}</, "token не должен выводиться в разметке");
}

function testForgotPasswordUsesAfterWithoutAwaitingSmtp(): void {
  const route = readSource("src/app/api/auth/forgot-password/route.ts");
  const postHandler = route.match(/export async function POST[\s\S]*$/)?.[0] ?? "";

  assert.ok(postHandler, "должен быть POST handler");
  assert.match(route, /import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*"next\/server"/, "route должен использовать after() из next/server");
  assert.match(postHandler, /after\s*\(\s*async\s*\(\)\s*=>\s*\{/, "фоновая работа через after(async () => ...)");
  assert.match(postHandler, /after\s*\([\s\S]*?await\s+requestPasswordResetByEmail\(email\)/, "await допустим только внутри after()");
  assert.doesNotMatch(
    postHandler.split("return NextResponse")[0] ?? "",
    /await\s+requestPasswordResetByEmail/,
    "HTTP-ответ не должен ждать SMTP/Prisma",
  );
  assert.match(postHandler, /background request failed/, "ошибки фона логируются обобщённо");
  assert.doesNotMatch(postHandler, /void\s+requestPasswordResetByEmail/, "не использовать void promise вместо after()");
  assert.match(route, /PASSWORD_RESET_NEUTRAL_MESSAGE/, "нейтральный ответ сохранён");
  assert.match(postHandler, /NEUTRAL_RESPONSE/, "handler возвращает нейтральный ответ");
  assert.match(postHandler, /isSyntacticallyValidPasswordResetEmail/, "фон запускается для синтаксически валидного email");
  assert.doesNotMatch(postHandler, /console\.(log|info|warn)\([^)]*email/i, "фон не логирует email");
}

function testResetPageReferrerPolicy(): void {
  const middleware = readSource("src/middleware.ts");

  assert.match(middleware, /\/reset-password/, "middleware должен обрабатывать /reset-password");
  assert.match(
    middleware,
    /pathname === "\/reset-password"[\s\S]*?Referrer-Policy",\s*"no-referrer"/,
    "для /reset-password должен задаваться Referrer-Policy: no-referrer",
  );
}

function testClientPagesDoNotImportServerPasswordReset(): void {
  const clientPages = [
    "src/app/(internal)/forgot-password/page.tsx",
    "src/app/(internal)/reset-password/page.tsx",
  ];

  for (const file of clientPages) {
    const source = readSource(file);
    assert.doesNotMatch(
      source,
      /@\/lib\/auth\/password-reset["']/,
      `${file} не должен импортировать серверный password-reset.ts`,
    );
    assert.doesNotMatch(source, /node:crypto|@prisma\/client/, `${file} не должен тянуть Node/Prisma`);
  }

  const forgot = readSource("src/app/(internal)/forgot-password/page.tsx");
  assert.match(
    forgot,
    /password-reset-messages/,
    "forgot-password должен использовать client-safe messages-модуль",
  );
}

function testPasswordResetMessagesModuleIsClientSafe(): void {
  const messages = readSource("src/lib/auth/password-reset-messages.ts");

  assert.doesNotMatch(messages, /node:crypto|@prisma\/client|bcrypt|nodemailer/i);
  assert.match(messages, /PASSWORD_RESET_NEUTRAL_MESSAGE/);

  const serverModule = readSource("src/lib/auth/password-reset.ts");
  assert.match(
    serverModule,
    /password-reset-messages/,
    "серверный password-reset.ts должен переиспользовать messages-модуль",
  );
}

function testRateLimitCheckedInsideTransaction(): void {
  const source = readSource("src/lib/auth/password-reset.ts");
  assert.match(
    source,
    /createPasswordResetTokenInTransaction/,
    "логика rate limit и создания token должна быть в одной tx-функции",
  );
  assert.match(
    source,
    /tx\.passwordResetToken\.findFirst[\s\S]*?rate_limited/,
    "rate limit проверяется внутри транзакции",
  );
  assert.match(
    source,
    /findFirst[\s\S]*?deleteMany[\s\S]*?create/,
    "findFirst должен выполняться до deleteMany/create",
  );
  assert.doesNotMatch(
    source,
    /if \(!isEligibleForResetRequest\(user\)\)[\s\S]*?passwordResetToken\.findFirst/,
    "findFirst для rate limit не должен быть вне транзакции",
  );
  assert.match(
    source,
    /TransactionIsolationLevel\.Serializable/,
    "запрос token должен использовать Serializable isolation",
  );
}

async function testConcurrentRequestsOnlyOneTokenAndEmail(): Promise<void> {
  const user = activeUser();
  const now = new Date("2026-07-14T10:00:00.000Z");
  const mock = createSerializableRequestMock(user, now);

  const [first, second] = await Promise.all([
    requestPasswordReset(mock.db, mock.mailer, {
      email: user.email,
      authUrl: AUTH_URL,
      now,
      logMailFailure: () => {},
    }),
    requestPasswordReset(mock.db, mock.mailer, {
      email: user.email,
      authUrl: AUTH_URL,
      now,
      logMailFailure: () => {},
    }),
  ]);

  assert.equal(first.message, PASSWORD_RESET_NEUTRAL_MESSAGE);
  assert.equal(second.message, PASSWORD_RESET_NEUTRAL_MESSAGE);
  assert.equal(mock.tokens.length, 1, "должна остаться только одна действующая ссылка");
  assert.equal(mock.mailCalls, 1, "должно уйти только одно письмо");
  assert.equal(
    Number(first.emailDispatched) + Number(second.emailDispatched),
    1,
    "только один запрос должен отправить письмо",
  );
}

async function testMailFailureDoesNotDeleteSuccessfulConcurrentToken(): Promise<void> {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const successfulToken: TokenRecord = {
    id: "token-success",
    userId: "user-1",
    tokenHash: "hash-success",
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    usedAt: null,
    createdAt: new Date(now.getTime() - 1_000),
  };
  const mock = createRequestMock({
    user: activeUser(),
    tokens: [successfulToken],
    now,
  });
  mock.mailFails = true;

  await requestPasswordReset(mock.db, mock.mailer, {
    email: "user@studio.ru",
    authUrl: AUTH_URL,
    now,
    generateToken: () => RAW_TOKEN,
    logMailFailure: mock.logMailFailure,
  });

  assert.equal(mock.tokens.length, 1);
  assert.equal(mock.tokens[0].id, "token-success");
  assert.equal(mock.deletedTokenIds.length, 0);
  assert.equal(mock.createCalls, 0);
}

async function testParallelResetOnlyOneSucceeds(): Promise<void> {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const tokenRecord: TokenRecord = {
    id: "token-1",
    userId: "user-1",
    tokenHash: TOKEN_HASH,
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    usedAt: null,
    createdAt: now,
  };
  const { db, hashPassword } = createCompleteMock({ token: tokenRecord });

  const results = await Promise.allSettled([
    applyPasswordReset(
      db,
      { rawToken: RAW_TOKEN, newPassword: VALID_PASSWORD, confirmation: VALID_PASSWORD, now },
      hashPassword,
    ),
    applyPasswordReset(
      db,
      { rawToken: RAW_TOKEN, newPassword: VALID_PASSWORD, confirmation: VALID_PASSWORD, now },
      hashPassword,
    ),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1, "только один параллельный сброс должен завершиться успехом");
  assert.equal(rejected.length, 1, "второй параллельный сброс должен быть отклонён");
  const reason = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(reason instanceof PasswordResetError);
  assert.equal(reason.code, "used");
}

async function main(): Promise<void> {
  await testNeutralResponseSameForMissingAndExistingUser();
  await testInactiveUserGetsNeutralResponse();
  await testRateLimitNeutralResponse();
  await testMailFailureRemovesToken();
  await testResetUrlBuiltFromAuthUrl();
  testParsePasswordResetTokenFromHash();
  await testSuccessfulResetUpdatesPasswordChangedAt();
  await testExpiredTokenRejected();
  await testUsedTokenRejected();
  await testInvalidTokenRejected();
  testTokenLookupByHashOnly();
  testSourceNoSecretLogging();
  testLoginPageHasForgotPasswordLink();
  testAuthUrlNotFromHostHeader();
  testSha256Implementation();
  testCooldownConstant();
  testPasswordValidationReused();
  testSyntacticallyValidEmailHelper();
  testLibDoesNotImportRuntimePrisma();
  testNoAutoSignInAfterReset();
  testResetPageStripsTokenFromUrl();
  testForgotPasswordUsesAfterWithoutAwaitingSmtp();
  testResetPageReferrerPolicy();
  testClientPagesDoNotImportServerPasswordReset();
  testPasswordResetMessagesModuleIsClientSafe();
  testRateLimitCheckedInsideTransaction();
  await testConcurrentRequestsOnlyOneTokenAndEmail();
  await testMailFailureDoesNotDeleteSuccessfulConcurrentToken();
  await testParallelResetOnlyOneSucceeds();
  console.log("security-password-reset-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
