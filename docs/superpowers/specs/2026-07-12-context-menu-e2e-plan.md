# Context Menu 真机 E2E 测试方案

**Date:** 2026-07-12  
**Scope:** `dev` @ `c14d126` — right-click context menu system（registry / catalog / surface wiring / Settings prefs / terminal canvas）  
**Harness:** 现有 WebdriverIO + `@wdio/tauri-service` 真机调试二进制（非 Playwright 浏览器 mock）  
**Unit coverage:** 已有大量 Vitest（providers / nesting / prefs / DeclarativeContextMenu）；本方案补 **跨组件 + IPC + 真布局** 缺口。

---

## 1. 目标与非目标

### 目标

1. 在 **真实 Tauri 进程** 中验证右键菜单可打开、条目可见、核心动作生效。
2. 覆盖设计里标注的 P0 表面 + 高风险 P1（bulk delete confirm、path gate、modal 不卡 UI）。
3. 与现有 tag 体系对齐：`@smoke` / `@core` / 新标签 `@context-menu`。
4. 对自动化成本高的行为给出 **手动真机清单**（Finder、系统剪贴板、xterm 选区）。

### 非目标

- 不重复测 registry 纯逻辑（已有 `registry.test.ts` / provider unit）。
- 不引入第二套 E2E 框架。
- 不把 `CONTEXT_MENUS=false` 全量回退做成 CI 必跑（可选 nightly）。
- 不测第三方插件注入菜单（v1 禁止）。

### 「真机」定义（本仓库）

| 层级 | 含义 | 命令 / 方式 |
|------|------|-------------|
| A. 自动化真机 | debug `src-tauri/target/debug/hip` + Vite `:1420` | `yarn test:e2e` / `E2E_GREP=…` |
| B. 手工真机 | `yarn tauri dev` 或 debug `.app`，人手右键 | 见 §7 清单 |
| C. 单元 | Vitest jsdom | `yarn test` — 不替代 A/B |

默认交付顺序：**先 A 的 smoke+core 自动化 → 再 B 的高风险手工**。

---

## 2. 背景：近期改动表面

合并栈（已进 `dev`）按产品表面拆分：

| 优先级 | Kind | 宿主 UI | 代表 item id | 风险点 |
|--------|------|---------|--------------|--------|
| P0 | `message` | `MessageBubble` | copy / quote / regenerate / copyId / copyDebugBundle | quote 插入 composer；regenerate 条件 |
| P0 | `codeBlock` | 代码块 | copy | 嵌套在 message 上应命中内层 |
| P0 | `sessionTab` | `SessionTab` | rename / close / deleteOthers / deleteToRight / deleteAllOpen | **Path A = close 即删**；多删必须确认 |
| P0 | `sessionHistory` | 历史列表行 | open / rename / delete | 与 tab 语义一致 |
| P0 | `fileEntry` | `FileTree` | open / copy* / openContainingFolder / refresh | cwd 路径边界 |
| P1 | `filePreview` | 预览 chrome | copyPath / copyContent / openContainingFolder | iframe 不抢菜单 |
| P1 | `toolCall` / `subAgent` | 工具行 / 子代理卡 | copy input/output/error / copyId | 嵌套命中 |
| P1 | `diffFile` / `diffHunk` / `checkpoint` / `commit` | Changes / Timeline | copy path / revert / copySha | git fixture |
| P1 | `terminal` | chrome + canvas | restart / copyCwd / copySelection / paste | ControlledContextMenu + xterm |
| P2 | `agentConfig` 等 | Settings 卡片 | edit / delete / uninstall | 与 kebab 同源 |
| 横切 | prefs | `ContextMenuSettings` | hide / reorder / reset | 隐藏后菜单无该项 |

稳定选择器（已存在，优先使用）：

- 宿主：`[data-context-menu-kind="<kind>"]`、`[data-context-menu-root]`
- 菜单：`[data-testid="context-menu-content"]`、`[data-testid="context-menu-item-<id>"]`
- 设置：`[data-testid="context-menu-settings"]`、`…-visible-<id>`、`…-up/down-<id>`
- 终端 canvas：`[data-testid="controlled-context-menu-content"]`（与 declarative 并存时注意）
- 消息：`[data-testid="message-context-menu"]`、`//*[@data-message-id]`
- Tab：`[data-testid="session-tab-container"]` / `session-tab`

---

## 3. 分层策略

```
┌─────────────────────────────────────────────────────────┐
│  L0  单测（已有）providers / nesting / prefs / modal=false │
├─────────────────────────────────────────────────────────┤
│  L1  E2E smoke  打开菜单 + 条目存在（无副作用 / 可撤销）   │
│  L2  E2E core   动作副作用可观测（quote、rename、close、   │
│                 hide prefs、multi-delete cancel）        │
│  L3  E2E panel  Code 工作区：file tree / diff / terminal  │
│  L4  手工真机   OS 剪贴板、Finder、xterm 选区、焦点恢复    │
└─────────────────────────────────────────────────────────┘
```

| 层 | Tag | 进 gate？ | 预估时长 |
|----|-----|-----------|----------|
| L1 | `@context-menu @smoke` | 建议进 `test:e2e:gate`（3–5 case） | ~2–4 min |
| L2 | `@context-menu @core` | 建议进 gate | ~5–8 min |
| L3 | `@context-menu @panel` | nightly / 可选 | ~5–10 min |
| L4 | 手工清单 | 发版 / 合并后一次 | ~20–40 min |

Gate 现状：`E2E_GREP='@smoke|@core|@harness'`。新增 case 标题须带 `@smoke`/`@core`/`@panel` 才会被扫到。

---

## 4. 自动化用例矩阵

### 4.1 基建（先于用例）

新增 helper（建议路径）：

| 文件 | 职责 |
|------|------|
| `e2e/helpers/context-menu.ts` | 右键打开、断言条目、点条目、Esc 关闭 |
| （可选）`e2e/page-objects` 扩展 | 仅当 selector 复用 ≥3 处 |

**打开菜单（Tauri WebKit 注意）**

现有 Radix 经验（`surface.ts` / `panel.ts`）：原生 click 可能被 titlebar drag 吞掉。右键推荐：

```ts
// 伪代码 — 实现时以 pointer + contextmenu 事件合成 + 短 pause 等 portal
async function openContextMenu(hostSelector: string): Promise<void> {
  const host = await browser.$(hostSelector)
  await host.waitForExist({ timeout: 15000 })
  await browser.execute((el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }))
    el.dispatchEvent(new MouseEvent('contextmenu', opts))
  }, host)
  await (await browser.$('[data-testid="context-menu-content"]')).waitForExist({ timeout: 5000 })
}

async function clickContextMenuItem(itemId: string): Promise<void> {
  const item = await browser.$(`[data-testid="context-menu-item-${itemId}"]`)
  await item.waitForExist({ timeout: 5000 })
  await browser.execute((el: HTMLElement) => el.click(), item)
  // menu should dismiss
  await browser.waitUntil(
    async () => !(await (await browser.$('[data-testid="context-menu-content"]')).isExisting()),
    { timeout: 5000 },
  )
}
```

**剪贴板读回（自动化）**

- 优先：动作后读 **可观测 UI**（quote → composer textarea 内容）。
- 系统 clipboard：`browser.execute` 读 `navigator.clipboard.readText()` 在 Tauri 权限下可能失败 → 失败则降级为「菜单项存在 + 点击不抛错」，细节交给 L4。

**会话 / 消息 fixture**

| 需要 | 做法 |
|------|------|
| 有 tab 的 chat 会话 | `createChatSessionForE2e()` 或 `sendChatMessage` |
| 带 user 消息气泡 | `sendChatMessage('…')` 或 `injectServerMessage` |
| 最后一条 assistant + regenerate | inject assistant message；regenerate 用 harness 或仅断言 disabled 态 |
| Code + cwd | `createCodeSessionForE2e(FIXTURE)` + `e2e/fixtures/sample-project` |
| Diff 行 | 现有 `git-workspace` + `simulateAgentWriteFinished` / `diff-workspace` 路径 |
| Checkpoint | `seedCheckpoints` |
| Tool / subAgent | `seedAgentCollaboration` |

### 4.2 L1 Smoke — 菜单可打开

文件建议：`e2e/specs/context-menu-smoke.spec.ts`  
`describe('context menu smoke @context-menu @smoke @core', …)`

| ID | 场景 | 步骤摘要 | 断言 |
|----|------|----------|------|
| CM-S1 | Message 菜单 | chat 会话 + 消息 → 右键 `message-context-menu` | content 出现；至少含 `message.copy`、`message.quote` |
| CM-S2 | Session tab 菜单 | ≥1 tab → 右键 `session-tab-container` 内 host | 含 `sessionTab.rename`、`sessionTab.close`；无空菜单 |
| CM-S3 | File tree 菜单 | code 会话 + Files 面板 → 右键文件节点 | 含 `file.copyName` 或 `file.open`；kind=`fileEntry` |
| CM-S4 | Settings 偏好区 | 打开 Settings → General | `context-menu-settings` 存在；至少一种 kind 列表有 item |
| CM-S5 | 空菜单不漏 OS 菜单 | （若有稳定空区）右键 | **不**出现 `context-menu-content`；且不崩溃（document 仍可交互） |

### 4.3 L2 Core — 动作与危险路径

文件建议：`e2e/specs/context-menu-core.spec.ts`  
`describe('context menu core @context-menu @core', …)`

| ID | 场景 | 步骤摘要 | 断言 |
|----|------|----------|------|
| CM-C1 | Quote 插入 | 右键消息 → `message.quote` | composer textarea 出现 `> …` 引用块（insert，非整框替换） |
| CM-C2 | Tab rename | 右键 tab → rename → 填名保存 | tab 文案更新；`RenameSessionDialog` 关闭 |
| CM-C3 | Tab close = 删除 | 多开 2 tab → 右键 close 其中一个 | tab 数 −1；该 session 从 open 列表消失（Path A） |
| CM-C4 | 多删确认 / 取消 | ≥2 tab → `deleteOthers` 或 `deleteAllOpen` | 出现 `ConfirmDeleteSessionsDialog`；**Cancel** 后 tab 数不变 |
| CM-C5 | 多删确认 / 确认 | 同上 → 确认 | 仅保留预期 tab（单测已有，e2e 验真弹窗链路） |
| CM-C6 | Prefs 隐藏 | Settings 关掉 `message.quote` → 回 chat 右键 | 菜单 **无** `message.quote`；仍有 `message.copy` |
| CM-C7 | Prefs 重置 | Reset → 再右键 | `message.quote` 恢复 |
| CM-C8 | History 行 | Account → History → 右键一行 | 含 open/rename/delete；open 能回主界面 |
| CM-C9 | modal 不卡死 | 打开 rename 弹窗后取消 | body 可点 titlebar / 新会话；无永久 pointer-events 死锁 |

**设计已点名的 optional E2E：** tab menu → multi-delete **cancel** → 对应 **CM-C4**（优先落地）。

### 4.4 L3 Panel — Code 工作区

文件建议：`e2e/specs/context-menu-panel.spec.ts`  
`describe('context menu panel @context-menu @panel', …)`

| ID | 场景 | 步骤摘要 | 断言 |
|----|------|----------|------|
| CM-P1 | File open | 右键 `README.md` → open | 预览/选中态变化（与左键 open 一致） |
| CM-P2 | Copy relative path | copyRelativePath | 若 clipboard 可读则匹配 `README.md` 相对路径；否则点击成功 + 无 toast 错误 |
| CM-P3 | openContainingFolder | 点击 | 无 `pathOutsideCwd` toast；**Finder 是否前置仅 L4 验** |
| CM-P4 | Diff file 菜单 | 有 diff 后右键 `diff-file` | 含 `diffFile.copyPath` / toggle 类条目 |
| CM-P5 | Checkpoint | seedCheckpoints → Timeline 右键 | 含 `checkpoint.copyId`；revert 危险项存在（真 revert 可用现有 H8 语义） |
| CM-P6 | Terminal chrome | 打开 terminal 面板 → 右键 cwd chrome | 含 `terminal.copyCwd` / `restart` 等 |
| CM-P7 | Terminal canvas | 右键 xterm 区域 | `controlled-context-menu-content` 或同等；含 paste / copySelection（选区可空则 copy 禁用） |
| CM-P8 | Nesting | inject 含 code fence 的 assistant → 右键代码区 vs 气泡空白 | 内层 `codeBlock.copy`；外层 `message.*` |

### 4.5 明确不做（或降级）的自动化

| 项 | 原因 | 归宿 |
|----|------|------|
| 系统 Finder 前置 | 无法稳定 assert 外部 app | L4 |
| 系统剪贴板跨 app 粘贴 | 权限/竞态 | L4；e2e 只验 UI 副作用 |
| regenerate 真打 LLM | 付费 / 慢 | `@live` 可选或 harness stub |
| `CONTEXT_MENUS=false` 全 UI | 需改源码重建 | 单测 feature-off + 一次手工 rollback |
| Windows 路径 | 当前 macOS 开发机 | 另列平台矩阵 |

---

## 5. 手工真机清单（L4）

在 **`yarn tauri dev`**（或与 e2e 同版本 debug 包）上逐项勾选。语言建议先 **zh-CN** 再抽查 en。

### 5.1 启动与布局

- [ ] 冷启动进入 `#/app`，titlebar / session 正常  
- [ ] `CONTEXT_MENUS` 默认 true：主要表面右键出 **应用内** 菜单，非仅 OS 菜单  

### 5.2 Chat / Message（P0）

- [ ] 用户消息：Copy / Quote / Copy ID  
- [ ] Quote 后 InputBar **光标处插入** `> …`，不抹掉已有草稿  
- [ ] 最后一条 assistant：Regenerate 可见；turn running 时 disabled + reason  
- [ ] 右键代码块：Copy code；右键气泡外围：message 菜单（嵌套）  
- [ ] 错误态：Copy debug bundle 与既有按钮一致（脱敏）  

### 5.3 Session tab / History（P0，Path A）

- [ ] 单 tab close：会话删除，与 X 一致  
- [ ] Rename：Modal 可编辑保存  
- [ ] delete others / to the right / all open：**确认框 count 正确**；取消无副作用；确认后集合正确  
- [ ] 仅 1 个 open tab 时危险项 hidden/disabled 符合实现  
- [ ] History：open / rename / delete  

### 5.4 Files / Preview（P0–P1）

- [ ] copy path / relative / name  
- [ ] **在项目内** open containing folder → Finder 打开正确目录  
- [ ] （若可构造）路径越界 toast，不打开任意绝对路径  
- [ ] Preview chrome 菜单；iframe 内右键不破坏布局  

### 5.5 Diff / Timeline / Terminal（P1）

- [ ] Diff 文件/hunk copy；collapse/showFull 与菜单一致  
- [ ] Checkpoint revert 危险样式 + 确认/执行  
- [ ] Terminal chrome：restart / change folder / copy cwd / open files  
- [ ] Terminal **canvas**：copy selection（先选中文字）、paste；关闭后 **xterm 焦点恢复**  

### 5.6 Settings lists + prefs（P2 + 横切）

- [ ] Agent / Skill / MCP / Plugin 卡片右键 = 与 kebab 同对话框  
- [ ] General → Context menu：隐藏 item → 对应表面消失  
- [ ] 上下移动顺序 → 菜单顺序变化  
- [ ] Reset 恢复默认  
- [ ] 隐藏全部可见项后：该 kind 右键 **不出现空壳菜单**  

### 5.7 回归与破坏性

- [ ] 打开菜单后点 Modal，关闭 Modal，界面可继续点（无 pointer-events 死锁）  
- [ ] 命令面板 ⌘K、slash、现有 e2e gate 场景无回归  
- [ ] 右键 titlebar 空白不破坏拖拽（tab 区域 `data-tauri-drag-region` 行为符合预期）  

---

## 6. 执行 Runbook

### 6.1 准备

```bash
# 与 e2e 一致的 debug 二进制（当前 dev 已 build 过可跳过）
yarn tauri build --debug
# 或: cd src-tauri && cargo build

# 确认 :1420 无「非 hip」占用
# 可选固定数据目录便于调试
export E2E_DATA_DIR=/tmp/hip-e2e-context-menu
```

### 6.2 自动化命令（落地后）

```bash
# 仅 context-menu 相关
E2E_GREP=@context-menu yarn test:e2e

# 建议并入的预发闸门
yarn test:e2e:gate

# 单文件调试
yarn test:e2e --spec e2e/specs/context-menu-smoke.spec.ts

# 失败截图
ls /tmp/hip-e2e-screenshots
# 或 E2E_SCREENSHOT_DIR=./tmp/e2e-shots
```

### 6.3 推荐执行顺序（合并后回归）

1. `yarn test` 中与 context-menu 相关的 unit（已绿则 skip 全量）  
2. `E2E_GREP=@context-menu yarn test:e2e`  
3. `yarn test:e2e:gate`（防回归）  
4. L4 手工清单 §5.2–5.3 + §5.7（必做）；其余 P1/P2 按风险抽测  

### 6.4 手工真机

```bash
yarn tauri dev
# 使用 e2e/fixtures/sample-project 作为 code 工作区
# 勾选 §5 清单；缺陷记：表面 / kind / item id / 复现步骤 / 截图
```

---

## 7. 实现任务拆分（落地自动化时）

| Task | 内容 | 依赖 | 建议 tag |
|------|------|------|----------|
| T1 | `e2e/helpers/context-menu.ts` | — | — |
| T2 | `context-menu-smoke.spec.ts` CM-S1–S4 | T1 | `@smoke @core` |
| T3 | CM-C1 quote + CM-C4 multi-delete cancel | T1, hooks | `@core` |
| T4 | CM-C2 rename + CM-C3 close + CM-C9 modal | T1 | `@core` |
| T5 | CM-C6/C7 prefs hide/reset | T1, settings helpers | `@core` |
| T6 | CM-C8 history | T1, history helper | `@core` |
| T7 | panel CM-P1–P3 file tree | T1, code surface | `@panel` |
| T8 | CM-P4–P5 diff/checkpoint | git helpers | `@panel` |
| T9 | CM-P6–P7 terminal | panel helper | `@panel` |
| T10 | CM-P8 nesting | inject message | `@panel` 或 `@core` |
| T11 | 更新 `e2e/README.md` tags 表 + 本方案链接 | 文档 | — |
| T12 | （可选）gate 文档声明 context-menu 已纳入 | — | — |

**建议第一批 PR：** T1 + T2 + T3（设计已点名 cancel multi-delete）+ T11。  
**第二批：** T4–T6。  
**第三批：** T7–T10 `@panel`。

---

## 8. 通过标准（Done）

### 自动化 Done

1. 新增 helper 稳定打开 Radix ContextMenu（titlebar / drag 区域不 flake 于 3 次重试策略内）。  
2. L1 全部绿；L2 至少 **CM-C1、CM-C4、CM-C6** 绿。  
3. `yarn test:e2e:gate` 全绿（含既有 harness）。  
4. 失败时有 PNG（现有 `afterTest` 钩子）。  

### 手工 Done（发版 / 大合并）

5. §5.2、§5.3、§5.7 全勾。  
6. openContainingFolder 在 macOS 上至少成功 1 次（项目内路径）。  
7. Terminal canvas 焦点恢复无「菜单关了但键入无效」。  
8. 无 body 永久不可点。  

### 缺陷分级

| 级别 | 例子 | 处理 |
|------|------|------|
| P0 blocker | 菜单打不开；bulk delete 无确认；close 删错会话 | 修后再合/发 |
| P1 | quote 覆盖草稿；prefs 不生效；嵌套总是外层 | 修后合 |
| P2 | 文案、图标、顺序微调；clipboard assert flake | 可记 issue |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Titlebar drag 吞右键 | 合成 `contextmenu`；tab 已设 `data-tauri-drag-region` 策略；重试 |
| 共享单进程 app 状态污染 | 每 file 自建 session；危险操作后重建 tab |
| 剪贴板不可读 | 改断言 UI 副作用 |
| xterm 不进 DOM 选区 | canvas 用例只做 open + 条目；选区走 L4 |
| open folder 假绿 | e2e 只禁 toast 错误；Finder 必 L4 |
| 中英文 i18n | 断言用 `data-testid`，不依赖 label 字符串 |
| 二进制陈旧 | 改前端后 `tauri build --debug` 或 dev 同源 Vite；**改 Rust 必须 rebuild** |

---

## 10. 与既有文档关系

| 文档 | 关系 |
|------|------|
| `e2e/README.md` | 运行方式 / tags / `__hipE2E`；落地后补 `@context-menu` |
| 设计 doc（context menu） | 产品语义 Path A、prefs、terminal spike；E2E 仅 optional cancel multi-delete → 本方案扩展为完整矩阵 |
| `docs/superpowers/specs/2026-07-11-command-palette-*` | 不交叉；回归时 gate 一并跑 |
| 单测 `src/components/context-menu/**` | L0；本方案不替代 |

---

## 11. 附录：Kind → 建议 selector 速查

| Kind | 打开目标 |
|------|----------|
| message | `[data-testid="message-context-menu"]` 或 `[data-context-menu-kind="message"]` |
| codeBlock | 代码块宿主 `[data-context-menu-kind="codeBlock"]` |
| sessionTab | `[data-testid="session-tab-container"] [data-context-menu-kind="sessionTab"]` 或 container 内 trigger |
| sessionHistory | History 列表行上的 kind host |
| fileEntry | `[data-testid="file-tree"] [data-context-menu-kind="fileEntry"]` |
| filePreview | `[data-context-menu-kind="filePreview"]` |
| toolCall / subAgent | `[data-context-menu-kind="toolCall"]` / `subAgent` |
| diffFile / diffHunk | `[data-testid="diff-file"]` 内 kind |
| checkpoint | Timeline checkpoint 行 |
| terminal chrome | `[data-testid="terminal-chrome"]` 或 cwd 条 |
| terminal canvas | `[data-testid="terminal-xterm"]` |
| settings lists | 各 card 上 kind host |
| prefs UI | `[data-testid="context-menu-settings"]` |

---

## 12. 下一步（执行开关）

按本方案落地时推荐顺序：

1. **实现 T1–T3** 并跑通 `E2E_GREP=@context-menu`  
2. 补 T4–T6 后把 `@context-menu` 中带 `@core` 的路径视为 gate 友好  
3. 完成一次 **L4 手工** 并归档勾选结果（可贴 PR 描述）  
4. 视 flake 率再决定是否把 CM-P* 拉进 nightly  

若只需验证「当前 dev 是否可发」，可 **先做 §6.4 + §5 手工**，自动化并行补。

---

## 13. 落地记录（2026-07-12）

| 项 | 状态 |
|----|------|
| T1 `e2e/helpers/context-menu.ts` | ✅ |
| T2 smoke CM-S1–S4 | ✅ 真机绿 |
| T3 core CM-C1 + CM-C4 | ✅ 真机绿 |
| T4 CM-C2 rename / CM-C3 close / CM-C9 modal | ✅ 真机绿 |
| T5 CM-C6/C7 prefs hide + reset | ✅ 真机绿 |
| T6 CM-C8 history open | ✅ 真机绿 |
| 命令 | `E2E_GREP=@context-menu yarn test:e2e --spec e2e/specs/context-menu-smoke.spec.ts --spec e2e/specs/context-menu-core.spec.ts` |

**附带修复（阻塞真机白屏）：** 栈合并后 `index.ts` 再导出 `applyOrderByIds`，但 `registry.ts` 丢失实现 → ESM 链接失败 → 整站白屏。已恢复 `applyOrderByIds` + `applyPrefs(..., kind)` + `buildContextMenuItems` 传 `req.kind`。

**E2E harness 修复：** `SettingsPage.backButton` 改为 `titlebar-back`（原先错误的 `settings-back`）。
