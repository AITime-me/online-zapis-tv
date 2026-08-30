/**
 * Shared stableKey / published payload `key` format.
 * Allows hierarchical keys like `procedure.pm_general` and hyphenated `faq-general`.
 */
export const BOT_KNOWLEDGE_STABLE_KEY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const BOT_KNOWLEDGE_MAX_STABLE_KEY = 120;

export const BOT_KNOWLEDGE_STABLE_KEY_HINT =
  "stableKey: только a-z, 0-9, точки, подчёркивания и дефисы (сегменты через . _ -), до 120 символов";
