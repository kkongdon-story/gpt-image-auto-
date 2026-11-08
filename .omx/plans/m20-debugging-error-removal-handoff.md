# M20 디버깅 및 에러 제거 실행 계획

## 0. 목적과 작업 경계

이 문서는 다른 구현 모델이 M20 Windows DPI 렌더링 오류를 안전하게 마무리하도록 만드는 실행 계획이다.

- 이번 계획 작성 단계에서는 제품 코드와 EXE를 수정하지 않는다.
- 공개 `release/` 폴더는 T1-T16이 모두 통과하기 전까지 변경하지 않는다.
- 현재 작업 트리는 M20 외 변경이 많이 섞여 있으므로 `git reset`, `git checkout --`, 대량 삭제를 금지한다.
- 기존 코드를 처음부터 다시 작성하지 않는다. 현재 후보를 감사하고, 실패가 증명된 지점만 최소 수정한다.
- Lite와 Pro는 하나의 공유 렌더 엔진을 유지한다. 에디션별 크기 보정 코드를 만들지 않는다.

기준 문서:

- `.omx/plans/prd-v6-m20-dpi-safe-render-dimensions.md`
- `.omx/plans/test-spec-v6-m20-dpi-safe-render-dimensions.md`
- `.debug-journal.md`
- `.omc/evidence/v6/m20-dpi-safe-render-dimensions/`

## 1. 현재 상태 감사 결과

### 1.1 확인된 원인

배포된 Lite의 `1950x2130` 계열 오류는 카드의 논리 크기가 아니라 Windows DPI와 창 콘텐츠 영역의 영향을 받은 비트맵을 캡처한 것이 근본 원인이다. 출력 크기는 디스플레이 설정이 아니라 파일 계약이어야 한다.

고정 출력 계약:

| 비율 | 최종 PNG |
| --- | --- |
| 4:5 | `1080x1350` |
| 1:1 | `1080x1080` |
| 16:9 | `1920x1080` |
| 4:3 | `1440x1080` |

### 1.2 현재 작업 트리에 이미 들어간 후보 구현

현재 소스에는 다음 후보 수정이 들어가 있다.

- `src/render-engine/offscreenRenderer.ts`: `capturePage()` 대신 offscreen `paint` 프레임 사용, 렌더 전용 `deviceScaleFactor: 1`, 자산 준비 대기, post-invalidation 프레임 수집.
- `src/render-engine/captureGeometry.ts`: 카드 사각형, 프레임 채움, 종횡비, 균일 배율 검증.
- `src/render-engine/finalImageValidation.ts`: 최종 크기와 비어 있지 않은 PNG 검증.
- `src/render-engine/paintFrameCollector.ts`: stale frame 방지.
- `src/render-engine/renderDiagnostics.ts`: 진단 정보 축소 및 민감 정보 차단.
- `scripts/render-dimension-smoke.mjs`: 사진, 밝은 스타일, 크롬 요소, 번들 폰트, 사용자 TTF, 이미지/폰트 실패 fixture.
- `scripts/run-render-dimension-matrix.mjs`: 40개 크기 시나리오 + 12개 콘텐츠 시나리오 + 4개 준비 실패 시나리오.
- `scripts/verify-package-security.mjs`: Lite 개발용 환경변수 훅의 production guard와 Pro 스트리핑 검사.

### 1.3 현재 존재하는 pre-canonical 증거

`final4` 소스와 패키지 기준으로 다음 로컬 로그가 존재한다. 아직 공식 `verification-summary.json`으로 승격되지 않았으므로 공개 배포 승인 증거로 인용하지 않는다.

- typecheck: 통과.
- 전체 테스트: 33개 파일, 228개 테스트 통과.
- 스크립트 테스트: 11/11 통과.
- 소스 렌더 매트릭스: 56/56 통과.
- `missing-image`: `RenderImageReadinessError`로 통제된 실패.
- `missing-font`: `RenderFontReadinessError`로 통제된 실패.
- Lite `lite-final4-20260714-1155` packaged matrix: 20/20 통과, 강제 종료 0.
- Pro `pro-final4b-20260714-1156` packaged matrix: 20/20 통과, 강제 종료 0.
- 위 두 후보의 installer, unpacked EXE, `app.asar` package security scan: findings 0.
- source matrix 성공 PNG 독립 decoder 검증: 54/54 통과. 52개 성공 시나리오 중 두 시나리오가 생성한 `card-02.png`도 포함한다.
- 대표 source/package 4:5 PNG 시각 QA: 통과.

패키지 근거 파일:

- `.omc/evidence/v6/m20-dpi-safe-render-dimensions/t13-packaged-lite-final4/matrix-summary.json`
- `.omc/evidence/v6/m20-dpi-safe-render-dimensions/t13-packaged-pro-final4/matrix-summary.json`
- `.omc/evidence/v6/m20-dpi-safe-render-dimensions/t16-security-payload-final4.json`
- `.omc/evidence/v6/m20-dpi-safe-render-dimensions/t07-verify-render-png-final4.json`
- `.omc/evidence/v6/m20-dpi-safe-render-dimensions/t07-visual-qa-final4.md`

### 1.4 아직 닫히지 않은 공백

이 항목들은 다음 모델이 반드시 먼저 처리해야 한다.

1. `.omc/evidence/v6/m20-dpi-safe-render-dimensions/verification-summary.json`은 아직 40/40, 227개 테스트, `final3` 후보를 가리킨다. 현재 소스와 공식 요약이 불일치한다.
2. Pro의 `pro-final4-20260714-1155`는 패키징 실패 잔여물이다. 사용할 후보는 `pro-final4b-20260714-1156`뿐이다.
3. 수정 후 독립 코드 리뷰는 완료됐고 `APPROVE`, code quality `WATCH`, 코드 차단 사항 0으로 판정됐다. 다만 stale canonical evidence, renderer 비대화, PNG decoder 테스트 폭, 일부 진단 테스트 품질은 비차단 후속 항목이다.
4. T14 clean install, T15 upgrade/data preservation, T16 Defender/Authenticode는 여전히 차단 상태다.
5. T17 release staging은 실행하지 않았다.
6. 다음 모델은 자동 검증을 이미 통과한 렌더 코드를 임의로 다시 쓰지 않는다. D2-D6에서 새 실패를 재현한 경우에만 RED 테스트를 먼저 추가하고 최소 수정한다.

따라서 현재 상태를 "배포 가능"으로 표현하면 안 된다. 정확한 표현은 "M20 코드/디버깅 후보는 독립 리뷰까지 승인됐으나 canonical evidence 정합성과 외부 Windows 릴리스 게이트가 미완료"이다.

### 1.5 후보 권위 표

| 후보 | 역할 | 현재 권위 | 상태 |
| --- | --- | --- | --- |
| 현재 `release/` M19 | 기존 공개 배포본 | 공개본 기준 | M20 수정 미포함. D9 전까지 변경 금지 |
| `lite-final3-20260714` + `pro-final3-20260714` | 기존 공식 M20 자동 검증 후보 | `verification-summary.json`이 가리키는 historical evidence | 이전 리뷰 수정 전이므로 superseded, 배포 금지 |
| `lite-final4-20260714-1155` | 최신 Lite 참고 후보 | D6 자동 검증 및 D7 코드 리뷰 통과, pre-canonical | packaged 20/20 및 scanner findings 0. D8 외부 게이트 전 공개 배포 금지 |
| `pro-final4b-20260714-1156` | 최신 Pro 참고 후보 | D6 자동 검증 및 D7 코드 리뷰 통과, pre-canonical | packaged 20/20 및 scanner findings 0. D8 외부 게이트 전 공개 배포 금지 |
| `pro-final4-20260714-1155` | 실패한 Pro 부분 출력 | 없음 | discarded, 어떤 검증에도 사용 금지 |

`final4` 참고 후보의 현재 SHA-256은 다음과 같다. 이 값은 D6 입력과 scanner 결과의 후보 식별용이며 D8 외부 릴리스 게이트 통과를 의미하지 않는다.

| Artifact | SHA-256 |
| --- | --- |
| Lite installer | `c3b9378f207cc1efd29541739ed951b0d3082e96c15ffd7f28c8aa36cb6fff84` |
| Lite unpacked EXE | `73a0dbb785fcc5a4e71d35809ebdc170eae75e4ee5d81169937e20a493563328` |
| Lite `app.asar` | `7bab61ee0dcc48d362448b2b578396f6dbeabcbbfa927dc5b3ca2e9747cbe554` |
| Pro installer | `160546907a3db1d2a19e322f34574a06af27ffe97826065ae9185ded551fe8da` |
| Pro unpacked EXE | `c987567e3fac65e9741c6543f437024ca247b2923fdab98dee1339046c703b2a` |
| Pro `app.asar` | `cb0b09e269f36255d48bc4590ba3f05ecd7182247bfcc450f1db6a5006c6ee7c` |

다음 모델은 D0에서 새 `candidate-manifest-<candidateId>.json`을 만들고 위 경로와 hash를 다시 측정한다. 기존 `verification-summary.json`은 `final3 historical summary`로 취급한다. 현재 D6 결과를 재사용하려면 manifest의 여섯 hash가 `t16-security-payload-final4.json`과 정확히 일치해야 한다. 기존 D7 `APPROVE`와 artifact hash 동일성을 확인한 뒤 하나의 새 canonical summary를 생성한다.

### 1.6 다음 모델의 실제 시작점

다음 모델은 구현부터 시작하지 않는다. 아래 순서가 현재의 정확한 시작점이다.

1. `candidate-manifest-final4.json`과 실제 Lite/Pro artifact 6개의 SHA-256을 대조한다.
2. 독립 리뷰 보고서 `.omo/evidence/v6-m20-dpi-safe-render-dimensions-code-review.md`의 `APPROVE`와 비차단 WATCH 항목을 읽는다.
3. stale `verification-summary.json`과 과거 unsuffixed `.meta.json`을 historical evidence로 분리한다.
4. final4/final4b만 가리키는 canonical summary와 final4 전용 meta를 만든다.
5. 제품 소스 수정 없이 T14-T16 외부 게이트를 준비한다.
6. 새 재현 실패가 생길 때만 아래 증상 분기표를 따라 코드 수정 범위를 결정한다.

이 순서에서 1-4는 증거 정합성 작업이며 렌더 엔진 수정 사유가 아니다.

## 2. 에러 제거 원칙

1. **크기를 맞추기 위해 전체 화면을 강제 리사이즈하지 않는다.** 카드가 프레임을 정확히 채웠다는 증거가 있을 때만 균일 배율 보정을 허용한다.
2. **잘못된 이미지를 성공 처리하지 않는다.** crop, stretch, blank frame, stale frame은 모두 통제된 실패로 남긴다.
3. **보이는 편집기 DPI를 바꾸지 않는다.** `deviceScaleFactor: 1`은 렌더 전용 offscreen surface에만 적용한다.
4. **자산이 준비되기 전에 캡처하지 않는다.** 폰트와 이미지가 실패하면 fallback 결과를 저장하지 않는다.
5. **진단 파일에 콘텐츠를 넣지 않는다.** 카드 본문, AI 프롬프트, API 키, 로컬 절대 경로, 원본 예외 메시지를 저장하지 않는다.
6. **테스트를 통과시키기 위한 production QA 우회로를 넣지 않는다.** Pro 패키지에는 smoke/mock/dev-server 코드가 없어야 한다.
7. **한 번 생성한 후보는 불변으로 취급한다.** 패키지 이후 소스나 `dist`를 다시 만들었다면 같은 후보 이름을 재사용하지 않는다.

## 3. 오류 유형별 진단과 수정 방향

### E1. DPI에 따라 PNG 크기가 달라짐

가능 원인:

- 전체 BrowserWindow/web contents를 device pixel 단위로 캡처.
- outer bounds와 content bounds 혼용.
- visible editor의 scale을 렌더에 그대로 사용.

수정 방향:

- `useContentSize: true`인 숨은 offscreen window를 사용한다.
- offscreen 설정에 `useSharedTexture: false`, `deviceScaleFactor: 1`을 지정한다.
- `paint` listener를 `loadURL()`보다 먼저 등록한다.
- `.card`가 `(0,0)`에서 target content를 채우는지 DOM probe로 확인한다.
- 최종 PNG는 독립 디코더로 다시 읽어 정확한 크기를 확인한다.

종료 기준:

- Lite/Pro, 네 비율, DPI 100/125/150/175/200에서 40/40 정확한 크기.

### E2. 빈 PNG 또는 이전 프레임 저장

가능 원인:

- 초기 placeholder paint를 최종 프레임으로 사용.
- 폰트/이미지 준비 전에 capture.
- `invalidate()` 이전 프레임을 수락.

수정 방향:

- 프레임 sequence를 기록하고 readiness 이후 새 프레임만 수락한다.
- readiness 완료 후 `invalidate()`하고 post-invalidation frame을 기다린다.
- BGRA에서 픽셀 인덱스에 4를 곱해 색/알파를 샘플링한다.
- blank 또는 지나치게 투명한 프레임은 저장 전에 거절한다.

종료 기준:

- stale frame, all-white, all-transparent, asset-timeout 회귀 테스트가 모두 통제된 실패 또는 올바른 새 프레임을 증명한다.

### E3. 잘림, 여백, 왜곡

가능 원인:

- viewport 전체를 target 크기로 무조건 resize.
- card rect가 프레임을 채우지 않았는데 normalization 수행.
- 가로/세로 배율이 다른 입력을 강제 변환.

수정 방향:

- card rect 존재, 유한한 크기, target CSS 크기, origin, frame fill을 먼저 검증한다.
- source와 target의 종횡비 차이가 허용 오차 안인지 검사한다.
- x/y scale이 같은 균일 배율일 때만 high-quality resize를 허용한다.
- 조건이 하나라도 틀리면 crop/stretch 없이 `RENDER_CAPTURE_ASPECT_MISMATCH` 등으로 실패한다.

종료 기준:

- missing-card, wrong-aspect, offset-card, nonuniform-scale fixture가 PNG를 발행하지 않는다.

### E4. 사용자 폰트와 배경 이미지가 늦거나 실패함

가능 원인:

- `document.fonts.ready`만 기다리고 선택 폰트의 실제 load/check를 검증하지 않음.
- `<img>`와 CSS background 실패를 fail-open 처리.

수정 방향:

- 선택된 사용자 폰트는 `document.fonts.load()`와 `document.fonts.check()` 결과를 둘 다 확인한다.
- 문서 이미지와 CSS 배경 이미지의 load/error/timeout을 집계한다.
- 실패 시 각각 `RenderFontReadinessError`, `RenderImageReadinessError`로 분류한다.
- fallback 폰트 또는 누락 이미지를 성공 렌더로 위장하지 않는다.

종료 기준:

- 번들 한글 폰트와 실제 Windows TTF는 성공하고, 없는 폰트/이미지는 통제된 실패다.

### E5. 진단 파일에서 개인정보나 콘텐츠가 노출됨

가능 원인:

- 원본 exception message/stack 저장.
- 단순 token/path 정규식만 사용해 카드 문구나 프롬프트가 남음.

수정 방향:

- 예상하지 못한 오류의 message는 고정 문구 `Unexpected render error.`만 저장한다.
- error name은 허용 목록만 유지하고 나머지는 `Error`로 치환한다.
- stack은 허용 가능한 함수 프레임 이름과 `[path]:line:column` 형태만 최대 12줄 보존한다.
- 한국어 카드 문구, 프롬프트, 토큰, 절대 경로를 섞은 실제 회귀 테스트를 둔다.

종료 기준:

- 민감 문자열이 message, stack, reason, path 어디에도 남지 않는다.

### E6. Lite/Pro 패키지에 QA 코드가 유출됨

가능 원인:

- Lite 개발 환경변수 훅이 `app.isPackaged`와 직접 연결되지 않음.
- Pro production preparation 이후 smoke/mock 코드가 남음.
- scanner가 근처 문자열만 보고 guard로 오판.

수정 방향:

- Lite env read마다 직접 `app.isPackaged ? undefined : process.env...` 또는 동등한 guard를 둔다.
- 그룹 표현식 안의 각 env read를 개별 검사한다.
- Pro는 `prepare-pro-package.mjs` 이후 smoke/mock/dev-server payload가 0이어야 한다.
- scanner에는 unrelated-nearby-guard, grouped-expression, ternary-decoy 회귀 테스트를 유지한다.

종료 기준:

- scanner unit 11/11 이상 통과.
- 실제 Lite/Pro `app.asar`, EXE, installer scan findings 0.

### E7. 증거와 바이너리가 서로 다른 스냅샷임

가능 원인:

- 패키지 이후 소스를 다시 빌드함.
- `final3`, `final4`, `final4b` 경로가 메타데이터에 혼재.
- meta의 command가 현재 CLI와 맞지 않음.

수정 방향:

- 후보마다 고유 timestamp/id를 부여한다.
- build 시작 전 HEAD, dirty files, tool versions를 기록한다.
- package 후 6개 파일의 SHA-256을 즉시 기록한다.
- 모든 T12-T16 meta는 실제 실행 command, exit code, artifact hash를 가리키게 다시 생성한다.
- 검증 중 후보 파일의 hash가 바뀌면 해당 후보 전체를 폐기한다.

종료 기준:

- `verification-summary.json`, `.meta.json`, hash manifest, 실제 경로가 하나의 후보만 가리킨다.

### E8. 사용자에게 원인 없는 크기 오류만 노출됨

가능 원인:

- 내부 최종 크기 검증 오류를 그대로 사용자 메시지로 전달.
- geometry, readiness, DPI normalization 실패를 모두 같은 문장으로 표시.
- 지원용 진단 코드와 사용자가 할 수 있는 조치를 분리하지 않음.

수정 방향:

- strict final-size validation은 제거하지 않는다.
- 내부 오류는 geometry, readiness, stale/blank frame, final-size mismatch로 분류한다.
- 사용자 메시지는 "비율을 다시 입력"하거나 "디스플레이를 100%로 고정"하라고 요구하지 않는다.
- 자동 복구 가능한 경우 한 번만 재시도하고, 반복 실패 시 안정적인 오류 코드와 진단 파일 위치를 제공한다.
- 메시지에는 카드 본문, 로컬 절대 경로, API 키, 원본 stack을 넣지 않는다.

종료 기준:

- 동일한 4:5 오류가 재발하면 support가 진단 코드만으로 원인 범주를 식별할 수 있다.
- 잘못된 결과를 저장하거나 사용자가 임의 크기를 조정하게 만드는 우회 UX가 없다.

### 공통 증상 기반 원인 분기표

| 관찰 증상 | 첫 확인 | 판정 | 수정 허용 범위 |
| --- | --- | --- | --- |
| `1950x2130`처럼 DPI 배수 크기 | frame/card rect와 x/y scale | 균일 배율이며 card가 frame을 채움 | 검증된 uniform normalization만 허용 |
| 가로/세로 배율이 다름 | aspect, origin, frame fill | geometry 오류 | resize 금지, geometry 생성 경로 수정 |
| 정확한 크기지만 흰색/투명 | paint sequence, alpha/content sample | stale/blank frame | readiness 이후 invalidate/collector ordering 수정 |
| 폰트 또는 배경이 빠짐 | `document.fonts`, image/background readiness | asset readiness 실패 | fail-closed 대기/오류 분류 수정 |
| source는 통과, packaged만 실패 | `app.asar`, builder config, packaged driver | package divergence | 소스 renderer보다 패키지 구성/경로부터 조사 |
| Lite만 또는 Pro만 실패 | 실제 호출 helper와 stripped payload | edition divergence | 공통 renderer 복구, 에디션별 보정 금지 |
| 결과는 정상인데 evidence가 다름 | candidate ID/path/hash | provenance 오류 | 코드 수정 금지, meta/summary만 교정 |
| Defender/SmartScreen 차단 | Defender 활성 상태, 서명 상태 | 배포 신뢰 게이트 | 코드 수정이 아니라 서명/배포 정책 결정 |

분기 원칙:

1. 관찰값을 먼저 기록하고 원인을 추측으로 고정하지 않는다.
2. 같은 fixture로 old/red와 candidate/green을 비교한다.
3. 실패 범주가 정해지기 전에는 renderer 전체를 리팩터링하지 않는다.
4. 한 범주의 최소 수정 후 그 범주 테스트와 D2-D7을 다시 실행한다.

## 4. 실행 단계와 게이트

### D0. 스냅샷 동결

작업:

1. `git rev-parse HEAD`, `git status --short`, M20 scoped diff를 증거로 저장한다.
2. 기존 혼합 변경을 되돌리지 않는다.
3. `final4` 산출물은 참고용으로만 보존하고 새 검증 후보는 새 ID를 사용한다.
4. 공개 `release/` 해시를 별도로 기록해 실수로 교체되지 않았음을 증명한다.

차단 조건:

- 소스 스냅샷과 패키지 후보를 구별할 수 없으면 D1 이후로 진행하지 않는다.

### D1. 회귀 기준 동결

작업:

1. 기존 배포 Lite 또는 보존된 baseline에서 4:5, 150% 실패 증거를 유지한다.
2. 새 후보에서 동일 입력이 `1080x1350`인지 비교한다.
3. 실제 사용자 보고 문구와 진단 코드를 연결한다.

차단 조건:

- old/red와 candidate/green이 같은 fixture와 같은 검증기로 비교되지 않으면 통과로 처리하지 않는다.

### D2. 순수 정책 테스트

대상:

- `captureGeometry.ts`
- `finalImageValidation.ts`
- `paintFrameCollector.ts`
- `renderDiagnostics.ts`

필수 검증:

- exact, uniform 1.25/1.5/1.75/2.0 scale 허용.
- wrong aspect, nonuniform scale, offset, whitespace, blank, transparent 거절.
- stale frame 거절.
- 민감 정보 진단 누출 0.

차단 조건:

- 소스 문자열을 검색하는 테스트만으로 production ordering을 증명하지 않는다. fake WebContents 또는 실제 harness를 통한 행동 테스트가 필요하다.

### D3. 공유 렌더 통합 검증

표준 명령:

```powershell
npm run typecheck
npm test
node --test scripts/verify-package-security.test.mjs scripts/verify-render-png.test.mjs
node scripts/run-render-dimension-matrix.mjs --harness ".omc/evidence/v6/m20-dpi-safe-render-dimensions/harness/render-dimension-smoke.js" --output-dir ".omc/evidence/v6/m20-dpi-safe-render-dimensions/t04-matrix-<candidate>"
```

주의:

- harness bundle은 현재 소스로 다시 생성하고 그 생성 명령과 hash를 기록한다.
- `run-render-dimension-matrix.mjs`의 현재 실제 옵션은 `--harness`, `--output-dir`, 선택적 `--edition`이다. 예전 meta의 `--editions`, `--ratios`, `--scales` 표기는 폐기한다.

통과 기준:

- typecheck 성공.
- 전체 테스트 0 실패.
- script tests 0 실패.
- source matrix 56/56.
- 40개 dimension, 12개 content, 4개 readiness 시나리오 수가 정확히 일치.

### D4. 에디션 회귀 검증

이 smoke는 **source-built `dist`/`dist-electron`만** 대상으로 실행한다. packaged Pro에는 smoke 코드가 없어야 하므로 unpacked/installed EXE에는 이 명령을 쓰지 않는다. packaged 검증은 D6 external driver가 담당한다.

먼저 아래 PowerShell helper를 현재 셸에 정의한다.

```powershell
$M20Evidence = Join-Path $PWD '.omc\evidence\v6\m20-dpi-safe-render-dimensions'
$SmokeVariables = @(
  'CARDNEWS_SMOKE_ACTION',
  'CARDNEWS_SMOKE_SCREENSHOT',
  'CARDNEWS_SMOKE_TEXT',
  'CARDNEWS_SMOKE_VIEWPORT_WIDTH',
  'CARDNEWS_SMOKE_VIEWPORT_HEIGHT',
  'CARDNEWS_MOCK_AI',
  'CARDNEWS_MOCK_STYLE_EXTRACTION',
  'VITE_DEV_SERVER_URL',
  'ELECTRON_RUN_AS_NODE'
)

function Invoke-M20SourceSmoke {
  param(
    [Parameter(Mandatory=$true)][string]$Action,
    [Parameter(Mandatory=$true)][string]$LogName
  )

  foreach ($name in $SmokeVariables) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }

  try {
    $env:CARDNEWS_SMOKE_ACTION = $Action
    $logPath = Join-Path $M20Evidence $LogName
    & node node_modules/electron/cli.js . *> $logPath
    $exitCode = $LASTEXITCODE
    Get-Content -LiteralPath $logPath
    if ($exitCode -ne 0) {
      throw "Smoke failed: $Action (exit=$exitCode)"
    }
    if (-not (Select-String -LiteralPath $logPath -SimpleMatch "CARDNEWS_SMOKE_ACTION $Action PASS" -Quiet)) {
      throw "Smoke PASS marker missing: $Action"
    }
  }
  finally {
    foreach ($name in $SmokeVariables) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
  }
}
```

Lite 명령:

```powershell
npm run build:lite
if ($LASTEXITCODE -ne 0) { throw 'build:lite failed' }

node scripts/verify-edition.mjs --edition lite --scan dist dist-electron `
  *> (Join-Path $M20Evidence 't10-verify-edition-lite-<candidate>.log')
if ($LASTEXITCODE -ne 0) { throw 'verify-edition lite failed' }

Invoke-M20SourceSmoke `
  -Action 'edition-lite-regression' `
  -LogName 't10-lite-edition-regression-<candidate>.log'

Invoke-M20SourceSmoke `
  -Action 'edition-lite-basic-flow' `
  -LogName 't10-lite-basic-flow-<candidate>.log'
```

Pro 명령:

```powershell
npm run build:pro
if ($LASTEXITCODE -ne 0) { throw 'build:pro failed' }

Invoke-M20SourceSmoke `
  -Action 'layer-controls-regression' `
  -LogName 't11-pro-layer-controls-<candidate>.log'

Invoke-M20SourceSmoke `
  -Action 'chrome-style-regression' `
  -LogName 't11-pro-chrome-style-<candidate>.log'

Invoke-M20SourceSmoke `
  -Action 'content-form-regression' `
  -LogName 't11-pro-content-form-<candidate>.log'
```

통과 기준:

- Lite에 Pro API/기능 유출 0.
- Pro 기능 회귀 0.
- 공유 렌더 결과는 에디션에 따라 달라지지 않음.
- 각 log에 정확한 `CARDNEWS_SMOKE_ACTION <action> PASS` marker가 있음.

### D5. 격리 패키징과 불변 후보 생성

작업:

1. `%LOCALAPPDATA%\CardnewsStudio\M20-QA\<edition>-<candidate>` 아래에만 빌드한다.
2. Lite와 Pro 모두 unpacked와 NSIS installer를 생성한다.
3. Pro는 반드시 `prepare-pro-package.mjs`를 거친다.
4. 첫 실패/부분 출력 폴더는 후보에서 제외하고 메타에 `discarded`로 기록한다.
5. 패키지 직후 hash를 기록하고 이후 변경하지 않는다.

현재 참고 경로:

- Lite 참고 후보: `%LOCALAPPDATA%\CardnewsStudio\M20-QA\lite-final4-20260714-1155`
- Pro 참고 후보: `%LOCALAPPDATA%\CardnewsStudio\M20-QA\pro-final4b-20260714-1156`
- 폐기 대상: `%LOCALAPPDATA%\CardnewsStudio\M20-QA\pro-final4-20260714-1155`

통과 기준:

- 두 installer와 두 unpacked EXE가 존재.
- 각 `app.asar`, EXE, installer의 hash가 기록됨.
- 공개 `release/`는 변경되지 않음.

### D6. 정확한 패키지 바이너리 검증

현재 상태:

- Lite `final4`: 20/20 통과, 강제 종료 0.
- Pro `final4b`: 20/20 통과, 강제 종료 0.
- 여섯 패키지 artifact scanner findings 0.
- 다음 모델은 hash 불일치나 D7 코드 변경이 없으면 이 장시간 매트릭스를 무조건 반복하지 않는다. 대신 기존 summary, scanner JSON, 실제 파일 hash를 대조해 동일 후보임을 먼저 증명한다.
- D7에서 제품 코드가 수정되면 기존 패키지는 즉시 폐기하고 D5-D6을 새 candidate ID로 다시 수행한다.

표준 명령 형태:

```powershell
node scripts/run-packaged-render-matrix.mjs `
  --exe "<candidate>\win-unpacked\Cardnews Studio Lite.exe" `
  --edition lite `
  --profile-root "$env:LOCALAPPDATA\CardnewsStudio\M20-QA\profiles-lite-<candidate>" `
  --output-dir ".omc/evidence/v6/m20-dpi-safe-render-dimensions/t13-packaged-lite-<candidate>" `
  --screenshots representative

node scripts/run-packaged-render-matrix.mjs `
  --exe "<candidate>\win-unpacked\Cardnews Studio Pro.exe" `
  --edition pro `
  --profile-root "$env:LOCALAPPDATA\CardnewsStudio\M20-QA\profiles-pro-<candidate>" `
  --output-dir ".omc/evidence/v6/m20-dpi-safe-render-dimensions/t13-packaged-pro-<candidate>" `
  --screenshots representative
```

그 다음 실제 CLI 형태로 package scanner를 실행한다.

```powershell
node scripts/verify-package-security.mjs `
  --lite-asar "<lite>\win-unpacked\resources\app.asar" `
  --pro-asar "<pro>\win-unpacked\resources\app.asar" `
  --lite-exe "<lite>\win-unpacked\Cardnews Studio Lite.exe" `
  --pro-exe "<pro>\win-unpacked\Cardnews Studio Pro.exe" `
  --lite-installer "<lite>\Cardnews-Studio-Lite-Setup-2.0.0.exe" `
  --pro-installer "<pro>\Cardnews-Studio-Pro-Setup-2.0.0.exe" `
  --output ".omc/evidence/v6/m20-dpi-safe-render-dimensions/t16-security-payload-<candidate>.json"
```

통과 기준:

- Lite packaged matrix 20/20, forced termination 0.
- Pro packaged matrix 20/20, forced termination 0.
- package findings 0.
- 검증 후 hash가 패키지 직후 hash와 동일.
- 실행 후 정확한 EXE 경로의 잔여 프로세스 0.

### D7. 독립 코드 리뷰

리뷰어는 구현 모델과 분리한다.

현재 결과:

- 보고서: `.omo/evidence/v6-m20-dpi-safe-render-dimensions-code-review.md`
- 판정: M20 code/debug `APPROVE`, code quality `WATCH`, 코드 blocker 0.
- 공개 릴리스는 T14-T16 때문에 `BLOCKED`.
- 제품 코드가 바뀌지 않으면 이 리뷰 결과를 유지하되, canonical evidence를 만든 뒤 별도 gate reviewer가 증거 정합성을 다시 확인한다.
- 제품 코드가 한 줄이라도 바뀌면 기존 D7 승인은 폐기하고 새 독립 리뷰를 수행한다.

필수 재검토:

1. unexpected diagnostic이 fail-closed인지.
2. fixture 8종이 실제 production renderer를 통과하는지.
3. paint subscription이 load보다 먼저 일어나는 행동 테스트인지.
4. scanner direct-guard 판정에 false negative가 없는지.
5. `capturePage()`가 production PNG 경로에 남아 있지 않은지.
6. Lite/Pro가 같은 renderer helper를 사용하는지.
7. 패키지 증거가 같은 candidate hash를 가리키는지.

판정:

- `APPROVE`: D8 진행.
- `REQUEST_CHANGES`: 해당 finding의 red test를 먼저 추가하고 최소 수정 후 D2-D7 재실행.

### D8. 외부 Windows 릴리스 게이트

#### T14 clean install

- 깨끗한 Windows VM/Sandbox/별도 계정 사용.
- Lite: 100/125/150/175/200%에서 4:5 export.
- Pro: 100/150%에서 4:5 export.
- shortcut 실행, source checkout 비의존, 혼합 DPI monitor 이동 후 재실행 확인.

#### T15 upgrade/data preservation

- 현재 공개 Lite 설치.
- 프로젝트, 배경, 이미지 라이브러리, 사용자 TTF, 설정 생성.
- 후보 installer로 in-place upgrade.
- 데이터와 Lite identity 보존 확인.
- 150% 이상에서 4:5 export 확인.

#### T16 security/signing

- Defender가 활성화된 깨끗한 Windows에서 installer와 unpacked payload scan.
- Authenticode 서명이 없으면 `NotSigned`를 공개 위험으로 기록하고 release 승인권자가 명시적으로 결정한다.
- SmartScreen 동작을 실제 확인한다.

차단 조건:

- 깨끗한 외부 환경이 없으면 이 게이트를 PASS로 바꾸지 않는다.

### D9. 릴리스 스테이징

T1-T16이 모두 PASS일 때만 수행한다.

1. 검증된 동일 hash 후보만 `release/`로 복사한다.
2. SHA-256 manifest와 release metadata를 갱신한다.
3. Lite/Pro 사용 설명서의 DPI 안내와 임시 100% workaround를 수정한다.
4. `HANDOFF.md`를 append-only로 갱신한다.
5. 최종 설치 파일을 다시 hash하고 candidate와 일치하는지 확인한다.

## 5. 우선순위와 수정 순서

| 우선순위 | 작업 | 이유 |
| --- | --- | --- |
| P0 | 증거/후보 스냅샷 일치 | 다른 바이너리를 검증하는 실수를 막음 |
| P0 | canonical summary/meta 재생성 | `final3`와 `final4` 증거 혼합 제거 |
| 완료 | 독립 코드 리뷰 | code/debug `APPROVE`, blocker 0 확인 |
| P1 | clean install/upgrade QA | 사용자 컴퓨터 재현 가능성 검증 |
| P1 | Defender/서명 상태 | 공개 배포 신뢰와 차단 경고 |
| P2 | 메타데이터/HANDOFF 정리 | 배포 추적성과 다음 작업자 인수인계 |
| P2 | renderer 분리와 PNG decoder 테스트 확장 | 현재 correctness 차단은 아니지만 968줄 renderer와 협소한 PNG 포맷 테스트의 유지보수 위험 축소 |

새로운 renderer 재작성은 우선순위가 아니다. 현재 후보가 위 게이트에서 실패할 때만 해당 실패를 고친다.

## 6. 증거 계약

각 gate는 로그와 `.meta.json`이 함께 있어야 한다.

필수 meta 필드:

- `schemaVersion`
- `gate`
- `candidateId`
- `sourceHead`
- `dirtyStateHash` 또는 scoped diff hash
- `command`
- `startedAt`, `completedAt`
- `exitCode`
- `status`
- 입력 artifact path/hash
- 출력 artifact path/hash
- failure/block reason

PASS 조건:

- command가 현재 스크립트 CLI와 일치.
- log가 존재.
- exit code가 0.
- scenario 수와 pass 수가 예상값과 일치.
- artifact hash가 이후 단계에서도 동일.

## 7. 다음 모델이 피해야 할 행동

- 문제를 숨기기 위해 exact-size validation 제거.
- `capturePage()`를 production fallback으로 복구.
- visible editor 전체에 `force-device-scale-factor=1` 적용.
- wrong-aspect 이미지를 무조건 `resize()`.
- 자산 실패를 fallback 폰트/빈 이미지로 성공 처리.
- 원본 예외 메시지와 stack을 diagnostics에 그대로 기록.
- Pro 패키지에 smoke/mock hook 추가.
- 기존 혼합 작업 트리를 reset하거나 정리.
- T14-T16이 BLOCKED인데 `release/`를 교체.

## 8. 최종 완료 정의

M20은 다음 조건을 모두 만족해야 완료다.

1. source matrix 56/56.
2. full tests와 script tests 0 실패.
3. Lite/Pro edition regressions 0 실패.
4. 정확한 새 후보의 packaged matrix 각각 20/20.
5. package scanner findings 0.
6. 독립 code reviewer 승인.
7. clean install과 upgrade 보존 QA 통과.
8. Defender/서명 상태가 배포 정책에 따라 처리됨.
9. 모든 meta와 hash가 하나의 candidate를 가리킴.
10. 그 뒤에만 T17 release staging 수행.

## 9. 다른 모델에 전달할 실행 명령

```text
프로젝트 루트:
C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/m20-debugging-error-removal-handoff.md를 먼저 읽어라.
제품 코드를 처음부터 다시 작성하지 말고, D0부터 순서대로 현재 M20 후보를 감사하라.
현재 작업 트리의 다른 변경을 되돌리지 마라.
각 gate가 실패할 때만 red test를 먼저 만들고 최소 범위로 수정하라.
final4 Lite 20/20, final4b Pro 20/20, package scanner findings 0은 이미 로컬 증거가 있다.
source PNG 독립 검증 54/54와 대표 source/package 시각 QA도 완료돼 있다.
독립 코드 리뷰는 code/debug APPROVE, code quality WATCH, blocker 0으로 완료됐다.
먼저 여섯 artifact hash를 다시 측정해 해당 증거와 동일 후보인지 확인하라.
특히 final4 소스 증거와 공식 verification-summary의 불일치, canonical meta,
증거 정합성을 먼저 닫아라.
새 검증 실패나 gate review가 제품 코드 변경을 요구할 때만 red test 후 최소 수정하라.
제품 코드가 바뀌면 기존 final4 패키지와 D7 승인을 폐기하고 새 candidate ID로 D2-D7을 반복하라.
T14-T16이 통과하기 전에는 release/를 수정하거나 배포 완료를 선언하지 마라.
각 gate의 로그와 .meta.json을 .omc/evidence/v6/m20-dpi-safe-render-dimensions/에 남기고,
HANDOFF.md는 append-only로 갱신하라.
```
