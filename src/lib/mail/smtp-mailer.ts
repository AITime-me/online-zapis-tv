/**
 * SMTP-реализация Mailer поверх Nodemailer (Node-only).
 *
 * НЕ импортировать этот модуль из edge middleware или auth.config.ts.
 *
 * Безопасность транспорта:
 *   - проверка сертификата НЕ отключается (rejectUnauthorized остаётся true);
 *   - requireTLS: true — незашифрованная отправка запрещена;
 *   - минимальная версия TLS 1.2;
 *   - при подключении к IP из DNS — tls.servername = исходный SMTP_HOST;
 *   - разумные connection/greeting/socket timeouts;
 *   - logger/debug выключены (никакого debug-лога в production/staging).
 */

import nodemailer from "nodemailer";
import { formatFromHeader, type SmtpConfig } from "./mail-config";
import { resolveSmtpConnectHosts, smtpConnectUsesResolvedIp, type ResolveSmtpConnectHostsFn } from "./smtp-host-resolve";
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
  close?(): void;
}

export type CreateTransport = (options: Record<string, unknown>) => TransportLike;

const defaultCreateTransport: CreateTransport = (options) =>
  nodemailer.createTransport(options) as unknown as TransportLike;

/**
 * Опции Nodemailer-транспорта. connectHost — адрес подключения (имя или IP из DNS).
 * Для IP обязателен tls.servername с исходным именем хоста (SNI + проверка сертификата).
 */
export function buildTransportOptions(
  config: SmtpConfig,
  connectHost: string = config.host,
): Record<string, unknown> {
  const useServername = smtpConnectUsesResolvedIp(config.host, connectHost);

  return {
    host: connectHost,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    requireTLS: true,
    tls: {
      minVersion: "TLSv1.2",
      ...(useServername ? { servername: config.host } : {}),
    },
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
  resolveHosts: ResolveSmtpConnectHostsFn = resolveSmtpConnectHosts,
): Mailer {
  const from = formatFromHeader(config);

  return {
    async sendMail(message: MailMessage): Promise<void> {
      let connectHosts: string[];
      try {
        connectHosts = await resolveHosts(config.host, config.ipFamily);
      } catch {
        console.error("[mail] delivery failed");
        throw new MailDeliveryError();
      }

      for (let i = 0; i < connectHosts.length; i += 1) {
        const connectHost = connectHosts[i]!;
        const transport = createTransport(buildTransportOptions(config, connectHost));
        try {
          await transport.sendMail({
            from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          });
          transport.close?.();
          return;
        } catch {
          transport.close?.();
          // Пробуем следующий адрес из DNS, если есть; иначе — безопасная ошибка.
          if (i === connectHosts.length - 1) {
            console.error("[mail] delivery failed");
            throw new MailDeliveryError();
          }
        }
      }
    },
  };
}
