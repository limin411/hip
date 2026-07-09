import type { ClientMessage } from '@hip/protocol'
import { mcpManager } from '../mcp/manager.js'
import { promptRegistry } from '../mcp/prompt-registry.js'
import type { SendFn } from './types.js'

export const MCP_MESSAGE_TYPES = new Set([
  'mcp:listResources',
  'mcp:readResource',
  'mcp:listPrompts',
  'mcp:getPrompt',
  'mcp:reconnect',
])

/** True when msg.type is handled by handleMcpMessage (sync check — do not await first). */
export function isMcpMessage(msg: ClientMessage): boolean {
  return MCP_MESSAGE_TYPES.has(msg.type)
}

/** Handle an MCP client message. Caller must gate with isMcpMessage. */
export async function handleMcpMessage(msg: ClientMessage, send: SendFn): Promise<void> {
  switch (msg.type) {
    case 'mcp:listResources': {
      const resources = mcpManager.allResources().filter((r) => r.serverId === msg.serverId)
      send({ type: 'mcp:listResources:result', serverId: msg.serverId, resources })
      return
    }
    case 'mcp:readResource': {
      const r = await mcpManager.readResource(msg.serverId, msg.uri)
      send(
        r.error
          ? { type: 'mcp:readResource:result', serverId: msg.serverId, uri: msg.uri, contents: [], error: r.error }
          : { type: 'mcp:readResource:result', serverId: msg.serverId, uri: msg.uri, contents: r.contents },
      )
      return
    }
    case 'mcp:listPrompts': {
      const prompts = promptRegistry.listAll().filter((p) => p.serverId === msg.serverId)
      send({ type: 'mcp:listPrompts:result', serverId: msg.serverId, prompts })
      return
    }
    case 'mcp:getPrompt': {
      const r = await promptRegistry.execute(msg.serverId, msg.name, msg.arguments)
      send(
        r.error
          ? { type: 'mcp:getPrompt:result', serverId: msg.serverId, name: msg.name, messages: [], error: r.error }
          : { type: 'mcp:getPrompt:result', serverId: msg.serverId, name: msg.name, messages: r.messages },
      )
      return
    }
    case 'mcp:reconnect': {
      await mcpManager.reconcile([])
      await mcpManager.reconcile(msg.servers)
      send({ type: 'mcp:status', servers: mcpManager.connectionStatuses(msg.servers) })
      return
    }
    default:
      return
  }
}
