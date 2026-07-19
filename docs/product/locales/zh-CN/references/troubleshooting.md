# hip 故障排查（Level 3）

## API / 模型调用失败

1. 打开 **设置 → 提供商**，确认已保存密钥。
2. 密钥在 `~/.hip/config/auth.json`（切勿向用户打印密钥）。
3. 在 UI 外改鉴权后请重启应用。
4. 查看 `~/.hip/logs/` 下 sidecar 日志。

## CLI：`APP_NOT_RUNNING`

产品 CLI 附着到**正在运行**的 hip 桌面应用。请先启动应用（`yarn tauri dev` 或已安装应用），再 `yarn cli:dev doctor`。

## 开启记忆后列表仍空

1. 确认 **设置 → 记忆** 中 **使用** / **生成** 符合预期。
2. 需要足够对话轮次 + API 密钥才能抽取；可试 **立即学习**。
3. 状态可能显示 `no_llm`、`rate_limited` 或空抽取 — 检查密钥 / 配额 / 等待。
4. SQLite 是真相源；`~/.hip/memories/` 镜像陈旧不等于库空。

## 智能体无法写文件

- 权限 **chat** 为只读。
- 默认 **edit** 沙箱在项目根 — 根外路径会失败。
- 仅当用户明确授权整机 FS 时使用 **full**。

## 技能未列出 / use_skill 失败

- 可能在 `hip.toml` 或插件中被禁用。
- 项目技能 `paths` 通配可能排除当前 cwd。
- 内置产品技能 id 为 `hip`，目录 `~/.hip/builtin-skills/hip/`。

## Sidecar / 连接问题

- 桌面壳启动 sidecar 并暴露其 WebSocket 端口。
- UI 连不上时重启应用；查看 `~/.hip/logs/`。
- 开发：工具链变更后用 `yarn sidecar:dev-bin` 重新生成 sidecar 包装。

## macOS 构建 DMG 残留

陈旧的 `rw.*.dmg` 挂载可能导致 `yarn tauri build` 失败；删除它们并卸除 `/Volumes/hip`（如有）。
