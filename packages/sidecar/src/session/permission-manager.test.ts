import { describe, it, expect, vi } from 'vitest'
import type { ServerMessage, PermissionMode, PermissionOption } from '@hip/protocol'
import { PermissionManager } from './permission-manager.js'
import { SessionApprovalCache } from './tool-runner/approval-cache.js'
import type { ApprovalDecision } from './tools.js'

type SendFn = (msg: ServerMessage) => void

function makePermissionMode(): PermissionMode {
  return 'edit'
}
function setPermissionMode(_mode: PermissionMode): boolean {
  return true
}

/** Drive the ApprovalFn returned by buildHitlApproval and return what it resolves to.
 *  Uses respondPermission to simulate the user choice after the pending promise is registered. */
async function driveApproval(
  mgr: PermissionManager,
  optionId: string,
  cancelled?: boolean,
): Promise<ApprovalDecision> {
  const send = vi.fn<SendFn>()
  const approvalFn = mgr.buildHitlApproval(send, 's1', 't1', () => 0)

  // Start the approval — it registers a pending permission and sends permission:request
  const resultPromise = approvalFn({ title: 'test-tool', kind: 'execute', content: 'ls' })

  // Wait microtask so the promise executor runs and pendingPermissions is populated
  await vi.waitFor(() => mgr.pendingPermissions.size > 0, { timeout: 100 })

  const requestId = [...mgr.pendingPermissions.keys()][0]
  if (cancelled) {
    mgr.respondPermission(requestId, { cancelled: true })
  } else {
    mgr.respondPermission(requestId, { optionId })
  }

  return resultPromise
}

// ---------------------------------------------------------------------------
describe('PermissionManager — recordApproved / isApproved (cache delegation)', () => {
  it('recordApproved writes allow_always to cache and isApproved returns true', () => {
    const cache = new SessionApprovalCache()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    mgr.setApprovalCache(cache)

    expect(mgr.isApproved('run_script')).toBe(false)
    mgr.recordApproved('run_script')
    expect(mgr.isApproved('run_script')).toBe(true)
  })

  it('isApproved returns false for a tool not previously recorded', () => {
    const cache = new SessionApprovalCache()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    mgr.setApprovalCache(cache)

    mgr.recordApproved('foo')
    expect(mgr.isApproved('bar')).toBe(false)
  })

  it('isApproved returns false when no cache is set', () => {
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    expect(mgr.isApproved('any-tool')).toBe(false)
  })

  it('recordApproved is a no-op when no cache is set (no throw)', () => {
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    expect(() => mgr.recordApproved('x')).not.toThrow()
  })

  it('last write wins for recordApproved (cache overwrite)', () => {
    const cache = new SessionApprovalCache()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    mgr.setApprovalCache(cache)

    cache.set('tool', undefined, { kind: 'reject_always' })
    expect(mgr.isApproved('tool')).toBe(false)

    mgr.recordApproved('tool')
    expect(mgr.isApproved('tool')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('PermissionManager — clearApprovedGrants (cache delegation)', () => {
  it('clears all entries from the cache', () => {
    const cache = new SessionApprovalCache()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    mgr.setApprovalCache(cache)

    mgr.recordApproved('a')
    mgr.recordApproved('b')
    cache.set('c', { x: 1 }, { kind: 'reject_always' })

    mgr.clearApprovedGrants()
    expect(mgr.isApproved('a')).toBe(false)
    expect(mgr.isApproved('b')).toBe(false)
    expect(cache.lookup('c', { x: 1 })).toBeUndefined()
  })

  it('clearApprovedGrants is a no-op when no cache is set', () => {
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    expect(() => mgr.clearApprovedGrants()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
describe('PermissionManager — buildHitlApproval with sticky disabled (default)', () => {
  it('returns only allow_once and reject_once options in the permission:request', async () => {
    const send = vi.fn<SendFn>()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    const approvalFn = mgr.buildHitlApproval(send, 's1', 't1', () => 0)

    const resultPromise = approvalFn({ title: 'test', kind: 'execute' })
    // Wait microtask
    await vi.waitFor(() => mgr.pendingPermissions.size > 0, { timeout: 100 })

    const requestId = [...mgr.pendingPermissions.keys()][0]
    mgr.respondPermission(requestId, { optionId: 'allow_once' })

    await expect(resultPromise).resolves.toEqual({ kind: 'allow_once' })

    const sent = send.mock.calls[0][0] as Extract<ServerMessage, { type: 'permission:request' }>
    expect(sent.type).toBe('permission:request')
    expect(sent.options).toHaveLength(2)
    const kinds = sent.options.map((o: PermissionOption) => o.kind)
    expect(kinds).toEqual(['allow_once', 'reject_once'])
  })

  it('reject_once option resolves with reject_once kind', async () => {
    const decision = await driveApproval(
      new PermissionManager(makePermissionMode, setPermissionMode),
      'reject_once',
    )
    expect(decision).toEqual({ kind: 'reject_once' })
  })

  it('cancelled resolves with { cancelled: true }', async () => {
    const decision = await driveApproval(
      new PermissionManager(makePermissionMode, setPermissionMode),
      '',
      true,
    )
    expect(decision).toEqual({ cancelled: true })
  })
})

// ---------------------------------------------------------------------------
describe('PermissionManager — buildHitlApproval with sticky enabled', () => {
  it('returns all 4 options (allow_once, reject_once, allow_always, reject_always)', async () => {
    const send = vi.fn<SendFn>()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode, { enableStickyApproval: true })
    const approvalFn = mgr.buildHitlApproval(send, 's1', 't1', () => 0)

    const resultPromise = approvalFn({ title: 'test', kind: 'execute' })
    await vi.waitFor(() => mgr.pendingPermissions.size > 0, { timeout: 100 })

    const requestId = [...mgr.pendingPermissions.keys()][0]
    mgr.respondPermission(requestId, { optionId: 'allow_once' })
    await resultPromise

    const sent = send.mock.calls[0][0] as Extract<ServerMessage, { type: 'permission:request' }>
    const kinds = sent.options.map((o: PermissionOption) => o.kind)
    expect(kinds).toEqual(['allow_once', 'reject_once', 'allow_always', 'reject_always'])
  })

  it('selecting allow_always returns allow_always but does NOT write to the cache (ToolRunner owns caching)', async () => {
    const cache = new SessionApprovalCache()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode, { enableStickyApproval: true })
    mgr.setApprovalCache(cache)

    const decision = await driveApproval(mgr, 'allow_always')
    expect(decision).toEqual({ kind: 'allow_always' })
    expect(cache.lookup('test-tool', undefined)).toBeUndefined()
  })

  it('selecting reject_always returns reject_always but does NOT write to the cache (ToolRunner owns caching)', async () => {
    const cache = new SessionApprovalCache()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode, { enableStickyApproval: true })
    mgr.setApprovalCache(cache)

    const decision = await driveApproval(mgr, 'reject_always')
    expect(decision).toEqual({ kind: 'reject_always' })
    expect(cache.lookup('test-tool', undefined)).toBeUndefined()
  })

  it('selecting allow_once does NOT write to the cache', async () => {
    const cache = new SessionApprovalCache()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode, { enableStickyApproval: true })
    mgr.setApprovalCache(cache)

    await driveApproval(mgr, 'allow_once')
    expect(cache.lookup('test-tool', undefined)).toBeUndefined()
  })

  it('selecting reject_once does NOT write to the cache', async () => {
    const cache = new SessionApprovalCache()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode, { enableStickyApproval: true })
    mgr.setApprovalCache(cache)

    await driveApproval(mgr, 'reject_once')
    expect(cache.lookup('test-tool', undefined)).toBeUndefined()
  })

  it('cancelled decision does NOT write to the cache', async () => {
    const cache = new SessionApprovalCache()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode, { enableStickyApproval: true })
    mgr.setApprovalCache(cache)

    const decision = await driveApproval(mgr, '', true)
    expect(decision).toEqual({ cancelled: true })
    expect(cache.lookup('test-tool', undefined)).toBeUndefined()
  })

  it('sticky cache works WITHOUT approvalCache set (no throw, just no-op)', async () => {
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode, { enableStickyApproval: true })
    // No setApprovalCache call — should not throw
    const decision = await driveApproval(mgr, 'allow_always')
    expect(decision).toEqual({ kind: 'allow_always' })
  })
})
