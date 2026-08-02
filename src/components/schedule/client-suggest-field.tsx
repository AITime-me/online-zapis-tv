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
  linkedClientId,
}: {
  mode: "name" | "phone";
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  onPick: (client: ClientSuggestItem) => void;
  inputId: string;
  disabled?: boolean;
  /** Когда связь снимается (id → null), снова разрешаем suggest. */
  linkedClientId?: string | null;
}) {
  const listId = useId();
  const [items, setItems] = useState<ClientSuggestItem[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const focusedRef = useRef(false);
  /**
   * После выбора клиента value обновляется родителем → debounce-fetch снова
   * находит того же клиента и без этого флага снова открывает список.
   * Сбрасывается при вводе. При установке linkedClientId suppress включается
   * на обоих полях (name/phone), чтобы парное обновление value не открыло список.
   * При снятии связи только разрешаем следующий ввод — без авто-fetch текущего value
   * (иначе поле телефона сразу снова откроет suggest).
   */
  const suppressSuggestRef = useRef(false);
  const prevLinkedClientIdRef = useRef<string | null | undefined>(linkedClientId);

  function invalidateSuggest() {
    abortRef.current?.abort();
    seqRef.current += 1;
    setOpen(false);
    setItems([]);
    setHighlightIndex(-1);
  }

  useEffect(() => {
    const prev = prevLinkedClientIdRef.current;
    prevLinkedClientIdRef.current = linkedClientId;
    // Связь установлена (в т.ч. через парное поле name/phone) — не открывать suggest.
    if (linkedClientId) {
      suppressSuggestRef.current = true;
      invalidateSuggest();
      return;
    }
    if (prev && !linkedClientId) {
      // Разрешаем следующий явный focus/ввод, но не авто-fetch текущего value.
      suppressSuggestRef.current = false;
      invalidateSuggest();
    }
  }, [linkedClientId]);

  function pickClient(client: ClientSuggestItem) {
    suppressSuggestRef.current = true;
    invalidateSuggest();
    onPick(client);
  }

  useEffect(() => {
    const q = value.trim();
    const digits = q.replace(/\D/g, "");
    const ready =
      mode === "name" ? q.length >= 2 : digits.length >= 4;

    abortRef.current?.abort();
    const seq = ++seqRef.current;

    if (suppressSuggestRef.current || !focused || !ready || disabled) {
      setItems([]);
      setOpen(false);
      setHighlightIndex(-1);
      return;
    }

    const timer = setTimeout(() => {
      if (
        seq !== seqRef.current ||
        suppressSuggestRef.current ||
        !focusedRef.current ||
        disabled
      ) {
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

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
          if (
            seq !== seqRef.current ||
            suppressSuggestRef.current ||
            !focusedRef.current
          ) {
            return;
          }
          if (!response.ok || !payload.ok) {
            setItems([]);
            setOpen(false);
            setHighlightIndex(-1);
            return;
          }
          const next = payload.clients ?? [];
          setItems(next);
          setOpen(next.length > 0);
          setHighlightIndex(next.length > 0 ? 0 : -1);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (
            seq === seqRef.current &&
            !suppressSuggestRef.current &&
            focusedRef.current
          ) {
            setItems([]);
            setOpen(false);
            setHighlightIndex(-1);
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [disabled, focused, mode, value]);

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
        onChange={(event) => {
          suppressSuggestRef.current = false;
          onValueChange(event.target.value);
        }}
        onBlur={() => {
          focusedRef.current = false;
          setFocused(false);
          invalidateSuggest();
          onBlur?.();
        }}
        onFocus={() => {
          if (disabled) {
            return;
          }
          focusedRef.current = true;
          setFocused(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (!open && items.length === 0) {
              return;
            }
            event.preventDefault();
            invalidateSuggest();
            return;
          }
          if (!open || items.length === 0) {
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlightIndex((index) =>
              index < items.length - 1 ? index + 1 : 0,
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightIndex((index) =>
              index > 0 ? index - 1 : items.length - 1,
            );
            return;
          }
          if (event.key === "Enter") {
            const picked =
              highlightIndex >= 0 && highlightIndex < items.length
                ? items[highlightIndex]
                : items[0];
            if (picked) {
              event.preventDefault();
              pickClient(picked);
            }
          }
        }}
        className="w-full border border-[#dadce0] px-1 py-0.5"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={
          open && highlightIndex >= 0
            ? `${listId}-option-${highlightIndex}`
            : undefined
        }
      />
      {open && items.length > 0 ? (
        <ul
          id={listId}
          data-testid="client-suggest-list"
          className="absolute z-20 mt-0.5 max-h-40 w-full overflow-auto border border-[#dadce0] bg-white text-[10px] shadow"
          role="listbox"
        >
          {items.map((client, index) => (
            <li key={client.id} role="presentation">
              <button
                type="button"
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === highlightIndex}
                data-testid={`client-suggest-option-${client.id}`}
                className={`flex w-full flex-col items-start px-2 py-1 text-left hover:bg-[#e8f0fe] ${
                  index === highlightIndex ? "bg-[#e8f0fe]" : ""
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  pickClient(client);
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
