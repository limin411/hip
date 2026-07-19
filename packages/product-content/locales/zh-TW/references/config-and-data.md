# hip 設定與本機資料（Level 3）

## 配置（`~/.hip/`）

| 路徑 | 用途 |
|------|------|
| `~/.hip/config/auth.json` | 提供者 API 金鑰（0600 明文，依設計） |
| `~/.hip/config/hip.toml` | 全域產品設定 |
| `~/.hip/config/memory.json` | 記憶功能開關 |
| `~/.hip/config/network.json` | 可選網路原則 |
| `~/.hip/config/hip-plugins.json` | 已安裝外掛登錄 |
| `~/.hip/db/hip.db` | SQLite 工作階段、訊息、記憶、事件 |
| `~/.hip/data/tool-output/` | 大型工具輸出 |
| `~/.hip/logs/` | Sidecar / 殼日誌 |
| `~/.hip/skills/` | 全域技能 |
| `~/.hip/plugins/` | 已安裝外掛 |
| `~/.hip/memories/` | 記憶 Markdown 鏡像 |
| `~/.hip/builtin-skills/` | 內建漸進產品技能（如 `hip`） |

**不要**把 `~/.hip/config/` 同步到公開雲或公開 dotfile 倉庫。

## 環境變數（進階）

`HIP_DATA_DIR`、`HIP_SKILLS_DIR`、`HIP_PLUGINS_DIR`、`HIP_AUTH_PATH`、`HIP_CONFIG_PATH`、`HIP_MEMORY_CONFIG_PATH`、`LANGSMITH_*`。
