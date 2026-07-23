#!/usr/bin/env python3
"""Telegram notifier for internal health monitor (Python 3 stdlib only)."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

SCHEMA_VERSION = 1
SERVER_NAME = "Твоё время"
DEFAULT_CONFIG = "/etc/online-zapis-tv/health-monitor.env"
YK_OFFSET = timezone(timedelta(hours=5))

PROBLEM_LABELS_RU: dict[str, str] = {
    "DOCKER_MISSING": "контейнер не найден",
    "DOCKER_NOT_RUNNING": "контейнер не запущен",
    "DOCKER_UNHEALTHY": "контейнер в состоянии unhealthy",
    "DOCKER_OOM": "контейнер был остановлен из‑за нехватки памяти (OOM)",
    "DISK_USAGE_WARNING": "диск заполнен больше обычного",
    "DISK_USAGE_CRITICAL": "диск почти заполнен",
    "BACKUP_STALE": "резервная копия устарела",
    "PG_VERIFY_IMAGE_MISSING": "локальный образ postgres для проверки копии отсутствует",
}


def eprint(msg: str) -> None:
    print(msg, file=sys.stderr)


def load_config(path: str) -> tuple[str | None, str | None, str | None]:
    if not os.path.isfile(path):
        return None, None, "config file missing"
    token = None
    chat_id = None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                if key == "TELEGRAM_BOT_TOKEN":
                    token = value
                elif key == "TELEGRAM_CHAT_ID":
                    chat_id = value
    except OSError:
        return None, None, "config file unreadable"
    if not token or not chat_id:
        return None, None, "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing"
    if any(ch.isspace() for ch in token) or any(ch.isspace() for ch in chat_id):
        return None, None, "invalid telegram credentials format"
    return token, chat_id, None


def read_state(path: str) -> dict[str, Any]:
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def atomic_write_json(path: str, data: dict[str, Any]) -> None:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, mode=0o750, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".telegram-state.", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, path)
        try:
            os.chmod(path, 0o640)
        except OSError:
            pass
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def problem_items(payload: dict[str, Any]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for check in payload.get("problems") or []:
        if not isinstance(check, dict):
            continue
        status = str(check.get("status") or "")
        if status in ("", "healthy"):
            continue
        items.append(
            {
                "status": status,
                "code": str(check.get("code") or "").strip(),
                "id": str(check.get("id") or "").strip(),
                "detail": str(check.get("detail") or "").strip(),
            }
        )
    items.sort(key=lambda x: (x["code"], x["id"], x["detail"], x["status"]))
    return items


def fingerprint(status: str, problems: list[dict[str, str]]) -> str:
    parts = [status]
    for item in problems:
        parts.append(f"{item['code']}|{item['id']}|{item['status']}")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def format_time_yekaterinburg() -> str:
    now = datetime.now(YK_OFFSET)
    return now.strftime("%d.%m.%Y %H:%M") + ", Екатеринбург"


def human_problem_line(item: dict[str, str]) -> str:
    code = item["code"]
    check_id = item["id"]
    detail = item["detail"]
    base = PROBLEM_LABELS_RU.get(code)
    if detail and "usedPercent=" in detail and code.startswith("DISK_"):
        pct = detail.split("usedPercent=", 1)[-1].split()[0]
        return f"диск заполнен на {pct}%"
    if detail and "ageHours=" in detail and code == "BACKUP_STALE":
        age = detail.split("ageHours=", 1)[-1].split()[0]
        if "staging" in check_id.lower():
            return f"резервная копия staging устарела ({age} ч)"
        if "production" in check_id.lower():
            return f"резервная копия production устарела ({age} ч)"
        return f"резервная копия устарела ({age} ч)"
    if base and check_id:
        return f"{check_id}: {base}"
    return base or detail or check_id or code or "неизвестная проблема"


def build_alert_text(status: str, problems: list[dict[str, str]]) -> str:
    if status in ("critical", "technical_error"):
        icon = "🔴"
        status_label = "CRITICAL" if status == "critical" else "TECHNICAL ERROR"
    else:
        icon = "⚠️"
        status_label = "WARNING"
    lines = [
        f"{icon} Тех-сторож: обнаружена проблема",
        f"Статус: {status_label}",
        f"Сервер: {SERVER_NAME}",
        "Проблемы:",
    ]
    for item in problems:
        lines.append(f"• {human_problem_line(item)}")
    if not problems:
        lines.append("• состояние монитора требует внимания")
    lines.append(f"Время: {format_time_yekaterinburg()}")
    return "\n".join(lines)


def build_recovery_text() -> str:
    return "\n".join(
        [
            "✅ Тех-сторож: работа восстановлена",
            "Все контролируемые проверки снова проходят успешно.",
            f"Время: {format_time_yekaterinburg()}",
        ]
    )


def send_telegram(token: str, chat_id: str, text: str, dry_run_dir: str | None) -> None:
    if dry_run_dir:
        os.makedirs(dry_run_dir, mode=0o750, exist_ok=True)
        with open(os.path.join(dry_run_dir, "last-message.txt"), "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        return
    api_url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = urllib.parse.urlencode(
        {"chat_id": chat_id, "text": text, "disable_web_page_preview": "true"}
    ).encode("utf-8")
    request = urllib.request.Request(
        api_url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError("telegram api returned not ok")


def process_payload(
    payload: dict[str, Any],
    *,
    token: str,
    chat_id: str,
    state_path: str,
    dry_run_dir: str | None,
) -> int:
    status = str(payload.get("overallStatus") or "healthy")
    problems = problem_items(payload)
    fp = fingerprint(status, problems)
    state = read_state(state_path)
    prev_fp = str(state.get("lastFingerprint") or "")
    prev_status = str(state.get("lastStatus") or "healthy")
    had_alert = prev_status in ("warning", "critical", "technical_error") and bool(prev_fp)

    if status == "healthy":
        if had_alert:
            send_telegram(token, chat_id, build_recovery_text(), dry_run_dir)
            atomic_write_json(
                state_path,
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "lastFingerprint": "",
                    "lastStatus": "healthy",
                    "lastNotifiedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                },
            )
            eprint("INFO telegram: recovery notification sent")
        else:
            eprint("INFO telegram: healthy, no notification")
        return 0

    if status not in ("warning", "critical", "technical_error"):
        eprint("INFO telegram: unknown status, skipping")
        return 0
    if fp == prev_fp:
        eprint("INFO telegram: duplicate fingerprint, skipping")
        return 0

    send_telegram(token, chat_id, build_alert_text(status, problems), dry_run_dir)
    atomic_write_json(
        state_path,
        {
            "schemaVersion": SCHEMA_VERSION,
            "lastFingerprint": fp,
            "lastStatus": status,
            "lastNotifiedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    )
    eprint("INFO telegram: alert notification sent")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--state", required=True)
    parser.add_argument("--dry-run-dir", default="")
    parser.add_argument("--test-send", action="store_true")
    args = parser.parse_args(argv)
    dry_run_dir = args.dry_run_dir or None
    token, chat_id, err = load_config(args.config)
    if err or not token or not chat_id:
        eprint(f"INFO telegram: disabled ({err or 'incomplete config'})")
        return 0
    try:
        if args.test_send:
            send_telegram(
                token,
                chat_id,
                "\n".join(
                    [
                        "✅ Тех-сторож: тестовое сообщение",
                        f"Сервер: {SERVER_NAME}",
                        "Проверка доставки Telegram работает.",
                        f"Время: {format_time_yekaterinburg()}",
                    ]
                ),
                dry_run_dir,
            )
            eprint("INFO telegram: test message sent")
            return 0
        raw = sys.stdin.read()
        if not raw.strip():
            eprint("INFO telegram: empty payload, skipping")
            return 0
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            eprint("INFO telegram: invalid payload, skipping")
            return 0
        return process_payload(
            payload,
            token=token,
            chat_id=chat_id,
            state_path=args.state,
            dry_run_dir=dry_run_dir,
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if token and token in msg:
            msg = "telegram error"
        eprint(f"INFO telegram: notify failed ({msg})")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
