# OMX Notepad

## M18 final state - 2026-07-11

- Natural Kkongdon AI chat, safe errors, progress feedback, retry, and preset next actions are implemented.
- Retry preserves separate user-facing text and internal execution prompts.
- Initial provider discovery is cached; explicit refresh alone bypasses the cache.
- UI state moved to `src/ui/useAiAssistant.ts` and pure helpers to `src/ui/aiAssistantModel.ts`.
- Electron AI smoke automation moved from `electron/main.ts` to bounded modules under `electron/ai/smoke/`.
- Canonical evidence is `.omc/evidence/v6/m18-ai-assistant-performance-gpts/`.
- M18 has not yet been packaged into a public installer or staged release EXE. A disposable isolated unpacked Pro executable was created only to inspect `app.asar`; `release/` was unchanged.
