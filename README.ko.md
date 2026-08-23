# Editable Pixel

[English](./README.md)

Editable Pixel은 AI가 생성한 픽셀풍 이미지를 결정적이고 편집 가능한 실제 픽셀 에셋으로 변환합니다. 래스터 변환기, 목적이 분명한 Canvas 에디터, 로컬 세션 서버, CLI, MCP 서버를 함께 제공하여 이미지 일부를 선택하고 Codex 또는 Claude와 그 영역만 수정할 수 있습니다.

> 배포 상태: 소스 구현과 설치 가능한 패키지는 이 저장소에 있습니다. 공개 npm 패키지와 GitHub Release는 아직 발행하지 않았습니다.

## 왜 만들었나요?

AI 이미지 생성 결과는 픽셀아트처럼 보여도 실제로는 일반 래스터 이미지인 경우가 많습니다. 논리 픽셀 크기가 일정하지 않고 경계에는 안티앨리어싱이 남으며, 에셋마다 팔레트가 달라집니다. 작은 부분만 다시 생성해도 관계없는 픽셀까지 바뀔 수 있습니다.

Editable Pixel은 이런 결과를 실제 그리드, 팔레트, 레이어, 프레임, 콘텐츠 bounds, pivot을 가진 버전형 `.pixel.json` 문서로 변환합니다. AI로 만든 게임 캐릭터, 아이템, 아이콘, 타일, 스프라이트를 정제하기 위한 도구이며 Aseprite 같은 범용 에디터를 대체하지 않습니다.

## 할 수 있는 일

- PNG, WebP, JPEG를 16–128 px 또는 사용자 지정 논리 캔버스로 변환
- 원본 알파 사용, 단색 배경 제거, 로컬 배경 제거 어댑터 연결
- 단일 이미지 또는 여러 이미지를 공통 캔버스, content box, 정렬, pivot, 팔레트로 정규화
- 자동·고정 팔레트와 선택적 Floyd–Steinberg 디더링 적용
- 브라우저 에디터에서 원본과 변환 결과 비교
- 현재 탭에 원본을 보관하고 정규화 설정을 바꿔 재업로드 없이 재변환
- 편집 결과를 Variant로 보호하고, 새로고침 시 현재 탭을 복구하며, Tight/Safe/Custom Content Frame으로 투명 여백 통일
- 그리기, 지우기, 채우기, 색상 교체와 선택 영역·팔레트·레이어·프레임 편집
- 브라우저에서 선택한 사각형을 Codex 또는 Claude와 그대로 공유
- 선택 영역 밖 픽셀을 유지하며 에이전트 패치를 미리보기·적용·거부·실행 취소·다시 실행
- 읽기 쉬운/압축 Pixel Document JSON, 논리 PNG, 확대 미리보기, 레이어·프레임 PNG, 스프라이트 시트 내보내기

## 동작 구조

```text
PNG / WebP / JPEG
        ↓
Converter → sprite.pixel.json ← Core operations
                         ↕
Codex / Claude ↔ CLI / MCP ↔ 로컬 세션 서버 ↔ 웹 에디터
                         ↓
          PNG / preview / layers / frames / sprite sheet
```

`.pixel.json`이 편집 원본이자 단일 진실 공급원입니다. Canvas는 문서를 표시하고 편집하며 PNG는 문서에서 파생되는 결과물입니다. 이미지 처리는 모두 로컬에서 실행되고 세션 서버는 기본적으로 `127.0.0.1`에만 바인딩합니다.

## 설치

릴리스 워크플로우는 CLI, 변환기, 렌더러, 로컬 서버, 빌드된 웹 에디터, MCP 실행 파일을 담은 npm 패키지 하나를 발행합니다.

```bash
npm install --global editable-pixel
```

공개 릴리스 전에는 이 저장소에서 빌드할 수 있습니다.

```bash
corepack enable
pnpm install
pnpm build
node packages/pixel-cli/dist/cli.js --help
```

Node.js 20.9 이상이 필요합니다.

## 빠른 시작

AI 생성 이미지를 변환합니다.

```bash
editable-pixel convert hero.png \
  --size 32 \
  --colors 16 \
  --alignment bottom-center \
  --output hero.pixel.json
```

직사각형 사용자 지정 캔버스와 고정 팔레트는 `--width`, `--height`, `--palette`로 지정할 수 있습니다.

로컬 에디터에서 문서를 엽니다.

```bash
editable-pixel open hero.pixel.json
```

에디터에서 하단 플로팅 도구 모음의 Select 아이콘(`S`)을 선택하고 사각형을 드래그합니다. 좌표는 즉시 동기화되지만, 선택 자체만으로 수정이 실행되지는 않습니다. Canvas는 계속 보이고 우측 Inspector만 `CONVERT`, `EDIT`, `AGENT`로 전환되며, Codex처럼 폭이 좁은 화면에서는 Inspector가 Sheet로 열립니다.

검증하고 내보냅니다.

```bash
editable-pixel validate hero.pixel.json
editable-pixel render hero.pixel.json --scale 8 --output hero@8x.png
editable-pixel export hero.pixel.json --output hero-export
```

에이전트나 스크립트가 안정적인 기계 출력을 사용하려면 명령에 `--json`을 추가합니다.

## Codex와 Claude 연결

npm 패키지를 설치한 뒤 로컬 MCP 서버를 등록합니다.

```bash
# Codex
codex mcp add editable-pixel -- editable-pixel-mcp

# Claude Code 프로젝트 범위
claude mcp add --scope project editable-pixel -- editable-pixel-mcp
```

Codex에서는 `editable-pixel open hero.pixel.json --host codex --json`을 사용합니다. 명령이 일회용 loopback URL을 반환하면 Codex가 그 주소를 내부 브라우저에 엽니다. Claude Code에서는 `--host claude`가 같은 로컬 에디터를 시스템 브라우저에 엽니다. 두 호스트 모두 로컬 세션을 통해 동일한 선택 영역과 문서 revision을 읽습니다.

안전한 대화형 수정 순서는 다음과 같습니다.

1. 활성 세션과 브라우저 선택 영역을 읽습니다.
2. 선택 영역과 현재 revision에 제한된 패치를 만듭니다.
3. 변경 전후 미리보기를 에디터에 보냅니다.
4. 사용자가 변경을 요청한 뒤 적용하거나 거부합니다.
5. 문서를 다시 검증하고 브라우저 갱신을 확인합니다.

[`skills/editable-pixel`](./skills/editable-pixel)의 선택적 호스트 스킬은 코딩 에이전트를 위한 이 절차를 설명합니다. 도구와 호스트별 차이는 [MCP 연결 문서](./docs/mcp.md)를 확인하세요.

## 패키지 구성

| 패키지 | 책임 |
| --- | --- |
| `pixel-document` | 버전형 스키마, 파서, 검증, 마이그레이션, 직렬화 |
| `pixel-core` | 결정적 편집, 범위 제한 패치, revision 검증, undo/redo |
| `pixel-converter` | 래스터 디코딩, footprint 정규화, 팔레트 양자화 |
| `pixel-renderer` | Canvas 버퍼, 결정적 PNG, 레이어, 프레임, 스프라이트 시트 |
| `pixel-server` | loopback HTTP/WebSocket 세션, 토큰, 파일 안전성, 충돌 감지 |
| `pixel-cli` | 사람·기계용 명령 인터페이스와 배포 npm 패키지 |
| `pixel-mcp` | Codex와 Claude용 구조화 로컬 도구 |
| `apps/web` | 변환, 비교, 편집, 선택, 패치 검토, 내보내기 |

`packages` 디렉터리는 내부 소스 워크스페이스입니다. 사용자는 `editable-pixel` 패키지 하나만 설치하며 내부 패키지를 각각 설치할 필요가 없습니다.

## 문서

- [시작하기](./docs/getting-started.md)
- [Pixel Document v1](./docs/pixel-document.md)
- [CLI 레퍼런스](./docs/cli.md)
- [MCP와 호스트 연결](./docs/mcp.md)
- [보안 모델](./docs/security.md)
- [릴리스 절차](./docs/releases.md)
- [검증 기록](./docs/validation.md)
- [기여 가이드](./CONTRIBUTING.md)

## 개발

```bash
pnpm install
pnpm verify
pnpm test:e2e
```

`pnpm verify`는 전체 패키지를 빌드하고 lint, typecheck, 단위·통합 테스트를 실행합니다. 브라우저 E2E와 깨끗한 환경 설치 테스트는 필요한 런타임 의존성을 분명히 하기 위해 별도 명령으로 실행합니다.

## 라이선스

[MIT](./LICENSE)
