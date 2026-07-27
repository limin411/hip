# hip

[English](./README.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md) | **한국어**

**hip**은 데스크톱 AI 워크벤치입니다(Claude Code Desktop / Codex Desktop의 정신을 계승): Tauri 셸, React UI, 그리고 프로젝트에서 [LangGraph](https://langchain-ai.github.io/langgraphjs/) 에이전트를 실행하는 Node.js 사이드카로 구성됩니다.

> **참고:** hip은 독립 프로젝트이며 Anthropic, OpenAI, xAI 등 타사 제품과 **제휴·공식 관계가 없습니다**. 문서에 나오는 이름은 상호운용 설명용입니다.

## 다운로드

사전 빌드 설치 파일(게시 시)은 **[GitHub Releases](https://github.com/limin411/hip/releases)** 를 확인하세요.  
아직 없다면 아래 개발 절차로 소스에서 빌드하세요.

각 UI 탭은 독립적인 세션입니다. 제품 기본값은 **Supervisor ReAct** 루프입니다 — 에이전트가 도구를 사용하고 `task` / `dispatch_agent` / `task_batch`를 통해 위임 시기를 결정합니다. 일반적인 턴은 Planner → Coder → Reviewer 파이프라인을 **강제하지 않습니다**.

## 주요 기능

| 영역 | 설명 |
|------|----------------|
| **표면** | **Code** — 전체 프로젝트 워크벤치(파일, git 안내, MCP, 도구). **Chat** — 가벼운 대화; 아티팩트 패널을 위해 작성 가능한 결과물을 워크스페이스에 미리보기로 저장합니다. |
| **권한** | **edit** (기본값, 프로젝트 샌드박스), **chat** (읽기 전용), **full** (사용자가 허용한 전체 파일 시스템). |
| **에이전트** | Supervisor 및 로스터 에이전트(**explore** / **plan** / **coder**); 에이전트 주도 격리 및 `task_batch`를 통한 진정한 병렬 작업. |
| **확장성** | 스킬(`SKILL.md`), 플러그인, MCP 서버, 훅 — 전역 `~/.hip/` 및 프로젝트 `.hip/` 아래. |
| **메모리** | 세션 간 메모리는 **기본적으로 비활성화**; **설정 → 메모리**에서 활성화. |
| **CLI** | **실행 중인** 데스크톱 앱에 연결 전용 `@hip/cli` (`doctor`, `session`, `run`, `repl`). |
| **로컬 우선** | 설정, SQLite DB, 스킬, 플러그인, 로그는 `~/.hip/` 아래에 저장됩니다. |

## 아키텍처

런타임 시 세 가지 프로세스가 통신합니다:

| 프로세스 | 런타임 | 역할 |
|---------|---------|------|
| **Tauri 셸** | Rust (`src-tauri/`) | 창 관리, 사이드카 생명주기, `get_sidecar_port` 명령 |
| **프론트엔드** | React + Vite (`src/`) | 탭, 채팅, 에이전트 실행 트리 |
| **사이드카** | Node.js (`packages/sidecar/`) | LangGraph 에이전트 런타임, WebSocket 서버 |

Tauri 셸은 시작 시 사이드카를 생성합니다(`tauri-plugin-shell`의 사이드카 메커니즘 사용). 사이드카는 사용 가능한 포트에 WebSocket 서버를 바인딩하고 `{"port":NNNN}`을 stdout으로 출력합니다; Rust가 이를 캡처하여 `get_sidecar_port` 명령을 통해 노출합니다. 그러면 프론트엔드가 `ws://localhost:NNNN`에 연결합니다.

### 위임 진입점 (에이전트 런타임)

제품 턴은 세 가지 경로 중 하나로 진입합니다. **명시적인** 워크플로우 정의만이 기본 ReAct 루프를 전환합니다; 세션 `orchMode`는 라우팅에 무시됩니다(UI 토글 제거됨; API는 여전히 사용 중단됨).

| 진입점 | 시기 | 동작 |
|-------|------|----------|
| **기본 ReAct + task/dispatch** | 일반 `message:send` (보류 중인 워크플로우 없음) | Supervisor ReAct 그래프(`buildGraph`). `task` / `dispatch_agent`를 통한 에이전트 주도 격리; 하나의 `task_batch`를 통한 **진정한 병렬** 다중 파트 리서치(작업당 선택적 `agent`, 기본 동시성 4). 순차적 `dispatch_agent`보다 `task_batch`를 선호합니다. |
| **명시적 DAG** | `pendingWorkflowDef` 설정됨, 또는 `workflow:run` | 오케스트레이터 / 워크플로우 실행기 DAG. 모드 플래그에 의해 강제되지 않음. 내장 클러스터 템플릿(예: planner→coder)은 내부/테스트 도우미 전용입니다. |
| **다중 에이전트 핸드오프** | 선택적 / 기본이 아닌 호출자 | `multi-agent-graph` 핸드오프(`handoff_to_*`) 구성. 실험적 표면; 제품 기본 세션 경로가 아닙니다. |

이는 **yarn workspaces** 모노레포입니다:

```
packages/protocol/   @hip/protocol — 공유 WebSocket 메시지 타입
packages/sidecar/    @hip/sidecar  — LangGraph WS 서버
packages/cli/        @hip/cli      — 연결 전용 제품 CLI
packages/product-content/  에이전트 임베드 + 설정 도움말 로케일
src/                 React 프론트엔드
src-tauri/           Rust 셸
```

## 개발 환경 설정

> API 키(예: DeepSeek)는 앱의 **설정** 패널에 입력되며 `~/.hip/config/auth.json`(파일 모드 `0600`)에 저장됩니다 — 이는 단일 진실 공급원입니다.
> 데스크톱 앱, 독립 실행형 사이드카(`scripts/dev.sh start sidecar`), 테스트 스위트 모두 여기서 키를 읽습니다. **`~/.hip/config/`는 평문 API 키를 보관합니다; 클라우드 드라이브나 도트파일 저장소에 동기화하지 마십시오.**

### 사전 요구 사항

- Node.js + [Yarn](https://yarnpkg.com/) (워크스페이스)
- Rust 툴체인 (Tauri용)
- [Tauri v2](https://v2.tauri.app/start/prerequisites/)용 플랫폼 종속성

### 빠른 시작

```bash
# 1. 워크스페이스 종속성 설치
yarn install

# 2. 개발 모드 사이드카 래퍼 생성 (한 번 실행, 그리고 툴체인 변경 후).
#    src-tauri/binaries/는 gitignore된 빌드 아티팩트 디렉토리이므로,
#    Rust 빌드가 사이드카를 해결할 수 있도록 이 단계가 필요합니다.
yarn sidecar:dev-bin

# 3. 앱 실행 (Vite, 사이드카, Tauri 창 실행)
yarn tauri dev
```

그런 다음 **설정**을 열고 제공자 API 키를 추가한 후 **Code** 또는 **Chat** 표면에서 세션을 시작하세요.


### ACP 호스트 정책 (선택 사항)

세션이 외부 ACP 에이전트(OpenCode, Claude Code, Grok Build 등)를 사용할 때, hip은 ACP **클라이언트** 역할을 합니다. 호스트 측 정책은 `hip.toml`의 `[acp]` 아래에 있습니다:

```toml
[acp]
fsBridge = true          # fs/read_text_file 및 fs/write_text_file 광고 + 제공 (기본값 true)
forwardMcp = false       # 활성화된 hip/플러그인 MCP 서버를 session/new로 전달 (기본값 false)
fsReadMaxBytes = 2000000 # fs/read_text_file당 최대 바이트 (기본값 2_000_000)
```

Snake_case 별칭(`fs_bridge`, `forward_mcp`, `fs_read_max_bytes`)도 허용됩니다.
프로젝트 `.hip/hip.toml`은 전역 `[acp]` 섹션을 **완전히 대체**합니다(`[agentLoop]`와 동일한 규칙).

**MCP 전달 보안 참고:** `forwardMcp`는 기본적으로 **false**이므로 hip이 MCP 명령, 환경 변수 또는 HTTP 헤더(API 키 포함)를 외부 에이전트 프로세스에 조용히 전달하지 않습니다. `true`로 설정하면 hip.toml `mcpServers`의 활성화된 서버 **및** 활성화된 플러그인이 ACP `session/new` / `session/load`에 매핑됩니다(`stdio`는 항상; `http`/`sse`는 에이전트가 해당 MCP 기능을 광고한 경우에만). Hip 도구 허용/거부 목록(`enabledTools` / `disabledTools`)은 **전달되지 않습니다** — 에이전트는 전체 MCP 표면을 봅니다.

### 로컬 데이터 레이아웃 (`~/.hip/`)

| 경로 | 용도 |
|------|---------|
| `~/.hip/config/` | `auth.json`, `hip.toml`, 네트워크 정책 (해당되는 경우 모드 `0600`) |
| `~/.hip/db/hip.db` | SQLite 세션, 메시지, 에이전트 실행, 도구, 이벤트 |
| `~/.hip/data/tool-output/` | 대용량 도구 출력 (DB 외부에 보관) |
| `~/.hip/logs/` | 사이드카 / Tauri 로그 |
| `~/.hip/skills/`, `plugins/`, `scratch/` | 스킬, 플러그인, 설치 스크래치 |
| `~/.hip/memories/` | 메모리 활성화 시 마크다운 내보내기 미러 |
| `~/.hip/trash/` | 제품 휴지통 격리 (지식 FS 페이로드; 세션은 SQLite `deleted_at` 사용) |

### 휴지통 (소프트 삭제)

**데스크톱 UI**에서 채팅/코드 세션 또는 지식 공간/문서를 삭제하면 **휴지통**(사이드바, 기록 위)으로 이동합니다. 항목을 복원하거나 영구 삭제할 수 있습니다; 보존 기간 후 자동으로 제거됩니다.

| 설정 | 위치 |
|---------|----------|
| 보존 일수 (기본값 **7**, 범위 1–365) | **설정 → 일반**, 또는 `~/.hip/config/hip.toml` → `[trash] retentionDays = 7` |

- **UI 삭제** → 소프트 삭제 (복구 가능).
- **CLI** `hip session delete <id> --yes` → **영구** 하드 삭제 (휴지통 사용 안 함).
- **메모리** 휴지통은 **설정 → 메모리** 아래에 있습니다 (별도 30일 기본값).

```bash
# 선택 사항: 대규모 영구 삭제 후 여유 페이지 회수 (앱이 닫혀 있어야 함)
sqlite3 ~/.hip/db/hip.db 'VACUUM;'
```

### 유용한 스크립트

| 명령 | 설명 |
|---------|-------------|
| `yarn tauri dev` | 전체 데스크톱 앱을 개발 모드로 실행 |
| `yarn sidecar:dev` | 사이드카 WS 서버를 독립 실행형으로 실행 (포트 출력) |
| `yarn sidecar:dev-bin` | `src-tauri/binaries/`에 개발 사이드카 래퍼 (재)생성 |
| `yarn cli:dev` | 제품 CLI (`hip doctor` / `session` / `run` / `repl`) — **실행 중인 hip 앱 필요** |
| `yarn cli:test` | CLI 단위 테스트 (유료 LLM 없음) |
| `yarn type-check` | 프론트엔드 타입 검사 |
| `yarn workspace @hip/sidecar type-check` | 사이드카 타입 검사 |
| `yarn test` | 프론트엔드 + 단위 테스트 (Vitest) |
| `yarn product:content` | 에이전트/UI 제품 콘텐츠 임베드 재생성 |

### 제품 CLI (`@hip/cli`)

**실행 중인** hip 데스크톱 앱(공유 사이드카 + `~/.hip` 데이터)용 연결 전용 동반자입니다.

별도의 SDK 패키지는 **없습니다** — 스크립트는 `hip … --json`을 호출해야 합니다.
CLI는 제품 사이드카를 **시작하지 않습니다**; 먼저 앱을 시작해야 하며, 그렇지 않으면 명령이 `APP_NOT_RUNNING`(종료 코드 3)으로 실패합니다.

```bash
# 데스크톱 앱을 시작한 후:

# 상태: 발견 파일 + 연결 + hasApiKey
yarn cli:dev doctor

# 인증 키 존재 여부? (비밀은 절대 출력하지 않음)
yarn cli:dev config auth-status

# 실행 중인 앱에 대한 원샷 실행 (HipRunResult JSON)
yarn cli:dev run --stream none \
  --json --output /tmp/hip-out/result.json \
  "정확히 pong이라고 응답하세요"

# 사람이 읽을 수 있는 스트림 모드: text | tools | all | none
yarn cli:dev run --stream all "README.md 요약"

# 세션 (GUI와 공유)
yarn cli:dev session list
yarn cli:dev session show <id-접두사> --limit 20
# 영구 하드 삭제 (UI 휴지통 아님)
yarn cli:dev session delete <id> --yes

# 대화형 다중 턴 REPL (TTY; HITL은 GUI가 있을 때 GUI 선호)
yarn cli:dev repl --cwd .
```

| 플래그 / 명령 | 의미 |
|----------------|---------|
| `doctor` | 연결 상태 확인 (실행 중인 앱 필요) |
| `--json` / `--output` | `HipRunResult` schemaVersion 1 |
| `--out-dir` | `result.json`, `trace.jsonl`, `patch.diff`, `usage.json` |
| `--stream` | 사람이 읽을 수 있는 기록 (text \| tools \| all \| none) |
| `--hitl auto` | 도구 권한 자동 승인 (**GUI 우회**) |
| `--hitl prompt` | GUI 클라이언트가 없을 때 GUI 또는 TTY 대기 |
| `session *` | 목록/보기/전송; `session delete`는 **영구** 삭제 (UI는 휴지통으로 소프트 삭제) |
| `repl` | 다중 턴 대화형 채팅 |
| `HIP_CLI_DEV_SPAWN=1` | 개발 전용: 격리된 생성 (제품 DB 사용 안 함) |

## 메모리

세션 간 메모리는 **기본적으로 비활성화**되어 있습니다. **설정 → 메모리**에서 활성화하세요.
SQLite가 진실 공급원입니다; `~/.hip/memories/`는 마크다운 내보내기 미러를 보관합니다.
에이전트용 제품 사본(및 선택적 유지보수자 읽기용): [packages/product-content/references/memory.md](./packages/product-content/references/memory.md).

## 권장 IDE 설정

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 제품 콘텐츠 (에이전트 임베드)

내장 제품 / 코딩 스킬은 에이전트를 위해 임베드됩니다(저장소 의미의 사용자 대상 도움말 페이지가 아님 — 설정 도움말은 지역화된 본문을 사용합니다).

진실 공급원(`docs/` 아래 아님):

- 제품: [packages/product-content/](./packages/product-content/)
- 코딩 / 위임 작업 스킬: [packages/product-content/ops/](./packages/product-content/ops/)
- UI 로케일: `packages/product-content/locales/zh-CN/`, `zh-TW/`, `ja/`, `ko/`

해당 트리를 편집한 후 임베드를 재생성하려면: `yarn product:content`.

저장소 루트 `docs/`(존재하는 경우)는 선택적 개발자 노트 전용이며 앱에서 절대 읽지 않습니다.

## 문서 언어

| 언어 | 파일 |
|----------|------|
| English | [README.md](./README.md) |
| 简体中文 | [README.zh-CN.md](./README.zh-CN.md) |
| 繁體中文 | [README.zh-TW.md](./README.zh-TW.md) |
| 日本語 | [README.ja.md](./README.ja.md) |
| 한국어 | [README.ko.md](./README.ko.md) |

영어가 GitHub 및 에이전트 대상 제품 임베드의 기본값입니다. 기술 식별자(경로, CLI 플래그, 도구 이름)는 모든 로케일에서 동일하게 유지하세요.

앱 UI 언어(설정 → 인터페이스 언어): **English**, **简体中文**, **繁體中文**, **日本語**, **한국어**.

## 기여

[CONTRIBUTING.md](./CONTRIBUTING.md) 및 [Code of Conduct](./CODE_OF_CONDUCT.md)를 참고하세요.

## 보안

취약점은 [SECURITY.md](./SECURITY.md)에 따라 **비공개**로 보고하세요. 공개 이슈를 열지 마세요.

## 변경 로그

[CHANGELOG.md](./CHANGELOG.md). 릴리스 가이드: [docs/release.md](./docs/release.md).

## 라이선스

Copyright 2026 ljm

이 프로젝트는 [Apache License, Version 2.0](./LICENSE) 하에 배포됩니다.
