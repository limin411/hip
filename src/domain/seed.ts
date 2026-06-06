// src/domain/seed.ts
import type { Message, SessionConfig } from '@hip/protocol'
import { mockSessions } from '@/mock/sessions'
import { mockMessages } from '@/mock/messages'
import { mockAgents } from '@/mock/agents'
import type { AgentVM, SessionVM } from './sessionStore'

// Matches DEFAULT_CONFIG in sessionStore.ts — inlined to avoid circular ESM dependency
// 必须与 sessionStore.ts 的 DEFAULT_CONFIG 保持一致（此处内联以打破 seed.ts ↔ sessionStore.ts 的运行时循环依赖）
const SEED_CONFIG: SessionConfig = { llmProvider: 'anthropic', model: 'claude-opus-4-8', tools: [] }

function seedMessages(): Message[] {
  return mockMessages.map((m, i) => ({ id: m.id, role: m.role, content: m.content, timestamp: i }))
}

function seedAgentsVM(): AgentVM[] {
  // 初始 seed 卡片保留手写 tokenCount/elapsedMs（store 内存量数据，见 parity 注记）
  return mockAgents.map((a) => ({
    id: a.id,
    role: a.role,
    title: a.title,
    status: 'done',
    tokens: a.tokens,
    tokenCount: a.tokenCount,
    elapsedMs: a.elapsedMs,
    startedAt: 0,
  }))
}

export function seedSessions(): SessionVM[] {
  return mockSessions.map((s, i) => ({
    id: s.id,
    config: SEED_CONFIG,
    title: s.title,
    preview: s.preview,
    updatedAt: s.updatedAt,
    messages: i === 0 ? seedMessages() : [],
    agents: i === 0 ? seedAgentsVM() : [],
    status: 'idle',
  }))
}

