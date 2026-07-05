import { ScheduleBlockType } from "@prisma/client";
import {
  EDITOR_APPOINTMENT_SOURCE_LABELS,
  EDITOR_APPOINTMENT_STATUS_LABELS,
  EDITOR_BLOCK_TYPE_LABELS,
  EDITOR_FULL_DAY_CLOSURE_LABELS,
  getEditorBlockTypeLabel,
  getEditorFullDayClosureLabel,
} from "@/lib/schedule/editor-field-labels";

export {
  EDITOR_APPOINTMENT_STATUS_LABELS as APPOINTMENT_STATUS_LABELS,
  EDITOR_APPOINTMENT_SOURCE_LABELS as APPOINTMENT_SOURCE_LABELS,
  EDITOR_BLOCK_TYPE_LABELS as BLOCK_TYPE_LABELS,
  EDITOR_FULL_DAY_CLOSURE_LABELS as FULL_DAY_BLOCK_LABELS,
};

export const INTERVAL_BLOCK_TYPES: ScheduleBlockType[] = [
  "BREAK",
  "LUNCH",
  "TRAINING",
  "PERSONAL",
  "DO_NOT_BOOK",
  "TECHNICAL",
];

export const FULL_DAY_BLOCK_TYPES: Array<
  "DAY_OFF" | "VACATION" | "SICK_LEAVE" | "TRAINING" | "DO_NOT_BOOK"
> = ["DAY_OFF", "VACATION", "SICK_LEAVE", "TRAINING", "DO_NOT_BOOK"];

export function isFullDayBlockType(
  blockType: ScheduleBlockType,
): blockType is keyof typeof EDITOR_FULL_DAY_CLOSURE_LABELS {
  return FULL_DAY_BLOCK_TYPES.includes(
    blockType as (typeof FULL_DAY_BLOCK_TYPES)[number],
  );
}

export function getBlockDisplayLabel(
  blockType: ScheduleBlockType,
  isFullDay: boolean,
): string {
  if (isFullDay && isFullDayBlockType(blockType)) {
    return getEditorFullDayClosureLabel(blockType);
  }
  return getEditorBlockTypeLabel(blockType);
}
