export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer'

export interface SessionConfig {
  llmProvider: 'deepseek'
  model: string
  tools: string[]
  systemPrompt?: string
  cwd?: string                 // absolute project root; undefined → virtual FS (no real file tools)
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentId?: string
  timestamp: number
}

export interface AgentRun {
  agentId: string
  role: AgentRole
  output: string
  startedAt: number
  finishedAt: number | null
  seq: number
}
export interface SessionSummary {
  id: string
  title: string
  preview: string
  updatedAt: number
  messageCount: number
}
export interface SearchHit {
  sessionId: string
  messageId: string | null
  title: string
  snippet: string
  timestamp: number
}

/** One immediate child of a directory. `path` is a real absolute host path. */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
}

export type ClientMessage =
  | { type: 'session:create'; id: string; config: SessionConfig }
  | { type: 'session:destroy'; sessionId: string }
  | { type: 'message:send'; sessionId: string; id: string; content: string; role: 'user' }
  | { type: 'message:cancel'; sessionId: string }
  | { type: 'session:list' }
  | { type: 'session:load'; sessionId: string }
  | { type: 'session:search'; query: string }
  | { type: 'session:delete'; sessionId: string }
  | { type: 'session:rename'; sessionId: string; title: string }
  | { type: 'session:setCwd'; sessionId: string; cwd: string }
  | { type: 'fs:ls'; sessionId: string; path: string }
  | { type: 'fs:read'; sessionId: string; path: string }
  | { type: 'fs:lsCwd'; cwd: string; path: string }
  | { type: 'fs:readCwd'; cwd: string; path: string }

export type ServerMessage =
  | { type: 'session:created'; sessionId: string }
  | { type: 'agent:started'; sessionId: string; agentId: string; role: AgentRole }
  | { type: 'token:stream'; sessionId: string; agentId: string; delta: string }
  | { type: 'agent:finished'; sessionId: string; agentId: string }
  | { type: 'message:complete'; sessionId: string; message: Message }
  | { type: 'error'; sessionId?: string; code: string; message: string }
  | { type: 'ready'; hasApiKey: boolean }
  | { type: 'session:list:result'; sessions: SessionSummary[] }
  | { type: 'session:loaded'; sessionId: string; messages: Message[]; agentRuns: AgentRun[] }
  | { type: 'session:search:result'; query: string; hits: SearchHit[] }
  | { type: 'session:deleted'; sessionId: string }
  | { type: 'session:title'; sessionId: string; title: string }
  | { type: 'session:cwd'; sessionId: string; cwd: string }
  | { type: 'fs:ls:result'; sessionId: string; path: string; entries: FsEntry[]; error?: string }
  | { type: 'fs:read:result'; sessionId: string; path: string; content?: string; encoding?: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean; error?: string }
  | { type: 'fs:lsCwd:result'; cwd: string; path: string; entries: FsEntry[]; error?: string }
  | { type: 'fs:readCwd:result'; cwd: string; path: string; content?: string; encoding?: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean; error?: string }
