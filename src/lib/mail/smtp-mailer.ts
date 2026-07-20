/**
 * SMTP-реализация Mailer поверх Nodemailer (Node-only).
 *
 * НЕ импортировать этот модуль из edge middleware или auth.config.ts.
 *
 * Безопасность транспорта:
 *   - проверка сертификата НЕ отключается (rejectUnauthorized остаётся true);
 *   - при secure=false (STARTTLS) — requireTLS: true;
 *   - при secure=true (порт 465) — requireTLS не включается (уже implicit TLS);
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
 * Коды ошибок Node.js net/tls и Nodemailer на этапе установки TCP/TLS
 * (до SMTP-команд MAIL/RCPT/DATA). Ретрай по другому IP разрешён только при
 * command === "CONN" и code из этого списка.
 */
export const RETRYABLE_SMTP_CONNECT_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EADDRNOTAVAIL",
  "ESOCKET",
  "ECONNRESET",
]);

/**
 * true только если ошибка произошла до начала SMTP-транзакции (фаза CONN).
 * Любая auth/DATA/SMTP-ответ/неизвестная ошибка → false (без повторной sendMail).
 */
export function isRetryableSmtpConnectError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  if (record.command !== "CONN") {
    return false;
  }

  if (typeof record.code !== "string") {
    return false;
  }
  const code = record.code.trim();
  if (!code || !RETRYABLE_SMTP_CONNECT_ERROR_CODES.has(code)) {
    return false;
  }

  // SMTP 4xx/5xx (даже при ошибочной разметке command) — не ретраим.
  if (typeof record.responseCode === "number" && Number.isFinite(record.responseCode)) {
    return false;
  }

  return true;
}

/**
 * Безопасные поля ошибки SMTP/сокета для диагностики.
 * Запрещены: пароль, токен, тело/тема письма, email получателя, SMTP auth, host.
 */
export function summarizeMailDeliveryError(error: unknown): {
  name?: string;
  code?: string;
  command?: string;
  responseCode?: number;
} {
  if (!error || typeof error !== "object") {
    return {};
  }

  const record = error as Record<string, unknown>;
  const summary: {
    name?: string;
    code?: string;
    command?: string;
    responseCode?: number;
  } = {};

  if (typeof record.name === "string" && record.name.trim()) {
    summary.name = record.name.trim().slice(0, 64);
  }
  if (typeof record.code === "string" && record.code.trim()) {
    summary.code = record.code.trim().slice(0, 64);
  }
  if (typeof record.command === "string" && record.command.trim()) {
    summary.command = record.command.trim().slice(0, 32);
  }
  if (typeof record.responseCode === "number" && Number.isFinite(record.responseCode)) {
    summary.responseCode = record.responseCode;
  }

  return summary;
}

function logMailDeliveryFailure(error?: unknown): void {
  const summary = error === undefined ? {} : summarizeMailDeliveryError(error);
  const parts = [
    summary.name ? `name=${summary.name}` : null,
    summary.code ? `code=${summary.code}` : null,
    summary.command ? `command=${summary.command}` : null,
    summary.responseCode !== undefined ? `responseCode=${summary.responseCode}` : null,
  ].filter(Boolean);

  if (parts.length === 0) {
    console.error("[mail] delivery failed");
    return;
  }

  console.error(`[mail] delivery failed ${parts.join(" ")}`);
}

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
    // requireTLS — только для STARTTLS (secure=false). На 465/implicit TLS не нужен.
    requireTLS: !config.secure,
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
      } catch (error) {
        logMailDeliveryFailure(error);
        throw new MailDeliveryError();
      }

      let lastError: unknown;
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
        } catch (error) {
          lastError = error;
          transport.close?.();
          const hasMoreHosts = i < connectHosts.length - 1;
          if (!hasMoreHosts || !isRetryableSmtpConnectError(error)) {
            logMailDeliveryFailure(lastError);
            throw new MailDeliveryError();
          }
        }
      }
    },
  };
}
