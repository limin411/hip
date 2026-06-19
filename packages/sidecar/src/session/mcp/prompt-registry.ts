import { mcpManager } from './manager.js'

export interface PromptEntry {
  serverId: string
  serverName: string
  name: string
  description?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
}

export interface PromptResult {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  error?: string
}

/**
 * Thin registry that surfaces MCP prompts to the frontend via WS messages.
 * Delegates to a McpManager instance (defaults to the resident singleton).
 * Accepts an optional manager for test injection.
 */
export class PromptRegistry {
  constructor(private readonly manager = mcpManager) {}

  listAll(): PromptEntry[] {
    return this.manager.allPrompts()
  }

  async execute(serverId: string, name: string, args?: Record<string, string>): Promise<PromptResult> {
    return this.manager.executePrompt(serverId, name, args)
  }
}

export const promptRegistry = new PromptRegistry()
