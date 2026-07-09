export type CsvDelimiter = ";" | ",";

export type ParsedCsv = {
  delimiter: CsvDelimiter;
  headers: string[];
  rows: string[][];
};

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function getFirstLine(content: string): string {
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (char === '"') {
      if (inQuotes && content[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      return content.slice(0, index);
    }
  }

  return content;
}

function countDelimiterOutsideQuotes(line: string, delimiter: CsvDelimiter): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

export function detectCsvDelimiter(content: string): CsvDelimiter {
  const firstLine = getFirstLine(content);
  const semicolonCount = countDelimiterOutsideQuotes(firstLine, ";");
  const commaCount = countDelimiterOutsideQuotes(firstLine, ",");

  if (commaCount > semicolonCount) {
    return ",";
  }

  return ";";
}

function parseCsvRecords(content: string, delimiter: CsvDelimiter): string[][] {
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  const pushCell = () => {
    currentRecord.push(currentCell);
    currentCell = "";
  };

  const pushRecord = () => {
    if (currentRecord.length > 0 || currentCell.length > 0) {
      pushCell();
      records.push(currentRecord);
      currentRecord = [];
    }
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          currentCell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      pushCell();
      continue;
    }

    if (char === "\r") {
      if (content[index + 1] === "\n") {
        index += 1;
      }
      pushRecord();
      continue;
    }

    if (char === "\n") {
      pushRecord();
      continue;
    }

    currentCell += char;
  }

  if (inQuotes) {
    throw new Error("Некорректный CSV: незакрытая кавычка");
  }

  if (currentCell.length > 0 || currentRecord.length > 0) {
    pushRecord();
  }

  return records;
}

function trimCell(value: string): string {
  return value.trim();
}

function isEmptyRecord(record: string[]): boolean {
  return record.every((cell) => trimCell(cell).length === 0);
}

export function parseCsvContent(content: string): ParsedCsv {
  const normalizedContent = stripBom(content).replace(/^\uFEFF/, "");
  if (!normalizedContent.trim()) {
    throw new Error("Файл пустой");
  }

  const delimiter = detectCsvDelimiter(normalizedContent);
  const records = parseCsvRecords(normalizedContent, delimiter);

  if (records.length === 0) {
    throw new Error("В файле нет данных");
  }

  const headers = records[0].map(trimCell);
  const rows = records
    .slice(1)
    .filter((record) => !isEmptyRecord(record))
    .map((record) => {
      const normalizedRow = [...record];
      while (normalizedRow.length < headers.length) {
        normalizedRow.push("");
      }
      return normalizedRow.slice(0, headers.length).map(trimCell);
    });

  return {
    delimiter,
    headers,
    rows,
  };
}
