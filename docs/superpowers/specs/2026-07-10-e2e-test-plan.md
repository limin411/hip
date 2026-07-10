# hip 完整 E2E 测试计划

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **计划中 · Phase 0–1 落地中** |
| 前提 | A/B/C 主干 + polish P1–P3 已落地；栈为 WDIO + `@wdio/tauri-service` + Mocha |
| 入口 | `yarn test:e2e` → `wdio.conf.ts`；过滤：`E2E_GREP` / `E2E_INVERT` / `--spec` |
| 相关 | [`pre-public-roadmap-index`](./2026-07-10-pre-public-roadmap-index.md)、[`polish-e2e-write-to-changes`](./2026-07-10-polish-e2e-write-to-changes-design.md)、Sprint A/B |

---

## 1. 目标与原则

### 1.1 Goals

| ID | 目标 |
|----|------|
| G1 | **公开前主路径可回归**：启动 → 会话 → Code 改文件 → Changes 看见 →（检查点）回退 → 取消/错误可感 |
| G2 | **默认不付费**：全量 e2e 不依赖真实 LLM；需要 agent 语义时用 `window.__hipE2E` 注入或假事件 |
| G3 | **分层清晰**：UI 壳 / 工作区 / harness 投影 / 慢路径；能单测的不抬 e2e |
| G4 | **可过滤、可 CI**：冒烟 <10min；全量可夜间或本地；`E2E_GREP` 标签稳定 |
| G5 | **可维护**：page object + helpers + testid 约定；共享 app 进程下减少顺序耦合 |

### 1.2 Non-Goals

- 真 LLM 质量评测（可选 `E2E_LIVE_LLM=1` 夜间套件，不进默认门禁）
- PTY 全交互 / ANSI / IME / Windows stub（见 terminal design）
- 云同步、SSO、多用户
- 替换 unit/集成测（harness 黄金委派、LoopGuard、权限矩阵仍在 sidecar/前端单测）
- 生产构建暴露 `__hipE2E`

### 1.3 分层策略

```
┌─────────────────────────────────────────────┐
│  L3 E2E (Tauri WebDriver)                   │  真实窗口 + sidecar + 隔离 HIP_DATA_DIR
│  用户可见路径、跨 surface、git/diff、注入桥  │
├─────────────────────────────────────────────┤
│  L2 集成 (Vitest / cargo / sidecar test)    │  假 LLM、WS 形状、persist、cancel finalize
├─────────────────────────────────────────────┤
│  L1 单元 (组件 / domain / effects)          │  TimelineView、diffRefresh、i18n keys
└─────────────────────────────────────────────┘
```

**上 e2e 的条件（满足其一）：**

1. 跨进程（UI ↔ Rust ↔ sidecar ↔ git）  
2. 布局/路由/surface 切换用户可感知  
3. 已有单测仍漏「不切 tab / 真实 WebView」类回归  

**不上 e2e（用 L1/L2）：**

- 纯算法、防抖计数、假 LLM 委派次数、权限矩阵表  
- Modal 分支穷尽（P1 TimelineView 组件测已锁）

---

## 2. 现状盘点（2026-07-10）

### 2.1 基建

| 项 | 现状 |
|----|------|
| Runner | WDIO local, `maxInstances: 1`，共享一个 Tauri 进程 |
| 数据 | `HIP_DATA_DIR` 临时目录；fixture `sample-plugin`；可选拷贝用户 `auth.json` |
| 前端 | Vite `:1420`；端口被占且非 hip 则 fail-fast |
| 注入桥 | `window.__hipE2E`：`injectServerMessage` / `simulateAgentWriteFinished` / `getActiveSessionId`（非 PROD） |
| 选择器 | 以 `data-testid` 为主；Radix 下 headless 常用 `pointerdown` + `data-state` |
| 过滤 | `E2E_GREP` / `E2E_INVERT`；`--spec path` |
| 二进制 | `E2E_BINARY` 或 `./src-tauri/target/debug/hip` |

### 2.2 已有规格（约 50+ it）

| 文件 | 主题 | 大致覆盖 |
|------|------|----------|
| `app-launch` | 启动 / 登录 / 落地 | 登录屏、chat greeting、new session 按钮 |
| `session-management` | Chat 会话 | 新建 draft、发消息建 tab、切换 tab |
| `project-workspace` | Code 落地 | 选目录、树、预览 md/html/img/ts、首条 commit session |
| `diff-workspace` | git + Changes UI | init、baseline、**带外编辑 + 切 tab**、split/show-full/jump |
| `write-to-changes` | B1 自动刷新 | **不切 tab** + 落盘 + `simulateAgentWriteFinished` |
| `code-terminal` | Terminal 面板 | 菜单入口、host/empty、切走再回、chat 无 Terminal |
| `composer-widgets` | 模型/权限/发送 | picker、三档权限、空发送禁用、附件按钮 |
| `slash-commands` | `/` 面板 | 显示过滤、chat 隐藏 code-only、code 显示 |
| `skill-plugin-dialogue` | fixture skill | sample-greet/format 选中与参数 hint |
| `settings-smoke` | 设置 | 各 tab 切换与返回 |
| `token-usage-chip` | 用量条 | 无 usage 不显示；有则弱断言（常 skip 存在性） |

### 2.3 明确缺口（相对公开前主路径）

| 缺口 | 产品锚点 | 建议层 | 优先级 |
|------|----------|--------|--------|
| 检查点回退确认 **UI e2e** | TimelineView Modal（P1 已组件测） | L3 smoke 1 条 + 注入 checkpoint | P1 |
| Cancel → partial assistant | A1 + `composer-stop` | L2 为主；L3 注入 running + stop | P0 |
| 复制调试信息 | `chat-copy-debug` / A5 | L3：错误态可见 + 剪贴板/导出非空脱敏 | P1 |
| Agents 面板协作真相 | `agent-card` / panel-tab-agents | L3 注入 agentRuns / 结构条 | P1 |
| Permission HITL 弹窗 | `permission-modal` | L3 注入 permission 请求 | P1 |
| 全局命令面板 | `global-command-palette` | L3 打开/过滤/执行 1 条 | P2 |
| Session History | 打开、筛选、删除 | L3 smoke | P2 |
| 安装失败可读 | settings install errors（B） | L3 或 L2 fixture 坏插件 | P2 |
| Cancel 后 Changes 仍保留 | B E2E-cancel optional | L3：写盘 + stop + 仍 diff | P2 |
| 多文件 jump list | `diff-file-list` | L3 扩 diff-workspace | P2 |
| Live LLM 一条 happy path | 可选 | L3 opt-in 标签 `@live` | P3 |
| 会话关闭 / 历史恢复 | tabs + history | L3 | P2 |
| i18n 切语言 smoke | settings | L3 可选 | P3 |

---

## 3. 套件结构与标签

### 3.1 标签约定（写在 `describe`/`it` 标题里，供 `E2E_GREP`）

| 标签 | 含义 | CI 默认 |
|------|------|---------|
| `@smoke` | 启动、主壳、不依赖 git 临时盘复杂 setup | **是** |
| `@core` | 会话 + Code 工作区 + Changes 主路径 | **是** |
| `@harness` | 注入桥：cancel / write / permission / agents | **是**（不付费） |
| `@panel` | Terminal / Agents / Timeline | 是或 nightly |
| `@settings` | 设置 smoke | 可选 |
| `@live` | 真 LLM | **否** |
| `@slow` | >60s 或重盘 IO | nightly |

示例：

```ts
describe('write tool → Changes auto-refresh @core @harness', () => {
  it('… @smoke', async () => { … })
})
```

### 3.2 推荐命令

```bash
# 全量（需 debug hip + 端口 1420 空闲或 hip Vite）
yarn tauri build --debug   # 或已有 target/debug/hip
yarn test:e2e

# 冒烟
E2E_GREP=@smoke yarn test:e2e

# 主路径（公开前门禁建议）
E2E_GREP='@smoke|@core|@harness' yarn test:e2e

# 单文件
yarn test:e2e --spec e2e/specs/write-to-changes.spec.ts

# 排除 live
E2E_GREP=@live E2E_INVERT=1 yarn test:e2e
```

### 3.3 目标目录布局（演进，不强制一次搬完）

```
e2e/
  fixtures/          # sample-project, sample-plugin, bad-plugin（未来）
  helpers/           # app, auth, surface, e2e-hooks, panel, session, git-workspace
  page-objects/      # Chat, Code, Settings, Agents, Timeline（按需）
  specs/
    smoke/           # app-launch, session 最小
    core/            # project, diff, write-to-changes
    harness/         # cancel, permission, agents inject, copy-debug
    panels/          # terminal, timeline-revert
    settings/
  token-usage-chip.spec.ts  # 可迁入 smoke 或 settings
```

短期允许保持扁平 `e2e/specs/*`；**新文件按域命名**，搬迁可单独 chore。

---

## 4. 用例目录（完整清单）

状态：`✅` 已有 · `🟡` 部分 · `⬜` 待做 · `⛔` 明确不做 e2e

### 4.1 Smoke — 启动与壳 `@smoke`

| ID | 用例 | 状态 | 文件 / 说明 |
|----|------|------|-------------|
| S1 | 启动见登录（可 reset localStorage） | ✅ | `app-launch` |
| S2 | skip 登录后主应用 titlebar + chat 落地 | ✅ | `app-launch` |
| S3 | Chat / Code surface 切换可用 | 🟡 | helpers 有；缺独立 assert it |
| S4 | 设置打开/各 tab/返回 | ✅ | `settings-smoke` |
| S5 | 全局命令面板打开与关闭 | ⬜ | `global-command-palette` |

### 4.2 Core — 会话与 Code 工作区 `@core`

| ID | 用例 | 状态 | 说明 |
|----|------|------|------|
| C1 | Chat 发消息创建 session tab | ✅ | `session-management` |
| C2 | 多 tab 切换 | ✅ | 同上 |
| C3 | Code 选目录 → 树/预览 → 首条 commit | ✅ | `project-workspace` |
| C4 | git 非仓库 → init → Changes 出现 | ✅ | `diff-workspace` |
| C5 | 带外编辑 + 切 tab → diff 出现 | ✅ | fallback 路径 |
| C6 | tool 语义写完 **不切 tab** → Changes | ✅ | `write-to-changes` |
| C7 | 多文件 diff jump list | ⬜ | 扩 `diff-workspace` |
| C8 | Composer 模型/权限/空发送 | ✅ | `composer-widgets` |
| C9 | Slash 过滤 + surface 差异 | ✅ | `slash-commands` |
| C10 | Fixture skill 选中与参数 hint | ✅ | `skill-plugin-dialogue` |
| C11 | 关闭 session tab / 再开 history 恢复 | ⬜ | 需 history 入口 testid |

### 4.3 Harness — 注入与主循环可感 `@harness`

依赖扩展 `__hipE2E`（见 §5）。**禁止默认 live LLM。**

| ID | 用例 | 状态 | 步骤概要 | 期望 |
|----|------|------|----------|------|
| H1 | write → Changes auto | ✅ | 落盘 + `simulateAgentWriteFinished` | `diff-file` 含 path |
| H2 | cancel 运行中 turn | ⬜ | 注入 streaming/running + 点 `composer-stop` 或 inject cancel 结果 | 有 assistant/`stopped` 痕迹；非空白 |
| H3 | cancel 后已写文件仍在 Changes | ⬜ | H1 + stop | path 仍在 |
| H4 | 复制调试信息 | ⬜ | 注入 error 条或菜单 | `chat-copy-debug` 可用；payload 无 apiKey |
| H5 | Permission modal | ⬜ | inject permission request | modal + option 可点；关闭 |
| H6 | Agents 面板有卡片 | ⬜ | inject agent run/structure | `agent-card` 或结构条可见 |
| H7 | 委派行 / jump to turn | ⬜ | 注入 multi-agent turn | `delegation-row` / `agent-jump-turn` |
| H8 | 检查点 revert 确认流 | ⬜ | mock checkpoints + 点 revert | modal 确认/取消；成功关闭（可弱于组件测） |

**H2–H8 优先用注入**，不调用付费 API。sidecar 侧 cancel 正确性继续靠 L2。

### 4.4 Panels — Code 右侧 `@panel`

| ID | 用例 | 状态 | 说明 |
|----|------|------|------|
| P1 | Terminal 菜单与 host | ✅ | `code-terminal` |
| P2 | Terminal keep-alive 切 tab | ✅ | 同上 |
| P3 | Chat 无 Terminal | ✅ | 同上 |
| P4 | Timeline 列表渲染 | ⬜ | 有 checkpoint 数据时 `timeline-row` |
| P5 | Agents 入口在 code 菜单 | 🟡 | terminal 测间接断言 menu 含 agents；缺交互 |

### 4.5 Settings / 插件 `@settings`

| ID | 用例 | 状态 | 说明 |
|----|------|------|------|
| T1 | 设置 tab smoke | ✅ | |
| T2 | 坏插件 / 安装错误可读 | ⬜ | fixture + settings skills |
| T3 | token chip 无数据不显示 | ✅ | |
| T4 | token chip 有数据 | 🟡 | 存在性 gate；真数据靠 live 或 inject usage |

### 4.6 Live（可选）`@live`

| ID | 用例 | 状态 | 条件 |
|----|------|------|------|
| L1 | Chat 一轮短回复 | ⬜ | `auth.json` + 网络；断言非空 assistant |
| L2 | Code 会话 write 真工具 | ⬜ | 高成本；优先 H1 替代 |

**门禁：** 仅 `E2E_GREP=@live` 显式跑；失败不挡 merge。

### 4.7 明确不做 e2e `⛔`

| 主题 | 原因 | 替代 |
|------|------|------|
| LoopGuard / 黄金委派次数 | 假 LLM 序列 | sidecar 单测 |
| 权限矩阵全表 | 组合爆炸 | 单测 |
| Diff 防抖请求次数 | 计数器 | domain 单测 |
| Modal 错误/跨分支穷尽 | 已 P1 组件测 | `TimelineView.test` |
| PTY 键入 kill Windows | 不稳定 | 手工 / Rust |
| orchMode / DAG 产品面 | 已收敛删除 | 无 |

---

## 5. 注入桥演进（`__hipE2E`）

当前（够 H1）：

```ts
type HipE2EHooks = {
  injectServerMessage: (msg: ServerMessage) => void
  simulateAgentWriteFinished: (sessionId: string) => { turnId; callId }
  getActiveSessionId: () => string | null
}
```

**建议增量（按用例需要加，忌一次万能 API）：**

| 方法 | 服务用例 | 说明 |
|------|----------|------|
| `simulateTurnRunning(sessionId)` | H2 | 置 session running + 可选 streaming 条，便于点 Stop |
| `simulateTurnCancelled(sessionId)` | H2 | 注入 complete + stopped 投影（若 UI stop 打不到 sidecar） |
| `simulatePermissionRequest(…)` | H5 | 弹出 `permission-modal` |
| `seedAgentStructure(sessionId, runs)` | H6–H7 | Agents 面板数据 |
| `seedCheckpoints(sessionId, list)` | H8 | Timeline |
| `getSessionDebugBundle()` 或读 store | H4 | 断言脱敏（或 e2e 读 clipboard API） |

约束：

1. **仅 `!import.meta.env.PROD`**  
2. 封装业务形状（像 `simulateAgentWriteFinished`），e2e 不手写脆弱消息图  
3. 每个新 hook 配 **一条 domain 单测** + e2e 使用  

Helpers 同步扩：`e2e/helpers/e2e-hooks.ts`。

---

## 6. Fixtures 与隔离

| Fixture | 用途 |
|---------|------|
| `e2e/fixtures/sample-project` | 已有：树/预览/terminal |
| `e2e/fixtures/sample-plugin` | 已有：skill slash |
| 临时 `mkdtemp` 非仓库目录 | diff / write-to-changes（**禁止污染 sample-project git**） |
| （未来）`bad-plugin` | T2 安装错误 |
| 用户 `~/.hip/config/auth.json` 拷贝 | 仅 live；默认门禁可不依赖 key |

**隔离现实：** 嵌入式 WebDriver **单 app 进程**，规格间共享状态。约定：

1. `before`：`waitForAppReady` + `skipLoginIfPresent` + 切正确 surface  
2. 需要干净 draft 时：`new-session-button`  
3. 临时目录 `after` 删除  
4. 不依赖「上一个 describe 的 session 数量」除非本文件自建  
5. 长 suite 失败后优先 **整 run 重跑** 而非假设并行隔离  

---

## 7. 分阶段落地计划

### Phase 0 — 基线固化（0.5 天）

- [x] 文档：本 plan + README/`e2e/README.md` 命令与标签  
- [x] 现有 specs 标题补 `@smoke` / `@core` / `@harness`（不改逻辑）  
- [ ] 本地确认：`yarn test:e2e:gate` 绿（含 write-to-changes + harness）  
- [x] CI 草稿：门禁 = `@smoke|@core|@harness`（见 `e2e/README.md` + `test:e2e:gate`）  

### Phase 1 — 公开前门禁补齐（2–4 天）**优先**

| 顺序 | 交付 | 验收 |
|------|------|------|
| 1.1 | H2 cancel 可感（注入 + Stop） | **已实现** `harness-cancel.spec.ts` |
| 1.2 | H4 复制调试信息 | **已实现** `harness-copy-debug.spec.ts` |
| 1.3 | H8 Timeline revert smoke（可选若组件测已够） | **仅 L1**（`TimelineView.test`；e2e 后置） |
| 1.4 | H6 Agents 卡片注入 | **已实现** `harness-agents.spec.ts` |
| 1.5 | S3 surface 切换独立 it | **已实现** `surface-switch.spec.ts` |

**公开前 e2e 门禁定义（建议）：**

```
@smoke ∪ @core ∪ @harness(H1,H2,H4,H6)
且 0 付费 API
```

### Phase 2 — 深度与面板（1–2 周，可穿插）

- H3 cancel 保 diff、H5 permission modal  
- C7 多文件 jump、C11 history  
- P4 Timeline 列表、T2 坏插件  
- 全局命令面板 S5  
- helpers：`git-workspace.ts` 抽出 `initGitAndOpenChanges` 去重  

### Phase 3 — 可选与硬化

- `@live` L1 一条  
- flake 治理：超时分级、截图失败附件、减少 `browser.pause`  
- 目录迁到 `specs/{smoke,core,harness,...}`  
- 评估第二 worker（若 Tauri service 支持多实例）— **当前默认不做**  

---

## 8. 与产品路线图映射

| 公开前优先 5 事 | E2E 落点 |
|-----------------|----------|
| 1. 主路径 harness 回归 | H2、H4 + L2 黄金/LoopGuard |
| 2. Code 改→看见→回退 | C4–C6、H1、H8（或 L1 Timeline） |
| 3. Agents 协作真相 | H6、H7 |
| 4. 上下文/成本 | T3/T4；真 % 靠 inject usage |
| 5. 本地可诊断 | H4 |

| Sprint / Polish | E2E |
|-----------------|-----|
| A cancel / debug | H2、H4 |
| B write→Changes / Agents / install | H1 ✅、H6、T2 |
| B3 checkpoint confirm | H8 / L1 ✅ |
| C 收敛 | 无新 e2e 义务；删 DAG 相关旧测若有 |

---

## 9. 稳定性与编写规范

1. **优先 `waitUntil` / `waitForExist`**，少用固定 `pause`（现有 WebKit 动画问题处可保留短 pause 并注释）  
2. **Radix**：`pointerdown` 打开；断言 `data-state="open"` 而非 `isDisplayed`  
3. **文案**：关键路径可用中文 greeting 等产品串；易变文案优先 testid  
4. **新 UI 必带 testid** 才写 e2e  
5. **一个 it 一个行为**；setup 可共用 `before` 串行 git init  
6. **失败信息**：`timeoutMsg` 写清期望 surface/tab  
7. **不在 e2e 断言** 内部 store 字段，除非经 `__hipE2E` 只读 API  

---

## 10. 成功标准

### 10.1 计划本身 Done

1. 本文件评审通过；与 roadmap/polish 交叉引用  
2. 标签与命令在 `e2e/README.md`（或 package.json scripts 注释）可复制  

### 10.2 Phase 1 Done（公开前 e2e）

1. 门禁 grep 集合本地/CI 绿  
2. H1 保持；H2/H4/H6 至少落地或书面「由 L2 覆盖 + 手动一次」  
3. 无默认付费调用  
4. 已知 flake 列表（若有）记在 `e2e/README.md`  

### 10.3 完整计划 Done（Phase 2+）

1. §4 中 P0/P1 项无 ⬜（或标 ⛔ 与替代层）  
2. 冒烟 ≤10min；门禁 ≤25min（参考目标，按机器调整）  
3. 注入 API 有单测；生产包无 `__hipE2E`  

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| 共享 app 状态污染 | 每文件自建 session；临时 dir；失败整跑 |
| 注入与真 sidecar 行为漂移 | 注入只测 UI 投影；协议形状 L2 锁 |
| WebKit 动画/焦点 flake | 已有 pattern；禁止依赖 hover 唯一路径 |
| 门禁过慢 | 分层标签；重测 nightly |
| auth 拷贝导致误跑 live | live 显式 env；默认断言不依赖模型回复 |
| 桥泄漏生产 | PROD 不安装 + 发布 checklist |

---

## 12. 建议立即执行的下一刀

1. **Phase 0**：打标签 + `e2e/README.md`  
2. **Phase 1.1 H2 cancel**：扩展 `simulateTurnRunning` + e2e  
3. **Phase 1.2 H4 copy-debug**  
4. **Phase 1.4 H6 agents inject**  

不扩展产品功能；只锁公开前可感路径。实现时按 `AGENTS.md`：**小步 commit**，每完成一个 H* 或一批标签即提交。

---

## 附录 A — 现有 spec ↔ 标签建议（落地 Phase 0）

| Spec | 建议标签 |
|------|----------|
| app-launch | `@smoke` |
| session-management | `@smoke @core` |
| project-workspace | `@core` |
| diff-workspace | `@core` |
| write-to-changes | `@core @harness` |
| code-terminal | `@panel` |
| composer-widgets | `@core` |
| slash-commands | `@core` |
| skill-plugin-dialogue | `@core` |
| settings-smoke | `@settings @smoke` |
| token-usage-chip | `@settings` |

## 附录 B — Page object 缺口

| PO | 现状 | 需要时补 |
|----|------|----------|
| ChatPage | 有 | stop、copy-debug、error |
| CodePage | 有 | agents tab、timeline |
| SettingsPage | 有 | install errors |
| LoginPage | 有 | — |
| AgentsPage / TimelinePage | 无 | H6–H8 |

## 附录 C — 与单测边界速查

| 行为 | E2E | Unit/集成 |
|------|-----|-----------|
| write 后 Changes 自动刷新 | ✅ H1 | effects debounce |
| revert Modal 失败不砖 | 可选 H8 | ✅ TimelineView.test |
| cancel finalize 消息 | 可选 H2 | ✅ sidecar harness |
| 0 task 委派 | ⛔ | ✅ 黄金用例 |
| git init UX | ✅ C4 | — |
