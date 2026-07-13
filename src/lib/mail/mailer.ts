/**
 * Провайдеро-независимая абстракция почтовой доставки.
 *
 * Бизнес-логика (в т.ч. будущее восстановление пароля) зависит только от
 * интерфейса `Mailer` и типа `MailMessage`, но НЕ от Nodemailer или Mail.ru.
 * Конкретные реализации (SMTP, disabled) живут отдельно и подключаются через
 * фабрику `createMailerFromEnv`.
 *
 * Модуль без side effects и без Node-зависимостей — безопасен для импорта где угодно.
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface Mailer {
  sendMail(message: MailMessage): Promise<void>;
}

/**
 * Ошибка конфигурации почты (невалидный/неполный env). Сообщение безопасно —
 * не содержит значения SMTP_PASSWORD или другого секрета.
 */
export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigError";
  }
}

/**
 * Обобщённая безопасная ошибка доставки. Не несёт SMTP-ответ сервера,
 * credentials или содержимое письма.
 */
export class MailDeliveryError extends Error {
  constructor(message = "delivery failed") {
    super(message);
    this.name = "MailDeliveryError";
  }
}
