import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPluginsConfig } from './plugins.js'

const tmps: string[] = []
function writeConfig(name: string, obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-plugins-')); tmps.push(dir)
  const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_PLUGINS_PATH
})

describe('readPluginsConfig', () => {
  it('returns { plugins: [] } when HIP_PLUGINS_PATH is unset', () => {
    delete process.env.HIP_PLUGINS_PATH
    expect(readPluginsConfig()).toEqual({ plugins: [] })
  })

  it('reads the plugins array from the file', () => {
    process.env.HIP_PLUGINS_PATH = writeConfig('plugins.json', { plugins: ['/path/a', '/path/b'] })
    expect(readPluginsConfig()).toEqual({ plugins: ['/path/a', '/path/b'] })
  })

  it('returns empty plugins when plugins field is missing or not an array', () => {
    process.env.HIP_PLUGINS_PATH = writeConfig('plugins.json', { plugins: 'not-an-array' })
    expect(readPluginsConfig()).toEqual({ plugins: [] })
  })

  it('returns empty plugins on corrupt JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-plugins-')); tmps.push(dir)
    const p = join(dir, 'plugins.json'); writeFileSync(p, '{ corrupt'); process.env.HIP_PLUGINS_PATH = p
    expect(readPluginsConfig()).toEqual({ plugins: [] })
  })

  it('returns { plugins: [] } when the array is empty', () => {
    process.env.HIP_PLUGINS_PATH = writeConfig('plugins.json', { plugins: [] })
    expect(readPluginsConfig()).toEqual({ plugins: [] })
  })

  it('filters out non-string entries and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.HIP_PLUGINS_PATH = writeConfig('plugins.json', { plugins: ['/valid', 42, null, '/also-valid'] })
    const result = readPluginsConfig()
    expect(result).toEqual({ plugins: ['/valid', '/also-valid'] })
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledWith('Skipping non-string plugin entry (number):', 42)
    expect(warnSpy).toHaveBeenCalledWith('Skipping non-string plugin entry (object):', null)
    warnSpy.mockRestore()
  })

  it('returns { plugins: [] } when all entries are non-string', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.HIP_PLUGINS_PATH = writeConfig('plugins.json', { plugins: [42, true, null] })
    const result = readPluginsConfig()
    expect(result).toEqual({ plugins: [] })
    expect(warnSpy).toHaveBeenCalledTimes(3)
    warnSpy.mockRestore()
  })
})
