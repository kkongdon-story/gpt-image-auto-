import type { ReactElement, ReactNode } from "react";
import type {
  AiChatMessage,
  AiChatResult,
  AiProviderId,
  AiProviderStatus,
  BulkBindingMetadata,
  BulkRenderResult,
  CardnewsResult,
  ImageLibraryItem,
  ProjectArchiveResult,
  ProjectImportResult,
  WorkspaceState
} from "../../domain/types";
import { buildBulkCsvTemplate } from "../../domain/csvBulk";
import { buildTemplateBulkSampleCsv } from "../../domain/templateBulkBindings";
import {
  buildDraftPrompt,
  buildMockDraftDocument,
  buildResearchPrompt,
  buildTopicPrompt,
  extractTemplateDocument
} from "./ai/aiPrompts";

export const editionKind = "pro" as const;
export const editionProductName = "Cardnews Studio Pro";
export const hasProTools = true;

export {
  buildDraftPrompt,
  buildMockDraftDocument,
  buildResearchPrompt,
  buildTopicPrompt,
  extractTemplateDocument
};

export function FeatureLock(_props: {
  readonly featureCode: string;
  readonly title: string;
  readonly children?: ReactNode;
  readonly onRequest: (featureCode: string) => void;
  readonly onOpenThreads: () => void;
  readonly onOpenKakao: () => void;
}): ReactElement | null {
  return null;
}

export function listEditionImages(): Promise<CardnewsResult<readonly ImageLibraryItem[]>> {
  return window.cardnews.listImageLibrary();
}

export function addEditionImage(): Promise<CardnewsResult<ImageLibraryItem>> {
  return window.cardnews.addImageToLibrary();
}

export function getEditionImagePreview(imageId: string): Promise<CardnewsResult<string>> {
  return window.cardnews.getImagePreview(imageId);
}

export function removeEditionImage(imageId: string): Promise<
  CardnewsResult<{ readonly id: string; readonly removed: boolean }>
> {
  return window.cardnews.removeImageFromLibrary(imageId);
}

export function removeEditionImageBackdrop(
  imageId: string,
  tolerance: number
): Promise<CardnewsResult<ImageLibraryItem>> {
  return window.cardnews.removeImageBackground(imageId, tolerance);
}

export function loadEditionBulkInput(): Promise<CardnewsResult<{ readonly fileName: string; readonly text: string }>> {
  return window.cardnews.importBulkCsvFile();
}

export function saveEditionBulkTemplate(
  styleId: string,
  aspectRatioId: string,
  metadata?: BulkBindingMetadata
): Promise<CardnewsResult<string>> {
  if (metadata) {
    const csv = buildTemplateBulkSampleCsv(metadata);
    return typeof csv === "string" ? window.cardnews.exportBulkCsvTemplate(csv) : Promise.resolve(csv);
  }
  return window.cardnews.exportBulkCsvTemplate(buildBulkCsvTemplate(styleId, aspectRatioId));
}

export function runEditionBulkRender(
  csvText: string,
  workspace?: WorkspaceState,
  metadata?: BulkBindingMetadata
): Promise<CardnewsResult<BulkRenderResult>> {
  if (workspace && metadata) return window.cardnews.renderTemplateBulkCsv(csvText, workspace, metadata);
  return window.cardnews.renderBulkCsv(csvText);
}

export function saveEditionProject(): Promise<CardnewsResult<ProjectArchiveResult>> {
  return window.cardnews.exportProject();
}

export function loadEditionProject(): Promise<CardnewsResult<ProjectImportResult>> {
  return window.cardnews.importProject();
}

export function listEditionAiProviders(forceRefresh = false): Promise<CardnewsResult<readonly AiProviderStatus[]>> {
  return window.cardnews.listAiProviders(forceRefresh);
}

export function runEditionAi(
  providerId: AiProviderId,
  messages: readonly AiChatMessage[]
): Promise<CardnewsResult<AiChatResult>> {
  return window.cardnews.runAiChat(providerId, messages);
}
