"use client";

import { useEffect, useRef, useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import type {
  ClosedTestEventAckDto,
  ClosedTestEventStatusDto,
} from "@/lib/bot-core/closed-test-contract";

const SESSION_STORAGE_KEY = "bot-closed-test-session-id";
const POLL_INTERVAL_MS = 1_000;
const POLL_MAX_ATTEMPTS = 45;

type ConsolePhase = "idle" | "sending" | "polling" | "done" | "error";

type PostResponse =
  | { ok: true; ack: ClosedTestEventAckDto }
  | { ok: false; error?: string; code?: string };

type StatusResponse =
  | { ok: true; status: ClosedTestEventStatusDto }
  | { ok: false; error?: string; code?: string };

function newSafeId(prefix: string): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
}

function readOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{1,128}$/.test(existing)) {
      return existing;
    }
    const created = newSafeId("session");
    sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return newSafeId("session");
  }
}

function stageLabel(name: string, value: string | null | undefined): string {
  return value ? `${name}: ${value}` : `${name}: —`;
}

export function BotClosedTestConsole({ canEdit }: { canEdit: boolean }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<ConsolePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [ack, setAck] = useState<ClosedTestEventAckDto | null>(null);
  const [status, setStatus] = useState<ClosedTestEventStatusDto | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSessionId(readOrCreateSessionId());
    });
    return () => {
      cancelAnimationFrame(frame);
      abortRef.current = true;
    };
  }, []);

  async function pollUntilTerminal(eventId: string): Promise<void> {
    setPhase("polling");
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      if (abortRef.current) {
        return;
      }
      const response = await fetch(
        `/api/admin/bot/closed-test/events/${encodeURIComponent(eventId)}`,
        { method: "GET", credentials: "same-origin" },
      );
      const payload = await readApiJsonResponse<StatusResponse>(response);
      if (!response.ok || !payload.ok) {
        setPhase("error");
        setMessage(
          !payload.ok
            ? (payload.error ?? `Ошибка статуса (${response.status})`)
            : `Ошибка статуса (${response.status})`,
        );
        return;
      }
      setStatus(payload.status);
      if (payload.status.pipelineTerminal) {
        setPhase("done");
        setMessage(
          payload.status.pipelineOutcome === "delivered"
            ? "Synthetic pipeline завершён (DELIVERED). Это не ответ AI."
            : "Synthetic pipeline завершён с ошибкой/терминальным статусом.",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    setPhase("error");
    setMessage("Таймаут ожидания terminal/delivered состояния.");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || !sessionId || phase === "sending" || phase === "polling") {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      setPhase("error");
      setMessage("Введите сообщение для закрытого теста.");
      return;
    }

    abortRef.current = false;
    setPhase("sending");
    setMessage(null);
    setAck(null);
    setStatus(null);

    const requestId = newSafeId("req");
    try {
      const response = await fetch("/api/admin/bot/closed-test/events", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          requestId,
          text: trimmed,
        }),
      });
      const payload = await readApiJsonResponse<PostResponse>(response);
      if (!response.ok || !payload.ok) {
        setPhase("error");
        setMessage(
          !payload.ok
            ? (payload.error ?? `Ошибка отправки (${response.status})`)
            : `Ошибка отправки (${response.status})`,
        );
        return;
      }
      setAck(payload.ack);
      setMessage(
        payload.ack.duplicate
          ? "Событие принято (duplicate ack). Ожидаю pipeline…"
          : "Событие принято. Ожидаю pipeline…",
      );
      await pollUntilTerminal(payload.ack.eventId);
    } catch (error) {
      setPhase("error");
      setMessage(
        error instanceof Error ? error.message : "Не удалось выполнить closed-test",
      );
    }
  }

  const busy = phase === "sending" || phase === "polling";
  const ready = Boolean(sessionId);

  return (
    <section className="space-y-3 rounded border border-zinc-200 bg-white p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-900">
          Synthetic closed-test (не AI / не live-клиент)
        </h2>
        <p className="text-xs text-zinc-500">
          Тестовый synthetic-only контур Bot Core через server proxy. Не
          публичный канал, не AI-диалог и не запись в booking. Маркер{" "}
          <code className="rounded bg-zinc-100 px-1">SYNTHETIC_OK</code> — не
          ответ модели.
        </p>
      </div>

      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-700">Сообщение</span>
          <textarea
            value={text}
            disabled={!canEdit || busy || !ready}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500"
            placeholder="Текст только для synthetic closed-test…"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canEdit || busy || !ready || !text.trim()}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {phase === "sending"
              ? "Отправка…"
              : phase === "polling"
                ? "Ожидание…"
                : "Отправить"}
          </button>
          <span className="text-xs text-zinc-500">
            session: <code>{sessionId ?? "…"}</code>
          </span>
        </div>
      </form>

      {message ? (
        <p
          className={`text-xs ${
            phase === "error" ? "text-red-700" : "text-zinc-600"
          }`}
        >
          {message}
        </p>
      ) : null}

      {ack ? (
        <div className="space-y-1 rounded border border-zinc-100 bg-zinc-50 p-3 text-xs text-zinc-700">
          <p className="font-medium text-zinc-800">POST ack</p>
          <p>event: {ack.eventId}</p>
          <p>ingress status: {ack.status}</p>
          <p>duplicate: {ack.duplicate ? "yes" : "no"}</p>
        </div>
      ) : null}

      {status ? (
        <div className="space-y-2 rounded border border-zinc-100 bg-zinc-50 p-3 text-xs text-zinc-700">
          <p className="font-medium text-zinc-800">Стадии pipeline</p>
          <ul className="space-y-1">
            <li>{stageLabel("ingress", status.ingress.status)}</li>
            <li>
              {stageLabel(
                "inbound",
                status.inbound?.processingStatus ?? null,
              )}
            </li>
            <li>{stageLabel("reply_plan", status.replyPlan?.status ?? null)}</li>
            <li>
              {stageLabel(
                "outbound",
                status.outbound
                  ? `${status.outbound.destinationType}/${status.outbound.deliveryStatus}`
                  : null,
              )}
            </li>
          </ul>

          <div className="border-t border-zinc-200 pt-2">
            <p className="font-medium text-zinc-800">
              Safe synthetic result (не AI-ответ)
            </p>
            {status.syntheticResult ? (
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-zinc-600">
                {JSON.stringify(status.syntheticResult, null, 2)}
              </pre>
            ) : (
              <p className="mt-1 text-zinc-500">Пока нет / не allowlisted.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
