import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { aspectRatios, defaultAspectRatioId } from "../domain/aspectRatios";
import { parseCardText } from "../domain/cardParser";
import { buildTemplateDocument, parseDeckDocument } from "../domain/deckImporter";
import type {
  AppSettings,
  BackgroundLibraryItem,
  Card,
  CardnewsError,
  CardnewsResult,
  Deck,
  DeckDraft,
  FontData,
  FontLibraryItem,
  RenderJobResult,
  StockImage,
  StylePresetRecord,
  WorkspaceState
} from "../domain/types";
import { buildCardHtml, buildFontFaceCss } from "../render-engine/cardTemplate";
import { defaultStyleId, resolveStylePreset, stylePresets } from "../render-engine/stylePresets";

const defaultHeaderLabel = "MONEY NOTE";
const defaultFooterAccount = "kkongdon_story";
const threadsUrl = "https://www.threads.com/@kkongdon_story";
const kakaoInquiryUrl = "https://open.kakao.com/me/kkongdon";

const initialCards = [
  [
    "유형: 표지",
    "배지: MONEY NOTE",
    "제목: 돈 이야기를 다시 배워야 하는 이유",
    "소제목: 숫자보다 먼저 보는 관점"
  ].join("\n"),
  [
    "유형: 본문",
    "제목: 첫 번째 핵심 문장",
    "본문: 카드뉴스의 본문을 여기에 입력하세요.",
    "- 자동 분리 예시",
    "- 두 번째 불릿 예시",
    "출처: 내부 메모"
  ].join("\n")
] as const;

type ParsedCardEntry = {
  readonly card: Card;
  readonly error: CardnewsError | undefined;
};

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

function normalizeFooterAccount(value: string): string {
  const trimmed = value.trim().replace(/^@+/, "").trim();
  return trimmed.length > 0 ? trimmed : defaultFooterAccount;
}

function fallbackCard(index: number, error: CardnewsError): Card {
  return {
    index,
    paragraphs: [error.message],
    title: "카드 파싱 오류",
    type: "body",
    bullets: []
  };
}

function clampSelectedIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, Math.max(0, length - 1)));
}

export function LiteApp(): ReactElement {
  const [headerLabel, setHeaderLabel] = useState(defaultHeaderLabel);
  const [footerAccount, setFooterAccount] = useState(defaultFooterAccount);
  const [cards, setCards] = useState<readonly string[]>(initialCards);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [styleId, setStyleId] = useState<string>(defaultStyleId);
  const [aspectRatioId, setAspectRatioId] = useState<string>(defaultAspectRatioId);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [backgroundDim, setBackgroundDim] = useState<number | null>(null);
  const [backgroundId, setBackgroundId] = useState<string | null>(null);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const [backgroundLibrary, setBackgroundLibrary] = useState<readonly BackgroundLibraryItem[]>([]);
  const [fontLibrary, setFontLibrary] = useState<readonly FontLibraryItem[]>([]);
  const [selectedFontId, setSelectedFontId] = useState<string | null>(null);
  const [fontCss, setFontCss] = useState<string | null>(null);
  const [customStyles, setCustomStyles] = useState<readonly StylePresetRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [pixabayApiKeyDraft, setPixabayApiKeyDraft] = useState("");
  const [stockQuery, setStockQuery] = useState("money background");
  const [stockImages, setStockImages] = useState<readonly StockImage[]>([]);
  const [stockFallbackUrl, setStockFallbackUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("Lite 에디션입니다. 카드 내용을 입력하면 미리보기가 갱신됩니다.");
  const [renderResult, setRenderResult] = useState<RenderJobResult | null>(null);
  const [approvedJobId, setApprovedJobId] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const workspaceReady = useRef(false);
  const fontBlobUrlRef = useRef<string | null>(null);

  const styleNameEntries = useMemo(
    () => [
      ...stylePresets.map((style) => ({ id: style.id, name: style.name })),
      ...customStyles.map((style) => ({ id: style.id, name: style.name }))
    ],
    [customStyles]
  );
  const preset = resolveStylePreset(styleId, customStyles);
  const activeAccentColor = accentColor ?? preset.accentDefault;
  const activeBackgroundDim = backgroundDim ?? preset.defaultDim;

  const parsedEntries = useMemo<readonly ParsedCardEntry[]>(
    () =>
      cards.map((rawText, index) => {
        const parsed = parseCardText(rawText, index + 1);
        return isCardnewsError(parsed)
          ? { card: fallbackCard(index + 1, parsed), error: parsed }
          : { card: parsed, error: undefined };
      }),
    [cards]
  );

  const previewDeck = useMemo<Deck>(
    () => ({
      id: "lite-preview",
      headerLabel: headerLabel.trim() || defaultHeaderLabel,
      footerAccount: normalizeFooterAccount(footerAccount),
      cards: parsedEntries.map((entry) => entry.card),
      styleId,
      accentColor: activeAccentColor,
      backgroundDim: activeBackgroundDim,
      aspectRatio: aspectRatioId,
      ...(backgroundId ? { backgroundId } : {}),
      ...(selectedFontId ? { fontId: selectedFontId } : {})
    }),
    [
      activeAccentColor,
      activeBackgroundDim,
      aspectRatioId,
      backgroundId,
      footerAccount,
      headerLabel,
      parsedEntries,
      selectedFontId,
      styleId
    ]
  );

  const previewHtml = useMemo(() => {
    const selectedCard = previewDeck.cards[clampSelectedIndex(selectedIndex, previewDeck.cards.length)];
    if (!selectedCard) {
      return "";
    }

    return buildCardHtml({
      assetCssUrls: {},
      backgroundCssUrl: backgroundPreview ?? undefined,
      card: selectedCard,
      customStyles,
      deck: previewDeck,
      ...(fontCss ? { fontCss } : {})
    });
  }, [backgroundPreview, customStyles, fontCss, previewDeck, selectedIndex]);

  const selectedRawCard = cards[clampSelectedIndex(selectedIndex, cards.length)] ?? "";
  const parseErrorCount = parsedEntries.filter((entry) => entry.error).length;

  useEffect(() => {
    void (async () => {
      const [backgrounds, fonts, workspace, styles, loadedSettings] = await Promise.all([
        window.cardnews.listBackgroundLibrary(),
        window.cardnews.listFontLibrary(),
        window.cardnews.loadWorkspace(),
        window.cardnews.listCustomStyles(),
        window.cardnews.loadSettings()
      ]);

      if (!isCardnewsError(backgrounds)) {
        setBackgroundLibrary(backgrounds);
      }
      if (!isCardnewsError(fonts)) {
        setFontLibrary(fonts);
      }
      if (!isCardnewsError(styles)) {
        setCustomStyles(styles);
      }
      if (!isCardnewsError(loadedSettings)) {
        setSettings(loadedSettings);
        setPixabayApiKeyDraft(loadedSettings.pixabayApiKey ?? "");
      }
      if (!isCardnewsError(workspace) && workspace) {
        applyWorkspace(workspace);
        await loadFontCss(workspace.fontId ?? null);
        setStatus("Lite 작업을 복원했습니다. Pro 전용 편집 데이터는 Lite에서 표시하지 않습니다.");
      }

      workspaceReady.current = true;
    })();
    return () => clearFontBlobUrl();
  }, []);

  useEffect(() => {
    if (!workspaceReady.current) {
      return;
    }

    const timer = setTimeout(() => {
      void window.cardnews.saveWorkspace(buildWorkspaceState());
    }, 800);
    return () => clearTimeout(timer);
  }, [
    accentColor,
    aspectRatioId,
    backgroundDim,
    backgroundId,
    cards,
    footerAccount,
    headerLabel,
    selectedFontId,
    selectedIndex,
    styleId
  ]);

  useEffect(() => {
    if (!backgroundId) {
      setBackgroundPreview(null);
      return;
    }

    void (async () => {
      const result = await window.cardnews.getBackgroundPreview(backgroundId);
      if (isCardnewsError(result)) {
        setStatus(result.message);
        setBackgroundPreview(null);
        return;
      }
      setBackgroundPreview(result);
    })();
  }, [backgroundId]);

  function applyWorkspace(workspace: WorkspaceState): void {
    setHeaderLabel(workspace.headerLabel);
    setFooterAccount(normalizeFooterAccount(workspace.footerAccount));
    setCards(workspace.cards.length > 0 ? workspace.cards : initialCards);
    setStyleId(workspace.styleId || defaultStyleId);
    setAccentColor(workspace.accentColor ?? null);
    setBackgroundDim(workspace.backgroundDim ?? null);
    setBackgroundId(workspace.backgroundId ?? null);
    setAspectRatioId(workspace.aspectRatio ?? defaultAspectRatioId);
    setSelectedFontId(workspace.fontId ?? null);
    setSelectedIndex(clampSelectedIndex(workspace.selectedIndex ?? 0, workspace.cards.length || initialCards.length));
  }

  function buildDeckDraft(): DeckDraft {
    return {
      headerLabel,
      footerAccount: normalizeFooterAccount(footerAccount),
      styleId,
      accentColor: activeAccentColor,
      backgroundDim: activeBackgroundDim,
      aspectRatio: aspectRatioId,
      ...(backgroundId ? { backgroundId } : {}),
      ...(selectedFontId ? { fontId: selectedFontId } : {}),
      cards: cards.map((rawText, index) => ({ index: index + 1, rawText }))
    };
  }

  function buildWorkspaceState(): WorkspaceState {
    return {
      headerLabel,
      footerAccount: normalizeFooterAccount(footerAccount),
      styleId,
      accentColor: activeAccentColor,
      backgroundDim: activeBackgroundDim,
      aspectRatio: aspectRatioId,
      ...(backgroundId ? { backgroundId } : {}),
      ...(selectedFontId ? { fontId: selectedFontId } : {}),
      cards,
      selectedIndex
    };
  }

  async function loadFontCss(fontId: string | null): Promise<void> {
    clearFontBlobUrl();
    if (!fontId) {
      setFontCss(null);
      return;
    }

    const result = await window.cardnews.getFontData(fontId);
    if (isCardnewsError(result)) {
      setStatus(result.message);
      setFontCss(null);
      return;
    }

    const css = createFontCss(result);
    setFontCss(css);
  }

  function clearFontBlobUrl(): void {
    if (fontBlobUrlRef.current) {
      URL.revokeObjectURL(fontBlobUrlRef.current);
      fontBlobUrlRef.current = null;
    }
  }

  function createFontCss(fontData: FontData): string {
    const byteCharacters = atob(fontData.base64);
    const bytes = new Uint8Array(byteCharacters.length);
    for (let index = 0; index < byteCharacters.length; index += 1) {
      bytes[index] = byteCharacters.charCodeAt(index);
    }

    const blob = new Blob([bytes], { type: fontData.mimeType });
    const url = URL.createObjectURL(blob);
    fontBlobUrlRef.current = url;
    return buildFontFaceCss(url, { family: fontData.cssFamily, format: fontData.cssFormat });
  }

  function updateSelectedCard(rawText: string): void {
    setCards((current) => current.map((card, index) => (index === selectedIndex ? rawText : card)));
    setRenderResult(null);
    setApprovedJobId(null);
  }

  function addCard(): void {
    setCards((current) => [...current, "유형: 본문\n제목: 새 카드\n본문: 내용을 입력하세요."]);
    setSelectedIndex(cards.length);
    setRenderResult(null);
    setApprovedJobId(null);
  }

  function deleteCard(): void {
    setCards((current) => {
      if (current.length <= 1) {
        return current;
      }
      const next = current.filter((_, index) => index !== selectedIndex);
      setSelectedIndex(clampSelectedIndex(selectedIndex, next.length));
      return next;
    });
    setRenderResult(null);
    setApprovedJobId(null);
  }

  async function importTemplate(): Promise<void> {
    const document = await window.cardnews.importDeckDocument();
    if (isCardnewsError(document)) {
      setStatus(document.message);
      return;
    }

    const parsed = parseDeckDocument(document.text, styleNameEntries);
    if (isCardnewsError(parsed)) {
      setStatus(`${document.fileName}: ${parsed.message}`);
      return;
    }

    if (parsed.headerLabel) {
      setHeaderLabel(parsed.headerLabel);
    }
    setFooterAccount(normalizeFooterAccount(parsed.footerAccount ?? footerAccount));
    setStyleId(parsed.styleId ?? styleId);
    setAspectRatioId(parsed.aspectRatio ?? aspectRatioId);
    setCards(parsed.cards.length > 0 ? parsed.cards : cards);
    setSelectedIndex(0);
    setRenderResult(null);
    setApprovedJobId(null);
    setStatus(`양식 불러오기: ${document.fileName}`);
  }

  async function exportTemplate(): Promise<void> {
    const result = await window.cardnews.exportTemplateFile(buildTemplateDocument(styleNameEntries));
    setStatus(isCardnewsError(result) ? result.message : `양식 저장: ${result}`);
  }

  async function importFont(): Promise<void> {
    const result = await window.cardnews.importFontToLibrary();
    if (isCardnewsError(result)) {
      setStatus(result.message);
      return;
    }

    const fonts = await window.cardnews.listFontLibrary();
    if (!isCardnewsError(fonts)) {
      setFontLibrary(fonts);
    }
    setSelectedFontId(result.id);
    await loadFontCss(result.id);
    setStatus(`폰트 추가: ${result.displayName}`);
  }

  async function addBackground(): Promise<void> {
    const result = await window.cardnews.addBackgroundToLibrary();
    if (isCardnewsError(result)) {
      setStatus(result.message);
      return;
    }

    const backgrounds = await window.cardnews.listBackgroundLibrary();
    if (!isCardnewsError(backgrounds)) {
      setBackgroundLibrary(backgrounds);
    }
    setBackgroundId(result.id);
    setStatus(`배경 추가: ${result.displayName}`);
  }

  async function searchStockImages(): Promise<void> {
    const result = await window.cardnews.searchStockImages(stockQuery, 1);
    if (isCardnewsError(result)) {
      setStatus(result.message);
      return;
    }

    setStockImages(result.images);
    setStockFallbackUrl(result.mode === "browser-fallback" ? result.fallbackUrl ?? null : null);
    setStatus(
      result.mode === "browser-fallback"
        ? "Pixabay 키가 없어 브라우저 검색으로 열었습니다."
        : `Pixabay 검색: ${result.images.length}개`
    );
  }

  async function downloadStockImage(image: StockImage): Promise<void> {
    const result = await window.cardnews.downloadStockImage({
      author: image.author,
      id: image.id,
      imageUrl: image.imageUrl,
      pageUrl: image.pageUrl,
      provider: image.provider
    });
    if (isCardnewsError(result)) {
      setStatus(result.message);
      return;
    }

    const backgrounds = await window.cardnews.listBackgroundLibrary();
    if (!isCardnewsError(backgrounds)) {
      setBackgroundLibrary(backgrounds);
    }
    setBackgroundId(result.id);
    setStatus(`Pixabay 이미지 추가: ${result.displayName}`);
  }

  async function savePixabayKey(): Promise<void> {
    const nextSettings: AppSettings = pixabayApiKeyDraft.trim()
      ? { pixabayApiKey: pixabayApiKeyDraft.trim() }
      : {};
    const result = await window.cardnews.saveSettings(nextSettings);
    if (isCardnewsError(result)) {
      setStatus(result.message);
      return;
    }

    setSettings(nextSettings);
    setStatus("설정을 저장했습니다.");
  }

  async function renderDeck(): Promise<void> {
    if (isRendering) {
      return;
    }

    try {
      setIsRendering(true);
      setRenderResult(null);
      setApprovedJobId(null);
      const liveErrors = cards
        .map((rawText, index) => parseCardText(rawText, index + 1))
        .filter(isCardnewsError);
      if (liveErrors.length > 0) {
        setStatus(`파싱 오류 ${liveErrors.length}개 - 카드 내용을 확인하세요.`);
        return;
      }

      const savedDeck = await window.cardnews.saveDeck(buildDeckDraft());
      if (isCardnewsError(savedDeck)) {
        setStatus(`저장 실패: ${savedDeck.message}`);
        return;
      }

      setStatus("렌더링 중...");
      const rendered = await window.cardnews.renderDeck(savedDeck.id);
      if (isCardnewsError(rendered)) {
        setStatus(`렌더 실패: ${rendered.message}`);
        return;
      }

      setRenderResult(rendered);
      setStatus(
        rendered.gateReport.status === "fail"
          ? `게이트 실패: ${rendered.gateReport.issues.length}개`
          : rendered.gateReport.status === "warn"
            ? `렌더 완료: ${rendered.cardCount}장 (경고 ${rendered.gateReport.issues.length}개)`
            : `렌더 완료: ${rendered.cardCount}장 (승인 대기)`
      );
    } finally {
      setIsRendering(false);
    }
  }

  async function exportCurrentPng(): Promise<void> {
    const target = renderResult?.cards.find((card) => card.index === selectedIndex + 1) ?? renderResult?.cards[0];
    if (!renderResult || !target) {
      return;
    }

    const result = await window.cardnews.exportCardPng(renderResult.jobId, target.fileName);
    setStatus(isCardnewsError(result) ? result.message : `PNG 저장: ${result}`);
  }

  async function exportZip(): Promise<void> {
    if (!renderResult) {
      return;
    }

    const result = await window.cardnews.exportDeckZip(renderResult.jobId);
    setStatus(isCardnewsError(result) ? result.message : `ZIP 저장: ${result}`);
  }

  async function openOutputFolder(): Promise<void> {
    if (!renderResult) {
      return;
    }

    const result = await window.cardnews.openOutputFolder(renderResult.jobId);
    if (isCardnewsError(result)) {
      setStatus(result.message);
    }
  }

  async function requestLockedFeature(featureCode: string): Promise<void> {
    const result = await window.cardnews.requestLockedFeature(featureCode);
    setStatus(isCardnewsError(result) ? result.message : "Pro 전용 기능입니다.");
  }

  async function openExternalLink(url: string): Promise<void> {
    const result = await window.cardnews.openExternalLink(url);
    if (isCardnewsError(result)) {
      setStatus(result.message);
    }
  }

  return (
    <main className="lite-shell" data-smoke-edition="lite">
      <aside className="lite-sidebar">
        <header className="lite-brand">
          <strong>Cardnews Studio Lite</strong>
          <span>무료 배포용</span>
        </header>
        <div className="lite-card-list">
          {cards.map((rawText, index) => (
            <button
              type="button"
              className={index === selectedIndex ? "lite-card-tab active" : "lite-card-tab"}
              key={`${index}-${rawText.slice(0, 12)}`}
              onClick={() => setSelectedIndex(index)}
            >
              <span>{index + 1}</span>
              <span>{parsedEntries[index]?.card.title ?? "카드"}</span>
            </button>
          ))}
        </div>
        <div className="lite-row">
          <button type="button" onClick={addCard}>카드 추가</button>
          <button type="button" onClick={deleteCard} disabled={cards.length <= 1}>삭제</button>
        </div>
      </aside>

      <section className="lite-preview-panel">
        <iframe className="preview-frame" sandbox="allow-same-origin" srcDoc={previewHtml} title="Lite preview" />
        <div className="lite-status" data-smoke-status>
          <strong>{parseErrorCount > 0 ? `파싱 오류 ${parseErrorCount}개` : status}</strong>
          {renderResult ? <span>결과: {renderResult.cardCount}장 · {renderResult.gateReport.status}</span> : null}
        </div>
      </section>

      <aside className="lite-controls">
        <section className="control-section">
          <h2>내용</h2>
          <label>
            상단 문구
            <input value={headerLabel} onChange={(event) => setHeaderLabel(event.target.value)} />
          </label>
          <label>
            크레딧
            <input value={footerAccount} onChange={(event) => setFooterAccount(event.target.value)} />
          </label>
          <label>
            카드 원문
            <textarea
              className="lite-card-textarea"
              value={selectedRawCard}
              onChange={(event) => updateSelectedCard(event.target.value)}
            />
          </label>
          <div className="lite-row">
            <button type="button" onClick={importTemplate}>양식 불러오기</button>
            <button type="button" onClick={exportTemplate}>양식 저장</button>
          </div>
        </section>

        <section className="control-section">
          <h2>디자인</h2>
          <label>
            스타일
            <select value={styleId} onChange={(event) => setStyleId(event.target.value)}>
              {styleNameEntries.map((style) => (
                <option key={style.id} value={style.id}>{style.name}</option>
              ))}
            </select>
          </label>
          <label>
            비율
            <select value={aspectRatioId} onChange={(event) => setAspectRatioId(event.target.value)}>
              {aspectRatios.map((ratio) => (
                <option key={ratio.id} value={ratio.id}>{ratio.name}</option>
              ))}
            </select>
          </label>
          <label>
            포인트 색
            <input type="color" value={activeAccentColor} onChange={(event) => setAccentColor(event.target.value)} />
          </label>
          <label>
            어둡기
            <input
              max={0.72}
              min={0}
              step={0.01}
              type="range"
              value={activeBackgroundDim}
              onChange={(event) => setBackgroundDim(Number(event.target.value))}
            />
          </label>
          <label>
            배경
            <select value={backgroundId ?? ""} onChange={(event) => setBackgroundId(event.target.value || null)}>
              <option value="">스타일 기본 배경</option>
              {backgroundLibrary.map((item) => (
                <option key={item.id} value={item.id}>{item.displayName}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={addBackground}>배경 이미지 추가</button>
          <label>
            폰트
            <select
              data-smoke-role="font-select"
              value={selectedFontId ?? ""}
              onChange={(event) => {
                const nextFontId = event.target.value || null;
                setSelectedFontId(nextFontId);
                void loadFontCss(nextFontId);
              }}
            >
              <option value="">기본 폰트</option>
              {fontLibrary.map((font) => (
                <option key={font.id} value={font.id}>{font.displayName}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={importFont}>폰트 추가</button>
        </section>

        <section className="control-section">
          <h2>Pixabay</h2>
          <label>
            API 키
            <input value={pixabayApiKeyDraft} onChange={(event) => setPixabayApiKeyDraft(event.target.value)} />
          </label>
          <button type="button" onClick={savePixabayKey} disabled={settings.pixabayApiKey === pixabayApiKeyDraft.trim()}>
            설정 저장
          </button>
          <label>
            검색어
            <input value={stockQuery} onChange={(event) => setStockQuery(event.target.value)} />
          </label>
          <button type="button" onClick={searchStockImages}>검색</button>
          {stockFallbackUrl ? (
            <button type="button" onClick={() => void openExternalLink(stockFallbackUrl)}>브라우저 검색 열기</button>
          ) : null}
          <div className="lite-stock-grid">
            {stockImages.slice(0, 6).map((image) => (
              <button key={image.id} type="button" onClick={() => void downloadStockImage(image)}>
                <img src={image.previewUrl} alt="" />
                <span>{image.author}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="control-section edition-lock" data-smoke-role="edition-lock">
          <h2>Pro에서 사용 가능</h2>
          <p>레이어 편집, CSV 대량 생성, 프로젝트 파일, 배지 이미지, 넘김기호, AI 기능은 Pro 에디션에서 열립니다.</p>
          <div className="lite-row">
            <button type="button" data-smoke-action="locked-feature" onClick={() => void requestLockedFeature("bulk_csv")}>
              잠금 확인
            </button>
            <button type="button" onClick={() => void openExternalLink(threadsUrl)}>@</button>
            <button type="button" onClick={() => void openExternalLink(kakaoInquiryUrl)}>문의</button>
          </div>
        </section>

        <section className="control-section">
          <h2>내보내기</h2>
          <button type="button" data-smoke-action="generate" onClick={renderDeck} disabled={isRendering}>
            {isRendering ? "생성 중..." : "PNG 생성"}
          </button>
          <div className="lite-row">
            <button
              type="button"
              data-smoke-action="export-current-png"
              disabled={!renderResult}
              onClick={exportCurrentPng}
            >
              현재 PNG
            </button>
            <button type="button" data-smoke-action="export-zip" disabled={!renderResult} onClick={exportZip}>
              전체 ZIP
            </button>
          </div>
          <div className="lite-row">
            <button type="button" disabled={!renderResult} onClick={openOutputFolder}>폴더 열기</button>
            <button
              type="button"
              disabled={!renderResult || approvedJobId === renderResult?.jobId}
              onClick={() => {
                if (renderResult) {
                  setApprovedJobId(renderResult.jobId);
                  setStatus(`승인 완료: ${renderResult.cardCount}장`);
                }
              }}
            >
              승인
            </button>
          </div>
        </section>
      </aside>
    </main>
  );
}
