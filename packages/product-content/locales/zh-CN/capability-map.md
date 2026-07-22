产品要点（hip）：
- 版本：{{HIP_PRODUCT_VERSION}}。
- 桌面 AI 工作台智能体，在用户项目中使用真实文件工具，并可委派子智能体。
- 界面：Code（完整工作台）与 Chat（更轻；可预览交付物请 write_file 到工件面板）与 Knowledge（笔记空间）。
- 仅在 Code 上，工具门禁（UI 标签）：chat = 只读；edit = 项目沙箱（默认）；full = 用户授权的整机文件系统。Chat 界面不是 Code 的「edit 模式」。
- 会话右侧面板：Agents（花名册 / 子智能体）与 Runtime（后台 shell、monitor、定时任务）合并视图。
- API 密钥：~/.hip/config/auth.json（按设计为 0600 明文）。
- 跨会话记忆：默认关闭（设置 → 记忆）。
- 本地数据：~/.hip/（配置、数据库、技能、插件、日志）。
