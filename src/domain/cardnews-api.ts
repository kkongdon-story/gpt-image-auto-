import type {
  AppSettings,
  AiChatMessage,
  AiChatResult,
  AiProviderId,
  AiProviderInstallResult,
  AiProviderStatus,
  BackgroundLibraryItem,
  BulkBindingMetadata,
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
  ImageLibraryRemoveResult,
  LocalImageRef,
  ProjectArchiveResult,
  ProjectImportResult,
  RenderJobResult,
  StockImageDownloadInput,
  StockImageSearchResult,
  StyleExtractionDraft,
  StylePresetRecord,
  StyleProfile,
  TemplatePackImportResult,
  WorkspaceState
} from "./types.js";
import type { VideoExportStage } from "./videoExport.js";

export type CardnewsEdition = "lite" | "pro";

export type EditionInfo = {
  readonly edition: CardnewsEdition;
  readonly productName: string;
};

export type MediaCatalogErrorCode =
  | "invalid_input"
  | "unsupported_media"
  | "corrupt_media"
  | "media_too_large"
  | "storage_failed"
  | "not_found"
  | "asset_in_use";

export type MediaCatalogError = {
  readonly ok: false;
  readonly code: MediaCatalogErrorCode;
  readonly message: string;
  readonly usages?: readonly MediaUsageRef[];
};

export type MediaKind = "image" | "video";

export type MediaCatalogAsset = {
  readonly id: string;
  readonly kind: MediaKind;
  readonly displayName: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs?: number;
  readonly hasAudio?: boolean;
  readonly posterRelativePath?: string;
  readonly importedAt?: string;
};

export type MediaUsageRef = {
  readonly workspaceId?: string;
  readonly cardIndex?: number;
  readonly layerId?: string;
  readonly role: "global-background" | "card-background" | "image-layer" | "video-layer" | "archive-draft";
};

export type MediaCatalogDeleteResult = {
  readonly ok: true;
  readonly deleted: boolean;
  readonly id: string;
  readonly usages: readonly MediaUsageRef[];
  readonly removedPaths: readonly string[];
};

export type MediaCatalogResult<T> = T | MediaCatalogError;

export type Mp4ExportInput = {
  readonly workspace: WorkspaceState;
  readonly overwrite?: boolean;
  readonly totalFrames?: number;
};

export type Mp4ExportProgress = {
  readonly jobId: string;
  readonly stage: VideoExportStage;
  readonly percent: number;
  readonly completedFrames?: number;
  readonly totalFrames?: number;
  readonly message?: string;
  readonly elapsedMs?: number;
};

export type Mp4ExportResult = {
  readonly ok: true;
  readonly jobId: string;
  readonly filePath: string;
  readonly framesWritten: number;
};

export type Mp4ExportErrorCode =
  | "invalid_input"
  | "invalid_output_path"
  | "output_exists"
  | "preflight_failed"
  | "stage_timeout"
  | "cancelled"
  | "encoder_failed"
  | "disk_full"
  | "permission_denied"
  | "corrupt_source";

export type Mp4ExportError = {
  readonly ok: false;
  readonly code: Mp4ExportErrorCode;
  readonly message: string;
  readonly jobId?: string;
};

export type Mp4ExportApiResult = Mp4ExportResult | Mp4ExportError;

export type LiteCardnewsApi = {
  readonly getEdition: () => Promise<CardnewsResult<EditionInfo>>;
  readonly requestLockedFeature: (featureCode: string) => Promise<CardnewsResult<void>>;
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
  readonly importCustomStyleFile: () => Promise<CardnewsResult<ImportedDocument>>;
  readonly exportTemplateFile: (content: string) => Promise<CardnewsResult<string>>;
  readonly listBackgroundLibrary: () => Promise<CardnewsResult<readonly BackgroundLibraryItem[]>>;
  readonly addBackgroundToLibrary: () => Promise<CardnewsResult<BackgroundLibraryItem>>;
  readonly removeBackgroundFromLibrary: (backgroundId: string) => Promise<CardnewsResult<ImageLibraryRemoveResult>>;
  readonly searchStockImages: (query: string, page: number) => Promise<CardnewsResult<StockImageSearchResult>>;
  readonly downloadStockImage: (input: StockImageDownloadInput) => Promise<CardnewsResult<BackgroundLibraryItem>>;
  readonly listImageLibrary: () => Promise<CardnewsResult<readonly ImageLibraryItem[]>>;
  readonly addImageToLibrary: () => Promise<CardnewsResult<ImageLibraryItem>>;
  readonly getImagePreview: (imageId: string) => Promise<CardnewsResult<string>>;
  readonly removeImageFromLibrary: (imageId: string) => Promise<CardnewsResult<ImageLibraryRemoveResult>>;
  readonly importMediaAsset: (kind?: MediaKind) => Promise<MediaCatalogResult<MediaCatalogAsset>>;
  readonly listMediaCatalog: () => Promise<MediaCatalogResult<readonly MediaCatalogAsset[]>>;
  readonly getMediaPreview: (mediaId: string) => Promise<MediaCatalogResult<string>>;
  readonly listMediaUsage: (mediaId: string) => Promise<MediaCatalogResult<readonly MediaUsageRef[]>>;
  readonly deleteMediaAsset: (mediaId: string) => Promise<MediaCatalogResult<MediaCatalogDeleteResult>>;
  readonly exportVideoMp4: (input: Mp4ExportInput) => Promise<Mp4ExportApiResult>;
  readonly cancelVideoExport: (jobId: string) => Promise<Mp4ExportError | { readonly ok: true; readonly jobId: string }>;
  readonly onVideoExportProgress: (handler: (progress: Mp4ExportProgress) => void) => () => void;
  readonly importTemplatePack: () => Promise<CardnewsResult<TemplatePackImportResult>>;
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
  readonly openExternalLink: (url: string) => Promise<CardnewsResult<void>>;
};

export type ProCardnewsApi = LiteCardnewsApi & {
  readonly importBulkCsvFile: () => Promise<CardnewsResult<ImportedDocument>>;
  readonly exportBulkCsvTemplate: (content: string) => Promise<CardnewsResult<string>>;
  readonly renderBulkCsv: (csvText: string) => Promise<CardnewsResult<BulkRenderResult>>;
  readonly renderTemplateBulkCsv: (
    csvText: string,
    workspace: WorkspaceState,
    metadata: BulkBindingMetadata
  ) => Promise<CardnewsResult<BulkRenderResult>>;
  readonly removeImageBackground: (imageId: string, tolerance: number) => Promise<CardnewsResult<ImageLibraryItem>>;
  readonly exportProject: () => Promise<CardnewsResult<ProjectArchiveResult>>;
  readonly importProject: () => Promise<CardnewsResult<ProjectImportResult>>;
  readonly listAiProviders: (forceRefresh?: boolean) => Promise<CardnewsResult<readonly AiProviderStatus[]>>;
  readonly installAiProvider: (
    providerId: AiProviderId,
    recipeId: string
  ) => Promise<AiProviderInstallResult>;
  readonly runAiChat: (
    providerId: AiProviderId,
    messages: readonly AiChatMessage[]
  ) => Promise<CardnewsResult<AiChatResult>>;
};

export type CardnewsApi = ProCardnewsApi;
