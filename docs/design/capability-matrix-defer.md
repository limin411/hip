# Capability matrix — defer registry (Phase E4)

Axes or tasks that are **not** currently blocking product gate, with reason and exit criteria.

| ID | Axis / task | Status | Reason | Exit criteria |
|----|-------------|--------|--------|---------------|
| DEF-1 | `delegate` hard-require | **deferred** | Spec: delegate not hard-fail; solo fix allowed | When product surfaces reliable task/subagent UX, add soft tool-name checks then optional hard |
| DEF-2 | In-app Eval Studio | **deferred** | Spec non-goal for MVP | Separate design doc |
| DEF-3 | LLM-as-judge only scoring | **deferred** | Spec non-goal | N/A |
| DEF-4 | Default CI gate live matrix | **deferred / forbidden** | Cost + flakiness | Never without opt-in job |
| DEF-5 | `bb-common-nav-truncate` | **exited** 2026-07-16 | Was timeout/awaiting_user | Live pass after Phase D harden |
| DEF-6 | Second host repo (non-Bytebase) | **exited** 2026-07-16 | Was migration risk | `mini-go` pack + bootstrap |

## Active axes (live green at least once)

- edit_single / multi_file / test_loop / add_feature  
- plan_flow / hitl / delegate (soft)  
- safety / long_horizon (noisy)  
- nav (pilot)  
- harness_migration (`mini-go`, after live)

## How to add a defer

1. Row in this table with reason + exit criteria.  
2. Mention in pack README metadata.  
3. Do not silently skip without registry.
