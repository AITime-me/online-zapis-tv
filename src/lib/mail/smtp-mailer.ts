/**
 * SMTP-реализация Mailer поверх Nodemailer (Node-only).
 *
 * НЕ импортировать этот модуль из edge middleware или auth.config.ts.
 *
 * Безопасность транспорта:
 *   - проверка сертификата НЕ отключается (rejectUnauthorized остаётся true);
 *   - requireTLS: true — незашифрованная отправка запрещена;
 *   - минимальная версия TLS 1.2;
 *   - разумные connection/greeting/socket timeouts;
 *   - logger/debug выключены (никакого debug-лога в production/staging).
 */

import nodemailer from "nodemailer";
import { formatFromHeader, type SmtpConfig } from "./mail-config";
import { type Mailer, type MailMessage, MailDeliveryError } from "./mailer";

type TransportMail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface TransportLike {
  sendMail(mail: TransportMail): Promise<unknown>;
}

export type CreateTransport = (options: Record<string, unknown>) => TransportLike;

const defaultCreateTransport: CreateTransport = (options) =>
  nodemailer.createTransport(options) as unknown as TransportLike;

export function buildTransportOptions(config: SmtpConfig): Record<string, unknown> {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    requireTLS: true,
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
  };
}

export function createSmtpMailer(
  config: SmtpConfig,
  createTransport: CreateTransport = defaultCreateTransport,
): Mailer {
  const transport = createTransport(buildTransportOptions(config));
  const from = formatFromHeader(config);

  return {
    async sendMail(message: MailMessage): Promise<void> {
      try {
        await transport.sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        });
      } catch {
        // Никаких SMTP-ответов, credentials или содержимого письма в логах.
        console.error("[mail] delivery failed");
        throw new MailDeliveryError();
      }
    },
  };
}
