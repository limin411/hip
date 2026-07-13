import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_STEPS,
  MAX_STEPS_NOTE,
  recursionLimit,
  CHILD_MAX_STEPS,
  EXPLORE_CHILD_MAX_STEPS,
  MAX_DEPTH,
  childMaxStepsForAgent,
  childMaxStepsFromConfig,
  maxStepsFromConfig,
  maxStepsForSession,
  maxDepthFromConfig,
  maxDepthForSession,
} from './loop-control.js'

describe('loop-control', () => {
  it('caps supervisor steps and reserves graph recursion headroom above 3x', () => {
    expect(MAX_STEPS).toBe(800)
    expect(recursionLimit()).toBe(MAX_STEPS * 3 + 10)
  })

  it('recursionLimit accepts a custom maxSteps for sub-agents', () => {
    expect(CHILD_MAX_STEPS).toBe(25)
    expect(recursionLimit(CHILD_MAX_STEPS)).toBe(CHILD_MAX_STEPS * 3 + 10)
    expect(recursionLimit(5)).toBe(25)
  })

  it('gives explore a higher child step budget than generic workers', () => {
    expect(EXPLORE_CHILD_MAX_STEPS).toBe(40)
    expect(EXPLORE_CHILD_MAX_STEPS).toBeGreaterThan(CHILD_MAX_STEPS)
    expect(childMaxStepsFromConfig('explore')).toBe(EXPLORE_CHILD_MAX_STEPS)
    expect(childMaxStepsFromConfig('coder')).toBe(CHILD_MAX_STEPS)
    expect(childMaxStepsFromConfig('worker-1')).toBe(CHILD_MAX_STEPS)
  })

  it('defaults match constants when agentLoop is empty or null', () => {
    expect(childMaxStepsFromConfig('explore', {})).toBe(EXPLORE_CHILD_MAX_STEPS)
    expect(childMaxStepsFromConfig('coder', {})).toBe(CHILD_MAX_STEPS)
    expect(childMaxStepsFromConfig('explore', null)).toBe(EXPLORE_CHILD_MAX_STEPS)
    expect(childMaxStepsFromConfig('coder', null)).toBe(CHILD_MAX_STEPS)
    expect(maxStepsFromConfig({})).toBe(MAX_STEPS)
    expect(maxStepsFromConfig(null)).toBe(MAX_STEPS)
    expect(maxDepthFromConfig({})).toBe(MAX_DEPTH)
    expect(maxDepthFromConfig(null)).toBe(MAX_DEPTH)
  })

  it('honors agentLoop overrides for child and explore budgets', () => {
    const loop = { childMaxSteps: 10, exploreChildMaxSteps: 50 }
    expect(childMaxStepsFromConfig('explore', loop)).toBe(50)
    expect(childMaxStepsFromConfig('coder', loop)).toBe(10)
    expect(childMaxStepsFromConfig('worker-1', loop)).toBe(10)
  })

  it('honors agentLoop overrides for maxSteps and maxDepth', () => {
    expect(maxStepsFromConfig({ maxSteps: 120 })).toBe(120)
    expect(maxDepthFromConfig({ maxDepth: 5 })).toBe(5)
  })

  it('falls back to defaults for non-positive override values', () => {
    expect(childMaxStepsFromConfig('coder', { childMaxSteps: 0 })).toBe(CHILD_MAX_STEPS)
    expect(childMaxStepsFromConfig('coder', { childMaxSteps: -3 })).toBe(CHILD_MAX_STEPS)
    expect(childMaxStepsFromConfig('explore', { exploreChildMaxSteps: 0 })).toBe(EXPLORE_CHILD_MAX_STEPS)
    expect(maxStepsFromConfig({ maxSteps: 0 })).toBe(MAX_STEPS)
    expect(maxStepsFromConfig({ maxSteps: -1 })).toBe(MAX_STEPS)
    expect(maxDepthFromConfig({ maxDepth: 0 })).toBe(MAX_DEPTH)
  })

  it('the max-steps note tells the model tools are disabled and to answer in text', () => {
    expect(MAX_STEPS_NOTE).toMatch(/maximum/i)
    expect(MAX_STEPS_NOTE).toMatch(/text/i)
    expect(MAX_STEPS_NOTE).toMatch(/DSML/i)
  })
})

describe('loop-control reads hip.toml agentLoop', () => {
  let dir: string
  let prevConfigPath: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-loop-control-'))
    prevConfigPath = process.env.HIP_CONFIG_PATH
    delete process.env.HIP_CONFIG_PATH
  })

  afterEach(() => {
    if (prevConfigPath === undefined) delete process.env.HIP_CONFIG_PATH
    else process.env.HIP_CONFIG_PATH = prevConfigPath
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ok */ }
  })

  it('uses defaults when no hip.toml is configured', () => {
    expect(childMaxStepsForAgent('explore')).toBe(EXPLORE_CHILD_MAX_STEPS)
    expect(childMaxStepsForAgent('coder')).toBe(CHILD_MAX_STEPS)
    expect(maxStepsForSession()).toBe(MAX_STEPS)
    expect(maxDepthForSession()).toBe(MAX_DEPTH)
  })

  it('reads step budgets and depth from HIP_CONFIG_PATH', () => {
    const p = join(dir, 'hip.toml')
    writeFileSync(p, `version = 1

[agentLoop]
maxSteps = 100
childMaxSteps = 7
exploreChildMaxSteps = 33
maxDepth = 2
subagentHitl = "inline_partial"
`)
    process.env.HIP_CONFIG_PATH = p
    expect(childMaxStepsForAgent('explore')).toBe(33)
    expect(childMaxStepsForAgent('coder')).toBe(7)
    expect(childMaxStepsForAgent('worker-1')).toBe(7)
    expect(maxStepsForSession()).toBe(100)
    expect(maxDepthForSession()).toBe(2)
  })

  it('accepts snake_case agent_loop keys', () => {
    const p = join(dir, 'hip.toml')
    writeFileSync(p, `version = 1

[agent_loop]
max_steps = 50
child_max_steps = 12
explore_child_max_steps = 44
max_depth = 4
`)
    process.env.HIP_CONFIG_PATH = p
    expect(childMaxStepsForAgent('explore')).toBe(44)
    expect(childMaxStepsForAgent('coder')).toBe(12)
    expect(maxStepsForSession()).toBe(50)
    expect(maxDepthForSession()).toBe(4)
  })

  it('project hip.toml overrides global agentLoop budgets', () => {
    const globalFile = join(dir, 'global.toml')
    writeFileSync(globalFile, `version = 1

[agentLoop]
maxSteps = 200
childMaxSteps = 25
maxDepth = 3
`)
    process.env.HIP_CONFIG_PATH = globalFile

    const projectRoot = join(dir, 'proj')
    mkdirSync(join(projectRoot, '.hip'), { recursive: true })
    writeFileSync(join(projectRoot, '.hip', 'hip.toml'), `version = 1

[agentLoop]
maxSteps = 60
childMaxSteps = 9
maxDepth = 1
`)

    expect(maxStepsForSession(projectRoot)).toBe(60)
    expect(childMaxStepsForAgent('coder', projectRoot)).toBe(9)
    expect(maxDepthForSession(projectRoot)).toBe(1)
    // Without cwd, still global-only
    expect(maxStepsForSession()).toBe(200)
  })
})
