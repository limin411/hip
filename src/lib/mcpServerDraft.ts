import type { McpServerConfig, McpTransport } from '@hip/protocol'

export interface KvPair {
  key: string
  value: string
}

export interface McpForm {
  name: string
  transport: McpTransport
  command: string
  args: string
  env: KvPair[]
  url: string
  headers: KvPair[]
  enabled: boolean
  enabledTools: string[]
  disabledTools: string[]
}

export const EMPTY_MCP_FORM: McpForm = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: [],
  url: '',
  headers: [],
  enabled: true,
  enabledTools: [],
  disabledTools: [],
}

/** stdio needs a command; sse/http need a url. Name is always required. */
export function isMcpDraftValid(f: McpForm): boolean {
  if (!f.name.trim()) return false
  if (f.transport === 'stdio') return f.command.trim().length > 0
  return f.url.trim().length > 0
}

/** Whitespace-split arg string into tokens; empty when blank. */
function splitArgs(s: string): string[] {
  return s.trim() ? s.trim().split(/\s+/) : []
}

/** Collapse non-empty key/value pairs into a record; undefined when none. */
function kvToRecord(pairs: KvPair[]): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const { key, value } of pairs) {
    const k = key.trim()
    if (k) out[k] = value
  }
  return Object.keys(out).length ? out : undefined
}

/** Form → the persisted McpServerConfig minus id (the store mints the id). */
export function buildMcpDraft(f: McpForm): Omit<McpServerConfig, 'id'> {
  const base = { name: f.name.trim(), transport: f.transport, enabled: f.enabled }
  const extras: Partial<McpServerConfig> = {}
  if (f.enabledTools.length > 0) extras.enabledTools = f.enabledTools
  if (f.disabledTools.length > 0) extras.disabledTools = f.disabledTools
  if (f.transport === 'stdio') {
    const args = splitArgs(f.args)
    const env = kvToRecord(f.env)
    return {
      ...base,
      ...extras,
      command: f.command.trim(),
      ...(args.length ? { args } : {}),
      ...(env ? { env } : {}),
    }
  }
  const headers = kvToRecord(f.headers)
  return {
    ...base,
    ...extras,
    url: f.url.trim(),
    ...(headers ? { headers } : {}),
  }
}

/** Existing config → editable form (inverse of buildMcpDraft). */
export function mcpConfigToForm(c: McpServerConfig): McpForm {
  const toPairs = (r?: Record<string, string>): KvPair[] =>
    r ? Object.entries(r).map(([key, value]) => ({ key, value })) : []
  return {
    name: c.name,
    transport: c.transport,
    command: c.command ?? '',
    args: (c.args ?? []).join(' '),
    env: toPairs(c.env),
    url: c.url ?? '',
    headers: toPairs(c.headers),
    enabled: c.enabled,
    enabledTools: c.enabledTools ?? [],
    disabledTools: c.disabledTools ?? [],
  }
}
