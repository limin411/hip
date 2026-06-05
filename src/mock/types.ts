export type Role = 'supervisor' | 'planner' | 'coder' | 'reviewer'
export type AgentStatus = 'idle' | 'running' | 'done'
export type ArtifactTab = 'doc' | 'files' | 'agents' | 'diff'

export interface MockUser {
  name: string
  email: string
  avatarUrl?: string
}

export interface MockSession {
  id: string
  title: string
  preview: string
  updatedAt: string
}

export interface MockMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface MockAgent {
  id: string
  role: Role
  title: string
  status: AgentStatus
  tokens: string
  tokenCount: number
  elapsedMs: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
}

export type DiffLineType = 'add' | 'del' | 'ctx'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldNo: number | null
  newNo: number | null
}

export interface DiffFile {
  path: string
  additions: number
  deletions: number
  lines: DiffLine[]
}
