# 顶部标题栏新建会话文案变更设计

## 目标
将主界面顶部标题栏「+」下拉菜单中新建 Chat / Code 会话的描述改为更贴近业务场景的文案：

- Chat 会话：`新建办公对话`
- Code 会话：`新建编码任务`

## 上下文
- 文案实际位于 `src/i18n/*.ts` 的 `dropdown.newChat` 与 `dropdown.newCode` 键。
- 顶部标题栏 `src/components/layout/TitleBar.tsx` 渲染 `SessionTabBar`，`SessionTabBar` 通过 `t('dropdown.newChat')` / `t('dropdown.newCode')` 读取文案。
- 现有测试 `src/components/tabs/SessionTabBar.test.tsx` 使用 key 名做断言，不依赖具体文案，因此无需修改。

## 设计
采用最小改动方案：只更新三个 locale 文件中对应键的值，不改动 key 名、组件引用或业务逻辑。

### 文件变更

| 文件 | 键 | 原值 | 新值 |
|---|---|---|---|
| `src/i18n/zh-CN.ts` | `dropdown.newChat` | `新建 Chat` | `新建办公对话` |
| `src/i18n/zh-CN.ts` | `dropdown.newCode` | `新建 Code` | `新建编码任务` |
| `src/i18n/zh-TW.ts` | `dropdown.newChat` | `新建 Chat` | `新增辦公對話` |
| `src/i18n/zh-TW.ts` | `dropdown.newCode` | `新建 Code` | `新增編碼任務` |
| `src/i18n/en.ts` | `dropdown.newChat` | `New Chat` | `New Work Chat` |
| `src/i18n/en.ts` | `dropdown.newCode` | `New Code` | `New Coding Task` |

## 测试与验证
1. 运行单元测试：`npx vitest src/components/tabs/SessionTabBar.test.tsx`，确认测试仍通过。
2. 手动验证：启动应用后，点击顶部标题栏的「+」按钮，下拉菜单项应显示新文案。

## 成功标准
- 顶部标题栏新建会话下拉菜单在简体中文、繁体中文、英文环境下分别显示指定新文案。
- 现有测试不因此变更失败。
