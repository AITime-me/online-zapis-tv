export const BORDER_OUTER = "border-[#c7cdd3]";
export const BORDER_INNER = "border-[#d0d5da]";
export const BORDER_DATE = "border-[#b8c0c8]";

export const DATE_COL_WIDTH = "w-[84px] min-w-[84px] max-w-[84px]";
export const MANAGER_COL = "w-[160px] min-w-[160px] max-w-[160px]";
export const OWNER_COL = "w-[160px] min-w-[160px] max-w-[160px]";
export const MASTER_COL = "w-[200px] min-w-[200px] max-w-[200px]";

export const HEADER_BG = "bg-[#eef0f3]";
export const DATE_HEADER_BG = "bg-[#e8ebf0]";

/**
 * Контейнер прокрутки таблицы.
 * Высоту root задаёт `.schedule-viewport-height` (100vh → 100dvh через @supports);
 * дальше flex-цепочка с `min-h-0` / `flex-1` заполняет оставшееся место.
 * Вертикальный scroll — только здесь (`overflow-y-auto`), не на page wrappers.
 */
export const SCHEDULE_TABLE_SCROLL = [
  "w-full max-w-full min-w-0",
  "overflow-x-auto overflow-y-auto",
  "overscroll-x-contain overscroll-y-contain",
  "touch-pan-x touch-pan-y",
  "[-webkit-overflow-scrolling:touch]",
].join(" ");

/** @deprecated Используйте SCHEDULE_TABLE_SCROLL */
export const STICKY_SCROLL = SCHEDULE_TABLE_SCROLL;

export const STICKY_CORNER_HEADER = [
  "sticky top-0 left-0 z-[5]",
  DATE_COL_WIDTH,
  DATE_HEADER_BG,
  "shadow-[2px_2px_6px_-2px_rgba(0,0,0,0.14)]",
].join(" ");

export const STICKY_COLUMN_HEADER = [
  "sticky top-0 z-[4]",
  HEADER_BG,
  "shadow-[0_2px_4px_-2px_rgba(0,0,0,0.1)]",
].join(" ");

export function stickyDateBodyClass(dateCellBg: string): string {
  return [
    "sticky left-0 z-[3]",
    DATE_COL_WIDTH,
    dateCellBg,
    "shadow-[2px_0_6px_-2px_rgba(0,0,0,0.12)]",
  ].join(" ");
}
