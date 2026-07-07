import type { Card, CardType, CardnewsError, CardnewsResult } from "./types.js";

type CardLabel = "type" | "title" | "subtitle" | "badge" | "body" | "source" | "emphasis";

type LabelDefinition = {
  readonly prefix: string;
  readonly label: CardLabel;
};

type ParsedLabel = {
  readonly label: CardLabel;
  readonly value: string;
};

type CardDraftParts = {
  readonly bodyLines: string[];
  currentLabel?: CardLabel;
  typeValue?: string;
  title?: string;
  subtitle?: string;
  badge?: string;
  source?: string;
  emphasis?: string;
};

type BodyContent = {
  readonly paragraphs: readonly string[];
  readonly bullets: readonly string[];
};

const labelDefinitions: readonly LabelDefinition[] = [
  { prefix: "유형:", label: "type" },
  { prefix: "제목:", label: "title" },
  { prefix: "소제목:", label: "subtitle" },
  { prefix: "배지:", label: "badge" },
  { prefix: "본문:", label: "body" },
  { prefix: "출처:", label: "source" },
  { prefix: "강조:", label: "emphasis" }
];

export function parseCardText(rawText: string, index = 1): CardnewsResult<Card> {
  if (!Number.isInteger(index) || index < 1) {
    return invalidInput("카드 번호는 1 이상의 정수여야 합니다.");
  }

  const lines = normalizeLines(rawText);
  if (lines.length === 0) {
    return invalidInput("카드 내용이 비어 있습니다.");
  }

  const parts = collectCardParts(lines);
  const title = cleanText(parts.title);
  if (!title) {
    return invalidInput("카드 제목이 필요합니다.");
  }

  const typeResult = parseCardType(parts.typeValue);
  if (isCardnewsError(typeResult)) {
    return typeResult;
  }

  const body = parseBodyContent(parts.bodyLines);
  return buildCard({
    badge: cleanText(parts.badge),
    body,
    emphasis: cleanText(parts.emphasis),
    index,
    source: cleanText(parts.source),
    subtitle: cleanText(parts.subtitle),
    title,
    type: typeResult
  });
}

function collectCardParts(lines: readonly string[]): CardDraftParts {
  const parts: CardDraftParts = { bodyLines: [] };

  for (const line of lines) {
    const parsedLabel = parseLabel(line);
    if (parsedLabel) {
      applyLabel(parts, parsedLabel);
      continue;
    }

    appendContinuation(parts, line);
  }

  return parts;
}

function parseLabel(line: string): ParsedLabel | undefined {
  for (const definition of labelDefinitions) {
    if (line.startsWith(definition.prefix)) {
      return {
        label: definition.label,
        value: line.slice(definition.prefix.length).trim()
      };
    }
  }

  return undefined;
}

function applyLabel(parts: CardDraftParts, parsedLabel: ParsedLabel): void {
  parts.currentLabel = parsedLabel.label;

  switch (parsedLabel.label) {
    case "type":
      parts.typeValue = parsedLabel.value;
      return;
    case "title":
      parts.title = parsedLabel.value;
      return;
    case "subtitle":
      parts.subtitle = parsedLabel.value;
      return;
    case "badge":
      parts.badge = parsedLabel.value;
      return;
    case "body":
      if (parsedLabel.value.length > 0) {
        parts.bodyLines.push(parsedLabel.value);
      }
      return;
    case "source":
      parts.source = parsedLabel.value;
      return;
    case "emphasis":
      parts.emphasis = parsedLabel.value;
      return;
  }
}

function appendContinuation(parts: CardDraftParts, line: string): void {
  switch (parts.currentLabel) {
    case "body":
      parts.bodyLines.push(line);
      return;
    case "title":
      parts.title = appendText(parts.title, line);
      return;
    case "subtitle":
      parts.subtitle = appendText(parts.subtitle, line);
      return;
    case "badge":
      parts.badge = appendText(parts.badge, line);
      return;
    case "source":
      parts.source = appendText(parts.source, line);
      return;
    case "emphasis":
      parts.emphasis = appendText(parts.emphasis, line);
      return;
    case "type":
    case undefined:
      parts.bodyLines.push(line);
      return;
  }
}

function parseCardType(typeValue: string | undefined): CardnewsResult<CardType> {
  const normalized = cleanText(typeValue)?.toLowerCase();
  if (!normalized) {
    return "body";
  }

  switch (normalized) {
    case "표지":
    case "cover":
      return "cover";
    case "본문":
    case "body":
      return "body";
    case "마무리":
    case "cta":
      return "cta";
    default:
      return invalidInput(`지원하지 않는 카드 유형입니다: ${typeValue}`);
  }
}

function parseBodyContent(bodyLines: readonly string[]): BodyContent {
  const paragraphs: string[] = [];
  const bullets: string[] = [];

  for (const line of bodyLines) {
    const cleanLine = cleanText(line);
    if (!cleanLine) {
      continue;
    }

    const bullet = parseBullet(cleanLine);
    if (bullet) {
      bullets.push(bullet);
      continue;
    }

    paragraphs.push(cleanLine);
  }

  return { paragraphs, bullets };
}

function parseBullet(line: string): string | undefined {
  const firstCharacter = line[0];
  if (firstCharacter !== "-" && firstCharacter !== "*" && firstCharacter !== "•") {
    return undefined;
  }

  // "*단어*" 강조 문법과의 충돌 방지: "*"는 뒤에 공백이 올 때만 불릿으로 취급한다.
  if (firstCharacter === "*" && line[1] !== " " && line[1] !== "\t") {
    return undefined;
  }

  const bullet = line.slice(1).trim();
  return bullet.length > 0 ? bullet : undefined;
}

function buildCard(input: {
  readonly badge: string | undefined;
  readonly body: BodyContent;
  readonly emphasis: string | undefined;
  readonly index: number;
  readonly source: string | undefined;
  readonly subtitle: string | undefined;
  readonly title: string;
  readonly type: CardType;
}): Card {
  return {
    index: input.index,
    type: input.type,
    title: input.title,
    ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    ...(input.badge ? { badge: input.badge } : {}),
    paragraphs: input.body.paragraphs,
    bullets: input.body.bullets,
    ...(input.source ? { source: input.source } : {}),
    ...(input.emphasis ? { emphasis: input.emphasis } : {})
  };
}

function normalizeLines(rawText: string): readonly string[] {
  return rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function appendText(current: string | undefined, next: string): string {
  const currentText = cleanText(current);
  const nextText = cleanText(next);

  if (!currentText) {
    return nextText ?? "";
  }

  if (!nextText) {
    return currentText;
  }

  return `${currentText} ${nextText}`;
}

function cleanText(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}
