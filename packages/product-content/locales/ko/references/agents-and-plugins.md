# hip 에이전트, 플러그인 & MCP（Level 3）

## 내장 에이전트 프로필

| 프로필 | 역할 |
|--------|------|
| **supervisor** | 기본 오케스트레이터: 도구, 커밋, 스크립트, 위임 |
| **plan** | 설계 / 계획 중심 |
| **explore** | 읽기 전용 코드 검색 |
| **coder** | 구현 중심(스크립트 가능) |

**내부** 에이전트: 페르소나 + 모델 + 도구 권한.  
**외부 / ACP**: 별도 프로세스; 제품 메모리는 기본 꺼짐.

지원 ACP 프리셋(설정 → 에이전트 → ACP 추가): **OpenCode**, **Grok Build**(`grok agent stdio`), **Pi**, **Claude Code**, **Codex**. Grok Build는 네이티브 ACP(`https://x.ai/cli`); 인증은 `grok login` 또는 선택적 `XAI_API_KEY`.

ACP 인증·모델은 **자체 관리**: hip은 provider API 키를 ACP 자식 프로세스에 주입하지 않습니다.

## 기능 매트릭스(내장 vs ACP)

| 기능 | 내장 primary | ACP primary | ACP 서브(dispatch) |
|------|--------------|-------------|---------------------|
| hip 도구(read / write / run_script …) | 있음 | 없음 | 없음 |
| hip Skills / 플러그인 훅 | 있음 | 없음 | 없음 |
| hip MCP | 있음 | 없음(계획: opt-in 전달) | 없음 |
| 클라이언트 FS bridge | n/a | 없음(stub) | 없음 |
| dispatch / task / task_batch | 있음 | 없음 | 없음 |
| TaskRuntime(bg shell / monitor / scheduler) | 있음 | 없음 | 없음 |
| 교차 세션 Memory 주입 | 있음 | 없음 | 없음 |
| Memory 추출 | 있음 | 없음 | 없음 |
| hip 모델 선택 | 있음 | 없음 | 없음 |
| HITL | hip 도구 | ACP `requestPermission` | ACP primary와 동일 |
| permissionMode | hip 게이트 | chat/edit 안전 kind 자동; 그 외 HITL | 부모 세션 상속 |

**요약:** ACP를 primary로 쓰면 hip 내장 도구/스킬/MCP가 아닌 대등한 별도 스택입니다.

## 위임 & TaskRuntime 도구(메인 에이전트)

| 도구 | 용도 |
|------|------|
| `task` | 단일 서브태스크(fg / background) |
| `dispatch_agent` | 명단 에이전트 |
| `task_batch` | **독립 서브태스크 2+ 권장**(진짜 병렬) |
| `run_script`(+ `background:true`) | 셸; 장시간 → `task_id` |
| `wait_tasks` | 백그라운드 id 대기 |
| `task_output` | 지금까지 출력 읽기 |
| `task_stop` | 실행 중 태스크 중지 |
| `monitor` | stdout를 UI 이벤트로 스트리밍(모델에 자동 주입 안 함) |
| `scheduler_create` / `list` / `delete` | 주기 깨우기(최소 60s) |

메인 턴에서 긴 shell/CI를 sleep 폴링하지 마세요.

### 런타임 표시 위치(UI)

별도의 Agents / Runtime 패널은 없습니다:

- 서브에이전트와 도구 과정은 메시지 트레일에 인라인으로 표시됩니다(기본 접힌 "과정" 폴드).
- 백그라운드 shell, monitor, 스케줄은 **컴포저 위 런타임 스트립**에 표시되며, 여기서 출력 확인과 중지가 가능합니다.

### 예약 작업(UI)

주기 프롬프트는 **대화 단위** 입니다 — 컴포저의 시계 버튼에서 만듭니다(Chat / Code 모두 가능). 실행은 **해당 작업을 소유한 대화 안**에서 이루어지며(매번 새 대화를 열지 않음), 그 대화를 삭제하면 예약 작업도 삭제됩니다. 최소 간격은 60s.

## 플러그인

- 위치: `~/.hip/plugins/`; 레지스트리 `~/.hip/config/hip-plugins.json`.
- 스킬, 에이전트, MCP, 훅 포함 가능.

### Plugin Market(설정)

공식 카탈로그만:

| Source id | Catalog |
|-----------|---------|
| `grok-official` | [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace) |
| `claude-official` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |

UI: **Grok market** · **Claude market** · **Custom plugins**.

- 캐시: `~/.hip/cache/marketplaces/<sourceId>/`
- 소스 토글: `~/.hip/config/marketplace-sources.json`
- 다운로드 기본 `enabled: false`; `boundModel` 검토.

### 플러그인 디렉터리

필수: `.plugin/plugin.json`(`name` / `version` 최소).

### `hip-plugins.json`

권장(문자열 배열):

```json
{
  "plugins": ["/absolute/path/to/plugin"],
  "entries": [],
  "enabled": { "my-plugin": true }
}
```

## MCP

- hip.toml / 플러그인 합성.
- `mcp_search` 후 `mcp__<server>__<tool>`.
- 네트워크 정책이 아웃바운드를 막을 수 있음.

## 스킬 범위

| 범위 | 위치 |
|------|------|
| global | `~/.hip/skills/<id>/` |
| project | `.hip/skills/<id>/` |
| plugin | 플러그인 소유 |
| builtin | `~/.hip/builtin-skills/hip/`(최저 우선) |
