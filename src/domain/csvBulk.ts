import type {
  BulkCsvParseIssue,
  BulkCsvParseResult,
  BulkCsvRow,
  CardnewsError,
  CardnewsResult,
  DeckDraft
} from "./types.js";

const requiredColumns = [
  "output_name",
  "header_label",
  "footer_account",
  "style_id",
  "aspect_ratio",
  "card_01",
  "card_02"
] as const;

const optionalColumns = [
  "accent",
  "background",
  "dim",
  "font_id",
  "card_03",
  "card_04",
  "card_05",
  "card_06",
  "card_07",
  "card_08",
  "card_09",
  "card_10"
] as const;

export function buildBulkCsvTemplate(styleId: string, aspectRatio: string): string {
  const headers = [...requiredColumns, ...optionalColumns];
  const sample = [
    "sample-deck",
    "MONEY NOTE",
    "@kkongdon_story",
    styleId,
    aspectRatio,
    "유형: 표지\n배지: MONEY NOTE\n제목: 돈 이야기를 다시 배우는 이유\n소제목: 숫자보다 먼저 보는 관점",
    "유형: 본문\n제목: 첫 번째 기준\n본문: 매달 남는 돈보다 반복되는 지출 구조를 먼저 봅니다.\n- 고정비\n- 변동비"
  ];
  const optional = ["#6c5cff", "", "0.65", "", "", "", "", "", "", "", "", ""];
  return `${headers.join(",")}\n${[...sample, ...optional].map(escapeCsvValue).join(",")}\n`;
}

export function parseBulkCsv(
  text: string,
  styleIds: readonly string[],
  aspectRatioIds: readonly string[]
): CardnewsResult<BulkCsvParseResult> {
  // 앱이 내보낸 템플릿(Excel 호환용 BOM 포함)을 다시 불러올 때 BOM을 제거한다.
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) {
    return invalidInput("CSV에는 헤더와 최소 1개 데이터 행이 필요합니다.");
  }

  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    return invalidInput(`필수 컬럼이 없습니다: ${missing.join(", ")}`);
  }

  const parsedRows: BulkCsvRow[] = [];
  const issues: BulkCsvParseIssue[] = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    if (row.every((cell) => cell.trim().length === 0)) {
      return;
    }

    const record = Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""]));
    const parsed = parseBulkRecord(record, rowNumber, styleIds, aspectRatioIds);
    if (isCardnewsError(parsed)) {
      issues.push({ rowNumber, message: parsed.message });
      return;
    }

    parsedRows.push(parsed);
  });

  if (parsedRows.length === 0 && issues.length === 0) {
    return invalidInput("CSV에 처리할 데이터 행이 없습니다.");
  }

  return { rows: parsedRows, issues };
}

function parseBulkRecord(
  record: Readonly<Record<string, string>>,
  rowNumber: number,
  styleIds: readonly string[],
  aspectRatioIds: readonly string[]
): CardnewsResult<BulkCsvRow> {
  const outputName = record["output_name"]?.trim() ?? "";
  if (!outputName) {
    return invalidInput("output_name이 비어 있습니다.");
  }

  const styleId = record["style_id"]?.trim() ?? "";
  if (!styleIds.includes(styleId)) {
    return invalidInput(`style_id를 찾을 수 없습니다: ${styleId}`);
  }

  const aspectRatio = record["aspect_ratio"]?.trim() ?? "";
  if (!aspectRatioIds.includes(aspectRatio)) {
    return invalidInput(`aspect_ratio를 찾을 수 없습니다: ${aspectRatio}`);
  }

  const cards = collectCardDrafts(record);
  if (cards.length < 2) {
    return invalidInput("card_01, card_02는 비워둘 수 없습니다.");
  }

  const dim = parseOptionalDim(record["dim"]);
  if (isCardnewsError(dim)) {
    return dim;
  }

  const deckDraft: DeckDraft = {
    headerLabel: record["header_label"] || "MONEY NOTE",
    footerAccount: record["footer_account"] || "@kkongdon_story",
    styleId,
    aspectRatio,
    ...(record["accent"] ? { accentColor: record["accent"] } : {}),
    ...(record["background"] ? { backgroundId: record["background"] } : {}),
    ...(record["font_id"] ? { fontId: record["font_id"] } : {}),
    ...(dim !== undefined ? { backgroundDim: dim } : {}),
    cards
  };

  return { rowNumber, outputName, deckDraft };
}

function collectCardDrafts(record: Readonly<Record<string, string>>): DeckDraft["cards"] {
  const cards: DeckDraft["cards"][number][] = [];
  for (let index = 1; index <= 10; index += 1) {
    const key = `card_${String(index).padStart(2, "0")}`;
    const rawText = record[key]?.trim() ?? "";
    if (rawText.length > 0) {
      cards.push({ index, rawText });
    }
  }
  return cards;
}

function parseOptionalDim(value: string | undefined): CardnewsResult<number | undefined> {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return invalidInput("dim은 0~1 또는 0~100 숫자여야 합니다.");
  }

  return parsed > 1 ? Math.min(1, parsed / 100) : parsed;
}

function parseCsvRows(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function escapeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}
