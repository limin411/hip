import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { bootstrapIsolation } from './env-bootstrap.js'

describe('bootstrapIsolation', () => {
  it('sets full HIP_* matrix and HOME when setHome', () => {
    const { root, env, setHome } = bootstrapIsolation({
      setHome: true,
      dbMemory: false,
      env: { PATH: process.env.PATH, HOME: '/original-home' },
    })
    expect(setHome).toBe(true)
    expect(env.HIP_DATA_DIR).toBe(root)
    expect(env.HIP_DB_PATH).toBe(join(root, 'db', 'hip.db'))
    expect(env.HIP_CONFIG_PATH).toBe(join(root, 'config', 'hip.toml'))
    expect(env.HIP_MEMORY_CONFIG_PATH).toBe(join(root, 'config', 'memory.json'))
    expect(env.HIP_PLUGINS_PATH).toBe(join(root, 'config', 'hip-plugins.json'))
    expect(env.HIP_SCRATCH_ROOT).toBe(join(root, 'scratch'))
    expect(env.HOME).toBe(root)
    expect(existsSync(env.HIP_CONFIG_PATH!)).toBe(true)
    expect(JSON.parse(readFileSync(env.HIP_MEMORY_CONFIG_PATH!, 'utf8')).useMemories).toBe(false)
    // Auth points at user home secret path, not isolation root
    // Normalize path separators for cross-platform comparison
    const authPath = env.HIP_AUTH_PATH!.replace(/\\/g, '/')
    expect(authPath).toContain('.hip/config/auth.json')
    expect(authPath).not.toContain(root.replace(/\\/g, '/') + '/config/auth')
  })

  it('db memory', () => {
    const { env } = bootstrapIsolation({ setHome: false, dbMemory: true, env: { HOME: '/h' } })
    expect(env.HIP_DB_PATH).toBe(':memory:')
    // On Windows, HOME might be converted to Windows format
    if (sep === '\\') {
      expect(env.HOME).toMatch(/h$/)
    } else {
      expect(env.HOME).toBe('/h')
    }
  })
})