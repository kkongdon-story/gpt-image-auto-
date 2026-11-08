import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = path.join(root, "output", "playwright", "manual-guide");

const screenshots = {
  proOverview: imageData("pro-overview.png"),
  proContent: imageData("pro-content-panel.png"),
  proDesign: imageData("pro-design-panel.png"),
  proExport: imageData("pro-export-panel.png"),
  proAi: imageData("pro-ai-panel.png"),
  liteOverview: imageData("lite-overview.png"),
  liteLock: imageData("lite-pro-lock.png")
};

async function imageData(fileName) {
  const buffer = await fs.readFile(path.join(screenshotDir, fileName));
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function featureRow(feature, lite, pro, note) {
  return `<tr><th>${feature}</th><td>${lite}</td><td>${pro}</td><td>${note}</td></tr>`;
}

function step(title, body) {
  return `<article class="step-card"><span>${title}</span><p>${body}</p></article>`;
}

function codeBlock(value) {
  return `<pre><code>${value}</code></pre>`;
}

function figure(src, caption, alt) {
  return `<figure><img src="${src}" alt="${alt}" /><figcaption>${caption}</figcaption></figure>`;
}

const resolvedScreenshots = Object.fromEntries(
  await Promise.all(Object.entries(screenshots).map(async ([key, value]) => [key, await value]))
);

const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cardnews Studio Lite/Pro 사용설명서</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%236b4cff'/%3E%3Ctext x='32' y='40' text-anchor='middle' font-size='28' font-family='Arial' fill='white'%3EC%3C/text%3E%3C/svg%3E" />
    <style>
      :root {
        color-scheme: light;
        --ink: #15171a;
        --muted: #5d6472;
        --line: #dfe3ea;
        --paper: #ffffff;
        --soft: #f5f7fb;
        --accent: #5f4df6;
        --accent-2: #0f766e;
        --warn: #a15c00;
        --radius: 8px;
        font-family: "Pretendard", "Segoe UI", "Malgun Gothic", sans-serif;
        line-height: 1.7;
      }

      * { box-sizing: border-box; }
      body { margin: 0; background: var(--soft); color: var(--ink); }
      a { color: #2f43c7; }
      .shell { margin: 0 auto; max-width: 1180px; padding: 36px 22px 80px; }
      header { display: grid; gap: 18px; grid-template-columns: 1.2fr 0.8fr; align-items: end; border-bottom: 1px solid var(--line); padding: 22px 0 28px; }
      h1 { font-size: clamp(34px, 4.2vw, 52px); line-height: 1.08; margin: 0; letter-spacing: 0; word-break: keep-all; }
      h2 { font-size: clamp(24px, 3vw, 34px); margin: 48px 0 14px; letter-spacing: 0; }
      h3 { font-size: 18px; margin: 0 0 8px; letter-spacing: 0; }
      p { margin: 0 0 12px; }
      ul, ol { margin: 10px 0 0; padding-left: 22px; }
      li + li { margin-top: 6px; }
      code, pre { font-family: "Cascadia Mono", Consolas, monospace; }
      code { background: #eef1f6; border: 1px solid var(--line); border-radius: 5px; padding: 2px 5px; }
      pre { background: #10131a; border-radius: var(--radius); color: #f2f4f8; overflow: auto; padding: 16px; white-space: pre-wrap; }
      pre code { background: transparent; border: 0; color: inherit; padding: 0; }
      table { width: 100%; border-collapse: collapse; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
      th, td { border-bottom: 1px solid var(--line); padding: 12px 14px; text-align: left; vertical-align: top; }
      th { background: #f0f3f8; width: 22%; }
      tr:last-child th, tr:last-child td { border-bottom: 0; }
      img { display: block; width: 100%; height: auto; border-radius: var(--radius); border: 1px solid var(--line); background: #fff; }
      figure { margin: 0; }
      figcaption { color: var(--muted); font-size: 13px; margin-top: 7px; }
      .eyebrow { color: var(--accent); font-size: 13px; font-weight: 800; letter-spacing: 0; margin-bottom: 8px; }
      .summary { color: var(--muted); font-size: 18px; max-width: 760px; }
      .meta { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .two { display: grid; gap: 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .panel { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; }
      .step-card { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; }
      .step-card span { align-items: center; background: var(--accent); border-radius: 999px; color: #fff; display: inline-flex; font-size: 13px; font-weight: 800; height: 26px; justify-content: center; min-width: 26px; padding: 0 10px; margin-bottom: 10px; }
      .callout { background: #fff8e8; border: 1px solid #f0c36a; border-radius: var(--radius); color: #4a3400; padding: 16px; }
      .good { background: #ebfbf7; border-color: #9ad8c8; color: #063f38; }
      .toc { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
      .toc a { background: var(--paper); border: 1px solid var(--line); border-radius: 999px; color: var(--ink); padding: 8px 12px; text-decoration: none; }
      .tag { border-radius: 999px; color: #fff; display: inline-flex; font-size: 12px; font-weight: 800; padding: 2px 9px; }
      .tag-lite { background: var(--accent-2); }
      .tag-pro { background: var(--accent); }
      footer { border-top: 1px solid var(--line); color: var(--muted); margin-top: 56px; padding-top: 18px; }

      @media (max-width: 860px) {
        header, .two { grid-template-columns: 1fr; }
        .shell { padding: 24px 14px 56px; }
        th, td { display: block; width: 100%; }
        th { border-bottom: 0; }
      }

      @media print {
        body { background: #fff; }
        .shell { max-width: none; padding: 0; }
        .panel, .step-card, .meta, table, img { break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header>
        <div>
          <p class="eyebrow">Cardnews Studio Lite / Pro Guide</p>
          <h1>카드뉴스 제작기 사용설명서</h1>
          <p class="summary">설치, 첫 작성, 디자인 조절, PNG·MP4 내보내기, Lite/Pro 기능 차이를 한 번에 확인하는 안내서입니다. 화면 이미지는 Playwright로 실제 앱을 열어 캡처했습니다.</p>
          <nav class="toc" aria-label="문서 목차">
            <a href="#install">설치</a>
            <a href="#matrix">Lite/Pro 차이</a>
            <a href="#write">작성 방법</a>
            <a href="#design">디자인</a>
            <a href="#export">내보내기</a>
            <a href="#pro">Pro 활용</a>
            <a href="#trouble">문제 해결</a>
          </nav>
        </div>
        <aside class="meta">
          <strong>배포 파일</strong>
          <p>일반 사용자에게는 설치 파일 EXE 하나만 전달하면 됩니다.</p>
          ${codeBlock(`Lite: release\\Cardnews-Studio-Lite-Setup-2.0.0.exe
Pro : release\\Cardnews-Studio-Pro-Setup-2.0.0.exe`)}
        </aside>
      </header>

      <section id="install">
        <h2>1. 설치와 실행</h2>
        <div class="grid">
          ${step("1", "사용자에게 Lite 또는 Pro 설치 파일 하나를 전달합니다. 폴더 전체가 아니라 <code>Cardnews-Studio-[Lite|Pro]-Setup-2.0.0.exe</code> 파일만 보내면 됩니다.")}
          ${step("2", "Windows SmartScreen이 뜨면 <code>추가 정보</code>를 누른 뒤 <code>실행</code>을 선택합니다. 코드 서명이 없는 개인 배포 EXE에서 흔히 보이는 경고입니다.")}
          ${step("3", "설치 위치를 선택하고 설치를 완료합니다. 설치 후 바탕화면 바로가기 또는 시작 메뉴에서 앱을 실행합니다.")}
          ${step("4", "처음 실행하면 사용자 데이터 폴더가 새로 만들어집니다. 기존 PC에서 추가한 배경 이미지와 사용자 폰트는 자동으로 따라가지 않습니다.")}
        </div>
        <div class="callout">
          무설치 버전을 배포할 때는 EXE 하나만 보내면 안 됩니다. <code>Cardnews-Studio-Lite-Portable-2.0.0.zip</code> 또는 <code>Cardnews-Studio-Pro-Portable-2.0.0.zip</code> 전체를 전달해야 합니다.
        </div>
      </section>

      <section id="matrix">
        <h2>2. Lite와 Pro 기능 차이</h2>
        <table>
          <thead><tr><th>기능</th><th>Lite</th><th>Pro</th><th>설명</th></tr></thead>
          <tbody>
            ${featureRow("기본 카드 작성", "가능", "가능", "카드별 제목, 소제목, 배지, 본문, 출처, 강조 문구를 작성합니다.")}
            ${featureRow("스타일/비율 선택", "가능", "가능", "신문 오버레이, 시네마틱, 매거진, 체크리스트 등 기본 스타일과 4:5, 1:1, 9:16, 16:9, 4:3 비율을 선택합니다.")}
            ${featureRow("폰트/배경 추가", "가능", "가능", "로컬 폰트와 배경 이미지를 사용자 라이브러리에 추가해 렌더링에 적용합니다.")}
            ${featureRow("PNG·MP4 내보내기", "가능", "가능", "현재 카드 PNG, 전체 ZIP과 1080×1920 MP4 영상을 내보냅니다.")}
            ${featureRow("AI 대화/대본 생성", "잠금", "가능", "Claude Code, Codex CLI, Gemini CLI 같은 외부 CLI와 연결해 주제, 리서치, 카드 대본을 만듭니다.")}
            ${featureRow("이미지·미디어 라이브러리", "가능", "가능", "카드 배경, 이미지와 영상 파일을 라이브러리에 추가하고 카드별로 적용합니다.")}
            ${featureRow("배경 제거(누끼)", "잠금", "가능", "이미지 배경 제거와 관련 Pro 도구를 사용합니다.")}
            ${featureRow("CSV 대량 생성", "잠금", "가능", "CSV 템플릿으로 여러 카드뉴스를 한 번에 렌더링합니다.")}
            ${featureRow("프로젝트 내보내기/가져오기", "잠금", "가능", "작업 덱과 관련 배경 asset을 archive로 옮길 때 사용합니다.")}
          </tbody>
        </table>
        <div class="two" style="margin-top:18px">
          ${figure(resolvedScreenshots.liteOverview, "Lite 기본 화면. 콘텐츠·디자인 편집과 PNG·MP4 내보내기를 사용할 수 있습니다.", "Cardnews Studio Lite 기본 화면")}
          ${figure(resolvedScreenshots.liteLock, "Lite에서 Pro 전용 기능을 누르면 잠금 안내가 표시됩니다.", "Lite Pro 기능 잠금 안내 화면")}
        </div>
      </section>

      <section id="write">
        <h2>3. 첫 카드뉴스 작성 방법</h2>
        <div class="grid">
          ${step("스타일", "상단 <code>스타일</code>에서 카드뉴스 톤을 고릅니다. 사진형 스타일은 배경 이미지를 함께 쓰면 효과가 큽니다.")}
          ${step("비율", "<code>세로형 4:5</code>는 인스타 캐러셀에 적합합니다. 정방형이나 가로형은 블로그, 강의자료, 썸네일에 맞춰 고릅니다.")}
          ${step("헤더/푸터", "헤더는 상단 브랜드명, 푸터는 하단 계정명입니다. 푸터에 <code>@</code>를 입력하지 않아도 앱에서 표시 규칙을 처리합니다.")}
          ${step("카드 선택", "좌측 썸네일에서 수정할 카드를 고르고 우측 <code>콘텐츠</code> 탭에서 내용을 입력합니다.")}
        </div>
        ${figure(resolvedScreenshots.proOverview, "Pro 전체 작업 화면. 좌측은 카드 목록, 중앙은 미리보기, 우측은 편집 패널입니다.", "Cardnews Studio Pro 전체 작업 화면")}
        <h3>카드 문법 예시</h3>
        ${codeBlock(`유형: 표지
배지: MONEY NOTE
제목: 돈 이야기를 *다시* 배워야 하는 이유
소제목: 숫자보다 먼저 보는 관점

본문: 첫 번째 문단을 씁니다.
- 자동 불릿 예시
- 두 번째 불릿 예시

출처: 내부 메모
강조: 저장하고 다시 보기`)}
        ${figure(resolvedScreenshots.proContent, "콘텐츠 탭에서는 카드 유형, 배지, 제목, 소제목, 본문, 불릿, 출처, 강조 문구를 수정합니다.", "카드 콘텐츠 편집 화면")}
      </section>

      <section id="design">
        <h2>4. 디자인 조절 방법</h2>
        <div class="grid">
          ${step("전역", "상단 스타일, 비율, 헤더, 푸터는 전체 카드뉴스에 영향을 줍니다.")}
          ${step("카드 배경", "우측 디자인 탭에서 카드별 배경, 밝기, 대비, 채도, 어둡기를 조절합니다.")}
          ${step("텍스트", "텍스트 크기, 굵기, 기울임, 정렬, 자간, 행간을 조절합니다.")}
          ${step("레이어", "텍스트 박스, 모형, 선, 이미지를 추가하고 X/Y/W/H 값으로 위치와 크기를 조정합니다.")}
        </div>
        ${figure(resolvedScreenshots.proDesign, "디자인 탭. 카드 배경, 배지, 넘김 기호, 텍스트, 레이어를 한 곳에서 조절합니다.", "디자인 패널 화면")}
        <div class="callout good">
          이미지를 배경 라이브러리에 추가하면 현재 PC의 사용자 데이터 폴더에 저장됩니다. 다른 컴퓨터로 그대로 따라가지 않으므로, 프로젝트 이동이 필요하면 Pro의 프로젝트 내보내기/가져오기를 사용하세요.
        </div>
      </section>

      <section id="export">
        <h2>5. PNG 카드와 MP4 영상 내보내기</h2>
        <ol>
          <li>상단 <code>내보내기</code> 버튼을 누릅니다.</li>
          <li><code>PNG 카드</code> 또는 <code>MP4 영상</code>을 선택합니다.</li>
          <li>PNG는 <code>현재 카드 PNG</code>로 한 장만 저장하거나 <code>전체 ZIP</code>으로 전체 카드를 묶습니다.</li>
          <li>MP4는 <code>영상 만들기</code>를 켠 뒤 카드별 노출 시간과 전환을 확인하고 1080×1920 영상으로 저장합니다.</li>
          <li>진행률과 결과 메시지를 확인하고, 완료 후 결과 폴더를 엽니다.</li>
        </ol>
        ${figure(resolvedScreenshots.proExport, "내보내기 화면 참고. PNG·MP4 결과와 Pro의 CSV 대량 생성, 프로젝트 archive를 관리합니다.", "내보내기 패널 화면")}
      </section>

      <section id="pro">
        <h2>6. Pro 기능 활용</h2>
        <div class="grid">
          ${step("AI 대화", "AI 버튼을 눌러 대화 패널을 열고, 주제나 원문을 입력합니다. 주제 찾기, 리서치 메모, 카드 대본 만들기 프리셋을 사용할 수 있습니다.")}
          ${step("AI 결과 적용", "카드 10장 양식으로 감지된 답변은 <code>카드에 적용</code> 버튼으로 현재 덱에 반영합니다.")}
          ${step("CSV 대량 생성", "내보내기 탭에서 CSV 템플릿을 저장하고 행별 데이터를 채운 뒤 BULK PNG를 실행합니다.")}
          ${step("프로젝트 이동", "Pro의 프로젝트 내보내기는 덱과 연결 배경 asset을 함께 archive로 저장합니다. 다른 PC에서 가져오면 배경 누락을 줄일 수 있습니다.")}
        </div>
        ${figure(resolvedScreenshots.proAi, "Pro AI 패널. 외부 CLI provider를 선택하고 자연어로 대화해 카드뉴스 초안을 만듭니다.", "Pro AI 대화 패널")}
      </section>

      <section id="trouble">
        <h2>7. 자주 묻는 문제</h2>
        <div class="grid">
          <article class="panel">
            <h3>다른 컴퓨터에 배경 이미지가 없어요</h3>
            <p>설치 EXE에는 이 PC에서 추가한 배경 이미지가 자동 포함되지 않습니다. Pro 프로젝트 내보내기/가져오기 또는 별도 이미지 파일 전달이 필요합니다.</p>
          </article>
          <article class="panel">
            <h3>SmartScreen 경고가 떠요</h3>
            <p>코드 서명 전 개인 배포 파일에서 흔합니다. 파일 출처를 확인한 뒤 <code>추가 정보</code>와 <code>실행</code>을 누릅니다.</p>
          </article>
          <article class="panel">
            <h3>무설치 EXE 하나만 보냈더니 실행이 안 돼요</h3>
            <p>무설치 버전은 폴더 전체가 필요합니다. <code>win-unpacked-...</code> 폴더를 ZIP으로 압축해 전달하세요.</p>
          </article>
          <article class="panel">
            <h3>AI가 안 보여요</h3>
            <p>AI는 Pro 기능입니다. Pro에서도 Claude Code, Codex CLI, Gemini CLI 중 사용할 provider가 설치되어 있어야 실제 응답을 받을 수 있습니다.</p>
          </article>
        </div>
      </section>

      <footer>
        <p>스크린샷 캡처: Playwright CLI, viewport 1440x1000, Pro/Lite dev server. 문서 갱신일: 2026-07-18.</p>
        <p>문의 링크: <a href="https://open.kakao.com/me/kkongdon">AX문의/강의 문의</a> · Threads: <a href="https://www.threads.com/@kkongdon_story">@kkongdon_story</a></p>
      </footer>
    </main>
  </body>
</html>
`;

const outputPaths = [
  path.join(root, "usage.html"),
  path.join(screenshotDir, "cardnews-studio-lite-pro-guide.html")
];

await Promise.all(outputPaths.map(async (outputPath) => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, "utf8");
}));

console.log(`Wrote ${outputPaths.map((file) => path.relative(root, file)).join(", ")}`);
