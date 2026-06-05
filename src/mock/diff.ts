import type { DiffFile } from './types'

export const mockDiff: DiffFile[] = [
  {
    path: 'src/ipc/ws-client/reconnect.ts',
    additions: 6,
    deletions: 0,
    lines: [
      { type: 'add', content: 'export function backoff(attempt: number): number {', oldNo: null, newNo: 1 },
      { type: 'add', content: '  return Math.min(1000 * 2 ** attempt, 30_000)', oldNo: null, newNo: 2 },
      { type: 'add', content: '}', oldNo: null, newNo: 3 },
      { type: 'add', content: '', oldNo: null, newNo: 4 },
      { type: 'add', content: 'export const MAX_RETRIES = 8', oldNo: null, newNo: 5 },
      { type: 'add', content: 'export const INITIAL_DELAY = 1000', oldNo: null, newNo: 6 },
    ],
  },
  {
    path: 'src/ipc/ws-client.ts',
    additions: 1,
    deletions: 2,
    lines: [
      { type: 'ctx', content: 'class WsClient {', oldNo: 10, newNo: 10 },
      { type: 'del', content: '  private retries = 0', oldNo: 11, newNo: null },
      { type: 'del', content: '  // TODO: reconnect', oldNo: 12, newNo: null },
      { type: 'add', content: '  private readonly reconnector = new Reconnector()', oldNo: null, newNo: 11 },
      { type: 'ctx', content: '}', oldNo: 13, newNo: 12 },
    ],
  },
]
