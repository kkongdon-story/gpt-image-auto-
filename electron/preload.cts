import electron = require("electron");
import type { CardnewsApi } from "../src/domain/cardnews-api.js";
import type {
  AppSettings,
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
  importCustomStyleFile: () => ipcRenderer.invoke("cardnews:importCustomStyleFile"),
  exportTemplateFile: (content: string) => ipcRenderer.invoke("cardnews:exportTemplateFile", content),
  listBackgroundLibrary: () => ipcRenderer.invoke("cardnews:listBackgroundLibrary"),
  addBackgroundToLibrary: () => ipcRenderer.invoke("cardnews:addBackgroundToLibrary"),
  listImageLibrary: () => ipcRenderer.invoke("cardnews:listImageLibrary"),
  addImageToLibrary: () => ipcRenderer.invoke("cardnews:addImageToLibrary"),
  getImagePreview: (imageId: string) => ipcRenderer.invoke("cardnews:getImagePreview", imageId),
  removeImageBackground: (imageId: string, tolerance: number) =>
    ipcRenderer.invoke("cardnews:removeImageBackground", imageId, tolerance),
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
