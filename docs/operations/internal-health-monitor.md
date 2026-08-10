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
| `deploy/config/health-monitor-targets.env.example` | Non-secret example for optional n8n HTTPS targets |
| `deploy/systemd/host/online-zapis-tv-internal-health-monitor.service` | oneshot service |
| `deploy/systemd/host/online-zapis-tv-internal-health-monitor.timer` | every 15 minutes |
| `deploy/logrotate/online-zapis-tv-health-monitor` | JSONL rotation |

Installed paths (manual):

| Path | Purpose |
| --- | --- |
| `/usr/local/lib/online-zapis-tv/internal-health-monitor.sh` | Installed script |
| `/usr/local/lib/online-zapis-tv/internal-health-monitor-telegram.py` | Telegram notifier (Python) |
| `/var/lib/online-zapis-tv/health-monitor/` | Lock + `journal.jsonl` + Telegram state + n8n probe streak state |
| `/etc/online-zapis-tv/health-monitor.env` | Telegram credentials (not in Git) |
| `/etc/online-zapis-tv/health-monitor-targets.env` | Optional non-secret n8n HTTPS targets (not required) |
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
9. Isolated restore-test evidence under `/var/lib/online-zapis-tv/restore-test/{production,staging}/`
   (see [isolated-restore-test.md](./isolated-restore-test.md)). Freshness thresholds come from
   `scripts/ops/lib/isolated-restore-test-policy.sh` (same file as restore-test). Until `.enforce`
   exists, the check reports neutral `not_enforced` (INFO) — not healthy readiness and not a
   Telegram alert.
10. Staging/production git short SHAs (informational only; never fail the run).
11. Optional independent **n8n external HTTPS probes** (liveness `/healthz`, readiness `/healthz/readiness`) when `/etc/online-zapis-tv/health-monitor-targets.env` is configured (see §19). Absent config = disabled (INFO), not unhealthy.

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
- Optional n8n targets: `/etc/online-zapis-tv/health-monitor-targets.env` (see §19; no secrets)

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
Optional n8n target URLs are **non-secret** but still live outside runtime hardcoding — copy the example and edit (see §19).

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
sudo rm -f /var/lib/online-zapis-tv/health-monitor/n8n-external-probe-state.json
sudo rm -f /var/lib/online-zapis-tv/health-monitor/run.lock
sudo rmdir /var/lib/online-zapis-tv/health-monitor 2>/dev/null || true
```

Telegram config (optional remove):

```bash
# optional
sudo rm -f /etc/online-zapis-tv/health-monitor.env
sudo rm -f /etc/online-zapis-tv/health-monitor-targets.env
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
| n8n external disabled (INFO) | Expected when targets file absent. No action unless you intended to enable §19. |
| n8n config invalid (`N8N_CONFIG_INVALID`) | Fix `/etc/online-zapis-tv/health-monitor-targets.env` (HTTPS only, no userinfo/query/fragment, required keys). |
| n8n liveness/readiness unhealthy | Check n8n independently (HTTPS `/healthz`, `/healthz/readiness`). IHM only reports; it does not restart n8n. Confirm consecutive-failure threshold was reached (default 2). |

**Important:** `SuccessExitStatus=10 20` means warning/critical do **not** mark the systemd unit as failed. Health is in `journalctl` / JSONL / Telegram — not in `systemctl is-failed`.

External public uptime alerts remain with the existing Timeweb HTTP monitor.
**n8n is not its own only monitor:** Error Handler / workflows inside n8n do not replace this host-side HTTPS probe, and this probe does not replace n8n’s internal Error Handler.

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

## 19. Independent n8n external HTTPS probe (optional)

Purpose: keep an **independent**, host-side health signal for n8n so that n8n is **not** the only watchdog of its own availability. Probes run inside the existing Internal Health Monitor (same timer/service cadence). Alerting remains Telegram/IHM — **no n8n workflow and no MCP dependency**.

Booking production/staging `/api/health` semantics and localhost URLs are **unchanged**.

### Config contract (non-secret)

Example in Git: `deploy/config/health-monitor-targets.env.example`

Installed path (manual): `/etc/online-zapis-tv/health-monitor-targets.env`

| Key | Required | Default | Meaning |
| --- | --- | --- | --- |
| `IHM_N8N_TARGET_ID` | yes (when enabled) | — | Short stable id in evidence/alerts (`[A-Za-z0-9._-]{1,64}`) |
| `IHM_N8N_LIVENESS_URL` | yes (when enabled) | — | Absolute HTTPS URL whose path is **exactly** `/healthz` (no trailing slash, query, or fragment) |
| `IHM_N8N_READINESS_URL` | yes (when enabled) | — | Absolute HTTPS URL whose path is **exactly** `/healthz/readiness` (no trailing slash, query, or fragment) |
| `IHM_N8N_TIMEOUT_SEC` | no | `10` | Bounded connect/request timeout (1..60) |
| `IHM_N8N_FAILURE_THRESHOLD` | no | `2` | Consecutive failures before durable critical |

**Secrets policy:** never put tokens, passwords, or credentials in target URLs. Rejected: non-HTTPS, userinfo (`user:pass@`), query strings, fragments, trailing slashes, and any path other than the canonical `/healthz` or `/healthz/readiness`.

**Trailing slash:** strict. `…/healthz/` and `…/healthz/readiness/` are **invalid** (`N8N_CONFIG_INVALID`). Use the exact canonical paths with no trailing slash.

The same monitor can later represent:

- current TEST/DEV n8n (operator fills the active HTTPS host/paths in the env file)
- future PROD self-hosted `tv_n8n` (operator swaps host/paths only — no shell hardcoding)

### Liveness vs readiness

| Probe | Typical path | Meaning for this monitor |
| --- | --- | --- |
| Liveness | `/healthz` | Process/responding — HTTP 200 required |
| Readiness | `/healthz/readiness` | Ready to accept work — HTTP 200 required |

Evidence logged (safe only): `target`, `probe`, `http`, `errorClass`, `latencyMs`, `streak`. **No response body** in journal, JSONL, probe state, or Telegram.

### Debounce / consecutive-failure threshold

- Default threshold: **2**
- First transient failure below threshold → `INFO` (`debounced`), overall status unchanged, no problem code escalation
- After N consecutive failures for that probe → `critical` with `N8N_LIVENESS_UNHEALTHY` / `N8N_READINESS_UNHEALTHY`
- Successful probe clears that probe’s streak to `0`
- Repeated identical unhealthy states reuse existing Telegram fingerprint/dedupe (no spam every 15 minutes)
- `--only-n8n-external` (harness) acquires the **same** `run.lock` flock as live runs so streak RMW cannot race the timer
- `IHM_N8N_PROBE_MOCK` is honored **only** under `--only-n8n-external`; on the live path it is ignored (`INFO … probe mock ignored`) and real HTTPS probes run

### State file

Atomic bounded JSON (no secrets/bodies). Written with the same durable pattern as Telegram state (temp in the state directory → complete write → `fsync` → atomic replace; previous file kept on failure):

`/var/lib/online-zapis-tv/health-monitor/n8n-external-probe-state.json`

Schema (conceptual):

```json
{
  "schemaVersion": 1,
  "targetId": "n8n-test-dev",
  "liveness": {
    "consecutiveFailures": 0,
    "lastHttpCode": 200,
    "lastErrorClass": "none",
    "lastLatencyMs": 42
  },
  "readiness": {
    "consecutiveFailures": 0,
    "lastHttpCode": 200,
    "lastErrorClass": "none",
    "lastLatencyMs": 55
  },
  "updatedAtUtc": "2026-08-10T00:00:00Z"
}
```

Separate from `telegram-notify-state.json`.

### Backward-compatible disabled state

If the targets file is **absent**, or present but contains **no** `IHM_N8N_*` keys:

- emit `INFO n8n external: disabled (...)`
- do **not** mark IHM unhealthy
- existing booking production/staging checks unchanged

If the file exists and n8n keys are present but malformed/unsafe → deterministic `technical_error` / `N8N_CONFIG_INVALID`.

### Problem codes

| Code | Severity | When |
| --- | --- | --- |
| `N8N_CONFIG_INVALID` | technical_error | Malformed/unsafe/incomplete targets config |
| `N8N_LIVENESS_UNHEALTHY` | critical | Liveness failures ≥ threshold |
| `N8N_READINESS_UNHEALTHY` | critical | Readiness failures ≥ threshold |
| `N8N_STATE_WRITE_FAILED` | technical_error | Probe streak state could not be written |

### Safe rollout

1. Keep timer/service unchanged; deploy updated `internal-health-monitor.sh` (+ telegram py if present).
2. Leave targets file **absent** first → confirm `INFO n8n external: disabled` and booking checks still green.
3. Copy example → `/etc/online-zapis-tv/health-monitor-targets.env` (`root:deploy` `0640`), edit real HTTPS URLs (no secrets).
4. Manual run as `deploy`; confirm liveness/readiness OK lines and state file created.
5. Optionally force a single mocked/transient failure in a maintenance window to confirm debounce, then recovery clears streak.
6. Do not add n8n workflows that “monitor n8n for IHM”; this host probe stays independent.
