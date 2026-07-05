import { formatStudioTimeInput } from "@/lib/datetime/date-layer";
import {
  getEditorAppointmentSourceLabel,
  getEditorAppointmentStatusLabel,
} from "@/lib/schedule/editor-field-labels";
import type { EditorServiceOption } from "@/services/ScheduleEditorOptionsService";

export type EditorSelectOption = {
  value: string;
  label: string;
};

export type EditorOptions = {
  master: { workStart: string; workEnd: string };
  services: EditorServiceOption[];
  statuses: EditorSelectOption[];
  sources: EditorSelectOption[];
};

const TIME_INPUT_PATTERN = /^\d{2}:\d{2}$/;

export function toScheduleTimeInput(
  value: Date | string | null | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  const formatted = formatStudioTimeInput(value);
  return TIME_INPUT_PATTERN.test(formatted) ? formatted : fallback;
}

/** Нормализует опции editor: label select-ов только из editor-field-labels.ts. */
export function normalizeEditorOptions(options: EditorOptions): EditorOptions {
  return {
    ...options,
    statuses: options.statuses.map(({ value }) => ({
      value,
      label: getEditorAppointmentStatusLabel(value),
    })),
    sources: options.sources.map(({ value }) => ({
      value,
      label: getEditorAppointmentSourceLabel(value),
    })),
  };
}
