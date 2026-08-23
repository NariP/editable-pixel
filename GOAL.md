# Editable Pixel 작업 공간 UX 개편 Goal

## 1. 한 줄 목표와 컨셉

> AI 생성 이미지를 한 번 가져온 뒤 같은 원본을 반복 변환하고, Content Frame으로 안전 여백을 맞추며, Figma처럼 Canvas 중심의 Inspector와 플로팅 도구를 사용해 직접 또는 Codex/Claude와 안전하게 편집할 수 있는 완성된 로컬 작업 공간으로 개편한다.

컨셉은 **Canvas-first AI pixel workbench**다. 범용 픽셀 에디터의 복잡성을 복제하지 않고 `변환 → 비교 → 편집 → 에이전트 패치 검토 → 저장/내보내기` 흐름을 선명하게 만든다.

이 Goal은 다음 문서를 기준으로 한다.

- [제품 기능과 사용자 플로우](./.claude/docs/product-flow.md)
- [최종 구현 Goal](./.claude/docs/implementation-plan.md)

## 2. `/goal` 실행 문구

> `GOAL.md`의 체크리스트와 Definition of Done을 기준으로 Editable Pixel 작업 공간 UX 개편을 자율적으로 완료한다. 사용자에게 세부 결정을 질문하지 말고 가장 합리적인 추천안을 채택한다. 작업 중 생긴 결정은 `DECISIONS.md`에 Context / Options / Decision / Rationale을 갖춘 새 ADR로 추가한다. 각 항목 완료 시 체크리스트를 갱신한다. 기존 사용자 변경과 제품 불변식을 보존한다. 모든 DoD가 충족되면 즉시 종료하고 추가 작업을 시작하지 않는다. 외부 인증, 결제, 데이터 손실 가능 작업처럼 사용자만 승인할 수 있는 조건을 만나면 그 지점에서 멈추고 알린다.

## 3. 단계 로드맵

| 단계 | 핵심 변화 | 완료 기준 |
|---|---|---|
| Phase 1 — 상태와 기반 | Source/Variant 모델, 재변환, 새로고침 복구, shadcn/Tailwind/react-icons 기반 | 상태 전이와 저장 경계가 테스트로 고정됨 |
| Phase 2 — Canvas-first Shell | CONVERT/EDIT/AGENT Inspector, 큰 비교 뷰, 플로팅 도구 모음, 반응형 Sheet | 주요 기능을 Canvas를 가리지 않고 사용할 수 있음 |
| Phase 3 — 픽셀 작업 기능 | Content Frame, 투명 영역 선택, 새 팔레트 색, Canvas 탐색, 안전한 에이전트 패치 | 모든 편집이 Pixel Document와 패치 불변식을 지킴 |
| Phase 4 — 검증과 문서 | 접근성, E2E, 배포 패키지, Goal 문서 갱신 | 전체 검증 명령이 통과하고 DoD가 증명됨 |

## 4. 오늘의 실행 플랜

### 목표

기존 React/Vite/Canvas/Core 구현을 보존하면서 제품 플로우에 맞는 상태 모델과 UI Shell을 교체하고, 합의된 모든 상호작용을 실제로 동작하게 만든다.

### 아키텍처

```text
SourceAsset(File/Blob)
        │
        ├── draftSettings ──→ Reconvert ──→ Variant(appliedSettings)
        │                                      │
        │                                      ↓
        │                               Pixel Document
        │                                      ↕
        │              ┌───────────────────────┼──────────────────────┐
        │              │                       │                      │
        ↓              ↓                       ↓                      ↓
 Session Store   CONVERT Inspector       EDIT Inspector        AGENT Inspector
        │                                      │                      │
        └──────────────→ Canvas + Floating Tools ←────────────────────┘
                                               │
                                               ↓
                                  .pixel.json / PNG / sprite sheet
```

### 데이터 모델과 인터페이스

```text
SourceAsset
├── id, name, mimeType, source Blob URL
├── original File/Blob
└── variants: Variant[]

Variant
├── id, name
├── appliedSettings
├── contentFrame
├── PixelDocument + revision
└── hasEditsSinceConversion

WorkspaceSession
├── workspaceSessionId
├── activeSourceId / activeVariantId
├── draftSettings
└── activeInspectorTab
```

주요 의존성은 React 19, TypeScript, Vite, Canvas 2D를 유지하고 Tailwind CSS, shadcn/ui, `react-icons`의 Tabler 계열을 추가한다.

### 체크리스트

- [x] React/Vite 모노레포에 Tailwind CSS와 shadcn/ui 기반을 추가하고 기존 시각 토큰을 이식한다.
- [x] `react-icons` 한 패밀리로 Pen, Eraser, Line, Fill, Select와 보조 UI 아이콘을 구성한다.
- [x] `ImportedAsset`을 `SourceAsset`과 `Variant` 상태 모델로 분리한다.
- [x] `draftSettings`와 `appliedSettings`를 분리하고 APPLIED/CHANGED 상태를 구현한다.
- [x] 저장된 원본으로 재업로드 없는 재변환을 구현한다.
- [x] 편집 없는 재변환은 현재 Variant 갱신, 편집 이후 재변환은 새 Variant 기본 생성을 구현한다.
- [x] 같은 탭 새로고침 복구와 새 작업 세션 초기화 정책을 구현한다.
- [x] 기존 Conversion Rack과 Tool Rail을 Canvas-first Shell과 CONVERT/EDIT/AGENT Inspector로 교체한다.
- [x] Canvas 하단 중앙 플로팅 도구 모음과 Tooltip, 단축키, accessible name을 구현한다.
- [x] 별도 Pan 도구 없이 Space/가운데 버튼/트랙패드 이동과 포인터 중심 Zoom을 구현한다.
- [x] TIGHT/SAFE/CUSTOM Content Frame과 화면 가이드, Converter metadata 연결을 구현한다.
- [x] 투명 영역 좌표 선택과 팔레트에 없는 새 색상 추가를 구현한다.
- [x] 새 palette index 추가를 포함한 에이전트 패치도 선택 영역 밖 변경 0을 보장한다.
- [x] Codex 내부 브라우저 폭에서 Inspector Sheet와 Canvas 중심 레이아웃을 검증한다.
- [x] 단위·통합·E2E·배포 검증을 통과하고 체크리스트와 ADR을 최종 갱신한다.

### Definition of Done

1. 사용자가 이미 가져온 원본으로 설정을 바꿔 재업로드 없이 재변환할 수 있고, APPLIED/CHANGED와 Variant 보호 정책이 실제 동작한다.
2. 같은 탭 새로고침 후 원본·설정·Variant·편집 상태가 복구되며, 새 에디터 작업은 빈 상태로 시작한다.
3. Canvas 중심 Shell, CONVERT/EDIT/AGENT Inspector, 아이콘 플로팅 바, Figma식 Canvas 탐색이 데스크톱과 Codex 내부 브라우저에서 동작한다.
4. Content Frame 투명 Padding, 투명 영역 선택, 새 palette index 추가가 Pixel Document와 내보내기 결과에 일관되게 반영된다.
5. 에이전트 패치의 변경 전후, revision, 선택 영역, 영역 밖 변경 0이 검증되고 적용·거부·undo/redo가 유지된다.
6. `pnpm verify`, `pnpm test:e2e`, `pnpm test:distribution`이 모두 통과하고 관련 제품 문서가 최종 동작과 일치한다.

## 5. 의사결정 요약

자세한 근거는 [DECISIONS.md](./DECISIONS.md)에 기록한다.

- React/Vite/Canvas 기반은 유지하고 UI 계층만 shadcn/Tailwind로 개편한다.
- 아이콘은 다운로드 파일 대신 `react-icons`의 단일 패밀리를 사용한다.
- Canvas는 항상 유지하고 우측 Inspector만 CONVERT/EDIT/AGENT로 전환한다.
- Pan은 도구가 아니라 일시적인 Canvas 탐색 입력으로 제공한다.
- 편집 이후 재변환은 새 Variant를 기본으로 해 사용자 작업을 보호한다.

## 6. 완료 증거

완료일: 2026-08-21

- `pnpm verify`: build, lint, typecheck와 73개 단위·통합 테스트 통과
- `pnpm test:e2e`: Chromium 5개 시나리오 통과
- `pnpm test:distribution`: clean package install, update, execution, checksum, removal 통과
- E2E에서 원본 보관, 같은 탭 새로고침 복구, APPLIED/CHANGED, clean Variant 갱신, edited Variant의 새 Variant 생성과 명시적 교체 경고를 검증
- E2E에서 투명 좌표 선택, 새 palette index를 포함한 bounded agent patch, 선택 영역 밖 변경 0, Codex 659px 폭 Inspector Sheet를 검증

이 문서의 엔지니어링 Goal은 완료됐다. 저장소 공개 전환, npm publish, GitHub Release는 사용자가 개발 완료 후 별도로 승인하기로 한 외부 릴리스 단계이므로 실행하지 않았다.
