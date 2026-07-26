# Design Spec: Chat 圆桌会议模式（Roundtable）

| Field | Value |
|-------|--------|
| **Title** | Chat Roundtable (one-shot empty-state starter) |
| **Date** | 2026-07-26 |
| **Status** | Implemented (P0–P1 + multi-round chair protocol) |
| **Audience** | hip core (React UI / domain / i18n) |
| **Reference** | Claude empty-state starters + hip Execution Mode / Effort holographic language |

---

## 1. Overview

在 **Chat 新对话空态** 提供「圆桌会议」一次启用入口：用户开启后，首条消息会附带 **带裁决权的委员会框架**。是否展开五人辩论由 **智能体判断**；简单议题 **自动降级为普通对话**。

| 项 | 决策 |
|----|------|
| **是什么** | 首条用户消息的 *advisory framing*（prompt 包装） |
| **不是什么** | 非 5 路真实 agent 并行；非常驻 session mode；不改 Permission / Execution Mode |
| **入口** | 仅 `surface === 'chat'` 的 `NewConversation`（无 session / 未产生对话） |
| **生命周期** | 空态可选 → 发送时注入 → draft reset → 入口随空态卸载 |
| **裁决权** | **智能体**；客户端不做复杂度规则 |

---

## 2. Goals & Non-Goals

### Goals（v1）

1. Chat 空态可发现的 chip + 选中后 5 顾问预览（stagger 入场）。
2. 仅在 **创建 session 的首条消息** 上注入 framing；后续回合不注入。
3. Prompt 明确 **Route first**：简单题普通答；有权衡才开会。
4. Transcript UI 展示 **用户原文** + 「圆桌」badge；wire 内容带 marker。
5. 与 slash skill / skill 参数输入 **互斥**（有 skill 查询或已选 skill 时禁用 chip）。
6. i18n（en / zh-CN / zh-TW / ja / ko）+ 纯函数单测 + 空态 UI 单测。
7. `prefers-reduced-motion` 下无额外循环动效依赖（全局 token 已兜底）。

### Non-Goals（v1）

- three.js / WebGL 圆桌装饰（可后续 P3）。
- 协议字段 `displayContent` / sidecar system inject（后续可升级）。
- Code surface、ACP 专用 UI、会话内再次开启。
- 解析 assistant 输出做五头像轮播（避免假实时辩论）。
- 全局默认写进 `hip.toml`。

---

## 3. Product semantics

### 3.1 用户意图 vs 模型行为

| 角色 | 权责 |
|------|------|
| 用户开启 chip | **邀请** 多视角审议，不是强制开会 |
| **hip（模型）** | 路由是否开会；**主持多轮讨论**；**决定回合数 N**；每轮 **阶段性结论**；**终局拍板** |
| 五顾问 | 以 **对话** 方式跨轮回应 / 反驳 / 修正，禁止一人一句走过场 |
| 系统 | 只注入框架；不客户端打分或固定 N |

### 3.2 Routing 规则（写入 frame，模型必遵）

**普通对话**（满足任一条即跳过会议）：

- 事实 / 定义 / 翻译 / 语法等单点问题
- 一步可完成、几乎无决策空间
- 闲聊、致谢、确认
- 用户已给出明确答案，只需执行或轻润色
- 信息不足时先澄清，不空开辩论

**召开会议**（存在真实权衡）：

- 多方案取舍、战略 / 产品 / 技术路径
- 明显风险、假设或受众差异
- 需要创意发散 + 落地步骤
- 错误代价高，值得多视角挑刺

默认偏 **降级**：拿不准且看起来简单 → 普通对话。

### 3.3 角色与多轮协议（仅 convened 时）

| 角色 | 职责 |
|------|------|
| **hip** | 主席 + **决策者**：定议程、定 N（2–4）、每轮阶段性结论、最终决策 |
| 战略家 | 长期目标与方向 |
| 怀疑论者 | 风险、薄弱假设、盲点 |
| 创意者 | 新颖想法与更好角度 |
| 执行者 | 实际步骤与实施 |
| 受众倡导者 | 用户 / 客户 / 观众需求 |

**讨论规则：**

1. **禁止** 五人各说一遍即收场；必须跨轮互相对话，立场可演进。
2. hip 在 Round 1 前声明 **计划回合数 N**（2–4）及每轮议程；可因共识提前闭会。
3. 每轮结束后 hip 输出 **阶段性结论**：已共识 / 仍开放 / 下一焦点。
4. 终局仅 hip 拍板（非投票平均）+ 残留分歧 + 后续步骤。

**输出骨架：** 会议规划 → Round 1…N（对话体 + Stage conclusion）→ Decision (hip) → 后续步骤。

**实现注：** 默认 **loop 引擎**（真多轮，见 [`roundtable-loop.md`](./roundtable-loop.md)）。`HIP_ROUNDTABLE_ENGINE=sim` 时回退为单 completion 模拟多轮（本文件 v1 frame）。多智能体议会 + 右侧 Agents：[`roundtable-council.md`](./roundtable-council.md)。

---

## 4. UX

### 4.1 空态

```
Mascot + Greeting
Composer (card)
RoundtableStarter   ← 仅 chat + ROUNDTABLE_STARTER
```

- **未选中**：次级 chip「圆桌会议」+ 短 hint（智能体判断是否辩论）。
- **选中**：chip active；展开 5 席位 strip（stagger）；helper 说明：简单题普通答；复杂题多轮讨论，hip 定回合数与阶段性结论并拍板。
- **禁用**：slash 查询中或已绑定 skill 参数。

### 4.2 会话内

- 入口不存在（`NewConversation` 已卸载）。
- User bubble：`stripRoundtableFrame(content)` + badge `chat.roundtable.badge`。
- Assistant：自由格式；convened 时 prompt 要求 markdown 分节。

### 4.3 动画

| 阶段 | 行为 |
|------|------|
| Chip 入场 | 复用 `animate-greeting-enter` |
| 席位 | `animate-roundtable-seat` + delay `i * 80ms` |
| 取消 / 发送后 | unmount 即可（draft reset） |

**不用** three.js（v1）。

---

## 5. Technical design

### 5.1 Wire format

```
<!--hip.roundtable.v1-->
{locale frame: routing + advisors + output contract}

---user---

{user original text}
```

| Helper | 职责 |
|--------|------|
| `buildRoundtableOutbound(text, lang)` | 合成 wire |
| `stripRoundtableFrame(content)` | UI 展示原文 |
| `isRoundtableMessage(content)` | badge |

### 5.2 State

`draftStore.Draft.roundtable?: boolean`  
`setRoundtable(on: boolean)`  
发送创建 session 后 `reset()` 清除。

### 5.3 send path

`SessionService.sendMessage`：仅当 **无 activeSessionId** 且 `draft.mode !== 'project'` 且 `draft.roundtable` 且 `text` 非空时包装；然后 `createSession` + `reset`。

### 5.4 Files

| Path | Role |
|------|------|
| `docs/design/roundtable-mode.md` | 本 spec |
| `src/lib/roundtable.ts` | 纯函数 + frame |
| `src/lib/roundtable.test.ts` | 单测 |
| `src/store/draftStore.ts` | `roundtable` |
| `src/components/chat/craftFeature.ts` | `ROUNDTABLE_STARTER` |
| `src/components/chat/RoundtableStarter.tsx` | 空态 UI |
| `src/components/chat/NewConversation.tsx` | 挂载 |
| `src/components/chat/MessageBubble.tsx` | strip + badge |
| `src/domain/sessionService.ts` | 注入 |
| `src/i18n/*` | 文案 |
| `src/styles/tokens.css` | seat keyframes |

### 5.5 Feature flag

```ts
export const ROUNDTABLE_STARTER = true
```

---

## 6. Success criteria

- [x] 新 Chat 空态可见圆桌 chip；Code 不可见  
- [x] 开启后发送：wire 含 marker；UI 仅原文 + badge  
- [x] 简单题 prompt 要求普通答；复杂题可召开  
- [x] 发送后空态消失，无法在本会话再次开启入口  
- [x] skill / slash 互斥  
- [x] 五语 key 对齐  

---

## 7. Follow-ups (optional)

- P2: sidecar inject / `displayContent` 协议字段  
- P2: assistant meta `roundtable: skipped | convened | rounds=N`  
- P2: **真多轮 LLM loop** — 见 **[`roundtable-loop.md`](./roundtable-loop.md)**（已实现 P2a–P2c）  
- P3: **多智能体议会 Council** — 见 **[`roundtable-council.md`](./roundtable-council.md)**（真 agent、反驳边、投票、右侧 Agents）  
- P3+: three.js 空态装饰环（可选）  

