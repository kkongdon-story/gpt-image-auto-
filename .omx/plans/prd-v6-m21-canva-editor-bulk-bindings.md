# PRD: V6 M21 Canva-like Editor Controls and Template-bound Bulk Generation

## 1. Goal

Cardnews Studio Lite/Pro의 수동 편집 흐름을 Canva처럼 예측 가능하게 만들고, Pro 대량 생성이 고정 필드뿐 아니라 사용자가 배치한 임의 텍스트 박스까지 채울 수 있도록 확장한다.

완료 상태는 다음과 같다.

- 제목을 카드 전체 세로 범위 안에서 직접 배치할 수 있다.
- 푸터를 X/Y 양축으로 이동할 수 있다.
- 포인트 색상을 프리셋 외 임의 색으로 지정할 수 있다.
- 텍스트 박스 인라인 편집 시 글자가 한 번만 보이며, 투명 배경은 흰색으로 바뀌지 않는다.
- Pro 대량 생성은 현재 템플릿의 표준 필드와 임의 텍스트 레이어에서 샘플 CSV 열을 생성한다.
- 썸네일 우클릭 메뉴와 키보드로 페이지를 복제/삽입/삭제할 수 있다.
- 선택 레이어에 `Ctrl/Cmd+C`, `Ctrl/Cmd+X`, `Ctrl/Cmd+V`가 작동한다.
- 글자 투명도와 레이어 전체 투명도를 독립적으로 조절할 수 있다.
- 기존 프로젝트, CSV v1, Lite/Pro 에디션 경계, 미리보기/PNG 단일 렌더 경로가 유지된다.

이 문서는 구현 계획이다. M21 실행 명령 전에는 제품 코드, EXE, 설치 파일을 변경하지 않는다.

## 2. Current Findings and Root Causes

### 2.1 제목 위치

- `src/domain/types.ts:77-82`의 `CardLayoutOverride.offsetY`는 제목만이 아니라 콘텐츠 묶음 전체를 이동한다.
- `src/ui/App.tsx:3946-3956`과 `src/render-engine/cardTemplate.ts:868-874`가 값을 `-20..20`으로 제한한다.
- 단순히 제한값을 확대하면 기존 필드 의미가 모호해지고 제목 외 소제목/본문도 함께 움직인다.

### 2.2 푸터와 포인트 색상

- `ChromeSlotStyle`과 렌더러는 이미 `offsetX`, `offsetY`를 지원한다.
- `src/ui/App.tsx:3611-3640`의 푸터 UI만 X 입력을 노출하지 않는다.
- `src/ui/App.tsx:3158-3175`의 포인트 색상은 고정 스와치와 초기화만 제공한다.

### 2.3 텍스트 박스 인라인 편집

- 편집 오버레이 아래 iframe 렌더 텍스트가 계속 보이고 그 위에 textarea가 추가되어 글자가 겹친다.
- `src/ui/styles.css:741-750`이 textarea 배경을 `rgba(255,255,255,0.92)`로 강제한다.
- 제품 렌더러의 텍스트 레이어 기본 배경은 투명하므로 편집 화면과 결과물의 표현도 다르다.

### 2.4 대량 생성

- `src/domain/csvBulk.ts`의 v1 스키마는 `header_label`, `footer_account`, `card_01..card_10` 같은 고정 열이다.
- 사용자가 표준 제목 대신 임의 텍스트 박스로 디자인하면 CSV 열과 해당 레이어를 연결할 방법이 없다.

### 2.5 페이지와 레이어 명령

- 현재 페이지 추가/삭제는 `App.tsx`의 개별 상태 변경으로 처리된다.
- 카드 번호를 키로 사용하는 `overrides`를 원자적으로 재배열하는 공통 연산이 없다.
- 편집 모드 키보드 처리는 삭제, Escape, 화살표 이동만 지원한다.

### 2.6 글자 투명도

- 모든 레이어의 `opacity`는 배경, 테두리, 글자를 함께 흐리게 한다.
- `CardTypographyOverride`와 `CardTextBoxLayer`에는 글자 전용 투명도가 없다.

첨부 재현 이미지:

```text
C:\Users\js480\AppData\Local\Temp\codex-clipboard-c87a83ee-709e-4e3e-b9ee-8fe4ac6aa8ff.png
```

## 3. Scope

### In scope

1. 표준 제목의 카드 기준 직접 Y 위치.
2. 기존 콘텐츠 묶음 Y 위치 명칭 정리 및 호환 유지.
3. 푸터 X/Y 위치 조절.
4. 공용 색상 선택 컨트롤.
5. 텍스트 레이어 인라인 편집 결함 수정과 한글 IME 안전 처리.
6. 텍스트 전용 투명도.
7. 페이지 우클릭 메뉴와 원자적 페이지 연산.
8. 레이어 내부 클립보드와 복사/잘라내기/붙여넣기.
9. Pro 템플릿 변수 바인딩과 CSV v2.
10. 기존 프로젝트/CSV v1/프로젝트 아카이브 호환.
11. Lite/Pro 공통 수동 편집 기능과 Pro 전용 대량 생성 경계 검증.

### Out of scope

- Canva의 시각 디자인, 상표, 아이콘 배치를 복제하는 작업.
- 표준 제목/본문을 모두 자유 레이어로 이관하는 대규모 데이터 마이그레이션.
- 다중 선택, 그룹/그룹 해제, 페이지 드래그 정렬, 협업 편집.
- 운영체제 전역 클립보드에 Cardnews Studio 레이어 JSON을 노출하는 기능.
- 이미지 교체용 대량 바인딩과 네트워크 이미지 다운로드. M21 v2는 텍스트 바인딩을 우선한다.
- 새로운 XLSX 라이브러리 도입. M21 샘플은 Excel에서 열 수 있는 UTF-8 CSV를 기준으로 한다.
- undo/redo history 도입. M21은 파괴 명령에 확인/상태 피드백/클립보드 보존을 제공하고 history stack은 후속 milestone로 둔다.
- EXE 패키징 및 release 배치.

## 4. Edition Matrix

| Feature | Lite | Pro |
| --- | --- | --- |
| 제목 직접 위치 | Enabled | Enabled |
| 푸터 X/Y | Enabled | Enabled |
| 임의 포인트 색상 | Enabled | Enabled |
| 인라인 텍스트 편집 수정 | Enabled | Enabled |
| 페이지 메뉴 | Enabled | Enabled |
| 레이어 복사/잘라내기/붙여넣기 | Enabled | Enabled |
| 글자 투명도 | Enabled | Enabled |
| 템플릿 변수 편집 | Locked/stripped | Enabled |
| CSV v2 샘플/가져오기/생성 | Locked/stripped | Enabled |
| CSV v1 호환 | 실행 표면 없음 | Enabled |

기존 V6 원칙을 바꾸지 않는다. 수동 디자인/콘텐츠 편집은 Lite와 Pro 공통이고 AI/대량 생성은 Pro 전용이다.

## 5. Interaction Reference

Canva에서 차용하는 것은 시각 디자인이 아니라 익숙한 동작 규칙이다.

- 텍스트 선택 후 가까운 플로팅 툴바에서 색상/크기/스타일을 수정한다: https://www.canva.com/help/add-and-edit-text/
- 선택 요소에 삭제, 방향키 이동, 복사/붙여넣기 단축키를 적용한다: https://www.canva.com/help/canva-keyboard-shortcuts/
- 텍스트와 요소의 투명도를 툴바에서 슬라이더/값으로 조절한다: https://www.canva.com/en_gb/help/transparency/
- 페이지 썸네일에서 복제/삭제/복사 동작을 제공한다: https://www.canva.com/pt_br/help/manage-pages/
- 대량 생성은 고정 앱 필드가 아니라 디자인의 데이터 자리와 표 데이터를 연결한다: https://www.canva.com/fr_be/help/bulk-create-data-autofill/

## 6. RALPLAN-DR

### Principles

1. 기존 저장 문서는 새 필드가 없어도 동일하게 렌더되어야 한다.
2. 미리보기와 PNG는 같은 렌더 모델을 사용한다.
3. 편집기 오버레이는 렌더러를 복제하지 않고 선택/입력 상태만 덧댄다.
4. 페이지 연산은 카드 텍스트와 override를 한 트랜잭션으로 이동한다.
5. 대량 생성은 템플릿이 데이터 계약을 선언하고 CSV가 값을 제공한다.
6. 일반 편집 기능은 Lite/Pro 공통, 대량 생성 코드는 Lite에서 잠금/스트리핑한다.
7. 입력 포커스가 있는 동안 앱 단축키는 일반 텍스트 복사/붙여넣기를 침범하지 않는다.

### Decision drivers

- `offsetY` 확대만으로는 제목 단독 이동 요구를 충족하지 못한다.
- 페이지 복제/삭제는 현재 카드 번호 기반 저장 구조에서 데이터 손실 위험이 크다.
- 자유 텍스트 박스를 사용하면 고정 CSV 열 방식은 확장할수록 더 복잡해진다.
- 글자 투명도와 배경/레이어 투명도는 사용자 의도가 다르다.
- 인라인 편집은 결과 렌더와 최대한 같은 형태여야 한다.

### Options considered

#### Option A: 기존 `offsetY` 범위를 큰 숫자로 확대

Rejected.

- 제목이 아니라 콘텐츠 전체가 이동한다.
- 비율/스타일마다 필요한 수치가 달라진다.
- 기존 필드의 의미를 더 모호하게 만든다.

#### Option B: 표준 제목을 자유 텍스트 레이어로 즉시 전환

Rejected for M21.

- 저장 형식, 양식, 파서, 렌더러에 광범위한 마이그레이션이 필요하다.
- 기존 카드 콘텐츠 편집 흐름을 깨뜨릴 위험이 크다.

#### Option C: 기존 흐름과 선택적 제목 직접 배치를 공존

Chosen.

- 필드가 없거나 `flow`면 기존 결과가 완전히 유지된다.
- 사용자가 필요할 때만 카드 기준 Y 좌표와 앵커를 선택한다.

#### Option D: CSV v1 고정 열을 계속 추가

Rejected.

- 새 레이어마다 앱 스키마 변경이 필요하다.
- 동일한 역할의 텍스트 박스라도 템플릿마다 위치와 개수가 다르다.

#### Option E: 템플릿 변수 키와 레이어/표준 슬롯을 연결하는 CSV v2

Chosen.

- 현재 템플릿에서 샘플 CSV를 생성할 수 있다.
- 사용자는 임의 텍스트 박스에도 데이터 열을 연결할 수 있다.
- CSV v1은 기존 파일 호환을 위해 유지할 수 있다.

### Revisit triggers

- 제목 직접 배치가 4개 비율 중 하나에서 안정적으로 클램프되지 않으면 M21은 `top/center/bottom` 앵커 + Y 좌표로 제한하고 자유 회전/가로 이동은 후속으로 미룬다.
- 페이지 연산에서 카드 번호 기반 override 재배열이 반복적으로 결함을 만들면 후속 ADR에서 stable page id 도입을 검토한다.
- CSV v2가 이미지 치환 요구를 받으면 텍스트 v2 완료 후 별도 이미지 자산 보안/수명주기 설계를 수행한다.

## 7. ADR: Compatibility-preserving Editor Commands and Template Bindings

### Decision

M21은 다음 다섯 개의 호환 가능한 계약을 추가한다.

1. 선택적인 `titlePlacement` 계약.
2. 텍스트 전용 `textOpacity` 계약.
3. 순수 함수 기반 페이지 트랜잭션.
4. 앱 내부 레이어 클립보드.
5. Pro 전용 템플릿 바인딩 + CSV v2.

### Consequences

- UI 상태 변경 일부가 `App.tsx`에서 도메인 유틸리티로 이동한다.
- 저장 스키마에 선택 필드가 추가되지만 미지정 기본값은 현재 동작이다.
- 텍스트 레이어 렌더 마크업에 foreground wrapper가 추가된다.
- CSV v1과 v2를 동시에 식별/검증해야 한다.
- 페이지 연산과 bulk binding 연산이 같은 인덱스 변경 규칙을 사용해야 한다.

### Rejected alternatives

- 큰 magic range, 표준 콘텐츠의 전면 레이어화, OS 클립보드 전용 구현, CSV 열 무한 확장.

## 8. Data and Command Contracts

### 8.1 Title placement

정확한 저장 위치와 선택 필드:

```ts
type TitlePlacement =
  | { mode: "flow" }
  | { mode: "card-y"; y: number }; // 0..100, normalized travel

type CardLayoutOverride = {
  // existing fields
  titlePlacement?: TitlePlacement;
};
```

- `undefined`와 `mode: "flow"`는 현재 레이아웃과 동일하다.
- `card-y`는 표준 제목만 카드 전체 Y 좌표에 배치한다.
- `y`는 finite number로 정규화한 뒤 `0..100`으로 clamp한다.
- CSS/geometry 계약은 `top: y%`, `translateY(-y%)`이다. 결과 title top은 `(cardHeight - titleHeight) * y / 100`과 같으므로 `0`은 카드 최상단, `100`은 제목 아랫변이 카드 최하단에 놓인다.
- 직접 배치 제목은 absolute visual layer로 이동하되 원래 flow 자리에는 동일 높이 placeholder를 남긴다. 소제목/본문 위치는 제목 이동만으로 재배치되지 않는다.
- UI는 `제목 위치: 자동 / 직접`을 제공한다.
- 현재 `세로 위치`는 `콘텐츠 묶음 위치`로 명칭을 바꾸고 기존 `-20..20` 계약을 유지한다.
- 직접 배치 시 카드 밖 클리핑은 막되 헤더/페이지 번호와의 의도적 겹침은 허용하고 정렬선/경고로 알린다.

### 8.2 Footer position

- 기존 `ChromeSlotStyle.offsetX`를 푸터 UI에 노출한다.
- X/Y는 동일한 단위와 입력 방식(슬라이더 + 숫자)을 사용한다.
- 기본값 0은 기존 출력과 동일하다.

### 8.3 Color control

공용 컨트롤은 다음을 제공한다.

- 빠른 프리셋 스와치.
- native color picker.
- 검증된 `#RRGGBB` 입력.
- 스타일 기본값으로 초기화.

`#RGB`, alpha 색상, 최근 색상 기록은 구현 복잡도가 증가하면 후속으로 미룰 수 있다. M21 필수 수용 기준은 임의 `#RRGGBB` 지정과 잘못된 값 거부다.

### 8.4 Text foreground structure

자유 텍스트 레이어는 배경/테두리/전체 opacity를 가진 outer element와 글자만 가진 inner foreground로 나눈다.

```html
<div data-slot="layer-id" class="layer text-layer">
  <span data-layer-text="layer-id">...</span>
</div>
```

- 인라인 편집 중에는 해당 `[data-layer-text]`만 숨긴다.
- outer 배경/테두리는 그대로 보여서 편집 결과와 실제 결과가 일치한다.
- textarea는 실제 정렬, 폰트, 줄높이, 색상, 투명/설정 배경을 사용하고 레이아웃을 바꾸는 padding/border를 추가하지 않는다.
- `compositionstart`/`compositionend` 동안 Enter/Escape 단축키로 편집을 확정/취소하지 않는다.

### 8.5 Text opacity

- `CardTextBoxLayer.textOpacity?: number` 범위는 0..100이다.
- `CardTypographyOverride.textOpacity?: number`도 0..100이며 기존 `scope`(`all/title/body`)를 따른다.
- 기존 `layer.opacity`는 배경/테두리/글자를 포함한 전체 레이어 투명도로 유지한다.
- 글자 투명도 0에서도 선택 윤곽/편집 진입은 가능해야 한다.
- `body` 범위는 소제목, 본문, 불릿, 출처, 강조 텍스트에 적용하고 배지는 별도 배지 컨트롤을 유지한다.

### 8.6 Page operation transaction

새 순수 모듈은 최소 다음 명령을 제공한다.

- `insertPageBefore(index)`
- `insertPageAfter(index)`
- `duplicatePage(index)`
- `deletePage(index)`

각 명령은 한 번에 다음을 반환한다.

- 새 `cards`.
- 카드 번호 키가 재배열된 `overrides`.
- 새 selected index.
- bulk binding 인덱스 재배열 결과.
- 사용자에게 보여줄 충돌/삭제 경고.

현재 저장 구조의 외부 page index는 0-based이고 override/binding `cardNumber`는 1-based다. 대상 page index를 `i`, 기존 1-based key를 `k`라고 할 때 매핑은 다음으로 고정한다.

| Operation | New page key | Existing key mapping | Selected page |
| --- | ---: | --- | ---: |
| insert before `i` | `i + 1` | `k >= i + 1 ? k + 1 : k` | inserted `i` |
| insert after `i` | `i + 2` | `k >= i + 2 ? k + 1 : k` | inserted `i + 1` |
| duplicate `i` | clone `i + 2` | `k > i + 1 ? k + 1 : k` | clone `i + 1` |
| delete `i` | none | remove `k = i + 1`; `k > i + 1 ? k - 1 : k` | `min(i, newLength - 1)` |

모든 page transaction은 `idFactory`와 `bindingKeyFactory`를 인자로 받아 테스트에서 결정적 값을 주입한다. 제품 기본 factory는 충돌 없는 새 ID/key를 만든다.

규칙:

- 기존 페이지 이동 시 layer id와 background/image asset id는 유지한다.
- 페이지 복제 시 layer id는 모두 새로 발급한다.
- 복제된 이미지/background는 같은 자산을 참조하되 파일을 중복 복사하지 않는다.
- 복제된 bulk variable key는 충돌하지 않도록 결정적 suffix를 붙이고 사용자가 수정할 수 있다.
- 마지막 한 페이지 삭제는 비활성화한다.
- M21은 undo/redo를 제공하지 않는다. 내용이 있는 페이지 삭제는 확인 dialog를 거치고, cut clipboard는 다음 copy/cut까지 유지하여 여러 번 paste할 수 있으며, 모든 파괴 명령은 상태 메시지를 남긴다.

### 8.7 Internal layer clipboard

- 대상: text, shape, line, image layer.
- copy: 선택 레이어의 불변 스냅샷 저장.
- cut: copy 성공 후 동일 페이지에서 삭제.
- paste: 새 id 발급, 위치를 작은 고정 간격으로 이동, 카드 범위로 clamp, 새 레이어 선택.
- 다른 페이지로 이동 후 paste를 허용한다.
- `input`, `textarea`, `select`, `contenteditable`, 인라인 편집, IME 조합 중에는 앱 명령을 가로채지 않는다.
- `Ctrl`과 macOS 대비 `Meta`를 모두 인식하되 Windows 배포의 `Ctrl`을 우선 검증한다.

### 8.8 Bulk schema v2

CSV v2 reserved columns:

```text
__schema,__template_id,__template_revision,output_name,<binding keys...>
```

- `__schema` 값: `kkongdon.cardnews.bulk.v2`.
- 한 행은 한 개 deck 출력이다.
- binding key는 ASCII 안정 키 `[A-Za-z][A-Za-z0-9_]{0,63}`를 사용한다.
- 화면 표시명은 한국어를 허용하며 key와 분리한다.
- 표준 슬롯: deck header/footer, badge/title/subtitle/body/bullets/source/emphasis.
- 자유 슬롯: custom text layer의 `.text`.
- 현재 템플릿에서 `샘플 CSV 만들기`를 누르면 선언된 binding 순서대로 헤더와 예시 행을 만든다.
- 가져오기 전 template id/revision, 필수 열, 중복 키, 행 수, 셀 크기, 빈 output name을 preflight한다.
- template/revision mismatch는 조용히 잘못 적용하지 않고 명시적으로 중단한다.
- `output_name`은 경로 구분자와 traversal을 거부하고 안전한 파일명으로 검증한다.
- CSV formula injection 위험 문자는 샘플/내보내기에서 안전하게 이스케이프한다.
- v1 헤더가 감지되면 기존 파서로 처리한다.

정확한 저장 계약:

```ts
type BulkBindingTarget =
  | { kind: "deck"; field: "header" | "footer" }
  | {
      kind: "standard";
      cardNumber: number; // 1-based
      field: "badge" | "title" | "subtitle" | "body" | "bullets" | "source" | "emphasis";
    }
  | {
      kind: "layer-text";
      cardNumber: number; // 1-based
      layerId: string;
      property: "text";
    };

type BulkBinding = {
  key: string;
  label: string;
  required: boolean;
  defaultValue?: string;
  target: BulkBindingTarget;
};

type BulkBindingMetadata = {
  schemaVersion: 1;
  templateId: string;
  templateRevision: number;
  bindings: BulkBinding[]; // CSV column order
};
```

`WorkspaceState.bulkBindings?`와 `DeckPreset.bulkBindings?`에 같은 metadata를 선택적으로 저장한다. transient CSV dialog state에만 저장하지 않는다.

안전 한도:

- CSV file: 최대 10 MiB.
- data rows: header 제외 최대 300.
- total columns: reserved columns 포함 최대 150.
- cell: 최대 20,000 Unicode characters 및 UTF-8 64 KiB 중 먼저 도달하는 한도.
- `output_name`: 최대 120 characters, 경로 구분자/제어문자/`..`/Windows reserved name/formula prefix 거부.
- importer는 어떤 셀도 수식으로 평가하지 않고 plain text로만 취급한다.
- sample/export에서 사용자 제공 값이 `=`, `+`, `-`, `@`, tab, carriage return으로 시작하면 Excel formula 실행을 막기 위해 apostrophe를 앞에 붙인다. 앱 적용 시 해당 export escape를 명시적으로 해제하지 않는다.

저장 방향:

- `WorkspaceState`/`DeckPreset`에 선택적 Pro bulk binding metadata를 저장한다.
- project archive는 기존 데이터와 새 선택 필드를 모두 허용한다.
- Lite는 프로젝트를 열고 다시 저장해도 inert `bulkBindings` metadata를 보존한다. 단, bulk UI/handler/materialization/import/export 실행 모듈은 노출하거나 호출하지 않는다.
- `verify-edition`은 Pro 실행 심볼/문구/entry import를 계속 차단하되 shared metadata type/sanitizer의 존재만으로 실패해서는 안 된다.
- template pack v1 자체를 M21에서 강제 변경하지 않는다. 가져온 뒤 Pro에서 바인딩을 설정할 수 있다.

## 9. Functional Requirements

### R1. Full-card title Y placement

Acceptance:

- 직접 모드의 y=0/50/100이 각각 카드의 top/middle/bottom travel position에 놓인다.
- 4:5, 1:1, 16:9, 4:3에서 제목 박스가 카드 밖으로 잘리지 않는다.
- 제목을 움직여도 소제목/본문의 flow 위치는 변하지 않는다.
- 기존 저장 파일은 위치가 변하지 않는다.
- 미리보기와 PNG 좌표가 일치한다.

### R2. Footer X/Y

Acceptance:

- 푸터 X와 Y가 독립적으로 움직인다.
- X/Y 0은 기존 결과와 픽셀 동등하다.
- 카드별 override 저장/복원이 된다.

### R3. Arbitrary point color

Acceptance:

- 스와치에 없는 임의 `#RRGGBB`를 입력/선택할 수 있다.
- 유효하지 않은 값은 마지막 유효값을 훼손하지 않고 오류 상태를 표시한다.
- 미리보기, PNG, 저장/복원이 동일하다.

### R4. Single-surface inline text editing

Acceptance:

- 편집 중 동일 글자가 두 번 보이지 않는다.
- 투명 텍스트 레이어가 흰 상자로 바뀌지 않는다.
- 설정된 배경색/정렬/폰트/줄높이가 편집 오버레이에 반영된다.
- 한글 조합 중 글자가 유실되거나 Enter/Escape가 오작동하지 않는다.

### R5. Template-bound bulk generation

Acceptance:

- 사용자가 임의 텍스트 레이어에 변수 키와 표시명을 지정할 수 있다.
- 현재 템플릿에서 생성된 샘플 CSV로 표준 필드와 자유 텍스트 레이어를 모두 채울 수 있다.
- CSV v1 파일은 계속 처리된다.
- 잘못된 템플릿/열/경로/크기 입력은 렌더 전에 실패한다.
- Lite에서 bulk UI/실행 경로가 노출되지 않는다.

### R6. Page thumbnail commands

Acceptance:

- 우클릭 메뉴에 `앞에 페이지 추가`, `뒤에 페이지 추가`, `페이지 복제`, `페이지 삭제`가 있다.
- `Shift+F10` 또는 Menu 키로 같은 메뉴에 접근할 수 있다.
- 모든 연산 후 카드 텍스트, override, 자산 참조, 선택 인덱스, bulk binding이 올바른 페이지에 남는다.
- 마지막 페이지 삭제는 비활성화되고 내용이 있는 페이지 삭제는 확인을 거친다. M21에는 undo/redo가 없음을 상태 피드백에서 숨기지 않는다.

### R7. Layer clipboard

Acceptance:

- 선택 레이어에서 copy/cut/paste가 작동한다.
- 붙여넣은 레이어 id는 원본과 다르다.
- 텍스트 입력 중 단축키는 브라우저 기본 텍스트 클립보드로 동작한다.
- 잘라내기 후 붙여넣기까지 데이터가 유실되지 않는다.

### R8. Text opacity

Acceptance:

- 글자 투명도 0..100을 툴바와 inspector에서 조절할 수 있다.
- 텍스트 박스 배경/테두리는 글자 투명도 변경으로 흐려지지 않는다.
- 레이어 전체 opacity는 기존처럼 모든 시각 요소에 적용된다.
- 표준 제목/본문 scope와 자유 텍스트 레이어 모두 저장/복원/PNG에 반영된다.

### R9. Canva-like consistency and accessibility

Acceptance:

- 기존 M15 플로팅 툴바를 확장하며 중복 툴바를 만들지 않는다.
- 메뉴와 아이콘에 접근 가능한 이름/tooltip/focus 상태가 있다.
- 컨텍스트 메뉴는 viewport를 벗어나지 않고 Escape/외부 클릭으로 닫힌다.
- 텍스트, 레이어, 페이지의 키보드 명령 충돌 우선순위가 문서화되고 테스트된다.

## 10. Implementation Sequence

### M21-0. RED baselines and fixtures

- 첨부 사례와 동일한 텍스트 중복/흰 배경을 재현하는 DOM/시각 fixture를 만든다.
- 현재 `offsetY` 제한, footer X UI 부재, fixed CSV v1, 키보드 부재를 테스트로 고정한다.
- 구현 전 실패 증거를 M21 evidence root에 남긴다.

Exit:

- 각 결함에 대응하는 RED 테스트나 재현 로그가 있다.

### M21-1. Domain contracts and persistence

- 선택적 title placement, text opacity, bulk binding 타입/정규화/저장 호환을 추가한다.
- explicit allowlist인 WorkspaceState/DeckPreset validator와 Lite edition filter에 inert `bulkBindings` sanitizer/preservation을 같은 slice에서 추가한다.
- 순수 page operation과 clipboard helper를 추가한다.
- CSV v1/v2 감지와 v2 preflight를 분리한다.

Exit:

- 순수 도메인 테스트가 통과하고 기존 fixture가 동일하게 역직렬화된다.

### M21-2. Renderer and editor controls

- 제목 직접 배치와 foreground wrapper/text opacity를 공용 renderer에 구현한다.
- footer X, 공용 color control, text opacity를 기존 inspector/플로팅 툴바에 연결한다.
- `editorToolbar` patch type에도 `textOpacity`를 추가해 UI가 임시 any patch를 만들지 않게 한다.
- 인라인 textarea가 실제 레이어 외형과 IME 규칙을 따른다.

Exit:

- 4개 비율 미리보기/PNG 좌표 parity와 인라인 편집 시각 회귀가 통과한다.

### M21-3. Page commands and layer clipboard

- 썸네일 컨텍스트 메뉴/키보드 메뉴를 pure transaction에 연결한다.
- edit-mode copy/cut/paste를 포커스 가드와 함께 연결한다.

Exit:

- 페이지/레이어 연산의 데이터 무결성과 키보드 충돌 테스트가 통과한다.

### M21-4. Pro bulk v2

- 템플릿 변수 UI, 샘플 CSV, v2 import/preflight, deck materialization을 연결한다.
- v1 fallback과 edition gating을 검증한다.

Exit:

- 표준 슬롯 + 임의 텍스트 레이어가 행마다 치환되고 Lite 번들에서 Pro surface가 차단된다.

### M21-5. Full gates and handoff

- typecheck, 전체 tests, Lite/Pro build, edition strip, UI/PNG smoke를 실행한다.
- evidence meta JSON과 HANDOFF append를 완료한다.
- EXE는 만들지 않는다.

Exit:

- test spec의 모든 source gate가 green이고 알려진 blocker가 없다.

## 11. Ownership Map

| Area | Primary files/modules |
| --- | --- |
| Shared types/normalization | `src/domain/types.ts`, storage normalizers |
| Page transactions | new `src/domain/pageOperations.ts` |
| Bulk bindings | new `src/domain/templateBulkBindings.ts`, `src/domain/csvBulk.ts` |
| Layer clipboard | new `src/ui/layerClipboard.ts` |
| Shared renderer | `src/render-engine/cardTemplate.ts` |
| Editor UI | `src/ui/App.tsx`, `src/ui/editorToolbar.ts`, `src/ui/styles.css` |
| Persistence/archive | `src/storage/deckStore.ts`, `src/storage/projectArchive.ts` |
| Edition boundary | `src/domain/editionFilter.ts`, `scripts/verify-edition.mjs` |
| Tests | matching `*.test.ts` plus M21 smoke harness |

Shared files, especially `App.tsx`, `types.ts`, `cardTemplate.ts`, are single-owner integration surfaces during parallel execution.

## 12. Risks and Rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| New title mode clips or overlaps unexpectedly | 4-ratio geometry tests and optional field default | Hide direct mode; preserve flow parser |
| Page operations misalign overrides | pure transaction tests before UI wiring | Restore old add/delete UI while retaining helper branch |
| Text opacity changes backgrounds | outer/foreground separation tests | disable UI field; undefined keeps old render |
| Bulk v2 applies wrong template | template id/revision preflight | disable v2 surface; v1 remains |
| Shortcuts steal text editing | focus/IME guards and event tests | disable app clipboard listener |
| Lite leaks Pro bulk code/UI | edition filter and dist scan | block Lite release until strip passes |

## 13. Evidence Contract

Evidence root:

```text
.omc/evidence/v6/m21-canva-editor-bulk-bindings/
```

각 gate는 최소 다음을 남긴다.

- `<gate>.log`
- `<gate>.meta.json`
- 명령, 시작/종료 시각, exit code, edition, git commit/dirty state, 결과 요약
- 시각 gate는 screenshot/PNG와 expected/actual 좌표 또는 이미지 비교 결과

## 14. Agent Roster and Staffing

권장 실행은 승인된 계획을 `$ultrawork` 또는 단일-owner `$ralph`로 수행한다. 병렬화할 경우 다음 소유권을 넘지 않는다.

1. `executor-domain` (medium/high): 타입, 정규화, page operations, bulk bindings.
2. `executor-render-ui` (high): renderer, App UI, inline editor, clipboard wiring. `App.tsx` 단독 소유.
3. `test-engineer` (medium): RED fixtures, unit/integration, edition gates.
4. `verifier` (high): Lite/Pro builds, visual/PNG parity, evidence audit.
5. `critic` (high, read-only): bulk v2 보안과 edition 경계 최종 검수.

## 15. Definition of Done

- R1-R9 수용 기준이 모두 증거로 연결된다.
- CSV v1과 기존 프로젝트가 회귀하지 않는다.
- Lite에서 수동 편집 기능은 작동하고 bulk 기능은 잠금/스트리핑된다.
- Pro에서 CSV v2가 표준 슬롯과 자유 텍스트 레이어를 채운다.
- typecheck/test/Lite build/Pro build/edition verification/시각 smoke가 모두 통과한다.
- HANDOFF.md가 append-only로 갱신된다.
- EXE 패키징은 별도 요청 전 수행하지 않는다.
