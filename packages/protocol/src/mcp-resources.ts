/** MCP resources and prompts types. */
// ──────────────────────────────────────────────────────────────────
// MCP resources & prompts types (Todo 28)
// ──────────────────────────────────────────────────────────────────

export interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpResourceTemplate {
  uriTemplate: string
  name: string
  description?: string
}

export interface McpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface McpPrompt {
  name: string
  description?: string
  arguments?: McpPromptArgument[]
}

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface McpResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}
