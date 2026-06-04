export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer'

export interface SessionConfig {
  llmProvider: 'anthropic' | 'openai' | 'ollama'
  model: string
  tools: string[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentId?: string
  timestamp: number
}

export type ClientMessage =
  | { type: 'session:create'; id: string; config: SessionConfig }
  | { type: 'session:destroy'; sessionId: string }
  | { type: 'message:send'; sessionId: string; content: string; role: 'user' }
  | { type: 'message:cancel'; sessionId: string }

export type ServerMessage =
  | { type: 'session:created'; sessionId: string }
  | { type: 'agent:started'; sessionId: string; agentId: string; role: AgentRole }
  | { type: 'token:stream'; sessionId: string; agentId: string; delta: string }
  | { type: 'agent:finished'; sessionId: string; agentId: string }
  | { type: 'message:complete'; sessionId: string; message: Message }
  | { type: 'error'; sessionId?: string; code: string; message: string }
