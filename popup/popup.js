const PROMPT_COUNT = 10;
const STORAGE_KEY = 'gpt-image-auto-prompts';
const GLOBAL_PROMPT_KEY = 'gpt-image-auto-global-prompt';
const GLOBAL_REF_KEY = 'gpt-image-auto-global-ref';
const MODE_KEY = 'gpt-image-auto-mode';
const SIZE_RATIO_KEY = 'gpt-auto-size-ratio';
const STYLE_PRESET_KEY = 'gpt-auto-style-preset';
const FONT_PRESET_KEY  = 'gpt-auto-font-preset';

const MODE_HINTS = {
  instant:  '90초 대기',
  thinking: '4분 대기',
  pro:      '10분 대기',
};

const globalPromptInput = document.getElementById('global-prompt');
const promptsContainer = document.getElementById('prompts-container');
const btnRun = document.getElementById('btn-run');
const btnStop = document.getElementById('btn-stop');
const btnReset = document.getElementById('btn-reset');
const btnDownload = document.getElementById('btn-download');
const btnDownloadRun = document.getElementById('btn-download-run');
const btnSelectAll = document.getElementById('btn-select-all');
const btnClearAll = document.getElementById('btn-clear-all');
const btnImportMd = document.getElementById('btn-import-md');
const mdFileInput = document.getElementById('md-file-input');
const selectCountEl = document.getElementById('select-count');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const errorSection = document.getElementById('error-section');
const errorText = document.getElementById('error-text');

const inputs = [];
const checkboxes = [];
const rows = [];
const attachedImages = Array.from({ length: PROMPT_COUNT }, () => []); // string[] (0~3개), 세션 메모리만
let dragSrcIndex = null;
let failedIndices = new Set();
let currentSelectedIndices = []; // 실행 중인 선택 인덱스 매핑 (큐 인덱스 → inputs[] 인덱스)

// ── 전역 참고 양식 이미지 ──────────────────────────
// localStorage에 base64로 저장. 실행 시 모든 카드 images 배열 앞에 자동 prepend
let globalRefImage = null;
try {
  globalRefImage = localStorage.getItem(GLOBAL_REF_KEY) || null;
} catch (e) { /* localStorage 용량 초과 시 무시 */ }

const globalRefEmptyEl = document.getElementById('global-ref-empty');
const globalRefPreviewEl = document.getElementById('global-ref-preview');
const globalRefThumbEl = document.getElementById('global-ref-thumb');
const btnGlobalRef = document.getElementById('btn-global-ref');
const btnGlobalRefRemove = document.getElementById('btn-global-ref-remove');
const globalRefInput = document.getElementById('global-ref-input');

function updateGlobalRefUI() {
  if (globalRefImage) {
    globalRefEmptyEl.style.display = 'none';
    globalRefPreviewEl.style.display = 'flex';
    globalRefThumbEl.src = globalRefImage;
  } else {
    globalRefEmptyEl.style.display = 'flex';
    globalRefPreviewEl.style.display = 'none';
    globalRefThumbEl.src = '';
  }
  // 카드별 슬롯 제한 업데이트 (전역 이미지 있으면 최대 2장, 없으면 3장)
  updateAttachLimits();
}

// 전역 이미지 유무에 따라 첨부 버튼 disabled 상태 재계산
function updateAttachLimits() {
  const maxPerCard = globalRefImage ? 2 : 3;
  rows.forEach((row, i) => {
    const attachBtn = row.querySelector('.btn-attach');
    if (attachBtn) {
      attachBtn.disabled = attachedImages[i].length >= maxPerCard;
      attachBtn.title = globalRefImage
        ? `참고 이미지 첨부 (전역 이미지 있으므로 최대 ${maxPerCard}장)`
        : `참고 이미지 첨부 (최대 ${maxPerCard}장)`;
    }
  });
}

btnGlobalRef.addEventListener('click', () => globalRefInput.click());

globalRefInput.addEventListener('change', () => {
  const file = globalRefInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      globalRefImage = e.target.result;
      localStorage.setItem(GLOBAL_REF_KEY, globalRefImage);
    } catch (storageErr) {
      showError('이미지 용량이 너무 큽니다. 더 작은 이미지를 사용해주세요.');
      globalRefImage = null;
    }
    updateGlobalRefUI();
  };
  reader.readAsDataURL(file);
  globalRefInput.value = '';
});

btnGlobalRefRemove.addEventListener('click', () => {
  globalRefImage = null;
  localStorage.removeItem(GLOBAL_REF_KEY);
  updateGlobalRefUI();
});

updateGlobalRefUI(); // 저장된 전역 이미지 복원
// ─────────────────────────────────────────────────

// 전역 지침 복원 + 자동 저장
globalPromptInput.value = localStorage.getItem(GLOBAL_PROMPT_KEY) || '';
globalPromptInput.addEventListener('input', () => {
  localStorage.setItem(GLOBAL_PROMPT_KEY, globalPromptInput.value);
});

// ── 모드 선택 (instant / thinking / pro) ─────────
let selectedMode = localStorage.getItem(MODE_KEY) || 'instant';

const modeBtns = document.querySelectorAll('.mode-btn');
const modeHint = document.getElementById('mode-hint');

function setMode(mode) {
  selectedMode = mode;
  localStorage.setItem(MODE_KEY, mode);
  modeBtns.forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode)
  );
  modeHint.textContent = MODE_HINTS[mode] || '';
}

setMode(selectedMode); // 저장된 모드 복원

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});
// ─────────────────────────────────────────────────

// ── 이미지 비율 선택 (v2.2) ──────────────────────
let selectedRatio = localStorage.getItem(SIZE_RATIO_KEY) || null;

const ratioBtns = document.querySelectorAll('.ratio-btn');

function setRatio(ratio) {
  // 같은 버튼 재클릭 → none (비활성)으로 토글
  selectedRatio = (selectedRatio === ratio) ? null : ratio;
  if (selectedRatio) {
    localStorage.setItem(SIZE_RATIO_KEY, selectedRatio);
  } else {
    localStorage.removeItem(SIZE_RATIO_KEY);
  }
  ratioBtns.forEach(btn =>
    btn.classList.toggle('active', btn.dataset.ratio === selectedRatio)
  );
}

// 저장된 비율 복원
ratioBtns.forEach(btn => {
  btn.classList.toggle('active', btn.dataset.ratio === selectedRatio);
  btn.addEventListener('click', () => setRatio(btn.dataset.ratio));
});
// ─────────────────────────────────────────────────

// ── 스타일 + 글꼴 선택 (v2.2) ────────────────────
const styleSelect = document.getElementById('style-select');
const fontSelect  = document.getElementById('font-select');

// 저장된 값 복원
styleSelect.value = localStorage.getItem(STYLE_PRESET_KEY) || '';
fontSelect.value  = localStorage.getItem(FONT_PRESET_KEY)  || '';

styleSelect.addEventListener('change', () => {
  if (styleSelect.value) {
    localStorage.setItem(STYLE_PRESET_KEY, styleSelect.value);
  } else {
    localStorage.removeItem(STYLE_PRESET_KEY);
  }
});

fontSelect.addEventListener('change', () => {
  if (fontSelect.value) {
    localStorage.setItem(FONT_PRESET_KEY, fontSelect.value);
  } else {
    localStorage.removeItem(FONT_PRESET_KEY);
  }
});
// ─────────────────────────────────────────────────

const savedPrompts = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

for (let i = 0; i < PROMPT_COUNT; i++) {
  const row = document.createElement('div');
  row.className = 'prompt-row';
  row.draggable = true;
  row.dataset.index = i;

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.title = '드래그로 순서 변경';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'prompt-checkbox';
  checkbox.checked = true;
  checkbox.addEventListener('change', updateSelectCount);

  const num = document.createElement('span');
  num.className = 'prompt-number';
  num.textContent = i + 1;

  const textarea = document.createElement('textarea');
  textarea.className = 'prompt-input';
  textarea.placeholder = `프롬프트 #${i + 1}을 입력하세요`;
  textarea.rows = 1;

  if (savedPrompts[i]) {
    textarea.value = savedPrompts[i];
    setTimeout(() => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }, 0);
  }

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
    savePrompts();
  });

  // ── 이미지 첨부 UI ──────────────────────────────
  // 숨겨진 file input (실제 파일 선택 트리거)
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const maxPerCard = globalRefImage ? 2 : 3;
    if (attachedImages[i].length >= maxPerCard) {
      showToast(globalRefImage
        ? `전역 이미지가 등록되어 카드당 최대 ${maxPerCard}장까지만 첨부할 수 있어요.`
        : `이미지는 최대 ${maxPerCard}장까지 첨부할 수 있어요.`);
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      attachedImages[i].push(e.target.result); // string[] 배열에 추가
      showAttachThumb(i);
    };
    reader.readAsDataURL(file);
    fileInput.value = ''; // 같은 파일 재선택 허용
  });

  // 📎 첨부 버튼
  const attachBtn = document.createElement('button');
  attachBtn.className = 'btn-attach';
  attachBtn.textContent = '📎';
  attachBtn.title = '참고 이미지 첨부';
  attachBtn.addEventListener('click', () => fileInput.click());

  // 썸네일 래퍼 (이미지 선택 후 표시)
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'attach-thumb-wrap';
  thumbWrap.style.display = 'none';
  // ────────────────────────────────────────────────

  row.appendChild(handle);
  row.appendChild(checkbox);
  row.appendChild(num);
  row.appendChild(textarea);
  row.appendChild(fileInput);
  row.appendChild(attachBtn);
  row.appendChild(thumbWrap);
  promptsContainer.appendChild(row);
  inputs.push(textarea);
  checkboxes.push(checkbox);
  rows.push(row);

  setupDragEvents(row, i);
}

updateSelectCount();
updateAttachLimits(); // rows 구성 완료 후 전역 이미지 기반 슬롯 제한 초기 적용

// 썸네일 표시 함수 — attachedImages[idx] 배열을 읽어 최대 3개 나란히 렌더링
function showAttachThumb(idx) {
  const row = rows[idx];
  const thumbWrap = row.querySelector('.attach-thumb-wrap');
  // 기존 내용 전체 제거
  while (thumbWrap.firstChild) thumbWrap.removeChild(thumbWrap.firstChild);

  const images = attachedImages[idx];
  if (!images || images.length === 0) {
    thumbWrap.style.display = 'none';
    return;
  }

  images.forEach((dataUrl, j) => {
    const item = document.createElement('div');
    item.className = 'attach-thumb-item';

    const img = document.createElement('img');
    img.className = 'attach-thumb';
    img.src = dataUrl;
    img.alt = `첨부 이미지 ${j + 1}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-attach-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = `이미지 ${j + 1} 제거`;
    // j를 클로저로 캡처 — splice로 해당 인덱스만 제거 후 재렌더링
    removeBtn.addEventListener('click', () => {
      attachedImages[idx].splice(j, 1);
      showAttachThumb(idx);
    });

    item.appendChild(img);
    item.appendChild(removeBtn);
    thumbWrap.appendChild(item);
  });

  thumbWrap.style.display = 'flex';
}

function updateSelectCount() {
  const n = checkboxes.filter(cb => cb.checked).length;
  selectCountEl.textContent = `${n}개 선택됨`;
}

btnSelectAll.addEventListener('click', () => {
  const allChecked = checkboxes.every(cb => cb.checked);
  checkboxes.forEach(cb => { cb.checked = !allChecked; });
  updateSelectCount();
});

btnClearAll.addEventListener('click', () => {
  inputs.forEach(input => {
    input.value = '';
    input.style.height = 'auto';
    input.classList.remove('active', 'done', 'error');
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array(PROMPT_COUNT).fill('')));
  globalPromptInput.value = '';
  localStorage.removeItem(GLOBAL_PROMPT_KEY);
  updateSelectCount();
});

function setupDragEvents(row, idx) {
  row.addEventListener('dragstart', (e) => {
    dragSrcIndex = getRowIndex(row);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    rows.forEach(r => r.classList.remove('drag-over'));
    dragSrcIndex = null;
  });

  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    rows.forEach(r => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });

  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const destIndex = getRowIndex(row);
    if (dragSrcIndex === null || dragSrcIndex === destIndex) return;

    // 텍스트 교체
    const srcVal = inputs[dragSrcIndex].value;
    inputs[dragSrcIndex].value = inputs[destIndex].value;
    inputs[destIndex].value = srcVal;

    // 체크박스 상태 교체
    const srcChecked = checkboxes[dragSrcIndex].checked;
    checkboxes[dragSrcIndex].checked = checkboxes[destIndex].checked;
    checkboxes[destIndex].checked = srcChecked;

    // 첨부 이미지 배열 교체 + 썸네일 UI 동기화
    const srcImgs = attachedImages[dragSrcIndex];
    attachedImages[dragSrcIndex] = attachedImages[destIndex];
    attachedImages[destIndex] = srcImgs;
    showAttachThumb(dragSrcIndex);
    showAttachThumb(destIndex);

    inputs[dragSrcIndex].style.height = 'auto';
    inputs[dragSrcIndex].style.height = inputs[dragSrcIndex].scrollHeight + 'px';
    inputs[destIndex].style.height = 'auto';
    inputs[destIndex].style.height = inputs[destIndex].scrollHeight + 'px';

    savePrompts();
    updateSelectCount();
    row.classList.remove('drag-over');
  });
}

function getRowIndex(row) {
  return rows.indexOf(row);
}

function savePrompts() {
  const values = inputs.map(input => input.value);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
}

btnRun.addEventListener('click', () => {
  // 체크된 프롬프트 + 대응하는 이미지 수집
  const selectedIndices = inputs
    .map((_, i) => i)
    .filter(i => checkboxes[i].checked && inputs[i].value.trim().length > 0);

  currentSelectedIndices = selectedIndices; // PROGRESS_UPDATE 인덱스 역매핑용
  const prompts = selectedIndices.map(i => inputs[i].value.trim());
  // 전역 참고 이미지가 있으면 각 카드의 첨부 배열 맨 앞에 자동 삽입
  const images = selectedIndices.map(i => {
    const cardImgs = attachedImages[i];
    return globalRefImage ? [globalRefImage, ...cardImgs] : cardImgs;
  });

  if (prompts.length === 0) {
    showError('최소 1개의 프롬프트를 선택하고 입력해주세요.');
    return;
  }

  const globalPrompt = globalPromptInput.value.trim();

  hideError();
  failedIndices.clear();
  btnDownload.style.display = 'none';
  btnDownloadRun.style.display = 'none';
  setRunningUI(true);
  updateProgress(0, prompts.length, '시작 중...');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) {
      showError('ChatGPT 탭을 찾을 수 없습니다. ChatGPT를 먼저 열어주세요.');
      setRunningUI(false);
      return;
    }
    chrome.runtime.sendMessage({
      type: 'START_GENERATION',
      prompts,
      globalPrompt,
      images,
      waitMode: selectedMode,
      sizeRatio:    selectedRatio,            // v2.2: 비율 선택값
      stylePreset:  styleSelect.value || null, // v2.2: 스타일 선택값
      fontPreset:   fontSelect.value  || null, // v2.2: 글꼴 선택값
      tabId
    }, (response) => {
      if (chrome.runtime.lastError) {
        showError('백그라운드 오류: ' + chrome.runtime.lastError.message);
        setRunningUI(false);
      }
    });
  });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_GENERATION' });
  setRunningUI(false);
  updateProgress(0, 1, '중지됨');
});

function triggerDownload(btn, msgType, originalLabel) {
  btn.disabled = true;
  btn.textContent = '다운로드 중...';
  chrome.runtime.sendMessage({ type: msgType });
  // 5초 후 버튼 복원 — 다운로드는 background에서 비동기로 처리됨
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }, 5000);
}

btnDownload.addEventListener('click', () => {
  triggerDownload(btnDownload, 'DOWNLOAD_IMAGES', '전체 다운로드');
});

btnDownloadRun.addEventListener('click', () => {
  triggerDownload(btnDownloadRun, 'DOWNLOAD_RUN_IMAGES', '이번 실행분 다운로드');
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS_UPDATE') {
    // v2.2: 팝업이 초기 상태인 채로 PROGRESS_UPDATE를 받은 경우 (SW 재시작 후 GET_STATUS race)
    // 진행 UI로 자동 전환 — 이미 running UI이면 setRunningUI는 아무 부작용 없음
    if (btnRun.style.display !== 'none') {
      setRunningUI(true);
    }
    updateProgress(msg.current, msg.total, msg.status);
    const inputIdx = currentSelectedIndices[msg.currentIndex] ?? msg.currentIndex;
    highlightPrompt(inputIdx, msg.status);

    if (msg.status === '오류') {
      failedIndices.add(inputIdx);
    }
  }

  if (msg.type === 'ALL_COMPLETE') {
    showCompleteView(msg.successCount, msg.errorCount, msg.total);
    showRetryButtons();
  }

  if (msg.type === 'GENERATION_ERROR') {
    showError(msg.error);
    // 다운로드 실패 시 버튼 즉시 복원
    if (btnDownload.disabled) {
      btnDownload.disabled = false;
      btnDownload.textContent = '전체 다운로드';
    }
    if (btnDownloadRun.disabled) {
      btnDownloadRun.disabled = false;
      btnDownloadRun.textContent = '이번 실행분 다운로드';
    }
  }
});

// 팝업 열릴 때 백그라운드 상태 확인 → 화면 복원 (팝업 상태 유지 v2.2)
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (chrome.runtime.lastError || !response) return;
  if (response.running) {
    setRunningUI(true);
    updateProgress(response.current, response.total, response.status);
  } else if (response.lastRunComplete) {
    // 팝업이 닫혔다가 재열기 → 완료 화면 복원
    showCompleteView(response.successCount, response.errorCount, response.total);
  }
});

function setRunningUI(running) {
  btnRun.style.display = running ? 'none' : 'block';
  btnStop.style.display = running ? 'block' : 'none';
  // v2.2: 실행 중에만 초기화 버튼 표시 (완료 시엔 showCompleteView가 별도 처리)
  btnReset.style.display = running ? 'block' : 'none';
  progressSection.style.display = 'block';
  inputs.forEach(input => input.disabled = running);
  checkboxes.forEach(cb => cb.disabled = running);
  btnSelectAll.disabled = running;
  btnImportMd.disabled = running;
  // 실행 중 첨부 버튼 + 전역 이미지 버튼 비활성화
  document.querySelectorAll('.btn-attach').forEach(btn => btn.disabled = running);
  btnGlobalRef.disabled = running;
  if (btnGlobalRefRemove) btnGlobalRefRemove.disabled = running;

  if (running) {
    removeRetryButtons();
    btnDownload.style.display = 'none';
    btnDownloadRun.style.display = 'none';
  }
}

// v2.2: 완료 화면 — 실행 버튼 없이 [다운로드] + [초기화]만 표시
function showCompleteView(successCount, errorCount, total) {
  btnRun.style.display = 'none';
  btnStop.style.display = 'none';
  btnReset.style.display = 'block';
  progressSection.style.display = 'block';
  updateProgress(total, total, `완료! (성공: ${successCount}, 실패: ${errorCount})`);

  if (successCount > 0) {
    btnDownload.style.display = 'block';
    btnDownloadRun.style.display = 'block';
  }

  // 입력 요소 재활성화 (스크롤 확인은 가능하게)
  inputs.forEach(input => input.disabled = false);
  checkboxes.forEach(cb => cb.disabled = false);
  btnSelectAll.disabled = false;
  btnImportMd.disabled = false;
  document.querySelectorAll('.btn-attach').forEach(btn => btn.disabled = false);
  btnGlobalRef.disabled = false;
  if (btnGlobalRefRemove) btnGlobalRefRemove.disabled = false;
  updateAttachLimits();
}

// v2.2: 초기 화면 복귀 — 모든 상태를 처음 열었을 때로 리셋
function showInitialView() {
  btnRun.style.display = 'block';
  btnStop.style.display = 'none';
  btnReset.style.display = 'none';
  btnDownload.style.display = 'none';
  btnDownloadRun.style.display = 'none';
  progressSection.style.display = 'none';
  progressBar.style.width = '0%';
  progressText.textContent = '대기중';

  inputs.forEach(input => {
    input.disabled = false;
    input.classList.remove('active', 'done', 'error');
  });
  checkboxes.forEach(cb => cb.disabled = false);
  btnSelectAll.disabled = false;
  btnImportMd.disabled = false;
  document.querySelectorAll('.btn-attach').forEach(btn => btn.disabled = false);
  btnGlobalRef.disabled = false;
  if (btnGlobalRefRemove) btnGlobalRefRemove.disabled = false;

  removeRetryButtons();
  hideError();
  updateAttachLimits();
}

// v2.2: 초기화 버튼 핸들러
btnReset.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_GENERATION' });   // 실행 중이면 정지
  chrome.runtime.sendMessage({ type: 'RESET_STATE' });        // lastRunComplete 클리어
  showInitialView();
});

function updateProgress(current, total, status) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  progressBar.style.width = pct + '%';
  progressText.textContent = `${current}/${total} — ${status}`;
}

function highlightPrompt(index, status) {
  inputs.forEach((input, i) => {
    input.classList.remove('active', 'done', 'error');
    if (i < index) input.classList.add('done');
    else if (i === index) {
      input.classList.add(status === '오류' ? 'error' : 'active');
    }
  });
}

function showRetryButtons() {
  failedIndices.forEach(idx => {
    const row = rows[idx];
    if (!row || row.querySelector('.btn-retry')) return;

    const btn = document.createElement('button');
    btn.className = 'btn-retry';
    btn.textContent = '재시도';
    btn.addEventListener('click', () => retryPrompt(idx));
    row.appendChild(btn);
  });
}

function removeRetryButtons() {
  document.querySelectorAll('.btn-retry').forEach(btn => btn.remove());
}

function retryPrompt(index) {
  const promptText = inputs[index].value.trim();
  if (!promptText) return;

  inputs[index].classList.remove('error');
  inputs[index].classList.add('active');

  const retryBtn = rows[index].querySelector('.btn-retry');
  if (retryBtn) retryBtn.remove();
  failedIndices.delete(index);

  const globalPrompt = globalPromptInput.value.trim();
  const cardImgs = attachedImages[index];
  const images = [globalRefImage ? [globalRefImage, ...cardImgs] : cardImgs];

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) {
      showError('ChatGPT 탭을 찾을 수 없습니다.');
      inputs[index].classList.remove('active');
      inputs[index].classList.add('error');
      return;
    }

    currentSelectedIndices = [index]; // 재시도 단일 카드 매핑
    chrome.runtime.sendMessage({
      type: 'START_GENERATION',
      prompts: [promptText],
      globalPrompt,
      images,
      waitMode: selectedMode,
      sizeRatio:   selectedRatio,
      stylePreset: styleSelect.value || null,
      fontPreset:  fontSelect.value  || null,
      tabId
    }, (response) => {
      if (chrome.runtime.lastError) {
        showError('ChatGPT 탭을 찾을 수 없습니다.');
        inputs[index].classList.remove('active');
        inputs[index].classList.add('error');
      }
    });
  });
}

function showError(message) {
  errorSection.style.display = 'block';
  errorText.textContent = message;
}

function hideError() {
  errorSection.style.display = 'none';
  errorText.textContent = '';
}

// ── MD 파일 불러오기 ────────────────────────────────
btnImportMd.addEventListener('click', () => mdFileInput.click());

mdFileInput.addEventListener('change', () => {
  const file = mdFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const parsed = parseMdFile(e.target.result);
    applyMdImport(parsed);
  };
  reader.readAsText(file, 'UTF-8');
  mdFileInput.value = ''; // 같은 파일 재선택 허용
});

/**
 * MD 파일 자유 형식 파서 v2
 *
 * 1차: ## 헤딩 기반 섹션 분리 (우선)
 *   - "## Global Style Instruction", "## 전역 스타일 지침" 등 → 전역 지침
 *   - "## Card N ...", "## Slide N ...", "## Prompt N ...", "## N" 등 → 개별 프롬프트
 *   - 번호가 없는 헤딩("## Official Documentation Context" 등) → 무시
 *
 * 2차: 인라인 패턴 폴백 (## 헤딩이 없거나 번호 섹션 미발견 시)
 *   - "슬라이드 N: text" / "Slide N: text" 접두어
 *   - "1. text", "2. text" 번호 목록
 *   - 단락 분리 (빈 줄 기준, 첫 단락 → 전역)
 */
function parseMdFile(text) {
  // ## 헤딩이 있으면 섹션 기반 파싱 시도
  if (/^##\s/m.test(text)) {
    const result = parseBySections(text);
    if (result.prompts.length > 0) return result;
    // 섹션 인식됐지만 번호 프롬프트 없으면 인라인으로 재시도
  }
  return parseByInlinePatterns(text);
}

/**
 * ## 헤딩으로 섹션을 나눠 전역/개별 프롬프트 추출
 * "## Card 1 Prompt", "## 1", "## Slide 3" 등 모두 지원
 */
function parseBySections(text) {
  const result = { global: '', prompts: [] };
  const slots = new Array(PROMPT_COUNT).fill(''); // 최대 10 슬롯

  // ## 헤딩 기준으로 블록 분리 (### 이상 깊은 헤딩은 content로 처리)
  const blocks = [];
  let cur = { heading: null, lines: [] };
  for (const raw of text.split('\n')) {
    if (/^##\s/.test(raw)) {                      // ## only (not ###)
      blocks.push(cur);
      cur = { heading: raw.replace(/^#+\s*/, '').trim(), lines: [] };
    } else if (/^#\s/.test(raw)) {
      // H1 제목 — 건너뜀
    } else {
      cur.lines.push(raw);
    }
  }
  blocks.push(cur);

  for (const block of blocks) {
    if (!block.heading) continue;
    const content = block.lines.join('\n').trim();
    if (!content) continue;

    // ── 전역 지침 헤딩 감지 ──
    // "Global Style Instruction", "전역 스타일 지침", "공통", "스타일" 등
    if (/global|전역|공통|style[\s_-]?instruction|instruction[\s_-]?style/i.test(block.heading)) {
      result.global = content;
      continue;
    }

    // ── 번호 프롬프트 헤딩 감지 ──
    // 지원: "Card 1", "Slide 2", "Prompt 3", "카드 4", "1", "1 제목", "Prompt-5"
    const numMatch =
      block.heading.match(/(?:card|카드|slide|슬라이드|prompt|프롬프트)[\s-]+(\d+)/i) ||
      block.heading.match(/(\d+)[\s.-]*(?:card|카드|slide|슬라이드|prompt|프롬프트)?(?:\s|$)/i);

    if (numMatch) {
      const idx = parseInt(numMatch[1]) - 1; // 1-based → 0-based
      if (idx >= 0 && idx < PROMPT_COUNT) {
        slots[idx] = content;
      }
      continue;
    }

    // 번호 없는 헤딩("Official Documentation Context" 등) → 무시
  }

  result.prompts = slots; // 위치 정보 보존 (길이 항상 PROMPT_COUNT)
  return result;
}

/**
 * ## 헤딩 없는 단순 형식용 인라인 패턴 파서
 * "슬라이드 N: text", "1. text", 단락 분리 순으로 시도
 */
function parseByInlinePatterns(text) {
  const result = { global: '', prompts: [] };
  const globalCandidates = [];
  const slideItems = {};
  const numberedItems = {};

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || /^#+/.test(line)) continue; // 빈 줄/헤딩 건너뜀

    // "슬라이드 N: text" / "Slide N: text"
    const slideMatch = line.match(/^(?:슬라이드|slide)\s*(\d+)\s*[:.]\s*(.*)/i);
    if (slideMatch) { slideItems[parseInt(slideMatch[1])] = slideMatch[2].trim(); continue; }

    // "N. text" / "N) text"
    const numMatch = line.match(/^(\d+)[.)]\s+(.*)/);
    if (numMatch) { numberedItems[parseInt(numMatch[1])] = numMatch[2].trim(); continue; }

    // 나머지 → 전역 지침 후보 (**볼드 레이블**: 접두어 제거)
    const cleaned = line
      .replace(/^\*\*[^*]*\*\*\s*[:.]?\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .trim();
    if (cleaned) globalCandidates.push(cleaned);
  }

  if (Object.keys(slideItems).length > 0) {
    result.global = globalCandidates.join('\n');
    for (let i = 1; i <= PROMPT_COUNT; i++) {
      if (slideItems[i]) result.prompts.push(slideItems[i]);
    }
  } else if (Object.keys(numberedItems).length > 0) {
    result.global = globalCandidates.join('\n');
    for (let i = 1; i <= PROMPT_COUNT; i++) {
      if (numberedItems[i]) result.prompts.push(numberedItems[i]);
    }
  } else {
    // 최후 폴백: 빈 줄 단락 분리 (첫 단락 → 전역)
    const paragraphs = text
      .split(/\n\s*\n/)
      .map(p => p.replace(/^#+\s*/gm, '').trim())
      .filter(Boolean);
    if (paragraphs.length > 0) {
      result.global = paragraphs[0];
      result.prompts = paragraphs.slice(1, PROMPT_COUNT + 1);
    }
  }

  return result;
}

/** 파싱 결과를 팝업 입력 필드에 적용 */
function applyMdImport(parsed) {
  if (parsed.global) {
    globalPromptInput.value = parsed.global;
    localStorage.setItem(GLOBAL_PROMPT_KEY, parsed.global);
    globalPromptInput.style.height = 'auto';
    globalPromptInput.style.height = globalPromptInput.scrollHeight + 'px';
  }

  // parseBySections → 길이 10 희소 배열 (위치 보존)
  // parseByInlinePatterns → 길이 < 10 컴팩트 배열 (순차 배치)
  const isSparse = parsed.prompts.length === PROMPT_COUNT;

  parsed.prompts.forEach((text, i) => {
    if (i >= PROMPT_COUNT) return;
    if (text) {
      inputs[i].value = text;
      inputs[i].style.height = 'auto';
      inputs[i].style.height = inputs[i].scrollHeight + 'px';
      checkboxes[i].checked = true;
    } else if (isSparse) {
      // 희소 배열: 빈 슬롯은 체크 해제 (해당 카드 번호가 MD에 없음)
      checkboxes[i].checked = false;
    }
  });

  // 컴팩트 배열: 뒤쪽 남은 슬롯 체크 해제
  if (!isSparse) {
    for (let i = parsed.prompts.length; i < PROMPT_COUNT; i++) {
      checkboxes[i].checked = false;
    }
  }

  savePrompts();
  updateSelectCount();

  const count = parsed.prompts.filter(Boolean).length;
  const globalLabel = parsed.global ? '전역 지침 + ' : '';
  showToast(`📄 ${globalLabel}프롬프트 ${count}개 불러오기 완료`);
}
// ─────────────────────────────────────────────────

// Threads 아이콘 클릭 — 새 탭으로 열기
document.getElementById('threads-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://www.threads.com/@kkongdon_story' });
});

// 이미지 최대 3장 초과 시 표시하는 일시적 토스트 메시지
function showToast(message, durationMs = 2000) {
  let toast = document.getElementById('attach-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'attach-toast';
    toast.className = 'attach-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('visible'), durationMs);
}
