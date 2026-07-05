import type { ReactNode } from "react";
import {
  getScheduleEditorFieldLabel,
  type ScheduleEditorFieldKey,
} from "@/lib/schedule/editor-field-labels";

/**
 * Единственный слой подписей полей editor UI расписания.
 * Не задавайте label вручную — только через field-ключ словаря.
 */

type EditorFieldProps = {
  field: ScheduleEditorFieldKey;
  htmlFor: string;
  children: ReactNode;
  className?: string;
};

export function EditorField({
  field,
  htmlFor,
  children,
  className = "flex flex-col gap-0.5",
}: EditorFieldProps) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium leading-tight text-zinc-600"
      >
        {getScheduleEditorFieldLabel(field)}
      </label>
      {children}
    </div>
  );
}

export function EditorCheckboxField({
  field,
  htmlFor,
  children,
  className = "mt-2 flex items-center gap-2 text-[10px] text-zinc-700",
}: EditorFieldProps) {
  return (
    <label htmlFor={htmlFor} className={className}>
      {children}
      <span>{getScheduleEditorFieldLabel(field)}</span>
    </label>
  );
}
