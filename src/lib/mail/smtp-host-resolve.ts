/**
 * Динамическое разрешение SMTP-хоста по IP-семейству (Node-only).
 *
 * Не жёстко прописывает IP провайдера — каждый раз запрашивает A/AAAA через DNS.
 * При подключении к IP вызывающий код обязан передать исходное имя хоста в
 * tls.servername (см. buildTransportOptions в smtp-mailer.ts).
 */

import dns from "node:dns/promises";
import type { SmtpIpFamily } from "./mail-config";

export class SmtpHostResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpHostResolveError";
  }
}

/**
 * Возвращает список адресов для попытки подключения (в порядке DNS).
 * auto — только исходное имя хоста; 4/6 — массив A/AAAA без дубликатов.
 */
export async function resolveSmtpConnectHosts(
  hostname: string,
  ipFamily: SmtpIpFamily,
): Promise<string[]> {
  if (ipFamily === "auto") {
    return [hostname];
  }

  let records: string[];
  try {
    records = ipFamily === "6" ? await dns.resolve6(hostname) : await dns.resolve4(hostname);
  } catch {
    throw new SmtpHostResolveError(
      ipFamily === "6"
        ? "Не удалось получить AAAA-записи SMTP-хоста"
        : "Не удалось получить A-записи SMTP-хоста",
    );
  }

  const unique = [...new Set(records.map((r) => r.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new SmtpHostResolveError(
      ipFamily === "6" ? "SMTP-хост не имеет AAAA-записей" : "SMTP-хост не имеет A-записей",
    );
  }

  return unique;
}

/**
 * true, если connectHost — IP из DNS (не исходное имя хоста); тогда нужен tls.servername.
 */
export function smtpConnectUsesResolvedIp(configHost: string, connectHost: string): boolean {
  return connectHost !== configHost;
}

export type ResolveSmtpConnectHostsFn = typeof resolveSmtpConnectHosts;
