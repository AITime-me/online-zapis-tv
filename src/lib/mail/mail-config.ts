/**
 * Чистая (edge-safe) валидация почтовой конфигурации из env.
 *
 * НЕ импортирует Nodemailer и Node-специфичный код — можно безопасно
 * использовать из env-валидации. Значение SMTP_PASSWORD никогда не попадает
 * в текст ошибок.
 */

export type MailProvider = "disabled" | "smtp";

export type SmtpConfig = {
  provider: "smtp";
  fromName: string;
  fromAddress: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export type MailConfig = { provider: "disabled" } | SmtpConfig;

export type MailConfigResult = { ok: true; config: MailConfig } | { ok: false; message: string };

export type MailEnvInput = {
  MAIL_PROVIDER?: string;
  MAIL_FROM_NAME?: string;
  MAIL_FROM_ADDRESS?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/**
 * Строгий boolean: только "true"/"false" (без учёта регистра и пробелов).
 * Иначе null — чтобы отличить явное значение от опечатки/пустоты.
 */
export function parseStrictBoolean(value: string | undefined): boolean | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

/**
 * Заголовок From: "Имя" <address> либо просто address.
 */
export function formatFromHeader(config: Pick<SmtpConfig, "fromName" | "fromAddress">): string {
  const name = config.fromName.trim();
  return name ? `"${name}" <${config.fromAddress}>` : config.fromAddress;
}

/**
 * Валидирует mail-env. При MAIL_PROVIDER=disabled/пусто — провайдер отключён
 * (SMTP-переменные не обязательны). При MAIL_PROVIDER=smtp — fail-closed
 * проверка обязательных полей, email, порта, boolean-secure и связки 465↔TLS.
 */
export function validateMailConfig(input: MailEnvInput): MailConfigResult {
  const provider = (input.MAIL_PROVIDER ?? "").trim().toLowerCase();

  if (provider === "" || provider === "disabled") {
    return { ok: true, config: { provider: "disabled" } };
  }

  if (provider !== "smtp") {
    return {
      ok: false,
      message: 'MAIL_PROVIDER должен быть "smtp" или "disabled"',
    };
  }

  const fromName = (input.MAIL_FROM_NAME ?? "").trim();
  const fromAddress = (input.MAIL_FROM_ADDRESS ?? "").trim();
  const host = (input.SMTP_HOST ?? "").trim();
  const user = (input.SMTP_USER ?? "").trim();
  // Пароль не тримим внутри (может содержать значимые пробелы), но пустоту
  // проверяем по trimmed. Значение НИКОГДА не логируется/не возвращается.
  const password = input.SMTP_PASSWORD ?? "";
  const portRaw = (input.SMTP_PORT ?? "").trim();
  const secureRaw = input.SMTP_SECURE;

  if (!fromAddress) {
    return { ok: false, message: "MAIL_FROM_ADDRESS обязателен при MAIL_PROVIDER=smtp" };
  }
  if (!isEmailAddress(fromAddress)) {
    return { ok: false, message: "MAIL_FROM_ADDRESS должен быть корректным email" };
  }
  if (!host) {
    return { ok: false, message: "SMTP_HOST обязателен при MAIL_PROVIDER=smtp" };
  }
  if (!user) {
    return { ok: false, message: "SMTP_USER обязателен при MAIL_PROVIDER=smtp" };
  }
  if (!password.trim()) {
    return { ok: false, message: "SMTP_PASSWORD обязателен при MAIL_PROVIDER=smtp" };
  }

  if (!/^\d+$/.test(portRaw)) {
    return { ok: false, message: "SMTP_PORT должен быть числом" };
  }
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: "SMTP_PORT должен быть в диапазоне 1..65535" };
  }

  const secure = parseStrictBoolean(secureRaw);
  if (secure === null) {
    return { ok: false, message: "SMTP_SECURE должен быть строго true или false" };
  }

  if (port === 465 && !secure) {
    return { ok: false, message: "Для порта 465 требуется SMTP_SECURE=true" };
  }

  return {
    ok: true,
    config: { provider: "smtp", fromName, fromAddress, host, port, secure, user, password },
  };
}
