import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { readAuthKey, resolveApiKey, defaultAuthPath } from './auth-file.js'

const KEY_ENV = 'HIP_MODEL_DEEPSEEK_API_KEY'
let dir: string
let authPath: string
let savedEnv: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hip-authfile-'))
  authPath = join(dir, 'auth.json')
  savedEnv = process.env[KEY_ENV]
  delete process.env[KEY_ENV]
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (savedEnv === undefined) delete process.env[KEY_ENV]
  else process.env[KEY_ENV] = savedEnv
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
})

describe('resolveApiKey', () => {
  it('prefers the injected env var over the file', () => {
    process.env[KEY_ENV] = 'sk-env'
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: 'sk-file' }))
    expect(resolveApiKey('deepseek', authPath)).toBe('sk-env')
  })
  it('falls back to auth.json when the env var is unset', () => {
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: 'sk-file' }))
    expect(resolveApiKey('deepseek', authPath)).toBe('sk-file')
  })
  it('treats an empty env var (Tauri injects "" for absent keys) as unset', () => {
    process.env[KEY_ENV] = ''
    writeFileSync(authPath, JSON.stringify({ HIP_MODEL_DEEPSEEK_API_KEY: 'sk-file' }))
    expect(resolveApiKey('deepseek', authPath)).toBe('sk-file')
  })
  it('returns undefined when neither env nor file has the key', () => {
    expect(resolveApiKey('deepseek', authPath)).toBeUndefined()
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
