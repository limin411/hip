# 模型配置 · 卡片 + 弹窗（独立端点）

**日期：** 2026-07-11  
**状态：** 已确认  
**取代：** 页内 SegmentedControl + 共用 ProviderList 模板（`2026-07-11-model-config-three-way-layout-design.md` 中的 tab 骨架）

## 问题

嵌入 / 重排与基础 chat 模型**来源与配置形态不同**，不能套用 models.dev 提供商列表。用户需要：

1. 首页若干可编辑卡片  
2. 编辑进入弹窗  
3. 嵌入 / 重排只填端点 + 密钥 + 模型 id  
4. **密钥与对话提供商完全独立**

## 方案

### 首页

三张卡片：基础模型 · 嵌入 · 重排（可选）

### 基础模型弹窗

现有 ProviderList + ProviderDetail（catalog 仍有意义）

### 嵌入 / 重排弹窗

字段：Base URL、API Key、Model ID；清除按钮

### 存储

| 用途 | 非密钥 | 密钥 |
|------|--------|------|
| 基础 | `hip.toml` providers + activeModel | `auth.json` 按 chat providerID |
| 嵌入 | `memory.json` embeddingModel → virtual `hip-memory-embedding` | `auth.json` 槽 `HIP_MODEL_HIP_MEMORY_EMBEDDING_API_KEY` |
| 重排 | `memory.json` rerankModel → virtual `hip-memory-rerank` | 对应 virtual 槽 |

Sidecar `resolveApiKey(providerID)` 与现有 embedding client 无需改协议形状（仍为 `MemoryModelRef`）。

## 明确不做

- 嵌入/重排再展示 chat 提供商目录  
- 与 chat 共用密钥槽  
