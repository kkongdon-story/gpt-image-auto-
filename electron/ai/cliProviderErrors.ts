import type { CardnewsError } from "../../src/domain/types.js";
import { stripAnsi } from "./cliRuntime.js";

export function mapAiProviderError(providerLabel: string, message: string): string {
  const normalized = stripAnsi(message);
  if (
    /requires a newer version of codex|upgrade to the latest app or cli|model .*not found|invalid[_ -]request.*model/is.test(
      normalized
    )
  ) {
    return `${providerLabel}의 모델 설정이 현재 설치된 CLI와 호환되지 않습니다. 앱은 사용자 전역 설정과 분리된 기본 모델로 실행합니다. 새로고침 후 다시 시도하고, 계속되면 ${providerLabel} CLI를 최신 버전으로 업데이트하세요.`;
  }

  if (
    /authrequirederror|no access token|not logged in|login required|unauthorized|invalid api key|www-authenticate|\b401\b/i.test(
      normalized
    )
  ) {
    return `${providerLabel} 로그인이 필요합니다. 터미널에서 해당 CLI 로그인을 완료한 뒤 AI 패널의 새로고침을 눌러주세요.`;
  }

  if (/rate.?limit|usage limit|quota|\b429\b/i.test(normalized)) {
    return `${providerLabel} 사용 한도에 도달했습니다. 잠시 뒤 다시 시도하거나 해당 서비스의 사용량을 확인해주세요.`;
  }

  if (/enotfound|econnrefused|econnreset|network|fetch failed|transport channel closed|timed? out/i.test(normalized)) {
    return `${providerLabel}와 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.`;
  }

  if (normalized.includes("Not inside a trusted directory") || normalized.includes("--skip-git-repo-check")) {
    return `${providerLabel}가 작업 폴더를 확인하지 못했습니다. 앱이 작업 폴더 설정을 자동으로 보정하므로 새로고침 후 다시 시도해주세요.`;
  }

  return `${providerLabel}가 요청을 완료하지 못했습니다. AI 패널에서 새로고침한 뒤 다시 시도해주세요. 계속되면 해당 CLI의 로그인과 업데이트 상태를 확인해주세요.`;
}

export function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}

export function externalServiceFailed(message: string): CardnewsError {
  return { ok: false, code: "external_service_failed", message };
}
