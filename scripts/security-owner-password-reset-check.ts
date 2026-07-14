import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { UserRole } from "@prisma/client";
import {
  applyOwnerPasswordReset,
  assertOwnerResettable,
  OwnerPasswordResetError,
  type OwnerResetPrisma,
  validateNewOwnerPassword,
} from "../src/lib/auth/owner-password-reset";

const VALID_PASSWORD = "NewOwnerPass123";

type MockUser = {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
};

type Committed = {
  passwordHash: string | null;
  passwordChangedAt: Date | null;
  tokensDeleted: number | null;
  txStarted: boolean;
  txCommitted: boolean;
  hashCalls: number;
};

type MockOptions = {
  user: MockUser | null;
  tokenCount?: number;
  failUpdate?: boolean;
  failDelete?: boolean;
};

/**
 * Мок Prisma с атомарной семантикой: изменения внутри $transaction копятся в
 * pending и «коммитятся» в committed только если колбэк успешно завершился.
 * Если колбэк бросает — pending отбрасывается (модель rollback).
 */
function createMockDb(options: MockOptions) {
  const committed: Committed = {
    passwordHash: null,
    passwordChangedAt: null,
    tokensDeleted: null,
    txStarted: false,
    txCommitted: false,
    hashCalls: 0,
  };

  const userOrNull = () => (options.user ? { ...options.user } : null);

  const db = {
    user: {
      async findUnique() {
        return userOrNull();
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      committed.txStarted = true;
      const pending: { passwordHash?: string; passwordChangedAt?: Date; tokensDeleted?: number } =
        {};

      const tx = {
        user: {
          async findUnique() {
            return userOrNull();
          },
          async update(args: { data: { passwordHash: string; passwordChangedAt: Date } }) {
            if (options.failUpdate) {
              throw new Error("update failed");
            }
            pending.passwordHash = args.data.passwordHash;
            pending.passwordChangedAt = args.data.passwordChangedAt;
            return { id: options.user?.id };
          },
        },
        passwordResetToken: {
          async deleteMany() {
            if (options.failDelete) {
              throw new Error("deleteMany failed");
            }
            pending.tokensDeleted = options.tokenCount ?? 0;
            return { count: options.tokenCount ?? 0 };
          },
        },
      };

      const result = await fn(tx as unknown as Parameters<typeof fn>[0]);
      // Достигается только если колбэк не бросил → commit.
      committed.passwordHash = pending.passwordHash ?? committed.passwordHash;
      committed.passwordChangedAt = pending.passwordChangedAt ?? committed.passwordChangedAt;
      committed.tokensDeleted = pending.tokensDeleted ?? committed.tokensDeleted;
      committed.txCommitted = true;
      return result;
    },
  };

  const hashPassword = async (plain: string) => {
    committed.hashCalls += 1;
    return `HASHED::${plain.length}`;
  };

  return { db: db as unknown as OwnerResetPrisma, committed, hashPassword };
}

function owner(overrides: Partial<MockUser> = {}): MockUser {
  return { id: "owner-1", email: "owner@studio.ru", role: "OWNER" as UserRole, isActive: true, ...overrides };
}

async function testSuccessfulAtomicReset(): Promise<void> {
  const { db, committed, hashPassword } = createMockDb({ user: owner(), tokenCount: 3 });
  const now = new Date("2026-07-13T06:00:00.000Z");

  const result = await applyOwnerPasswordReset(
    db,
    { email: "owner@studio.ru", newPassword: VALID_PASSWORD },
    hashPassword,
    now,
  );

  assert.equal(committed.txCommitted, true, "транзакция должна быть закоммичена");
  assert.ok(committed.passwordHash, "passwordHash должен быть записан");
  assert.ok(
    committed.passwordHash?.startsWith("HASHED::"),
    "passwordHash должен быть результатом внедрённой хеш-функции",
  );
  assert.notEqual(committed.passwordHash, VALID_PASSWORD, "в БД не должен попадать открытый пароль");

  // passwordChangedAt обновлён на переданный now.
  assert.equal(committed.passwordChangedAt?.getTime(), now.getTime(), "passwordChangedAt должен обновиться");

  // reset-токены инвалидированы (удалены).
  assert.equal(committed.tokensDeleted, 3, "неиспользованные reset-токены должны быть удалены");
  assert.equal(result.invalidatedTokens, 3);

  // Результат не содержит секретов.
  assert.ok(!("passwordHash" in result), "результат не должен содержать passwordHash");
  assert.deepEqual(Object.keys(result).sort(), ["email", "invalidatedTokens"]);
}

async function testWrongRoleRejected(): Promise<void> {
  const { db, committed, hashPassword } = createMockDb({ user: owner({ role: "MANAGER" as UserRole }) });

  await assert.rejects(
    applyOwnerPasswordReset(db, { email: "owner@studio.ru", newPassword: VALID_PASSWORD }, hashPassword),
    OwnerPasswordResetError,
    "не-OWNER должен быть отклонён",
  );
  assert.equal(committed.passwordHash, null, "пароль не должен меняться для не-OWNER");
  assert.equal(committed.tokensDeleted, null, "токены не должны трогаться для не-OWNER");

  // И предпроверка тоже отклоняет.
  await assert.rejects(assertOwnerResettable(db, "owner@studio.ru"), OwnerPasswordResetError);
}

async function testUserNotFoundRejected(): Promise<void> {
  const { db, committed, hashPassword } = createMockDb({ user: null });

  await assert.rejects(
    applyOwnerPasswordReset(db, { email: "ghost@studio.ru", newPassword: VALID_PASSWORD }, hashPassword),
    OwnerPasswordResetError,
    "несуществующий пользователь должен быть отклонён",
  );
  assert.equal(committed.passwordHash, null);

  await assert.rejects(assertOwnerResettable(db, "ghost@studio.ru"), OwnerPasswordResetError);
}

async function testPolicyViolationRejectedBeforeHashing(): Promise<void> {
  const { db, committed, hashPassword } = createMockDb({ user: owner() });

  await assert.rejects(
    applyOwnerPasswordReset(db, { email: "owner@studio.ru", newPassword: "short" }, hashPassword),
    OwnerPasswordResetError,
    "слабый пароль должен быть отклонён",
  );
  assert.equal(committed.hashCalls, 0, "хеширование не должно вызываться при нарушении политики");
  assert.equal(committed.txStarted, false, "транзакция не должна стартовать при нарушении политики");
  assert.equal(committed.passwordHash, null);
}

function testMismatchAndEmptyRejected(): void {
  assert.throws(
    () => validateNewOwnerPassword(VALID_PASSWORD, "OtherPass123"),
    OwnerPasswordResetError,
    "несовпадающие пароли должны быть отклонены",
  );
  assert.throws(
    () => validateNewOwnerPassword("", ""),
    OwnerPasswordResetError,
    "пустой пароль должен быть отклонён",
  );
  assert.throws(
    () => validateNewOwnerPassword("short", "short"),
    OwnerPasswordResetError,
    "пароль вне политики должен быть отклонён",
  );
  // Валидная пара не бросает.
  assert.doesNotThrow(() => validateNewOwnerPassword(VALID_PASSWORD, VALID_PASSWORD));
}

async function testDryRunDoesNotMutate(): Promise<void> {
  const { db, committed } = createMockDb({ user: owner(), tokenCount: 5 });

  const target = await assertOwnerResettable(db, "owner@studio.ru");
  assert.equal(target.email, "owner@studio.ru");

  // Предпроверка (используется dry-run) не открывает транзакцию и не пишет в БД.
  assert.equal(committed.txStarted, false, "dry-run/предпроверка не должна открывать транзакцию");
  assert.equal(committed.passwordHash, null, "dry-run не должен менять пароль");
  assert.equal(committed.tokensDeleted, null, "dry-run не должен трогать токены");
}

async function testFailedUpdateRollsBack(): Promise<void> {
  const { db, committed, hashPassword } = createMockDb({ user: owner(), tokenCount: 2, failUpdate: true });

  await assert.rejects(
    applyOwnerPasswordReset(db, { email: "owner@studio.ru", newPassword: VALID_PASSWORD }, hashPassword),
    "ошибка update должна отклонить операцию",
  );
  assert.equal(committed.txCommitted, false, "при ошибке транзакция не должна коммититься");
  assert.equal(committed.passwordHash, null, "не должно остаться частично изменённого пароля");
  assert.equal(committed.tokensDeleted, null, "не должно остаться частичного удаления токенов");
}

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function testNoSecretLeakInCliSource(): void {
  const cli = readSource("scripts/reset-owner-password.ts");

  // В консольный вывод не должны попадать ЗНАЧЕНИЯ секретов: интерполяция
  // ${password...}, прямая передача password/confirmation/hash/token/env.
  const consoleCalls = cli.match(/console\.(log|error|warn|info)\([^;]*?\)\s*;/g) ?? [];
  for (const call of consoleCalls) {
    // Интерполяция секрета в шаблонной строке.
    assert.doesNotMatch(
      call,
      /\$\{[^}]*(\bpassword\b|confirmation|passwordHash|tokenHash|process\.env|DATABASE_URL)/i,
      `console-вывод не должен интерполировать секреты: ${call}`,
    );
    // Прямая передача секрета аргументом (console.log(password) и т.п.).
    assert.doesNotMatch(
      call,
      /console\.\w+\(\s*(password|confirmation|passwordHash|process\.env)\b/i,
      `console-вывод не должен принимать секрет аргументом: ${call}`,
    );
  }

  // Пароль не принимается через argv.
  assert.match(cli, /--password/, "скрипт должен явно отклонять --password");
  // Пароль вводится только скрытым prompt.
  assert.match(cli, /promptHidden\("Новый пароль/, "новый пароль должен запрашиваться через promptHidden");
  assert.match(cli, /promptHidden\("Повторите/, "подтверждение должно запрашиваться через promptHidden");

  // Библиотечный модуль не тянет рантайм-клиент Prisma напрямую (Prisma внедряется).
  const lib = readSource("src/lib/auth/owner-password-reset.ts");
  assert.ok(!lib.includes("@/lib/db"), "owner-password-reset.ts не должен импортировать рантайм prisma");
  // Единый алгоритм хеша (bcrypt cost 10) — как в create-owner.
  assert.match(cli, /bcrypt\.hash\(plain, BCRYPT_COST\)/, "должен использоваться общий bcrypt-хеш");
  assert.match(cli, /BCRYPT_COST = 10/, "bcrypt cost должен быть 10 (как при входе/создании OWNER)");
}

/**
 * Защита от регрессии документации: если runtime-образ (стадия `runner`) не
 * содержит CLI (scripts/ + tsx + полный package.json), документация не должна
 * рекомендовать запуск CLI внутри runtime-контейнера `app`
 * (`docker compose exec app ... owner:reset-password`).
 *
 * Проверка самонастраивается: если кто-то позже начнёт копировать scripts/ и
 * ставить dev-зависимости в runner — ограничение автоматически снимется.
 */
function testDocsDoNotRecommendRunnerExec(): void {
  const dockerfile = readSource("Dockerfile");
  const runnerStart = dockerfile.search(/FROM\s+\S+\s+AS\s+runner/);
  assert.ok(runnerStart !== -1, "в Dockerfile должна быть стадия runner");
  const runnerStage = dockerfile.slice(runnerStart);

  // CLI доступен в runner, только если туда копируются scripts/ и ставятся
  // dev-зависимости (tsx). Иначе `npm run owner:reset-password` там не запустится.
  const runnerCopiesScripts = /COPY[^\n]*\bscripts\b/.test(runnerStage);
  const runnerInstallsDevDeps = /RUN\s+npm\s+ci(?![^\n]*(--omit=dev|--production))/.test(runnerStage);
  const runnerHasCli = runnerCopiesScripts && runnerInstallsDevDeps;

  const docs = readSource("docs/STAGING_PRODUCTION.md");

  if (!runnerHasCli) {
    // Запрещаем любую рекомендацию exec в контейнере app для этого CLI.
    assert.doesNotMatch(
      docs,
      /exec\s+app[^\n]*owner:reset-password/,
      "docs не должны рекомендовать `exec app ... owner:reset-password`: CLI отсутствует в runtime-образе",
    );
    assert.doesNotMatch(
      docs,
      /owner:reset-password[^\n]*\n[^\n]*exec\s+app/,
      "docs не должны рекомендовать exec app для owner:reset-password (перенос строки)",
    );

    // Корректный ops-подход: сборка образа из стадии builder.
    assert.match(docs, /--target\s+builder/, "docs должны описывать сборку через --target builder");
    assert.match(
      docs,
      /online-zapis-tv-ops:local/,
      "docs должны использовать ops-образ online-zapis-tv-ops:local",
    );
    assert.match(docs, /docker run --rm -it/, "CLI должен запускаться через docker run --rm -it");

    // Секреты .env.staging не должны экспортироваться целиком в SSH-сеанс.
    assert.doesNotMatch(
      docs,
      /set -a/,
      "docs не должны использовать `set -a` (экспорт всего .env.staging в сеанс)",
    );

    // DATABASE_URL берётся из запущенного контейнера через docker inspect, без вывода значения.
    assert.match(
      docs,
      /DATABASE_URL="\$\(docker inspect --format '\{\{range \.Config\.Env\}\}[\s\S]*?sed -n 's\/\^DATABASE_URL=\/\/p'\)"/,
      "DATABASE_URL должен извлекаться из контейнера через docker inspect + sed",
    );
    assert.match(
      docs,
      /test -n "\$DATABASE_URL"/,
      "docs должны проверять, что DATABASE_URL не пуст (test -n)",
    );

    // В docker run передаётся только имя переменной, без значения.
    assert.match(docs, /--env DATABASE_URL(?!=)/, "docker run должен получать только имя --env DATABASE_URL");
    assert.doesNotMatch(
      docs,
      /--env\s+DATABASE_URL=|-e\s+DATABASE_URL=/,
      "значение DATABASE_URL не должно передаваться в аргументах docker run",
    );

    // Однозначное определение внутренней staging-сети из контейнера (не по docker network ls).
    // Проверяем только секцию аварийного OWNER-сброса: read-only `docker network ls`
    // допустим в других разделах (например IPv6), но не для выбора сети ops-контейнера.
    const ownerResetSectionMatch = docs.match(
      /## Аварийный сброс пароля OWNER[\s\S]*?(?=\n## )/,
    );
    assert.ok(
      ownerResetSectionMatch,
      "в docs должна быть секция «Аварийный сброс пароля OWNER»",
    );
    const ownerResetSection = ownerResetSectionMatch[0];

    assert.doesNotMatch(
      ownerResetSection,
      /docker network ls/,
      "определение сети для owner:reset-password не должно опираться на docker network ls",
    );
    assert.match(
      ownerResetSection,
      /docker inspect --format '\{\{range \$name, \$_ := \.NetworkSettings\.Networks\}\}[\s\S]*?grep 'staging_internal\$'/,
      "сеть должна определяться из контейнера с фильтром по суффиксу staging_internal",
    );
    assert.match(
      ownerResetSection,
      /grep -c \.[^\n]*-eq 1/,
      "docs должны падать при неоднозначном совпадении сети (ровно одно совпадение)",
    );

    // Гарантированная очистка переменных: изолированный subshell + trap на EXIT.
    assert.match(
      docs,
      /trap '[^']*unset[^']*DATABASE_URL[^']*'\s*EXIT/,
      "docs должны гарантированно очищать переменные через trap ... EXIT",
    );
  }
}

async function main(): Promise<void> {
  await testSuccessfulAtomicReset();
  await testWrongRoleRejected();
  await testUserNotFoundRejected();
  await testPolicyViolationRejectedBeforeHashing();
  testMismatchAndEmptyRejected();
  await testDryRunDoesNotMutate();
  await testFailedUpdateRollsBack();
  testNoSecretLeakInCliSource();
  testDocsDoNotRecommendRunnerExec();
  console.log("security-owner-password-reset-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
