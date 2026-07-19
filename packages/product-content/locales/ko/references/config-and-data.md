# hip 설정 및 로컬 데이터 (레벨 3)

## 디렉터리 구조 (`~/.hip/`)

| 경로 | 용도 |
|------|---------|
| `~/.hip/config/auth.json` | 제공자 API 키 (설계상 0600 일반 텍스트) |
| `~/.hip/config/hip.toml` | 전역 제품 설정 (스킬, 에이전트 루프, LangSmith 등) |
| `~/.hip/config/memory.json` | 메모리 기능 플래그 / 파이프라인 설정값 |
| `~/.hip/config/network.json` | 선택적 네트워크 정책 |
| `~/.hip/config/hip-plugins.json` | 설치된 플러그인 레지스트리 |
| `~/.hip/db/hip.db` | SQLite 세션, 메시지, 메모리 항목, 이벤트 |
| `~/.hip/data/tool-output/` | 대용량 도구 출력 (DB 외부 보관) |
| `~/.hip/logs/` | 사이드카 / 셸 로그 |
| `~/.hip/skills/` | 전역 스킬 |
| `~/.hip/plugins/` | 설치된 플러그인 |
| `~/.hip/memories/` | 메모리 마크다운 미러 |
| `~/.hip/builtin-skills/` | 내장 점진적 제품 스킬 (예: 이 `hip` 스킬) |
| `~/.hip/scratch/`, 작업 트리 | 임시 / 병렬 작업 트리 도우미 |
| `~/.hip/trash/` | 제품 휴지통 (지식 FS 격리, 세션은 SQLite를 통해 소프트 삭제) |

### 휴지통 및 소프트 삭제

| 동작 | 참고 |
|----------|--------|
| UI 삭제 (채팅 / 코드 / 지식) | 소프트 삭제 → 사이드바 **휴지통** (기록 위) |
| 보관 기간 | 기본 **7**일, **설정 → 일반** 또는 `hip.toml` `[trash] retentionDays` (1–365) |
| CLI `hip session delete --yes` | **영구** 하드 삭제 (휴지통 미사용) |
| 메모리 휴지통 | 여전히 **설정 → 메모리** (별도 보관 기간, 기본 30일) |

프로젝트 재정의는 보통 `<프로젝트>/.hip/` 아래에 위치합니다 (예: `.hip/skills/`, `.hip/hip.toml`).

## 환경 변수 / 격리 (고급)

| 변수 | 역할 |
|----------|------|
| `HIP_DATA_DIR` | 데이터/설정 루트 리디렉션 (테스트 / 격리) |
| `HIP_SKILLS_DIR` | 전역 스킬 루트 재정의 |
| `HIP_PLUGINS_DIR` | 플러그인 루트 재정의 |
| `HIP_AUTH_PATH` | auth.json 경로 재정의 |
| `HIP_CONFIG_PATH` | hip.toml 경로 재정의 |
| `HIP_MEMORY_CONFIG_PATH` | memory.json 경로 재정의 |
| `LANGSMITH_*` | 선택적 LangSmith 추적 (hip.toml의 `[langsmith]`도 함께) |

**`~/.hip/config/`를** 퍼블릭 클라우드나 공개 dotfile 저장소에 동기화하지 마십시오 — API 키가 포함될 수 있습니다.

## 인증 모델

키는 앱 설정 패널에서 입력되며 `auth.json`에 저장됩니다. 데스크톱 앱, 독립형 사이드카, 테스트 모두 해당 저장소에서 읽습니다. 이는 의도적인 일반 텍스트 디스크 저장 방식이며 엄격한 파일 모드가 적용됩니다 — 키체인 마이그레이션 대상이 아닙니다.
