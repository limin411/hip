import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CAN_SYMLINK, IS_POSIX, IS_WIN32, rmRetrySync } from '../../test/env.js'
import { symlinkSync, unlinkSync, existsSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike } from './manager.js'

/** A Fake MCP client: records calls, returns a fixed tool list, never touches the network. */
class FakeClient implements ClientLike {
  closed = false
  callArgs: Array<{ name: string; arguments?: Record<string, unknown> }> = []
  constructor(
    private readonly toolList: Array<{ name: string; description?: string; inputSchema?: unknown }>,
    private readonly callResult: unknown = { content: [{ type: 'text', text: 'ok' }] },
    private readonly listToolsFails = false,
  ) {}
  async listTools() {
    if (this.listToolsFails) throw new Error('listTools boom')
    return { tools: this.toolList }
  }
  async callTool(req: { name: string; arguments?: Record<string, unknown> }) { this.callArgs.push(req); return this.callResult }
  async close() { this.closed = true }
}

/** A test manager that injects Fake clients instead of spawning processes / opening sockets. */
class TestManager extends McpManager {
  connectCount = 0
  lastClients = new Map<string, FakeClient>()
  failIds = new Set<string>()
  /** ids whose connect() succeeds but listTools() then rejects (the narrow leak window). */
  listToolsFailIds = new Set<string>()
  toolsById: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>> = {}

  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    this.connectCount++
    if (this.failIds.has(server.id)) throw new Error('connect boom')
    const client = new FakeClient(
      this.toolsById[server.id] ?? [{ name: 'do_thing' }],
      undefined,
      this.listToolsFailIds.has(server.id),
    )
    this.lastClients.set(server.id, client)
    return client
  }

  async testResolve(command: string | undefined, args?: string[]) {
    return this.resolveStdioCommand(command, args)
  }
}

const stdio = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['a.js'], enabled: true, ...over,
})

let mgr: TestManager
beforeEach(() => { mgr = new TestManager(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('McpManager.reconcile', () => {
  it('connects newly-enabled servers and exposes their ids', async () => {
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s1', 's2'])
    expect(mgr.connectCount).toBe(2)
  })

  it('skips disabled servers', async () => {
    await mgr.reconcile([stdio({ id: 's1', enabled: false }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s2'])
  })

  it('reuses an unchanged server without reconnecting', async () => {
    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectCount).toBe(1)
    await mgr.reconcile([stdio({ id: 's1' })]) // identical config
    expect(mgr.connectCount).toBe(1)            // not reconnected
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('disconnects servers that were removed', async () => {
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const c1 = mgr.lastClients.get('s1')!
    await mgr.reconcile([stdio({ id: 's2' })])
    expect(c1.closed).toBe(true)
    expect(mgr.connectedIds()).toEqual(['s2'])
  })

  it('disconnects servers that were disabled', async () => {
    await mgr.reconcile([stdio({ id: 's1' })])
    const c1 = mgr.lastClients.get('s1')!
    await mgr.reconcile([stdio({ id: 's1', enabled: false })])
    expect(c1.closed).toBe(true)
    expect(mgr.connectedIds()).toEqual([])
  })

  it('reconnects a server whose config changed (fingerprint differs)', async () => {
    await mgr.reconcile([stdio({ id: 's1', args: ['a.js'] })])
    const c1 = mgr.lastClients.get('s1')!
    await mgr.reconcile([stdio({ id: 's1', args: ['b.js'] })]) // changed args
    expect(c1.closed).toBe(true)        // old client closed
    expect(mgr.connectCount).toBe(2)    // reconnected
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('graceful-degrades: a failing server is skipped, others still connect', async () => {
    mgr.failIds.add('s1')
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s2'])
    expect(console.error).toHaveBeenCalled()
  })

  it('never throws when every server fails', async () => {
    mgr.failIds.add('s1')
    await expect(mgr.reconcile([stdio({ id: 's1' })])).resolves.toBeUndefined()
    expect(mgr.connectedIds()).toEqual([])
  })

  it('closes the client if listTools fails after a successful connect (no leak)', async () => {
    mgr.listToolsFailIds.add('s1')
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const c1 = mgr.lastClients.get('s1')!
    expect(c1.closed).toBe(true)              // just-opened client was closed, not leaked
    expect(mgr.connectedIds()).toEqual(['s2']) // s1 skipped, s2 still connects
    expect(console.error).toHaveBeenCalled()
  })
})

describe('McpManager.tools', () => {
  it('namespaces each connected tool as mcp__<serverId>__<toolName>', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }], s2: [{ name: 'fetch' }] }
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const names = mgr.tools().map((t) => t.name).sort()
    expect(names).toEqual(['mcp__s1__search', 'mcp__s2__fetch'])
  })

  it('invoking a namespaced tool calls the right server with the un-namespaced name + args', async () => {
    mgr.toolsById = {
      s1: [{ name: 'add', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }],
    }
    await mgr.reconcile([stdio({ id: 's1' })])
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__add')!
    const out = String(await t.invoke({ a: 1, b: 2 }))
    const client = mgr.lastClients.get('s1')!
    expect(client.callArgs).toEqual([{ name: 'add', arguments: { a: 1, b: 2 } }])
    expect(out).toBe('ok') // FakeClient default content => "ok"
  })

  it('flattens multiple text content blocks', async () => {
    mgr.toolsById = { s1: [{ name: 'd' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    // swap the fake's call result to a multi-block payload
    const client = mgr.lastClients.get('s1')!
    ;(client as unknown as { callTool: (r: unknown) => Promise<unknown> }).callTool = async () => ({
      content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }],
    })
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__d')!
    expect(String(await t.invoke({}))).toBe('line1\nline2')
  })

  it('surfaces an MCP isError result as an Error string', async () => {
    mgr.toolsById = { s1: [{ name: 'boom' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const client = mgr.lastClients.get('s1')!
    ;(client as unknown as { callTool: (r: unknown) => Promise<unknown> }).callTool = async () => ({
      isError: true, content: [{ type: 'text', text: 'tool blew up' }],
    })
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__boom')!
    expect(String(await t.invoke({}))).toMatch(/^Error: tool blew up/)
  })

  it('a callTool rejection is caught and returned as an Error string', async () => {
    mgr.toolsById = { s1: [{ name: 'flaky' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const client = mgr.lastClients.get('s1')!
    ;(client as unknown as { callTool: (r: unknown) => Promise<unknown> }).callTool = async () => { throw new Error('network down') }
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__flaky')!
    expect(String(await t.invoke({}))).toBe('Error: network down')
  })

  it('returns [] when nothing is connected', () => {
    expect(mgr.tools()).toEqual([])
  })
})

describe('McpManager.resolveStdioCommand', () => {
  let pathDir = ''
  const originalPath = process.env.PATH
  const originalPathExt = process.env.PATHEXT

  beforeEach(() => {
    pathDir = mkdtempSync(path.join(os.tmpdir(), 'hip-mcp-path-'))
    process.env.PATH = pathDir
    delete process.env.PATHEXT
  })
  afterEach(() => {
    process.env.PATH = originalPath
    if (originalPathExt === undefined) delete process.env.PATHEXT
    else process.env.PATHEXT = originalPathExt
    rmRetrySync(pathDir)
  })

  /** Drop a stub runner on the (temp) PATH so resolution is deterministic on any platform. */
  const stubRunner = (name: string): string => {
    const file = path.join(pathDir, IS_WIN32 ? `${name}.exe` : name)
    writeFileSync(file, IS_WIN32 ? '' : '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    return file
  }
  /** Error text of a rejected resolution (asserting ok===false first). */
  const errorOf = (r: Awaited<ReturnType<TestManager['testResolve']>>): string => {
    expect(r.ok).toBe(false)
    return r.ok ? '' : r.error
  }

  it.skipIf(!IS_POSIX)('accepts /usr/bin/env (allowed directory)', async () => {
    const result = await mgr.testResolve('/usr/bin/env')
    expect(result.ok).toBe(true)
  })

  it('rejects /tmp/malicious (not in allowed directories)', async () => {
    expect(errorOf(await mgr.testResolve('/tmp/malicious'))).toMatch(/does not exist or cannot be resolved/)
  })

  it('rejects a bare command that is not a package runner', async () => {
    expect(errorOf(await mgr.testResolve('curl'))).toMatch(/package runner/)
  })

  it('resolves a package runner from PATH (market + plugin drafts use bare names)', async () => {
    const stub = stubRunner('docker')
    const result = await mgr.testResolve('docker', ['run', '-i', '--rm', 'img'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.command).toBe(realpathSync(stub))
      expect(result.args).toEqual(['run', '-i', '--rm', 'img'])
    }
  })

  it('reports a package runner that is not installed', async () => {
    expect(errorOf(await mgr.testResolve('uvx'))).toMatch(/not found on PATH/)
  })

  it.skipIf(!IS_WIN32)('relaunches an npx .cmd shim as node + npx-cli.js (never a shell)', async () => {
    mkdirSync(path.join(pathDir, 'node_modules', 'npm', 'bin'), { recursive: true })
    writeFileSync(path.join(pathDir, 'npx.cmd'), '@ECHO off\r\n')
    writeFileSync(path.join(pathDir, 'node.exe'), '')
    const entry = path.join(pathDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')
    writeFileSync(entry, '')
    const result = await mgr.testResolve('npx', ['-y', 'chrome-devtools-mcp@1.7.0'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.command).toBe(path.join(pathDir, 'node.exe'))
      expect(result.args).toEqual([entry, '-y', 'chrome-devtools-mcp@1.7.0'])
    }
  })

  it.skipIf(!IS_WIN32)('rejects a .cmd shim it cannot relaunch without a shell', async () => {
    writeFileSync(path.join(pathDir, 'uvx.cmd'), '@ECHO off\r\n')
    expect(errorOf(await mgr.testResolve('uvx'))).toMatch(/without a shell/)
  })

  it.skipIf(!IS_POSIX)('rejects path traversal like /usr/bin/../tmp/malicious', async () => {
    expect(errorOf(await mgr.testResolve('/usr/bin/../tmp/malicious'))).toMatch(/does not exist or cannot be resolved/)
  })

  it.skipIf(!CAN_SYMLINK)('accepts a symlink whose realpath falls inside an allowed directory', async () => {
    const target = '/usr/bin/env'
    const link = path.join(os.tmpdir(), 'hip-test-allowed-link')
    try { symlinkSync(target, link) } catch { /* may already exist */ }
    try {
      const result = await mgr.testResolve(link)
      expect(result.ok).toBe(true)
    } finally {
      try { unlinkSync(link) } catch { /* best-effort cleanup */ }
    }
  })

  it.skipIf(!CAN_SYMLINK)('rejects a symlink whose realpath falls outside allowed directories', async () => {
    const target = path.join(os.tmpdir(), 'hip-test-evil-target')
    // Create a real file outside allowed dirs so realpath succeeds but the check fails
    try {
      writeFileSync(target, '#!/bin/sh\necho pwned\n', { mode: 0o755 })
    } catch { /* ok if exists */ }
    const link = path.join(os.tmpdir(), 'hip-test-malicious-link')
    try { symlinkSync(target, link) } catch { /* may already exist */ }
    try {
      expect(errorOf(await mgr.testResolve(link))).toMatch(/not in the allowed directory list/)
    } finally {
      try { unlinkSync(link) } catch { /* best-effort */ }
      try { unlinkSync(target) } catch { /* best-effort */ }
    }
  })
})

class RedactionTestManager extends McpManager {
  errorMsg = ''
  protected async connect(_server: McpServerConfig): Promise<ClientLike> {
    throw new Error(this.errorMsg)
  }
}

describe('McpManager.connectionStatuses error redaction', () => {
  it('redacts API keys from lastError', async () => {
    const rmgr = new RedactionTestManager()
    rmgr.errorMsg = 'Auth failed: invalid key sk-abc12345678901234567890 in config'
    await rmgr.reconcile([stdio({ id: 'err-svr', name: 'Err' })])
    const statuses = rmgr.connectionStatuses([stdio({ id: 'err-svr', name: 'Err' })])
    expect(statuses).toHaveLength(1)
    expect(statuses[0].status).toBe('error')
    expect(statuses[0].lastError).toContain('[REDACTED]')
    expect(statuses[0].lastError).not.toContain('sk-abc12345678901234567890')
  })
})
