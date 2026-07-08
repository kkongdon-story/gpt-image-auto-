import type { ReactElement, ReactNode } from "react";
import type {
  AiChatMessage,
  AiChatResult,
  AiProviderId,
  AiProviderStatus,
  BulkRenderResult,
  CardnewsError,
  CardnewsResult,
  ImageLibraryItem,
  ProjectArchiveResult,
  ProjectImportResult
} from "../../domain/types";

export const editionKind = "lite" as const;
export const editionProductName = "Cardnews Studio Lite";
export const hasProTools = false;

const lockedMessage = "Pro에서 사용 가능";

function lockedResult(): CardnewsError {
  return {
    ok: false,
    code: "not_implemented",
    message: "이 기능은 Cardnews Studio Pro에서 사용할 수 있습니다."
  };
}

export function FeatureLock({
  featureCode,
  title,
  children,
  onRequest,
  onOpenThreads,
  onOpenKakao
}: {
  readonly featureCode: string;
  readonly title: string;
  readonly children?: ReactNode;
  readonly onRequest: (featureCode: string) => void;
  readonly onOpenThreads: () => void;
  readonly onOpenKakao: () => void;
}): ReactElement {
  return (
    <section className="edition-lock panel" data-smoke-role="edition-lock" data-smoke-feature={featureCode}>
      <p className="panel-title">🔒 {title}</p>
      <strong>{lockedMessage}</strong>
      <p>{children ?? "강의 수강생용 Pro 에디션에서 열리는 기능입니다."}</p>
      <div className="row">
        <button type="button" data-smoke-action={`locked-${featureCode}`} onClick={() => onRequest(featureCode)}>
          잠금 안내
        </button>
        <button type="button" className="credit-pill threads-pill" onClick={onOpenThreads}>
          @
        </button>
        <button type="button" className="ghost" onClick={onOpenKakao}>
          문의
        </button>
      </div>
    </section>
  );
}

export function buildTopicPrompt(input: string): string {
  return input;
}

export function buildResearchPrompt(input: string): string {
  return input;
}

export function buildDraftPrompt(input: string): string {
  return input;
}

export function buildMockDraftDocument(): string {
  return "";
}

export function extractTemplateDocument(input: string): string {
  return input;
}

export async function listEditionImages(): Promise<CardnewsResult<readonly ImageLibraryItem[]>> {
  return [];
}

export async function addEditionImage(): Promise<CardnewsResult<ImageLibraryItem>> {
  return lockedResult();
}

export async function getEditionImagePreview(_imageId: string): Promise<CardnewsResult<string>> {
  return lockedResult();
}

export async function removeEditionImageBackdrop(
  _imageId: string,
  _tolerance: number
): Promise<CardnewsResult<ImageLibraryItem>> {
  return lockedResult();
}

export async function loadEditionBulkInput(): Promise<
  CardnewsResult<{ readonly fileName: string; readonly text: string }>
> {
  return lockedResult();
}

export async function saveEditionBulkTemplate(
  _styleId: string,
  _aspectRatioId: string
): Promise<CardnewsResult<string>> {
  return lockedResult();
}

export async function runEditionBulkRender(_csvText: string): Promise<CardnewsResult<BulkRenderResult>> {
  return lockedResult();
}

export async function saveEditionProject(): Promise<CardnewsResult<ProjectArchiveResult>> {
  return lockedResult();
}

export async function loadEditionProject(): Promise<CardnewsResult<ProjectImportResult>> {
  return lockedResult();
}

export async function listEditionAiProviders(): Promise<CardnewsResult<readonly AiProviderStatus[]>> {
  return [];
}

export async function runEditionAi(
  _providerId: AiProviderId,
  _messages: readonly AiChatMessage[]
): Promise<CardnewsResult<AiChatResult>> {
  return lockedResult();
}
