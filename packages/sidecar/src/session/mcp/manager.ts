import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { McpServerConfig } from '@hip/protocol'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { jsonSchemaToZod, type JsonSchema } from './json-schema-to-zod.js'

/** The slice of the MCP Client surface the manager uses. Lets a Fake stand in for tests. */
export interface ClientLike {
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>
  callTool(req: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
}

/** One connected server: its config fingerprint, the client, and its discovered tools. */
interface Connection {
  id: string
  fingerprint: string
  client: ClientLike
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
}

/** A resident pool of MCP clients. Reconciled per turn against the configured server list. */
export class McpManager {
  private conns = new Map<string, Connection>()

  /** Stable fingerprint for change detection — any field change forces reconnect. */
  protected fingerprint(server: McpServerConfig): string {
    return JSON.stringify(server)
  }

  /**
   * Open a client to `server` and complete the MCP handshake.
   * Overridden in tests to inject a Fake client (no real process/network).
   */
  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    const client = new Client({ name: 'hip', version: '0.1.0' })
    await client.connect(this.buildTransport(server))
    return client as unknown as ClientLike
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
   * reuse unchanged. Never throws — a failing server is logged and skipped (graceful degrade).
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
      }
    }

    // connect: anything wanted that is not already live (reuse skips matched fingerprints above)
    for (const [id, server] of target) {
      if (this.conns.has(id)) continue
      try {
        const client = await this.connect(server)
        const { tools } = await client.listTools()
        this.conns.set(id, { id, fingerprint: this.fingerprint(server), client, tools })
      } catch (err) {
        console.error(`[mcp] failed to connect server ${id} (${server.name}): ${(err as Error).message}`)
      }
    }
  }

  /** ids of the currently-connected servers (test/diagnostic helper). */
  connectedIds(): string[] {
    return [...this.conns.keys()].sort()
  }

  /**
   * Adapt every connected server's tools into namespaced LangChain tools.
   * Tool name = `mcp__<serverId>__<toolName>`; the body reverses the namespace and calls client.callTool.
   */
  tools(): StructuredToolInterface[] {
    const out: StructuredToolInterface[] = []
    for (const conn of this.conns.values()) {
      for (const t of conn.tools) {
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
    }
    return out
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

/** Module-level singleton — resident across turns. */
export const mcpManager = new McpManager()
