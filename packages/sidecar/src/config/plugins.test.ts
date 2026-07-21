import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isPluginEnabled, readPluginsConfig } from './plugins.js'

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

  it('filters out unrecoverable entries and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.HIP_PLUGINS_PATH = writeConfig('plugins.json', { plugins: ['/valid', 42, null, '/also-valid'] })
    const result = readPluginsConfig()
    expect(result).toEqual({ plugins: ['/valid', '/also-valid'] })
    expect(warnSpy).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })

  it('coerces object entries with path/dir/root', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.HIP_PLUGINS_PATH = writeConfig('plugins.json', {
      plugins: [
        { name: 'superpowers', path: '/x/superpowers' },
        { dir: '/y/other' },
        { root: '/z/root' },
        { name: 'no-path' },
      ],
    })
    expect(readPluginsConfig()).toEqual({
      plugins: ['/x/superpowers', '/y/other', '/z/root'],
    })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('returns { plugins: [] } when all entries are unrecoverable', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.HIP_PLUGINS_PATH = writeConfig('plugins.json', { plugins: [42, true, null] })
    const result = readPluginsConfig()
    expect(result).toEqual({ plugins: [] })
    expect(warnSpy).toHaveBeenCalledTimes(3)
    warnSpy.mockRestore()
  })

  it('reads enabled map', () => {
    process.env.HIP_PLUGINS_PATH = writeConfig('plugins.json', {
      plugins: ['/path/superpowers'],
      enabled: { superpowers: false },
    })
    expect(readPluginsConfig()).toEqual({
      plugins: ['/path/superpowers'],
      enabled: { superpowers: false },
    })
  })

  it('normalizePluginsConfigFile rewrites object entries to strings', async () => {
    const { normalizePluginsConfigFile } = await import('./plugins.js')
    const { readFileSync } = await import('node:fs')
    const p = writeConfig('plugins.json', {
      plugins: [{ name: 'a', path: '/p/a' }, '/p/b'],
      enabled: { a: true },
      entries: [{ slug: 'a' }],
    })
    expect(normalizePluginsConfigFile(p)).toBe(true)
    expect(normalizePluginsConfigFile(p)).toBe(false) // already clean
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    expect(raw.plugins).toEqual(['/p/a', '/p/b'])
    expect(raw.enabled).toEqual({ a: true })
    expect(raw.entries).toEqual([{ slug: 'a' }])
  })
})

describe('isPluginEnabled', () => {
  it('defaults to enabled when map omits the id', () => {
    expect(isPluginEnabled('/x/superpowers', { plugins: ['/x/superpowers'] })).toBe(true)
  })

  it('respects explicit false', () => {
    expect(
      isPluginEnabled('/x/superpowers', {
        plugins: ['/x/superpowers'],
        enabled: { superpowers: false },
      }),
    ).toBe(false)
  })
})
