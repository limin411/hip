/**
 * Trimmed fixture inspired by logs/bug.json (Zuolin sync turn).
 * Keep small for unit/component tests — not a full export.
 */
import type { AgentRun, Message, ToolCall } from '@hip/protocol'

const DSML_OUT = [
  'Let me explore the project structure.',
  '<｜｜DSML｜｜tool_calls>',
  '<｜｜DSML｜｜invoke name="read_file">',
  '<｜｜DSML｜｜parameter name="path" string="true">a.java</｜｜DSML｜｜parameter>',
  '</｜｜DSML｜｜invoke>',
  '</｜｜DSML｜｜tool_calls>',
].join('\n')

export const sampleToolCalls: ToolCall[] = [
  {
    callId: 't0',
    agentId: 'supervisor',
    name: 'task',
    input: JSON.stringify({ description: 'Find Zuolin sync data', mode: 'foreground' }),
    output: DSML_OUT,
    status: 'finished',
    seq: 0,
  },
  {
    callId: 't1',
    agentId: 'worker-1',
    name: 'grep',
    input: JSON.stringify({ pattern: 'zuolin', caseInsensitive: true }),
    output: '/..\\..\\$RECYCLE.BIN\\S-1-5-21\\x.java:1: import Zuolin',
    status: 'finished',
    seq: 1,
    truncated: true,
  },
  {
    callId: 't2',
    agentId: 'worker-1',
    name: 'grep',
    input: JSON.stringify({
      pattern: 'syncData',
      path: 'permission/src/main/java/com/zhuoqin/service/impl/DataSyncServiceImpl.java',
    }),
    status: 'error',
    error:
      "ENOTDIR: not a directory, scandir 'D:\\\\proj\\\\DataSyncServiceImpl.java'",
    seq: 2,
  },
  {
    callId: 't3',
    agentId: 'worker-1',
    name: 'read_file',
    input: JSON.stringify({ path: 'permission/src/main/java/com/zhuoqin/config/SyncDataConfig.java' }),
    output: 'package com.zhuoqin.config;\n',
    status: 'finished',
    seq: 3,
  },
  {
    callId: 't4',
    agentId: 'supervisor',
    name: 'glob',
    input: JSON.stringify({ pattern: '**/*SyncData*' }),
    output: '/permission\\src\\main\\java\\com\\zhuoqin\\config\\SyncDataConfig.java',
    status: 'finished',
    seq: 4,
  },
  {
    callId: 't5',
    agentId: 'supervisor',
    name: 'ls',
    input: JSON.stringify({ path: '.' }),
    output: 'permission/\nstation/\npom.xml',
    status: 'finished',
    seq: 5,
  },
  // Pad to ≥8 for grouping tests
  ...Array.from({ length: 5 }, (_, i) => ({
    callId: `pad-${i}`,
    agentId: 'supervisor',
    name: 'ls' as const,
    input: JSON.stringify({ path: `dir${i}` }),
    output: 'a\nb',
    status: 'finished' as const,
    seq: 10 + i,
  })),
]

export const sampleAgentRuns: AgentRun[] = [
  {
    agentId: 'supervisor',
    role: 'supervisor',
    output: '## 与左邻的数据同步概览\n\n完成总结。',
    startedAt: 1000,
    finishedAt: 166000,
    seq: 0,
    usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
  },
  {
    agentId: 'worker-1',
    role: 'worker',
    output: DSML_OUT,
    startedAt: 2000,
    finishedAt: 55000,
    seq: 1,
    taskInput: 'Find Zuolin sync data',
  },
  {
    agentId: 'subagent-2',
    role: 'subagent',
    output: 'Listed 18 methods in syncData().',
    startedAt: 60000,
    finishedAt: 105000,
    seq: 2,
    taskInput: 'List sync methods in DataSyncServiceImpl',
    parentAgentId: 'supervisor',
  },
]

export const sampleAssistantMessage: Message = {
  id: 'asst-sample',
  role: 'assistant',
  content:
    '现在我已经全面了解了代码库，下面是该工程与 **左邻（Zuolin）** 平台之间数据同步的完整总结。',
  timestamp: 166000,
  toolCalls: sampleToolCalls,
  agentRuns: sampleAgentRuns,
  // intentionally no timeline — export/fallback path
  usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
}
