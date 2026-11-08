# Test Spec: V6 M12 Lite/Pro Stable EXE Release Gates

## 1. Evidence Root

All execution logs go under:

`C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\.omc\evidence\v6\m12-lite-pro-exe-release`

Recommended PowerShell setup:

```powershell
$Evidence = "C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\.omc\evidence\v6\m12-lite-pro-exe-release"
$ProOut = "$env:LOCALAPPDATA\cardnews-release-pro-m12"
$LiteOut = "$env:LOCALAPPDATA\cardnews-release-lite-m12"
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
```

Required command logging convention:

```powershell
function Invoke-Gate {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][scriptblock]$Command,
    [int[]]$AcceptedExitCodes = @(0),
    [switch]$ReviewRequired
  )
  $Log = Join-Path $Evidence "$Name.log"
  $Meta = Join-Path $Evidence "$Name.meta.json"
  $Started = Get-Date -Format o
  $global:LASTEXITCODE = 0
  & $Command *> $Log
  $ExitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }
  $Success = $AcceptedExitCodes -contains $ExitCode
  $Ended = Get-Date -Format o
  [pscustomobject]@{
    name = $Name
    started = $Started
    ended = $Ended
    exitCode = $ExitCode
    acceptedExitCodes = $AcceptedExitCodes
    success = $Success
    reviewRequired = [bool]$ReviewRequired
    logPath = $Log
    command = $Command.ToString()
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Meta -Encoding UTF8
  if (-not $Success) {
    throw "Gate failed: $Name exit $ExitCode. See $Log"
  }
}
```

Every mandatory command below must be run through `Invoke-Gate` or an equivalent logger that creates the corresponding `.meta.json`. Completion requires `.meta.json` evidence for every mandatory command. Commands marked review-style may accept non-zero exit codes only when the spec says so and the review file explains the result.

Review-style accepted exit codes:

- `rg` scans: exit `0` means matches found and must be reviewed; exit `1` means no matches and can pass; other exit codes fail.
- `npm audit --omit=dev`: any non-zero exit requires `npm-audit-review.md` documenting severity. High/critical production issues block release unless explicitly remediated or risk-accepted.
- `Get-ChildItem -ErrorAction SilentlyContinue` preflight listings may return success even when folders are absent; absence is informational.

For long-running EXE smoke, use this timeout wrapper through `Invoke-Gate`:

```powershell
function Invoke-ExeSmoke {
  param(
    [Parameter(Mandatory=$true)][string]$ExePath,
    [Parameter(Mandatory=$true)][string]$Action,
    [int]$TimeoutSeconds = 90
  )
  $env:CARDNEWS_SMOKE_ACTION = $Action
  $Process = Start-Process -FilePath $ExePath -PassThru -NoNewWindow
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    Get-Process | Where-Object { $_.Path -eq $ExePath } | Select-Object Id,Path,ProcessName | Format-List
    Get-Process | Where-Object { $_.Path -eq $ExePath } | Stop-Process -Force
    throw "Timed out: $ExePath action=$Action after ${TimeoutSeconds}s"
  }
  if ($Process.ExitCode -ne 0) {
    throw "Smoke failed: $ExePath action=$Action exit=$($Process.ExitCode)"
  }
}
```

## 2. Preflight Gate

Commands:

```powershell
git status --short *> "$Evidence\preflight-git-status.log"
Get-ChildItem -LiteralPath "release" -Force -ErrorAction SilentlyContinue *> "$Evidence\preflight-release-list.log"
Get-ChildItem -LiteralPath $ProOut -Force -ErrorAction SilentlyContinue *> "$Evidence\preflight-pro-local-list.log"
Get-ChildItem -LiteralPath $LiteOut -Force -ErrorAction SilentlyContinue *> "$Evidence\preflight-lite-local-list.log"
node -e "import('@electron/asar').then(()=>console.log('electron-asar import ok'))" *> "$Evidence\preflight-electron-asar.log"
```

Pass:
- Logs exist.
- `preflight-electron-asar.log` shows `electron-asar import ok`, or the release is blocked until `@electron/asar` is declared or otherwise remediated.
- Existing user changes are not reset or reverted.
- Every mandatory command has a `.meta.json` exit-code record.

## 3. Source Quality Gate

Commands:

```powershell
npm run typecheck *> "$Evidence\typecheck.log"
npm test *> "$Evidence\test.log"
git diff --check *> "$Evidence\git-diff-check.log"
```

Pass:
- `typecheck.log` exit 0.
- `test.log` exit 0.
- `git-diff-check.log` exit 0, or only documented CRLF conversion warnings if command returns 0.

## 4. Lite Source Gate

Commands:

```powershell
npm run build:lite *> "$Evidence\build-lite.log"
node scripts/verify-edition.mjs --edition lite *> "$Evidence\verify-edition-lite-source.log"
$env:CARDNEWS_SMOKE_ACTION="edition-lite-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-lite-edition.log"
$env:CARDNEWS_SMOKE_ACTION="edition-lite-basic-flow"
node node_modules/electron/cli.js . *> "$Evidence\smoke-lite-basic-flow.log"
Remove-Item Env:CARDNEWS_SMOKE_ACTION -ErrorAction SilentlyContinue
```

Pass:
- Lite build exits 0.
- `verify-edition passed` appears.
- Both Lite smoke logs contain `PASS` and exit 0.

## 5. Pro Source Gate

Commands:

```powershell
npm run build:pro *> "$Evidence\build-pro.log"

$env:CARDNEWS_SMOKE_ACTION="content-title-whitespace-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-content-title-whitespace.log"

$env:CARDNEWS_SMOKE_ACTION="inspector-design-scroll-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-inspector-design-scroll.log"

$env:CARDNEWS_SMOKE_ACTION="image-picker-library-hygiene-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-image-picker-library-hygiene.log"

$env:CARDNEWS_SMOKE_ACTION="badge-background-removal-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-badge-background-removal.log"

$env:CARDNEWS_SMOKE_ACTION="next-hint-image-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-next-hint-image.log"

$env:CARDNEWS_SMOKE_ACTION="chrome-style-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-chrome-style.log"

$env:CARDNEWS_SMOKE_ACTION="ai-provider-detection-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-ai-provider-detection.log"

$env:CARDNEWS_MOCK_AI="1"
$env:CARDNEWS_SMOKE_ACTION="ai-raw-chat-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-ai-raw-chat.log"

$env:CARDNEWS_SMOKE_ACTION="ai-timeout-progress-regression"
$env:CARDNEWS_MOCK_AI_DELAY_MS="2600"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-ai-timeout-progress.log"

$env:CARDNEWS_SMOKE_ACTION="ai-draft-regression"
Remove-Item Env:CARDNEWS_MOCK_AI_DELAY_MS -ErrorAction SilentlyContinue
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-ai-draft.log"

Remove-Item Env:CARDNEWS_SMOKE_ACTION -ErrorAction SilentlyContinue
Remove-Item Env:CARDNEWS_MOCK_AI -ErrorAction SilentlyContinue
```

Pass:
- Every Pro smoke log contains `PASS` and exits 0.
- Non-fatal Chromium cache/GPU warnings are documented but do not fail the gate if exit 0.

## 6. Debugging and Security Gate

Commands:

```powershell
Invoke-Gate -Name "npm-audit-omit-dev" -ReviewRequired -AcceptedExitCodes @(0,1) -Command { npm audit --omit=dev }
Invoke-Gate -Name "secret-scan" -ReviewRequired -AcceptedExitCodes @(0,1) -Command { rg -n "OPENAI_API_KEY|ANTHROPIC_AUTH_TOKEN|GEMINI_API_KEY|AIza|sk-|xoxb-|token|secret" . --glob "!node_modules/**" --glob "!release/**" --glob "!dist/**" --glob "!dist-electron/**" }
Invoke-Gate -Name "security-surface-scan" -ReviewRequired -AcceptedExitCodes @(0,1) -Command { rg -n "shell: true|exec\\(|openExternal|cardnews:ai:chat|cardnews:removeImageBackground|cardnews:renderBulkCsv|cardnews:exportProject|cardnews:importProject" electron src scripts }
node scripts/verify-edition.mjs --edition lite *> "$Evidence\verify-edition-lite-post-security.log"
$env:CARDNEWS_SMOKE_ACTION="ai-provider-command-regression"
node node_modules/electron/cli.js . *> "$Evidence\smoke-pro-ai-provider-command.log"
Remove-Item Env:CARDNEWS_SMOKE_ACTION -ErrorAction SilentlyContinue
```

Pass:
- `npm audit --omit=dev` has no high or critical production dependency issue. If npm returns non-zero for lower severity, summarize and decide whether it blocks release.
- Secret scan has no real credential leak. False positives are written to `security-review.md`.
- Security surface scan is reviewed and summarized in `security-review.md`.
- Lite verify still passes after the review.

Required manual evidence file:

`$Evidence\security-review.md`

Minimum sections:
- Production dependency audit result.
- Secret scan result.
- IPC exposure review.
- AI command construction review.
- `ai-provider-command-regression` result and why it proves shell-injection resistance.
- Path/openExternal review.
- Release-blocking issues: none or listed.

## 7. Isolated Package Build Gate

Before packaging, remove only the two known local output folders after verifying their absolute paths:

```powershell
if ($ProOut -like "$env:LOCALAPPDATA\cardnews-release-pro-m12") { Remove-Item -LiteralPath $ProOut -Recurse -Force -ErrorAction SilentlyContinue }
if ($LiteOut -like "$env:LOCALAPPDATA\cardnews-release-lite-m12") { Remove-Item -LiteralPath $LiteOut -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $ProOut | Out-Null
New-Item -ItemType Directory -Force -Path $LiteOut | Out-Null
```

Build Pro:

```powershell
npm run build:pro *> "$Evidence\package-build-pro-prebuild.log"
npx electron-builder --win nsis -c electron-builder.pro.json -c.directories.output="$ProOut" *> "$Evidence\package-pro-local.log"
```

Build Lite:

```powershell
npm run build:lite *> "$Evidence\package-build-lite-prebuild.log"
npx electron-builder --win nsis -c electron-builder.lite.json -c.directories.output="$LiteOut" *> "$Evidence\package-lite-local.log"
node scripts/verify-edition.mjs --edition lite --scan "$LiteOut\win-unpacked\resources\app.asar" "$LiteOut\win-unpacked" *> "$Evidence\verify-edition-lite-local-package.log"
```

Pass:
- Pro installer exists at `$ProOut\Cardnews-Studio-Pro-Setup-2.0.0.exe`.
- Pro unpacked EXE exists at `$ProOut\win-unpacked\Cardnews Studio Pro.exe`.
- Lite installer exists at `$LiteOut\Cardnews-Studio-Lite-Setup-2.0.0.exe`.
- Lite unpacked EXE exists at `$LiteOut\win-unpacked\Cardnews Studio Lite.exe`.
- Lite packaged scan passes.

## 8. Packaged EXE Smoke Gate

Pro:

```powershell
$env:CARDNEWS_SMOKE_ACTION="ai-draft-regression"
$env:CARDNEWS_MOCK_AI="1"
& "$ProOut\win-unpacked\Cardnews Studio Pro.exe" *> "$Evidence\smoke-local-pro-exe-ai-draft.log"

$env:CARDNEWS_SMOKE_ACTION="ai-provider-detection-regression"
& "$ProOut\win-unpacked\Cardnews Studio Pro.exe" *> "$Evidence\smoke-local-pro-exe-ai-provider-detection.log"

$env:CARDNEWS_SMOKE_ACTION="image-picker-library-hygiene-regression"
& "$ProOut\win-unpacked\Cardnews Studio Pro.exe" *> "$Evidence\smoke-local-pro-exe-image-picker.log"

$env:CARDNEWS_SMOKE_ACTION="chrome-style-regression"
& "$ProOut\win-unpacked\Cardnews Studio Pro.exe" *> "$Evidence\smoke-local-pro-exe-chrome-style.log"

Remove-Item Env:CARDNEWS_MOCK_AI -ErrorAction SilentlyContinue
Remove-Item Env:CARDNEWS_SMOKE_ACTION -ErrorAction SilentlyContinue
```

Lite:

```powershell
$env:CARDNEWS_SMOKE_ACTION="edition-lite-regression"
& "$LiteOut\win-unpacked\Cardnews Studio Lite.exe" *> "$Evidence\smoke-local-lite-exe-edition.log"

$env:CARDNEWS_SMOKE_ACTION="edition-lite-basic-flow"
& "$LiteOut\win-unpacked\Cardnews Studio Lite.exe" *> "$Evidence\smoke-local-lite-exe-basic-flow.log"

Remove-Item Env:CARDNEWS_SMOKE_ACTION -ErrorAction SilentlyContinue
```

Pass:
- All logs contain `PASS` and exit 0.
- If a smoke hangs, capture process list and stop only the known target process after recording evidence.

## 9. Release Copy Gate

Copy only after all previous gates pass.

```powershell
$ReleaseRoot = "C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\release"
$ReleaseProDir = "$ReleaseRoot\win-unpacked-pro-2.0.0"
$ReleaseLiteDir = "$ReleaseRoot\win-unpacked-lite-2.0.0"
$ReleaseProTmp = "$ReleaseRoot\win-unpacked-pro-2.0.0.tmp"
$ReleaseLiteTmp = "$ReleaseRoot\win-unpacked-lite-2.0.0.tmp"

New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null

Copy-Item -LiteralPath "$ProOut\Cardnews-Studio-Pro-Setup-2.0.0.exe" -Destination "$ReleaseRoot\Cardnews-Studio-Pro-Setup-2.0.0.exe" -Force
Copy-Item -LiteralPath "$LiteOut\Cardnews-Studio-Lite-Setup-2.0.0.exe" -Destination "$ReleaseRoot\Cardnews-Studio-Lite-Setup-2.0.0.exe" -Force

if ($ReleaseProTmp -like "$ReleaseRoot\win-unpacked-pro-2.0.0.tmp") { Remove-Item -LiteralPath $ReleaseProTmp -Recurse -Force -ErrorAction SilentlyContinue }
if ($ReleaseLiteTmp -like "$ReleaseRoot\win-unpacked-lite-2.0.0.tmp") { Remove-Item -LiteralPath $ReleaseLiteTmp -Recurse -Force -ErrorAction SilentlyContinue }

Copy-Item -LiteralPath "$ProOut\win-unpacked" -Destination $ReleaseProTmp -Recurse -Force
Copy-Item -LiteralPath "$LiteOut\win-unpacked" -Destination $ReleaseLiteTmp -Recurse -Force

if (-not (Test-Path -LiteralPath "$ReleaseProTmp\Cardnews Studio Pro.exe")) { throw "Missing staged Pro EXE" }
if (-not (Test-Path -LiteralPath "$ReleaseLiteTmp\Cardnews Studio Lite.exe")) { throw "Missing staged Lite EXE" }

if ($ReleaseProDir -like "$ReleaseRoot\win-unpacked-pro-2.0.0") { Remove-Item -LiteralPath $ReleaseProDir -Recurse -Force -ErrorAction SilentlyContinue }
if ($ReleaseLiteDir -like "$ReleaseRoot\win-unpacked-lite-2.0.0") { Remove-Item -LiteralPath $ReleaseLiteDir -Recurse -Force -ErrorAction SilentlyContinue }
Rename-Item -LiteralPath $ReleaseProTmp -NewName "win-unpacked-pro-2.0.0"
Rename-Item -LiteralPath $ReleaseLiteTmp -NewName "win-unpacked-lite-2.0.0"
```

Final verification:

```powershell
node scripts/verify-edition.mjs --edition lite --scan "$ReleaseLiteDir\resources\app.asar" "$ReleaseLiteDir" *> "$Evidence\verify-edition-lite-release-package.log"

$env:CARDNEWS_SMOKE_ACTION="ai-draft-regression"
$env:CARDNEWS_MOCK_AI="1"
& "$ReleaseProDir\Cardnews Studio Pro.exe" *> "$Evidence\smoke-release-pro-exe-ai-draft.log"
Remove-Item Env:CARDNEWS_MOCK_AI -ErrorAction SilentlyContinue

$env:CARDNEWS_SMOKE_ACTION="edition-lite-regression"
& "$ReleaseLiteDir\Cardnews Studio Lite.exe" *> "$Evidence\smoke-release-lite-exe-edition.log"
Remove-Item Env:CARDNEWS_SMOKE_ACTION -ErrorAction SilentlyContinue

Get-ChildItem -LiteralPath $ReleaseRoot -File -Filter "*.exe" | Select-Object FullName,Length,LastWriteTime *> "$Evidence\release-exe-list.txt"
Get-FileHash -Algorithm SHA256 "$ReleaseRoot\Cardnews-Studio-Pro-Setup-2.0.0.exe","$ReleaseRoot\Cardnews-Studio-Lite-Setup-2.0.0.exe","$ReleaseProDir\Cardnews Studio Pro.exe","$ReleaseLiteDir\Cardnews Studio Lite.exe" *> "$Evidence\release-sha256.txt"
```

Pass:
- Copied Lite package verify passes.
- Copied release Pro/Lite smoke logs contain `PASS`.
- SHA256 and file sizes are recorded.
- Existing final unpacked dirs are not removed until staged `.tmp` copies have the expected EXE files.

## 10. Final Handoff Gate

Update `HANDOFF.md` with:

- M12 date and scope.
- All passed gates.
- Final artifact paths.
- Evidence root.
- SHA256 file path.
- Known warnings and non-blocking caveats.
- Manual QA checklist for the user.

Completion requires:
- No mandatory gate remains unrun.
- No mandatory gate failed.
- Final release artifacts exist in both installer and unpacked forms.
- Lite package stripping evidence exists for local package and copied release package.
- Final workspace artifacts are restored with `npm run build:pro`.
- `HANDOFF.md` update is append-only: add a new M12 section, preserve existing text, and do not rewrite earlier sections.

## 11. Post-Release Workspace Restore

Commands:

```powershell
npm run build:pro *> "$Evidence\post-release-build-pro-restore.log"
```

Pass:
- `post-release-build-pro-restore.log` exits 0.
- Next local app launch uses Pro artifacts unless the next task explicitly rebuilds Lite.
