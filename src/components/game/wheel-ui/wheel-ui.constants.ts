import type {
  WheelProcedureIntent,
  WheelUiPhase,
  WheelZone,
} from "./wheel-ui.types";

export const WHEEL_SECTOR_COUNT = 16;
export const WHEEL_SECTOR_ANGLE = 360 / WHEEL_SECTOR_COUNT;
export const WHEEL_SPIN_MIN_TURNS = 4;
export const WHEEL_SPIN_DURATION_MS = 4500;

export const INTENT_OPTIONS: Array<{
  value: WheelProcedureIntent;
  label: string;
  description: string;
}> = [
  {
    value: "primary",
    label: "Первый перманент",
    description: "Делаю перманентный макияж впервые",
  },
  {
    value: "refresh",
    label: "Рефреш",
    description: "Обновление уже существующего перманента",
  },
  {
    value: "cover",
    label: "Перекрытие",
    description: "Хочу перекрыть предыдущую работу",
  },
  {
    value: "undecided",
    label: "Пока выбираю",
    description: "Ещё определяюсь с направлением",
  },
];

export const ZONE_OPTIONS: Array<{
  value: WheelZone;
  label: string;
}> = [
  { value: "lips", label: "Губы" },
  { value: "brows", label: "Брови" },
  { value: "eyelids", label: "Веки" },
];

export const INTENT_LABELS: Record<WheelProcedureIntent, string> = {
  primary: "Первый перманент",
  refresh: "Рефреш",
  cover: "Перекрытие",
  undecided: "Пока выбираю",
};

export const ZONE_LABELS: Record<WheelZone, string> = {
  lips: "Губы",
  brows: "Брови",
  eyelids: "Веки",
};

export const PHASE_PROGRESS: Partial<Record<WheelUiPhase, number>> = {
  intro: 0,
  preferences: 1,
  contact: 2,
  ready: 3,
  spinning: 3,
  result: 4,
  submitting: 4,
  submitted: 5,
  restored: 5,
};

export const PROGRESS_STEPS = [
  "Процедура",
  "Контакты",
  "Колесо",
  "Подарок",
] as const;

export const SECTOR_FILL_COLORS = [
  "#1A433C",
  "#254F47",
  "#0F2F2A",
  "#2D5A50",
  "#1A433C",
  "#254F47",
  "#0F2F2A",
  "#2D5A50",
  "#1A433C",
  "#254F47",
  "#0F2F2A",
  "#2D5A50",
  "#1A433C",
  "#254F47",
  "#0F2F2A",
  "#2D5A50",
] as const;

export const BRAND = {
  studio: "Твоё время",
  studioFull: "Студия красоты «Твоё время»",
  gameTitle: "Колесо фортуны",
  gameSubtitle:
    "Немного удачи — и подарок к вашему перманенту уже ждёт вас",
  gameDescription:
    "Выберите направление, покрутите колесо и получите подарок к записи в студию «Твоё время».",
} as const;

export const EMPTY_LEAD = {
  name: "",
  phone: "",
  personalDataConsent: false,
  offerAcknowledgement: false,
} as const;
