import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import {
  readAuthKey,
  readAuthEntry,
  resolveApiKey,
  resolveProviderAuth,
  resolveStandardEnvApiKey,
  expandKeyExpression,
  defaultAuthPath,
} from './auth-file.js'

const KEY_ENV = 'HIP_MODEL_DEEPSEEK_API_KEY'
let dir: string
let authPath: string
let savedEnv: string | undefined
let savedStandard: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hip-authfile-'))
  authPath = join(dir, 'auth.json')
  savedEnv = process.env[KEY_ENV]
  savedStandard = process.env.DEEPSEEK_API_KEY
  delete process.env[KEY_ENV]
  delete process.env.DEEPSEEK_API_KEY
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (savedEnv === undefined) delete process.env[KEY_ENV]
  else process.env[KEY_ENV] = savedEnv
  if (savedStandard === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = savedStandard
})

describe('readAuthKey', () => {
  it('returns a provider key from auth.json', () => {
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: 'sk-file' }))
    expect(readAuthKey('deepseek', authPath)).toBe('sk-file')
  })
  it('returns undefined when the file is missing', () => {
    expect(readAuthKey('deepseek', join(dir, 'nope.json'))).toBeUndefined()
  })
  it('returns undefined when the file is corrupt', () => {
    writeFileSync(authPath, 'not-json{{')
    expect(readAuthKey('deepseek', authPath)).toBeUndefined()
  })
  it('returns undefined when the provider key is absent', () => {
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_OPENAI_API_KEY: 'sk-x' }))
    expect(readAuthKey('deepseek', authPath)).toBeUndefined()
  })
  it('returns undefined for empty tombstone', () => {
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: '' }))
    expect(readAuthKey('deepseek', authPath)).toBeUndefined()
  })
})

describe('readAuthEntry', () => {
  it('marks tombstone as present with empty value', () => {
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: '' }))
    expect(readAuthEntry('deepseek', authPath)).toEqual({ present: true, value: '' })
  })
  it('marks missing key as not present', () => {
    writeFileSync(authPath, JSON.stringify({}))
    expect(readAuthEntry('deepseek', authPath)).toEqual({ present: false })
  })
})

describe('resolveApiKey / resolveProviderAuth', () => {
  it('prefers auth.json over the HIP env var (hot-reload after saveKey)', () => {
    process.env[KEY_ENV] = 'sk-env'
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: 'sk-file' }))
    expect(resolveApiKey('deepseek', authPath)).toBe('sk-file')
    expect(resolveProviderAuth('deepseek', undefined, authPath)).toEqual({
      apiKey: 'sk-file',
      source: 'auth.json',
    })
  })

  it('tombstone blocks HIP env fallback (hot-reload after clearKey)', () => {
    process.env[KEY_ENV] = 'sk-stale-env'
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: '' }))
    expect(resolveApiKey('deepseek', authPath)).toBeUndefined()
    expect(resolveProviderAuth('deepseek', undefined, authPath)).toBeUndefined()
  })

  it('falls back to auth.json when the env var is unset', () => {
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: 'sk-file' }))
    expect(resolveApiKey('deepseek', authPath)).toBe('sk-file')
  })

  it('uses standard env when auth.json has no entry', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-standard'
    expect(resolveApiKey('deepseek', authPath)).toBe('sk-standard')
    expect(resolveProviderAuth('deepseek', undefined, authPath)?.source).toBe('standard_env')
  })

  it('uses HIP env when neither auth nor standard is set', () => {
    process.env[KEY_ENV] = 'sk-hip'
    expect(resolveApiKey('deepseek', authPath)).toBe('sk-hip')
    expect(resolveProviderAuth('deepseek', undefined, authPath)?.source).toBe('hip_env')
  })

  it('treats an empty HIP env var as unset', () => {
    process.env[KEY_ENV] = ''
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: 'sk-file' }))
    expect(resolveApiKey('deepseek', authPath)).toBe('sk-file')
  })

  it('returns undefined when neither env nor file has the key', () => {
    expect(resolveApiKey('deepseek', authPath)).toBeUndefined()
  })

  it('honors override over auth.json', () => {
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: 'sk-file' }))
    expect(resolveProviderAuth('deepseek', 'sk-draft', authPath)).toEqual({
      apiKey: 'sk-draft',
      source: 'override',
    })
  })
})

describe('resolveStandardEnvApiKey', () => {
  it('reads ANTHROPIC_API_KEY for anthropic', () => {
    const prev = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    try {
      expect(resolveStandardEnvApiKey('anthropic')).toBe('sk-ant-test')
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prev
    }
  })
})

describe('expandKeyExpression', () => {
  it('expands $VAR and ${VAR}', () => {
    process.env.MY_TEST_KEY_XYZ = 'from-env'
    try {
      expect(expandKeyExpression('$MY_TEST_KEY_XYZ')).toBe('from-env')
      expect(expandKeyExpression('${MY_TEST_KEY_XYZ}')).toBe('from-env')
      expect(expandKeyExpression('sk-literal')).toBe('sk-literal')
      expect(expandKeyExpression('$MISSING_HIP_KEY_XYZ_123')).toBeUndefined()
    } finally {
      delete process.env.MY_TEST_KEY_XYZ
    }
  })

  it('resolves $VAR stored in auth.json', () => {
    process.env.MY_FILE_KEY_XYZ = 'sk-via-expr'
    try {
      writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: '$MY_FILE_KEY_XYZ' }))
      expect(resolveApiKey('deepseek', authPath)).toBe('sk-via-expr')
      expect(resolveProviderAuth('deepseek', undefined, authPath)?.source).toBe('auth.json')
    } finally {
      delete process.env.MY_FILE_KEY_XYZ
    }
  })
})

describe('defaultAuthPath', () => {
  const savedAuthPath = process.env.HIP_AUTH_PATH
  afterEach(() => {
    if (savedAuthPath === undefined) delete process.env.HIP_AUTH_PATH
    else process.env.HIP_AUTH_PATH = savedAuthPath
  })

  it('honors HIP_AUTH_PATH when set', () => {
    process.env.HIP_AUTH_PATH = '/custom/auth.json'
    expect(defaultAuthPath()).toBe('/custom/auth.json')
  })

  it('falls back to ~/.hip/config/auth.json when unset', () => {
    delete process.env.HIP_AUTH_PATH
    expect(defaultAuthPath()).toBe(join(homedir(), '.hip', 'config', 'auth.json'))
  })
})
