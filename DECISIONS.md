# Editable Pixel Decisions

최신 결정이 위에 위치한다.

## ADR-008 — 에이전트의 새 색상 추가와 픽셀 변경을 하나의 bounded patch로 처리한다

**Date**: 2026-08-21  
**Status**: Accepted

### Context

에이전트가 요청받은 색상이 현재 팔레트에 없을 때 팔레트 변경과 픽셀 변경을 따로 적용하면 중간 revision이 생기고, 사용자는 완성된 변경을 한 번에 미리보기·거부할 수 없다.

### Options

| 옵션 | 설명 |
|---|---|
| A | 사용자가 먼저 팔레트에 색을 추가한 뒤 일반 픽셀 패치를 요청 |
| B | 팔레트 추가와 선택 영역 픽셀 변경을 `palette-pixels` 패치 하나로 처리 |
| C | 전체 Document snapshot 패치로 처리 |

### Decision

새 RGBA 색상과 그 인덱스를 사용하는 픽셀 변경을 `palette-pixels` 패치 하나로 미리보기·적용한다.

### Rationale

revision 증가와 사용자 검토가 한 번으로 끝난다. 패치 생성과 적용 양쪽에서 선택 영역 좌표를 다시 검증하고 outside-selection hash를 유지하므로 전체 Document 패치보다 변경 범위가 명확하다.

## ADR-007 — 같은 탭 복구 데이터는 sessionStorage 포인터와 IndexedDB에 나눠 저장한다

**Date**: 2026-08-21  
**Status**: Accepted

### Context

원본 이미지 Blob과 여러 Pixel Document Variant는 일반적인 Web Storage 용량보다 클 수 있다. 새로고침에는 복구가 필요하지만 새로운 에디터 작업에는 이전 임시 상태가 자동으로 나타나면 안 된다.

### Options

| 옵션 | 설명 |
|---|---|
| A | 모든 데이터를 `sessionStorage`에 base64로 저장 |
| B | 탭별 workspace ID만 `sessionStorage`, Blob과 상태는 IndexedDB에 저장 |
| C | 로컬 서버 메모리에만 저장 |

### Decision

standalone 탭은 임의 workspace ID, 연결 모드는 고유 session ID를 키로 사용한다. 포인터는 `sessionStorage`, 원본 Blob·설정·Variant는 IndexedDB에 구조화 복제한다.

### Rationale

큰 원본을 base64로 부풀리지 않고 같은 탭 새로고침을 복구할 수 있다. 새 CLI 세션은 새 session ID를 가지므로 빈 작업으로 시작하고, 서버가 관리하는 canonical Pixel Document와 브라우저 임시 원본을 분리한다.

## ADR-006 — 아이콘은 react-icons의 단일 패밀리를 사용한다

**Date**: 2026-08-21  
**Status**: Accepted

### Context

플로팅 도구 모음과 Inspector에 일관된 실제 아이콘이 필요하다. 아이콘 수는 많지 않지만 개별 SVG 다운로드는 출처, 라이선스, 크기, 접근성 처리를 각각 관리해야 한다.

### Options

| 옵션 | 설명 |
|---|---|
| A | `react-icons`의 Tabler 계열만 직접 import |
| B | 개별 SVG 파일 다운로드 후 로컬 asset으로 관리 |
| C | CSS나 문자 기호로 직접 표현 |

### Decision

`react-icons`의 Tabler 계열 한 패밀리만 사용한다.

### Rationale

React와 자연스럽게 통합되고 아이콘의 선 굵기와 viewBox가 일관된다. 필요한 아이콘만 직접 import할 수 있으며 개별 asset 관리가 필요 없다. CSS나 문자 기반 아이콘은 시각적 일관성과 접근성이 떨어진다.

## ADR-005 — React를 유지하고 shadcn/ui와 Tailwind CSS를 도입한다

**Date**: 2026-08-21  
**Status**: Accepted

### Context

현재 웹 앱은 React 19와 Vite로 이미 구현돼 있고 Canvas, 세션, 테스트가 React 컴포넌트에 연결돼 있다. 재사용 가능한 Tabs, Tooltip, Sheet, Dialog, Popover가 필요하다.

### Options

| 옵션 | 설명 |
|---|---|
| A | React 유지 + shadcn/ui + Tailwind CSS |
| B | Svelte + shadcn-svelte로 전체 마이그레이션 |
| C | 기존 단일 CSS와 직접 만든 컴포넌트 계속 사용 |

### Decision

React/Vite/TypeScript를 유지하고 UI 계층에 shadcn/ui와 Tailwind CSS를 추가한다.

### Rationale

현재 기능과 테스트를 보존하면서 접근 가능한 UI primitive를 도입할 수 있다. Svelte 전환은 제품 가치 없이 전체 웹 앱을 다시 쓰게 한다. shadcn 기본 외형은 그대로 쓰지 않고 기존 dark industrial pixel-workbench 토큰으로 맞춘다.

## ADR-004 — Pan을 별도 도구로 노출하지 않는다

**Date**: 2026-08-21  
**Status**: Accepted

### Context

Pan은 픽셀을 수정하는 도구가 아니라 확대된 Canvas를 탐색하는 입력이다. 플로팅 바에서 별도 모드를 선택하면 그리기 흐름을 끊는다.

### Options

| 옵션 | 설명 |
|---|---|
| A | Hand/Pan 아이콘을 플로팅 바에 유지 |
| B | Space Drag, 가운데 버튼, 트랙패드로 일시 Pan |

### Decision

Pan 아이콘을 제거하고 Figma식 일시 탐색 입력을 제공한다.

### Rationale

도구 전환 횟수를 줄이고 현재 그리기 도구를 유지한 채 화면을 이동할 수 있다. Select는 기본 안전 도구로 사용하고 `Esc`로 돌아간다.

## ADR-003 — Content Frame으로 투명 안전 여백을 관리한다

**Date**: 2026-08-21  
**Status**: Accepted

### Context

AI 생성 캐릭터와 아이콘을 Canvas 끝까지 확대하면 에셋 세트의 시각적 크기와 여백이 불안정해진다. 타일처럼 끝까지 채워야 하는 에셋도 존재한다.

### Options

| 옵션 | 설명 |
|---|---|
| A | 모든 콘텐츠를 Canvas에 최대 크기로 맞춤 |
| B | TIGHT/SAFE/CUSTOM Content Frame 제공 |

### Decision

Canvas, Content Frame, Content Bounds를 구분하고 TIGHT/SAFE/CUSTOM 프리셋과 화면 가이드를 제공한다.

### Rationale

캐릭터·아이템에는 일관된 투명 Padding을 제공하면서 타일과 배경은 TIGHT로 유지할 수 있다. Frame 가이드는 편집 화면에만 보이고 PNG에는 포함하지 않는다.

## ADR-002 — 같은 탭 새로고침만 작업 세션을 복구한다

**Date**: 2026-08-21  
**Status**: Accepted

### Context

원본 재변환을 위해 원본 Blob과 Variant 상태를 보존해야 하지만 사용자는 에디터를 다시 열었을 때 이전 임시 작업이 자동으로 나타나는 것을 원하지 않는다.

### Options

| 옵션 | 설명 |
|---|---|
| A | 새로고침과 재실행 모두 영구 복구 |
| B | 새로고침만 복구하고 새 작업은 초기화 |
| C | 어떤 경우에도 복구하지 않음 |

### Decision

같은 탭 새로고침은 `workspaceSessionId`를 이용해 복구하고 새 탭·새 에디터 실행은 새 작업으로 초기화한다.

### Rationale

실수로 인한 새로고침 손실은 막으면서 임시 작업이 영구 프로젝트처럼 누적되지 않는다. 기존 작업은 사용자가 `.pixel.json`을 명시적으로 열어 이어간다.

## ADR-001 — Canvas-first Shell과 세 개의 Inspector 탭을 사용한다

**Date**: 2026-08-21  
**Status**: Accepted

### Context

현재 화면은 변환 Rack, Tool Rail, Canvas, Inspector, Timeline이 동시에 노출돼 Codex 내부 브라우저에서 핵심 작업이 작아지고 단계와 상태가 혼동된다.

### Options

| 옵션 | 설명 |
|---|---|
| A | 현재 한 화면 Rack 구조 유지 |
| B | 페이지 단위 Convert/Edit/Export 화면 전환 |
| C | Canvas 고정 + CONVERT/EDIT/AGENT Inspector 전환 |

### Decision

Canvas는 계속 유지하고 Inspector를 CONVERT/EDIT/AGENT 세 탭으로 전환한다. Save와 Export는 Header의 전역 행동으로 둔다.

### Rationale

사용자는 변환 설정과 에이전트 상태를 바꿔도 결과를 계속 볼 수 있다. 좁은 화면에서는 같은 Inspector를 Sheet로 표현해 정보 구조를 바꾸지 않는다.
