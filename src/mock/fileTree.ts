import type { FileNode } from './types'

export const mockFileTree: FileNode = {
  name: 'ws-client',
  path: 'src/ipc/ws-client',
  type: 'dir',
  children: [
    { name: 'connection.ts', path: 'src/ipc/ws-client/connection.ts', type: 'file' },
    { name: 'reconnect.ts', path: 'src/ipc/ws-client/reconnect.ts', type: 'file' },
    { name: 'client.ts', path: 'src/ipc/ws-client/client.ts', type: 'file' },
    {
      name: '__tests__',
      path: 'src/ipc/ws-client/__tests__',
      type: 'dir',
      children: [
        { name: 'reconnect.test.ts', path: 'src/ipc/ws-client/__tests__/reconnect.test.ts', type: 'file' },
        { name: 'client.test.ts', path: 'src/ipc/ws-client/__tests__/client.test.ts', type: 'file' },
      ],
    },
    { name: 'index.ts', path: 'src/ipc/ws-client/index.ts', type: 'file' },
  ],
}
