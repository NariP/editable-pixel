# Editable Pixel AI collaboration Goal

## 1. 한 줄 목표와 컨셉

> Editable Pixel의 웹 편집 상태를 Codex·Claude가 Figma MCP처럼 적은 토큰으로 읽고, 기존 Selection·History·Undo/Redo를 그대로 사용해 픽셀·팔레트·레이어·프레임·클립·노멀·조명을 말로 즉시 수정할 수 있게 한다.

컨셉은 **browser-visible, document-native AI editing**이다. 스킬은 작업 순서와 컨텍스트 사용량을 안내하고, MCP는 웹과 동일한 Project/Pixel Document 트랜잭션을 실행한다. AI 전용 임시 상태나 별도 히스토리를 만들지 않는다.

기존 제품 모델과 완성 범위는 [.claude/docs/GOAL.md](./.claude/docs/GOAL.md), [.claude/docs/project-model.md](./.claude/docs/project-model.md)를 유지한다.

## 2. `/goal` 실행 문구

> `/goal GOAL.md를 기준으로 Editable Pixel의 Codex·Claude 스킬과 MCP 연동을 최종 상태까지 구현해줘. 사용자에게 세부 결정을 질문하지 말고 가장 합리적인 추천안을 채택한다. 새로운 결정은 DECISIONS.md에 Context / Options / Decision / Rationale 형식의 ADR로 추가한다. 각 항목이 끝날 때 GOAL.md 체크리스트를 갱신한다. 모든 Definition of Done이 충족되면 즉시 종료하며 합의되지 않은 추가 기능은 시작하지 않는다. 외부 인증, 공개 배포 또는 데이터 손실 가능 작업처럼 사용자만 승인할 수 있는 조건에서만 멈추고 알린다.`

## 3. 단계 로드맵

| 단계 | 목표 | 완료 기준 |
|---|---|---|
| Phase 1 — 공용 계약 | AI actor, Selection, History, Context, Action 계약을 서버의 공용 모델로 정의 | 웹과 MCP가 같은 상태와 revision을 읽고 쓴다 |
| Phase 2 — Figma식 Context | `get_metadata`, `get_design_context`, `get_screenshot`, Palette/Motion/History context 구현 | 기본 조회는 희소하고 상세 픽셀은 선택·필요 범위로 제한된다 |
| Phase 3 — 즉시 편집 | `set_selection`과 `use_editable_pixel`로 문서·모션 편집을 즉시 커밋 | AI 선택과 수정이 웹에 보이고 같은 Undo/Redo로 복구된다 |
| Phase 4 — 설치와 배포 | npm 패키지에 스킬을 포함하고 Codex·Claude 설정을 자동화 | clean install 뒤 CLI, MCP, 스킬을 바로 사용할 수 있다 |
| Phase 5 — 검증 | 단위·통합·배포·실제 브라우저 검증 및 문서 동기화 | 아래 Definition of Done이 자동·수동 증거로 모두 닫힌다 |
| Phase 6 — 웹 기능 대칭과 호스트 등록 | 브라우저 전용 상태·프로젝트·파일·내보내기 워크플로를 MCP에 연결하고 Codex·Claude에 실제 등록 | AI가 웹과 같은 결과를 만들며 두 호스트의 등록 목록과 실제 MCP 호출로 확인된다 |

## 4. 오늘의 실행 플랜

### 한 줄 목표

기존 Project/Pixel Document 구현을 보존하면서 AI를 웹 사용자와 동등한 편집 주체로 연결한다.

### 아키텍처

```text
Codex / Claude
      │
      ├── Skill: route + context budget + task recipes
      │
      └── Editable Pixel MCP
            ├── list_sessions
            ├── get_metadata ───────────────┐
            ├── get_design_context          │ read
            ├── get_screenshot              │
            ├── palette / motion / history ─┘
            ├── set_selection ──────────────┐
            └── use_editable_pixel ─────────┤ write
                                            ▼
                              Local Session Server
                              ├── canonical Selection
                              ├── actor-aware History
                              ├── revision + validation
                              └── autosave / WebSocket broadcast
                                            │
                           ┌────────────────┴────────────────┐
                           ▼                                 ▼
                    React Canvas UI                  Project / Pixel files
```

### 데이터 모델·인터페이스·의존성

```ts
type EditActor = "user" | "ai" | "system"

type HistoryEntry = {
  id: string
  actor: EditActor
  client?: string
  reason: string
  createdAt: string
  revisionBefore: number
  revisionAfter: number
  state: "applied" | "undone"
}

type DesignContext = {
  project: ProjectIdentity | null
  target: { clipId?: string; frameId: string; layerId: string }
  selection?: Selection
  bounds: Rect
  palette: PaletteColorContext[]
  colorIndices: number[][]
  normalValues?: number[][]
}

type EditablePixelAction =
  | PixelAction | SelectionAction | PaletteAction
  | LayerAction | FrameAction | ClipAction
  | NormalAction | LightingAction | ProjectAction
```

기존 React, Pixel Document, Pixel Core, Project, Session Server, WebSocket와 MCP SDK를 유지한다. 새 편집 연산은 UI 컴포넌트가 아니라 공용 core/server 계층에 둔다.

### 체크리스트

- [x] 공용 AI actor와 조회 가능한 통합 History 모델을 구현한다.
- [x] AI 선택이 기존 `document.selection`을 사용하고 웹 Selection Tool에 즉시 표시되게 한다.
- [x] `get_metadata`를 Project/Clip/Frame/Layer의 희소 탐색 인터페이스로 구현한다.
- [x] `get_design_context`를 선택 우선·padding 제한·픽셀 수 제한 방식으로 구현한다.
- [x] `get_screenshot`, `get_palette_context`, `get_motion_context`, `get_history`를 구현한다.
- [x] `set_selection`에 사각형, 좌표 mask, 색상, 연결 영역, 외곽선, content bounds 선택을 구현한다.
- [x] `use_editable_pixel`에 픽셀·팔레트·레이어·프레임·클립·노멀·조명·Project 작업을 구현한다.
- [x] AI 편집을 별도 승인 없이 즉시 적용하고 WebSocket, revision, autosave, Undo/Redo와 연결한다.
- [x] 기존 preview/apply 도구는 호환 경로로 남기되 스킬의 기본 흐름에서는 제거한다.
- [x] Import/Convert/Export는 MCP와 CLI의 책임을 구분해 스킬 레시피로 연결한다.
- [x] npm 배포물에 스킬과 Codex·Claude MCP 설치 안내/자동화를 포함한다.
- [x] MCP·서버·core·배포 테스트와 실제 브라우저 연동 시나리오를 통과한다.
- [x] 영문·한글 README, MCP, 설치, 보안 문서를 실제 동작과 일치시킨다.
- [x] `get_web_context`로 탭, 도구, 활성 Project/Clip/Frame/Layer/Source, 변환, 재생, Onion Skin, 뷰 상태를 희소하게 읽는다.
- [x] `control_web`로 브라우저 전용 뷰·활성 대상·변환·프리셋·Project·Source·재생 상태를 동일한 의미 단위로 조작한다.
- [x] `import_files`로 이미지, Pixel JSON, Pixel Project, 프레임 시퀀스, Sprite Sheet, retained Source 워크플로를 안전한 로컬 파일 경계 안에서 실행한다.
- [x] `export_web`으로 웹의 Project/Pixel JSON, Color/Normal/Lit PNG, Clip/Project Sprite Sheet와 GIF 내보내기를 같은 옵션으로 실행한다.
- [x] Project/Clip AI 작업을 브라우저 Project 상태와 동기화하고, 문서 편집과 동일한 autosave·History·Undo/Redo 계약을 유지한다.
- [x] `install-skill`이 Skill 복사에 더해 절대 MCP 엔트리포인트를 Codex와 Claude 사용자 설정에 등록한다.
- [x] Codex·Claude 등록 목록, 새 MCP 도구 목록, 브라우저 왕복 명령, 파일 Import/Export와 기존 전체 테스트를 검증한다.

### Definition of Done

1. AI가 좌표·색상·content bounds로 선택하면 기존 Selection UI와 상태 표시가 사용자 선택과 동일하게 보인다.
2. AI의 픽셀·구조·노멀·조명 편집이 즉시 한 트랜잭션으로 적용되고 actor=`ai`로 History에 남으며 웹의 Undo/Redo로 복구된다.
3. 기본 컨텍스트 조회는 전체 픽셀 배열을 반환하지 않고, 상세 조회는 선택 또는 필요한 bounds와 padding만 반환한다.
4. Palette, Layer, Frame, Clip, Normal, Lighting 작업이 revision·스키마·대상 불변식을 지키며 브라우저에 실시간 반영된다.
5. clean npm 설치 후 Codex와 Claude가 포함된 스킬 및 MCP 실행 명령을 사용해 같은 흐름을 재현할 수 있다.
6. `pnpm verify`, MCP/서버 통합 테스트, 배포 테스트와 실제 로컬 브라우저 검증이 통과하고 문서가 일치한다.
7. AI가 `get_web_context`와 `control_web`으로 브라우저의 일시적 UI 상태까지 읽고 바꾸며, 결과가 현재 열린 웹에 즉시 보인다.
8. AI가 로컬 파일 경로로 웹과 같은 Import/Source/Frame/Sprite Sheet 워크플로를 실행하고 웹과 같은 Export 포맷·범위를 선택할 수 있다.
9. Project/Clip 변경이 서버 문서에만 남지 않고 브라우저 Project 모델, autosave와 표시 상태에 동기화된다.
10. `editable-pixel install-skill --host both` 실행 후 `codex mcp list`와 `claude mcp list`에 `editable-pixel`이 나타나며 실제 도구 호출이 성공한다.

## 5. 의사결정 요약

자세한 근거는 [DECISIONS.md](./DECISIONS.md)에 기록한다.

- Skill은 라우팅과 컨텍스트 예산, MCP는 실제 데이터 읽기·쓰기를 담당한다.
- Figma MCP처럼 희소 metadata와 선택 중심 상세 context를 분리한다.
- 쓰기 도구는 엄격한 action union을 받는 `use_editable_pixel` 한 진입점을 기본으로 한다.
- AI 선택·수정은 웹과 같은 Selection, History, revision을 사용한다.
- 미리보기 승인은 필수가 아니며 즉시 적용 후 Undo를 기본 복구 수단으로 사용한다.

## 6. 현재 활성 GOAL — 최종 출시 전 준비 1~4

### 범위

공개 기능 추가를 멈추고 로컬 실행 제품의 출시 준비를 다음 네 단계까지만 완료한다. npm 인증·발행, GitHub Public 전환, 버전 태그와 GitHub Release 생성은 다음 단계로 남긴다.

### 체크리스트

- [x] 브라우저 E2E의 비동기 revision 경쟁 조건과 최근 Project 삭제 시나리오를 안정화한다.
- [x] clean source checkout 설치·빌드·로컬 서버 검증이 pnpm 캐시 상태와 무관하게 통과한다.
- [x] `install.sh`가 설치·업데이트·삭제를 지원하고 배포 tarball을 이용한 격리 테스트를 통과한다.
- [x] 설치된 `editable-pixel open`만으로 source-less 로컬 편집기를 실행할 수 있다.
- [x] 영문·한글 README를 로컬 실행 컨셉, 설치, Quick Start, Codex·Claude 연결, 업데이트·삭제 중심으로 동기화한다.
- [x] 현재 작업 트리 전체를 검토하고 릴리스 범위에 맞는 변경만 커밋한다.
- [x] 전체 검증 통과 후 private `NariP/editable-pixel` 원격 `main`에 push한다.

### Definition of Done

1. `pnpm verify`, `pnpm test:e2e`, `pnpm test:distribution`, `pnpm test:source-install`이 모두 통과한다.
2. 임시 npm prefix에서 `install.sh`로 설치·재설치·실행·MCP/Skill 확인·삭제가 재현된다.
3. README.md와 README.ko.md가 동일한 공개 설치 흐름을 안내하며 웹 호스팅이 아니라 loopback 로컬 실행임을 명확히 한다.
4. 변경사항이 검토된 단일 릴리스 준비 커밋으로 private 원격에 push되고 로컬 `main`과 `origin/main`이 일치한다.
5. npm 발행, 저장소 Public 전환, 태그 생성은 수행하지 않는다.
