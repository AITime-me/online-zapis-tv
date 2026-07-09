const CSV_DELIMITER = ";";

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);
  if (/[;"\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function buildCsvContent(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(CSV_DELIMITER);
  const dataLines = rows.map((row) =>
    row.map(escapeCsvCell).join(CSV_DELIMITER),
  );

  return `\uFEFF${[headerLine, ...dataLines].join("\r\n")}`;
}
