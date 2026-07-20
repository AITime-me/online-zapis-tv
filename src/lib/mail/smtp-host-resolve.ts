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

function uniqueHosts(records: string[]): string[] {
  return [...new Set(records.map((r) => r.trim()).filter(Boolean))];
}

async function resolveFamilyRecords(
  hostname: string,
  family: "4" | "6",
): Promise<string[]> {
  try {
    const records = family === "6" ? await dns.resolve6(hostname) : await dns.resolve4(hostname);
    return uniqueHosts(records);
  } catch {
    return [];
  }
}

/**
 * Возвращает список адресов для попытки подключения.
 *
 * - auto — A (IPv4), затем AAAA (IPv6); при пустом DNS — исходное имя хоста.
 *   Перечисление IP нужно, чтобы smtp-mailer мог безопасно перебрать адреса:
 *   Nodemailer сам выбирает один случайный A-запись без ретрая.
 * - 4/6 — только соответствующее семейство (fail-closed, если записей нет).
 */
export async function resolveSmtpConnectHosts(
  hostname: string,
  ipFamily: SmtpIpFamily,
): Promise<string[]> {
  if (ipFamily === "auto") {
    const v4 = await resolveFamilyRecords(hostname, "4");
    const v6 = await resolveFamilyRecords(hostname, "6");
    const ordered = [...v4, ...v6];
    return ordered.length > 0 ? ordered : [hostname];
  }

  const records = await resolveFamilyRecords(hostname, ipFamily);
  if (records.length === 0) {
    throw new SmtpHostResolveError(
      ipFamily === "6"
        ? "Не удалось получить AAAA-записи SMTP-хоста"
        : "Не удалось получить A-записи SMTP-хоста",
    );
  }

  return records;
}

/**
 * true, если connectHost — IP из DNS (не исходное имя хоста); тогда нужен tls.servername.
 */
export function smtpConnectUsesResolvedIp(configHost: string, connectHost: string): boolean {
  return connectHost !== configHost;
}

export type ResolveSmtpConnectHostsFn = typeof resolveSmtpConnectHosts;
