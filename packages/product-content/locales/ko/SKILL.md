# hip

hip은 **데스크톱 AI 작업대**(Tauri 셸 + React UI + Node 사이드카)이며, 제품 버전은 **{{HIP_PRODUCT_VERSION}}**입니다. 각 UI 탭은 독립적인 세션입니다. 기본 제품 루프는 도구를 사용하고 `task` / `dispatch_agent` / `task_batch`로 위임할 수 있는 **Supervisor ReAct** 에이전트입니다. 일반적인 턴에서 Planner → Coder → Reviewer 파이프라인이 강제되지 않습니다.

이 스킬은 *hip 자체*에 대한 권위 있는 제품 가이드입니다. 사용자 프로젝트의 일반 코딩 작업에는 이 스킬을 **로드하지 마십시오**.

제품 질문은 **사용자의 언어**(예: 사용자가 중국어로 작성한 경우 중국어)로 답변하되, 설정 경로와 식별자는 정확하게 유지하십시오.

## 점진적 공개

- **레벨 1**(시스템 프롬프트 Skills 목록): 이름 + 설명만
- **레벨 2**(이 파일): 아래 개요, `use_skill({ name: "hip" })`를 통해 로드됨
- **레벨 3**: `references/`의 심화 주제 — 필요 시 `read_file`로 해당 절대 경로를 읽으십시오

제품 세부 사항이 여기에 문서화되지 않은 경우, UI 레이블이나 설정 키를 임의로 만들지 말고 그렇게 명시하십시오.

## 표면

| 표면 | 의도 |
|---------|--------|
| **Code** | 프로젝트 작업대: 파일 도구, git 안내, MCP 카탈로그, 전체 에이전트 도구 |
| **Chat** | 가벼운 대화 표면: 짧은 프롬프트, git-커밋 안내 없음, 아티팩트 패널을 위해 미리보기 가능한 결과물(`page.html`, `notes.md`, SVG 등)을 작업 공간에 작성 선호 |

표면은 UI에서 선택되며, 시스템 프롬프트는 이미 활성 표면을 반영합니다.

## 권한 모드

| 모드 | 효과 |
|------|--------|
| **edit** (기본값) | 파일시스템 도구가 프로젝트 루트로 샌드박싱됨 |
| **chat** | 읽기 전용: 쓰기/편집/스크립트/git 변형 없음 |
| **full** | 샌드박스 해제된 파일시스템(사용자 승인); 절대 경로 선호 |

edit/chat의 경로 규칙: `/`로 시작하는 프로젝트 루트 형식(예: `/src/index.ts`는 `<cwd>/src/index.ts`에 매핑). 셸 도구 이름을 임의로 만들지 마십시오 — 사용 가능한 경우 `run_script`를 사용하십시오.

## 설정 (데스크톱 UI)

일반적인 위치(UI에서 표현이 약간 다를 수 있음):

- **Providers / API keys** — `~/.hip/config/auth.json`에 일반 텍스트로 저장됨(설계상 모드 0600)
- **Memory** — 교차 세션 메모리는 **기본적으로 꺼져 있음**; Settings → Memory에서 활성화(`references/memory.md` 참조)
- **Skills** — 설치된 스킬 활성화/비활성화(`hip.toml` + 스킬 폴더)
- **Plugins** — 플러그인 설치/활성화(스킬, 에이전트, MCP, 훅)
- **Agents** — 고정 프로필(supervisor / plan / explore / coder) 및 사용자 정의 내부 또는 외부 에이전트
- **Network policy** — 아웃바운드 도구에 대한 선택적 허용/거부

## 스킬, 플러그인, MCP

- **스킬**: `SKILL.md`가 포함된 Claude 형식 폴더. 전역: `~/.hip/skills/<id>/`. 프로젝트: `.hip/skills/<id>/`. 점진적 공개: L1 메타데이터 → `use_skill` 본문 → `references/` + `assets/`.
- **플러그인**: `~/.hip/plugins/` 아래; 스킬, 에이전트, MCP 서버 및 훅을 제공할 수 있음. `references/agents-and-plugins.md` 참조.
- **MCP**: 구성된 서버가 도구를 노출함. Code 표면에서 시스템 프롬프트가 카탈로그를 나열할 수 있음; `mcp_search`를 사용한 후 네임스페이스된 도구 `mcp__<server>__<tool>`을 호출하십시오.

## 에이전트 및 위임

- 기본 세션 에이전트는 도구 사용 또는 위임 시기를 결정합니다.
- 사용 가능한 경우 전문 로스터 에이전트를 선호하십시오: **explore**(읽기 전용 검색), **plan**(설계 전용), **coder**(구현).
- 병렬 독립 하위 작업 → 하나의 `task_batch`(순차적 `dispatch_agent` 아님).
- 명시적 워크플로우 / 다중 에이전트 핸드오프가 존재하지만 **일반적인 제품 경로는 아닙니다**.
- 심화: `references/agents-and-plugins.md`.

## CLI (`@hip/cli`)

**실행 중인** hip 앱에 연결 전용 동반자(공유 사이드카 + `~/.hip` 데이터). 제품 사이드카를 시작하지 않습니다.

```bash
yarn cli:dev doctor
yarn cli:dev config auth-status
yarn cli:dev session list
yarn cli:dev run --stream none --json "Reply with exactly: pong"
yarn cli:dev repl --cwd .
```

앱이 실행 중이지 않으면 CLI는 `APP_NOT_RUNNING`으로 실패합니다.

## 프로젝트 안내 파일

프로젝트 아래에 있을 때, hip은 `AGENTS.md` / `Claude.md` / `.hip` 설정과 같은 안내를 주입할 수 있습니다. **프로젝트** 규칙에 대해서는 이를 따르는 것을 선호하십시오; 이 스킬은 **제품** 동작을 위한 것입니다.

## 레벨 3 참조

이 스킬을 로드한 후, `use_skill`은 절대 경로를 반환합니다. 사용자가 심화가 필요할 때:

- 메모리 활성화, 주입, 추출, 개인정보 → `references/memory.md`
- 로컬 데이터 레이아웃, 설정 파일, 환경 변수 재정의 → `references/config-and-data.md`
- 일반적인 실패(키 없음, CLI 실행 중 아님, 빈 메모리) → `references/troubleshooting.md`
- 에이전트, 플러그인, MCP 연결 → `references/agents-and-plugins.md`
