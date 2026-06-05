import type { MockAgent } from './types'

export const mockAgents: MockAgent[] = [
  { id: 'a0', role: 'supervisor', title: 'Supervisor', status: 'done', tokens: '任务较复杂，分发给 3 个子 agent 并行处理。', tokenCount: 142, elapsedMs: 1200 },
  { id: 'a1', role: 'planner', title: 'Planner', status: 'done', tokens: '拆解为 3 个文件：connection / reconnect / client。', tokenCount: 318, elapsedMs: 2400 },
  { id: 'a2', role: 'coder', title: 'Coder', status: 'done', tokens: '实现 backoff 指数退避与 client 组合层。', tokenCount: 1024, elapsedMs: 5200 },
  { id: 'a3', role: 'reviewer', title: 'Reviewer', status: 'done', tokens: '检查边界条件：最大退避封顶 30s，OK。', tokenCount: 256, elapsedMs: 1800 },
]

export function seedAgents(): MockAgent[] {
  return [
    { id: 'a0', role: 'supervisor', title: 'Supervisor', status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0 },
    { id: 'a1', role: 'planner', title: 'Planner', status: 'idle', tokens: '', tokenCount: 0, elapsedMs: 0 },
    { id: 'a2', role: 'coder', title: 'Coder', status: 'idle', tokens: '', tokenCount: 0, elapsedMs: 0 },
    { id: 'a3', role: 'reviewer', title: 'Reviewer', status: 'idle', tokens: '', tokenCount: 0, elapsedMs: 0 },
  ]
}
