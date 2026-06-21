import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { McpServerConfig } from '@hip/protocol'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { jsonSchemaToZod, type JsonSchema } from './json-schema-to-zod.js'
import { ToolRegistry, type Scope } from '../tool-registry.js'
import { safeErrorMessage } from '../error.js'

/** Connection status for UI display. */
export type McpConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

/** Per-server status snapshot (for UI). */
export interface McpServerStatus {
  id: string
  name: string
  status: McpConnectionStatus
  toolCount: number
  toolNames: string[]
  lastError?: string
}

/** The slice of the MCP Client surface the manager uses. Lets a Fake stand in for tests. */
export interface ClientLike {
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>
  callTool(req: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
  listResources?(): Promise<{ resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }> }>
  readResource?(req: { uri: string }): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }>
  listPrompts?(): Promise<{ prompts: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }> }>
  getPrompt?(req: { name: string; arguments?: Record<string, string> }): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } }>; description?: string }>
  getServerCapabilities?(): { prompts?: unknown; resources?: unknown; tools?: unknown } | undefined
}

/** Stored tool metadata for searching + lazy invocation. */
interface ToolMeta {
  name: string
  description?: string
  inputSchema?: unknown
}

/** One connected server: its config fingerprint, the client, and its discovered tools/resources/prompts. */
interface Connection {
  id: string
  name: string
  fingerprint: string
  client: ClientLike
  tools: ToolMeta[]
  /** Server config (for enabledTools/disabledTools filtering). */
  serverConfig: McpServerConfig
  /** Last connection error (for UI). */
  lastError?: string
  /** Cached resources from listResources (if server supports resources capability). */
  resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>
  /** Cached prompts from listPrompts (if server supports prompts capability). */
  prompts?: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>
}

/** Default: pre-load all MCP tools when total count < 20. */
export const DEFAULT_LAZY_THRESHOLD = 20

/** Default context window (128k tokens) for calculating pct-based threshold. */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000

/** Default percentage of context budget for lazy tool loading (5%). */
export const DEFAULT_LAZY_THRESHOLD_PCT = 5

/** Options for tools() — enables lazy loading, filtering, and context-budget awareness. */
export interface ToolsOptions {
  /**
   * Max total tools before switching to lazy mode (proxy tools only).
   * When undefined, uses DEFAULT_LAZY_THRESHOLD (20).
   * Set to 0 to force lazy mode always; Infinity to disable.
   */
  lazyThreshold?: number
  /**
   * Model context window tokens for pct-based threshold calculation.
   * When set, lazyThreshold = contextWindowTokens * lazyThresholdPct / 100.
   */
  contextWindowTokens?: number
  /**
   * Percentage of context for lazy threshold (default: 5).
   * Only used when contextWindowTokens is set and lazyThreshold is not explicit.
   */
  lazyThresholdPct?: number
}

/** One tracked ToolRegistry binding: the registry plus the Session scope used for all MCP tools. */
interface RegistryBinding {
  readonly registry: ToolRegistry
  readonly scope: Scope
}

/** A resident pool of MCP clients. Reconciled per turn against the configured server list. */
export class McpManager {
  private conns = new Map<string, Connection>()
  private readonly registryBindings = new Map<symbol, RegistryBinding>()

  private readonly BACKOFF_INITIAL = 500
  private readonly BACKOFF_MAX = 10_000

  /** Per-server backoff state for exponential reconnect. Epoch cancels stale retries on disconnect. */
  private backoffs = new Map<string, { delay: number; epoch: number; timer: ReturnType<typeof setTimeout> | null; server: McpServerConfig; fingerprint: string }>()

  /**
   * Register this manager's current and future MCP tools with a {@link ToolRegistry}
   * under the supplied Session scope. Future reconnects refresh the scope
   * automatically, so stale tool calls are rejected by the registry.
   */
  registerWithRegistry(registry: ToolRegistry, scope: Scope): void {
    this.registryBindings.set(scope.id, { registry, scope })
    this.registerCurrentToolsWithRegistry(registry, scope)
  }

  /** Remove a previously registered scope from the manager and the underlying registry. */
  deregisterScope(scope: Scope): void {
    const binding = this.registryBindings.get(scope.id)
    if (binding) {
      binding.registry.unregisterScope(scope)
      this.registryBindings.delete(scope.id)
    }
  }

  /** Register the currently-connected MCP tools into a single registry scope. */
  private registerCurrentToolsWithRegistry(registry: ToolRegistry, scope: Scope): void {
    for (const t of this.tools()) {
      registry.register(t, scope)
    }
  }

  /**
   * Refresh all tracked registry bindings: close every scope (removing stale
   * registrations) and re-register the currently-connected tools. Called after
   * any connection change so registrations reflect the live pool.
   */
  private refreshRegistrations(): void {
    for (const { registry, scope } of this.registryBindings.values()) {
      registry.unregisterScope(scope)
    }
    for (const { registry, scope } of this.registryBindings.values()) {
      this.registerCurrentToolsWithRegistry(registry, scope)
    }
  }

  /** Stable fingerprint for change detection — any field change forces reconnect. */
  protected fingerprint(server: McpServerConfig): string {
    return JSON.stringify(server)
  }

  /**
   * Open a client to `server` and complete the MCP handshake.
   * Overridden in tests to inject a Fake client (no real process/network).
   */
  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    if (server.transport === 'stdio') {
      const error = await this.validateStdioCommand(server.command)
      if (error) throw new Error(error)
    }
    const client = new Client({ name: 'hip', version: '0.1.0' })
    await client.connect(this.buildTransport(server))
    return client as unknown as ClientLike
  }

  /** Validate a stdio command against the absolute-path allowlist, resolving symlinks. */
  protected async validateStdioCommand(command: string | undefined): Promise<string | undefined> {
    if (!command) return 'MCP stdio server is missing a command'
    if (!path.isAbsolute(command)) return `MCP stdio command must be an absolute path: ${command}`
    const normalized = path.normalize(command)
    const allowedDirs = ['/usr/bin', '/usr/local/bin', '/opt', path.join(os.homedir(), '.hip', 'bin')]
    let real: string
    try {
      real = await fs.realpath(normalized)
    } catch {
      return `MCP stdio command does not exist or cannot be resolved: ${command}`
    }
    const resolved = path.normalize(real)
    for (const dir of allowedDirs) {
      if (resolved === dir || resolved.startsWith(dir + path.sep)) return undefined
    }
    return `MCP stdio command is not in the allowed directory list: ${command}`
  }

  /** Map a server config to the matching MCP transport. */
  private buildTransport(server: McpServerConfig) {
    if (server.transport === 'stdio') {
      return new StdioClientTransport({
        command: server.command ?? '',
        args: server.args ?? [],
        env: server.env,
        stderr: 'pipe',
      })
    }
    const url = new URL(server.url ?? '')
    const opts = server.headers ? { requestInit: { headers: server.headers } } : undefined
    if (server.transport === 'sse') return new SSEClientTransport(url, opts)
    return new StreamableHTTPClientTransport(url, opts)
  }

  /**
   * Reconcile the live pool with `servers`: connect newly-enabled, disconnect removed/disabled/changed,
   * reuse unchanged. Never throws — a failing server is logged, scheduled for backoff reconnect,
   * and skipped (graceful degrade).
   * Each connection stores its server config for enabledTools/disabledTools filtering.
   */
  async reconcile(servers: McpServerConfig[]): Promise<void> {
    const target = new Map<string, McpServerConfig>()
    for (const s of servers) if (s.enabled) target.set(s.id, s)

    // disconnect: anything live that is no longer a target, or whose config changed
    for (const [id, conn] of [...this.conns]) {
      const want = target.get(id)
      if (!want || this.fingerprint(want) !== conn.fingerprint) {
        await conn.client.close().catch(() => {})
        this.conns.delete(id)
        this.cancelReconnect(id)
      }
    }

    // Cancel pending reconnects for servers no longer in target
    for (const id of [...this.backoffs.keys()]) {
      if (!target.has(id)) this.cancelReconnect(id)
    }

    // connect: anything wanted that is not already live (reuse skips matched fingerprints above)
    for (const [id, server] of target) {
      if (this.conns.has(id)) continue
      const bo = this.backoffs.get(id)
      if (bo?.timer != null) {
        if (bo.fingerprint === this.fingerprint(server)) continue // same config, let retry run
        this.cancelReconnect(id) // config changed, cancel old retry, try fresh
      }
      const ok = await this.connectOne(server)
      if (!ok) this.scheduleReconnect(server, id)
    }

    this.refreshRegistrations()
  }

  /** Full connect+listTools+listResources+listPrompts flow. Returns true on success, false on failure. */
  private async connectOne(server: McpServerConfig): Promise<boolean> {
    let client: ClientLike
    try {
      client = await this.connect(server)
    } catch (err) {
      const msg = (err as Error).message
      console.error(`[mcp] failed to connect server ${server.id} (${server.name}): ${msg}`)
      this.storeError(server.id, server.name, msg)
      return false
    }
    try {
      const { tools } = await client.listTools()
      let resources: Connection['resources'] = undefined
      let prompts: Connection['prompts'] = undefined
      const caps = client.getServerCapabilities?.()
      if (caps?.resources && client.listResources) {
        try { const r = await client.listResources(); resources = r.resources } catch (err) {
          console.debug(`[mcp] optional listResources failed for ${server.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (caps?.prompts && client.listPrompts) {
        try { const r = await client.listPrompts(); prompts = r.prompts } catch (err) {
          console.debug(`[mcp] optional listPrompts failed for ${server.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      this.conns.set(server.id, {
        id: server.id,
        name: server.name,
        fingerprint: this.fingerprint(server),
        client,
        tools: tools as ToolMeta[],
        serverConfig: server,
        resources,
        prompts,
      })
      this.resetBackoff(server.id)
      this.refreshRegistrations()
      return true
    } catch (err) {
      await client.close().catch(() => {})
      const msg = (err as Error).message
      console.error(`[mcp] failed to list tools for server ${server.id} (${server.name}): ${msg}`)
      this.storeError(server.id, server.name, msg)
      return false
    }
  }

  /** Schedule an exponential-backoff reconnect for a failed server. */
  private scheduleReconnect(server: McpServerConfig, id: string): void {
    let bo = this.backoffs.get(id)
    if (!bo) {
      bo = { delay: this.BACKOFF_INITIAL, epoch: 0, timer: null, server, fingerprint: this.fingerprint(server) }
      this.backoffs.set(id, bo)
    }
    const delay = bo.delay
    bo.delay = Math.min(bo.delay * 2, this.BACKOFF_MAX)
    const epoch = ++bo.epoch
    bo.timer = setTimeout(() => {
      void this.retryConnect(id, epoch)
    }, delay)
  }

  /** Retry connecting a server. Exits early if epoch is stale (disconnect cancelled the retry). */
  private async retryConnect(id: string, epoch: number): Promise<void> {
    const bo = this.backoffs.get(id)
    if (!bo || bo.epoch !== epoch) return
    bo.timer = null
    if (this.conns.has(id)) { this.resetBackoff(id); return }
    const ok = await this.connectOne(bo.server)
    if (!ok) this.scheduleReconnect(bo.server, id)
  }

  /** Cancel any pending reconnect for a server (bump epoch to invalidate in-flight retries). */
  private cancelReconnect(id: string): void {
    const bo = this.backoffs.get(id)
    if (!bo) return
    bo.epoch++
    if (bo.timer != null) { clearTimeout(bo.timer); bo.timer = null }
    this.backoffs.delete(id)
  }

  /** Reset backoff delay to initial on successful connect. */
  private resetBackoff(id: string): void {
    const bo = this.backoffs.get(id)
    if (!bo) return
    if (bo.timer != null) { clearTimeout(bo.timer); bo.timer = null }
    this.backoffs.delete(id)
  }

  /** Store a transient error against a server id for UI display. */
  private storeError(id: string, name: string, message: string): void {
    const sanitized = safeErrorMessage(message)
    const existing = this.conns.get(id)
    if (existing) {
      existing.lastError = sanitized
      return
    }
    if (!this._transientErrors) this._transientErrors = new Map()
    this._transientErrors.set(id, { id, name, status: 'error' as const, toolCount: 0, toolNames: [], lastError: sanitized })
  }
  private _transientErrors?: Map<string, McpServerStatus>

  /** ids of the currently-connected servers (test/diagnostic helper). */
  connectedIds(): string[] {
    return [...this.conns.keys()].sort()
  }

  /** Total number of MCP tools across all connected servers. */
  toolCount(): number {
    let count = 0
    for (const conn of this.conns.values()) {
      count += this.filteredTools(conn).length
    }
    return count
  }

  /** Per-server tool counts (for catalog + UI). */
  toolCounts(): Array<{ serverId: string; serverName: string; count: number }> {
    const out: Array<{ serverId: string; serverName: string; count: number }> = []
    for (const conn of this.conns.values()) {
      const filtered = this.filteredTools(conn)
      if (filtered.length > 0) {
        out.push({ serverId: conn.id, serverName: conn.name, count: filtered.length })
      }
    }
    return out
  }

  /**
   * Compact name-only catalog of all available MCP tools for the system prompt.
   * Format: `<available-mcp-tools>\n- server-name (N tools)\n</available-mcp-tools>`
   * The model uses this + mcp_search to discover tools when in lazy mode.
   */
  toolCatalog(): string {
    const counts = this.toolCounts()
    if (counts.length === 0) return ''
    const lines = counts.map(
      (c) => `- ${c.serverName} (${c.count} tool${c.count !== 1 ? 's' : ''})`,
    )
    return `<available-mcp-tools>\n${lines.join('\n')}\n</available-mcp-tools>`
  }

  /**
   * Detailed catalog: lists every tool name grouped by server (for non-lazy mode or mcp_search results).
   * Includes descriptions when available.
   */
  toolDetailCatalog(filter?: string): string {
    const parts: string[] = []
    const q = filter?.toLowerCase().trim()
    for (const conn of this.conns.values()) {
      const filtered = this.filteredTools(conn).filter(
        (t) => !q || t.name.toLowerCase().includes(q) || (t.description?.toLowerCase().includes(q)),
      )
      if (filtered.length === 0) continue
      parts.push(`## ${conn.name} (${conn.id})`)
      for (const t of filtered) {
        const desc = t.description ? ` — ${t.description}` : ''
        parts.push(`- \`mcp__${conn.id}__${t.name}\`${desc}`)
      }
    }
    return parts.join('\n') || '(no matching MCP tools)'
  }

  /**
   * Connection statuses for all configured servers (connected + errored).
   * For UI display in the McpConfig panel.
   */
  connectionStatuses(knownServers: McpServerConfig[]): McpServerStatus[] {
    const out: McpServerStatus[] = []
    const seen = new Set<string>()

    // Connected servers
    for (const conn of this.conns.values()) {
      seen.add(conn.id)
      const filtered = this.filteredTools(conn)
      out.push({
        id: conn.id,
        name: conn.name,
        status: 'connected',
        toolCount: filtered.length,
        toolNames: filtered.map((t) => t.name),
        lastError: conn.lastError != null ? safeErrorMessage(conn.lastError) : undefined,
      })
    }

    // Transient errors for servers that failed to connect
    if (this._transientErrors) {
      for (const [id, s] of this._transientErrors) {
        if (!seen.has(id)) {
          seen.add(id)
          out.push(s)
        }
      }
    }

    // Known servers not connected (not in conns and not in transient errors)
    for (const server of knownServers) {
      if (!seen.has(server.id) && server.enabled) {
        out.push({
          id: server.id,
          name: server.name,
          status: 'disconnected',
          toolCount: 0,
          toolNames: [],
        })
      }
    }

    return out
  }

  /** Filter a connection's tools by its server config's enabledTools/disabledTools. */
  private filteredTools(conn: Connection): ToolMeta[] {
    const { enabledTools, disabledTools } = conn.serverConfig
    let filtered = conn.tools

    // enabledTools: allowlist (if non-empty, only these are exposed)
    if (enabledTools && enabledTools.length > 0) {
      const allow = new Set(enabledTools)
      filtered = filtered.filter((t) => allow.has(t.name))
    }

    // disabledTools: denylist (applied after allowlist)
    if (disabledTools && disabledTools.length > 0) {
      const deny = new Set(disabledTools)
      filtered = filtered.filter((t) => !deny.has(t.name))
    }

    return filtered
  }

  /** Search all connected server tools by keyword (name + description). */
  private searchAllTools(query: string): ToolMeta[] {
    const q = query.toLowerCase().trim()
    if (!q) return []
    const results: Array<{ tool: ToolMeta; serverId: string }> = []
    for (const conn of this.conns.values()) {
      for (const t of this.filteredTools(conn)) {
        const nameMatch = t.name.toLowerCase().includes(q)
        const descMatch = t.description?.toLowerCase().includes(q)
        if (nameMatch || descMatch) {
          results.push({ tool: t, serverId: conn.id })
        }
      }
    }
    // Sort: name matches first, then description matches
    results.sort((a, b) => {
      const aNameHit = a.tool.name.toLowerCase().includes(q) ? 0 : 1
      const bNameHit = b.tool.name.toLowerCase().includes(q) ? 0 : 1
      if (aNameHit !== bNameHit) return aNameHit - bNameHit
      return a.tool.name.localeCompare(b.tool.name)
    })
    return results.map((r) => r.tool)
  }

  /**
   * Build the `mcp_search` tool — searches tool names and descriptions by keyword,
   * returning matching tools with their server assignments.
   */
  private buildMcpSearchTool(): StructuredToolInterface {
    return tool(
      async ({ query }: { query: string }) => {
        const results = this.searchAllTools(query)
        if (results.length === 0) return `No MCP tools match "${query}".`
        const parts: string[] = []
        for (const r of results) {
          // Find which server this tool belongs to
          for (const conn of this.conns.values()) {
            const match = this.filteredTools(conn).find((t) => t.name === r.name)
            if (match) {
              const ns = `mcp__${conn.id}__${r.name}`
              const desc = r.description ? ` — ${r.description}` : ''
              parts.push(`- \`${ns}\`${desc}`)
              break
            }
          }
        }
        return parts.join('\n')
      },
      {
        name: 'mcp_search',
        description:
          'Search available MCP tools by keyword. Searches tool names and descriptions. ' +
          'Returns matching tools with their server-qualified names (mcp__<server>__<tool>). ' +
          'Use this when you know what kind of tool you need but not its exact name.',
        schema: z.object({
          query: z.string().describe('Keyword to search MCP tool names and descriptions for'),
        }),
      },
    )
  }

  /**
   * Build the `mcp_invoke` proxy tool — invokes a specific MCP tool by server + tool name.
   * Used in lazy mode when individual MCP tools are not registered directly.
   */
  private buildMcpInvokeTool(): StructuredToolInterface {
    const serverIds = [...this.conns.keys()]
    const serverList = serverIds.length > 0 ? serverIds.join(', ') : 'none'
    return tool(
      async ({ serverId, toolName, arguments: args }: { serverId: string; toolName: string; arguments?: Record<string, unknown> }) => {
        const conn = this.conns.get(serverId)
        if (!conn) return `Error: MCP server "${serverId}" is not connected. Known servers: ${serverList}`
        const toolMeta = conn.tools.find((t) => t.name === toolName)
        if (!toolMeta) return `Error: tool "${toolName}" not found on server "${serverId}".`
        try {
          const res = await conn.client.callTool({ name: toolName, arguments: args ?? {} })
          return stringifyToolResult(res)
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
      {
        name: 'mcp_invoke',
        description:
          'Invoke a specific MCP tool by server and tool name. ' +
          `Known server ids: ${serverList}. ` +
          'Use after mcp_search to find the right tool. ' +
          'Arguments are passed directly to the MCP server tool.',
        schema: z.object({
          serverId: z.string().describe(`MCP server id (known: ${serverList})`),
          toolName: z.string().describe('Tool name on the server (without mcp__ prefix)'),
          arguments: z.record(z.string(), z.unknown()).optional(),
        }),
      },
    )
  }

  /**
   * Resolve the lazy threshold from options.
   * Priority: explicit lazyThreshold > contextWindowTokens * pct > DEFAULT_LAZY_THRESHOLD.
   */
  private resolveThreshold(opts?: ToolsOptions): number {
    if (opts?.lazyThreshold !== undefined) return opts.lazyThreshold
    if (opts?.contextWindowTokens) {
      const pct = opts.lazyThresholdPct ?? DEFAULT_LAZY_THRESHOLD_PCT
      return Math.floor(opts.contextWindowTokens * pct / 100)
    }
    return DEFAULT_LAZY_THRESHOLD
  }

  /**
   * Adapt every connected server's tools into namespaced LangChain tools.
   *
   * Filtering: tools are filtered by each server's enabledTools (allowlist) then disabledTools (denylist).
   * Empty allowlist → all tools allowed.
   *
   * Lazy loading: when total filtered tool count >= lazyThreshold, returns proxy tools
   * (mcp_search + mcp_invoke) instead of individual tool wrappers. Below threshold,
   * all tools are pre-loaded as individual LangChain tools.
   *
   * Tool name = `mcp__<serverId>__<toolName>`; the body reverses the namespace and calls client.callTool.
   */
  tools(opts?: ToolsOptions): StructuredToolInterface[] {
    const threshold = this.resolveThreshold(opts)
    const totalCount = this.toolCount()

    // Lazy mode: total tools >= threshold → proxy tools + resource tools
    if (threshold >= 0 && totalCount >= threshold && this.conns.size > 0) {
      const out: StructuredToolInterface[] = [this.buildMcpSearchTool()]
      if (this.conns.size > 0) {
        out.push(this.buildMcpInvokeTool())
      }
      out.push(...this.buildResourceTools())
      return out
    }

    // Pre-load mode: all tools as individual wrappers + resource tools
    const out: StructuredToolInterface[] = []
    for (const conn of this.conns.values()) {
      for (const t of this.filteredTools(conn)) {
        const namespaced = `mcp__${conn.id}__${t.name}`
        const schema = jsonSchemaToZod(t.inputSchema as JsonSchema | undefined)
        out.push(
          tool(
            async (args: Record<string, unknown>) => {
              try {
                const res = await conn.client.callTool({ name: t.name, arguments: args })
                return stringifyToolResult(res)
              } catch (err) {
                return `Error: ${(err as Error).message}`
              }
            },
            {
              name: namespaced,
              description: t.description ?? `MCP tool ${t.name} from server ${conn.id}`,
              schema,
            },
          ),
        )
      }
      // Resource tools (always loaded, not subject to lazy threshold)
      out.push(...this.buildResourceTools())
    }
    return out
  }

  /** Build tool wrappers for all cached MCP resources. */
  private buildResourceTools(): StructuredToolInterface[] {
    const out: StructuredToolInterface[] = []
    for (const conn of this.conns.values()) {
      for (const r of conn.resources ?? []) {
        out.push(
          tool(
            async () => {
              try {
                if (!conn.client.readResource) return 'Error: server does not support readResource'
                const res = await conn.client.readResource({ uri: r.uri })
                return stringifyResourceResult(res)
              } catch (err) {
                return `Error: ${(err as Error).message}`
              }
            },
            {
              name: `mcp__${conn.id}__resource__${sanitizeMcpName(r.name)}`,
              description: r.description ?? `Resource ${r.name} from server ${conn.id}`,
              schema: noArgSchema(),
            },
          ),
        )
      }
    }
    return out
  }

  /** Return all prompts across connected servers. */
  allPrompts(): Array<{ serverId: string; serverName: string; name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }> {
    const out: Array<{ serverId: string; serverName: string; name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }> = []
    for (const conn of this.conns.values()) {
      if (conn.prompts) {
        for (const p of conn.prompts) {
          out.push({ serverId: conn.id, serverName: conn.name, ...p })
        }
      }
    }
    return out
  }

  /** Execute a prompt on a connected server. Returns messages suitable for injecting into a conversation. */
  async executePrompt(serverId: string, name: string, args?: Record<string, string>): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: string }>; error?: string }> {
    const conn = this.conns.get(serverId)
    if (!conn) return { messages: [], error: `Server ${serverId} not connected` }
    if (!conn.client.getPrompt) return { messages: [], error: `Server ${serverId} does not support prompts` }
    try {
      const result = await conn.client.getPrompt({ name, arguments: args })
      return {
        messages: result.messages.map((m) => {
          const text = m.content.type === 'text' ? m.content.text : `[${m.content.type}]`
          return { role: m.role, content: text }
        }),
      }
    } catch (err) {
      return { messages: [], error: (err as Error).message }
    }
  }

  /** Return all resources across connected servers. */
  allResources(): Array<{ serverId: string; serverName: string; uri: string; name: string; description?: string; mimeType?: string }> {
    const out: Array<{ serverId: string; serverName: string; uri: string; name: string; description?: string; mimeType?: string }> = []
    for (const conn of this.conns.values()) {
      if (conn.resources) {
        for (const r of conn.resources) {
          out.push({ serverId: conn.id, serverName: conn.name, ...r })
        }
      }
    }
    return out
  }

  /** Read a resource from a connected server. */
  async readResource(serverId: string, uri: string): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>; error?: string }> {
    const conn = this.conns.get(serverId)
    if (!conn) return { contents: [], error: `Server ${serverId} not connected` }
    if (!conn.client.readResource) return { contents: [], error: `Server ${serverId} does not support resources` }
    try {
      const result = await conn.client.readResource({ uri })
      return { contents: result.contents }
    } catch (err) {
      return { contents: [], error: (err as Error).message }
    }
  }
}

/** Flatten an MCP callTool result (content blocks) into a string for the model. */
function stringifyToolResult(res: unknown): string {
  const r = res as { content?: unknown; isError?: boolean }
  const content = r?.content
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => {
        const block = c as { type?: string; text?: string }
        if (block?.type === 'text' && typeof block.text === 'string') return block.text
        return JSON.stringify(block)
      })
      .join('\n')
    return r?.isError ? `Error: ${parts}` : parts
  }
  return typeof res === 'string' ? res : JSON.stringify(res)
}

/** Flatten an MCP readResource result (contents array) into a string for the model. */
function stringifyResourceResult(res: unknown): string {
  const r = res as { contents?: Array<{ text?: string; blob?: string; uri: string; mimeType?: string }> }
  const contents = r?.contents
  if (!Array.isArray(contents) || contents.length === 0) return '(empty resource)'
  return contents
    .map((c) => {
      if (typeof c.text === 'string') return c.text
      if (typeof c.blob === 'string') return `[base64 blob: ${c.mimeType ?? 'unknown'}]`
      return JSON.stringify(c)
    })
    .join('\n')
}

/** Sanitize an MCP resource/prompt name for use in a tool name (replace non-alphanumeric chars). */
function sanitizeMcpName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/__+/g, '_').replace(/^_|_$/g, '')
}

/** Return a no-argument zod object schema. */
function noArgSchema() {
  return jsonSchemaToZod(undefined)
}

/** Module-level singleton — resident across turns. */
export const mcpManager = new McpManager()
