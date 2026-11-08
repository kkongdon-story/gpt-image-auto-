import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = path.join(root, "output", "playwright", "lite-guide");
const guidePath = path.join(root, "docs", "Cardnews-Studio-Lite-사용설명서.html");
const bundledGuidePath = path.join(root, "usage.html");

async function imageData(fileName) {
  const buffer = await fs.readFile(path.join(screenshotDir, fileName));
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

const shots = {
  overview: await imageData("lite-basic-flow.png"),
  toolbar: await imageData("lite-toolbar.png"),
  backgrounds: await imageData("lite-background-manager.png"),
  lock: await imageData("lite-edition-lock.png")
};

function marker({ n, x, y, w, h, label }) {
  return `<span class="marker" style="--x:${x}%;--y:${y}%;--w:${w}%;--h:${h}%">
    <span class="marker-number">${n}</span>
    <span class="marker-label">${label}</span>
  </span>`;
}

function annotatedFigure(src, alt, caption, markers) {
  return `<figure class="annotated-figure">
    <div class="annotated-shot">
      <img src="${src}" alt="${alt}" />
      ${markers.map(marker).join("\n")}
    </div>
    <figcaption>${caption}</figcaption>
  </figure>`;
}

function step(n, title, body) {
  return `<li class="step"><span>${n}</span><div><strong>${title}</strong><p>${body}</p></div></li>`;
}

const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Cardnews Studio Lite 사용설명서</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23111111'/%3E%3Ctext x='32' y='43' text-anchor='middle' font-family='Arial' font-size='34' font-weight='700' fill='white'%3EC%3C/text%3E%3C/svg%3E" />
  <style>
    :root {
      --ink: #242424;
      --muted: #6b6b6b;
      --line: #e7e7e5;
      --soft: #f7f7f5;
      --blue: #2563eb;
      --blue-soft: #eff6ff;
      --green: #0f766e;
      --yellow: #fff7d6;
      --red: #dc2626;
      font-family: "Pretendard", "Segoe UI", "Malgun Gothic", sans-serif;
      line-height: 1.65;
      color: var(--ink);
      background: #fff;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: #fff; }
    a { color: var(--blue); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    img { display: block; max-width: 100%; }
    button, input, select { font: inherit; }
    .page { display: grid; grid-template-columns: 220px minmax(0, 920px); gap: 56px; margin: 0 auto; max-width: 1240px; padding: 48px 28px 96px; }
    .toc { align-self: start; position: sticky; top: 28px; }
    .toc-brand { border-bottom: 1px solid var(--line); margin-bottom: 18px; padding-bottom: 18px; }
    .toc-brand strong { display: block; font-size: 15px; }
    .toc-brand small { color: var(--muted); }
    .toc nav { display: grid; gap: 3px; }
    .toc nav a { border-radius: 5px; color: #555; font-size: 13px; padding: 7px 9px; text-decoration: none; }
    .toc nav a:hover { background: var(--soft); color: var(--ink); }
    main { min-width: 0; }
    .hero { border-bottom: 1px solid var(--line); padding: 24px 0 40px; }
    .icon { align-items: center; background: #111; border-radius: 8px; color: white; display: inline-flex; font-size: 27px; font-weight: 800; height: 52px; justify-content: center; margin-bottom: 24px; width: 52px; }
    .eyebrow { color: var(--muted); font-size: 13px; font-weight: 700; margin: 0 0 10px; }
    h1 { font-size: 44px; line-height: 1.14; letter-spacing: 0; margin: 0; }
    .lead { color: #4f4f4f; font-size: 18px; margin: 18px 0 0; max-width: 720px; }
    .meta { color: var(--muted); font-size: 13px; margin-top: 18px; }
    section { border-bottom: 1px solid var(--line); padding: 42px 0; scroll-margin-top: 24px; }
    section:last-of-type { border-bottom: 0; }
    h2 { font-size: 28px; line-height: 1.25; letter-spacing: 0; margin: 0 0 18px; }
    h3 { font-size: 18px; letter-spacing: 0; margin: 30px 0 10px; }
    p { margin: 0 0 12px; }
    code { background: var(--soft); border: 1px solid var(--line); border-radius: 4px; font-family: "Cascadia Mono", Consolas, monospace; font-size: .92em; padding: 2px 5px; }
    .callout { background: var(--soft); border-left: 4px solid #9ca3af; border-radius: 4px; margin: 18px 0; padding: 15px 17px; }
    .callout.info { background: var(--blue-soft); border-color: var(--blue); }
    .callout.warn { background: var(--yellow); border-color: #d4a017; }
    .callout strong { display: block; margin-bottom: 4px; }
    .file-list { border: 1px solid var(--line); border-radius: 6px; margin: 18px 0; overflow: hidden; }
    .file-row { align-items: flex-start; display: grid; gap: 14px; grid-template-columns: 32px minmax(0, 1fr); padding: 14px 16px; }
    .file-row + .file-row { border-top: 1px solid var(--line); }
    .file-icon { align-items: center; background: var(--soft); border-radius: 5px; display: flex; font-size: 12px; font-weight: 800; height: 32px; justify-content: center; }
    .file-row strong { display: block; font-size: 14px; }
    .file-row p { color: var(--muted); font-size: 13px; margin: 2px 0 0; }
    .steps { display: grid; gap: 4px; list-style: none; margin: 18px 0; padding: 0; }
    .step { align-items: flex-start; display: grid; gap: 14px; grid-template-columns: 30px minmax(0, 1fr); padding: 12px 0; }
    .step > span { align-items: center; background: #111; border-radius: 50%; color: #fff; display: flex; font-size: 13px; font-weight: 800; height: 28px; justify-content: center; width: 28px; }
    .step strong { display: block; margin-bottom: 3px; }
    .step p { color: #555; margin: 0; }
    .annotated-figure { margin: 24px 0; }
    .annotated-shot { border: 1px solid #d9d9d7; border-radius: 7px; box-shadow: 0 8px 26px rgba(0,0,0,.08); overflow: hidden; position: relative; }
    .annotated-shot img { width: 100%; }
    .marker { border: 3px solid var(--red); border-radius: 5px; height: var(--h); left: var(--x); pointer-events: none; position: absolute; top: var(--y); width: var(--w); }
    .marker-number { align-items: center; background: var(--red); border: 2px solid #fff; border-radius: 50%; color: #fff; display: flex; font-size: 12px; font-weight: 800; height: 25px; justify-content: center; left: -13px; position: absolute; top: -13px; width: 25px; }
    .marker-label { background: rgba(220,38,38,.96); border-radius: 3px; color: #fff; font-size: 11px; font-weight: 800; left: 8px; max-width: 150px; padding: 4px 7px; position: absolute; top: 7px; }
    figcaption { color: var(--muted); font-size: 12px; margin-top: 9px; }
    .legend { background: var(--soft); border-radius: 6px; display: grid; gap: 7px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: -8px 0 22px; padding: 14px; }
    .legend span { font-size: 13px; }
    .legend b { align-items: center; background: var(--red); border-radius: 50%; color: #fff; display: inline-flex; font-size: 11px; height: 20px; justify-content: center; margin-right: 6px; width: 20px; }
    table { border-collapse: collapse; margin: 18px 0; width: 100%; }
    th, td { border-bottom: 1px solid var(--line); padding: 12px 10px; text-align: left; vertical-align: top; }
    th { background: var(--soft); font-size: 13px; }
    td { font-size: 14px; }
    .yes { color: var(--green); font-weight: 800; }
    .lock { color: #9a6700; font-weight: 800; }
    details { border-bottom: 1px solid var(--line); padding: 14px 0; }
    summary { cursor: pointer; font-weight: 700; }
    details p { color: #555; margin: 10px 0 0; }
    .contact { background: #111; border-radius: 7px; color: #fff; padding: 22px; }
    .contact a { color: #a7c7ff; }
    .contact p:last-child { margin-bottom: 0; }
    footer { color: var(--muted); font-size: 12px; padding-top: 26px; }
    @media (max-width: 900px) {
      .page { display: block; padding: 24px 18px 64px; }
      .toc { background: #fff; border-bottom: 1px solid var(--line); margin-bottom: 24px; position: static; }
      .toc nav { display: flex; flex-wrap: wrap; padding-bottom: 16px; }
      h1 { font-size: 36px; }
      .legend { grid-template-columns: 1fr; }
      .marker-label { display: none; }
    }
    @media (max-width: 560px) {
      h1 { font-size: 31px; }
      h2 { font-size: 24px; }
      th:nth-child(4), td:nth-child(4) { display: none; }
      .marker { border-width: 2px; }
      .marker-number { height: 21px; width: 21px; }
    }
    @media print {
      .page { display: block; max-width: none; padding: 0; }
      .toc { display: none; }
      section, .annotated-figure, table { break-inside: avoid; }
      .annotated-shot { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <aside class="toc">
      <div class="toc-brand"><strong>Cardnews Studio Lite</strong><small>초보자 사용설명서</small></div>
      <nav aria-label="목차">
        <a href="#package">배포 파일</a>
        <a href="#install">설치하기</a>
        <a href="#screen">화면 익히기</a>
        <a href="#first">첫 카드 만들기</a>
        <a href="#text">글자 꾸미기</a>
        <a href="#background">배경 관리</a>
        <a href="#export">PNG·MP4 저장</a>
        <a href="#edition">Lite 기능 범위</a>
        <a href="#faq">문제 해결</a>
      </nav>
    </aside>

    <main>
      <header class="hero">
        <div class="icon">C</div>
        <p class="eyebrow">Cardnews Studio Lite 2.0.0</p>
        <h1>처음 시작하는<br />카드뉴스 제작 가이드</h1>
        <p class="lead">설치부터 문구 수정, 배경 관리, PNG 카드와 MP4 영상 저장까지 실제 Lite 화면을 따라가며 설명합니다.</p>
        <p class="meta">문서 갱신일 2026-07-18 · Windows 10/11 기준</p>
      </header>

      <section id="package">
        <h2>배포할 파일</h2>
        <p>일반 사용자에게는 아래 3개를 한 폴더에 담아 전달하면 됩니다. 프로그램 설치에 꼭 필요한 것은 첫 번째 EXE 하나입니다.</p>
        <div class="file-list">
          <div class="file-row"><span class="file-icon">EXE</span><div><strong>Cardnews-Studio-Lite-Setup-2.0.0.exe</strong><p>실제 설치 파일입니다. 받는 사람이 이 파일을 실행합니다.</p></div></div>
          <div class="file-row"><span class="file-icon">HTML</span><div><strong>Cardnews-Studio-Lite-사용설명서.html</strong><p>지금 보고 있는 설명서입니다. 인터넷 없이 더블클릭으로 열립니다.</p></div></div>
          <div class="file-row"><span class="file-icon">#</span><div><strong>SHA256SUMS.txt</strong><p>전송 중 파일이 손상되거나 바뀌지 않았는지 확인하는 해시값입니다.</p></div></div>
        </div>
        <div class="callout info"><strong>폴더 전체를 보내야 하나요?</strong>설치형 배포는 EXE만으로 설치됩니다. 개발 프로젝트 폴더나 <code>win-unpacked</code> 폴더를 함께 보낼 필요가 없습니다.</div>
      </section>

      <section id="install">
        <h2>1. 설치하기</h2>
        <ol class="steps">
          ${step(1, "설치 파일 실행", "<code>Cardnews-Studio-Lite-Setup-2.0.0.exe</code>를 더블클릭합니다.")}
          ${step(2, "Windows 경고 확인", "SmartScreen이 표시되면 공식 게시글이나 배포자와의 별도 메시지처럼 신뢰할 수 있는 경로에서 받은 SHA-256 값과 설치 파일을 비교합니다. 값과 출처를 모두 확인한 경우에만 <code>추가 정보</code> → <code>실행</code>을 누릅니다.")}
          ${step(3, "설치 위치 선택", "기본 위치를 그대로 사용하거나 원하는 폴더를 선택한 뒤 설치를 완료합니다.")}
          ${step(4, "앱 실행", "바탕화면의 <code>Cardnews Studio Lite</code> 바로가기를 더블클릭합니다.")}
        </ol>
        <div class="callout warn"><strong>처음 실행할 때 알아둘 점</strong>이 배포판은 개인 배포용으로 코드 서명이 없어 Windows 경고가 나올 수 있습니다. EXE와 같은 폴더의 해시 파일은 전송 오류 확인에는 도움이 되지만 배포자의 신원까지 증명하지는 않습니다. 공식 채널에 게시된 해시값을 별도로 확인할 수 없거나 출처가 불분명하면 실행하지 마세요.</div>
      </section>

      <section id="screen">
        <h2>2. 화면 익히기</h2>
        ${annotatedFigure(shots.overview, "Cardnews Studio Lite 전체 화면", "실제 Lite 앱을 실행해 캡처한 기본 화면입니다.", [
          { n: 1, x: 0.3, y: 6.5, w: 8.6, h: 91.5, label: "카드 목록" },
          { n: 2, x: 10.2, y: 8.4, w: 64.9, h: 87.5, label: "미리보기" },
          { n: 3, x: 76.0, y: 7.0, w: 23.3, h: 92.0, label: "편집 패널" },
          { n: 4, x: 92.5, y: 0.7, w: 6.6, h: 4.8, label: "내보내기" }
        ])}
        <div class="legend">
          <span><b>1</b>카드를 고르고 순서를 확인합니다.</span>
          <span><b>2</b>완성 모습을 실시간으로 확인합니다.</span>
          <span><b>3</b>내용과 디자인을 수정합니다.</span>
          <span><b>4</b>완성본을 PNG 또는 MP4로 저장합니다.</span>
        </div>
      </section>

      <section id="first">
        <h2>3. 첫 카드 만들기</h2>
        <ol class="steps">
          ${step(1, "스타일과 비율 선택", "화면 위쪽에서 카드 스타일과 비율을 선택합니다. 인스타그램 세로형은 <code>4:5</code>가 기본입니다.")}
          ${step(2, "수정할 카드 선택", "왼쪽 카드 목록에서 원하는 썸네일을 클릭합니다.")}
          ${step(3, "내용 탭 작성", "오른쪽 <code>콘텐츠 → 내용</code>에서 배지, 제목, 소제목, 본문을 입력합니다. 입력하는 즉시 가운데 미리보기가 바뀝니다.")}
          ${step(4, "디자인 탭 조절", "<code>콘텐츠 → 디자인</code>에서 글자 크기, 굵기, 정렬, 간격과 배경을 조절합니다.")}
          ${step(5, "카드 추가", "오른쪽 패널 아래 <code>카드 추가</code>를 누르고 같은 방식으로 다음 장을 작성합니다.")}
        </ol>
        <div class="callout"><strong>입력이 갑자기 안 될 때</strong>다른 카드나 탭을 한 번 클릭한 뒤 다시 입력창을 선택하세요. 제목 끝에서 줄바꿈할 때는 <code>Shift + Enter</code>가 아니라 일반 <code>Enter</code>를 사용합니다.</div>
      </section>

      <section id="text">
        <h2>4. 글자 빠르게 꾸미기</h2>
        <p>미리보기에서 텍스트 레이어를 클릭하거나 글자를 드래그하면 화면 아래에 빠른 편집 도구가 나타납니다.</p>
        ${annotatedFigure(shots.toolbar, "선택 텍스트용 플로팅 툴바", "색상, 크기, 굵기, 기울기와 정렬을 선택한 자리에서 바로 바꿀 수 있습니다.", [
          { n: 1, x: 34.0, y: 42.0, w: 35.5, h: 16.5, label: "선택한 글자" },
          { n: 2, x: 26.5, y: 91.0, w: 47.0, h: 7.5, label: "빠른 편집 도구" },
          { n: 3, x: 76.0, y: 7.0, w: 23.2, h: 91.5, label: "세부 디자인" }
        ])}
        <ul>
          <li><strong>일반 글자색:</strong> 드래그하지 않은 전체 텍스트 색상을 바꿉니다.</li>
          <li><strong>선택 글자색:</strong> 드래그한 글자만 다른 색으로 꾸밉니다.</li>
          <li><strong>크기와 굵기:</strong> 숫자를 조절한 뒤 미리보기에서 줄바꿈과 잘림을 확인합니다.</li>
          <li><strong>정렬:</strong> 왼쪽, 가운데, 오른쪽 정렬을 아이콘으로 선택합니다.</li>
        </ul>
      </section>

      <section id="background">
        <h2>5. 배경 이미지 추가와 정리</h2>
        <p><code>배경 이미지 관리</code>에서는 파일 추가, 검색, 미리보기, 적용, 삭제를 한곳에서 처리합니다.</p>
        ${annotatedFigure(shots.backgrounds, "배경 이미지 관리 창", "추가한 이미지는 앱 전용 라이브러리로 복사됩니다. 원본 파일은 이동하거나 삭제하지 않습니다.", [
          { n: 1, x: 30.5, y: 21.0, w: 39.0, h: 6.8, label: "추가·검색" },
          { n: 2, x: 30.5, y: 29.0, w: 39.0, h: 39.0, label: "이미지 목록" },
          { n: 3, x: 31.0, y: 69.0, w: 38.0, h: 12.0, label: "적용·삭제" }
        ])}
        <ol class="steps">
          ${step(1, "파일 추가", "<code>파일 추가</code>를 누르고 JPG, PNG 또는 WEBP 이미지를 선택합니다.")}
          ${step(2, "이미지 찾기", "검색창에 파일명 일부를 입력하면 많이 쌓인 이미지도 빠르게 찾을 수 있습니다.")}
          ${step(3, "배경 적용", "이미지를 선택하고 현재 카드 또는 전체 카드에 적용합니다.")}
          ${step(4, "사용하지 않는 이미지 삭제", "삭제 버튼을 누르면 앱이 보관한 복사본과 목록 항목만 삭제됩니다. 어떤 카드가 사용 중이면 먼저 다른 배경으로 바꾸라는 안내가 표시됩니다.")}
        </ol>
        <div class="callout info"><strong>다른 컴퓨터로 옮길 때</strong>설치 파일에는 기본 프리셋과 기본 폰트가 들어가지만, 사용자가 나중에 추가한 배경은 들어가지 않습니다. 원본 이미지 파일을 함께 옮긴 뒤 새 PC에서 다시 <code>파일 추가</code>하세요.</div>
        <h3>프로그램을 삭제할 때</h3>
        <p>앱을 제거해도 사용자가 선택했던 원본 이미지 파일은 삭제되지 않습니다. 다만 앱이 관리하는 배경 복사본, 설정, 작업 기록과 렌더 결과는 <code>%APPDATA%\\gpt-cardnews-auto\\gpt-cardnews-auto</code> 아래에 남을 수 있습니다. 완전히 정리하려면 필요한 결과물을 먼저 백업한 뒤 이 사용자 데이터 폴더를 직접 확인하세요.</p>
      </section>

      <section id="export">
        <h2>6. PNG 카드 또는 MP4 영상으로 저장하기</h2>
        <ol class="steps">
          ${step(1, "최종 미리보기", "카드별로 글자 잘림, 배경, 푸터와 페이지 번호를 확인합니다.")}
          ${step(2, "내보내기 열기", "오른쪽 위의 <code>내보내기</code> 버튼을 누릅니다.")}
          ${step(3, "출력 형식 선택", "사진 카드가 필요하면 <code>PNG 카드</code>, 세로형 영상이 필요하면 <code>MP4 영상</code>을 선택합니다.")}
          ${step(4, "결과 저장", "PNG는 현재 카드 또는 전체 ZIP으로 저장할 수 있습니다. MP4는 카드별 노출 시간과 전환을 반영해 1080×1920 영상으로 저장합니다.")}
        </ol>
        <div class="callout info"><strong>MP4 타임라인을 표시하려면</strong>작업판 아래의 <code>영상 만들기</code>를 켜세요. 카드별 노출 시간, 영상 구간, 음량과 기본 전환을 조절한 뒤 내보냅니다.</div>
        <div class="callout"><strong>HTML은 보이는데 PNG가 비어 있다면</strong>앱을 완전히 종료한 뒤 다시 실행하고 생성하세요. 사용자 폰트나 배경 파일이 삭제되지 않았는지도 확인합니다.</div>
      </section>

      <section id="edition">
        <h2>7. Lite에서 가능한 기능</h2>
        <table>
          <thead><tr><th>기능</th><th>Lite</th><th>설명</th></tr></thead>
          <tbody>
            <tr><td>카드 내용 작성</td><td class="yes">사용 가능</td><td>제목, 소제목, 배지, 본문, 출처, 강조 문구</td></tr>
            <tr><td>디자인 편집</td><td class="yes">사용 가능</td><td>폰트, 색상, 크기, 정렬, 간격, 레이어, 배경</td></tr>
            <tr><td>양식·스타일 관리</td><td class="yes">사용 가능</td><td>저장된 양식과 스타일 불러오기 및 적용</td></tr>
            <tr><td>PNG·MP4 내보내기</td><td class="yes">사용 가능</td><td>현재 카드 PNG, 전체 카드 ZIP, 1080×1920 MP4 영상</td></tr>
            <tr><td>AI 도우미</td><td class="lock">Pro 전용</td><td>외부 AI CLI와 대화, 리서치, 대본 생성</td></tr>
            <tr><td>CSV 대량 생성</td><td class="lock">Pro 전용</td><td>CSV 기반 여러 카드뉴스 일괄 생성</td></tr>
          </tbody>
        </table>
        ${annotatedFigure(shots.lock, "Lite의 Pro 기능 잠금 안내", "잠금 화면은 오류가 아닙니다. AI와 대량 생성은 Pro 버전에서 사용할 수 있습니다.", [
          { n: 1, x: 89.8, y: 0.7, w: 3.8, h: 4.9, label: "AI 버튼" },
          { n: 2, x: 76.2, y: 7.0, w: 23.0, h: 45.0, label: "Pro 안내" }
        ])}
      </section>

      <section id="faq">
        <h2>자주 묻는 문제</h2>
        <details open><summary>Windows가 앱 실행을 차단합니다.</summary><p>공식 배포자가 제공한 EXE인지 먼저 확인하세요. 해시는 EXE 옆 파일만 믿지 말고 공식 게시글이나 별도 메시지로 받은 기대값과 비교해야 합니다. 출처와 값이 모두 확인된 경우에만 SmartScreen의 <code>추가 정보</code>에서 실행하세요.</p></details>
        <details><summary>배경 목록에 같은 이름이 여러 개 보입니다.</summary><p>검색으로 원하는 파일을 찾고 미리보기를 확인한 뒤, 사용하지 않는 항목은 배경 관리 창에서 삭제하세요. 삭제해도 원본 파일은 지워지지 않습니다.</p></details>
        <details><summary>다른 PC에 설치했더니 내가 추가한 배경이 없습니다.</summary><p>사용자 추가 배경은 각 PC의 AppData에 따로 저장됩니다. 원본 이미지도 함께 옮긴 뒤 새 PC에서 다시 추가해야 합니다.</p></details>
        <details><summary>AI 버튼을 누르니 Pro 안내가 나옵니다.</summary><p>정상 동작입니다. Lite에서는 콘텐츠와 디자인 편집, PNG·MP4 내보내기를 사용할 수 있고 AI와 CSV 대량 생성은 Pro 전용입니다.</p></details>
        <details><summary>프로그램을 삭제하면 원본 이미지도 사라지나요?</summary><p>아니요. 앱은 선택한 이미지를 전용 라이브러리에 복사합니다. 원본 파일은 그대로 남습니다.</p></details>
      </section>

      <section>
        <div class="contact">
          <h2>문의</h2>
          <p>AX 문의·강의 문의: <a href="https://open.kakao.com/me/kkongdon">카카오톡 오픈채팅</a></p>
          <p>Threads: <strong>@kkongdon_story</strong></p>
        </div>
        <footer>Cardnews Studio Lite · by kkongdon · 이 문서는 설치 파일과 함께 배포할 수 있는 단일 HTML 파일입니다.</footer>
      </section>
    </main>
  </div>
</body>
</html>`;

await fs.mkdir(path.dirname(guidePath), { recursive: true });
await Promise.all([
  fs.writeFile(guidePath, html, "utf8"),
  fs.writeFile(bundledGuidePath, html, "utf8")
]);

console.log(`Generated ${path.relative(root, guidePath)}`);
console.log(`Generated ${path.relative(root, bundledGuidePath)}`);
