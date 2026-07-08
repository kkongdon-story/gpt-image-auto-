import type {
  AppSettings,
  BackgroundLibraryItem,
  BulkRenderResult,
  Card,
  CardnewsResult,
  Deck,
  DeckDraft,
  DeckPreset,
  FontData,
  FontLibraryItem,
  ImportedDocument,
  ImageLibraryItem,
  LocalImageRef,
  ProjectArchiveResult,
  ProjectImportResult,
  RenderJobResult,
  StockImageDownloadInput,
  StockImageSearchResult,
  StyleExtractionDraft,
  StylePresetRecord,
  StyleProfile,
  WorkspaceState
} from "./types.js";

export type CardnewsApi = {
  readonly chooseStyleReferenceImages: () => Promise<CardnewsResult<readonly LocalImageRef[]>>;
  readonly loadDeck: () => Promise<CardnewsResult<Deck>>;
  readonly saveDeck: (input: DeckDraft) => Promise<CardnewsResult<Deck>>;
  readonly parseCard: (rawText: string, index: number) => Promise<CardnewsResult<Card>>;
  readonly extractStyle: (imageRefs: readonly LocalImageRef[]) => Promise<CardnewsResult<StyleExtractionDraft>>;
  readonly approveStyle: (profile: StyleProfile) => Promise<CardnewsResult<StyleProfile>>;
  readonly renderDeck: (deckId: string) => Promise<CardnewsResult<RenderJobResult>>;
  readonly openOutputFolder: (jobId: string) => Promise<CardnewsResult<void>>;
  readonly getBackgroundPreview: (backgroundId: string) => Promise<CardnewsResult<string>>;
  readonly getFontData: (fontId?: string | null) => Promise<CardnewsResult<FontData>>;
  readonly listFontLibrary: () => Promise<CardnewsResult<readonly FontLibraryItem[]>>;
  readonly importFontToLibrary: () => Promise<CardnewsResult<FontLibraryItem>>;
  readonly importDeckDocument: () => Promise<CardnewsResult<ImportedDocument>>;
  readonly importBulkCsvFile: () => Promise<CardnewsResult<ImportedDocument>>;
  readonly exportBulkCsvTemplate: (content: string) => Promise<CardnewsResult<string>>;
  readonly renderBulkCsv: (csvText: string) => Promise<CardnewsResult<BulkRenderResult>>;
  readonly importCustomStyleFile: () => Promise<CardnewsResult<ImportedDocument>>;
  readonly exportTemplateFile: (content: string) => Promise<CardnewsResult<string>>;
  readonly listBackgroundLibrary: () => Promise<CardnewsResult<readonly BackgroundLibraryItem[]>>;
  readonly addBackgroundToLibrary: () => Promise<CardnewsResult<BackgroundLibraryItem>>;
  readonly listImageLibrary: () => Promise<CardnewsResult<readonly ImageLibraryItem[]>>;
  readonly addImageToLibrary: () => Promise<CardnewsResult<ImageLibraryItem>>;
  readonly getImagePreview: (imageId: string) => Promise<CardnewsResult<string>>;
  readonly removeImageBackground: (imageId: string, tolerance: number) => Promise<CardnewsResult<ImageLibraryItem>>;
  readonly searchStockImages: (query: string, page: number) => Promise<CardnewsResult<StockImageSearchResult>>;
  readonly downloadStockImage: (input: StockImageDownloadInput) => Promise<CardnewsResult<BackgroundLibraryItem>>;
  readonly loadSettings: () => Promise<CardnewsResult<AppSettings>>;
  readonly saveSettings: (settings: AppSettings) => Promise<CardnewsResult<void>>;
  readonly listCustomStyles: () => Promise<CardnewsResult<readonly StylePresetRecord[]>>;
  readonly saveCustomStyle: (style: StylePresetRecord) => Promise<CardnewsResult<readonly StylePresetRecord[]>>;
  readonly deleteCustomStyle: (styleId: string) => Promise<CardnewsResult<readonly StylePresetRecord[]>>;
  readonly listDeckPresets: () => Promise<CardnewsResult<readonly DeckPreset[]>>;
  readonly saveDeckPreset: (preset: DeckPreset) => Promise<CardnewsResult<readonly DeckPreset[]>>;
  readonly deleteDeckPreset: (name: string) => Promise<CardnewsResult<readonly DeckPreset[]>>;
  readonly saveWorkspace: (state: WorkspaceState) => Promise<CardnewsResult<void>>;
  readonly loadWorkspace: () => Promise<CardnewsResult<WorkspaceState | null>>;
  readonly exportCardPng: (jobId: string, fileName: string) => Promise<CardnewsResult<string>>;
  readonly exportDeckZip: (jobId: string) => Promise<CardnewsResult<string>>;
  readonly exportProject: () => Promise<CardnewsResult<ProjectArchiveResult>>;
  readonly importProject: () => Promise<CardnewsResult<ProjectImportResult>>;
  readonly openExternalLink: (url: string) => Promise<CardnewsResult<void>>;
};
