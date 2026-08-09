import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import type { StructuredToolInterface } from '@langchain/core/tools'

const mockToolInvoke = vi.fn()

const fakePluginInstallTool = {
  name: 'plugin_install',
  invoke: mockToolInvoke,
} as unknown as StructuredToolInterface

vi.mock('./tools.js', () => ({
  buildTools: vi.fn(() => [fakePluginInstallTool]),
  SELF_GATED_TOOLS: new Set(['run_script']),
}))

import { SessionManager } from './session-manager.js'

function mk(scratchRoot: string) {
  const mgr = new SessionManager(undefined, undefined, scratchRoot)
  return { mgr }
}

describe('plugin:install:url handler', () => {
  let mgr: SessionManager
  let sent: ServerMessage[]
  let scratchRoot: string
  const send = (m: ServerMessage) => { sent.push(m) }

  beforeEach(() => {
    scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-plug-inst-'))
    ;({ mgr } = mk(scratchRoot))
    sent = []
    mockToolInvoke.mockReset()
  })

  afterEach(() => {
    rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('invokes plugin_install tool and returns ok: true with progress messages', async () => {
    mockToolInvoke.mockResolvedValue(JSON.stringify({
      ok: true,
      pluginId: 'test-plugin',
      components: { skills: 1, mcpServers: 0, agents: 0, hooks: 0 },
    }))

    await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/test/plugin.git' }, send)

    const progressMsgs = sent.filter((m) => m.type === 'plugin:install:progress')
    expect(progressMsgs.length).toBeGreaterThanOrEqual(2)
    expect(progressMsgs[0]!.status).toBe('cloning')

    const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
    expect(resultMsg).toBeDefined()
    if (resultMsg?.type === 'plugin:install:result') {
      expect(resultMsg.ok).toBe(true)
      expect(resultMsg.pluginId).toBe('test-plugin')
    }

    expect(mockToolInvoke).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://github.com/test/plugin.git' }))
    expect(mockToolInvoke).toHaveBeenCalledTimes(1)
  })

  it('returns ok: false for non-https URL without invoking tool', async () => {
    await mgr.handleAsync({ type: 'plugin:install:url', url: 'file:///etc/passwd' }, send)

    const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
    expect(resultMsg).toBeDefined()
    if (resultMsg?.type === 'plugin:install:result') {
      expect(resultMsg.ok).toBe(false)
      expect(resultMsg.error).toContain('https')
    }

    expect(mockToolInvoke).not.toHaveBeenCalled()
  })

  it('returns ok: false for empty URL', async () => {
    await mgr.handleAsync({ type: 'plugin:install:url', url: '' }, send)

    const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
    expect(resultMsg).toBeDefined()
    if (resultMsg?.type === 'plugin:install:result') {
      expect(resultMsg.ok).toBe(false)
      expect(resultMsg.error).toContain('required')
    }
  })

  it('returns ok: false on tool failure with error progress', async () => {
    mockToolInvoke.mockResolvedValue(JSON.stringify({
      ok: false,
      error: 'git clone failed: repo not found',
    }))

    await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/nonexistent/repo.git' }, send)

    const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
    expect(resultMsg).toBeDefined()
    if (resultMsg?.type === 'plugin:install:result') {
      expect(resultMsg.ok).toBe(false)
      expect(resultMsg.error).toContain('git clone failed')
    }

    const errorProgress = sent.find((m) => m.type === 'plugin:install:progress' && m.status === 'error')
    expect(errorProgress).toBeDefined()
  })

  it('does not require an existing session (global operation)', async () => {
    mockToolInvoke.mockResolvedValue(JSON.stringify({
      ok: true,
      pluginId: 'global-test',
      components: { skills: 0, mcpServers: 1, agents: 0, hooks: 0 },
    }))

    // No session:create call — handler works standalone
    await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/test/plugin.git' }, send)

    const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
    expect(resultMsg).toBeDefined()
    if (resultMsg?.type === 'plugin:install:result') {
      expect(resultMsg.ok).toBe(true)
    }

    // Should not have sent any session-related messages
    expect(sent.find((m) => m.type === 'session:created')).toBeUndefined()
  })

  it('sends progress messages before final result', async () => {
    mockToolInvoke.mockResolvedValue(JSON.stringify({
      ok: true,
      pluginId: 'ordered-test',
      components: { skills: true, mcpServers: true, agents: false, hooks: false },
    }))

    await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/test/ordered.git' }, send)

    // Progress messages must appear before the result
    const firstProgressIdx = sent.findIndex((m) => m.type === 'plugin:install:progress')
    const lastProgressIdx = sent.map((m) => m.type).lastIndexOf('plugin:install:progress')
    const resultIdx = sent.findIndex((m) => m.type === 'plugin:install:result')

    expect(firstProgressIdx).toBeGreaterThanOrEqual(0)
    expect(lastProgressIdx).toBeGreaterThanOrEqual(0)
    expect(resultIdx).toBeGreaterThan(lastProgressIdx)
  })
})
