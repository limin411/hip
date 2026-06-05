import type { MockSession } from './types'

export const mockSessions: MockSession[] = [
  { id: 's1', title: '重构 WebSocket 客户端', preview: '把 ws-client 拆成可测试的小模块…', updatedAt: '2m ago' },
  { id: 's2', title: '三栏布局 UI', preview: '亮色主题 + 可拖拽面板', updatedAt: '18m ago' },
  { id: 's3', title: '修复 sidecar 端口竞争', preview: 'findAvailablePort 偶发返回占用端口', updatedAt: '1h ago' },
  { id: 's4', title: 'LangGraph supervisor 路由', preview: '根据任务复杂度分发子 agent', updatedAt: '3h ago' },
  { id: 's5', title: '添加 Git diff 渲染', preview: '行级高亮 + 折叠 hunk', updatedAt: 'Yesterday' },
  { id: 's6', title: '打包 sidecar 为单文件', preview: '用 ncc 构建独立 bundle', updatedAt: 'Yesterday' },
  { id: 's7', title: '智能体并行面板设计', preview: 'supervisor + 子 agent 卡片网格', updatedAt: '2d ago' },
  { id: 's8', title: '亮色 token 体系', preview: '低饱和品牌色 + 充足留白', updatedAt: '3d ago' },
]
