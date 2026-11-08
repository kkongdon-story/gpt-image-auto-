import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await import("./generate-usage-guide.mjs");

const sourcePath = path.join(root, "usage.html");
const outputPath = path.join(root, "docs", "Cardnews-Studio-Pro-사용설명서.html");
let html = await fs.readFile(sourcePath, "utf8");

html = html
  .replaceAll("Cardnews Studio Lite/Pro 사용설명서", "Cardnews Studio Pro 사용설명서")
  .replaceAll("Cardnews Studio Lite / Pro Guide", "Cardnews Studio Pro Guide")
  .replace(
    "설치, 첫 작성, 디자인 조절, PNG·MP4 내보내기, Lite/Pro 기능 차이를 한 번에 확인하는 안내서입니다.",
    "설치, 첫 작성, 디자인 조절, PNG·MP4 내보내기, AI와 대량 생성까지 한 번에 확인하는 Pro 안내서입니다."
  )
  .replace(
    "일반 사용자에게는 설치 파일 EXE 하나만 전달하면 됩니다.",
    "설치 파일 EXE에는 Pro 앱 실행에 필요한 런타임이 모두 포함됩니다. 이 HTML 설명서는 설치 폴더에도 함께 복사됩니다."
  )
  .replace(
    /<pre><code>Lite: release\\Cardnews-Studio-Lite-Setup-2\.0\.0\.exe\nPro : release\\Cardnews-Studio-Pro-Setup-2\.0\.0\.exe<\/code><\/pre>/,
    "<pre><code>Cardnews-Studio-Pro-Setup-2.0.0.exe</code></pre>"
  )
  .replace(
    "사용자에게 Lite 또는 Pro 설치 파일 하나를 전달합니다.",
    "사용자에게 Pro 설치 파일을 전달합니다."
  )
  .replaceAll(
    "Cardnews-Studio-[Lite|Pro]-Setup-2.0.0.exe",
    "Cardnews-Studio-Pro-Setup-2.0.0.exe"
  )
  .replace(
    "스크린샷 캡처: Playwright CLI, viewport 1440x1000, Pro/Lite dev server. 문서 갱신일: 2026-07-18.",
    "스크린샷 캡처: Playwright, 실제 Cardnews Studio 화면. Pro 배포 문서 갱신일: 2026-07-18."
  );

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, html, "utf8");

console.log(`Wrote ${path.relative(root, outputPath)}`);
