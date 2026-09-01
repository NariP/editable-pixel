# Editable Pixel Decisions

최신 결정이 위에 위치한다.

## ADR-017 — 생성 파이프라인을 번들하지 않고 로컬 설치·편집 경계를 출시한다

**Date**: 2026-09-01
**Status**: Accepted

### Context

Editable Pixel은 ComfyUI처럼 사용자의 기기에서 실행하는 제품이다. 공개 방식으로 GitHub, npm, `install.sh`, 웹 호스팅을 비교했고, Sprite Gen의 이미지 생성·프레임 추출 파이프라인까지 기본 npm 패키지에 포함할지도 결정해야 했다.

### Options

| 옵션 | 설명 |
|---|---|
| A | GitHub 소스만 공개하고 사용자가 직접 빌드 |
| B | 웹에 호스팅하고 생성 기능까지 하나의 앱에 포함 |
| C | GitHub와 npm으로 로컬 앱을 배포하고 `install.sh`를 제공하되 Sprite Gen은 외부 생성기로 유지 |

### Decision

단일 `editable-pixel` npm 패키지에 CLI, loopback 서버, 웹 편집기, MCP와 Skill을 배포한다. `install.sh`는 npm 설치·업데이트·삭제를 감싸는 보조 진입점으로 제공한다. 웹 호스팅은 하지 않는다. Sprite Sheet Import, Frames 편집, 루프 보정과 Sprite Sheet/GIF Export는 유지하지만 AI Sprite Sheet 생성 파이프라인은 번들하지 않는다.

### Rationale

사용자는 한 명령으로 로컬 편집기를 실행할 수 있고 이미지와 세션 데이터는 기기에 남는다. npm을 단일 배포 원천으로 사용하면 설치 스크립트와 업데이트 경로가 중복되지 않는다. 생성 Provider, Python 이미지 처리와 재생성 파이프라인을 분리하면 설치 크기와 실패 표면을 줄이고 Editable Pixel의 역할을 결정적 픽셀 마무리 도구로 유지할 수 있다.

## ADR-016 — clean source 검증은 잠긴 의존성을 온라인으로 설치한다

**Date**: 2026-09-01
**Status**: Accepted

### Context

격리된 source checkout 테스트가 `pnpm install --offline --frozen-lockfile`을 사용해 로컬 pnpm store에 tarball이 없으면 코드와 lockfile이 정상이어도 실패했다. 공개 사용자의 GitHub 설치와 CI는 네트워크가 있는 clean 환경을 전제로 한다.

### Options

| 옵션 | 설명 |
|---|---|
| A | 로컬 pnpm store의 모든 tarball을 별도로 채운 뒤 offline 설치 |
| B | `--offline`을 제거하고 frozen lockfile로 clean install |
| C | source checkout 검증 자체를 제거 |

### Decision

격리 checkout에서 `pnpm install --frozen-lockfile`을 실행한다. 배포 tarball 설치 검증은 별도 `test:distribution`에서 계속 수행한다.

### Rationale

frozen lockfile이 해상도 재결정을 막으면서 실제 clone 사용자의 설치 조건을 재현한다. 검증 결과가 개발자별 pnpm store 캐시 상태에 좌우되지 않고, source 설치와 npm 배포 설치의 책임도 분리된다.

## ADR-015 — Skill 설치와 MCP 호스트 등록을 하나의 설치 트랜잭션으로 제공한다

**Date**: 2026-08-25
**Status**: Accepted

### Context

Skill 파일만 복사하고 `codex mcp add`와 `claude mcp add`를 문서에만 안내하면 사용자는 설치가 끝났다고 생각해도 호스트가 실제 MCP 서버를 찾지 못한다. 실행 파일의 PATH도 설치 방식에 따라 달라질 수 있다.

### Options

| 옵션 | 설명 |
|---|---|
| A | Skill만 설치하고 MCP 등록은 수동 안내 |
| B | Skill 설치 시 `editable-pixel-mcp` 문자열만 등록 |
| C | Skill 설치 시 현재 패키지의 절대 Node·MCP 엔트리포인트를 두 호스트 사용자 설정에 등록 |

### Decision

`install-skill`은 선택한 호스트에 Skill을 복사한 뒤 `process.execPath`와 배포물의 절대 `mcp.js` 경로를 등록한다. 기존 동일 이름 설정은 기본적으로 보존하고, `--force`가 있을 때만 교체한다. 테스트용 `--target`은 실제 호스트 설정을 건드리지 않는다.

### Rationale

PATH와 패키지 매니저 shim에 의존하지 않고 설치 직후 실행 가능한 구성을 만든다. 설정 교체는 명시적 `--force`에만 허용해 기존 사용자 구성을 보호한다.

## ADR-014 — 문서 트랜잭션과 브라우저 워크플로를 하나의 MCP 표면에서 분리해 대칭 제공한다

**Date**: 2026-08-25
**Status**: Accepted

### Context

픽셀·팔레트·레이어·프레임·클립 편집은 공용 문서 모델에 있지만, 탭·뷰·재생·변환 설정·Project 열기·로컬 파일 Import·브라우저 Export는 React 상태와 브라우저 API에만 있다. 모든 버튼을 별도 MCP 도구로 만들면 도구 목록이 비대해지고, 문서 액션과 일시적 UI 상태가 섞인다.

### Options

| 옵션 | 설명 |
|---|---|
| A | 기존 문서 MCP만 유지하고 나머지는 브라우저 자동화 사용 |
| B | 웹 버튼마다 MCP 도구를 하나씩 추가 |
| C | 공용 문서 쓰기는 `use_editable_pixel`, 브라우저 상태는 `get_web_context`/`control_web`, 파일 경계는 `import_files`/`export_web`로 분리 |

### Decision

문서와 Project의 영속 편집은 기존 공용 History 트랜잭션을 유지한다. 브라우저 전용 상태와 워크플로는 세션 WebSocket의 요청/응답 명령 브리지로 실행한다. 파일 입력은 절대 경로·일반 파일·크기·형식을 검증해 브라우저에 전달하고, 내보내기는 웹과 같은 포맷·범위·배율 옵션을 사용한다.

### Rationale

Figma MCP처럼 구조/상세/행동을 분리하면서도 웹에서 가능한 사용자 시나리오를 빠짐없이 연결한다. 임의 DOM 클릭 대신 의미 단위 명령을 사용하므로 UI 배치가 바뀌어도 대화형 편집 계약은 유지된다.

## ADR-013 — AI 편집은 즉시 커밋하고 Undo를 기본 복구 수단으로 사용한다

**Date**: 2026-08-25
**Status**: Accepted

### Context

대화로 픽셀을 반복 수정할 때마다 별도 Preview와 승인 단계를 강제하면 흐름이 끊기고 사용자가 명시적으로 승인 UI는 필요 없다고 결정했다. 동시에 AI 수정도 사용자 수정과 같은 방식으로 되돌릴 수 있어야 한다.

### Options

| 옵션 | 설명 |
|---|---|
| A | 모든 AI 수정에 Preview → 사용자 승인 → Apply를 강제 |
| B | 즉시 커밋하고 공용 History와 Undo/Redo로 복구 |
| C | 설정으로 두 경로를 매번 선택 |

### Decision

`use_editable_pixel`은 검증 후 즉시 커밋한다. Preview와 Screenshot은 승인 게이트가 아니라 복잡한 결과의 QA에만 선택적으로 사용한다.

### Rationale

웹 직접 편집과 대화형 편집의 리듬이 같아지고 왕복 호출과 토큰을 줄인다. AI actor와 reason을 포함한 공용 History가 있으므로 잘못된 결과는 같은 Undo/Redo로 추적 가능하게 복구할 수 있다.

## ADR-012 — AI와 사용자는 하나의 Selection과 History를 공유한다

**Date**: 2026-08-25
**Status**: Accepted

### Context

AI 전용 선택이나 별도 히스토리를 만들면 브라우저에서 무엇이 선택·수정됐는지 보이지 않고 Undo 순서도 사용자 경험과 달라진다.

### Options

| 옵션 | 설명 |
|---|---|
| A | AI 전용 selection/history를 서버에 별도 보관 |
| B | `document.selection`과 session history를 사용자·AI가 공유 |
| C | AI 변경은 파일에 직접 쓰고 웹을 새로고침 |

### Decision

AI 선택은 기존 `document.selection`을 갱신해 WebSocket으로 방송한다. 사용자와 AI의 모든 의미 있는 작업은 actor metadata를 가진 동일한 session history에 기록한다.

### Rationale

기존 Selection Tool과 캔버스 overlay를 재사용하고, 사용자가 AI 작업을 화면에서 확인하며 자연스러운 시간 순서로 Undo/Redo할 수 있다.

## ADR-011 — Figma식 희소 탐색과 선택 중심 상세 Context를 분리한다

**Date**: 2026-08-25
**Status**: Accepted

### Context

픽셀 문서 전체 배열과 모든 프레임을 매 요청마다 전달하면 토큰 비용이 캔버스 면적과 프레임 수에 비례해 증가한다. AI는 먼저 구조를 파악하고 실제 수정 대상의 픽셀만 필요로 한다.

### Options

| 옵션 | 설명 |
|---|---|
| A | 모든 조회에서 전체 Project JSON 반환 |
| B | metadata, design context, screenshot과 도메인 context를 분리 |
| C | Screenshot만 사용 |

### Decision

`get_metadata`는 ID·이름·계층·revision만 반환한다. `get_design_context`는 현재 선택을 우선하고 bounds와 padding을 제한한다. Palette, Motion, History와 Screenshot은 독립 조회로 제공한다.

### Rationale

Figma MCP의 구조 탐색 후 상세 조회 패턴을 픽셀 데이터에 맞게 적용해 토큰을 줄이고, 좌표·팔레트 인덱스처럼 이미지 추론만으로 얻기 어려운 정보를 보존한다.

## ADR-010 — 쓰기는 엄격한 action union을 가진 단일 도구를 기본으로 한다

**Date**: 2026-08-25
**Status**: Accepted

### Context

UI 버튼마다 MCP 도구를 만들면 도구 목록과 선택 비용이 커지고 기능 추가 때마다 호스트 설정이 변한다. 반대로 임의 코드를 실행하는 범용 도구는 안전한 로컬 편집 경계를 잃는다.

### Options

| 옵션 | 설명 |
|---|---|
| A | UI 행동마다 개별 MCP 도구 등록 |
| B | 임의 스크립트를 실행하는 범용 도구 |
| C | 검증된 discriminated union을 받는 `use_editable_pixel` |

### Decision

문서 쓰기의 기본 진입점은 `use_editable_pixel`로 통합하되 action은 Pixel, Palette, Layer, Frame, Clip, Normal, Lighting, Project의 명시적 union으로 제한한다. Selection은 컨텍스트 가시성이 높도록 별도 도구로 둔다.

### Rationale

도구 선택 토큰과 인터페이스 중복을 줄이면서 스키마, revision, 선택 범위와 허용 연산을 서버가 검증할 수 있다.

## ADR-009 — Skill은 라우팅을, MCP는 실행을 담당한다

**Date**: 2026-08-25
**Status**: Accepted

### Context

Codex와 Claude가 Editable Pixel을 말로 수정하려면 설치 가능한 사용 지침과 실제 세션 데이터를 읽고 쓰는 실행 인터페이스가 모두 필요하다.

### Options

| 옵션 | 설명 |
|---|---|
| A | Skill 문서에 CLI 명령만 나열 |
| B | MCP 도구만 제공하고 사용 순서를 호스트에 맡김 |
| C | Skill이 컨텍스트·도구 선택을 안내하고 MCP가 트랜잭션을 실행 |

### Decision

Skill은 작업 종류별 라우팅, context budget, 검증 레시피를 제공한다. MCP는 canonical session에서 선택, 조회, 편집, History와 Export를 실행한다.

### Rationale

호스트별 대화 지침과 데이터 변경 권한을 분리해 재사용성과 안전성을 높이고, 브라우저 자동화 없이도 좌표 단위 편집을 수행할 수 있다.

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
