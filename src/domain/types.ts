export type CardType = "cover" | "body" | "cta";

export type CardnewsErrorCode =
  | "not_implemented"
  | "invalid_input"
  | "render_failed"
  | "gate_failed"
  | "style_extraction_failed"
  | "external_service_failed";

export type CardnewsError = {
  readonly ok: false;
  readonly code: CardnewsErrorCode;
  readonly message: string;
};

export type LocalImageRef = {
  readonly id: string;
  readonly displayName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

export type FontLibraryItem = {
  readonly id: string;
  readonly displayName: string;
  readonly extension: "ttf" | "otf" | "woff2";
};

export type FontData = {
  readonly base64: string;
  readonly cssFamily: string;
  readonly cssFormat: "opentype" | "truetype" | "woff2" | "woff2-variations";
  readonly displayName: string;
  readonly mimeType: string;
};

export type CardDraft = {
  readonly index: number;
  readonly rawText: string;
};

export type DeckDraft = {
  readonly headerLabel: string;
  readonly footerAccount: string;
  readonly cards: readonly CardDraft[];
  readonly chrome?: ChromeConfig;
  readonly styleId?: string;
  readonly accentColor?: string;
  readonly backgroundDim?: number;
  readonly aspectRatio?: string;
  readonly backgroundId?: string;
  readonly fontId?: string;
  readonly nextHint?: NextHintConfig;
  readonly overrides?: CardOverrideMap;
};

export type Card = {
  readonly index: number;
  readonly type: CardType;
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: string;
  readonly paragraphs: readonly string[];
  readonly bullets: readonly string[];
  readonly source?: string;
  readonly emphasis?: string;
  readonly backgroundId?: string;
};

export type CardImageAdjust = {
  readonly brightness: number;
  readonly contrast: number;
  readonly saturation: number;
};

export type CardLayoutOverride = {
  readonly align: "left" | "center";
  readonly offsetY: number;
  readonly gapBadge: number;
  readonly gapSubtitle: number;
};

export type CardTypographyOverride = {
  readonly sizeScale?: number;
  readonly weight?: number;
  readonly italic?: boolean;
  readonly letterSpacing?: number;
  readonly lineHeight?: number;
  readonly scope?: "all" | "title" | "body";
};

export type ChromeSlotStyle = {
  readonly visible: boolean;
  readonly color: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly useDeckFont: boolean;
};

export type ChromePageNumberStyle = ChromeSlotStyle & {
  readonly template: string;
};

export type ChromeConfig = {
  readonly header: ChromeSlotStyle;
  readonly footer: ChromeSlotStyle;
  readonly pageNumber: ChromePageNumberStyle;
};

export type CardLayerBase = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly zIndex?: number;
  readonly opacity?: number;
};

export type CardTextBoxLayer = CardLayerBase & {
  readonly kind: "text";
  readonly text: string;
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly italic?: boolean;
  readonly align?: "left" | "center" | "right";
};

export type CardShapeLayer = CardLayerBase & {
  readonly kind: "shape";
  readonly shape: "rect" | "ellipse";
  readonly fill: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly radius?: number;
};

export type CardLineLayer = {
  readonly id: string;
  readonly kind: "line";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly thickness: number;
  readonly color: string;
  readonly zIndex?: number;
  readonly opacity?: number;
};

export type CardImageLayer = CardLayerBase & {
  readonly kind: "image";
  readonly backgroundId: string;
  readonly objectFit?: "cover" | "contain";
};

export type CardLayer = CardTextBoxLayer | CardShapeLayer | CardLineLayer | CardImageLayer;

export type CardBadgeOverride = {
  readonly shape?: "pill" | "rect" | "none";
  readonly imageId?: string;
  readonly imageHeight?: number;
  readonly textColor?: string;
};

export type NextHintConfig = {
  readonly kind: "arrows" | "image" | "none";
  readonly imageId?: string;
  readonly height?: number;
};

export type CardOverride = {
  readonly backgroundId?: string | null;
  readonly adjust?: CardImageAdjust;
  readonly badge?: CardBadgeOverride;
  readonly layout?: CardLayoutOverride;
  readonly dim?: number;
  readonly typography?: CardTypographyOverride;
  readonly layers?: readonly CardLayer[];
};

export type CardOverrideMap = Readonly<Record<string, CardOverride>>;

export type Deck = {
  readonly id: string;
  readonly headerLabel: string;
  readonly footerAccount: string;
  readonly cards: readonly Card[];
  readonly chrome?: ChromeConfig;
  readonly backgroundImage?: LocalImageRef;
  readonly styleProfile?: StyleProfile;
  readonly styleId?: string;
  readonly accentColor?: string;
  readonly backgroundDim?: number;
  readonly aspectRatio?: string;
  readonly backgroundId?: string;
  readonly fontId?: string;
  readonly nextHint?: NextHintConfig;
  readonly overrides?: CardOverrideMap;
};

export type StyleProfile = {
  readonly id: string;
  readonly name: string;
  readonly palette: readonly string[];
  readonly layoutMood: string;
  readonly fontMood: string;
  readonly approved: boolean;
};

export type StyleExtractionDraft = {
  readonly palette: readonly string[];
  readonly layoutMood: string;
  readonly fontMood: string;
};

export type StylePresetRecord = {
  readonly id: string;
  readonly name: string;
  readonly usesPhoto: boolean;
  readonly pageBackground: string;
  readonly textBackdrop: string;
  readonly chromeBackdrop: string;
  readonly ink: string;
  readonly inkSub: string;
  readonly inkMuted: string;
  readonly accentDefault: string;
  readonly badgeBackground: string;
  readonly badgeInk: string;
  readonly fontTitle: string;
  readonly fontBody: string;
  readonly usesSurface: boolean;
  readonly defaultDim: number;
  readonly numberInk?: string;
  readonly surfaceLadder?: readonly [string, string, string];
  readonly inkScale?: {
    readonly ink: string;
    readonly body: string;
    readonly mute: string;
    readonly faint: string;
  };
  readonly hairline?: string;
  readonly eyebrowStyle?: "pill" | "bar" | "plain";
  readonly titleTracking?: number;
  readonly badgeRadius?: string;
  readonly bulletShape?: "dot" | "square" | "dash";
  readonly scrimStops?: readonly string[];
};

export type QualityGateName =
  | "contrast"
  | "overflow"
  | "overlap"
  | "font_floor"
  | "accent_overuse"
  | "font_variety"
  | "title_line_count"
  | "filter_contrast"
  | "visual_artifact";

export type QualityGateSeverity = "fail" | "warn";

export type QualityGateStatus = "pass" | "warn" | "fail";

export type RenderSlotMetric = {
  readonly backgroundColor: string;
  readonly cardIndex: number;
  readonly color: string;
  readonly fontSize: number;
  readonly height: number;
  readonly left: number;
  readonly slot: string;
  readonly text: string;
  readonly top: number;
  readonly width: number;
};

export type QualityGateIssue = {
  readonly cardIndex: number;
  readonly gate: QualityGateName;
  readonly measured: number;
  readonly message: string;
  readonly required: number;
  readonly severity: QualityGateSeverity;
  readonly slot: string;
};

export type QualityGateReport = {
  readonly status: QualityGateStatus;
  readonly issues: readonly QualityGateIssue[];
};

export type RenderedCard = {
  readonly bytes: number;
  readonly fileName: string;
  readonly gateStatus: QualityGateStatus;
  readonly index: number;
  readonly previewDataUrl: string;
  readonly sha256: string;
};

/** 배경 라이브러리 항목 (userData/library/backgrounds에 누적 저장) */
export type BackgroundLibraryItem = {
  readonly id: string;
  readonly displayName: string;
  readonly attribution?: string;
};

export type ImageLibraryItem = {
  readonly id: string;
  readonly displayName: string;
  readonly attribution?: string;
};

/** 이름 붙여 저장하는 양식 프리셋 — 설정 + 카드 스켈레톤 전체 스냅샷 */
export type DeckPreset = {
  readonly name: string;
  readonly headerLabel: string;
  readonly footerAccount: string;
  readonly chrome?: ChromeConfig;
  readonly styleId: string;
  readonly accentColor?: string;
  readonly backgroundDim?: number;
  readonly backgroundId?: string;
  readonly aspectRatio?: string;
  readonly fontId?: string;
  readonly nextHint?: NextHintConfig;
  readonly overrides?: CardOverrideMap;
  readonly cards: readonly string[];
};

/** 앱 재시작 시 복원되는 작업 상태 */
export type WorkspaceState = {
  readonly headerLabel: string;
  readonly footerAccount: string;
  readonly chrome?: ChromeConfig;
  readonly styleId: string;
  readonly accentColor?: string;
  readonly backgroundDim?: number;
  readonly backgroundId?: string;
  readonly aspectRatio?: string;
  readonly fontId?: string;
  readonly nextHint?: NextHintConfig;
  readonly overrides?: CardOverrideMap;
  readonly railWidth?: number;
  readonly cards: readonly string[];
  readonly selectedIndex?: number;
};

/** 양식.md 파일을 열어 읽은 원문 */
export type ImportedDocument = {
  readonly fileName: string;
  readonly text: string;
};

export type RenderJobResult = {
  readonly cardCount: number;
  readonly cards: readonly RenderedCard[];
  readonly gateReport: QualityGateReport;
  readonly jobId: string;
  readonly outputDir: string;
};

export type BulkCsvParseIssue = {
  readonly rowNumber: number;
  readonly message: string;
};

export type BulkCsvRow = {
  readonly rowNumber: number;
  readonly outputName: string;
  readonly deckDraft: DeckDraft;
};

export type BulkCsvParseResult = {
  readonly rows: readonly BulkCsvRow[];
  readonly issues: readonly BulkCsvParseIssue[];
};

export type BulkRenderRowResult = {
  readonly rowNumber: number;
  readonly outputName: string;
  readonly status: "rendered" | "failed";
  readonly cardCount: number;
  readonly outputDir?: string;
  readonly message?: string;
};

export type BulkRenderResult = {
  readonly failedCount: number;
  readonly jobId: string;
  readonly outputDir: string;
  readonly renderedCount: number;
  readonly rows: readonly BulkRenderRowResult[];
  readonly totalRows: number;
  readonly zipPath: string;
};

export type AiProviderId = "claude" | "codex" | "gemini";

export type AiProviderStatus = {
  readonly id: AiProviderId;
  readonly label: string;
  readonly installed: boolean;
  readonly installHint: string;
  readonly version?: string;
};

export type AiChatRole = "system" | "user" | "assistant";

export type AiChatMessage = {
  readonly role: AiChatRole;
  readonly content: string;
};

export type AiChatResult = {
  readonly providerId: AiProviderId;
  readonly content: string;
};

export type AppSettings = {
  readonly pixabayApiKey?: string;
  readonly aiDefaultProviderId?: AiProviderId;
};

export type ProjectArchiveResult = {
  readonly filePath: string;
  readonly backgroundCount: number;
  readonly fontCount: number;
  readonly presetCount: number;
  readonly styleCount: number;
};

export type ProjectImportResult = ProjectArchiveResult & {
  readonly workspace: WorkspaceState;
};

export type StockImage = {
  readonly id: string;
  readonly provider: "pixabay";
  readonly previewUrl: string;
  readonly imageUrl: string;
  readonly pageUrl: string;
  readonly author: string;
  readonly width: number;
  readonly height: number;
};

export type StockImageSearchResult = {
  readonly mode: "api" | "browser-fallback";
  readonly provider: "pixabay";
  readonly query: string;
  readonly images: readonly StockImage[];
  readonly fallbackUrl?: string;
};

export type StockImageDownloadInput = {
  readonly provider: "pixabay";
  readonly id: string;
  readonly imageUrl: string;
  readonly pageUrl: string;
  readonly author: string;
};

export type CardnewsResult<T> = T | CardnewsError;
