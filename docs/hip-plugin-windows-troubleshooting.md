# hip 插件在 Windows 上加载失败 — 问题排查总结

> **产品修复（2026-07-21）** 见设计文档  
> [`docs/design/2026-07-21-windows-plugin-load-reliability.md`](./design/2026-07-21-windows-plugin-load-reliability.md)  
>
> - **全平台数据根统一为 `~/.hip`**（Windows: `%USERPROFILE%\.hip`），不再使用 `%APPDATA%\com.ljm.hip`。  
> - 注册表 object 条目会 coerce；Claude 式 hooks object 不再拖垮整插件；skills 支持扫描与 bare id。  
> 下文保留为历史事故记录与急救参考。

## 背景

安装 [obra/superpowers](https://github.com/obra/superpowers) 插件到 hip 桌面版后，重启程序发现插件**没有被加载**。macOS 系统正常，Windows 系统不行。

---

## 问题一：Windows 数据目录曾不一致（已修复）

### 现象（历史）

插件安装在 `C:\Users\Admin\.hip\plugins\superpowers\`，但旧版 hip 读的是 AppData。

### 现行为（目标）

| 平台 | 数据目录 |
|------|----------|
| **所有平台** | `~/.hip/`（Windows = `%USERPROFILE%\.hip`） |
| 覆盖 | `HIP_DATA_DIR` |

插件路径：`~/.hip/plugins/<id>/`  
注册表：`~/.hip/config/hip-plugins.json`

### 急救（仍适用）

将插件放到：

```
%USERPROFILE%\.hip\plugins\superpowers\
```

并确保 `hip-plugins.json` 中注册该绝对路径。

---

## 问题二：hip-plugins.json 格式错误

### 现象

`plugins` 数组中的元素是对象格式，旧版 sidecar 静默跳过。

### 现行为

接受 string、`{dir}`、`{path}`、`{root}`；启动时 normalize 写回 string[]。

### 正确形状

```json
{
  "plugins": ["C:\\Users\\Admin\\.hip\\plugins\\superpowers"],
  "enabled": { "superpowers": true }
}
```

---

## 问题三：`.plugin/plugin.json` 中 hooks 格式错误

### 现象（历史）

`hooks` 为 Claude 事件 object 时 parser 抛 `PluginManifestError`，**整插件被跳过**。

### 现行为

非法 / Claude 式 hooks **不再 throw**；skills 仍加载；hooks 为空并记诊断 `hooks_unsupported_format`。

Claude `hooks/hooks.json`（`type: command`）与 hip CJS function hooks **不兼容**（Phase A 不执行 command hooks）。

---

## 问题四：skills 路径缺少前缀

### 现象（历史）

`"skills": ["brainstorming"]` 解析到不存在的 `superpowers/brainstorming`。

### 现行为

- bare id 若存在 `skills/<id>` 则自动改写  
- manifest 省略 `skills` 时扫描 `skills/*/SKILL.md`  
- 官方 install 生成 `./skills/<name>`

---

## 推荐安装方式

优先使用应用内 **从 URL / GitHub 安装**（`plugin:install:url`），自动生成 `.plugin/plugin.json` 并注册路径。

手动落盘时：

1. 目录：`~/.hip/plugins/<slug>/`  
2. 需有 `.plugin/plugin.json`（可从 `.claude-plugin/plugin.json` + skills 扫描生成）  
3. `~/.hip/config/hip-plugins.json` 的 `plugins` 含绝对路径字符串  

### 相关源码

| 文件 | 作用 |
|------|------|
| `packages/cli/src/sidecar/hip-base.ts` | 数据基目录（全平台 `~/.hip`） |
| `src-tauri/src/paths.rs` | Tauri 侧数据根 |
| `packages/sidecar/src/config/plugins.ts` | `hip-plugins.json` 读/normalize |
| `packages/sidecar/src/session/plugins/parser.ts` | 清单解析（degrade hooks / skills scan） |
| `packages/sidecar/src/session/plugin-install.ts` | 安装与 auto-manifest |
| `packages/sidecar/src/session/config-manager.ts` | 会话加载编排 |

---

> **教训**: 文档与代码必须使用同一数据根；插件加载失败必须可观测，不可静默空列表。
