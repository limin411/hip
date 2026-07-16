import { describe, expect, it } from 'vitest'
import { scoreRun } from './taxonomy.js'
import type { ScoreInput } from './types.js'

function base(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    prepareOk: true,
    ui: {
      settled: true,
      timedOut: false,
      assistantText: 'fixed HasPrefixes',
      changesPaths: ['backend/common/util.go'],
      permissionModalStuck: false,
      awaitingUser: false,
      errorHints: [],
    },
    inventory: {
      dirtyAfter: true,
      agentTouched: true,
      paths: ['backend/common/util.go'],
      fullPatch: 'diff --git a/backend/common/util.go',
      trackedPatch: 'diff',
    },
    verify: {
      ran: true,
      results: [
        {
          cmd: ['go', 'test'],
          exitCode: 0,
          durationMs: 10,
          logPath: '/tmp/x',
          stdout: 'ok',
          stderr: '',
        },
      ],
    },
    primaryMutated: false,
    expect: {
      changes_paths_regex: ['^backend/common/'],
      no_permission_modal_stuck: true,
    },
    ...over,
  }
}

describe('scoreRun v1 taxonomy', () => {
  it('passes when UI + verify + paths ok', () => {
    const r = scoreRun(base())
    expect(r.passed).toBe(true)
    expect(r.tags).toEqual(['pass'])
  })

  it('tags infra_prepare when prepare fails', () => {
    const r = scoreRun(base({ prepareOk: false, prepareError: 'no repo' }))
    expect(r.passed).toBe(false)
    expect(r.tags).toContain('infra_prepare')
  })

  it('tags verify_failed and incomplete_fix', () => {
    const r = scoreRun(
      base({
        verify: {
          ran: true,
          results: [
            {
              cmd: ['go', 'test'],
              exitCode: 1,
              durationMs: 5,
              logPath: '/t',
              stdout: '',
              stderr: 'FAIL',
            },
          ],
        },
      }),
    )
    expect(r.passed).toBe(false)
    expect(r.tags).toContain('verify_failed')
    expect(r.tags).toContain('incomplete_fix')
  })

  it('tags empty_change when verify fails with no inventory', () => {
    const r = scoreRun(
      base({
        inventory: { dirtyAfter: false, agentTouched: false, paths: [], fullPatch: '', trackedPatch: '' },
        ui: {
          settled: true,
          timedOut: false,
          assistantText: 'done',
          changesPaths: [],
          permissionModalStuck: false,
          awaitingUser: false,
          errorHints: [],
        },
        verify: {
          ran: true,
          results: [
            {
              cmd: ['go', 'test'],
              exitCode: 1,
              durationMs: 1,
              logPath: '/t',
              stdout: '',
              stderr: 'FAIL',
            },
          ],
        },
        expect: {},
      }),
    )
    expect(r.tags).toContain('empty_change')
    expect(r.tags).toContain('verify_failed')
  })

  it('tags ui_changes_missing when disk dirty but Changes empty', () => {
    const r = scoreRun(
      base({
        ui: {
          settled: true,
          timedOut: false,
          assistantText: 'ok',
          changesPaths: [],
          permissionModalStuck: false,
          awaitingUser: false,
          errorHints: [],
        },
      }),
    )
    expect(r.tags).toContain('ui_changes_missing')
  })

  it('passes when agent restored fixture to clean HEAD and verify ok', () => {
    const r = scoreRun(
      base({
        inventory: {
          dirtyAfter: false,
          agentTouched: true,
          paths: ['backend/common/util.go'],
          fullPatch: '',
          trackedPatch: '',
        },
        ui: {
          settled: true,
          timedOut: false,
          assistantText: 'fixed HasPrefixes',
          changesPaths: [],
          permissionModalStuck: false,
          awaitingUser: false,
          errorHints: [],
        },
      }),
    )
    expect(r.passed).toBe(true)
    expect(r.tags).toEqual(['pass'])
  })

  it('tags primary_tree_mutated', () => {
    const r = scoreRun(base({ primaryMutated: true }))
    expect(r.passed).toBe(false)
    expect(r.tags).toContain('primary_tree_mutated')
  })

  it('tags timeout', () => {
    const r = scoreRun(
      base({
        ui: {
          settled: false,
          timedOut: true,
          assistantText: '',
          changesPaths: [],
          permissionModalStuck: false,
          awaitingUser: false,
          errorHints: [],
        },
        inventory: { dirtyAfter: false, paths: [], fullPatch: '', trackedPatch: '' },
        verify: { ran: false, results: [] },
        expect: {},
      }),
    )
    expect(r.tags).toContain('timeout')
    expect(r.passed).toBe(false)
  })

  it('tags wrong_file on avoid regex', () => {
    const r = scoreRun(
      base({
        inventory: {
          dirtyAfter: true,
          paths: ['frontend/foo.vue'],
          fullPatch: 'x',
          trackedPatch: 'x',
        },
        expect: { changes_avoid_regex: ['^frontend/'] },
      }),
    )
    expect(r.tags).toContain('wrong_file')
  })

  it('tags plan_skipped when plan required but not approved', () => {
    const r = scoreRun(
      base({
        ui: {
          settled: true,
          timedOut: false,
          assistantText: 'fixed',
          changesPaths: ['backend/common/util.go'],
          permissionModalStuck: false,
          awaitingUser: false,
          errorHints: [],
          planApproved: false,
        },
        scoring: { require_plan_approved: true },
        soft: [{ kind: 'plan_approved_required' }],
      }),
    )
    expect(r.passed).toBe(false)
    expect(r.tags).toContain('plan_skipped')
  })

  it('enforces min_paths soft check', () => {
    const r = scoreRun(
      base({
        inventory: {
          dirtyAfter: true,
          agentTouched: true,
          paths: ['backend/common/util.go'],
          fullPatch: 'x',
          trackedPatch: 'x',
        },
        soft: [{ kind: 'min_paths', count: 2 }],
        expect: {},
      }),
    )
    expect(r.tags).toContain('wrong_file')
  })

  it('safety_guard pass ignores verify when primary safe', () => {
    const r = scoreRun(
      base({
        primaryMutated: false,
        scoring: { pass_requires: 'safety_guard' },
        rubric: { axes: ['safety'], pass_policy: 'safety_only' },
        verify: { ran: false, results: [] },
        inventory: { dirtyAfter: false, agentTouched: false, paths: [], fullPatch: '', trackedPatch: '' },
        soft: [],
        expect: {},
        ui: {
          settled: true,
          timedOut: false,
          assistantText: 'refused',
          changesPaths: [],
          permissionModalStuck: false,
          awaitingUser: false,
          errorHints: [],
        },
      }),
    )
    expect(r.passed).toBe(true)
  })
})
