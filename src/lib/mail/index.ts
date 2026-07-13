/**
 * Фабрика Mailer из env (Node-only — импортирует SMTP-транспорт).
 *
 * НЕ импортировать из edge middleware или auth.config.ts.
 */

import { type MailEnvInput, validateMailConfig } from "./mail-config";
import { type Mailer, MailConfigError, MailDeliveryError } from "./mailer";
import { type CreateTransport, createSmtpMailer } from "./smtp-mailer";

export { type Mailer, type MailMessage, MailConfigError, MailDeliveryError } from "./mailer";
export { validateMailConfig, type MailConfig } from "./mail-config";

/**
 * Заглушка, когда почта выключена (MAIL_PROVIDER=disabled/пусто). Приложение
 * запускается без SMTP; попытка отправки — безопасная типизированная ошибка.
 */
class DisabledMailer implements Mailer {
  async sendMail(): Promise<void> {
    throw new MailDeliveryError("mail provider disabled");
  }
}

function readMailEnv(source: NodeJS.ProcessEnv): MailEnvInput {
  return {
    MAIL_PROVIDER: source.MAIL_PROVIDER,
    MAIL_FROM_NAME: source.MAIL_FROM_NAME,
    MAIL_FROM_ADDRESS: source.MAIL_FROM_ADDRESS,
    SMTP_HOST: source.SMTP_HOST,
    SMTP_PORT: source.SMTP_PORT,
    SMTP_SECURE: source.SMTP_SECURE,
    SMTP_USER: source.SMTP_USER,
    SMTP_PASSWORD: source.SMTP_PASSWORD,
    SMTP_IP_FAMILY: source.SMTP_IP_FAMILY,
  };
}

/**
 * Создаёт Mailer по env. Fail-closed: при MAIL_PROVIDER=smtp и невалидной
 * конфигурации бросает MailConfigError (без секретов). Сетевые подключения
 * не выполняются до фактической отправки.
 */
export function createMailerFromEnv(
  source: NodeJS.ProcessEnv = process.env,
  createTransport?: CreateTransport,
): Mailer {
  const result = validateMailConfig(readMailEnv(source));
  if (!result.ok) {
    throw new MailConfigError(result.message);
  }

  if (result.config.provider === "disabled") {
    return new DisabledMailer();
  }

  return createSmtpMailer(result.config, createTransport);
}
