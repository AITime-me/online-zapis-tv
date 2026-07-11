const FORMULA_PREFIX_PATTERN = /^[\s\uFEFF\u200B\u200C\u200D\u2060]*[=+\-@\t\r]/;

/**
 * Нейтрализует значение для безопасного открытия в Excel/LibreOffice CSV.
 * Ведущий apostrophe — стандартный способ Excel для принудительного text mode.
 * При импорте CSV Excel обычно не сохраняет этот символ как часть данных.
 */
export function neutralizeSpreadsheetFormulaValue(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);
  if (!FORMULA_PREFIX_PATTERN.test(stringValue)) {
    return stringValue;
  }

  return `'${stringValue}`;
}

export function isSpreadsheetFormulaLike(value: string): boolean {
  return FORMULA_PREFIX_PATTERN.test(value);
}
