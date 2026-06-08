import { describe, it, expect } from 'vitest'
import type { ToolCall } from '@hip/protocol'
import { verifyWrites } from './verify.js'
import type { TraceRun } from './tool-trace.js'

function run(role: TraceRun['role'], ...toolCalls: ToolCall[]): TraceRun {
  return { role, output: '', startedAt: 0, finishedAt: null, seq: 0, reasoningBursts: [], toolCalls: new Map(toolCalls.map((tc) => [tc.callId, tc])) }
}
function tool(over: Partial<ToolCall> & { callId: string; name: string; status: ToolCall['status'] }): ToolCall {
  return { agentId: 'coder', input: '{}', seq: 0, ...over }
}
function trajectory(...runs: [string, TraceRun][]): Map<string, TraceRun> {
  return new Map(runs)
}

const EN_NOTE = '⚠️ No files were actually created this turn — no write tool was called.'
const ZH_CN_NOTE = '⚠️ 本回合没有真正创建任何文件——没有调用写入工具。'
const ZH_TW_NOTE = '⚠️ 本回合沒有真正建立任何檔案——沒有呼叫寫入工具。'

describe('verifyWrites — lie case (claims creation, zero writes)', () => {
  it('returns the EN correction', () => {
    expect(verifyWrites(trajectory(['supervisor', run('supervisor')]), 'I created self-intro.html for you.', 'en')).toEqual({ correction: EN_NOTE })
  })
  it('returns the zh-CN correction', () => {
    expect(verifyWrites(trajectory(['supervisor', run('supervisor')]), '已创建 self-intro.html 文件。', 'zh-CN')).toEqual({ correction: ZH_CN_NOTE })
  })
  it('returns the zh-TW correction', () => {
    expect(verifyWrites(trajectory(['supervisor', run('supervisor')]), '已建立 self-intro.html 檔案。', 'zh-TW')).toEqual({ correction: ZH_TW_NOTE })
  })
  it('catches wrote/saved/generated phrasings', () => {
    const traj = trajectory(['supervisor', run('supervisor')])
    expect(verifyWrites(traj, 'I wrote the file to index.ts.', 'en')).toEqual({ correction: EN_NOTE })
    expect(verifyWrites(traj, 'Saved your config.json.', 'en')).toEqual({ correction: EN_NOTE })
    expect(verifyWrites(traj, 'Generated a report.md summary.', 'en')).toEqual({ correction: EN_NOTE })
  })
})

describe('verifyWrites — truth case (claim backed by a finished write)', () => {
  it('returns {} when a write_file finished', () => {
    expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'write_file', status: 'finished', output: 'ok' }))]), 'I created self-intro.html for you.', 'en')).toEqual({})
  })
  it('returns {} when an edit_file finished', () => {
    expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'edit_file', status: 'finished', output: 'ok' }))]), '已创建 self-intro.html 文件。', 'zh-CN')).toEqual({})
  })
})

describe('verifyWrites — no false positives', () => {
  it('silent write → no correction', () => {
    expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'write_file', status: 'finished', output: 'ok' }))]), 'Here is the plan.', 'en')).toEqual({})
  })
  it('no claim + no write → no correction', () => {
    expect(verifyWrites(trajectory(['supervisor', run('supervisor')]), 'I reviewed the approach.', 'en')).toEqual({})
  })
  it('a running (not finished) write does NOT count → lie correction', () => {
    expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'write_file', status: 'running' }))]), 'I created self-intro.html for you.', 'en')).toEqual({ correction: EN_NOTE })
  })
  it('an errored write does NOT count → lie correction', () => {
    expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'write_file', status: 'error', error: 'EACCES' }))]), 'I created self-intro.html for you.', 'en')).toEqual({ correction: EN_NOTE })
  })
})
