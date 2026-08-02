# 右侧面板 Titlebar 左槽（Context Slot）Spec

> 状态：草案 v1 · 2026-08-02  
> 范围：右侧 rail 打开时，titlebar 行左半区（`flex-1` 空缺）的统一利用  
> 相关实现：`ArtifactPanel.tsx` / `PreviewPanel.tsx` / `PanelTabBar.tsx` / `KnowledgeOutlinePanel.tsx` / `TerminalFilesPanel.tsx` / `titlebarChrome.ts`  
> 不改动：`PanelTabBar` 右缘 dropdown 形态、`PanelToggle` 折叠位置、tab 集合与 gating

---

## 1. 问题摘要

| # | 问题 | 表现 | 影响 |
|---|------|------|------|
| P1 | Code 面 titlebar 左半完全空 | `ArtifactPanel` 仅 `<div className="min-w-0 flex-1" />` | 窄栏上近半行仅作拖拽，信息密度低 |
| P2 | 各 surface 左槽策略不一致 | Code 空；Chat Files 有动作；KB/TM 静态标题 | 用户无法形成「左=上下文、右=页切换/折叠」心智 |
| P3 | 子 chrome 重复占高 | Terminal cwd 行、HTML path 条、Changes 内 toolbar、draft FileTree header 各占 ~32px | titlebar 空着，下面又多一行夹层 |
| P4 | Chat 非 Files tab 左槽仍空 | Outline / Sources 无左槽内容 | 与 Files 体验割裂 |
| P5 | 窄栏（≥350px min）放不下长路径/多按钮 | 无统一截断与溢出规则 | 若直接塞内容会挤爆右缘控件 |

**已有正解（应对齐，不推倒）**：

- Chat `PreviewPanel` Files：左槽 = Copy / Download + 文件名或 artifact switcher + 剩余 drag fill  
- KB / Terminals：左槽 = 面板标题，右 = 折叠  
- Tabs 故意做成右缘 dropdown，避免水平 tab strip 在窄栏裁切（`PanelTabBar` 注释）

---

## 2. 目标与非目标

### 2.1 目标

1. **统一槽位模型**：所有右栏 surface 共用同一 titlebar 骨架：`[ Context Slot | Tab▾? | Collapse ]`。  
2. **按 tab 填上下文**：左槽展示「当前页在看什么 + 最高频 1–2 个动作」，而不是再贴一层静态「面板名」（tab 名已在右缘 trigger 上）。  
3. **消夹层**：能上提到 titlebar 的路径/cwd/统计，优先上提并删掉（或收薄）子 chrome 行。  
4. **保留拖拽**：交互控件 `data-tauri-drag-region="false"`；剩余空白仍可拖窗口。  
5. **窄栏优先**：350px min 可用；溢出截断 / 进 ⋯，titlebar **永不换行**。

### 2.2 非目标

- 不把 tab 改回水平 strip。  
- 不把 `BranchSwitcher` 搬回面板 titlebar（已迁到 code composer；见 `InputBar.test`）。  
- 不在 titlebar 放 Commit / 审查主 CTA（Changes 内 toolbar 与 v2 spec 保留）。  
- 不改 Knowledge / Terminals 的「无 tab」信息架构（仅对齐槽位样式与可选增强）。  
- 不做全局搜索框、不塞 session 标题（主栏 MainToolbar 职责）。

---

## 3. 信息架构：Context Slot

### 3.1 骨架（所有 surface）

```
┌─ Right rail titlebar h=--titlebar-height ─────────────────────┐
│ [ Context Slot ………… flex-1 min-w-0 ]  [ Tab▾? ] [ Collapse ] │
└───────────────────────────────────────────────────────────────┘
```

| 区 | 职责 | 组件 |
|----|------|------|
| **Context Slot** | 当前页上下文 + ≤2 个主动作 | 新建 `PanelContextSlot`（按 surface+tab 渲染） |
| **Tab▾** | 切换功能页 | 现有 `PanelTabBar`（仅 code/chat） |
| **Collapse** | 收起右栏 | 现有 `PanelToggle slot="panel"` |

KB / Terminals：无 `Tab▾`，右缘仅 Collapse；左槽继续放标题（或 §5.4 增强）。

### 3.2 槽位内容原则（优先级）

1. **Identity**（必选当有数据）：当前对象名 / 路径 basename / 计数摘要  
2. **Primary actions**（0–2）：复制、下载、刷新、打开外部…  
3. **Overflow**（可选）：放不下进 `⋯`，不换行  
4. **Drag fill**：末尾 `flex-1 min-w-2` 可拖区域  

**禁止**放入左槽：

- 与右缘 Tab▾ 重复的「当前 tab 全称」（可省略；identity 用对象而非 tab 名）  
- 危险写操作（丢弃改动、kill all PTY）  
- 长表单 / 基线分段（Changes base toggle 留在 Changes toolbar）

### 3.3 视觉 token

对齐 `titlebarChrome.ts`：

| 元素 | 规范 |
|------|------|
| 行高 | `h-[var(--titlebar-height)]`（40 / mac 48） |
| 图标按钮 | `titlebarIconBtnClass`（28×28） |
| 文本 identity | `text-meta` truncate；路径可用 `font-mono text-caption text-ink-secondary` |
| 与主栏关系 | Code/Chat **不**加 `border-b`（保持现状，避免与子 toolbar 三明治）；KB/TM **保留** `border-b` |
| 间距 | 左槽内 `gap-0.5`；与右控件组 `gap-1`；`px-2` |

---

## 4. 分 Tab 左槽内容（Code + Chat）

### 4.1 总表

| Surface | Tab | Identity（左） | Actions（紧随） | 数据空时 | 子 chrome 调整 |
|---------|-----|----------------|-----------------|----------|----------------|
| **Code** | **Files** | 预览文件 basename；无预览则项目 root basename | Copy path；有预览且 text → Copy content；Refresh tree（draft 保留） | 「选择文件」弱文案或仅 root 名 | draft `FileTree` 顶栏 root 名可并入左槽后删重；committed 无树头不变 |
| **Code** | **Outline** | `大纲 · N`（N=user turns） | — | `大纲`（无 N） | 无 |
| **Code** | **Changes** | `未提交 · N` + 非窄栏 `+a −d` | —（审查/基线仍在 Changes toolbar） | `未提交` 或 clean 文案 | Changes 内 toolbar **去掉**左侧重复标题/统计，只留 base + 审查 + ⋯（减一行视觉噪音） |
| **Code** | **Terminal** | cwd basename（title=绝对路径） | Restart；Close | `终端` 或选文件夹引导仍在 body | **删除** `terminal-chrome` 整行，动作上提到 titlebar |
| **Chat** | **Files** | **保持现状**：artifact 名 / switcher | Copy / Download | 空 artifacts → 左槽空 + body 空状态 | 无 |
| **Chat** | **Outline** | 同 Code Outline | — | 同左 | 无 |
| **Chat** | **Sources** | `来源 · N` | — | `来源` | 无 |

### 4.2 Code · Files（重点）

```
[ 📄 path/to/File.tsx          ] [copy] [  Files ▾ ] [ × ]
  └─ truncate identity          └─ ≤2 icon btns
```

- Identity 优先 **当前预览路径**（`fsStore.preview.path`），truncate 中间或尾（与 FilePreview chrome 一致用 title 悬停全路径）。  
- 无预览：显示 **workspace root basename**（`cwd`），icon `FolderGit2` / `Folder`。  
- Actions：  
  - `Copy path`（有 path 时）  
  - `Copy content`（ready 且非 base64；与 Chat 对齐）  
  - 可选 Phase 2：`Open in default app`（HTML 等）  
- **不**在左槽放 artifact switcher（Code 有 FileTree）；Chat 继续用 switcher。  
- iframe / HTML 的 path 条：若 titlebar 已显示同一 path，body 内 `preview-chrome` **可保留**（iframe 右键落点需要 chrome，见 `FilePreview` 注释）——**路径文案可缩短为仅 mode toggle + open browser**，path 不再重复占满一行（Phase 2）。

### 4.3 Outline（Code / Chat 共用组件）

```
[ 大纲 · 12                    ] [ Outline ▾ ] [ × ]
```

- N 来自 `collectUserTurns`。  
- 不做搜索（列表短）；未来若 turns > 50 再加 filter（非本版）。

### 4.4 Changes

```
Titlebar: [ 未提交 · 3  +12 −4     ] [ Changes ▾ ] [ × ]
Body:     [ 会话起点|HEAD ] [审查] [⋯]     ← 原 toolbar 去掉左标题
```

- 统计规则对齐 Changes v2 R7：栏宽 < 420px 隐藏 `+a −d`，保留 `· N`。  
- 与 v2 spec 兼容：审查主 CTA、基线、忽略空白仍在 body toolbar。  
- 进入 commit-diff 子态时：左槽改为 `提交 · <shortSha>`（有则），否则保持未提交摘要。

### 4.5 Terminal（Code tab）

```
[ ~/proj/hip                   ] [↻] [×] [ Terminal ▾ ] [ ×折叠 ]
```

注意：titlebar 最右是 **面板折叠**；Terminal 的 **关 PTY** 用不同 icon/title，避免两个 × 语义撞车。

| 控件 | 图标 | testid | 说明 |
|------|------|--------|------|
| Restart | `RotateCcw` | `terminal-restart` | 同上提 |
| Close PTY | `Square` 或 `Power`（**不用**与折叠相同的 `PanelRightClose`） | `terminal-close` | 禁用态 closed 时 dim |
| Collapse panel | 现有 | panel toggle | 不变 |

- cwd 全路径放 `title`；展示 basename 或 `~/` 收缩（与系统一致即可）。  
- 无 cwd：左槽文案 `选择项目文件夹`（可点，触发 `pickDirectory`）或保持 body 空状态、左槽仅弱标题 `终端`。

### 4.6 Chat · Sources

```
[ 来源 · 8                     ] [ Sources ▾ ] [ × ]
```

- N = `collectConversationSearchSources` 去重后数量。

### 4.7 Knowledge / Terminals（无 tab）

保持标题左 + 折叠右。可选 Phase 2：

| Surface | 增强 |
|---------|------|
| Knowledge doc | 标题旁 `·` 大纲节点数 |
| Knowledge board | 保持 `panelTitle` |
| Terminals local | 标题旁当前浏览目录 basename |
| Terminals sftp | 标题旁 remote path basename |

本版 **P0 只统一 code/chat Context Slot**；KB/TM 仅文档约定骨架一致即可。

---

## 5. 交互与约束

### 5.1 拖拽

```
titlebar root:     data-tauri-drag-region
Context Slot 根:   data-tauri-drag-region="false"（内含按钮）
  └─ trailing fill: data-tauri-drag-region（可拖）
右缘控件组:        data-tauri-drag-region="false"
```

与 `PreviewPanel` 现实现一致。

### 5.2 窄栏（350–420px）

| 宽度 | 行为 |
|------|------|
| ≥ 420 | identity 最大约 `max-w` 到剩余空间；统计全显 |
| 350–419 | 隐藏次要统计；identity `max-w-[8rem]`～`10rem` truncate；第二 action 进 ⋯（若有） |
| 任何 | Tab▾ + Collapse **永不**被挤没（`shrink-0`） |

测量：复用 Changes 的 `rootRef` + ResizeObserver 模式，或 titlebar 级一次观测下发 `narrow`。

### 5.3 无障碍 / i18n

- Identity 纯展示时用 `span`；可点动作用 `button` + `title` + 既有 `t()` key。  
- 新增 key 前缀建议：`artifact.panelSlot.*`（如 `uncommittedCount`、`sourcesCount`、`outlineCount`）。  
- 右缘 `PanelTabBar` `aria-label` 保持。

### 5.4 状态来源（只读订阅，不新建 store）

| 字段 | 来源 |
|------|------|
| activeTab / chatActiveTab | `uiStore` |
| preview path/content | `fsStore` + `useFsScope` |
| cwd / root | session / draft scope |
| turns N | `useActiveMessages` + `collectUserTurns` |
| sources N | `collectConversationSearchSources` |
| diff stats / branch | `diffStore` |
| terminal status | `terminalStore` |

---

## 6. 组件拆分建议

```
src/components/artifact/
  PanelContextSlot.tsx          # surface + tab → 左槽
  panelContextSlotModel.ts      # 纯函数：输入 state → { identity, actions[] }
  ArtifactPanel.tsx             # 空 flex 替换为 <PanelContextSlot surface="code" />
  PreviewPanel.tsx              # Files 特例可迁入 Slot，或 Slot 内委托现有逻辑
  TerminalView.tsx              # 删除顶栏 chrome；动作由 Slot 渲染（props/callbacks 或小 hook）
  ChangesView.tsx               # toolbar 去左标题
```

**测试**：

- `PanelContextSlot.test.tsx`：各 tab identity / 空态 / narrow  
- 更新 `ArtifactPanel.test.tsx`：不再断言「无 panel-title」；改为断言 `panel-context-slot`  
- `TerminalView`：chrome 行不存在；restart/close 在 titlebar  
- `ChangesView`：toolbar 无重复「未提交」文案  
- `PreviewPanel`：Files 行为回归（copy/download/switcher）

---

## 7. 布局示意

### 7.1 Code · Files（有预览）

```
┌──────────────────────────────────────────┐
│ App.tsx          [copy][copy路径] Files▾ ×│
│──────────────────┬───────────────────────│
│ FilePreview      │ FileTree              │
│                  │                       │
└──────────────────┴───────────────────────┘
```

### 7.2 Code · Changes

```
┌──────────────────────────────────────────┐
│ 未提交 · 3 +12 −4              Changes▾ ×│
│ 会话起点|HEAD          [审查] [⋯]        │
│ M src/foo.ts …                           │
└──────────────────────────────────────────┘
```

### 7.3 Code · Terminal

```
┌──────────────────────────────────────────┐
│ ~/hip              [↻][⏻]    Terminal▾ ×│
│ $ …                                      │
└──────────────────────────────────────────┘
```

### 7.4 Chat · Outline / Sources（补齐空缺）

```
┌──────────────────────────────────────────┐
│ 大纲 · 5                       Outline▾ ×│
│ 1  fix login…                            │
└──────────────────────────────────────────┘
```

---

## 8. 分阶段

| Phase | 范围 | 验收 |
|-------|------|------|
| **A** | 骨架 + Code/Chat 各 tab identity（无动作上提） | 左槽不再空白；KB/TM 不动 |
| **B** | Code Files 动作；Chat 非 Files 计数；Terminal chrome 上提 | 少一行夹层；E2E/单测绿 |
| **C** | Changes 标题上提并去重 toolbar；窄栏规则；HTML path 去重 | 与 changes-panel-v2 无冲突 |
| **D** | KB/TM 可选增强；i18n 全语言 | 视觉一致 |

**建议默认落地顺序 A→B→C**；D 可选。

---

## 9. 风险与决策记录

| 风险 | 缓解 |
|------|------|
| 双 ×（关终端 vs 折叠面板） | Close PTY 换图标 + 不同 title；折叠保持 `PanelRightClose` |
| 统计与 Changes toolbar 重复 | Phase C 必须删 body 左侧标题 |
| Identity 与 Tab 名重复（Outline 左写「大纲」右也写 Outline） | 可接受：左带计数，右是导航；或左仅 `N turns` 不写 tab 名——**推荐左：短标签+计数，右：完整 tab 名** |
| 拖拽面积变小 | trailing `flex-1` fill 必留；identity 可拖（纯文本 span 可放在 drag 子区外需 false） |
| BranchSwitcher 回归压力 | 明确非目标；分支在 composer |

**决策 D1**：左槽是 **上下文**，不是第二套 tab。  
**决策 D2**：能上提的路径/cwd 优先上提，子 chrome 只保留「必须落在内容区」的控件（diff 基线、iframe 右键条）。  
**决策 D3**：Chat Files 已有实现视为参考实现，Slot 抽取时行为零回归。

---

## 10. 成功标准

1. Code 任意可见 tab：titlebar 左半有可读 identity（或明确空态文案），无「大块死白」。  
2. Chat Outline/Sources：同 1。  
3. Chat Files：copy/download/switcher 行为与现网一致。  
4. Terminal tab：无第二行 cwd chrome；重启/关闭仍可用。  
5. 350px 宽：Tab▾ + 折叠可见可点；无横向滚动条出现在 titlebar。  
6. macOS：titlebar 高度与 traffic light 对齐不变；拖窗口仍可用。  
7. 单测覆盖 Slot 矩阵；相关旧测已更新。

---

## 11. 附录：现状对照

| Surface | 文件 | 今日左槽 | 本 spec |
|---------|------|----------|---------|
| Code | `ArtifactPanel.tsx:37` | 空 spacer | Context Slot |
| Chat | `PreviewPanel.tsx:77-152` | Files 有、其它空 | 全 tab Context Slot |
| Knowledge | `KnowledgeOutlinePanel.tsx:108-114` | 标题 | 保持（Phase D 可选） |
| Terminals | `TerminalFilesPanel.tsx:93-98` | 标题 | 保持（Phase D 可选） |

```
今日 Code:
  [ ========= empty drag ========= ][ Files ▾ ][ × ]

目标 Code Files:
  [ App.tsx  [copy] ~~~~drag~~~~ ][ Files ▾ ][ × ]
```
