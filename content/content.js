(() => {
  // net-hook.js를 MAIN world에 script 태그로 주입 (content_scripts "world":"MAIN" 대신 사용)
  if (!window.__gptNetHookInjected) {
    window.__gptNetHookInjected = true;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('content/net-hook.js');
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  }

  if (window.__gptAutoLoaded) {
    console.log('[GPT-Auto] 이미 로드됨 — 재주입 무시');
    return;
  }
  console.log('[GPT-Auto] content script 로드됨 ✅');
  window.__gptAutoLoaded = true;

  const SELECTORS = {
    promptTextarea: '#prompt-textarea',
    promptTextareaFallback: '[contenteditable="true"][role="textbox"]',
    promptTextareaAlt: 'div[contenteditable="true"]',
    sendButton: '[data-testid="send-button"]',
    sendButtonFallback: 'button[aria-label*="Send"], button[aria-label*="보내"], button[aria-label*="send"]',
    assistantMessage: '[data-message-author-role="assistant"]',
    conversationTurn: '[data-testid^="conversation-turn-"]',
    errorAlert: '[role="alert"]',
    regenerateButton: 'button[aria-label*="Regenerate"], button[aria-label*="재생성"], button[aria-label*="다시 생성"]',
  };

  // 모드별 타임아웃 설정
  // noImgWaitMs      : 응답은 왔는데 이미지가 없을 때 기다리는 시간 (신호 없음)
  // noImgNetWaitMs   : netImageDetected=true일 때 기다리는 시간 (이미지 신호 감지됨)
  // timeoutMs        : waitForCompletion() 절대 상한 (안전망)
  const MODE_TIMEOUTS = {
    instant:  { timeoutMs:  120_000, noImgWaitMs:  90_000, noImgNetWaitMs:  120_000 },
    thinking: { timeoutMs:  300_000, noImgWaitMs: 240_000, noImgNetWaitMs:  270_000 },
    pro:      { timeoutMs:  700_000, noImgWaitMs: 600_000, noImgNetWaitMs:  660_000 },
  };

  let timeoutMs      = MODE_TIMEOUTS.instant.timeoutMs;
  let noImgWaitMs    = MODE_TIMEOUTS.instant.noImgWaitMs;
  let noImgNetWaitMs = MODE_TIMEOUTS.instant.noImgNetWaitMs;

  const POLL_INTERVAL_MS = 500;
  const RETRY_DELAY_MS = 2000;
  const MAX_RETRIES = 3;
  const INTER_PROMPT_DELAY_MS = 800;
  const IMG_STABLE_MS = 500; // img.complete 확인 후 추가 안정 버퍼

  // v2.2: 최상위 명령 프리셋 맵 — null → '' (주입 없음)
  const SIZE_RATIO_MAP = {
    landscape: '이미지 비율: 16:9 가로형으로 생성하세요.',
    square:    '이미지 비율: 1:1 정방형으로 생성하세요.',
    portrait:  '이미지 비율: 9:16 세로형으로 생성하세요.',
    cardnews:  '이미지 비율: 4:5 카드뉴스형으로 생성하세요.',
  };

  const STYLE_PRESET_MAP = {
    minimal:     '미니멀 스타일로 생성하세요. 여백이 많고 깔끔하게.',
    modern:      '현대적이고 세련된 모던 스타일로 생성하세요.',
    flat:        '그림자 없는 플랫 디자인 스타일로 생성하세요.',
    illust:      '손으로 그린 일러스트 스타일로 생성하세요.',
    retro:       '1980~90년대 레트로/복고 스타일로 생성하세요.',
    popart:      '굵은 선과 원색의 팝아트 스타일로 생성하세요.',
    isometric:   '3D 이소메트릭 뷰 스타일로 생성하세요.',
    infographic: '데이터 시각화 인포그래픽 스타일로 생성하세요.',
    duotone:     '두 가지 색상만 사용하는 듀오톤 스타일로 생성하세요.',
    lineart:     '깔끔한 라인아트 드로잉 스타일로 생성하세요.',
  };

  const FONT_PRESET_MAP = {
    gothic:      '텍스트는 고딕 계열 산세리프 폰트 느낌으로 표현하세요.',
    myeongjo:    '텍스트는 명조 계열 세리프 폰트 느낌으로 표현하세요.',
    handwriting: '텍스트는 자연스러운 손글씨 폰트 느낌으로 표현하세요.',
    retrogothic: '텍스트는 1980년대 레트로 고딕 폰트 느낌으로 표현하세요.',
    calligraphy: '텍스트는 우아한 캘리그라피 필기체로 표현하세요.',
    neon:        '텍스트는 빛나는 네온 사인 스타일 폰트로 표현하세요.',
    stencil:     '텍스트는 스텐실 스프레이 페인트 폰트 느낌으로 표현하세요.',
    display:     '텍스트는 임팩트 있는 디스플레이/장식 폰트로 표현하세요.',
    block:       '텍스트는 두껍고 강한 블록 폰트 느낌으로 표현하세요.',
    brush:       '텍스트는 동양적인 붓글씨 서예 스타일로 표현하세요.',
  };

  let queue = [];
  let attachedImagesList = []; // 프롬프트별 첨부 이미지 (base64 or null)
  let currentIndex = 0;
  let running = false;
  let aborted = false;
  let successCount = 0;
  let errorCount = 0;
  let globalPromptText = ''; // 전역 스타일 지침 (팝업에서 전달)
  let sizeRatio    = null; // v2.2: 선택된 비율 키 ('landscape'|'square'|'portrait'|'cardnews'|null)
  let stylePreset  = null; // v2.2: 선택된 스타일 키 (STYLE_PRESET_MAP 키 | null)
  let fontPreset   = null; // v2.2: 선택된 글꼴 키 (FONT_PRESET_MAP 키 | null)
  let imgCountSnapshot = 0;
  let imgCountMax = 0; // DOM virtualization 대비: 세션 중 관측된 최대값
  let imgDetectedAt = 0;
  let noImgTurnAt = 0;
  let executionStartSnapshot = 0; // 이번 실행 시작 시점의 img 개수
  let runImageUrls = []; // 이번 실행 중 수집된 이미지 URL (실시간 누적 — DOM 가상화 무관)
  let retryCount = 0;   // v2.1: 카드당 재시도 횟수 (0 or 1) — processNext 재귀 시 보존

  // net-hook.js(MAIN world)에서 전달되는 네트워크 신호
  // COMPLETE는 "스트림 종료" 플래그만 세움 — DOM 폴링이 이미지 완료를 판단
  let netStreamDone = false;   // COMPLETE 수신 여부
  let netImageDetected = false; // IMAGE_DETECTED 수신 여부
  let netSignalResolve = null;  // RATE_LIMIT 전용 즉시 resolve 콜백

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.source !== 'gpt-auto-hook') return;
    const { type } = e.data;
    console.log('[GPT-Auto] net-hook 신호:', type, e.data);

    if (type === 'IMAGE_DETECTED') {
      netImageDetected = true;
    } else if (type === 'COMPLETE') {
      // 스트림 끝 표시만 — 이미지 완료는 DOM 폴링이 판단
      netStreamDone = true;
    } else if (type === 'RATE_LIMIT') {
      if (netSignalResolve) {
        netSignalResolve('error');
        netSignalResolve = null;
      }
    }
  });

  // ── 플로팅 상태 패널 ──────────────────────────────
  let statusPanel = null;

  function getOrCreatePanel() {
    if (statusPanel && document.body.contains(statusPanel)) return statusPanel;

    const panel = document.createElement('div');
    panel.id = 'gpt-auto-overlay';
    panel.innerHTML = `
      <div id="gpt-auto-header">
        <span id="gpt-auto-title">🤖 자동 생성 실행 중</span>
        <button id="gpt-auto-close" title="닫기">✕</button>
      </div>
      <div id="gpt-auto-info">
        <span id="gpt-auto-prompt-num"></span>
        <span id="gpt-auto-status-text"></span>
      </div>
      <div id="gpt-auto-bar-wrap">
        <div id="gpt-auto-bar"></div>
      </div>
      <div id="gpt-auto-decision" style="display:none;">
        <p id="gpt-auto-decision-msg"></p>
        <div id="gpt-auto-decision-btns">
          <button id="gpt-auto-btn-continue">다음 계속 →</button>
          <button id="gpt-auto-btn-stop">중지</button>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #gpt-auto-overlay {
        position: fixed; bottom: 80px; right: 20px; z-index: 2147483647;
        background: #191918; color: #fff; border-radius: 12px;
        padding: 12px 16px; min-width: 220px; max-width: 280px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; line-height: 1.4;
        box-shadow: 0 4px 24px rgba(0,0,0,0.35);
        display: none; user-select: none;
      }
      #gpt-auto-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 8px;
      }
      #gpt-auto-title { font-weight: 600; font-size: 13px; }
      #gpt-auto-close {
        background: none; border: none; color: #888; cursor: pointer;
        font-size: 14px; padding: 0; line-height: 1;
      }
      #gpt-auto-close:hover { color: #fff; }
      #gpt-auto-info { margin-bottom: 10px; }
      #gpt-auto-prompt-num { color: #097FE8; font-weight: 600; margin-right: 6px; }
      #gpt-auto-status-text { color: #ccc; }
      #gpt-auto-bar-wrap {
        height: 3px; background: rgba(255,255,255,0.15);
        border-radius: 2px; overflow: hidden;
      }
      #gpt-auto-bar {
        height: 100%; width: 0; background: #097FE8;
        border-radius: 2px; transition: width 0.4s ease;
      }
      #gpt-auto-decision {
        margin-top: 10px; padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.12);
      }
      #gpt-auto-decision-msg {
        font-size: 12px; color: #f5a623; margin-bottom: 8px; line-height: 1.4;
      }
      #gpt-auto-decision-btns {
        display: flex; gap: 6px;
      }
      #gpt-auto-btn-continue {
        flex: 1; padding: 6px 0; border: none; border-radius: 6px;
        background: #097FE8; color: #fff; font-size: 12px; font-weight: 600;
        cursor: pointer; font-family: inherit;
      }
      #gpt-auto-btn-continue:hover { background: #0066CC; }
      #gpt-auto-btn-stop {
        flex: 1; padding: 6px 0; border: none; border-radius: 6px;
        background: rgba(246,73,50,0.25); color: #F64932; font-size: 12px; font-weight: 600;
        cursor: pointer; font-family: inherit;
      }
      #gpt-auto-btn-stop:hover { background: #F64932; color: #fff; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);
    statusPanel = panel;

    document.getElementById('gpt-auto-close').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    return panel;
  }

  // 타임아웃 후 사용자에게 "계속 or 중지" 묻는 결정 UI
  // 반환값: 'continue' | 'stop'
  //
  // [버그 수정] 이전 구현의 두 가지 문제:
  // 1) ✕ 버튼 클릭 시 panel만 숨기고 Promise는 영원히 resolve되지 않아 processNext 영구 중단
  // 2) 실행 재시작 시 이전 리스너가 잔류 → 클릭 시 두 개의 cleanup이 동시 실행
  //    → `resolved` 가드로 중복 resolve 차단, cleanup에서 리스너 반드시 제거
  function waitForUserDecision(promptIdx, totalCount) {
    return new Promise((resolve) => {
      const panel = getOrCreatePanel();
      panel.style.display = 'block';

      const decisionDiv = document.getElementById('gpt-auto-decision');
      const msgEl     = document.getElementById('gpt-auto-decision-msg');
      const btnContinue = document.getElementById('gpt-auto-btn-continue');
      const btnStop     = document.getElementById('gpt-auto-btn-stop');
      const closeBtn    = document.getElementById('gpt-auto-close');

      msgEl.textContent = `⏱ #${promptIdx + 1} 이미지 감지 안 됨. 다음 프롬프트로 이동할까요?`;
      decisionDiv.style.display = 'block';

      let resolved = false; // 중복 resolve 방지 가드

      const cleanup = (resolveWith) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(autoTimer);
        decisionDiv.style.display = 'none';
        btnContinue.removeEventListener('click', onContinue);
        btnStop.removeEventListener('click', onStop);
        closeBtn.removeEventListener('click', onClose);
        console.log(`[GPT-Auto] 결정: ${resolveWith} (#${promptIdx + 1})`);
        resolve(resolveWith);
      };

      const onContinue = () => cleanup('continue');
      const onStop     = () => cleanup('stop');
      // ✕ 닫기 = "다음으로 계속" 으로 해석 (hang 방지)
      const onClose    = () => { console.log('[GPT-Auto] ✕ 닫힘 → 자동 계속'); cleanup('continue'); };

      // 30초 무응답 시 자동으로 계속 진행 (사용자가 자리를 비웠을 때 안전망)
      const autoTimer = setTimeout(() => {
        console.log('[GPT-Auto] 결정 30초 초과 → 자동 계속');
        cleanup('continue');
      }, 30_000);

      btnContinue.addEventListener('click', onContinue);
      btnStop.addEventListener('click', onStop);
      closeBtn.addEventListener('click', onClose);
    });
  }

  function updatePanel(current, total, status) {
    const panel = getOrCreatePanel();
    panel.style.display = 'block';
    document.getElementById('gpt-auto-prompt-num').textContent = `${current}/${total}`;
    document.getElementById('gpt-auto-status-text').textContent = status;
    const pct = total > 0 ? (current / total) * 100 : 0;
    document.getElementById('gpt-auto-bar').style.width = pct + '%';

    if (status === '완료' || status === '중지됨') {
      document.getElementById('gpt-auto-title').textContent =
        status === '완료' ? '✅ 생성 완료' : '⏹ 중지됨';
      setTimeout(() => {
        if (statusPanel) statusPanel.style.display = 'none';
      }, 4000);
    } else {
      document.getElementById('gpt-auto-title').textContent = '🤖 자동 생성 실행 중';
    }
  }
  // ─────────────────────────────────────────────────

  // executeScript로 직접 호출 가능한 다운로드 함수 노출
  // background.js가 tabs.sendMessage 대신 executeScript로 호출 → 탭 재연결 불필요
  window.__gptCollectAll = () => {
    const urls = collectImageUrls();
    console.log('[GPT-Auto] __gptCollectAll:', urls.length, '개');
    return urls;
  };

  window.__gptCollectRun = () => {
    // runImageUrls: 이미지 완료 감지 직후 실시간 누적된 URL — DOM 가상화와 무관
    const urls = [...new Set(runImageUrls)];
    console.log('[GPT-Auto] __gptCollectRun: 누적 runImageUrls=', urls.length, '개');
    return urls;
  };

  window.__gptAutoStart = (prompts, globalPrompt, images, waitMode, ratioKey, styleKey, fontKey) => {
    // 모드별 타임아웃 적용 (기본값: instant)
    const modeCfg = MODE_TIMEOUTS[waitMode] || MODE_TIMEOUTS.instant;
    timeoutMs      = modeCfg.timeoutMs;
    noImgWaitMs    = modeCfg.noImgWaitMs;
    noImgNetWaitMs = modeCfg.noImgNetWaitMs;
    console.log(`[GPT-Auto] __gptAutoStart 호출됨 ✅ 모드:${waitMode || 'instant'} ratio:${ratioKey || 'none'} style:${styleKey || 'none'} font:${fontKey || 'none'} 프롬프트:${prompts?.length}개`);

    queue = prompts;
    globalPromptText = globalPrompt || '';
    attachedImagesList = images || [];
    sizeRatio   = ratioKey  || null; // v2.2: 비율 선택값 저장
    stylePreset = styleKey  || null; // v2.2: 스타일 선택값 저장
    fontPreset  = fontKey   || null; // v2.2: 글꼴 선택값 저장
    currentIndex = 0;
    running = true;
    aborted = false;
    successCount = 0;
    errorCount = 0;
    runImageUrls = []; // 실행 시 초기화 — 이번 실행분 URL 새로 누적 시작
    // 이번 실행 시작 시점의 다운로드 이미지 개수 캡처 — collectRunImages() 폴백용
    executionStartSnapshot = getDownloadableImageCount();
    console.log('[GPT-Auto] executionStartSnapshot:', executionStartSnapshot);
    processNext();
  };

  window.__gptAutoStop = () => {
    aborted = true;
    running = false;
    // 실제 버튼만 클릭 (.result-streaming div는 클릭 무효이므로 제외)
    const stopBtn = findClickableStopButton();
    if (stopBtn) stopBtn.click();
    updatePanel(currentIndex, queue.length, '중지됨');
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START_GENERATION') {
      console.log('[GPT-Auto] START_GENERATION (onMessage) 수신 ✅');
      window.__gptAutoStart(msg.prompts);
    }
    if (msg.type === 'STOP_GENERATION') {
      window.__gptAutoStop();
    }
    if (msg.type === 'DOWNLOAD_IMAGES') {
      const urls = collectImageUrls();
      chrome.runtime.sendMessage({ type: 'IMAGE_URLS', urls });
    }
    if (msg.type === 'DOWNLOAD_RUN_IMAGES') {
      const urls = [...new Set(runImageUrls)];
      console.log('[GPT-Auto] DOWNLOAD_RUN_IMAGES (legacy onMessage): urls=' + urls.length);
      chrome.runtime.sendMessage({ type: 'IMAGE_URLS', urls });
    }
  });

  // v2.2: 최상위 명령 프리픽스 합성
  // 합성 순서: [스타일]\n[글꼴]\n[비율] → \n\n → [전역 지침] → \n\n → [개별 프롬프트]
  function buildSystemPrefix() {
    const parts = [];
    if (stylePreset && STYLE_PRESET_MAP[stylePreset]) parts.push(STYLE_PRESET_MAP[stylePreset]);
    if (fontPreset  && FONT_PRESET_MAP[fontPreset])   parts.push(FONT_PRESET_MAP[fontPreset]);
    if (sizeRatio   && SIZE_RATIO_MAP[sizeRatio])     parts.push(SIZE_RATIO_MAP[sizeRatio]);
    return parts.join('\n');
  }

  async function processNext() {
    // SW 재시작 후 stopRequested 플래그 확인 (안전망)
    try {
      const s = await chrome.storage.session.get('stopRequested');
      if (s.stopRequested) { aborted = true; }
    } catch (e) {}

    console.log(`[GPT-Auto] ▶ processNext: index=${currentIndex}/${queue.length} retry=${retryCount} aborted=${aborted}`);

    if (aborted || currentIndex >= queue.length) {
      running = false;
      console.log(`[GPT-Auto] ✅ 전체 완료 — success=${successCount} error=${errorCount}`);
      updatePanel(queue.length, queue.length, '완료');
      chrome.runtime.sendMessage({
        type: 'ALL_COMPLETE',
        total: queue.length,
        successCount,
        errorCount
      });
      return;
    }

    const individualPrompt = queue[currentIndex];
    // v2.2: 최상위 명령(비율) → 전역 지침 → 개별 프롬프트 순서로 합성
    const systemPrefix = buildSystemPrefix();
    const prompt = [systemPrefix, globalPromptText, individualPrompt]
      .filter(Boolean)
      .join('\n\n');

    sendProgress('프롬프트 입력 중...');

    let lastResult = 'timeout';
    try {
      // 이미지 첨부가 있으면 텍스트 입력 전에 먼저 업로드
      // attachedImagesList[i]: string[] (0~3개) — 빈 배열이면 스킵
      const attachImages = attachedImagesList[currentIndex];
      const hasImages = Array.isArray(attachImages)
        ? attachImages.length > 0
        : !!attachImages; // 하위 호환: 단일 string도 처리
      if (hasImages) {
        sendProgress('이미지 첨부 중...');
        await attachImageToChat(attachImages);
      }

      // 첨부 완료 후 / 타이핑 직전 aborted 체크 (첨부 대기 중 stop 버튼 대비)
      if (aborted) return processNext();
      await typePrompt(prompt);
      await sleep(500);

      sendProgress('전송 중...');
      const prevUrlSet = new Set(getDownloadableUrls()); // 전송 직전 URL 스냅샷 (실행분 수집 기준선)
      imgCountSnapshot = getAssistantImageCount(); // 전송 직전 DOM 카운트 스냅샷 (완료 감지용)
      imgCountMax = imgCountSnapshot;
      console.log(`[GPT-Auto] 전송 직전 imgCountSnapshot=${imgCountSnapshot}`);
      await clickSend();

      const waitLabel = noImgWaitMs >= 60000
        ? `최대 ${Math.round(noImgWaitMs / 60000)}분`
        : `최대 ${Math.round(noImgWaitMs / 1000)}초`;
      sendProgress(`이미지 생성 중... (${waitLabel})`);
      lastResult = await waitForCompletion();

      console.log(`[GPT-Auto] waitForCompletion 결과: "${lastResult}" (index=${currentIndex} retry=${retryCount})`);

      if (lastResult === 'image') {
        successCount++;
        captureNewRunImages(prevUrlSet); // 완료 직후 즉시 수집 — 아직 DOM에 있을 때
        sendProgress('완료');
      } else if ((lastResult === 'text' || lastResult === 'timeout') && retryCount < 1) {
        // 이미지 실패 시 1회 자동 재시도 (같은 카드, currentIndex 유지)
        retryCount++;
        console.log(`[GPT-Auto] 자동 재시도 (${retryCount}/1): index=${currentIndex}`);
        sendProgress(`재시도 중... (${retryCount}/1)`);
        await sleep(RETRY_DELAY_MS);
        return processNext(); // 재귀 재진입 — retryCount는 전역이므로 보존됨
      } else if (lastResult === 'text' || lastResult === 'timeout') {
        // 재시도 후에도 이미지 미감지 → 사용자에게 계속 여부 확인
        console.log(`[GPT-Auto] 재시도 후에도 실패 → 사용자 결정 대기`);
        sendProgress('이미지 미감지 — 대기 중...');
        const decision = await waitForUserDecision(currentIndex, queue.length);
        if (decision === 'stop') {
          aborted = true;
          running = false;
          updatePanel(currentIndex + 1, queue.length, '중지됨');
          chrome.runtime.sendMessage({
            type: 'ALL_COMPLETE',
            total: queue.length,
            successCount,
            errorCount
          });
          return; // processNext 루프 종료
        }
        // 'continue': successCount 증가 없이 다음으로 이동
        console.log(`[GPT-Auto] 건너뜀 → 다음 index=${currentIndex + 1}`);
        sendProgress('건너뜀');
      } else if (lastResult === 'aborted') {
        // 정지 요청으로 인한 종료 — 에러 카운트 증가 없음
        // processNext() 최상단의 aborted 체크가 루프를 즉시 종료시킴
        console.log('[GPT-Auto] aborted 감지 → 루프 종료 대기');
      } else if (lastResult === 'error') {
        errorCount++;
        sendProgress('오류');
        chrome.runtime.sendMessage({
          type: 'GENERATION_ERROR',
          error: `프롬프트 #${currentIndex + 1}: ChatGPT 오류 (rate limit 또는 생성 실패)`
        });
      } else {
        // 알 수 없는 결과 (timeout 폴백)
        errorCount++;
        sendProgress('타임아웃');
        console.warn(`[GPT-Auto] 알 수 없는 lastResult: "${lastResult}"`);
      }
    } catch (err) {
      lastResult = 'error';
      errorCount++;
      sendProgress('오류');
      console.error(`[GPT-Auto] processNext 예외:`, err);
      chrome.runtime.sendMessage({
        type: 'GENERATION_ERROR',
        error: `프롬프트 #${currentIndex + 1}: ${err.message}`
      });
    }

    retryCount = 0; // 다음 카드 이동 전 반드시 리셋
    currentIndex++;
    console.log(`[GPT-Auto] 다음으로 이동: index=${currentIndex} (lastResult="${lastResult}")`);
    if (!aborted) {
      if (lastResult === 'error') {
        // rate limit 대비: 60초 카운트다운
        for (let i = 60; i > 0 && !aborted; i--) {
          updatePanel(currentIndex, queue.length, `rate limit 대기 ${i}초...`);
          await sleep(1000);
        }
      } else {
        await sleep(INTER_PROMPT_DELAY_MS);
      }
      if (!aborted) processNext();
    }
  }

  // ── 이미지 첨부 함수 (최대 3장 배열 지원) ────────────────
  // base64Array: string[] — 1~3개의 base64 dataURL
  // 단일 string이 전달된 경우 하위 호환성 유지 (자동으로 배열로 변환)
  async function attachImageToChat(base64Array) {
    if (!Array.isArray(base64Array)) base64Array = [base64Array];
    if (base64Array.length === 0) return;
    try {
      // 1. 모든 base64 → DataTransfer에 File로 누적 (한 번에 주입)
      const dt = new DataTransfer();
      for (const b64 of base64Array) {
        const res = await fetch(b64);
        const blob = await res.blob();
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        dt.items.add(new File([blob], `ref-image.${ext}`, { type: blob.type }));
      }

      // 2. ChatGPT 파일 입력 찾기 (다중 셀렉터 폴백)
      const fileInput =
        document.querySelector('input[type="file"][accept*="image"]') ||
        document.querySelector('input[type="file"]');

      if (!fileInput) {
        console.warn('[GPT-Auto] 파일 입력 요소를 찾을 수 없음 — 이미지 첨부 건너뜀');
        return;
      }

      // 3. DataTransfer로 여러 파일 한 번에 주입 (native setter 사용)
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'files'
      ).set;
      nativeSetter.call(fileInput, dt.files);
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      console.log('[GPT-Auto] 이미지 첨부 주입:', dt.files.length, '개');

      // 4. 업로드 완료 대기
      await waitForImageAttached();
    } catch (err) {
      // 첨부 실패해도 텍스트 프롬프트는 계속 진행
      console.warn('[GPT-Auto] 이미지 첨부 실패 (계속 진행):', err.message);
    }
  }

  async function waitForImageAttached(timeoutMs = 8000) {
    // ChatGPT가 이미지를 수락하면 입력창 근처에 첨부 미리보기 요소가 등장
    const ATTACH_SELECTORS = [
      '[data-testid="file-thumbnail"]',
      '[class*="attachment"]',
      '[class*="file-preview"]',
      '[class*="upload"]',
      // 입력창 컨테이너 내 img가 새로 생기는 경우
      'div[class*="composer"] img[src^="blob:"]',
      'div[class*="input"] img[src^="blob:"]',
    ];
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const sel of ATTACH_SELECTORS) {
        if (document.querySelector(sel)) {
          await sleep(400); // 안정화 대기
          console.log('[GPT-Auto] 이미지 첨부 확인됨:', sel);
          return;
        }
      }
      await sleep(200);
    }
    // 셀렉터 미감지 시 고정 대기로 폴백
    console.warn('[GPT-Auto] 이미지 첨부 확인 타임아웃 — 2s 대기 후 계속');
    await sleep(2000);
  }
  // ─────────────────────────────────────────────────

  async function typePrompt(text) {
    const textarea = await waitForElement(
      SELECTORS.promptTextarea,
      SELECTORS.promptTextareaFallback,
      SELECTORS.promptTextareaAlt
    );

    textarea.focus();
    await sleep(100);

    if (textarea.tagName === 'TEXTAREA') {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeSetter.call(textarea, text);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false, null);
      await sleep(50);
      document.execCommand('insertText', false, text);
    }

    await sleep(300);

    if (!getTextContent(textarea).includes(text.substring(0, 20))) {
      const p = document.createElement('p');
      p.textContent = text;
      textarea.replaceChildren(p);
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  }

  async function clickSend() {
    let retries = 0;
    while (retries < MAX_RETRIES) {
      const btn = document.querySelector(SELECTORS.sendButton)
        || document.querySelector(SELECTORS.sendButtonFallback);

      if (btn && !btn.disabled) {
        btn.click();
        return;
      }

      retries++;
      await sleep(RETRY_DELAY_MS);
    }
    throw new Error('전송 버튼을 찾을 수 없습니다');
  }

  function waitForCompletion() {
    netStreamDone = false;
    netImageDetected = false;
    imgDetectedAt = 0;
    noImgTurnAt = 0;
    imgCountMax = imgCountSnapshot;

    return new Promise((resolve) => {
      const startTime = Date.now();
      let resolved = false;
      const turnCountBefore = document.querySelectorAll(SELECTORS.conversationTurn).length;

      const done = (result) => {
        if (resolved) return;
        resolved = true;
        netSignalResolve = null;
        observer.disconnect();
        clearInterval(poll);
        resolve(result);
      };

      // RATE_LIMIT만 즉시 처리 (나머지는 DOM 폴링이 담당)
      netSignalResolve = done;

      const check = () => {
        if (resolved) return;
        if (aborted) { done('aborted'); return; } // v2.2: 즉시 종료 (500ms 폴 대기 제거)
        const result = checkCompletion(turnCountBefore);
        if (result) done(result);
      };

      const observer = new MutationObserver(check);
      const main = document.querySelector('main') || document.body;
      observer.observe(main, { childList: true, subtree: true });

      const poll = setInterval(() => {
        if (resolved || aborted) {
          clearInterval(poll);
          if (!resolved) done('aborted');
          return;
        }
        if (Date.now() - startTime > timeoutMs) { done('timeout'); return; }
        check();
      }, POLL_INTERVAL_MS);
    });
  }

  function checkCompletion(turnCountBefore) {
    // 1. 에러 배너 우선 감지
    const alert = document.querySelector(SELECTORS.errorAlert);
    if (alert && alert.textContent.trim().length > 0) {
      console.log('[GPT-Auto] checkCompletion → error (alert)');
      return 'error';
    }

    const stopBtn = findStopButton();
    const imgCount = getAssistantImageCount();
    const turns = document.querySelectorAll(SELECTORS.conversationTurn).length;
    imgCountMax = Math.max(imgCountMax, imgCount);

    console.log(`[GPT-Auto] check: stop=${!!stopBtn} img=${imgCount}(max=${imgCountMax},snap=${imgCountSnapshot}) turns=${turns}(before=${turnCountBefore}) netDone=${netStreamDone} netImg=${netImageDetected}`);

    // 2. stop 버튼 있으면 아직 생성 중
    if (stopBtn) { imgDetectedAt = 0; noImgTurnAt = 0; return null; }

    // 3. 재생성 버튼 = 에러
    if (document.querySelector(SELECTORS.regenerateButton)) {
      console.log('[GPT-Auto] checkCompletion → error (regen btn)');
      return 'error';
    }

    // 4. DOM 카운트 기반 이미지 감지 → 안정화 후 완료
    //    imgCountMax > imgCountSnapshot: 새 이미지가 추가된 것이 확실한 경우
    if (imgCountMax > imgCountSnapshot) {
      if (imgDetectedAt === 0) imgDetectedAt = Date.now();
      if (Date.now() - imgDetectedAt >= IMG_STABLE_MS) {
        console.log('[GPT-Auto] checkCompletion → image ✅ (DOM count, max=' + imgCountMax + ')');
        return 'image';
      }
      return null;
    }
    imgDetectedAt = 0;

    // 4b. 네트워크 신호 기반 완료 감지 (DOM 가상화 대비 핵심 경로)
    //     ChatGPT는 대화가 길어지면 오래된 메시지를 DOM에서 언마운트(가상 스크롤)함.
    //     이 경우 새 이미지가 추가돼도 총 img 수가 오히려 줄어들어 조건 4가 영원히 false.
    //     netImageDetected(이미지 URL 스트림 감지) + netStreamDone(스트림 종료) +
    //     정지 버튼 없음 = 이미지 생성 완료 확정 → DOM 카운트 우회
    if (netImageDetected && netStreamDone) {
      if (imgDetectedAt === 0) imgDetectedAt = Date.now();
      if (Date.now() - imgDetectedAt >= IMG_STABLE_MS) {
        console.log('[GPT-Auto] checkCompletion → image ✅ (net signal: imgDetected+streamDone, DOM virtualized)');
        return 'image';
      }
      return null;
    }
    imgDetectedAt = 0;

    // 5. 스트림 종료 또는 대화 턴 추가 확인
    const responseStarted = netStreamDone || turns > turnCountBefore;
    if (!responseStarted) return null; // 아직 응답 시작 안 됨

    // 텍스트 스트리밍 중이면 대기
    if (document.querySelector('.result-streaming')) { noImgTurnAt = 0; return null; }

    // 6. 응답은 왔는데 이미지가 없음
    //    - netImageDetected=true: 이미지 신호 감지됨 → noImgNetWaitMs 대기 (모드별)
    //    - 그 외: 텍스트 응답 가능성 → noImgWaitMs 대기 (모드별)
    if (noImgTurnAt === 0) noImgTurnAt = Date.now();
    const elapsed = Date.now() - noImgTurnAt;
    const waitMs = netImageDetected ? noImgNetWaitMs : noImgWaitMs;

    if (elapsed < waitMs) {
      // 주기적 상태 로그 (10초마다)
      if (elapsed % 10000 < POLL_INTERVAL_MS) {
        console.log(`[GPT-Auto] 이미지 대기 중... ${Math.round(elapsed/1000)}s / ${waitMs/1000}s`);
      }
      return null;
    }

    // 타임아웃: 이미지가 끝내 안 나타나면 텍스트 응답으로 처리
    noImgTurnAt = 0;
    console.log('[GPT-Auto] checkCompletion → text (' + Math.round(elapsed/1000) + 's 대기 후 이미지 없음)');
    return 'text';
  }

  // 생성 중 상태 감지 전용 — .result-streaming 포함 (클릭 금지)
  // checkCompletion의 "아직 생성 중" 판단에만 사용
  function findStopButton() {
    const candidates = [
      '[data-testid="stop-button"]',
      '[data-testid="stop-streaming-button"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      'button[aria-label*="중지"]',
      'button[aria-label*="멈추"]',
      '.result-streaming',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // 실제 클릭 가능한 중지 버튼만 반환 — .result-streaming(div)은 제외
  function findClickableStopButton() {
    const candidates = [
      '[data-testid="stop-button"]',
      '[data-testid="stop-streaming-button"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      'button[aria-label*="중지"]',
      'button[aria-label*="멈추"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // 감지용 broad 필터 — data URL, SVG만 제외, 크기 무관
  // 완료 감지에 사용: blob URL, CDN URL, 확장자 없는 URL 모두 허용
  // 아이콘(100px 미만)도 포함 — 이미지 "증가" 신호 자체가 목적이라 크기 불필요
  function isVisibleImage(img) {
    const src = img.src;
    if (!src || src.startsWith('data:')) return false;
    if (/\.svg(\?|#|$)/i.test(src)) return false;
    return true;
  }

  // 다운로드 대상 img 수집 — 사용자 업로드 이미지 제외
  // "assistant 메시지만 포함"이 아닌 "user 메시지를 제외" 방식으로 구현:
  //   → [data-message-author-role="user"] 내 img만 제거하고 나머지는 모두 포함
  //   → ChatGPT DOM 구조 변경에도 강건: role 속성이 없어도 user만 아니면 통과
  function getAssistantImgs() {
    const main = document.querySelector('main') || document.body;
    return [...main.querySelectorAll('img[src]')].filter(img =>
      !img.closest('[data-message-author-role="user"]')
    );
  }

  // main 전체 이미지 카운트 — 완료 감지 전용 (broad 필터, assistant 범위 제한 없음)
  // ⚠️ 다운로드용 getDownloadableImageCount()와 의도적으로 다름:
  //   ChatGPT가 이미지를 스트리밍 중에 [data-message-author-role] 속성이 없는
  //   임시 노드에 먼저 렌더링할 수 있어서 assistant 범위로 제한하면 img=0이 됨.
  //   "이미지가 화면에 증가했다"는 신호 자체를 포착하는 것이 목적이므로
  //   넓은 범위(main 전체)를 유지.
  function getAssistantImageCount() {
    const main = document.querySelector('main') || document.body;
    return [...main.querySelectorAll('img[src]')]
      .filter(img => isVisibleImage(img)).length;
  }

  function waitForElement(...selectors) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            console.log('[GPT-Auto] 요소 발견:', sel);
            resolve(el);
            return;
          }
        }
        attempts++;
        if (attempts === 1) {
          console.log('[GPT-Auto] 요소 탐색 중...', selectors);
        }
        if (attempts > 20) {
          console.error('[GPT-Auto] 요소를 찾지 못함. 시도한 selectors:', selectors);
          reject(new Error('요소를 찾을 수 없습니다: ' + selectors[0]));
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  function sendProgress(status) {
    const isDone = status === '완료' || status === '타임아웃' || status === '오류' || status === '건너뜀';
    const current = currentIndex + (isDone ? 1 : 0);
    const total = queue.length;

    updatePanel(current, total, status);

    chrome.runtime.sendMessage({
      type: 'PROGRESS_UPDATE',
      current,
      total,
      currentIndex,
      status
    });
  }

  function getTextContent(el) {
    return el.value || el.textContent || el.innerText || '';
  }

  // URL 패턴 의존 없이 img 요소 자체로 다운로드 대상 판별
  // data URL, SVG 제외 + naturalWidth < 100px인 아이콘 제외
  // ChatGPT CDN URL은 버전마다 바뀌므로 URL 패턴은 사용하지 않음
  function isDownloadableImage(img) {
    const src = img.src;
    if (!src || src.startsWith('data:')) return false;
    if (/\.svg(\?|#|$)/i.test(src)) return false;
    // 로드된 이미지만 크기로 판별 (아직 로드 중이면 0 → 제외하지 않음)
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w > 0 && w < 100) return false;
    if (h > 0 && h < 100) return false;
    return true;
  }

  // 다운로드 가능 이미지 개수 — assistant 메시지 스코프 + isDownloadableImage 기준
  // executionStartSnapshot 캡처 및 collectRunImages() 슬라이스에 사용
  function getDownloadableImageCount() {
    return getAssistantImgs().filter(img => isDownloadableImage(img)).length;
  }

  // 전체 다운로드: assistant 메시지 내 다운로드 가능한 이미지 URL 수집
  // — 사용자 업로드 레퍼런스 이미지(role="user")는 자동 제외됨
  function collectImageUrls() {
    const imgs = getAssistantImgs();
    console.log('[GPT-Auto] collectImageUrls: assistant img 수=', imgs.length,
      'src 목록:', imgs.map(i => i.src.substring(0, 60)));
    const seen = new Set();
    const urls = [];
    imgs.forEach(img => {
      if (isDownloadableImage(img) && !seen.has(img.src)) {
        seen.add(img.src);
        urls.push(img.src);
      }
    });
    console.log('[GPT-Auto] collectImageUrls 결과:', urls.length, '개');
    return urls;
  }

  // 이번 실행에서 추가된 이미지만 수집 (executionStartSnapshot 이후 인덱스)
  // assistant 메시지 스코프 적용 — 스냅샷도 같은 필터로 캡처했으므로 일관성 유지
  function collectRunImages() {
    const allImgs = getAssistantImgs().filter(img => isDownloadableImage(img));
    const runImgs = allImgs.slice(executionStartSnapshot);
    const seen = new Set();
    const urls = [];
    runImgs.forEach(img => {
      const src = img.src;
      if (!seen.has(src)) {
        seen.add(src);
        urls.push(src);
      }
    });
    return urls;
  }

  // 다운로드 가능 이미지 URL 목록 반환 — prevUrlSet 캡처 및 captureNewRunImages에 사용
  function getDownloadableUrls() {
    return getAssistantImgs()
      .filter(img => isDownloadableImage(img))
      .map(img => img.src);
  }

  // 완료 감지 직후 신규 URL을 runImageUrls에 누적
  // ─ DOM 가상화(virtual scroll)로 나중에 img가 사라지기 전에 여기서 캡처하는 것이 핵심
  function captureNewRunImages(prevUrlSet) {
    const current = getDownloadableUrls();
    const newUrls = current.filter(url => !prevUrlSet.has(url));
    runImageUrls.push(...newUrls);
    console.log('[GPT-Auto] captureNewRunImages: 신규', newUrls.length, '개 (누적:', runImageUrls.length, ')');
  }

  function sleep(ms) {
    return new Promise(resolve => {
      const end = Date.now() + ms;
      const tick = () => {
        if (aborted || Date.now() >= end) { resolve(); return; }
        setTimeout(tick, Math.min(100, end - Date.now()));
      };
      tick();
    });
  }
})();
