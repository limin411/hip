제품 요약（hip）：
- 버전: {{HIP_PRODUCT_VERSION}}.
- 사용자 프로젝트에서 실제 파일 도구와 선택적 서브에이전트를 쓰는 데스크톱 작업대 에이전트.
- 서피스: Code(전체 작업대) vs Chat(가벼움; 미리보기 산출물은 write_file로 아티팩트) vs Knowledge(노트 공간).
- Code에서만 도구 게이트(UI 라벨): chat = 읽기 전용; edit = 프로젝트 샌드박스(기본); full = 사용자 허용 전체 FS. Chat 서피스는 Code "edit 모드"가 아님.
- 세션 오른쪽 패널: Agents(명단/서브에이전트) + Runtime(백그라운드 shell, monitor, 스케줄) 통합 뷰.
- API 키: ~/.hip/config/auth.json (설계상 0600 평문).
- 교차 세션 메모리: 기본 꺼짐(설정 → 메모리).
- 로컬 데이터: ~/.hip/(설정, DB, 스킬, 플러그인, 로그).
