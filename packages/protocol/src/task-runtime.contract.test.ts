import { describe, it, expect } from 'vitest'
import type { ClientMessage, ServerMessage } from './messages.js'
import {
  type TaskKind,
  type TaskStatus,
  type TaskSnapshot,
  type TaskOutputPayload,
  type TaskRunningCounts,
  type TaskNotificationStatus,
  isTaskKind,
  isTaskStatus,
  emptyTaskRunningCounts,
} from './task-runtime.js'
import { parseClientMessage, isClientMessageType } from './message-guard.js'

// TYPE GUARDS (tsc-only): pin ClientMessage / ServerMessage task variants.
const _taskList: Extract<ClientMessage, { type: 'task:list' }> = {
  type: 'task:list',
  sessionId: 's',
}
void _taskList

const _taskStop: Extract<ClientMessage, { type: 'task:stop' }> = {
  type: 'task:stop',
  sessionId: 's',
  taskId: 'shell-1',
  reason: 'user',
}
void _taskStop

const _taskGetOutput: Extract<ClientMessage, { type: 'task:getOutput' }> = {
  type: 'task:getOutput',
  sessionId: 's',
  taskId: 'shell-1',
  offsetBytes: 100,
}
void _taskGetOutput

const _taskSnapshot: Extract<ServerMessage, { type: 'task:snapshot' }> = {
  type: 'task:snapshot',
  sessionId: 's',
  tasks: [],
  runningCounts: emptyTaskRunningCounts(),
}
void _taskSnapshot

const _taskDelta: Extract<ServerMessage, { type: 'task:delta' }> = {
  type: 'task:delta',
  sessionId: 's',
  task: {
    id: 'worker-1',
    kind: 'agent',
    description: 'explore',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
  },
}
void _taskDelta

const _taskEvent: Extract<ServerMessage, { type: 'task:event' }> = {
  type: 'task:event',
  sessionId: 's',
  taskId: 'mon-1',
  description: 'errors',
  line: 'ERROR boom',
  seq: 1,
}
void _taskEvent

const _taskNotification: Extract<ServerMessage, { type: 'task:notification' }> = {
  type: 'task:notification',
  sessionId: 's',
  taskId: 'shell-1',
  kind: 'shell',
  description: 'npm run dev',
  status: 'completed',
}
void _taskNotification

// agent:notification status union must stay completed|failed|killed only (no lost/suppressed/fired).
const _agentNotif: Extract<ServerMessage, { type: 'agent:notification' }> = {
  type: 'agent:notification',
  sessionId: 's',
  taskId: 'worker-1',
  description: 'bg',
  status: 'completed',
}
void _agentNotif

describe('task-runtime types', () => {
  it('isTaskKind / isTaskStatus cover the closed sets', () => {
    const kinds: TaskKind[] = ['shell', 'agent', 'monitor', 'schedule']
    const statuses: TaskStatus[] = [
      'running',
      'completed',
      'failed',
      'killed',
      'lost',
      'scheduled',
      'suppressed',
    ]
    for (const k of kinds) expect(isTaskKind(k)).toBe(true)
    for (const s of statuses) expect(isTaskStatus(s)).toBe(true)
    expect(isTaskKind('other')).toBe(false)
    expect(isTaskStatus('fired')).toBe(false)
  })

  it('emptyTaskRunningCounts zeros all kinds', () => {
    const c: TaskRunningCounts = emptyTaskRunningCounts()
    expect(c).toEqual({ shell: 0, agent: 0, monitor: 0, schedule: 0 })
  })

  it('task:snapshot round-trips with TaskSnapshot[]', () => {
    const snap: TaskSnapshot = {
      id: 'shell-a',
      kind: 'shell',
      description: 'dev server',
      status: 'running',
      createdAt: 10,
      updatedAt: 20,
      pid: 4242,
      logTail: 'listening on 3000\n',
      metrics: { bytes: 12 },
    }
    const m: ServerMessage = {
      type: 'task:snapshot',
      sessionId: 's1',
      tasks: [snap],
      runningCounts: { shell: 1, agent: 0, monitor: 0, schedule: 0 },
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'task:snapshot' }>
    expect(rt.tasks[0]?.id).toBe('shell-a')
    expect(rt.runningCounts.shell).toBe(1)
  })

  it('task:notification statuses exclude fired', () => {
    const statuses: TaskNotificationStatus[] = [
      'completed',
      'failed',
      'killed',
      'suppressed',
      'lost',
    ]
    for (const status of statuses) {
      const m: ServerMessage = {
        type: 'task:notification',
        sessionId: 's',
        taskId: 't1',
        kind: 'monitor',
        description: 'd',
        status,
      }
      expect(m.status).toBe(status)
    }
  })

  it('TaskOutputPayload tool JSON shape is serializable', () => {
    const payload: TaskOutputPayload = {
      task_id: 'shell-1',
      kind: 'shell',
      status: 'completed',
      exit_code: 0,
      output: 'ok',
      bytes: 2,
      truncated: false,
    }
    const rt = JSON.parse(JSON.stringify(payload)) as TaskOutputPayload
    expect(rt.task_id).toBe('shell-1')
    expect(rt.exit_code).toBe(0)
  })

  it('task:getOutput:result round-trips', () => {
    const m: ServerMessage = {
      type: 'task:getOutput:result',
      sessionId: 's',
      taskId: 'shell-1',
      ok: true,
      payload: {
        task_id: 'shell-1',
        kind: 'shell',
        status: 'running',
        output: 'partial',
        truncated: true,
      },
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<
      ServerMessage,
      { type: 'task:getOutput:result' }
    >
    expect(rt.ok).toBe(true)
    expect(rt.payload?.truncated).toBe(true)
  })

  it('client guard accepts task control messages', () => {
    expect(isClientMessageType('task:list')).toBe(true)
    expect(isClientMessageType('task:stop')).toBe(true)
    expect(isClientMessageType('task:getOutput')).toBe(true)
    expect(parseClientMessage({ type: 'task:list', sessionId: 'x' })).not.toBeNull()
  })

  it('task:stop:result round-trips', () => {
    const m: ServerMessage = {
      type: 'task:stop:result',
      sessionId: 's',
      taskId: 'mon-1',
      ok: true,
      message: 'killed',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'task:stop:result' }>
    expect(rt.ok).toBe(true)
    expect(rt.message).toBe('killed')
  })
})
