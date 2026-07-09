"use client";

import { useState, type KeyboardEvent } from "react";
import {
  ClientTagBadge,
} from "@/components/admin/client-tag-badges";
import {
  mergeClientTags,
  normalizeTagValue,
} from "@/lib/clients/tags";

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";

type ClientTagsEditorProps = {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
};

export function ClientTagsEditor({
  tags,
  onChange,
  disabled = false,
}: ClientTagsEditorProps) {
  const [draft, setDraft] = useState("");

  const addTag = () => {
    const normalized = normalizeTagValue(draft);
    if (!normalized) {
      return;
    }

    const nextTags = mergeClientTags(tags, [normalized]);
    if (nextTags.length === tags.length) {
      setDraft("");
      return;
    }

    onChange(nextTags);
    setDraft("");
  };

  const removeTag = (tagToRemove: string) => {
    onChange(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Например: холодная плазма"
          className={fieldClass}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={addTag}
          disabled={disabled || !normalizeTagValue(draft)}
          className="shrink-0 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          Добавить тег
        </button>
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1">
              <ClientTagBadge tag={tag} />
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={disabled}
                className="rounded px-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
                aria-label={`Удалить тег ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">Тегов пока нет.</p>
      )}

      <p className="text-xs text-zinc-500">
        Теги «игра», «подарок» и «онлайн-запись» добавляются автоматически из
        заявок. Теги с префиксом «бот:» будут отмечены как бот-теги.
      </p>
    </div>
  );
}
