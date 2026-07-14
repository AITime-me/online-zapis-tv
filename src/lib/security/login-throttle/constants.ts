/** Окно учёта неуспешных попыток входа (credentials). */
export const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000;

/** Временная блокировка после превышения лимита. */
export const LOGIN_THROTTLE_BLOCK_MS = 15 * 60 * 1000;

/** Лимит неуспешных попыток на нормализованный email/аккаунт. */
export const LOGIN_ACCOUNT_MAX_FAILURES = 5;

/** Более широкий лимит на доверенный IP (только при TRUST_PROXY_HEADERS). */
export const LOGIN_IP_MAX_FAILURES = 30;

/** Удалять устаревшие записи старше 24 часов (opportunistic cleanup). */
export const LOGIN_THROTTLE_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

/** Нейтральное сообщение на UI — дублируется здесь для security-тестов. */
export const CREDENTIALS_LOGIN_NEUTRAL_ERROR =
  "Неверный email или пароль";
