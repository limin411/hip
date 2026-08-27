# 终端文件面板导航增强

## 概述

本方案解决终端管理中连接远程服务器后，右侧面板文件缺少返回上一层、跳转路径能力的问题。

## 问题分析

当前终端文件面板（右侧面板）存在以下导航限制：

1. **无法返回上一层目录** - 缺少父目录导航按钮
2. **无法快速跳转到指定路径** - 缺少路径输入框
3. **无法查看当前完整路径** - 路径显示不完整
4. **导航历史丢失** - 缺少导航历史功能

## 解决方案

### 核心功能

1. **面包屑导航** - 显示当前路径的层级结构，支持点击导航
2. **返回上一层按钮** - 快速返回父目录
3. **路径跳转功能** - 输入路径直接跳转
4. **导航历史记录** - 支持后退/前进功能
5. **快捷键支持** - 提高操作效率

### 技术实现

#### 1. 新增组件

- `TerminalBreadcrumb.tsx` - 面包屑导航组件
- `PathInput.tsx` - 路径输入框组件

#### 2. 工具函数

- `pathUtils.ts` - 路径处理工具函数

#### 3. 状态管理扩展

- 扩展 `terminalFsStore.ts` 添加导航历史状态

#### 4. UI 增强

- 修改 `TerminalFileTree.tsx` 集成新功能
- 添加导航按钮组

## 文件结构

```
docs/design/terminal-file-navigation/
├── README.md                                    # 本文件
├── terminal-file-navigation-spec.md            # 需求规格
├── terminal-file-navigation-plan.md            # 执行计划
└── (相关代码文件)

src/lib/pathUtils.ts                            # 路径工具函数
src/components/terminals/TerminalBreadcrumb.tsx  # 面包屑组件
src/components/terminals/PathInput.tsx          # 路径输入组件
src/components/terminals/TerminalFileTree.enhanced.tsx  # 增强版文件树
src/locales/en/terminal-navigation.json         # 英文翻译
src/locales/zh-CN/terminal-navigation.json      # 中文翻译
```

## 实现阶段

### 阶段 1：基础导航（P0）
- 面包屑导航组件
- 返回上一层功能

### 阶段 2：路径跳转（P1）
- 路径输入框
- 快捷键支持

### 阶段 3：历史记录和优化（P2）
- 导航历史记录
- UI 优化和测试

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt+↑` | 返回上一层 |
| `Alt+←` | 后退 |
| `Alt+→` | 前进 |
| `Ctrl+L` | 切换路径输入框 |
| `Enter` | 确认跳转 |
| `Escape` | 取消输入 |

## 验收标准

1. **功能完整性**
   - 支持返回上一层目录
   - 支持路径跳转
   - 支持面包屑导航

2. **用户体验**
   - 导航响应时间 < 100ms
   - 操作步骤减少 50%
   - 用户满意度 > 90%

3. **代码质量**
   - 测试覆盖率 > 80%
   - 无关键 bug
   - 代码可维护性良好

## 相关文档

- [需求规格](./terminal-file-navigation-spec.md)
- [执行计划](./terminal-file-navigation-plan.md)
- [终端能力现代化升级](../terminal-capability-upgrade/terminal-capability-upgrade-spec.md)
- [运维助手全面改进](../terminal-agent-comprehensive-improvement/terminal-agent-comprehensive-improvement-spec.md)
