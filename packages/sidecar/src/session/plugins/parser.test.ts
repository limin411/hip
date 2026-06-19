// packages/sidecar/src/session/plugins/parser.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Hook } from '@hip/protocol'
import { parsePluginManifest, PluginManifestError } from './parser.js'

const dirs: string[] = []

/** Create a temp plugin directory with .plugin/plugin.json content. */
function makePlugin(json: Record<string, unknown>): string {
  const root = join(tmpdir(), `hip-plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  dirs.push(root)
  mkdirSync(join(root, '.plugin'), { recursive: true })
  writeFileSync(join(root, '.plugin', 'plugin.json'), JSON.stringify(json))
  return root
}

function makePluginRaw(raw: string): string {
  const root = join(tmpdir(), `hip-plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  dirs.push(root)
  mkdirSync(join(root, '.plugin'), { recursive: true })
  writeFileSync(join(root, '.plugin', 'plugin.json'), raw)
  return root
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// ─── Minimal valid manifest ─────────────────────────────────────────────

describe('parsePluginManifest — minimal valid', () => {
  it('parses a manifest with only name and version', () => {
    const dir = makePlugin({ name: 'my-plugin', version: '1.0.0' })
    const m = parsePluginManifest(dir)
    expect(m.name).toBe('my-plugin')
    expect(m.version).toBe('1.0.0')
    expect(m.id).toBe('my-plugin') // id falls back to name
    expect(m.description).toBeUndefined()
    expect(m.skills).toBeUndefined()
    expect(m.mcpServers).toBeUndefined()
    expect(m.agents).toBeUndefined()
    expect(m.hooks).toBeUndefined()
  })

  it('uses explicit id when provided', () => {
    const dir = makePlugin({ id: 'custom-id', name: 'display-name', version: '2.0.0' })
    const m = parsePluginManifest(dir)
    expect(m.id).toBe('custom-id')
    expect(m.name).toBe('display-name')
    expect(m.version).toBe('2.0.0')
  })
})

// ─── Full manifest ──────────────────────────────────────────────────────

describe('parsePluginManifest — full manifest', () => {
  it('parses all optional metadata fields', () => {
    const dir = makePlugin({
      name: 'full-plugin',
      version: '1.2.3',
      description: 'A full-featured plugin',
      author: { name: 'Alice', email: 'alice@example.com', url: 'https://alice.dev' },
      license: 'MIT',
      keywords: ['ai', 'tools', 'utility'],
    })
    const m = parsePluginManifest(dir)
    expect(m.name).toBe('full-plugin')
    expect(m.version).toBe('1.2.3')
    expect(m.description).toBe('A full-featured plugin')
    expect(m.author).toEqual({ name: 'Alice', email: 'alice@example.com', url: 'https://alice.dev' })
    expect(m.license).toBe('MIT')
    expect(m.keywords).toEqual(['ai', 'tools', 'utility'])
  })

  it('ignores author without name field', () => {
    const dir = makePlugin({
      name: 'p',
      version: '1',
      author: { email: 'x@y.com' },
    })
    const m = parsePluginManifest(dir)
    expect(m.author).toBeUndefined()
  })

  it('filters non-string keywords', () => {
    const dir = makePlugin({
      name: 'p',
      version: '1',
      keywords: ['valid', 123, 'also-valid', null],
    })
    const m = parsePluginManifest(dir)
    expect(m.keywords).toEqual(['valid', 'also-valid'])
  })
})

// ─── Validation errors ──────────────────────────────────────────────────

describe('parsePluginManifest — validation errors', () => {
  it('throws PluginManifestError when .plugin/plugin.json is missing', () => {
    const root = join(tmpdir(), `hip-plugin-missing-${Date.now()}`)
    dirs.push(root)
    mkdirSync(root, { recursive: true })
    expect(() => parsePluginManifest(root)).toThrow(PluginManifestError)
  })

  it('throws PluginManifestError for invalid JSON', () => {
    const dir = makePluginRaw('{ not valid }')
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('throws when manifest is an array', () => {
    const dir = makePluginRaw('["a", "b"]')
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('throws when manifest is null', () => {
    const dir = makePluginRaw('null')
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('throws when name is missing', () => {
    const dir = makePlugin({ version: '1.0.0' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('throws when name is empty string', () => {
    const dir = makePlugin({ name: '', version: '1.0.0' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('throws when name is not a string', () => {
    const dir = makePlugin({ name: 123, version: '1.0.0' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('throws when version is missing', () => {
    const dir = makePlugin({ name: 'my-plugin' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('throws when version is empty string', () => {
    const dir = makePlugin({ name: 'my-plugin', version: '' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('throws when version is not a string', () => {
    const dir = makePlugin({ name: 'my-plugin', version: 3 })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })
})

// ─── Skills resolution ──────────────────────────────────────────────────

describe('parsePluginManifest — skills resolution', () => {
  it('resolves skills string to absolute path', () => {
    const dir = makePlugin({ name: 'p', version: '1', skills: './skills/' })
    const m = parsePluginManifest(dir)
    expect(m.skills).toBe(join(dir, 'skills'))
  })

  it('resolves skills string[] to absolute paths', () => {
    const dir = makePlugin({ name: 'p', version: '1', skills: ['./skills/a/', './skills/b/'] })
    const m = parsePluginManifest(dir)
    expect(m.skills).toEqual([join(dir, 'skills', 'a'), join(dir, 'skills', 'b')])
  })

  it('leaves skills undefined when not provided', () => {
    const dir = makePlugin({ name: 'p', version: '1' })
    const m = parsePluginManifest(dir)
    expect(m.skills).toBeUndefined()
  })
})

// ─── mcpServers resolution ──────────────────────────────────────────────

describe('parsePluginManifest — mcpServers resolution', () => {
  it('resolves mcpServers string to absolute path', () => {
    const dir = makePlugin({ name: 'p', version: '1', mcpServers: './mcp-config.json' })
    const m = parsePluginManifest(dir)
    expect(m.mcpServers).toBe(join(dir, 'mcp-config.json'))
  })

  it('keeps mcpServers inline array as-is', () => {
    const servers = [{ name: 'my-server', command: 'node', args: ['server.js'] }]
    const dir = makePlugin({ name: 'p', version: '1', mcpServers: servers })
    const m = parsePluginManifest(dir)
    expect(m.mcpServers).toEqual(servers)
  })

  it('leaves mcpServers undefined when not provided', () => {
    const dir = makePlugin({ name: 'p', version: '1' })
    const m = parsePluginManifest(dir)
    expect(m.mcpServers).toBeUndefined()
  })
})

// ─── agents resolution ──────────────────────────────────────────────────

describe('parsePluginManifest — agents resolution', () => {
  it('resolves agents string to absolute path', () => {
    const dir = makePlugin({ name: 'p', version: '1', agents: './agents/' })
    const m = parsePluginManifest(dir)
    expect(m.agents).toBe(join(dir, 'agents'))
  })

  it('keeps agents inline array as-is', () => {
    const agents = [{ id: 'agent-1', name: 'Agent One', model: 'gpt-4' }]
    const dir = makePlugin({ name: 'p', version: '1', agents })
    const m = parsePluginManifest(dir)
    expect(m.agents).toEqual(agents)
  })

  it('leaves agents undefined when not provided', () => {
    const dir = makePlugin({ name: 'p', version: '1' })
    const m = parsePluginManifest(dir)
    expect(m.agents).toBeUndefined()
  })
})

// ─── hooks resolution ───────────────────────────────────────────────────

describe('parsePluginManifest — hooks resolution', () => {
  it('resolves hooks string to absolute path', () => {
    const dir = makePlugin({ name: 'p', version: '1', hooks: './hooks.json' })
    const m = parsePluginManifest(dir)
    expect(m.hooks).toBe(join(dir, 'hooks.json'))
  })

  it('keeps hooks inline array as-is', () => {
    const hooks = [{ event: 'PreToolUse', matcher: 'Bash', handler: async () => ({ kind: 'allow' }) }]
    const dir = makePlugin({ name: 'p', version: '1', hooks })
    const m = parsePluginManifest(dir)
    // Functions don't survive JSON round-trip in the test setup, but the array shape is preserved
    expect(Array.isArray(m.hooks)).toBe(true)
    expect((m.hooks as Hook[]).length).toBe(1)
  })

  it('leaves hooks undefined when not provided', () => {
    const dir = makePlugin({ name: 'p', version: '1' })
    const m = parsePluginManifest(dir)
    expect(m.hooks).toBeUndefined()
  })
})

// ─── Path traversal rejection ───────────────────────────────────────────

describe('parsePluginManifest — path traversal rejection', () => {
  it('rejects skills string with ../', () => {
    const dir = makePlugin({ name: 'p', version: '1', skills: '../outside/' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('rejects skills array entry with ../', () => {
    const dir = makePlugin({ name: 'p', version: '1', skills: ['./ok/', '../bad/'] })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('rejects skills with embedded ../ in path', () => {
    const dir = makePlugin({ name: 'p', version: '1', skills: './foo/../../bar/' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('rejects mcpServers string with ../', () => {
    const dir = makePlugin({ name: 'p', version: '1', mcpServers: '../etc/config.json' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('rejects agents string with ../', () => {
    const dir = makePlugin({ name: 'p', version: '1', agents: '../agents/' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })

  it('rejects hooks string with ../', () => {
    const dir = makePlugin({ name: 'p', version: '1', hooks: '../hooks.json' })
    expect(() => parsePluginManifest(dir)).toThrow(PluginManifestError)
  })
})
