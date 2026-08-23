# IM 连接器（双向对话）—— 执行计划

> 系列：`im-connectors` ｜ spec：`im-connectors-spec.md` ｜ 预览：`im-connectors-preview.html`
> 按 spec Key Decisions（KD-1..15）落地。产品范围：**去掉微信**；**一步到位做双向对话**（飞书 / 企业微信 / 钉钉，三平台官方长连接）。
> **本计划不修改产品代码**；实施时另开 PR。

---

## 0. 范围与原则

- 交付 = **IM 双向对话**：IM 发消息 → hip 智能体执行 → 自动回复；HITL 以 IM 交互卡片完成。不含微信、不含桌面任务主动推送（Future Work）、不含流式。
- **网关整体在 sidecar**（`packages/sidecar/src/im/`），**Rust 零改动**；协议只做增量（`im:*` 消息 + `session:created.origin` 可选字段），不破坏既有消息与路由规则。
- 凭证存 `~/.hip/config/im-connectors.json`（sidecar 写，chmod 0600，`HIP_IM_PATH` 覆盖，与 `HIP_PLUGINS_PATH` 同构）。不进 hip.toml、不进 auth.json。
- 新直接依赖仅两个官方 SDK：`@larksuiteoapi/node-sdk`、`dingtalk-stream-sdk-nodejs`（sidecar）。企微走裸 `ws`（已有依赖）。**不引入任何其它 npm 包**。
- 测试纪律：每 PR `yarn tsc` + 相关 `yarn test` + sidecar 测试；**任何平台连接/发送必须可注入 mock**，单测不打外网。付费 LLM 护栏按 `CLAUDE.md`。
- i18n：引入 key 的 PR 一次补齐 zh-CN/en/zh-TW/ja/ko（`src/i18n/`）。
- 安全底线（KD-7/8/11）：allowlist 默认空、权限模式默认 confirm、去重/限速/排队在网关层强制，**任何 PR 不得放松默认值**。

---

## PR-1 · 协议类型 + 存储 + 网关骨架 + 配置 CRUD

**依赖：** 无
**验收：** sidecar 单测全绿：`im:config:upsert` 写盘（0600 权限断言）、`list` 不回传 credentials、损坏文件→空列表、`im:config:delete`；`message-route` classify 对 `im:config:list:result` 为 unicast、对 `im:gateway:status` 为 broadcast；`session:created` 增补 origin 字段后既有测试全绿。`yarn tsc` 通过。

### 任务

1. `packages/protocol/src/messages.ts`：
   - ClientMessage 增：`im:config:list` / `im:config:upsert`（payload = 连接器记录，credentials 完整）/ `im:config:delete` / `im:test` / `im:parked:list` / `im:parked:resolve`；对应 `:result` 各一条。
   - ServerMessage 增：`im:gateway:status`（broadcast：`{connectorId, status, lastError?}`）、`im:parked:updated`（broadcast）。
   - `session:created` 增可选 `origin?: { kind: 'im'; platform; connectorId; chatId; chatName? }`（只追加字段，不改既有消费）。
   - 导出共享类型：`ImPlatform`、`ImConnectorRecord`、`ImParkedEntry`、`ImPermissionMode`（`confirm | auto`）。
2. `packages/sidecar/src/im/types.ts`：`ImMessageEvent`、`ImChatTarget`、`ImOutbound`（text/markdown/card）、`CardPatch`、`SendResult`、`BaseImAdapter` 契约（spec「统一事件契约」）。
3. `packages/sidecar/src/im/store.ts`：读/写 `~/.hip/config/im-connectors.json`（`HIP_IM_PATH` 覆盖）；写文件后 `chmodSync 0o600`；`listPublic()`（剔除 credentials，输出 `hasCredentials: boolean`）；`upsert`（id 不存在则生成 uuid）；`remove`。参照 `plugin-store.ts`。
4. `packages/sidecar/src/im/gateway.ts`：Gateway 骨架——`register(adapter)` / `setAdapterStatus`（广播 `im:gateway:status`）/ 流水线纯逻辑函数（**先写纯函数**，adapter 未接）：
   - `dedupeFilter`（`(connectorId,messageId)` LRU，5min TTL）
   - `rateLimitFilter`（`(connectorId,senderId)` 滑窗 10 条/分）
   - `authorize`（allowlist 判定 + park 落库 + 广播 `im:parked:updated`）
   - `resolveSessionId`（`im:{platform}:{chatId}`）
   - `frameInbound`（`[平台 · 会话名 · 发送者] 文本`）
   各函数独立单测（含 60s 内 11 条 → 第 11 条被限、重复 id 丢弃、未授权进 park）。
5. `packages/sidecar/src/im/handlers.ts`：`im:config:*` / `im:parked:*` 消息处理；接入 `main.ts` 的消息分发（`isSessionMessage` 旁新增 `isImMessage` 分支或按现有 handler 注册方式）。
6. `packages/sidecar/src/server/message-route.test.ts`：补 `im:*` classify 断言。

**不包含：** 任何平台适配器、任何 UI。

---

## PR-2 · 飞书适配器 + 会话桥全链路（参考实现平台）

**依赖：** PR-1
**验收：** sidecar 单测（注入 mock WSClient/EventDispatcher，不打外网）：入站文本 → 去重/限速/授权流水线 → `SessionManager.createSession` 调用断言（origin、permissionMode=confirm、标题）；会话回合完成 → `adapter.send` 收到 markdown 回复；`permission:request`（IM 会话）→ `send` 收到含 3 按钮的卡片；模拟卡片按钮入站 → `permission:respond` 被调用 + `updateCard` 被调用；未授权入站 → 无会话创建 + park 记录；running 中入站 → 排队/满队回复语义。`yarn tsc` 通过。

### 任务

1. `packages/sidecar/src/im/adapters/base.ts`：`BaseImAdapter` 实现基类（`setMessageHandler` / 状态回调 / 幂等 disconnect）。
2. `packages/sidecar/src/im/adapters/feishu.ts`：
   - 依赖 `@larksuiteoapi/node-sdk`（sidecar package.json 新增）。
   - `connect()`：`Lark.WSClient({appId, appSecret})` + `EventDispatcher` 注册 `im.message.receive_v1`、`card.action.trigger`；连接状态回调网关。
   - `handleMessage` 映射：`ImMessageEvent`（message_id 去重键、chat_id、sender_id、文本抽取、`chatKind` 由 chat_type 判定、卡片按钮 → `interactive.actionId`）。
   - `send()`：`im.v1.message.create`（receive_id_type=chat_id；文本 / `lark.md` post 渲染）；`updateCard()`：`im.v1.message.patch`。
   - 事件处理第一行 = 网关入队（满足 3s ack），异常捕获吞掉重推。
   - 全部经构造注入的 `larkClient` 接口（`LarkImClient` 最小面），单测 mock。
3. `packages/sidecar/src/im/bridge.ts`（会话桥，网关流水线第 5-9 步）：
   - `ensureSession(ctx, connector, event)`：`SessionManager.createSession`（标题 = 会话名 + `（IM）`；config：permissionMode = 连接器设置、agent/模型用 sidecar 默认解析路径——与 CLI/automation 的 active model 解析对齐，若 sidecar 无直接解析器则复用 automation run 的解析函数并抽取共享）。
   - `onTurnComplete`：监听回合完成（复用 `SessionLifecycleContext` 的 send/事件流，或 session-manager 的 completion 回调——**实施时先查现有回合完成钩子**，不得新增第二套监听机制）→ 取最终助手文本 → `adapter.send(markdown)`；`error` → 发送错误摘要。
   - `onPermissionRequest`：`permission:request`（IM 会话）→ `adapter.send(卡片)`；卡片按钮入站 → `permission:respond`（kind 映射：allow_once/allow_always/reject_once）+ `updateCard(已处理)`。
   - busy 队列：会话 running 排队深度 1（内存 Map），满队回复模板。
4. `packages/sidecar/src/im/gateway.ts`：接通流水线（PR-1 纯函数 + bridge + adapter 生命周期）；`im:test` handler（向「自己的单聊」发送测试消息——飞书用 receive_id_type=open_id 的当前 bot？不可得时改为向最近一次入站会话发送；**实现时以平台能力为准**，测试按钮语义 = 「向已交互过的会话发一条」）。
5. 单测覆盖验收清单（mock adapter + mock ctx）。

**不包含：** 企微/钉钉适配器、UI。

---

## PR-3 · 设置页 UI + i18n

**依赖：** PR-2（网关可跑）
**验收：** `vitest`（catalog 纯函数、表单校验、store、组件状态）；手测：设置 → IM 连接器页 → 添加飞书连接器（分步弹窗）→ 保存 → 状态点转「已连接」；「发送测试消息」IM 收到；「待授权」出现未授权入站并可允许；会话列表出现 IM 会话（徽章）；权限模式切换生效。

### 任务

1. `src/components/account/imConnectorCatalog.ts`（参照 `hookCatalog.ts`）：
   - `IM_PLATFORM_CATALOG`：feishu / wecom / dingtalk（标题、品牌色、能力摘要、**准入门槛文案 key**、接入分步指引 steps[]（每步文案 key））。
   - 纯函数：`connectorFormFromRecord`（credentials 空位回显 `hasCredentials` 占位）、`buildConnectorDraft`（凭据留空 = 保留旧值）、`statusBadgeOf(status)`、`permissionModeLabelKey`。
   - errcode 友好映射表（凭证无效 / 应用未发布 / 机器人被移出群 / 网络不通 → i18n key）。
2. `src/store/imConnectorsStore.ts`（zustand，参照 `mcpRegistryStore`）：`connectors/loaded/load/upsert/remove/test/gatewayStatus/parked/loadParked/resolveParked`；订阅 `im:gateway:status` / `im:parked:updated` 广播（`wsClient` 现有订阅机制）；`testFeedback` 一次性消费。
3. `src/components/account/ImConfig.tsx`（新页，视觉对齐 `McpConfig`/`HookConfig`）：
   - 页头：标题 + intro（双向对话 + 离线边界：hip 退出即 IM 离线）。
   - 平台卡片 ×3：能力摘要 + 准入门槛提示 + 已连接实例（名称 + 状态点 + 启用 Switch + 编辑/删除确认）+「连接」按钮；空态文案。
   - 「待授权」区块：parked 列表（人/会话/时间）+ 允许/拒绝；空时隐藏。
   - 权限模式：实例行内 Dropdown（confirm 默认 / auto 高风险确认框，参照 `AutomationDeleteDialog` 确认模式）。
   - `data-testid`：`settings-im-page` / `im-card-{platform}` / `im-instance-{id}` / `im-parked-{id}` / `im-status-{id}`。
4. `src/components/account/ImConnectorModal.tsx`（参照 `McpRegistrySourceModal` + `Modal`）：
   - 分步指引（平台 steps + 图示区，纯文案/图标占位）+ 凭证表单（按平台字段；password 输入；已保存显示「已设置」占位、留空不修改）+ 权限模式选择 +「保存并连接」。
   - 连接状态反馈：保存后轮询 `gatewayStatus`（store 已订阅）→ 成功/失败 + 错误映射文案；「发送测试消息」按钮（loading/成功/失败 inline 反馈）。
5. `src/components/account/settingsNav.ts`：agents 组 `hooks` 后新增 `{ id: 'im', icon: MessageSquare, labelKey: 'settings.imLabel', Component: ImConfig }`；`SettingsPageDef.labelKey` 联合补 `'settings.imLabel'`。
6. `src/store/uiStore.ts`：`SettingsPageId` 联合 + `SETTINGS_PAGE_IDS` + `normalizeSettingsPage` 补 `'im'`。
7. i18n 五语言：`settings.imLabel` + `settings.im.*`（标题/intro/离线边界/卡片文案/门槛提示/指引步骤/表单字段/权限模式/状态徽章/errcode 映射/待授权文案/删除确认/测试反馈）。
8. 测试：`imConnectorCatalog.test.ts`、`ImConfig.test.tsx`（三卡片/待授权/状态徽章/权限切换）、`ImConnectorModal.test.tsx`（分步/校验/凭据不回显/测试反馈）、`imConnectorsStore.test.ts`（mock ws）。`SettingsSidebarContent.test.tsx` 若有导航快照断言 → 补 `im` 项。

**不包含：** 企微/钉钉适配器（UI 已按 catalog 呈现，未接平台时卡片显示「平台适配器即将支持」占位态由 catalog 标志位控制）、e2e。

---

## PR-4 · 企微适配器 + 钉钉适配器

**依赖：** PR-2（契约稳定）
**验收：** sidecar 单测（注入 mock 连接层）：企微 `aibot_subscribe` 后 30s 心跳发送、`aibot_msg_callback` → `ImMessageEvent`（req_id 透传、单聊 chatid 缺失时以 `from.userid` 合成会话键）、`aibot_respond_msg`（markdown）、模板卡片按钮 → `aibot_event_callback` → bridge 回流、重连踢旧连接语义；钉钉 DWClient 注册 `/v1.0/im/bot/messages/get`、sessionWebhook 回复、actionCard 按钮/文本降级确认。catalog 标志位翻转（PR-3 占位态解除）。

### 任务

1. `packages/sidecar/src/im/adapters/wecom.ts`：
   - 裸 `ws`（`wss://openws.work.weixin.qq.com`）：建连 → `aibot_subscribe`（BotID+Secret）→ 订阅确认；30s 心跳；断线指数退避重连（新连接踢旧连接是平台语义，适配器只需重连）。
   - 命令编解码：`aibot_msg_callback` / `aibot_event_callback`（卡片按钮）/ `aibot_respond_msg`（markdown / 模板卡片）/ `aibot_respond_update_msg`（卡片更新）。`req_id` 透传。
   - 单聊 `chatid` 缺失 → 会话键 = `from.userid`（合成 `dm:{userId}`，`chatName` = 发送者名）。
   - WS 连接层注入（`WebSocketLike` 接口）单测。
2. `packages/sidecar/src/im/adapters/dingtalk.ts`：
   - `dingtalk-stream-sdk-nodejs` 直接依赖；`DWClient(clientId, clientSecret)` 注册 `/v1.0/im/bot/messages/get`（messageId 去重、text 抽取、senderStaffId、sessionWebhook）。
   - `send()`：sessionWebhook（text / markdown）；卡片：actionCard + Stream 卡片回调；回调不可用 → 文本降级（「回复 1=允许 / 2=总是允许 / 3=拒绝」）+ 回复文本解析为 actionId（bridge 增加 `parseTextConfirm` 纯函数 + 测试）。
   - DWClient 注入单测。
3. `src/components/account/imConnectorCatalog.ts`：wecom/dingtalk 占位标志位翻转 + 门槛文案确认。

---

## PR-5 · e2e 钩子 + preview + docs 索引 + 发布说明

**依赖：** PR-4
**验收：** 浏览器打开 preview 可交互（三平台卡片/接入弹窗/待授权/HITL 卡片 mock/深色模式）；`docs/design/README.md` 索引更新；CHANGELOG 记录。

### 任务

1. `src/domain/e2eHooks.ts`（dev-only）：`im.inbound` 模拟钩子（伪造一条已授权/未授权入站消息驱动网关 → 断言会话创建 / park / 回复）；`im.hitlCard`（模拟卡片按钮回流 → 断言 permission:resolved）。
2. e2e（`e2e/`，参照既有 settings 用例）：添加连接器（mock 网关）→ 模拟入站 → 会话列表出现 IM 会话徽章 → 回复渲染；待授权允许流程。
3. `docs/design/im-connectors/im-connectors-preview.html`：重写为双向形态（卡片网格 + 接入分步弹窗 + 待授权 + 状态徽章 + HITL 卡片示意 + 消息形态切换）。
4. `docs/design/README.md`：「其它系列」表更新 im-connectors 行描述（双向对话，无微信）。
5. `CHANGELOG.md`：IM 连接器（飞书/企微/钉钉双向对话）。
6. spec/plan 定稿（评审后 Draft → Approved）。

---

## 测试矩阵总览

| 层 | 覆盖 | 位置 |
|---|---|---|
| sidecar 单测 | 流水线纯函数（去重/限速/授权/会话键/入站帧）、bridge（会话创建/回复/卡片回流）、三适配器（mock 连接层）、store 0600 | `packages/sidecar/src/im/*.test.ts` |
| 协议 | `im:*` classify、`session:created.origin` 兼容 | `packages/sidecar/src/server/message-route.test.ts`、protocol contract 测试 |
| 前端单测 | catalog/表单/store/组件状态 | `src/components/account/*.test.ts(x)`、`src/store/imConnectorsStore.test.ts` |
| 回归 | 既有 session/permission 流程不受 origin 字段影响 | 全量 `yarn test` |
| e2e | 入站→会话→回复、park→授权、卡片回流 | `e2e/`（dev hooks） |

## 交付顺序与依赖图

```
PR-1 (协议+存储+网关骨架) ──▶ PR-2 (飞书全链路) ──┬─▶ PR-3 (设置页 UI)
                                                 └─▶ PR-4 (企微+钉钉)
PR-3、PR-4 并行可，合入顺序 1→2→{3,4}→5
```

飞书是参考实现平台（门槛最低、SDK 最成熟），PR-2 的契约稳定后 PR-4 两个适配器可并行。任何平台的真实联调在单测之外手工验证（dev 环境连接真实平台，不阻塞 CI）。
