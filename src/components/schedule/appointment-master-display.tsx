export function AppointmentPromotionLabelBadges({
  labels,
  className = "",
}: {
  labels: string[];
  className?: string;
}) {
  if (labels.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-0.5 ${className}`.trim()}>
      {labels.map((label) => (
        <span
          key={label}
          className="inline-block rounded bg-emerald-50 px-1 py-px text-[9px] leading-tight text-emerald-900"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export function AppointmentMasterNoteBlock({
  note,
  className = "",
}: {
  note: string;
  className?: string;
}) {
  const trimmed = note.trim();
  if (!trimmed) {
    return null;
  }

  return (
    <div
      className={`rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] leading-tight text-amber-950 ${className}`.trim()}
    >
      <span className="font-medium">Пометка для мастера:</span> {trimmed}
    </div>
  );
}
