# Isolated PostgreSQL restore-test

Автоматическая проверка **полноценного** восстановления существующего PostgreSQL dump
во **временной изолированной** среде (не `pg_restore -l` и не operational restore).

**Статус server verification:** `NOT VERIFIED` (код в репозитории ≠ проверка на сервере).
**AUDIT-OPS-02:** остаётся `PARTIAL`. Критерий №18 (секреты в логах backup unit): `PASS`.

## Канонические файлы

| Файл | Роль |
| --- | --- |
| `scripts/ops/isolated-restore-test.sh` | Oneshot-тест + `--emergency-cleanup` + `--reap-orphans` |
| `scripts/ops/lib/isolated-restore-test-common.sh` | Path validation, labels, evidence helpers |
| `scripts/ops/lib/isolated-restore-test-policy.sh` | **Единый runtime SoT** freshness/TTL thresholds |
| `scripts/ops/install-isolated-restore-test.sh` | Install / uninstall units / enforce marker |
| `scripts/ops/lib/fake-docker-irt.sh` | Fake Docker для локального harness (не для production) |
| `scripts/ops/tests/isolated-restore-test-harness.sh` | Исполняемые failure-path сценарии |
| `scripts/ops/tests/ihm-restore-test-evidence-harness.sh` | IHM linkage / `not_enforced` |
| `deploy/systemd/host/online-zapis-tv-*-restore-test.{service,timer}` | Weekly timers |
| `scripts/security-isolated-restore-test-check.ts` | Static + запуск harness |

## Evidence layout

```text
/var/lib/online-zapis-tv/restore-test/
  .enforce                 # опционально: жёсткий IHM-контроль
  run.lock
  production/
    last-attempt.env
    last-success.env       # не затирается неудачной попыткой
    last-pg-restore-error.log  # активный diagnostic; удаляется при success
    history/               # unique names: timestamp+PID+run-id
                           # + pg_restore_<RUN_ID>.error.log (0600, bounded)
    runtime/               # 0700: cidfile, current.env, private dump snapshot
  staging/
    ...
```

Permissions: evidence dirs `0750`, runtime `0700`, evidence files `0600`, владелец `deploy:deploy`.

## Lifecycle (единый EXIT-финализатор)

1. До создания временных ресурсов: `trap finalize_once EXIT`, `trap on_err ERR`, `trap on_signal INT TERM`.
2. `ERR` / `INT` / `TERM` **не** пишут evidence сами: только фиксируют код/причину.
   - Родительский `SIGINT`/`SIGTERM` → sticky `IRT_SIGNAL_RECEIVED=1`, `ERROR_CODE=INTERRUPTED`, итоговый **rc=50** (всегда).
   - Поздний signal после `IRT_WORK_OK=1` **не** может быть перезаписан success/`rc=0` в finalizer.
   - Signal должен приходить на **MainPID** самого `isolated-restore-test.sh` (как systemd
     `KillMode` на unit). SIGTERM обёртке/`bash -c` без traps даёт raw **143**, orphan’ит
     скрипт и пропускает finalizer/cleanup/evidence. Behavioral harness стартует фон через
     `exec`, чтобы `$!` совпадал с процессом, у которого установлены traps.
3. Interruptible-фазы (фон + `wait`, не foreground): иначе trapped SIGTERM откладывается до конца child:
   - `docker run` (создание временного контейнера);
   - ready-loop (`pg_isready` + `sleep`);
   - `CREATE DATABASE` / `pg_restore` через `docker exec`;
   - длительные integrity-запросы через `docker exec`;
   - harness-only пауза после `IRT_WORK_OK` (детерминированные signal-тесты).
4. `INTERRUPTED` ставится **только** при фактическом parent `SIGINT`/`SIGTERM`.
   Child exit 137/143 (OOM/`SIGTERM` внутри helper) **без** parent trap → fail-closed **rc=50**,
   `STATUS=failed`, `ERROR_CODE` фазы (например `PG_RESTORE_FAILED`), **не** `INTERRUPTED`.
   Наружу никогда не возвращаются raw 137/143 и не допускается `rc=0`.
5. `finalize_once` (один раз, идемпотентно при повторном входе):
   - снимает traps (без рекурсии);
   - если `IRT_SIGNAL_RECEIVED=1` — принудительно failed/`INTERRUPTED`/rc=50 (приоритет над `IRT_WORK_OK`);
   - идемпотентный cleanup (контейнер по проверенному CID + labels, snapshot, marker/cidfile/`current.env`);
   - независимая проверка отсутствия (`CLEANUP_OK` / `TEMP_RESOURCES_ABSENT` / `SNAPSHOT_ABSENT`);
   - затем пишет `last-attempt` / history (fail-closed);
   - `last-success` обновляется **только** после полностью успешного и **непрерванного** запуска
     (work + cleanup proofs + evidence, без parent signal);
   - ошибка записи evidence → `EVIDENCE_WRITE_FAILED`, rc=50 (tmp не оставляется);
   - завершается честным итоговым кодом (никогда raw 128+signal).
6. Ошибка cleanup не маскирует исходный код restore, но итог всегда ненулевой, если cleanup/proof неполны.
7. Успешный restore + неуспешный cleanup → service exit ≠ 0 (нет ложного успеха).

## Systemd аварийный cleanup (SIGKILL)

Docker-контейнер — не обычный child shell; `SIGKILL` traps не ловит.

- При старте: `--cidfile` в `runtime/<run-id>/container.cid` (0600) + labels
  (`component=isolated-restore-test`, `environment`, `run-id`) + `runtime/current.env`.
- Unit: `TimeoutStartSec=1900`, `TimeoutStopSec=120`, `KillMode=mixed`,
  `ExecStopPost=… --emergency-cleanup --environment <env>`.
- Emergency path: читает `current.env`/cidfile только из env runtime (без `source`/`eval`);
  валидирует CID format + labels + env + `RUN_ID`; `docker rm` только точечно;
  снова проверяет отсутствие; **никогда не изменяет `last-success`**.
- Snapshot/run-dir в emergency cleanup вычисляются **только** от canonical
  `realpath(cidfile)`: контракт `runtime/<run-id>/container.cid`. `dirname` исходного
  marker-пути (symlink) для snapshot/`rmdir` не используется.
- Сопоставление с `last-attempt`:
  - если `last-attempt` отсутствует или относится к **другому** `RUN_ID` → обязательно
    пишется новый failed `last-attempt` + history для аварийного `RUN_ID`
    (даже когда старый success-attempt ещё лежит на диске);
  - если `last-attempt` уже содержит полный результат того же `RUN_ID`
    (`STATUS` + `CLEANUP_OK` + `TEMP_RESOURCES_ABSENT`) → evidence no-op (идемпотентность);
  - повторный `ExecStopPost` без marker/cidfile → безопасный no-op.
- Marker/cidfile удаляются только после доказанного отсутствия temp-ресурсов и успешной
  фиксации результата (иначе сохраняются для retry).
- После нормального успеха `ExecStopPost` — безопасный no-op (нет current/cidfile).

**На сервере этот контур ещё не устанавливался и не проверялся.**

## Dump snapshot (анти-TOCTOU)

1. Канонический dump только внутри environment-specific backup root (не symlink).
2. Фиксация device/inode/size/mtime/SHA-256.
3. Приватный `runtime/<run-id>/` (`0700`), копия во временное имя (`cp --reflink=auto` с fallback), atomic rename, mode `0400`.
4. Повторная проверка source identity+hash; hash snapshot == source.
5. Сразу перед `docker run` — повторный stat+SHA snapshot.
6. В контейнер монтируется **только snapshot**, `:ro`.
7. После restore — snapshot не изменился.
8. Evidence SHA-256 = фактически смонтированный snapshot; basename/mtime ссылаются на исходный dump.
9. Snapshot удаляется в общем cleanup; неудача удаления → cleanup failure.

## Orphan reaper

`--reap-orphans` (и best-effort в начале run) удаляет **только** контейнеры, у которых одновременно:

- label component = isolated-restore-test;
- label environment = ожидаемый env;
- имя с префиксом `oz-rt-<env>-` и safe regex;
- status `created|exited|dead` (running **не** трогает);
- возраст ≥ `IRT_ORPHAN_TTL_HOURS` (6).

Запрещено: wildcard `oz-rt-*` без labels; удаление running общим reaper; любые `tvoe-vremya-*`.
Running orphan после systemd kill — зона `ExecStopPost` по cidfile.

## Изоляция временного PostgreSQL

- образ `postgres:17-alpine`;
- `--network none`, `--pull=never`, dump snapshot `:ro`;
- без published ports;
- `--memory=1g`, `--cpus=1.0`, `--pids-limit=256`
  (256: штатный PG restore с worker'ами, но потолок для runaway forks);
- без join к production/staging networks/volumes;
- `pg_restore --no-owner --no-acl`: тест проверяет **переносимость и целостность**
  данных/схемы, а не наличие исходных ролей БД (например staging `tvoe_vremya`).
  Роли из исходного окружения в чистый контейнер **не** создаются;
- рабочие контейнеры: pre/post metadata snapshot (id/name/running/restarts/started);
  изменение → `FORBIDDEN_CONTAINER_CHANGED` (80), без утверждения «untouched» при внешнем дрейфе;
- пароль temp PG никогда не логируется и не пишется в evidence.

## Diagnostic evidence (pg_restore)

При `PG_RESTORE_FAILED` stderr/stdout `pg_restore` больше не отбрасывается в `/dev/null`:

- пишется ограниченный sanitized лог `history/pg_restore_<RUN_ID>.error.log` (mode `0600`);
- активный указатель `last-pg-restore-error.log` (тот же текст, `0600`);
- в `last-attempt` / history — однострочный ключ `PG_RESTORE_ERROR_LOG=history/pg_restore_<RUN_ID>.error.log`
  (без многострочного тела, пригодного для `source`);
- секреты (`*PASSWORD*`, `*SECRET*`, `DATABASE_URL`, `postgres://…`) редактируются;
- размер ограничен (`IRT_PG_RESTORE_DIAG_MAX_BYTES`, по умолчанию 16 KiB);
- успешный запуск очищает активный `last-pg-restore-error.log` и оставляет
  `PG_RESTORE_ERROR_LOG` пустым (history-копии прошлых RUN_ID могут остаться до prune).

## IHM

Пороги — **единый runtime source of truth**:
`scripts/ops/lib/isolated-restore-test-policy.sh`
(на хосте: `/usr/local/lib/online-zapis-tv/lib/isolated-restore-test-policy.sh`).
Его source’ят и restore-test (через common), и IHM. Отсутствие/невалидность файла → fail-closed.

| Параметр | Значение | Имя в policy |
| --- | --- | --- |
| Выбор dump для теста | ≤ 36h | `IRT_DUMP_MAX_AGE_HOURS` |
| Возраст last-success | ≤ 192h | `IRT_SUCCESS_MAX_AGE_HOURS` |
| Абсолютный возраст referenced dump | ≤ 192h | `IRT_VERIFIED_DUMP_MAX_AGE_HOURS` |
| Отставание verified dump от latest | ≤ 168h | `IRT_DUMP_LAG_MAX_HOURS` |
| Stopped orphan TTL | 6h | `IRT_ORPHAN_TTL_HOURS` |

Без `.enforce`: статус проверки `not_enforced` (INFO) — не warning/critical, без Telegram,
без фиктивного `lastSuccess`, **не** доказательство restore readiness.

С `.enforce`: ENVIRONMENT совпадает; basename валиден; dump в env root, regular file, не symlink;
SHA/size/mtime согласованы; freshness/lag; `CLEANUP_OK=1`; `TEMP_RESOURCES_ABSENT=1`;
failed last-attempt при живом success → warning.

## Timers

| Env | OnCalendar |
| --- | --- |
| Production | `Sun 05:00 Asia/Yekaterinburg` + `RandomizedDelaySec=1800` |
| Staging | `Sun 06:30 Asia/Yekaterinburg` + `RandomizedDelaySec=1800` |

## Установка (только после отдельного решения OWNER)

```bash
bash scripts/ops/install-isolated-restore-test.sh --dry-run
bash scripts/ops/install-isolated-restore-test.sh --install   # timers NOT enabled
# controlled manual runs → verify evidence/cleanup
bash scripts/ops/install-isolated-restore-test.sh --install --enable-timers
bash scripts/ops/install-isolated-restore-test.sh --enable-enforce
```

До enforce IHM показывает `not_enforced`, не healthy readiness.

## Rollback

```bash
bash scripts/ops/install-isolated-restore-test.sh --uninstall-units
```

Удаляет только units. **Не** удаляет dumps и evidence.

## Exit codes

| Exit | Примеры |
| --- | --- |
| 0 | полный успех restore+cleanup+evidence |
| 10 | dump / snapshot / TOCTOU |
| 20 | image / start / not ready |
| 30 | pg_restore |
| 40 | integrity |
| 50 | cleanup / interrupt / emergency / evidence write |
| 60 | lock |
| 70 | usage |
| 80 | forbidden container metadata changed |

## Локальные проверки

```bash
npm run test:security:isolated-restore-test
npm run test:security:internal-health-monitor
bash scripts/ops/tests/isolated-restore-test-harness.sh
bash scripts/ops/tests/ihm-restore-test-evidence-harness.sh
```

Настоящий Docker, server dumps и рабочие БД не используются.

**Обязательно на Linux (не маскировать Windows SKIP как PASS):**

```bash
bash -n scripts/ops/isolated-restore-test.sh \
  scripts/ops/lib/isolated-restore-test-common.sh \
  scripts/ops/lib/fake-docker-irt.sh \
  scripts/ops/tests/isolated-restore-test-harness.sh
bash scripts/ops/tests/isolated-restore-test-harness.sh
bash scripts/ops/tests/ihm-restore-test-evidence-harness.sh
npm run test:security:isolated-restore-test
npm run test:security:internal-health-monitor
```

- `l01_symlink_cidfile` — emergency cleanup через symlink CIDFILE удаляет
  canonical `runtime/<run-id>/dump.snapshot` (на Git Bash/Windows может быть `SKIP`).
- `term_interrupt`, `term_during_restore`, `term_after_work_ok`, `dump_unreadable`,
  `evidence_write` — если SKIP на Windows, перепроверить на Linux host.
  Ожидаемый interrupt rc остаётся **50** (не 143; не ослаблять).
- `child_signal_death_137_*` и `child_signal_death_143_*` — child death без parent
  signal → фазовый `ERROR_CODE`, rc=50, не `INTERRUPTED`.
