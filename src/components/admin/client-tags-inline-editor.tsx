"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ClientTagBadge } from "@/components/admin/client-tag-badges";
import { patchClientTags } from "@/lib/clients/patch-client-tags";
import {
  canRemoveClientTagInline,
  mergeClientTags,
  normalizeTagValue,
} from "@/lib/clients/tags";

const COMPACT_VISIBLE_TAG_COUNT = 2;

type ClientTagsInlineEditorProps = {
  clientId: string;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  compact?: boolean;
  onInteractionChange?: (busy: boolean) => void;
};

function EditableTagChip({
  tag,
  saving,
  onRemove,
}: {
  tag: string;
  saving: boolean;
  onRemove: (tag: string) => void;
}) {
  return (
    <span className="inline-flex max-w-full shrink-0 items-center gap-0.5">
      <ClientTagBadge tag={tag} compact />
      {canRemoveClientTagInline(tag) ? (
        <button
          type="button"
          onClick={() => onRemove(tag)}
          disabled={saving}
          className="rounded px-0.5 text-xs leading-none text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
          aria-label={`Удалить тег ${tag}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function ClientTagsInlineEditor({
  clientId,
  tags,
  onTagsChange,
  compact = false,
  onInteractionChange,
}: ClientTagsInlineEditorProps) {
  const [localTags, setLocalTags] = useState(tags);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding || saving) {
      return;
    }
    setLocalTags(tags);
  }, [tags, isAdding, saving]);

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    onInteractionChange?.(isAdding || saving);
  }, [isAdding, saving, onInteractionChange]);

  useEffect(() => {
    if (localTags.length <= COMPACT_VISIBLE_TAG_COUNT) {
      setTagsExpanded(false);
    }
  }, [localTags.length]);

  const useCollapsedView = compact && !tagsExpanded;
  const hiddenTagCount = useCollapsedView
    ? Math.max(0, localTags.length - COMPACT_VISIBLE_TAG_COUNT)
    : 0;
  const visibleTags = useCollapsedView
    ? localTags.slice(0, COMPACT_VISIBLE_TAG_COUNT)
    : localTags;

  const persistTags = async (nextTags: string[]) => {
    const previousTags = localTags;
    setSaving(true);
    setError(null);
    setLocalTags(nextTags);

    try {
      const savedTags = await patchClientTags(clientId, nextTags);
      setLocalTags(savedTags);
      onTagsChange(savedTags);
    } catch (saveError) {
      setLocalTags(previousTags);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Не удалось сохранить теги",
      );
    } finally {
      setSaving(false);
    }
  };

  const openAddInput = () => {
    setError(null);
    setDraft("");
    setIsAdding(true);
  };

  const closeAddInput = () => {
    setDraft("");
    setIsAdding(false);
  };

  const addTag = async () => {
    const normalized = normalizeTagValue(draft);
    if (!normalized) {
      return;
    }

    const nextTags = mergeClientTags(localTags, [normalized]);
    if (nextTags.length === localTags.length) {
      setDraft("");
      closeAddInput();
      return;
    }

    closeAddInput();
    await persistTags(nextTags);
  };

  const removeTag = async (tagToRemove: string) => {
    if (!canRemoveClientTagInline(tagToRemove)) {
      return;
    }

    const nextTags = localTags.filter((tag) => tag !== tagToRemove);
    await persistTags(nextTags);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void addTag();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeAddInput();
    }
  };

  const hiddenTagsTitle = useCollapsedView
    ? localTags.slice(COMPACT_VISIBLE_TAG_COUNT).join(", ")
    : undefined;

  return (
    <div
      className={`space-y-1 ${compact ? "max-w-[11.5rem]" : "max-w-[16rem]"}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-1">
        {localTags.length === 0 && !isAdding ? (
          <span className="text-xs text-zinc-400">—</span>
        ) : null}

        {visibleTags.map((tag) => (
          <EditableTagChip
            key={tag}
            tag={tag}
            saving={saving}
            onRemove={(value) => void removeTag(value)}
          />
        ))}

        {hiddenTagCount > 0 ? (
          <button
            type="button"
            onClick={() => setTagsExpanded((current) => !current)}
            title={hiddenTagsTitle}
            className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
          >
            +{hiddenTagCount}
          </button>
        ) : null}

        {compact && tagsExpanded && localTags.length > COMPACT_VISIBLE_TAG_COUNT ? (
          <button
            type="button"
            onClick={() => setTagsExpanded(false)}
            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-50"
          >
            свернуть
          </button>
        ) : null}

        {isAdding ? (
          <span className="inline-flex items-center gap-1">
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!normalizeTagValue(draft)) {
                  closeAddInput();
                }
              }}
              placeholder="новый тег"
              disabled={saving}
              className="w-20 rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-900"
            />
            <button
              type="button"
              onClick={() => void addTag()}
              disabled={saving || !normalizeTagValue(draft)}
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              OK
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={openAddInput}
            disabled={saving}
            className="shrink-0 rounded border border-dashed border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-600 hover:border-zinc-400 hover:text-zinc-800 disabled:opacity-50"
          >
            {saving ? "…" : "+ тег"}
          </button>
        )}
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
