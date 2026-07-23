#!/usr/bin/env node
/**
 * Telegram notifier for internal health monitor (Node.js built-ins only).
 *
 * Reads TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID from a KEY=VALUE file (never sourced as shell).
 * Payload JSON arrives on stdin (no secrets in argv). Token is never printed.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { URL, URLSearchParams } from "node:url";

const SCHEMA_VERSION = 1;
const SERVER_NAME = "Твоё время";
const DEFAULT_CONFIG = "/etc/online-zapis-tv/health-monitor.env";
const YK_OFFSET_MS = 5 * 60 * 60 * 1000;

const PROBLEM_LABELS_RU = {
  DOCKER_MISSING: "контейнер не найден",
  DOCKER_NOT_RUNNING: "контейнер не запущен",
  DOCKER_UNHEALTHY: "контейнер в состоянии unhealthy",
  DOCKER_OOM: "контейнер был остановлен из‑за нехватки памяти (OOM)",
  DOCKER_INSPECT_ERROR: "не удалось проверить контейнер",
  HTTP_REQUEST_FAILED: "проверка сайта по локальному адресу не удалась",
  HTTP_STATUS: "локальная проверка сайта вернула ошибку",
  HTTP_PAYLOAD: "локальная проверка сайта показала нездоровое состояние",
  DISK_USAGE_WARNING: "диск заполнен больше обычного",
  DISK_USAGE_CRITICAL: "диск почти заполнен",
  DISK_DF_ERROR: "не удалось проверить место на диске",
  INODE_USAGE_WARNING: "inode заполнены больше обычного",
  INODE_USAGE_CRITICAL: "inode почти заполнены",
  INODE_DF_ERROR: "не удалось проверить inode",
  UNIT_FAILED: "есть неисправные службы systemd",
  SYSTEMD_FAILED_QUERY: "не удалось проверить службы systemd",
  BACKUP_TIMER_MISSING: "таймер резервного копирования отсутствует",
  BACKUP_TIMER_INACTIVE: "таймер резервного копирования не активен",
  BACKUP_TIMER_DISABLED: "таймер резервного копирования выключен",
  BACKUP_TIMER_NO_NEXT: "неизвестен следующий запуск резервного копирования",
  BACKUP_SERVICE_FAILED: "последний запуск резервного копирования завершился ошибкой",
  BACKUP_SERVICE_QUERY: "не удалось проверить службу резервного копирования",
  BACKUP_DIR_MISSING: "каталог резервных копий отсутствует",
  BACKUP_DIR_UNREADABLE: "каталог резервных копий недоступен",
  BACKUP_DUMP_MISSING: "файл резервной копии не найден",
  BACKUP_DUMP_EMPTY: "файл резервной копии пуст",
  BACKUP_DUMP_UNREADABLE: "файл резервной копии нечитаем",
  BACKUP_STALE: "резервная копия устарела",
  BACKUP_AGE_PARSE: "не удалось определить возраст резервной копии",
  BACKUP_DUMP_UNREADABLE_LIST: "резервная копия не проходит проверку чтения",
  PG_VERIFY_IMAGE_MISSING: "локальный образ postgres для проверки копии отсутствует",
  JOURNAL_WRITE_FAILED: "не удалось записать журнал монитора",
};

function eprint(msg) {
  process.stderr.write(`${msg}\n`);
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
    return { token: null, chatId: null, error: "config file missing" };
  }
  let token = null;
  let chatId = null;
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    return { token: null, chatId: null, error: "config file unreadable" };
  }
  for (const lineRaw of raw.split(/\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "TELEGRAM_BOT_TOKEN") {
      token = value;
    } else if (key === "TELEGRAM_CHAT_ID") {
      chatId = value;
    }
  }
  if (!token || !chatId) {
    return { token: null, chatId: null, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing" };
  }
  if (/\s/.test(token) || /\s/.test(chatId)) {
    return { token: null, chatId: null, error: "invalid telegram credentials format" };
  }
  return { token, chatId, error: null };
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    const data = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function atomicWriteJson(statePath, data) {
  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const tmpPath = path.join(
    dir,
    `.telegram-state.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(tmpPath, `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o640 });
  fs.renameSync(tmpPath, statePath);
  try {
    fs.chmodSync(statePath, 0o640);
  } catch {
    // ignore
  }
}

function problemItems(payload) {
  const items = [];
  for (const check of payload.problems || []) {
    if (!check || typeof check !== "object") {
      continue;
    }
    const status = String(check.status || "");
    if (!status || status === "healthy") {
      continue;
    }
    items.push({
      status,
      code: String(check.code || "").trim(),
      id: String(check.id || "").trim(),
      detail: String(check.detail || "").trim(),
    });
  }
  items.sort((a, b) =>
    `${a.code}|${a.id}|${a.detail}|${a.status}`.localeCompare(
      `${b.code}|${b.id}|${b.detail}|${b.status}`,
    ),
  );
  return items;
}

function fingerprint(status, problems) {
  const parts = [status];
  for (const item of problems) {
    parts.push(`${item.code}|${item.id}|${item.status}`);
  }
  return crypto.createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

function formatTimeYekaterinburg() {
  const d = new Date(Date.now() + YK_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}, Екатеринбург`;
}

function humanProblemLine(item) {
  const { code, id: checkId, detail } = item;
  const base = PROBLEM_LABELS_RU[code];
  let line;
  if (base && /backup/i.test(checkId)) {
    const prefix = /staging/i.test(checkId)
      ? "staging: "
      : /production/i.test(checkId)
        ? "production: "
        : "";
    line = `${prefix}${base}`;
  } else if (base && checkId) {
    line =
      checkId.startsWith("docker ") || checkId.startsWith("http ")
        ? `${checkId}: ${base}`
        : base;
  } else if (base) {
    line = base;
  } else if (detail) {
    line = checkId ? `${checkId}: ${detail}` : detail;
  } else {
    line = checkId || code || "неизвестная проблема";
  }

  if (detail.includes("usedPercent=") && /диск/i.test(line)) {
    const pct = detail.split("usedPercent=")[1].split(/\s+/)[0];
    line = `диск заполнен на ${pct}%`;
  }
  if (detail.includes("usedPercent=") && /inode/i.test(line)) {
    const pct = detail.split("usedPercent=")[1].split(/\s+/)[0];
    line = `inode заполнены на ${pct}%`;
  }
  if (detail.includes("ageHours=") && /устар/i.test(line)) {
    const age = detail.split("ageHours=")[1].split(/\s+/)[0];
    if (/staging/i.test(checkId)) {
      line = `резервная копия staging устарела (${age} ч)`;
    } else if (/production/i.test(checkId)) {
      line = `резервная копия production устарела (${age} ч)`;
    } else {
      line = `резервная копия устарела (${age} ч)`;
    }
  }
  return line;
}

function buildAlertText(status, problems) {
  const criticalLike = status === "critical" || status === "technical_error";
  const icon = criticalLike ? "🔴" : "⚠️";
  const statusLabel =
    status === "critical" ? "CRITICAL" : status === "technical_error" ? "TECHNICAL ERROR" : "WARNING";
  const lines = [
    `${icon} Тех-сторож: обнаружена проблема`,
    `Статус: ${statusLabel}`,
    `Сервер: ${SERVER_NAME}`,
    "Проблемы:",
  ];
  for (const item of problems) {
    lines.push(`• ${humanProblemLine(item)}`);
  }
  if (problems.length === 0) {
    lines.push("• состояние монитора требует внимания");
  }
  lines.push(`Время: ${formatTimeYekaterinburg()}`);
  return lines.join("\n");
}

function buildRecoveryText() {
  return [
    "✅ Тех-сторож: работа восстановлена",
    "Все контролируемые проверки снова проходят успешно.",
    `Время: ${formatTimeYekaterinburg()}`,
  ].join("\n");
}

function sendTelegram(token, chatId, text, dryRunDir) {
  if (dryRunDir) {
    fs.mkdirSync(dryRunDir, { recursive: true, mode: 0o750 });
    fs.writeFileSync(path.join(dryRunDir, "last-message.txt"), `${text}\n`, "utf8");
    fs.writeFileSync(
      path.join(dryRunDir, "last-send.json"),
      `${JSON.stringify({ ok: true, dryRun: true, chars: text.length })}\n`,
      "utf8",
    );
    return Promise.resolve();
  }

  const body = new URLSearchParams({
    chat_id: chatId,
    text,
    disable_web_page_preview: "true",
  }).toString();

  const url = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`telegram http error status=${res.statusCode}`));
            return;
          }
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!payload.ok) {
              reject(new Error("telegram api returned not ok"));
              return;
            }
            resolve();
          } catch {
            reject(new Error("telegram invalid response"));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("telegram network error"));
    });
    req.on("error", () => reject(new Error("telegram network error")));
    req.write(body);
    req.end();
  });
}

async function processPayload(payload, token, chatId, statePath, dryRunDir) {
  const status = String(payload.overallStatus || "healthy");
  const problems = problemItems(payload);
  const fp = fingerprint(status, problems);
  const state = readState(statePath);
  const prevFp = String(state.lastFingerprint || "");
  const prevStatus = String(state.lastStatus || "healthy");
  const hadAlert =
    ["warning", "critical", "technical_error"].includes(prevStatus) && Boolean(prevFp);

  if (status === "healthy") {
    if (hadAlert) {
      await sendTelegram(token, chatId, buildRecoveryText(), dryRunDir);
      atomicWriteJson(statePath, {
        schemaVersion: SCHEMA_VERSION,
        lastFingerprint: "",
        lastStatus: "healthy",
        lastNotifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      });
      eprint("INFO telegram: recovery notification sent");
    } else {
      eprint("INFO telegram: healthy, no notification");
    }
    return 0;
  }

  if (!["warning", "critical", "technical_error"].includes(status)) {
    eprint("INFO telegram: unknown status, skipping");
    return 0;
  }

  if (fp === prevFp) {
    eprint("INFO telegram: duplicate fingerprint, skipping");
    return 0;
  }

  await sendTelegram(token, chatId, buildAlertText(status, problems), dryRunDir);
  atomicWriteJson(statePath, {
    schemaVersion: SCHEMA_VERSION,
    lastFingerprint: fp,
    lastStatus: status,
    lastNotifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  eprint("INFO telegram: alert notification sent");
  return 0;
}

async function runTestSend(token, chatId, dryRunDir) {
  const text = [
    "✅ Тех-сторож: тестовое сообщение",
    `Сервер: ${SERVER_NAME}`,
    "Проверка доставки Telegram работает.",
    `Время: ${formatTimeYekaterinburg()}`,
  ].join("\n");
  await sendTelegram(token, chatId, text, dryRunDir);
  eprint("INFO telegram: test message sent");
  return 0;
}

function parseArgs(argv) {
  const out = {
    config: DEFAULT_CONFIG,
    state: "",
    dryRunDir: "",
    testSend: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      out.config = argv[++i] || "";
    } else if (arg === "--state") {
      out.state = argv[++i] || "";
    } else if (arg === "--dry-run-dir") {
      out.dryRunDir = argv[++i] || "";
    } else if (arg === "--test-send") {
      out.testSend = true;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!out.state) {
    throw new Error("--state is required");
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    eprint(`INFO telegram: ${err instanceof Error ? err.message : "invalid args"}`);
    return 0;
  }
  if (args.help) {
    process.stdout.write(
      "Usage: internal-health-monitor-telegram.mjs --config PATH --state PATH [--dry-run-dir DIR] [--test-send]\n",
    );
    return 0;
  }

  const { token, chatId, error } = loadConfig(args.config);
  if (error || !token || !chatId) {
    eprint(`INFO telegram: disabled (${error || "incomplete config"})`);
    return 0;
  }

  const dryRunDir = args.dryRunDir || null;
  try {
    if (args.testSend) {
      return await runTestSend(token, chatId, dryRunDir);
    }
    const raw = fs.readFileSync(0, "utf8");
    if (!raw.trim()) {
      eprint("INFO telegram: empty payload, skipping");
      return 0;
    }
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") {
      eprint("INFO telegram: invalid payload, skipping");
      return 0;
    }
    return await processPayload(payload, token, chatId, args.state, dryRunDir);
  } catch (err) {
    let msg = err instanceof Error ? err.message : "telegram error";
    if (token && msg.includes(token)) {
      msg = "telegram error";
    }
    eprint(`INFO telegram: notify failed (${msg})`);
    return 0;
  }
}

main().then((code) => {
  process.exit(code);
});
