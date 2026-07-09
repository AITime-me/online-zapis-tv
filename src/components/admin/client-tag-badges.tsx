import {
  getClientTagDisplay,
  type ClientTagKind,
} from "@/lib/clients/tags";

const TAG_KIND_CLASS: Record<ClientTagKind, string> = {
  manual: "border border-zinc-200 bg-zinc-100 text-zinc-700",
  auto: "border border-sky-100 bg-sky-50 text-sky-800",
  bot: "border border-violet-100 bg-violet-50 text-violet-800",
};

type ClientTagBadgeProps = {
  tag: string;
  compact?: boolean;
};

export function ClientTagBadge({ tag, compact = false }: ClientTagBadgeProps) {
  const display = getClientTagDisplay(tag);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${TAG_KIND_CLASS[display.kind]} ${compact ? "max-w-[5.75rem] whitespace-nowrap" : "max-w-full"}`}
      title={tag}
    >
      {display.kind === "bot" ? <span aria-hidden="true">🤖</span> : null}
      <span className="truncate">{display.label}</span>
      {display.suffix ? (
        <span className="text-[10px] font-normal opacity-75">· {display.suffix}</span>
      ) : null}
    </span>
  );
}

type ClientTagBadgesProps = {
  tags: string[];
  maxVisible?: number;
  compact?: boolean;
};

export function ClientTagBadges({
  tags,
  maxVisible = 4,
  compact = false,
}: ClientTagBadgesProps) {
  if (tags.length === 0) {
    return <span className="text-zinc-400">—</span>;
  }

  const visibleTags = tags.slice(0, maxVisible);
  const hiddenCount = tags.length - visibleTags.length;

  return (
    <div className={`flex max-w-[14rem] flex-wrap gap-1 ${compact ? "" : "min-w-[8rem]"}`}>
      {visibleTags.map((tag) => (
        <ClientTagBadge key={tag} tag={tag} compact={compact} />
      ))}
      {hiddenCount > 0 ? (
        <span className="self-center text-xs text-zinc-500">+{hiddenCount}</span>
      ) : null}
    </div>
  );
}
