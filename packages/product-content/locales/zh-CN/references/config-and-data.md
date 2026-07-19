# hip 配置与本地数据（Level 3）

## 布局（`~/.hip/`）

| 路径 | 用途 |
|------|------|
| `~/.hip/config/auth.json` | 提供商 API 密钥（0600 明文，按设计） |
| `~/.hip/config/hip.toml` | 全局产品配置（技能、agent loop、langsmith 等） |
| `~/.hip/config/memory.json` | 记忆功能开关 / 流水线参数 |
| `~/.hip/config/network.json` | 可选网络策略 |
| `~/.hip/config/hip-plugins.json` | 已安装插件注册表 |
| `~/.hip/db/hip.db` | SQLite 会话、消息、记忆、事件 |
| `~/.hip/data/tool-output/` | 大型工具输出（不进 DB） |
| `~/.hip/logs/` | Sidecar / 壳日志 |
| `~/.hip/skills/` | 全局技能 |
| `~/.hip/plugins/` | 已安装插件 |
| `~/.hip/memories/` | 记忆 Markdown 镜像 |
| `~/.hip/builtin-skills/` | 内置渐进产品技能（如 `hip`） |
| `~/.hip/scratch/`、worktrees | 临时区 / 并行 worktree |

项目覆盖常在 `<project>/.hip/`（如 `.hip/skills/`、`.hip/hip.toml`）。

## 环境 / 隔离（进阶）

| 变量 | 作用 |
|------|------|
| `HIP_DATA_DIR` | 重定向数据/配置根（测试 / 隔离） |
| `HIP_SKILLS_DIR` | 覆盖全局技能根 |
| `HIP_PLUGINS_DIR` | 覆盖插件根 |
| `HIP_AUTH_PATH` | 覆盖 auth.json 路径 |
| `HIP_CONFIG_PATH` | 覆盖 hip.toml 路径 |
| `HIP_MEMORY_CONFIG_PATH` | 覆盖 memory.json 路径 |
| `LANGSMITH_*` | 可选 LangSmith 追踪（也可用 hip.toml `[langsmith]`） |

**不要**把 `~/.hip/config/` 同步到公开云或公开 dotfile 仓库——可能含 API 密钥。

## 鉴权模型

密钥在应用设置中填写并写入 `auth.json`。桌面应用、独立 sidecar 与测试都从该存储读取。这是有意的磁盘明文 + 紧文件权限，不是钥匙串迁移目标。
