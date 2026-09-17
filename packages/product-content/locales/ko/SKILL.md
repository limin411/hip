# hip

hip은 **데스크톱 AI 작업대**(Tauri 셸 + React UI + Node sidecar)이며 제품 버전 **{{HIP_PRODUCT_VERSION}}**입니다. 각 UI 탭은 독립 세션입니다. 기본 제품 루프는 **Supervisor ReAct** 에이전트로 도구를 쓰고 `task` / `dispatch_agent` / `task_batch`로 위임할 수 있습니다. 일반 턴에 Planner → Coder → Reviewer 강제 파이프라인은 없습니다.

이 스킬은 *hip 제품 자체*의 공식 가이드입니다. 사용자 프로젝트의 일반 코딩 작업에는 **로드하지 마세요**.

제품 질문은 **사용자 언어**로 답하고, 설정 경로·식별자는 원문 그대로 유지하세요.

## 점진적 공개

- **Level 1**(시스템 프롬프트 Skills 목록): 이름 + 설명만
- **Level 2**(이 파일): `use_skill({ name: "hip" })`로 로드
- **Level 3**: `references/` — 필요 시 `read_file`로 절대 경로 읽기

여기 없는 제품 세부사항은 지어내지 말고 모른다고 말하세요.

## 서피스

| 서피스 | 용도 |
|--------|------|
| **Code** | 프로젝트 작업대(사이드바 "프로젝트"): 파일 도구, git 가이드, MCP 카탈로그, 전체 도구, 비동기 TaskRuntime |
| **Chat** | 가벼운 대화(사이드바 "대화"): 짧은 프롬프트, git 커밋 가이드 없음; 미리보기 산출물은 `write_file` |
| **Terminals** | 관리형 터미널 / SSH 호스트(사이드바 "터미널"): 로컬 또는 원격에서 대화형 셸 실행; 터미널 레일에 **파일** 과 **에이전트** 탭 |

노트 / 문서 서피스는 없습니다. 서피스는 UI에서 선택되며 시스템 프롬프트에 반영됩니다.

## 권한 모드

| 모드 | 효과 |
|------|------|
| **edit**(기본) | 프로젝트 루트 샌드박스 |
| **chat** | 읽기 전용(쓰기/스크립트 불가) |
| **full** | 샌드박스 없음(사용자 허용); 절대 경로 권장 |

edit/chat 경로는 `/`로 시작하는 프로젝트 상대 형식. 셸 도구 이름을 만들지 말고 `run_script`를 사용.

## 설정(데스크톱 UI)

- **모델 구성** / **키 관리** — 프로바이더 목록, 모델 선택, API 키; 키는 `~/.hip/config/auth.json`(0600 평문)
- **메모리** — 교차 세션 **기본 꺼짐**(설정 → 메모리)
- **스킬** — 설치된 스킬 활성/비활성
- **플러그인 마켓** — 플러그인 설치/활성 및 공식 마켓 탐색
- **에이전트 관리** — supervisor / plan / explore / coder 및 커스텀
- **MCP**, **훅**, **일반**, **창** — 나머지 페이지
- **네트워크 정책** — 설정 파일 전용(`~/.hip/config/network.json`); 해당 설정 페이지는 **없습니다**

## 세션 오른쪽 레일

**Code** 에서 오른쪽 레일 탭은 **파일 / 개요 / 변경 / 터미널** 입니다(변경은 git 저장소 필요, 터미널은 활성 세션 필요). 서브에이전트와 실행 중 작업은 **별도 패널이 아닙니다**:

- 서브에이전트와 도구 과정은 메시지 트레일에 인라인으로 표시됩니다.
- 백그라운드 shell, monitor, 스케줄은 컴포저 위 런타임 스트립에 표시되며, 여기서 출력 확인과 중지가 가능합니다.

긴 shell / CI / 주기 작업은 TaskRuntime 도구를 쓰세요. 메인 턴에서 sleep 폴링하지 마세요.

## 예약 작업

주기 프롬프트는 **대화 단위** 입니다: 컴포저의 시계 버튼에서 만듭니다(Chat / Code 모두 가능). 실행은 **해당 작업을 소유한 대화 안**에서 이루어지며, hip이 매번 새 대화를 열지 않습니다. 그 대화를 삭제하면 예약 작업도 삭제됩니다. 에이전트 측 도구는 `scheduler_create` / `scheduler_list` / `scheduler_delete`(최소 간격 60s).

## 스킬·플러그인·MCP

- **스킬**: `SKILL.md` 폴더. 전역 `~/.hip/skills/`, 프로젝트 `.hip/skills/`.
- **플러그인**: `~/.hip/plugins/`. 자세한 내용 `references/agents-and-plugins.md`.
- **MCP**: `mcp_search` 후 `mcp__<server>__<tool>`.

## 에이전트와 위임

- 전용 명단 우선: explore / plan / coder.
- 독립 서브태스크 2+ → 한 번의 `task_batch`.
- 장시간 작업 → TaskRuntime(`run_script` background, `monitor`, `scheduler_*`).
- 심화: `references/agents-and-plugins.md`.

## CLI（`@hip/cli`）

**실행 중인** hip 앱에만 연결(공유 sidecar + `~/.hip`). 제품 sidecar를 시작하지 않습니다.

```bash
yarn cli:dev doctor
yarn cli:dev config auth-status
yarn cli:dev session list
yarn cli:dev run --stream none --json "Reply with exactly: pong"
yarn cli:dev repl --cwd .
```

앱이 없으면 `APP_NOT_RUNNING`.

## 프로젝트 가이드 파일

`AGENTS.md` / `Claude.md` / `.hip`가 있으면 **프로젝트** 규칙을 우선.

## Level 3 참고

- 메모리 → `references/memory.md`
- 설정과 데이터 → `references/config-and-data.md`
- 문제 해결 → `references/troubleshooting.md`
- 에이전트·플러그인·MCP·TaskRuntime → `references/agents-and-plugins.md`
