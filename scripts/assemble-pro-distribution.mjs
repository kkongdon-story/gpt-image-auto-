import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = path.resolve(process.argv[2] ?? "");
const outputDir = path.resolve(
  process.argv[3] ?? path.join(root, "release", "Cardnews-Studio-Pro-2.0.0-배포용")
);
const guidePath = path.join(root, "docs", "Cardnews-Studio-Pro-사용설명서.html");

if (!installerPath || !(await exists(installerPath))) {
  throw new Error(`Installer not found: ${installerPath}`);
}
if (!(await exists(guidePath))) {
  throw new Error(`Guide not found: ${guidePath}`);
}

await fs.mkdir(outputDir, { recursive: true });

const installerName = path.basename(installerPath);
const guideName = path.basename(guidePath);
const destinationInstaller = path.join(outputDir, installerName);
const destinationGuide = path.join(outputDir, guideName);

await fs.copyFile(installerPath, destinationInstaller);
await fs.copyFile(guidePath, destinationGuide);

const readme = `Cardnews Studio Pro 2.0.0 배포 안내\n\n1. ${installerName}를 실행해 설치합니다.\n2. 설치 방법과 사용법은 ${guideName}을 더블클릭해 확인합니다.\n3. 설치 EXE 하나만으로 앱 설치가 가능하며, 설명서는 설치 폴더에도 포함됩니다.\n4. Windows SmartScreen 경고가 나오면 파일 출처를 확인한 뒤 '추가 정보' > '실행'을 선택합니다.\n5. AI 기능은 사용할 CLI(Claude Code, Codex CLI, Gemini CLI)가 사용자 PC에 별도로 설치·로그인되어 있어야 합니다.\n6. 문의: https://open.kakao.com/me/kkongdon\n`;
await fs.writeFile(path.join(outputDir, "README-배포안내.txt"), readme, "utf8");

const checksumFiles = [destinationInstaller, destinationGuide];
const checksumLines = [];
for (const file of checksumFiles) {
  const data = await fs.readFile(file);
  checksumLines.push(`${crypto.createHash("sha256").update(data).digest("hex")}  ${path.basename(file)}`);
}
await fs.writeFile(path.join(outputDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");

console.log(`Wrote distribution bundle: ${outputDir}`);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
