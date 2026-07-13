import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  formatFromHeader,
  isEmailAddress,
  parseStrictBoolean,
  type SmtpConfig,
  validateMailConfig,
} from "../src/lib/mail/mail-config";
import { createMailerFromEnv, MailConfigError } from "../src/lib/mail/index";
import { MailDeliveryError } from "../src/lib/mail/mailer";
import {
  buildTransportOptions,
  createSmtpMailer,
  type CreateTransport,
  type TransportLike,
} from "../src/lib/mail/smtp-mailer";

const VALID_SMTP_ENV = {
  MAIL_PROVIDER: "smtp",
  MAIL_FROM_NAME: "Твоё время",
  MAIL_FROM_ADDRESS: "ipku82@bk.ru",
  SMTP_HOST: "smtp.mail.ru",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "ipku82@bk.ru",
  SMTP_PASSWORD: "app-specific-secret",
};

const SECRET_PASSWORD = "top-secret-app-password";

function smtpConfig(overrides: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    provider: "smtp",
    fromName: "Твоё время",
    fromAddress: "ipku82@bk.ru",
    host: "smtp.mail.ru",
    port: 465,
    secure: true,
    user: "ipku82@bk.ru",
    password: SECRET_PASSWORD,
    ...overrides,
  };
}

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function testDisabledProviderCreatesNoTransport(): void {
  let created = 0;
  const spy: CreateTransport = () => {
    created += 1;
    return { async sendMail() {} };
  };

  createMailerFromEnv({ MAIL_PROVIDER: "disabled" } as NodeJS.ProcessEnv, spy);
  assert.equal(created, 0, "disabled не должен создавать SMTP transport");

  // Пустой MAIL_PROVIDER тоже => disabled.
  createMailerFromEnv({} as NodeJS.ProcessEnv, spy);
  assert.equal(created, 0, "пустой MAIL_PROVIDER не должен создавать transport");
}

async function testDisabledMailerThrowsSafeError(): Promise<void> {
  const mailer = createMailerFromEnv({ MAIL_PROVIDER: "disabled" } as NodeJS.ProcessEnv);
  await assert.rejects(
    mailer.sendMail({ to: "x@y.ru", subject: "s", text: "t" }),
    MailDeliveryError,
    "disabled mailer должен бросать безопасную MailDeliveryError",
  );
}

function testSmtpWithoutPasswordRejected(): void {
  const result = validateMailConfig({ ...VALID_SMTP_ENV, SMTP_PASSWORD: "" });
  assert.equal(result.ok, false, "smtp без пароля должен быть отклонён");
  if (!result.ok) {
    assert.doesNotMatch(result.message, /app-specific|secret/i, "сообщение не должно содержать пароль");
  }

  assert.throws(
    () => createMailerFromEnv({ ...VALID_SMTP_ENV, SMTP_PASSWORD: "" } as NodeJS.ProcessEnv),
    MailConfigError,
    "createMailerFromEnv должен fail-closed без пароля",
  );
}

function testPort465RequiresSecure(): void {
  const result = validateMailConfig({ ...VALID_SMTP_ENV, SMTP_SECURE: "false" });
  assert.equal(result.ok, false, "порт 465 с SMTP_SECURE=false должен быть отклонён");
}

function testSecureMustBeStrictBoolean(): void {
  assert.equal(parseStrictBoolean("true"), true);
  assert.equal(parseStrictBoolean("false"), false);
  assert.equal(parseStrictBoolean("1"), null);
  assert.equal(parseStrictBoolean("yes"), null);
  assert.equal(parseStrictBoolean(undefined), null);

  const result = validateMailConfig({ ...VALID_SMTP_ENV, SMTP_SECURE: "1" });
  assert.equal(result.ok, false, "нестрогое SMTP_SECURE должно быть отклонено");
}

function testInvalidPortRejected(): void {
  assert.equal(validateMailConfig({ ...VALID_SMTP_ENV, SMTP_PORT: "0" }).ok, false);
  assert.equal(validateMailConfig({ ...VALID_SMTP_ENV, SMTP_PORT: "70000" }).ok, false);
  assert.equal(validateMailConfig({ ...VALID_SMTP_ENV, SMTP_PORT: "abc" }).ok, false);
}

function testInvalidFromAddressRejected(): void {
  const result = validateMailConfig({ ...VALID_SMTP_ENV, MAIL_FROM_ADDRESS: "not-an-email" });
  assert.equal(result.ok, false, "некорректный email отправителя должен быть отклонён");
}

function testValidConfigCreatesTlsTransport(): void {
  const result = validateMailConfig(VALID_SMTP_ENV);
  assert.equal(result.ok, true, "корректная конфигурация должна проходить");

  let captured: Record<string, unknown> | null = null;
  const spy: CreateTransport = (options) => {
    captured = options;
    return { async sendMail() {} };
  };

  createMailerFromEnv(VALID_SMTP_ENV as NodeJS.ProcessEnv, spy);
  assert.ok(captured, "transport должен быть создан для валидной smtp-конфигурации");

  const opts = captured as unknown as Record<string, unknown>;
  assert.equal(opts.secure, true, "465 => secure:true (implicit TLS)");
  assert.equal(opts.requireTLS, true, "requireTLS должен быть включён");
  assert.equal(opts.logger, false, "logger должен быть выключен");
  assert.equal(opts.debug, false, "debug должен быть выключен");
  assert.ok(
    typeof opts.connectionTimeout === "number" &&
      typeof opts.greetingTimeout === "number" &&
      typeof opts.socketTimeout === "number",
    "должны быть заданы connection/greeting/socket timeouts",
  );
}

function testCertificateVerificationNotDisabled(): void {
  const opts = buildTransportOptions(smtpConfig());
  const optsJson = JSON.stringify(opts);

  assert.doesNotMatch(optsJson, /rejectUnauthorized/, "rejectUnauthorized не должен переопределяться");
  assert.doesNotMatch(optsJson, /ignoreTLS/, "ignoreTLS не должен использоваться");
  const tls = opts.tls as Record<string, unknown> | undefined;
  assert.ok(tls && tls.minVersion === "TLSv1.2", "минимальная версия TLS 1.2");
  assert.equal(opts.requireTLS, true);
}

async function testSuccessfulSendCallsMailerOnce(): Promise<void> {
  let calls = 0;
  const transport: TransportLike = {
    async sendMail() {
      calls += 1;
      return { messageId: "ok" };
    },
  };
  const spy: CreateTransport = () => transport;

  const mailer = createSmtpMailer(smtpConfig(), spy);
  await mailer.sendMail({ to: "user@example.com", subject: "Test", text: "hello" });
  assert.equal(calls, 1, "успешная отправка должна вызвать transport.sendMail ровно один раз");
}

async function testTransportErrorLeaksNothing(): Promise<void> {
  const messageSubject = "Секретная тема";
  const messageText = "тело письма с чувствительным содержимым";
  const transport: TransportLike = {
    async sendMail() {
      throw new Error(`SMTP 535 auth failed for ${SECRET_PASSWORD} at smtp.mail.ru`);
    },
  };
  const spy: CreateTransport = () => transport;

  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };

  try {
    const mailer = createSmtpMailer(smtpConfig(), spy);
    await assert.rejects(
      mailer.sendMail({ to: "user@example.com", subject: messageSubject, text: messageText }),
      MailDeliveryError,
      "ошибка транспорта должна давать безопасную MailDeliveryError",
    );
  } finally {
    console.error = originalError;
  }

  const joined = logged.join("\n");
  assert.match(joined, /\[mail\] delivery failed/, "должен быть обобщённый лог");
  assert.doesNotMatch(joined, new RegExp(SECRET_PASSWORD), "лог не должен содержать пароль");
  assert.doesNotMatch(joined, /smtp\.mail\.ru/, "лог не должен содержать SMTP-хост/конфигурацию");
  assert.doesNotMatch(joined, /535|auth failed/, "лог не должен содержать ответ SMTP-сервера");
  assert.doesNotMatch(joined, new RegExp(messageSubject), "лог не должен содержать тему письма");
  assert.doesNotMatch(joined, new RegExp(messageText), "лог не должен содержать тело письма");
}

function testFromHeader(): void {
  assert.equal(formatFromHeader({ fromName: "Твоё время", fromAddress: "a@b.ru" }), '"Твоё время" <a@b.ru>');
  assert.equal(formatFromHeader({ fromName: "", fromAddress: "a@b.ru" }), "a@b.ru");
}

function testEmailValidation(): void {
  assert.equal(isEmailAddress("user@example.com"), true);
  assert.equal(isEmailAddress("not-an-email"), false);
  assert.equal(isEmailAddress(""), false);
  assert.equal(isEmailAddress("a@b"), false);
}

function testCliSource(): void {
  const cli = readSource("scripts/send-test-mail.ts");

  // Некорректный email отклоняется.
  assert.match(cli, /isEmailAddress\(to\)/, "CLI должен валидировать email получателя");
  // Секретные флаги отклоняются, в т.ч. --password.
  assert.match(cli, /"--password"/, "CLI должен отклонять --password");
  assert.match(cli, /forbidden/, "CLI должен иметь список запрещённых секретных флагов");
  // Тот же Mailer, что у приложения.
  assert.match(cli, /createMailerFromEnv\(\)/, "CLI должен использовать общий createMailerFromEnv");
  // Ровно один вызов отправки нейтрального письма.
  assert.equal(
    (cli.match(/mailer\.sendMail\(/g) ?? []).length,
    1,
    "CLI должен вызывать mailer.sendMail один раз",
  );
  // Не выводит конфигурацию/секреты.
  const consoleCalls = cli.match(/console\.(log|error|warn|info)\([^;]*?\)\s*;/g) ?? [];
  for (const call of consoleCalls) {
    assert.doesNotMatch(
      call,
      /SMTP_PASSWORD|password|process\.env|SMTP_HOST|createMailerFromEnv/i,
      `CLI не должен выводить конфигурацию/секреты: ${call}`,
    );
  }
  // Нейтральное письмо без ссылок восстановления.
  assert.doesNotMatch(cli, /reset|token|восстановлен|forgot|https?:\/\//i, "тестовое письмо не должно содержать ссылок восстановления/токенов");
}

function testEdgeFilesDoNotImportSmtp(): void {
  const edgeFiles = ["src/middleware.ts", "src/middleware-auth.ts", "src/auth.config.ts"];
  for (const file of edgeFiles) {
    const source = readSource(file);
    for (const forbidden of ["nodemailer", "@/lib/mail/smtp-mailer", '@/lib/mail"', "@/lib/mail/index"]) {
      assert.ok(
        !source.includes(forbidden),
        `edge-файл ${file} не должен импортировать "${forbidden}"`,
      );
    }
  }

  // env.ts может использовать только чистую валидацию (mail-config), не Node-транспорт.
  const envSource = readSource("src/lib/env.ts");
  assert.ok(!envSource.includes("smtp-mailer"), "env.ts не должен импортировать smtp-mailer");
  assert.ok(!envSource.includes("nodemailer"), "env.ts не должен импортировать nodemailer");
  assert.match(envSource, /mail-config/, "env.ts должен использовать чистую валидацию mail-config");
}

/**
 * CLI и Mailer должны зависеть только от mail-конфигурации, не от общего env.ts
 * (иначе mail:test начал бы требовать DATABASE_URL/AUTH_SECRET и т.п.).
 */
function testMailChainDoesNotRequireAppEnv(): void {
  const chain = [
    "scripts/send-test-mail.ts",
    "src/lib/mail/index.ts",
    "src/lib/mail/mail-config.ts",
    "src/lib/mail/smtp-mailer.ts",
    "src/lib/mail/mailer.ts",
  ];
  for (const file of chain) {
    const source = readSource(file);
    for (const forbidden of ["@/lib/env", "lib/env", "DATABASE_URL", "AUTH_SECRET", "SCHEDULE_VIEW_TOKEN"]) {
      assert.ok(
        !source.includes(forbidden),
        `${file} не должен зависеть от "${forbidden}" (только mail-конфигурация)`,
      );
    }
  }
}

const ALLOWED_MAIL_VARS = [
  "MAIL_PROVIDER",
  "MAIL_FROM_NAME",
  "MAIL_FROM_ADDRESS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
];

/**
 * Эксплуатационная безопасность сценария mail:test в документации.
 */
function testMailTestDocsSecurity(): void {
  const docs = readSource("docs/STAGING_PRODUCTION.md");

  // Изолируем секцию «Служебная почта (SMTP)» до следующего заголовка ##.
  const sectionMatch = docs.match(/## Служебная почта \(SMTP\)[\s\S]*?(?=\n## )/);
  assert.ok(sectionMatch, "в docs должна быть секция «Служебная почта (SMTP)»");
  const section = sectionMatch[0];

  // Запрет небезопасных приёмов.
  assert.doesNotMatch(section, /\bset -a\b/, "SMTP-инструкция не должна использовать set -a");
  assert.doesNotMatch(section, /\bset -x\b/, "SMTP-инструкция не должна использовать set -x");
  assert.doesNotMatch(
    section,
    /--env\s+SMTP_PASSWORD=|-e\s+SMTP_PASSWORD=/,
    "SMTP_PASSWORD не должен передаваться со значением в аргументах",
  );
  assert.doesNotMatch(section, /SMTP_PASSWORD=[A-Za-z0-9]/, "значение SMTP_PASSWORD не должно появляться в docs");

  // Требуемые свойства subshell-сценария.
  assert.match(section, /\(\s*\n\s*set -euo pipefail/, "сценарий должен быть изолированным subshell с set -euo pipefail");
  assert.match(
    section,
    /MAIL_VARS="MAIL_PROVIDER MAIL_FROM_NAME MAIL_FROM_ADDRESS SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD"/,
    "должен использоваться разрешённый список mail-переменных",
  );
  assert.match(section, /trap\s+cleanup_mail_env\s+EXIT/, "очистка переменных должна гарантироваться через trap ... EXIT");
  assert.match(section, /for name in \$MAIL_VARS[\s\S]*?unset "\$name"/, "cleanup должен снимать все mail-переменные");
  assert.match(
    section,
    /docker inspect --format '\{\{range \.Config\.Env\}\}[\s\S]*?tvoe-vremya-staging-app/,
    "mail-переменные должны извлекаться из контейнера tvoe-vremya-staging-app через docker inspect",
  );
  assert.match(section, /test -n "\$value"/, "каждая обязательная переменная должна проверяться test -n");
  assert.match(section, /online-zapis-tv-ops:local/, "запуск через ops-образ online-zapis-tv-ops:local");

  // Не хранить весь вывод docker inspect в переменной — извлекать по одному имени.
  assert.match(
    section,
    /sed -n "s\/\^\$\{name\}=\/\/p"/,
    "должно извлекаться конкретное имя (потоково), а не весь env контейнера",
  );

  // Блок `docker run ... mail:test` — только имена разрешённых переменных, без секретов и env-file.
  const runMatch = section.match(/docker run --rm[\s\S]*?npm run mail:test[^\n]*/);
  assert.ok(runMatch, "в секции должен быть docker run ... mail:test");
  const runBlock = runMatch[0];

  assert.doesNotMatch(runBlock, /--env-file/, "mail:test не должен запускаться с --env-file (утечка всего .env.staging)");
  for (const forbidden of ["AUTH_SECRET", "DATABASE_URL", "SCHEDULE_VIEW_TOKEN"]) {
    assert.ok(!runBlock.includes(forbidden), `mail:test-контейнер не должен получать ${forbidden}`);
  }
  for (const name of ALLOWED_MAIL_VARS) {
    assert.match(runBlock, new RegExp(`--env ${name}(?![=\\w])`), `должно передаваться --env ${name} (только имя)`);
  }
  assert.doesNotMatch(runBlock, /--env \w+=|-e \w+=/, "в docker run передаются только имена переменных, без значений");
  assert.match(runBlock, /online-zapis-tv-ops:local/, "mail:test через ops-образ");

  // Нейтральное письмо: docs фиксируют отсутствие токенов и ссылок восстановления.
  assert.match(section, /без токенов и ссылок восстановления/, "docs должны фиксировать нейтральность письма");
}

function testDocsAndExampleNoRealSecrets(): void {
  const example = readSource(".env.production.example");
  // Плейсхолдер пароля пуст.
  assert.match(example, /^SMTP_PASSWORD=\s*$/m, "SMTP_PASSWORD в example должен быть пустым placeholder");
  assert.match(example, /^SMTP_HOST=smtp\.mail\.ru$/m);
  assert.match(example, /^SMTP_PORT=465$/m);
  assert.match(example, /^SMTP_SECURE=true$/m);

  const docs = readSource("docs/STAGING_PRODUCTION.md");
  assert.match(docs, /отдельный пароль внешнего приложения/i, "docs должны описывать отдельный пароль приложения");
  assert.match(docs, /online-zapis-tv-ops:local/, "docs: тестовая отправка через ops-образ");
  // В docs/example не должно быть заполненного SMTP_PASSWORD=<значение>.
  assert.doesNotMatch(docs, /SMTP_PASSWORD=[A-Za-z0-9]/, "docs не должны содержать заполненный SMTP_PASSWORD");
  assert.doesNotMatch(example, /SMTP_PASSWORD=[A-Za-z0-9]/, "example не должен содержать заполненный SMTP_PASSWORD");
}

async function main(): Promise<void> {
  testDisabledProviderCreatesNoTransport();
  await testDisabledMailerThrowsSafeError();
  testSmtpWithoutPasswordRejected();
  testPort465RequiresSecure();
  testSecureMustBeStrictBoolean();
  testInvalidPortRejected();
  testInvalidFromAddressRejected();
  testValidConfigCreatesTlsTransport();
  testCertificateVerificationNotDisabled();
  await testSuccessfulSendCallsMailerOnce();
  await testTransportErrorLeaksNothing();
  testFromHeader();
  testEmailValidation();
  testCliSource();
  testEdgeFilesDoNotImportSmtp();
  testMailChainDoesNotRequireAppEnv();
  testMailTestDocsSecurity();
  testDocsAndExampleNoRealSecrets();
  console.log("security-mail-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
