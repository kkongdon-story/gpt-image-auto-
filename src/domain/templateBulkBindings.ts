import type {
  BulkBinding,
  BulkBindingMetadata,
  BulkBindingTarget,
  CardLayer,
  CardnewsError,
  CardnewsResult,
  WorkspaceState
} from "./types.js";

export const TEMPLATE_BULK_V2_SCHEMA = "kkongdon.cardnews.bulk.v2";
export const TEMPLATE_BULK_V2_RESERVED_COLUMNS = [
  "__schema",
  "__template_id",
  "__template_revision",
  "output_name"
] as const;

export const TEMPLATE_BULK_V2_LIMITS = {
  maxCsvBytes: 10 * 1024 * 1024,
  maxDataRows: 300,
  maxColumns: 150,
  maxCellCharacters: 20_000,
  maxCellUtf8Bytes: 64 * 1024,
  maxOutputNameCharacters: 120
} as const;

export type TemplateBulkCsvRecord = {
  readonly rowNumber: number;
  readonly outputName: string;
  readonly values: Readonly<Record<string, string>>;
};

export type TemplateBulkCsvPreflight = {
  readonly headers: readonly string[];
  readonly rows: readonly TemplateBulkCsvRecord[];
};

export function validateBulkBindingMetadata(metadata: BulkBindingMetadata): CardnewsResult<BulkBindingMetadata> {
  if (metadata.schemaVersion !== 1) {
    return invalidInput("bulk binding metadata schemaVersion must be 1.");
  }

  if (metadata.templateId.trim().length === 0) {
    return invalidInput("templateId is required.");
  }

  if (!Number.isInteger(metadata.templateRevision) || metadata.templateRevision < 0) {
    return invalidInput("templateRevision must be a non-negative integer.");
  }

  const seenKeys = new Set<string>();
  for (const binding of metadata.bindings) {
    const validation = validateBinding(binding);
    if (isCardnewsError(validation)) {
      return validation;
    }

    if (seenKeys.has(binding.key)) {
      return invalidInput(`duplicate binding key: ${binding.key}`);
    }
    seenKeys.add(binding.key);
  }

  if (TEMPLATE_BULK_V2_RESERVED_COLUMNS.length + metadata.bindings.length > TEMPLATE_BULK_V2_LIMITS.maxColumns) {
    return invalidInput(`CSV columns exceed limit: ${TEMPLATE_BULK_V2_LIMITS.maxColumns}`);
  }

  return metadata;
}

export function buildTemplateBulkSampleCsv(metadata: BulkBindingMetadata): CardnewsResult<string> {
  const validation = validateBulkBindingMetadata(metadata);
  if (isCardnewsError(validation)) {
    return validation;
  }

  const headers = [...TEMPLATE_BULK_V2_RESERVED_COLUMNS, ...metadata.bindings.map((binding) => binding.key)];
  const sampleRow = [
    TEMPLATE_BULK_V2_SCHEMA,
    metadata.templateId,
    String(metadata.templateRevision),
    "sample-deck",
    ...metadata.bindings.map((binding) => sampleValueForBinding(binding))
  ];

  return `${headers.map(escapeCsvValue).join(",")}\n${sampleRow.map(escapeCsvValue).join(",")}\n`;
}

export function preflightTemplateBulkCsv(
  csvText: string,
  metadata: BulkBindingMetadata
): CardnewsResult<TemplateBulkCsvPreflight> {
  const validation = validateBulkBindingMetadata(metadata);
  if (isCardnewsError(validation)) {
    return validation;
  }

  const csvBytes = utf8ByteLength(csvText);
  if (csvBytes > TEMPLATE_BULK_V2_LIMITS.maxCsvBytes) {
    return invalidInput(`CSV file exceeds ${TEMPLATE_BULK_V2_LIMITS.maxCsvBytes} bytes.`);
  }

  const parsedRows = parseCsvRows(csvText.replace(/^\uFEFF/, ""));
  if (parsedRows.length < 2) {
    return invalidInput("CSV requires a header and at least one data row.");
  }

  const headers = parsedRows[0] ?? [];
  const headerValidation = validateHeaders(headers, metadata);
  if (isCardnewsError(headerValidation)) {
    return headerValidation;
  }

  const dataRows = parsedRows
    .slice(1)
    .map((cells, index) => ({ cells, rowNumber: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim().length > 0));
  if (dataRows.length === 0) {
    return invalidInput("CSV contains no data rows.");
  }
  if (dataRows.length > TEMPLATE_BULK_V2_LIMITS.maxDataRows) {
    return invalidInput(`CSV data rows exceed limit: ${TEMPLATE_BULK_V2_LIMITS.maxDataRows}`);
  }

  const rows: TemplateBulkCsvRecord[] = [];
  for (const { cells, rowNumber } of dataRows) {
    const cellValidation = validateCells(cells, rowNumber);
    if (isCardnewsError(cellValidation)) {
      return cellValidation;
    }
    if (cells.length > headers.length) {
      return invalidInput(`row ${rowNumber}: too many CSV cells.`);
    }

    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    const rowValidation = validateReservedRecord(record, metadata, rowNumber);
    if (isCardnewsError(rowValidation)) {
      return rowValidation;
    }

    const values: Record<string, string> = {};
    for (const binding of metadata.bindings) {
      const rawValue = record[binding.key] ?? "";
      const effectiveValue = rawValue.length > 0 ? rawValue : binding.defaultValue ?? "";
      values[binding.key] = effectiveValue;
      if (binding.required && effectiveValue.trim().length === 0) {
        return invalidInput(`row ${rowNumber}: required binding is empty: ${binding.key}`);
      }
    }

    rows.push({ rowNumber, outputName: record["output_name"] ?? "", values });
  }

  return { headers, rows };
}

export function materializeTemplateBulkRow(
  template: WorkspaceState,
  metadata: BulkBindingMetadata,
  row: TemplateBulkCsvRecord
): CardnewsResult<WorkspaceState> {
  const validation = validateBulkBindingMetadata(metadata);
  if (isCardnewsError(validation)) {
    return validation;
  }

  let workspace = cloneWorkspace(template);
  for (const binding of metadata.bindings) {
    const value = row.values[binding.key] ?? binding.defaultValue ?? "";
    const next = applyBinding(workspace, binding.target, value);
    if (isCardnewsError(next)) {
      return next;
    }
    workspace = next;
  }

  return workspace;
}

export function escapeTemplateBulkCsvValue(value: string): string {
  return escapeCsvValue(value);
}

function validateBinding(binding: BulkBinding): CardnewsResult<true> {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(binding.key)) {
    return invalidInput(`invalid binding key: ${binding.key}`);
  }

  if (TEMPLATE_BULK_V2_RESERVED_COLUMNS.includes(binding.key as (typeof TEMPLATE_BULK_V2_RESERVED_COLUMNS)[number])) {
    return invalidInput(`binding key is reserved: ${binding.key}`);
  }

  if (binding.label.trim().length === 0) {
    return invalidInput(`binding label is required: ${binding.key}`);
  }

  return validateTarget(binding.target);
}

function validateTarget(target: BulkBindingTarget): CardnewsResult<true> {
  switch (target.kind) {
    case "deck":
      return target.field === "header" || target.field === "footer"
        ? true
        : invalidInput("invalid deck binding field.");
    case "standard":
      if (!Number.isInteger(target.cardNumber) || target.cardNumber < 1) {
        return invalidInput("standard binding cardNumber must be 1-based.");
      }
      return true;
    case "layer-text":
      if (!Number.isInteger(target.cardNumber) || target.cardNumber < 1) {
        return invalidInput("layer-text binding cardNumber must be 1-based.");
      }
      if (target.layerId.trim().length === 0) {
        return invalidInput("layer-text binding layerId is required.");
      }
      return target.property === "text" ? true : invalidInput("layer-text binding property must be text.");
  }
}

function validateHeaders(headers: readonly string[], metadata: BulkBindingMetadata): CardnewsResult<true> {
  if (headers.length > TEMPLATE_BULK_V2_LIMITS.maxColumns) {
    return invalidInput(`CSV columns exceed limit: ${TEMPLATE_BULK_V2_LIMITS.maxColumns}`);
  }

  const expectedHeaders = [...TEMPLATE_BULK_V2_RESERVED_COLUMNS, ...metadata.bindings.map((binding) => binding.key)];
  if (headers.length !== expectedHeaders.length) {
    return invalidInput(`CSV header count must be ${expectedHeaders.length}.`);
  }

  for (const [index, expectedHeader] of expectedHeaders.entries()) {
    if (headers[index] !== expectedHeader) {
      return invalidInput(`CSV header ${index + 1} must be ${expectedHeader}.`);
    }
  }

  const duplicateHeaders = findDuplicates(headers);
  if (duplicateHeaders.length > 0) {
    return invalidInput(`duplicate CSV columns: ${duplicateHeaders.join(", ")}`);
  }

  return true;
}

function validateReservedRecord(
  record: Readonly<Record<string, string>>,
  metadata: BulkBindingMetadata,
  rowNumber: number
): CardnewsResult<true> {
  if (record["__schema"] !== TEMPLATE_BULK_V2_SCHEMA) {
    return invalidInput(`row ${rowNumber}: unsupported schema: ${record["__schema"] ?? ""}`);
  }
  if (record["__template_id"] !== metadata.templateId) {
    return invalidInput(`row ${rowNumber}: template id mismatch.`);
  }
  if (Number(record["__template_revision"]) !== metadata.templateRevision) {
    return invalidInput(`row ${rowNumber}: template revision mismatch.`);
  }

  return validateOutputName(record["output_name"] ?? "", rowNumber);
}

function validateCells(cells: readonly string[], rowNumber: number): CardnewsResult<true> {
  for (const [index, cell] of cells.entries()) {
    if (cell.length > TEMPLATE_BULK_V2_LIMITS.maxCellCharacters) {
      return invalidInput(`row ${rowNumber}, column ${index + 1}: cell exceeds character limit.`);
    }
    if (utf8ByteLength(cell) > TEMPLATE_BULK_V2_LIMITS.maxCellUtf8Bytes) {
      return invalidInput(`row ${rowNumber}, column ${index + 1}: cell exceeds UTF-8 byte limit.`);
    }
  }
  return true;
}

function validateOutputName(outputName: string, rowNumber: number): CardnewsResult<true> {
  if (outputName.trim().length === 0) {
    return invalidInput(`row ${rowNumber}: output_name is empty.`);
  }
  if (outputName.length > TEMPLATE_BULK_V2_LIMITS.maxOutputNameCharacters) {
    return invalidInput(`row ${rowNumber}: output_name exceeds ${TEMPLATE_BULK_V2_LIMITS.maxOutputNameCharacters} characters.`);
  }
  if (/[\\/\u0000-\u001f]/.test(outputName) || outputName.includes("..")) {
    return invalidInput(`row ${rowNumber}: output_name contains an unsafe path segment.`);
  }
  if (/^[=+\-@\t\r]/.test(outputName)) {
    return invalidInput(`row ${rowNumber}: output_name cannot start with a formula prefix.`);
  }

  const baseName = outputName.split(".")[0]?.toUpperCase() ?? "";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName)) {
    return invalidInput(`row ${rowNumber}: output_name uses a Windows reserved name.`);
  }

  return true;
}

function applyBinding(
  workspace: WorkspaceState,
  target: BulkBindingTarget,
  value: string
): CardnewsResult<WorkspaceState> {
  switch (target.kind) {
    case "deck":
      return target.field === "header"
        ? { ...workspace, headerLabel: value }
        : { ...workspace, footerAccount: value };
    case "standard":
      return applyStandardBinding(workspace, target.cardNumber, target.field, value);
    case "layer-text":
      return applyLayerTextBinding(workspace, target.cardNumber, target.layerId, value);
  }
}

function applyStandardBinding(
  workspace: WorkspaceState,
  cardNumber: number,
  field: StandardTextField,
  value: string
): CardnewsResult<WorkspaceState> {
  const cardIndex = cardNumber - 1;
  if (cardIndex < 0 || cardIndex >= workspace.cards.length) {
    return invalidInput(`standard binding card is out of range: ${cardNumber}`);
  }

  const cards = [...workspace.cards];
  cards[cardIndex] = replaceStandardField(cards[cardIndex] ?? "", field, value);
  return { ...workspace, cards };
}

function applyLayerTextBinding(
  workspace: WorkspaceState,
  cardNumber: number,
  layerId: string,
  value: string
): CardnewsResult<WorkspaceState> {
  const overrideKey = String(cardNumber);
  const override = workspace.overrides?.[overrideKey];
  const layers = override?.layers;
  if (!layers) {
    return invalidInput(`layer binding card has no layers: ${cardNumber}`);
  }

  let found = false;
  const nextLayers = layers.map((layer): CardLayer => {
    if (layer.id !== layerId) {
      return layer;
    }
    if (layer.kind !== "text") {
      return layer;
    }
    found = true;
    return { ...layer, text: value };
  });

  if (!found) {
    return invalidInput(`text layer binding target not found: ${cardNumber}/${layerId}`);
  }

  return {
    ...workspace,
    overrides: {
      ...workspace.overrides,
      [overrideKey]: {
        ...override,
        layers: nextLayers
      }
    }
  };
}

function replaceStandardField(
  rawCard: string,
  field: StandardTextField,
  value: string
): string {
  if (field === "bullets") {
    return replaceLabelBlock(rawCard, "bullets", value);
  }

  return replaceLabelBlock(rawCard, field, value);
}

function replaceLabelBlock(rawCard: string, field: StandardTextField, value: string): string {
  const lines = rawCard.replace(/\r\n/g, "\n").split("\n");
  const labels = standardLabelsFor(field);
  const nextBlock = buildStandardBlock(field, value);
  const result: string[] = [];
  let replaced = false;
  let skipContinuation = false;

  for (const line of lines) {
    if (isAnyStandardLabel(line)) {
      skipContinuation = false;
    }

    if (labels.some((label) => line.startsWith(label))) {
      if (nextBlock.length > 0) {
        result.push(...nextBlock);
      }
      replaced = true;
      skipContinuation = field !== "bullets";
      continue;
    }

    if (field === "bullets" && isBulletLine(line)) {
      if (!replaced && nextBlock.length > 0) {
        result.push(...nextBlock);
      }
      replaced = true;
      continue;
    }

    if (skipContinuation && field === "body" && isBulletLine(line)) {
      result.push(line);
      continue;
    }

    if (skipContinuation) {
      continue;
    }

    result.push(line);
  }

  if (!replaced && nextBlock.length > 0) {
    result.push(...nextBlock);
  }

  return result.filter((line, index, all) => line.length > 0 || index < all.length - 1).join("\n");
}

type StandardTextField = Extract<BulkBindingTarget, { readonly kind: "standard" }>["field"];

function standardLabelsFor(field: StandardTextField): readonly string[] {
  switch (field) {
    case "badge":
      return ["배지:"];
    case "title":
      return ["제목:"];
    case "subtitle":
      return ["소제목:"];
    case "body":
      return ["본문:"];
    case "source":
      return ["출처:"];
    case "emphasis":
      return ["강조:"];
    case "bullets":
      return [];
  }
}

function buildStandardBlock(field: StandardTextField, value: string): readonly string[] {
  if (value.length === 0) {
    return [];
  }

  if (field === "bullets") {
    return value
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => `- ${encodeLabelValue(line)}`);
  }

  const [firstLine = "", ...continuation] = value.replace(/\r\n/g, "\n").split("\n");
  const label = standardLabelsFor(field)[0] ?? "";
  return [`${label} ${encodeLabelValue(firstLine)}`, ...continuation.map(encodeLabelValue)];
}

function isAnyStandardLabel(line: string): boolean {
  return ["유형:", "배지:", "제목:", "소제목:", "본문:", "출처:", "강조:"].some((label) => line.startsWith(label));
}

function isBulletLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ");
}

function sampleValueForBinding(binding: BulkBinding): string {
  if (binding.defaultValue !== undefined) {
    return binding.defaultValue;
  }

  switch (binding.target.kind) {
    case "deck":
      return binding.target.field === "header" ? "MONEY NOTE" : "@kkongdon_story";
    case "standard":
      return sampleStandardValue(binding.target.field);
    case "layer-text":
      return `sample ${binding.label}`;
  }
}

function sampleStandardValue(field: StandardTextField): string {
  switch (field) {
    case "badge":
      return "MONEY NOTE";
    case "title":
      return "돈 이야기를 다시 배우는 이유";
    case "subtitle":
      return "숫자보다 먼저 보는 관점";
    case "body":
      return "매달 남는 돈보다 반복되는 지출 구조를 먼저 봅니다.";
    case "bullets":
      return "고정비\n변동비";
    case "source":
      return "출처";
    case "emphasis":
      return "핵심 문장";
  }
}

function cloneWorkspace(template: WorkspaceState): WorkspaceState {
  return {
    ...template,
    cards: [...template.cards],
    ...(template.overrides
      ? {
          overrides: Object.fromEntries(
            Object.entries(template.overrides).map(([key, override]) => [
              key,
              {
                ...override,
                ...(override.layers ? { layers: override.layers.map((layer) => ({ ...layer })) } : {})
              }
            ])
          )
        }
      : {})
  };
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
  const safeValue = escapeFormulaPrefix(value);
  if (!/[",\r\n]/.test(safeValue)) {
    return safeValue;
  }

  return `"${safeValue.replaceAll("\"", "\"\"")}"`;
}

function escapeFormulaPrefix(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function encodeLabelValue(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "|");
}

function findDuplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}
