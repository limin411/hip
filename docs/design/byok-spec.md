# hip BYOK 强化 Spec

Status: **implemented** (Phase A + B core + Phase C apiKind + light D `$ENV`; OAuth / `!cmd` / native SDK backlog)  
Related: OpenCode / Pi credential models, `~/.hip/config/auth.json`

## 0. 现状（已有能力）

| 能力 | 实现 |
|------|------|
| 密钥落盘 | `~/.hip/config/auth.json`，atomic write + Unix `0600` |
| 配置分离 | 非密钥在 `hip.toml` providers；密钥在 auth |
| UI 录入 | Settings → Providers：save/clear key、baseURL、enable、probe |
| 运行时解析 | `resolveApiKey`：env / auth.json（见下文优先级） |
| Desktop 注入 | Tauri spawn 时可注入 `HIP_MODEL_*`（兼容；非唯一来源） |
| 协议 | OpenAI-compatible + Anthropic Messages |
| 校验 | Provider-level key probe |
| 状态 | `hasApiKey` banner（ready / setActiveModel） |

## 1. 缺陷清单

### P0 — 正确性

| ID | 缺陷 |
|----|------|
| D1 | 改 Key 后 `HIP_MODEL_*` env 优先 → 旧密钥继续生效（restart 失败/延迟时更糟） |
| D2 | `activeKey` 假密钥 `sk-missing` → 无 key 仍发 HTTP |
| D3 | auth.json RMW 无跨进程锁（后续 B 完整 CredentialStore） |
| D4 | `ProviderEntry.apiKey` 类型允许 toml 存密钥，chat 路径不读 → 静默失败 |

### P1 — 体验

| ID | 缺陷 |
|----|------|
| D5 | 不认行业标准 env（`ANTHROPIC_API_KEY` 等） |
| D6 | 改 Key 强制 `restartSidecar` |
| D7 | spawn 注入列表不完整（依赖文件 fallback） |
| D8 | `resolveProviderBaseURL` 未知 provider 错误落到 DeepSeek URL |
| D9 | 凭证模型过扁（无 type / OAuth / provider env bag） |
| D10 | 无统一 `resolveProviderAuth` + `source` |

### P2 — 覆盖面（后续 Phase）

D11–D15：协议窄、双门闸、custom 无 apiKind、OAuth 缺失、ACP 边界。

## 2. 目标原则

1. 密钥与配置分离（secret → auth；endpoint/model → hip.toml）
2. 单一解析入口：`resolveProviderAuth` / `resolveApiKey`
3. 明确优先级（测试锁定）
4. 热更新：写 auth 后无需 restart 即可生效
5. 失败前置：无 key 不发假请求
6. 向后兼容：现有 `HIP_MODEL_*` 扁平 auth.json 继续可用
7. 不强制 OS keychain；明文 0600 保持
8. 先 API-key BYOK；OAuth 接口预留

## 3. 目标架构

```
UI / Tauri set_secret
        │
        ▼
 auth.json (0600)     standard env (ANTHROPIC_API_KEY…)
        │                      │
        └──────────┬───────────┘
                   ▼
         resolveProviderAuth(providerId, overrides?)
                   │
         { apiKey, baseUrl?, source }
                   │
         buildChatModel / probe / hasApiKey
```

### 3.1 解析优先级（锁定）

1. **请求级 override**（probe `draftApiKey` / 测试）
2. **auth.json 条目**（若 key **存在于文件**）  
   - 非空字符串 → 使用  
   - 空字符串（tombstone）→ **未配置**，**不**再 fallback 到 env（支持 clear 无需 restart）
3. **行业标准 env**（`ANTHROPIC_API_KEY`、catalog `env[]` 映射等）
4. **`HIP_MODEL_<ID>_API_KEY`**（Tauri 注入 / 老脚本 / 测试）
5. 未配置 → 明确错误，不发请求

### 3.2 baseURL 优先级

1. hip.toml `providers[].baseUrl`
2. catalog `api`
3. 内置官方默认（deepseek / anthropic / openai …）
4. 否则 `''`（调用方 `MISSING_BASE_URL`），**禁止**默默落到 DeepSeek

### 3.3 auth.json 形状（当前实现 + 未来）

**当前（v1，继续支持）：**

```json
{
  "HIP_MODEL_DEEPSEEK_API_KEY": "sk-...",
  "HIP_MODEL_ANTHROPIC_API_KEY": ""
}
```

空字符串 = 用户已清除（tombstone）。

**未来（v2，Phase B 完整 / D）：** `version` + `credentials[providerId]` 类型化（api_key / oauth）。

## 4. 分阶段交付

### Phase A — 正确性（本轮必达）

| ID | 项 |
|----|----|
| A1 | 去掉 `sk-missing`；`buildChatModel` 无 key 抛错 |
| A2 | 解析顺序：auth 条目优先；tombstone 阻断 env |
| A3 | `saveKey` / `clearKey` **不**强制 restart sidecar |
| A4 | `resolveProviderBaseURL` 用 catalog + 内置表 |
| A5 | 文档：`ProviderEntry.apiKey` 不用于 chat；禁止 toml 存 LLM key |

### Phase B — 解析统一 + 标准 env（本轮核心）

| ID | 项 |
|----|----|
| B1 | `resolveProviderAuth` 返回 `{ apiKey, source }` |
| B2 | 标准 env map（anthropic / openai / deepseek / minimax …） |
| B3 | clear 写 tombstone `""`（非 delete），配合热生效 |
| B4 | 产品文档写清优先级 |

### Phase C — custom apiKind + Connect UX（已实现）

| ID | 项 |
|----|----|
| C1 | `ProviderEntry.apiKind` / `api_kind` in hip.toml |
| C2 | `resolveChatApiKind` 优先读 toml apiKind |
| C3 | Add custom provider：API type 选择 + 保存 key 无需 restart |
| C4 | Provider detail：自定义 provider 可改 apiKind |

### Phase D light — key 表达式（部分）

| ID | 项 |
|----|----|
| D1a | auth.json 支持 `$VAR` / `${VAR}` 展开 |
| D1b | `!command` shell 取 secret — **未做** |
| D2+ | 云厂商 native / OAuth — **未做** |

### Phase E（后续）

- ACP bridge 策略

## 5. 非目标

- 默认迁钥匙串 / 加密 blob
- 一次实现全部 native SDK
- 改变 ACP 默认自管策略

## 6. 测试矩阵

| 场景 | 期望 |
|------|------|
| 仅 auth.json | 可解析 key |
| 仅标准 env | 可解析 key |
| 仅 HIP_MODEL_* | 可解析 key |
| auth 与 HIP env 冲突 | **auth 胜** |
| clear → 空 tombstone | 忽略 env，MISSING |
| 改 key 不 restart | 下一请求用新 key |
| 未知 provider 无 catalog base | `''` 非 deepseek |
| buildChatModel 无 key | throw，无 sk-missing |

## 7. 代码锚点

| 层 | 路径 |
|----|------|
| Spec | `docs/design/byok-spec.md` |
| Resolve | `packages/sidecar/src/config/auth-file.ts` |
| Base URL | `packages/sidecar/src/config/providers.ts` |
| Model | `packages/sidecar/src/session/model-factory.ts` |
| FE | `src/store/providersStore.ts`, `src/ipc/secrets.ts` |
| Rust | `src-tauri/src/auth.rs`, `sidecar.rs` |
| Docs | `packages/product-content/references/config-and-data.md` |
