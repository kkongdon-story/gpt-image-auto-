import type { BrowserWindow } from "electron";
import type { CardnewsError, CardnewsResult } from "../src/domain/types.js";
import {
  listBackgroundLibrary,
  saveBackgroundBufferToLibrary
} from "../src/storage/deckStore.js";

type BackgroundManagerSmokeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

function isCardnewsError<T extends object>(result: CardnewsResult<T>): result is CardnewsError {
  return "ok" in result && result.ok === false;
}

export async function runBackgroundManagerSmoke(
  mainWindow: BrowserWindow,
  storageRoot: string
): Promise<BackgroundManagerSmokeResult> {
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const first = await saveBackgroundBufferToLibrary(storageRoot, pngBytes, "card-01-clean.png");
  const second = await saveBackgroundBufferToLibrary(storageRoot, pngBytes, "card-01-clean.png");
  if (isCardnewsError(first) || isCardnewsError(second)) {
    return { ok: false, message: "배경 관리 스모크용 이미지를 저장하지 못했습니다." };
  }

  const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const node = document.querySelector(selector);
          if (node) {
            return node;
          }
          await wait(80);
        }
        throw new Error("배경 관리 요소를 찾지 못했습니다: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return;
          }
          await wait(80);
        }
        throw new Error(description);
      };
      const openManager = async () => {
        const open = await waitFor('[data-smoke-action="background-manager-open"]');
        if (!(open instanceof HTMLButtonElement)) {
          throw new Error("배경 관리 열기 버튼이 아닙니다.");
        }
        open.click();
        return await waitFor('[data-smoke-role="background-manager-modal"]');
      };
      const managerItems = () => Array.from(
        document.querySelectorAll('[data-smoke-action="background-manager-select"]')
      );

      let modal = await openManager();
      await waitUntil(() => managerItems().length === 2, "중복 이름 배경 2개가 표시되지 않았습니다.");
      const initialItems = managerItems();
      const initialIds = initialItems.map((item) => item.getAttribute("data-smoke-background-id"));
      if (new Set(initialIds).size !== 2 || initialItems.some((item) => !item.textContent?.includes("card-01-clean.png"))) {
        throw new Error("중복 이름 배경이 고유 ID와 함께 구분되지 않았습니다.");
      }

      if (!(initialItems[0] instanceof HTMLButtonElement)) {
        throw new Error("첫 배경 항목이 버튼이 아닙니다.");
      }
      initialItems[0].click();
      await wait(80);
      const apply = modal.querySelector('[data-smoke-action="background-manager-apply"]');
      if (!(apply instanceof HTMLButtonElement)) {
        throw new Error("배경 적용 버튼이 없습니다.");
      }
      apply.click();
      await waitUntil(
        () => !document.querySelector('[data-smoke-role="background-manager-modal"]'),
        "배경 적용 후 관리 창이 닫히지 않았습니다."
      );

      modal = await openManager();
      await waitUntil(() => modal.textContent?.includes("사용 중: 전역 배경") === true, "전역 배경 사용 표시가 없습니다.");
      const blockedDelete = modal.querySelector('[data-smoke-action="background-manager-delete"]');
      if (!(blockedDelete instanceof HTMLButtonElement) || !blockedDelete.disabled) {
        throw new Error("사용 중인 전역 배경의 삭제가 차단되지 않았습니다.");
      }
      const clear = modal.querySelector('[data-smoke-action="background-manager-clear"]');
      const clearApply = modal.querySelector('[data-smoke-action="background-manager-apply"]');
      if (!(clear instanceof HTMLButtonElement) || !(clearApply instanceof HTMLButtonElement)) {
        throw new Error("배경 해제 컨트롤이 없습니다.");
      }
      clear.click();
      await wait(80);
      clearApply.click();
      await waitUntil(
        () => !document.querySelector('[data-smoke-role="background-manager-modal"]'),
        "배경 해제 후 관리 창이 닫히지 않았습니다."
      );

      modal = await openManager();
      await waitUntil(() => managerItems().length === 2, "삭제 전 배경 목록이 복원되지 않았습니다.");
      const removable = managerItems()[0];
      if (!(removable instanceof HTMLButtonElement)) {
        throw new Error("삭제할 배경 항목이 버튼이 아닙니다.");
      }
      removable.click();
      await wait(80);
      const remove = modal.querySelector('[data-smoke-action="background-manager-delete"]');
      if (!(remove instanceof HTMLButtonElement) || remove.disabled) {
        throw new Error("미사용 배경 삭제 버튼이 활성화되지 않았습니다.");
      }
      remove.click();
      await waitUntil(() => managerItems().length === 1, "삭제 후 배경 목록이 갱신되지 않았습니다.");

      return {
        initialIds,
        remainingId: managerItems()[0]?.getAttribute("data-smoke-background-id") ?? null,
        usageBlocked: true
      };
    })()
  `);

  const backgrounds = await listBackgroundLibrary(storageRoot);
  if (!result?.usageBlocked || backgrounds.length !== 1 || result.remainingId !== backgrounds[0]?.id) {
    return {
      ok: false,
      message: `배경 관리 스모크 결과가 올바르지 않습니다: ${JSON.stringify({ result, backgrounds })}`
    };
  }

  return { ok: true };
}
