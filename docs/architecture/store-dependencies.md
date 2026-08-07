# Store 层依赖规则与基线

> 权威来源：`docs/design/2026-08-07-session-service-decomposition-spec.md` §5
> 执行检查：`yarn check:store-deps`（`scripts/check-store-deps.mjs`，本地脚本，未接 CI）

## 规则

| 规则 | 内容 |
|---|---|
| **R1** | store A 不得调用 store B 的 setter / action / `setState`（写耦合）。跨 store 状态变更必须经由 `src/domain/actions/*`。 |
| **R2** | store A import store B 仅允许读取 state，且 import 处必须带注释 `// store-dep(read-only): <理由>`。 |
| **R3** | `managedTerminalStore` 家族的写耦合豁免（存量冻结，**禁止新增**、禁止扩展豁免表）。 |
| **R4** | `src/domain/actions/*` 模块之间禁止互相 import；公共逻辑下沉 `src/lib/` 或留在 facade。 |

## 基线（2026-08-07 全库盘点，10 条边）

### 只读依赖（R2 已注释，7 条）

| 依赖方 | 被依赖方 | 理由 |
|---|---|---|
| `agentsStore` | `hipConfigStore` | 从全局配置派生 enabled/ACP 能力 |
| `draftStore` | `providersStore` | 读 active model 构建 SessionConfig |
| `navHistoryStore` | `uiStore` | 读 overlay/view 状态记录导航 |
| `providersStore` | `hipConfigStore` | 目录/配置派生 |
| `skillsStore` | `hipConfigStore` | 读 agent enablement |
| `useFsScope` | `draftStore` | 读 draft cwd（未提交草稿） |
| `workItemViewStore` | `workItemStore` | 读 item 状态做列表过滤 |

### 豁免写耦合（R3，4 条，待单独治理）

| 依赖方 | 被依赖方 |
|---|---|
| `managedTerminalStore` | `terminalAgentStore` `terminalFsStore` `terminalHostStore` `terminalStore` |

## 变更流程

1. 新增 store→store 依赖：先想能否经 `src/domain/actions/*` 完成；确需读依赖则加 R2 注释。
2. 检查：`yarn check:store-deps`（任何无注释边或 actions 互引即 FAIL）。
3. 新增 `actions/` 模块：只允许依赖 facade、store、lib、protocol、transport、messageWaiter。
