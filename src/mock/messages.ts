import type { MockMessage } from './types'

export const mockMessages: MockMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: '帮我把 ws-client 拆成更容易测试的小模块，并加上重连逻辑。',
  },
  {
    id: 'm2',
    role: 'assistant',
    content: [
      '好的，我会把 `ws-client.ts` 拆成三个职责清晰的单元：',
      '',
      '1. **`connection.ts`** — 只负责底层 WebSocket 的建立与关闭',
      '2. **`reconnect.ts`** — 指数退避重连策略（纯函数，易测试）',
      '3. **`client.ts`** — 组合上面两者，对外暴露 `send` / `onMessage`',
      '',
      '重连退避的核心是这段纯函数：',
      '',
      '```ts',
      'export function backoff(attempt: number): number {',
      '  return Math.min(1000 * 2 ** attempt, 30_000)',
      '}',
      '```',
      '',
      '这样每一块都能独立测试，`backoff` 甚至不需要 mock 任何东西。',
    ].join('\n'),
  },
]

export const CANNED_REPLY = [
  '我来分析一下这个需求。先并行启动几个子 agent：',
  '',
  '- **planner** 负责拆解任务边界',
  '- **coder** 负责生成实现代码',
  '- **reviewer** 负责审查正确性',
  '',
  '右侧「智能体」面板可以看到它们并行运行的实时状态。综合三者结果后，我会给出最终方案。',
].join('\n')
