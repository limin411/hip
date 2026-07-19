import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CODING_SKILL_ID, CODING_SKILL_MD, OPS_SKILL_VERSION } from './content.js'
import { getOpsBuiltinSkills } from './materialize.js'
import { getBuiltinSkills } from '../product/builtin-skills.js'

describe('ops builtin hip-coding skill', () => {
  const prev = process.env.HIP_DATA_DIR
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'hip-ops-'))
    process.env.HIP_DATA_DIR = dataDir
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.HIP_DATA_DIR
    else process.env.HIP_DATA_DIR = prev
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('materializes SKILL.md under builtin-skills/hip-coding', () => {
    const skills = getOpsBuiltinSkills()
    expect(skills).toHaveLength(1)
    const s = skills[0]!
    expect(s.id).toBe(CODING_SKILL_ID)
    expect(s.name).toBe('hip-coding')
    expect(s.autoInvoke).toBe(true)
    expect(existsSync(join(s.dir, 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(s.dir, 'SKILL.md'), 'utf8')).toBe(CODING_SKILL_MD)
    expect(readFileSync(join(s.dir, '.stamp'), 'utf8').trim().startsWith(`${OPS_SKILL_VERSION}:`)).toBe(true)
  })

  it('rewrites dirty on-disk skill body', () => {
    const [s] = getOpsBuiltinSkills()
    writeFileSync(join(s!.dir, 'SKILL.md'), '# dirty\n', 'utf8')
    getOpsBuiltinSkills()
    expect(readFileSync(join(s!.dir, 'SKILL.md'), 'utf8')).toBe(CODING_SKILL_MD)
  })

  it('getBuiltinSkills includes product hip and ops hip-coding', () => {
    const all = getBuiltinSkills()
    const ids = all.map((x) => x.id).sort()
    expect(ids).toContain('hip')
    expect(ids).toContain('hip-coding')
  })
})
