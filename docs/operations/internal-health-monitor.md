# Internal health monitor v1 (simple)

Host-wide **read-only** technical monitor for staging + production on one Ubuntu server.
It detects problems, prints a short report, writes one JSONL line per run, and exits with a severity code.
It does **not** perform automatic remediation.
Optional Telegram Bot API notifications may be sent after a run (detect + notify only).

Canonical files in git:

| File | Role |
| --- | --- |
| `scripts/ops/internal-health-monitor.sh` | Host script |
| `scripts/ops/internal-health-monitor-telegram.py` | Telegram notifier (Python 3 stdlib only) |
| `deploy/systemd/host/online-zapis-tv-internal-health-monitor.service` | oneshot service |
| `deploy/systemd/host/online-zapis-tv-internal-health-monitor.timer` | every 15 minutes |
| `deploy/logrotate/online-zapis-tv-health-monitor` | JSONL rotation |

Installed paths (manual):

| Path | Purpose |
| --- | --- |
| `/usr/local/lib/online-zapis-tv/internal-health-monitor.sh` | Installed script |
| `/usr/local/lib/online-zapis-tv/internal-health-monitor-telegram.py` | Telegram notifier (Python) |
| `/var/lib/online-zapis-tv/health-monitor/` | Lock + `journal.jsonl` + Telegram state |
| `/etc/online-zapis-tv/health-monitor.env` | Telegram credentials (not in Git) |
| `/etc/systemd/system/online-zapis-tv-internal-health-monitor.service` | Unit |
| `/etc/systemd/system/online-zapis-tv-internal-health-monitor.timer` | Timer |
| `/etc/logrotate.d/online-zapis-tv-health-monitor` | logrotate |

## 1. What it checks

1. Docker containers: `tvoe-vremya-production-app`, `tvoe-vremya-production-postgres`, `tvoe-vremya-staging-app`, `tvoe-vremya-staging-postgres` (exists, running, health if present, OOMKilled).
2. HTTP health: `http://127.0.0.1:3100/api/health` and `http://127.0.0.1:3000/api/health` (timeout 10s, HTTP 200, JSON `ok:true` + `status:"healthy"`; response body is not logged).
3. Disk usage on `/` (covers `/opt/online-zapis-tv`, `/opt/online-zapis-tv-production`, and typical Docker data on this host).
4. Inode usage on `/`.
5. Failed systemd units (`systemctl --failed`), excluding this monitor service itself.
6. Backup timers/services: `online-zapis-tv-production-backup.timer` / `.service` and `online-zapis-tv-staging-backup.timer` / `.service` (loaded, enabled, active, next elapse known, last service not failed).
7. Newest matching PostgreSQL dump in:
   - `/opt/online-zapis-tv-production/backups/production/postgres`
   - `/opt/online-zapis-tv/backups/postgres`
8. Dump readability via one-shot `docker run … pg_restore -l` (no restore, no DB connection, no pull).
9. Staging/production git short SHAs (informational only; never fail the run).

## 2. What it never does

- Restart containers or systemd units
- `docker system prune` / `docker image prune` / `rm -rf`
- Restore databases, run SQL, apply migrations
- Change env, Compose, or git checkouts
- Send email / SMTP (Telegram Bot API is optional; see §18)
- Pull Docker images during a check
- Automatic remediation of any kind

## 3. Server requirements

- Ubuntu host with `deploy` user, Docker, systemd, `curl`, `flock`, `timeout`, `awk`, `grep`, `python3`
- Local image `postgres:17-alpine` already present (monitor will **not** pull it)
- Staging checkout `/opt/online-zapis-tv`, production `/opt/online-zapis-tv-production`
- Existing backup timers already installed
- Optional Telegram: config file `/etc/online-zapis-tv/health-monitor.env` (see §18)

## 4. Copy files manually

From an approved git checkout (example: staging tree at a reviewed SHA):

```bash
sudo mkdir -p /usr/local/lib/online-zapis-tv
sudo cp scripts/ops/internal-health-monitor.sh /usr/local/lib/online-zapis-tv/internal-health-monitor.sh
sudo cp scripts/ops/internal-health-monitor-telegram.py /usr/local/lib/online-zapis-tv/internal-health-monitor-telegram.py
sudo chown root:deploy /usr/local/lib/online-zapis-tv/internal-health-monitor.sh
sudo chown root:deploy /usr/local/lib/online-zapis-tv/internal-health-monitor-telegram.py
sudo chmod 0750 /usr/local/lib/online-zapis-tv/internal-health-monitor.sh
sudo chmod 0750 /usr/local/lib/online-zapis-tv/internal-health-monitor-telegram.py

sudo mkdir -p /var/lib/online-zapis-tv/health-monitor
sudo chown deploy:deploy /var/lib/online-zapis-tv/health-monitor
sudo chmod 0750 /var/lib/online-zapis-tv/health-monitor
sudo -u deploy touch /var/lib/online-zapis-tv/health-monitor/journal.jsonl
sudo chmod 0640 /var/lib/online-zapis-tv/health-monitor/journal.jsonl
sudo chown deploy:deploy /var/lib/online-zapis-tv/health-monitor/journal.jsonl

sudo cp deploy/systemd/host/online-zapis-tv-internal-health-monitor.service /etc/systemd/system/
sudo cp deploy/systemd/host/online-zapis-tv-internal-health-monitor.timer /etc/systemd/system/
sudo cp deploy/logrotate/online-zapis-tv-health-monitor /etc/logrotate.d/online-zapis-tv-health-monitor
```

Telegram credentials are **not** copied from Git. Create them separately (see §18).
## 5. Syntax check

```bash
bash -n /usr/local/lib/online-zapis-tv/internal-health-monitor.sh
bash /usr/local/lib/online-zapis-tv/internal-health-monitor.sh --help
```

Locally from the repo (no host install):

```bash
bash -n scripts/ops/internal-health-monitor.sh
bash scripts/ops/internal-health-monitor.sh --help
python3 -m py_compile scripts/ops/internal-health-monitor-telegram.py
bash scripts/ops/internal-health-monitor.sh --fixture healthy
npm run test:security:internal-health-monitor
npm run test:internal-health-monitor-telegram
```

## 6. Manual dry / fixture / live run

Fixture (no Docker/systemd; safe on a workstation):

```bash
bash scripts/ops/internal-health-monitor.sh --fixture healthy; echo exit:$?
bash scripts/ops/internal-health-monitor.sh --fixture warning; echo exit:$?
bash scripts/ops/internal-health-monitor.sh --fixture critical; echo exit:$?
bash scripts/ops/internal-health-monitor.sh --fixture technical_error; echo exit:$?
```

Manual live run on the server **before** enabling the timer:

```bash
sudo -u deploy /usr/local/lib/online-zapis-tv/internal-health-monitor.sh; echo exit:$?
```

## 7. Install service and timer files

Units are already copied in step 4. Confirm:

```bash
ls -l /etc/systemd/system/online-zapis-tv-internal-health-monitor.service
ls -l /etc/systemd/system/online-zapis-tv-internal-health-monitor.timer
```

## 8. daemon-reload

```bash
sudo systemctl daemon-reload
```

## 9. Enable timer

Only after a successful manual run:

```bash
sudo systemd-analyze calendar '*-*-* *:0/15:00 Asia/Yekaterinburg'
sudo systemd-analyze verify /etc/systemd/system/online-zapis-tv-internal-health-monitor.service
sudo systemd-analyze verify /etc/systemd/system/online-zapis-tv-internal-health-monitor.timer
sudo systemctl enable --now online-zapis-tv-internal-health-monitor.timer
```

## 10. Inspect timer

```bash
systemctl status online-zapis-tv-internal-health-monitor.timer
systemctl list-timers online-zapis-tv-internal-health-monitor.timer
systemctl show online-zapis-tv-internal-health-monitor.timer -p NextElapseUSecRealtime -p ActiveState -p UnitFileState
```

## 11. Start service once

```bash
sudo systemctl start online-zapis-tv-internal-health-monitor.service
systemctl status online-zapis-tv-internal-health-monitor.service
```

## 12. Journal

```bash
journalctl -u online-zapis-tv-internal-health-monitor.service -n 100 --no-pager
tail -n 5 /var/lib/online-zapis-tv/health-monitor/journal.jsonl
```

## 13. Disable timer

```bash
sudo systemctl disable --now online-zapis-tv-internal-health-monitor.timer
```

## 14. Remove units and installed script

```bash
sudo systemctl disable --now online-zapis-tv-internal-health-monitor.timer || true
sudo rm -f /etc/systemd/system/online-zapis-tv-internal-health-monitor.service
sudo rm -f /etc/systemd/system/online-zapis-tv-internal-health-monitor.timer
sudo rm -f /etc/logrotate.d/online-zapis-tv-health-monitor
sudo rm -f /usr/local/lib/online-zapis-tv/internal-health-monitor.sh
sudo rm -f /usr/local/lib/online-zapis-tv/internal-health-monitor-telegram.py
sudo systemctl daemon-reload
```

State directory (optional keep for history):

```bash
# optional — removes JSONL and Telegram notify state
sudo rm -f /var/lib/online-zapis-tv/health-monitor/journal.jsonl
sudo rm -f /var/lib/online-zapis-tv/health-monitor/telegram-notify-state.json
sudo rm -f /var/lib/online-zapis-tv/health-monitor/run.lock
sudo rmdir /var/lib/online-zapis-tv/health-monitor 2>/dev/null || true
```

Telegram config (optional remove):

```bash
# optional
sudo rm -f /etc/online-zapis-tv/health-monitor.env
```
## 15. Confirm removal

```bash
systemctl status online-zapis-tv-internal-health-monitor.timer || true
systemctl status online-zapis-tv-internal-health-monitor.service || true
test ! -f /usr/local/lib/online-zapis-tv/internal-health-monitor.sh && echo script-removed
```

## 16. Interpreting OK / FAIL

Human lines:

- `OK …` — check passed
- `WARN …` — warning threshold (disk/inode)
- `FAIL …` — critical or technical failure
- Footer: `INTERNAL_HEALTH_MONITOR OK` / `WARNING count=N` / `FAILED count=N`
- Concurrent skip: `INTERNAL_HEALTH_MONITOR SKIP concurrent run` (exit 0, no JSONL)

Exit codes (also `SuccessExitStatus=10 20` on the oneshot unit so warning/critical do not mark the unit failed):

| Code | Meaning |
| --- | --- |
| 0 | healthy |
| 10 | warning |
| 20 | critical |
| 30 | technical_error (monitor/host tooling broken) |

Thresholds (from simple v1 plan):

| Check | Warning | Critical |
| --- | --- | --- |
| Disk `/` | ≥ 75% | ≥ 90% |
| Inodes `/` | ≥ 80% | ≥ 95% |
| Backup age | — | > 30 hours |

Timer schedule (from simple v1 plan): `*-*-* *:0/15:00 Asia/Yekaterinburg`, `Persistent=true`, `RandomizedDelaySec=120`.

## 17. What a human should do on failures

| Category | Action |
| --- | --- |
| Docker missing / not running / unhealthy / OOM | Inspect container with `docker ps -a` / `docker inspect` (no auto-restart from this monitor). Follow normal ops runbooks. |
| HTTP health fail | Check app container and `/api/health` manually; review recent deploy. |
| Disk / inode warn or critical | Free space manually; do **not** run prune from this document’s monitor commands. |
| Failed systemd units | `systemctl --failed` then investigate that unit’s own docs/logs. |
| Backup timer inactive/disabled/no next | Re-check backup timer install docs (`production-backup.md` / `staging-backup.md`). Do not start backup from the monitor. |
| Backup stale / missing / unreadable | Investigate backup timer/service; verify dumps under the backup directories. |
| `postgres:17-alpine` missing | Load/pull the image in a controlled maintenance window (monitor itself never pulls). |
| technical_error on queries | Check permissions for `deploy`, Docker socket group, python3/curl availability. |
| Telegram disabled / failed | Monitor checks still stand. Fix `/etc/online-zapis-tv/health-monitor.env` permissions or bot token; re-run `--test-send`. |

**Important:** `SuccessExitStatus=10 20` means warning/critical do **not** mark the systemd unit as failed. Health is in `journalctl` / JSONL / Telegram — not in `systemctl is-failed`.

External public uptime alerts remain with the existing Timeweb HTTP monitor.

## 18. Telegram notifications (optional)

Minimal Bot API alerts for first problem, changed problem set, and recovery. No SMTP. Secrets never enter Git.

### Config file (outside Git)

```bash
sudo mkdir -p /etc/online-zapis-tv
sudo chown root:deploy /etc/online-zapis-tv
sudo chmod 0750 /etc/online-zapis-tv

sudo install -o root -g deploy -m 0640 /dev/null /etc/online-zapis-tv/health-monitor.env
sudo -u deploy nano /etc/online-zapis-tv/health-monitor.env
```

File contents (exact keys only):

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
```

Do **not** `source` this file in shell. The notifier parses only these two keys.

Permissions:

| Path | Owner | Mode |
| --- | --- | --- |
| `/etc/online-zapis-tv` | `root:deploy` | `0750` |
| `/etc/online-zapis-tv/health-monitor.env` | `root:deploy` | `0640` |

### Behaviour

- First transition to warning → one Telegram message
- Transition to critical / technical_error or changed problem set → new message
- Identical fingerprint every 15 minutes → no message
- Return to healthy after a prior alert → one recovery message, then state reset
- Missing/invalid config → monitor continues; stderr: `INFO telegram: disabled (...)`
- Telegram API failure → monitor exit code unchanged

State file (atomic replace): `/var/lib/online-zapis-tv/health-monitor/telegram-notify-state.json`

### Test send (token must not appear in output)

```bash
sudo -u deploy python3 /usr/local/lib/online-zapis-tv/internal-health-monitor-telegram.py \
  --config /etc/online-zapis-tv/health-monitor.env \
  --state /var/lib/online-zapis-tv/health-monitor/telegram-notify-state.json \
  --test-send
```

Expected stderr (no token): `INFO telegram: test message sent`

### Local regression

```bash
npm run test:internal-health-monitor-telegram
npm run test:security:internal-health-monitor
```
