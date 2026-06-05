export interface MockShortcut {
  keys: string[]
  action: string
}

export interface MockFaq {
  q: string
  a: string
}

export const mockVersion = {
  app: 'hip v0.1.0',
  tauri: '2.0.0',
  react: '18.3.1',
  build: '2026-06-05',
}

export const mockShortcuts: MockShortcut[] = [
  { keys: ['⌘', 'K'], action: '快速搜索会话' },
  { keys: ['⌘', 'Enter'], action: '发送消息' },
  { keys: ['Shift', 'Enter'], action: '换行' },
  { keys: ['⌘', 'B'], action: '折叠/展开侧边栏' },
  { keys: ['⌘', 'J'], action: '折叠/展开产物面板' },
  { keys: ['⌘', 'N'], action: '新建会话' },
  { keys: ['Esc'], action: '退出全屏 / 关闭弹层' },
]

export const mockFaqs: MockFaq[] = [
  {
    q: 'hip 支持哪些大模型？',
    a: '目前支持 Claude Opus / Sonnet、GPT-4o 等主流模型。后续可通过自定义 API Key 接入更多模型。',
  },
  {
    q: '并行 agent 是如何工作的？',
    a: 'Supervisor 会根据任务复杂度自动分发子 agent（Planner / Coder / Reviewer），右侧「智能体」面板可实时查看各 agent 状态与输出。',
  },
  {
    q: '会话数据保存在哪里？',
    a: '当前版本为纯演示，会话数据保存在内存中，刷新页面后会恢复到初始 mock 状态。正式版本将接入本地持久化存储。',
  },
  {
    q: '如何自定义代码编辑器的主题？',
    a: '前往「设置 → 界面」中调整编辑器字号与动画开关。完整主题系统将在后续版本推出。',
  },
]
