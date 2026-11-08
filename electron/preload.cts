import electron = require("electron");
import type { CardnewsApi } from "../src/domain/cardnews-api.js";
import type { MediaKind, Mp4ExportInput, Mp4ExportProgress } from "../src/domain/cardnews-api.js";
import type {
  AppSettings,
  AiChatMessage,
  AiProviderId,
  DeckDraft,
  DeckPreset,
  LocalImageRef,
  StockImageDownloadInput,
  StylePresetRecord,
  StyleProfile,
  WorkspaceState
} from "../src/domain/types.js";

const { contextBridge, ipcRenderer } = electron;

const api: CardnewsApi = {
  getEdition: () => ipcRenderer.invoke("cardnews:getEdition"),
  requestLockedFeature: (featureCode: string) => ipcRenderer.invoke("cardnews:requestLockedFeature", featureCode),
  chooseStyleReferenceImages: () => ipcRenderer.invoke("cardnews:chooseStyleReferenceImages"),
  loadDeck: () => ipcRenderer.invoke("cardnews:loadDeck"),
  saveDeck: (input: DeckDraft) => ipcRenderer.invoke("cardnews:saveDeck", input),
  parseCard: (rawText: string, index: number) => ipcRenderer.invoke("cardnews:parseCard", rawText, index),
  extractStyle: (imageRefs: readonly LocalImageRef[]) => ipcRenderer.invoke("cardnews:extractStyle", imageRefs),
  approveStyle: (profile: StyleProfile) => ipcRenderer.invoke("cardnews:approveStyle", profile),
  renderDeck: (deckId: string) => ipcRenderer.invoke("cardnews:renderDeck", deckId),
  openOutputFolder: (jobId: string) => ipcRenderer.invoke("cardnews:openOutputFolder", jobId),
  getBackgroundPreview: (backgroundId: string) =>
    ipcRenderer.invoke("cardnews:getBackgroundPreview", backgroundId),
  getFontData: (fontId?: string | null) => ipcRenderer.invoke("cardnews:getFontData", fontId),
  listFontLibrary: () => ipcRenderer.invoke("cardnews:listFontLibrary"),
  importFontToLibrary: () => ipcRenderer.invoke("cardnews:importFontToLibrary"),
  importDeckDocument: () => ipcRenderer.invoke("cardnews:importDeckDocument"),
  importBulkCsvFile: () => ipcRenderer.invoke("cardnews:importBulkCsvFile"),
  exportBulkCsvTemplate: (content: string) => ipcRenderer.invoke("cardnews:exportBulkCsvTemplate", content),
  renderBulkCsv: (csvText: string) => ipcRenderer.invoke("cardnews:renderBulkCsv", csvText),
  renderTemplateBulkCsv: (csvText: string, workspace: unknown, metadata: unknown) =>
    ipcRenderer.invoke("cardnews:renderTemplateBulkCsv", csvText, workspace, metadata),
  importCustomStyleFile: () => ipcRenderer.invoke("cardnews:importCustomStyleFile"),
  exportTemplateFile: (content: string) => ipcRenderer.invoke("cardnews:exportTemplateFile", content),
  listBackgroundLibrary: () => ipcRenderer.invoke("cardnews:listBackgroundLibrary"),
  addBackgroundToLibrary: () => ipcRenderer.invoke("cardnews:addBackgroundToLibrary"),
  removeBackgroundFromLibrary: (backgroundId: string) =>
    ipcRenderer.invoke("cardnews:removeBackgroundFromLibrary", backgroundId),
  listImageLibrary: () => ipcRenderer.invoke("cardnews:listImageLibrary"),
  addImageToLibrary: () => ipcRenderer.invoke("cardnews:addImageToLibrary"),
  getImagePreview: (imageId: string) => ipcRenderer.invoke("cardnews:getImagePreview", imageId),
  removeImageFromLibrary: (imageId: string) => ipcRenderer.invoke("cardnews:removeImageFromLibrary", imageId),
  importMediaAsset: (kind?: MediaKind) => ipcRenderer.invoke("cardnews:media:import", kind),
  listMediaCatalog: () => ipcRenderer.invoke("cardnews:media:list"),
  getMediaPreview: (mediaId: string) => ipcRenderer.invoke("cardnews:media:preview", mediaId),
  listMediaUsage: (mediaId: string) => ipcRenderer.invoke("cardnews:media:usage", mediaId),
  deleteMediaAsset: (mediaId: string) => ipcRenderer.invoke("cardnews:media:delete", mediaId),
  exportVideoMp4: (input: Mp4ExportInput) => ipcRenderer.invoke("cardnews:video:export", input),
  cancelVideoExport: (jobId: string) => ipcRenderer.invoke("cardnews:video:cancel", jobId),
  onVideoExportProgress: (handler: (progress: Mp4ExportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Mp4ExportProgress) => handler(progress);
    ipcRenderer.on("cardnews:video:progress", listener);
    return () => ipcRenderer.removeListener("cardnews:video:progress", listener);
  },
  importTemplatePack: () => ipcRenderer.invoke("cardnews:importTemplatePack"),
  removeImageBackground: (imageId: string, tolerance: number) =>
    ipcRenderer.invoke("cardnews:removeImageBackground", imageId, tolerance),
  listAiProviders: (forceRefresh?: boolean) => ipcRenderer.invoke("cardnews:ai:listProviders", forceRefresh),
  installAiProvider: (providerId: AiProviderId, recipeId: string) =>
    ipcRenderer.invoke("cardnews:ai:install", providerId, recipeId),
  runAiChat: (providerId: AiProviderId, messages: readonly AiChatMessage[]) =>
    ipcRenderer.invoke("cardnews:ai:chat", providerId, messages),
  searchStockImages: (query: string, page: number) =>
    ipcRenderer.invoke("cardnews:searchStockImages", query, page),
  downloadStockImage: (input: StockImageDownloadInput) =>
    ipcRenderer.invoke("cardnews:downloadStockImage", input),
  loadSettings: () => ipcRenderer.invoke("cardnews:loadSettings"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("cardnews:saveSettings", settings),
  listCustomStyles: () => ipcRenderer.invoke("cardnews:listCustomStyles"),
  saveCustomStyle: (style: StylePresetRecord) => ipcRenderer.invoke("cardnews:saveCustomStyle", style),
  deleteCustomStyle: (styleId: string) => ipcRenderer.invoke("cardnews:deleteCustomStyle", styleId),
  listDeckPresets: () => ipcRenderer.invoke("cardnews:listDeckPresets"),
  saveDeckPreset: (preset: DeckPreset) => ipcRenderer.invoke("cardnews:saveDeckPreset", preset),
  deleteDeckPreset: (name: string) => ipcRenderer.invoke("cardnews:deleteDeckPreset", name),
  saveWorkspace: (state: WorkspaceState) => ipcRenderer.invoke("cardnews:saveWorkspace", state),
  loadWorkspace: () => ipcRenderer.invoke("cardnews:loadWorkspace"),
  exportCardPng: (jobId: string, fileName: string) =>
    ipcRenderer.invoke("cardnews:exportCardPng", jobId, fileName),
  exportDeckZip: (jobId: string) => ipcRenderer.invoke("cardnews:exportDeckZip", jobId),
  exportProject: () => ipcRenderer.invoke("cardnews:exportProject"),
  importProject: () => ipcRenderer.invoke("cardnews:importProject"),
  openExternalLink: (url: string) => ipcRenderer.invoke("cardnews:openExternalLink", url)
};

contextBridge.exposeInMainWorld("cardnews", api);
