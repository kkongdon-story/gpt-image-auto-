# Test Spec: V6 M11 AI Provider Detection, Raw Chat, and Timeout Progress

Status: RALPLAN proposed; consensus ready; implementation not started
Date: 2026-07-09
Related PRD: `.omx/plans/prd-v6-m11-ai-provider-chat-timeout.md`

## 1. Standard Verification Commands

Run from:

```powershell
cd "C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto"
```

Required gate before claiming implementation complete:

```powershell
npm run typecheck
npm test
npm run build
npm run build:lite
node scripts/verify-edition.mjs --edition lite
$env:CARDNEWS_SMOKE_ACTION='ai-provider-detection-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='ai-raw-chat-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='ai-timeout-progress-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='edition-lite-regression'; node node_modules/electron/cli.js .
```

If smoke action names change during implementation, update this spec and `HANDOFF.md`.

## 2. Evidence Folder

Save M11 evidence under:

```text
.omc/evidence/v6/m11-ai-provider-chat-timeout/
```

Expected evidence files:

- `typecheck.log`
- `test.log`
- `build-pro.log`
- `build-lite.log`
- `verify-edition-lite.log`
- `ai-provider-detection-regression.log`
- `ai-raw-chat-regression.log`
- `ai-timeout-progress-regression.log`
- `edition-lite-regression.log`
- `manual-qa-matrix.md`
- `debugging-audit.md`
- `final-gate-review.md`

## 3. Automated Coverage

### T1. Provider Resolver Finds Windows Fallback Executable

Purpose: reproduce "Codex installed but shown missing".

Unit target:

- `electron/ai/cliAdapters.ts` or a new resolver module.

Steps:

1. Create a fake temp directory representing `%APPDATA%\npm`.
2. Place a fake `codex.cmd` or equivalent executable there.
3. Set a controlled env/path where plain `codex` is not on PATH.
4. Run provider detection.
5. Assert Codex is installed and version is captured from the fake executable.
6. Assert the resolved run command uses the same resolved executable.

Assertions:

- Codex status `installed === true`.
- Provider id is `codex`.
- No duplicate Codex status is returned.
- Prompt text never appears in command args.

### T2. Provider Dropdown De-Dupe

Purpose: prevent the screenshot's duplicate Codex option.

Smoke action: `ai-provider-detection-regression`

Steps:

1. Launch Pro app.
2. Open AI drawer.
3. Inspect provider dropdown options.
4. Assert option ids/labels are unique by provider id.
5. Assert exactly one option is present for each of Claude, Codex, Gemini.

Assertions:

- `Codex CLI` appears no more than once.
- If fake detection is enabled, Codex appears as installed.
- If not installed, the missing message includes diagnostic help.

### T3. Provider Refresh Re-runs Detection

Purpose: make `새로고침` useful.

Steps:

1. Start with Codex fake executable absent.
2. Open drawer and assert Codex missing.
3. Make fake executable available or switch mock detection state.
4. Click `새로고침`.
5. Assert Codex status changes to installed without restarting the app.

Assertions:

- Status line changes.
- Dropdown text changes.
- Selected provider dot state updates.

### T4. Timeout Config Parser

Purpose: prevent too-short and unsafe timeout behavior.

Unit target:

- Timeout helper, for example `resolveAiProviderTimeoutMs(env)`.

Cases:

- No env -> `300_000`.
- `CARDNEWS_AI_TIMEOUT_MS=450000` -> `450_000`.
- `CARDNEWS_AI_TIMEOUT_MS=1000` -> fallback or clamped minimum.
- `CARDNEWS_AI_TIMEOUT_MS=99999999` -> fallback or clamped maximum.
- `CARDNEWS_AI_TIMEOUT_MS=abc` -> default.

Assertions:

- Effective timeout is documented and deterministic.
- Error copy can render minutes/seconds from effective timeout.

### T5. Timeout Kills Child and Returns Actionable Error

Purpose: avoid orphan processes and vague errors.

Unit/integration:

1. Use a fake provider command that sleeps beyond the configured timeout.
2. Set timeout low for test only, for example 1 second through helper injection.
3. Run provider chat.
4. Assert process is killed.
5. Assert result is `external_service_failed`.
6. Assert message includes provider label and elapsed/limit text.

### T6. Raw Chat Payload

Purpose: prove ordinary send is not a preset/internal prompt.

Smoke action: `ai-raw-chat-regression`

Steps:

1. Enable mock AI or fake provider capture mode.
2. Open Pro AI drawer.
3. Type `오늘 수업 후기글을 카드뉴스로 바꿔줘`.
4. Press send.
5. Capture the provider payload.

Assertions:

- User bubble content is exactly `오늘 수업 후기글을 카드뉴스로 바꿔줘`.
- Provider payload contains one system message with Kkongdon context.
- Provider payload contains the raw user message.
- Provider payload for ordinary send does not contain:
  - `모드: topic`,
  - `모드: research`,
  - `모드: draft`,
  - `모드: image`.

### T7. Retry Preserves Raw User Text

Purpose: avoid retrying visible/internal mismatch.

Steps:

1. Force provider error for an ordinary chat.
2. Click retry.
3. Capture second provider payload.

Assertions:

- Retry uses the same raw user text.
- Retry includes the same system context.
- Retry does not include loading/error placeholder text as conversation history.

### T8. Preset Helper Separation

Purpose: keep helper buttons but make chat primary.

Steps:

1. Type `AI 업무 자동화`.
2. Click `주제 찾기`.
3. Assert composer still contains `AI 업무 자동화` or is intentionally cleared, but never replaced with a long internal prompt.
4. Assert helper request is visually labelled as a helper action.
5. Assert internal prompt debug remains collapsed.
6. Send a normal follow-up message after the helper result.

Assertions:

- Normal follow-up is sent as raw chat with Kkongdon system context.
- Helper workflow does not permanently lock the thread into a `topic/research/draft/image` mode.

### T9. Long-Running Progress Heartbeat

Purpose: users should see the request is alive.

Smoke action: `ai-timeout-progress-regression`

Steps:

1. Enable a fake provider that waits at least 65 seconds before returning, or use a test-only shorter timeline with deterministic virtual/accelerated intervals if available.
2. Open AI drawer and send a message.
3. Observe the loading assistant bubble over time.

Assertions:

- The bubble includes provider label.
- The bubble includes elapsed time.
- The bubble stage text changes at least twice before completion.
- The send button remains disabled/working while busy.
- Final response replaces the progress bubble.

### T10. Timeout Progress Error UI

Purpose: timeout should be understandable and recoverable.

Steps:

1. Enable fake provider that never returns until timeout.
2. Set a short test timeout.
3. Send a message.
4. Wait for timeout.

Assertions:

- Progress bubble turns into error bubble.
- Error mentions provider and timeout duration.
- Retry button is visible.
- `aiBusy` returns to false.

### T11. Lite Edition Regression

Purpose: Pro AI work must not leak into Lite.

Commands:

```powershell
npm run build:lite
node scripts/verify-edition.mjs --edition lite
$env:CARDNEWS_SMOKE_ACTION='edition-lite-regression'; node node_modules/electron/cli.js .
```

Assertions:

- `verify-edition` proves `runAiProviderChat` and provider execution remain stripped or unreachable in Lite.
- Lite AI drawer, if visible, remains locked.
- Provider resolver/timeout/progress execution paths cannot be called from Lite UI.

## 4. Manual QA Checklist

Run after automated gates, before EXE packaging:

1. Open Pro dev app.
2. Open AI drawer.
3. Confirm provider dropdown has no duplicate Codex row.
4. Confirm Codex displays installed if it is installed on this machine.
5. Select Codex and send a normal Korean chat message.
6. Confirm the visible user bubble is exactly what was typed.
7. Confirm the response is conversational, not a weird `모드:` prompt echo.
8. Select Claude and send a longer request.
9. Confirm elapsed time/progress bubble updates while waiting.
10. Confirm timeout no longer occurs at 120 seconds for normal long requests.
11. Run Lite build and confirm AI remains locked/stripped.

Suggested screenshots/logs:

- `01-provider-dropdown-no-duplicate-codex.png`
- `02-codex-detected-installed.png`
- `03-raw-chat-user-bubble.png`
- `04-progress-heartbeat-30s.png`
- `05-timeout-actionable-error.png` if using fake timeout
- `06-lite-ai-locked.png`

## 5. Stop Conditions

Do not mark M11 complete if:

- Codex still appears as missing when a fallback executable is available.
- The provider dropdown still shows duplicate Codex options.
- Ordinary chat payload contains preset `모드:` instructions.
- User-visible message differs from what the user typed.
- Long-running calls show a static "작성 중..." bubble with no elapsed/progress change.
- Timeout still defaults to 120 seconds with no documented override.
- Lite verification fails or exposes provider execution.

