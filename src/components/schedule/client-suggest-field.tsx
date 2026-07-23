"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ClientStatus } from "@prisma/client";

export type ClientSuggestItem = {
  id: string;
  fullName: string;
  phone: string | null;
  status: ClientStatus;
};

const DEBOUNCE_MS = 300;

export function ClientSuggestField({
  mode,
  value,
  onValueChange,
  onBlur,
  onPick,
  inputId,
  disabled,
}: {
  mode: "name" | "phone";
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  onPick: (client: ClientSuggestItem) => void;
  inputId: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [items, setItems] = useState<ClientSuggestItem[]>([]);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const q = value.trim();
    const digits = q.replace(/\D/g, "");
    const ready =
      mode === "name" ? q.length >= 2 : digits.length >= 4;

    abortRef.current?.abort();

    const timer = setTimeout(() => {
      if (!ready || disabled) {
        setItems([]);
        setOpen(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++seqRef.current;

      void (async () => {
        try {
          const response = await fetch(
            `/api/admin/clients/suggest?mode=${mode}&q=${encodeURIComponent(q)}`,
            { signal: controller.signal, cache: "no-store" },
          );
          const payload = (await response.json()) as {
            ok?: boolean;
            clients?: ClientSuggestItem[];
          };
          if (seq !== seqRef.current) {
            return;
          }
          if (!response.ok || !payload.ok) {
            setItems([]);
            setOpen(false);
            return;
          }
          const next = payload.clients ?? [];
          setItems(next);
          setOpen(next.length > 0);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (seq === seqRef.current) {
            setItems([]);
            setOpen(false);
          }
        }
      })();
    }, ready && !disabled ? DEBOUNCE_MS : 0);

    return () => {
      clearTimeout(timer);
    };
  }, [disabled, mode, value]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div className="relative">
      <input
        id={inputId}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
          onBlur?.();
        }}
        onFocus={() => {
          if (items.length > 0) {
            setOpen(true);
          }
        }}
        className="w-full border border-[#dadce0] px-1 py-0.5"
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listId}
      />
      {open && items.length > 0 ? (
        <ul
          id={listId}
          className="absolute z-20 mt-0.5 max-h-40 w-full overflow-auto border border-[#dadce0] bg-white text-[10px] shadow"
          role="listbox"
        >
          {items.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-2 py-1 text-left hover:bg-[#e8f0fe]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(client);
                  setOpen(false);
                  setItems([]);
                }}
              >
                <span className="font-medium text-zinc-800">{client.fullName}</span>
                <span className="text-zinc-500">
                  {client.phone ?? "без телефона"} · {client.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function describeClientLinkUi(input: {
  statusCode: string;
  clientId: string | null | undefined;
  clientPhone: string;
  isUsablePhone: boolean;
}): string | null {
  if (input.clientId) {
    return "Клиент связан";
  }
  if (input.statusCode !== "COMPLETED") {
    return "Клиент не связан";
  }
  if (!input.isUsablePhone) {
    return "Создание клиента пропущено";
  }
  return "Клиент не связан";
}
