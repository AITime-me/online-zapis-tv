/**
 * Константы и подписи редактора рассылок (без сетевых вызовов).
 */

export const STUDIO_TIMEZONE = "Asia/Yekaterinburg";
export const STUDIO_TIMEZONE_LABEL = "Время студии — Екатеринбург";

/** Практический лимит кнопок в одном сообщении VK (keyboard). */
export const VK_MAX_MESSAGE_BUTTONS = 10;

export const COMM_MESSAGE_MAX_LENGTH = 4096;
export const DEFAULT_ATTRIBUTION_DAYS = 7;

export const COMM_BUTTON_STYLE_UI_LABELS = {
  PRIMARY: "Основная",
  POSITIVE: "Акцентная",
  NEGATIVE: "Отписка",
  SECONDARY: "Нейтральная",
} as const;

export const COMM_BUTTON_TYPE_UI_LABELS = {
  REPLY_TEXT: "Ответить сообщением",
  OPEN_LINK: "Открыть страницу",
  CALLBACK: "Передать действие боту",
  UNSUBSCRIBE: "Отписаться",
} as const;

export const COMM_BUTTON_TYPE_HINTS = {
  REPLY_TEXT:
    "Клиент нажмёт кнопку — в диалог отправится заданный текст ответа.",
  OPEN_LINK: "Откроется страница сайта или безопасная ссылка https://…",
  CALLBACK: "Будет доступно после подключения бота.",
  UNSUBSCRIBE:
    "После подключения VK кнопка отпишет человека от будущих рассылок.",
} as const;

export const DEFAULT_UNSUBSCRIBE_BUTTON_TEXT = "Не получать рассылки";

export const COMM_PREVIEW_DISCLAIMER =
  "Предпросмотр приблизительный. Окончательный вид зависит от интерфейса VK";

export const COMM_TEST_SEND_BLOCKED_REASON =
  "Подключите VK и выберите тестового получателя";

export const COMM_LAUNCH_BLOCKED_REASON =
  "Запуск недоступен: подключите VK и worker отправки";
