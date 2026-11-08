# Requirements Spec: V6 M22 Media, Video, Canvas, and AI

## 1. Status

- Source: deep interview completed on 2026-07-16
- Interview transcript: `.omx/interviews/m22-media-video-canvas-ai-20260716T021954Z.md`
- Context snapshot: `.omx/context/m22-media-video-canvas-ai-20260716-103438.md`
- Final ambiguity: `0.07`
- User approval: complete
- Product implementation: not started by this interview

This document is the binding requirements handoff for the M22 PRD and test specification. If another document conflicts with a user-approved decision below, this document wins unless the user explicitly changes the decision.

## 2. Product Intent

Cardnews Studio를 정적인 카드뉴스 제작기에서 벗어나게 하되, 복잡한 영상 편집기로 바꾸지는 않는다. 사용자는 이미 편집한 이미지와 짧은 영상 소스를 카드별로 빠르게 배치하고, 기존 카드 텍스트와 함께 하나의 세로형 숏폼 MP4로 출력할 수 있어야 한다.

동시에 중앙 작업 보드에서 표준 텍스트를 직접 다룰 수 있어야 하며, Pro의 AI는 꽁돈 전용 인격이 아니라 사용자가 관리하는 기본 지침에 따라 자연스럽게 대화해야 한다.

## 3. Binding Decisions

### D1. 카드 중심 미디어 배치

- 선택 카드에서 이미지 또는 영상을 바로 가져오고 배치하는 흐름이 1차 동선이다.
- 전역 기본 미디어 설정도 유지한다.
- 카드 배경 미디어 상태는 `inherit / none / asset` 세 가지다.
- 해석 우선순위는 `카드별 자산 > 전역 기본 자산 > 스타일 배경`이다.
- 이미지와 영상은 하나의 미디어 선택 경험에서 구분해서 보여준다.

### D2. 영상 배치

- 카드 전체를 채우는 배경 영상을 지원한다.
- 이동/크기 조절 가능한 자유 영상 레이어도 지원한다.
- 영상 레이어는 기존 텍스트/도형/선/이미지 레이어와 같은 좌표계와 z-order 원칙을 따른다.

### D3. 최종 영상

- 모든 카드를 순서대로 잇는 MP4 한 개를 출력한다.
- 고정 출력 프로필은 `1080x1920`, 30 fps, H.264 video, AAC audio, MP4다.
- 카드는 각각 하나의 장면이다.
- 정적 카드도 장면 시간을 가진다.
- 장면별 시간, 영상 in/out, 음량, 기본 전환을 지원한다.
- 소스 영상이 장면보다 짧으면 마지막 프레임을 유지한다. 자동 반복하지 않는다.

### D4. 오디오

- 카드마다 주 오디오 소스를 하나 선택한다.
- 나머지 영상 소스는 자동 음소거한다.
- 주 오디오가 없으면 해당 장면은 무음이다.
- 다중 오디오 믹싱, BGM 트랙, 오디오 편집기는 범위 밖이다.

### D5. 중앙 작업 보드

- 제목, 소제목, 본문, 배지, 푸터를 클릭해 선택할 수 있다.
- 선택한 표준 슬롯을 드래그해 이동할 수 있다.
- 더블클릭 또는 명확한 편집 진입으로 중앙 보드에서 텍스트를 수정할 수 있다.
- 표준 슬롯은 자유 레이어로 변환하지 않는다. 기존 카드 의미와 bulk/data 계약을 유지하는 semantic slot이다.
- 기존 custom layer 편집 기능은 그대로 유지한다.

### D6. 푸터와 본문 번호

- 푸터는 카드의 실제 오른쪽 끝까지 배치할 수 있어야 한다.
- 기존 `-40..40px` 이동값은 구형 프로젝트 호환을 위해 읽을 수 있어야 한다.
- 새 배치는 카드 기준 정규화 좌표와 anchor를 사용한다.
- 본문 번호의 전역 기본값은 `show / hide`다.
- 카드별 값은 `inherit / show / hide`다.
- 새 필드가 없는 구형 프로젝트는 번호를 표시한다.

### D7. AI 기본 지침

- 고정된 `꽁돈 AI`, `kkongdon_story` 인격/브랜드 지침을 제거한다.
- 이름은 `기본 지침`으로 통일한다.
- 현재의 일반적인 카드뉴스 작성/출력 안내를 초기값과 재설정 값으로 사용한다.
- 사용자는 값을 수정, 저장, 재설정할 수 있다.
- 모든 지원 CLI 제공자와 새 대화에 적용한다.
- 메시지 우선순위는 `불변 앱 안전·형식 계약 > 사용자 기본 지침 > 기능별 작업 문맥 > 대화 이력 > 최신 사용자 입력`이다.
- 일반 채팅은 사용자 문장을 임의의 꽁돈 캐릭터 프롬프트로 다시 쓰지 않는다.
- 액션 결과를 앱 카드로 적용하기 위한 구조/보안 규칙은 내부 불변 계약으로 남긴다.

### D8. Lite/Pro

| Feature | Lite | Pro |
| --- | --- | --- |
| 이미지/영상 미디어 라이브러리 | Enabled | Enabled |
| 카드별/전역 미디어 배치 | Enabled | Enabled |
| 영상 레이어와 장면 설정 | Enabled | Enabled |
| MP4 출력 | Enabled | Enabled |
| 중앙 semantic slot 직접 편집 | Enabled | Enabled |
| 푸터 전체 X 이동 | Enabled | Enabled |
| 본문 번호 표시 제어 | Enabled | Enabled |
| AI 기본 지침 편집 | Stripped/locked | Enabled |
| CLI AI 채팅 | Stripped/locked | Enabled |

공용 미디어 기능을 Lite에서 잠그거나 Pro 기능으로 이동시키면 안 된다. 반대로 AI 지침 문자열, AI 설정 UI, AI IPC/API, CLI 실행 코드는 Lite 산출물에서 스트리핑되어야 한다.

## 4. Compatibility and Storage Constraints

1. 기존 `Deck.backgroundId`, `CardOverride.backgroundId`, `layers`, `chrome`, `footerAccount`, 카드 텍스트 필드를 삭제하거나 의미를 바꾸지 않는다.
2. 새 필드는 optional이어야 하며, 없는 경우 현재 렌더와 동일한 기본값을 사용한다.
3. 기존 PNG/PNG ZIP API와 출력은 유지한다. MP4는 별도 API/IPC다.
4. 외부 파일의 절대 경로를 프로젝트 문서에 저장하지 않는다.
5. 가져온 미디어는 앱 userData 아래 관리 저장소로 복사하고 안정적인 ID로 참조한다.
6. 프로젝트 아카이브 v2는 미디어와 메타데이터를 포함한다.
7. 프로젝트 아카이브 v1을 계속 불러올 수 있어야 한다.
8. ZIP import는 경로 탈출, 심볼릭 링크, 허용되지 않은 확장자, 크기 제한 초과를 거부한다.
9. 미디어가 누락됐을 때 앱이 종료되거나 흰 화면이 되면 안 된다. 누락 표시와 복구 동선을 제공한다.

## 5. Export Architecture Constraint

M22의 구현 기준은 다음과 같다.

- Electron offscreen renderer에서 기존 카드 HTML/CSS를 재사용해 1080x1920 프레임을 만든다.
- 시간값을 외부 clock으로 주입해 동일 입력이 동일 프레임을 생성하도록 한다.
- 프레임은 디스크에 무제한 PNG로 쌓지 않고 encoder stdin으로 스트리밍한다.
- 별도 프로세스로 검증된 LGPL FFmpeg 빌드를 호출한다.
- Windows 기본 H.264 경로는 Media Foundation `h264_mf` software mode를 사용한다.
- `libx264`, `--enable-gpl`, `--enable-nonfree`가 포함된 빌드는 배포하지 않는다.
- AAC audio와 MP4 `faststart`를 사용하고 일반 플레이어 호환 pixel format을 보장한다.
- 출력 중에는 `.partial.mp4`를 쓰고 성공 시 최종 파일명으로 원자적 전환한다.
- 취소/실패 시 partial/temp 파일을 정리한다.
- WebCodecs는 미래 adapter 후보일 뿐 M22 완료 기준이 아니다.

FFmpeg 바이너리의 해시, 버전, build configuration, encoder availability, license/source/build recipe notice는 release gate의 일부다.

## 6. Success Criteria

### AC1. Card-first media

- 선택 카드에서 2단계 이내에 이미지/영상을 추가하고 해당 카드에만 적용할 수 있다.
- `전역 따름`, `이 카드만`, `비우기` 상태가 UI와 저장값에서 일치한다.
- 카드 rail이 local/inherited/video 상태를 구분한다.
- 전역 변경은 inherit 카드에만 반영된다.

### AC2. Video composition

- 배경 영상과 자유 영상 레이어가 preview와 MP4에 같은 배치로 보인다.
- scene duration, clip in/out, volume, transition이 저장/복원된다.
- 카드별 주 오디오 하나만 실제 audio graph에 포함된다.
- 영상이 짧으면 마지막 프레임이 유지된다.

### AC3. MP4

- 2장 이상의 프로젝트를 하나의 `1080x1920`, 30 fps MP4로 출력한다.
- ffprobe 기준 H.264/AAC, 총 길이, 장면 순서가 timeline과 일치한다.
- 진행률, 취소, 실패 사유, 결과 파일 열기가 정상 작동한다.
- PNG/ZIP 출력 회귀가 없다.

### AC4. Direct semantic editing

- 제목, 소제목, 본문, 배지, 푸터를 중앙 보드에서 선택/이동/편집한다.
- 한글 IME, 줄바꿈, 공백, 실행 취소 불가 상황의 취소 동작이 데이터 손실 없이 작동한다.
- 표준 슬롯의 의미와 bulk 바인딩이 유지된다.
- preview, PNG, MP4가 같은 slot geometry를 사용한다.

### AC5. Footer and number

- 모든 지원 비율에서 푸터를 카드 오른쪽 안전영역과 물리적 가장자리까지 이동할 수 있다.
- 구형 footer offset 프로젝트는 기존 위치로 보인다.
- 전역/카드별 본문 번호 조합이 `inherit/show/hide` 표와 일치한다.

### AC6. AI

- Pro에서 기본 지침을 저장/재설정하고 모든 CLI 제공자 요청에 적용한다.
- 고정 Kkongdon 브랜드 문자열이 prompt path에 남지 않는다.
- Lite source/build/package scan에서 AI 기본 지침 UI, IPC, 저장키, prompt symbol이 발견되지 않는다.

### AC7. Compatibility and safety

- 새 필드가 없는 workspace와 archive v1이 현재 모습으로 열린다.
- archive v2가 이미지/영상과 카드 연결을 round-trip한다.
- 파일명에 한글/공백이 있어도 import/export된다.
- 경로 탈출, 비지원 파일, 과대 파일, 손상 미디어를 안전하게 거부한다.

## 7. Explicit Non-goals

- 자동 자막, 음성 인식, 자막 편집.
- 필터, 색보정, 영상 효과, 키프레임.
- 멀티트랙 타임라인과 여러 오디오 소스 믹싱.
- BGM 라이브러리와 오디오 편집기.
- 화면 녹화와 카메라 녹화.
- Instagram, YouTube, Threads 등으로 직접 업로드.
- Canva 전체 기능 또는 UI 복제.
- 표준 콘텐츠를 모두 자유 레이어로 마이그레이션.
- M22 계획 단계에서 EXE 패키징.

## 8. Implementation Decision Boundaries

구현자가 별도 질문 없이 결정해도 되는 항목:

- 컨트롤 이름과 아이콘의 세부 표현.
- `none`, `fade`를 포함한 소수의 기본 transition 목록.
- 정적 카드 기본 시간과 유효 최소/최대 범위.
- 고정 출력 계약 안의 bitrate/quality 값.
- 내부 type/helper 이름과 정규화 좌표 구현 방식.
- evidence 개별 파일명.

사용자 승인 없이 바꾸면 안 되는 항목:

- 한 개의 연결된 1080x1920 MP4라는 출력 단위.
- 배경 영상과 자유 영상 레이어 동시 지원.
- 카드별 주 오디오 하나 규칙.
- 5개 semantic slot 직접 편집 범위.
- Lite/Pro 에디션 표.
- PNG와 구형 프로젝트 호환.
- 명시적 non-goal.

## 9. Handoff

- PRD: `.omx/plans/prd-v6-m22-media-video-canvas-ai.md`
- Test spec: `.omx/plans/test-spec-v6-m22-media-video-canvas-ai.md`
- Evidence root for future implementation: `.omc/evidence/v6/m22-media-video-canvas-ai/`

다음 단계는 PRD와 테스트 스펙 승인 후 M22 구현이다. 이 요구사항 인터뷰는 제품 코드 또는 EXE를 변경하지 않는다.
