import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { buildTools } from './tools.js'
import type { PluginInstallSuccess, PluginInstallFailure } from './plugin-install.js'
import {
  validatePluginUrl,
  slugifyPlugin,
  inferPluginName,
  generatePluginManifest,
  resolveInstallSlug,
  prepareStaging,
  readOrGenerateManifest,
  cleanupStagingDir,
} from './plugin-install.js'

const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}))

vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>()
  return {
    ...mod,
    execFileSync: mockExecFileSync,
  }
})

function parseResult(raw: string): PluginInstallSuccess | PluginInstallFailure {
  return JSON.parse(raw) as PluginInstallSuccess | PluginInstallFailure
}

function findTool(name: string) {
  return buildTools('/fake-root').find((t) => t.name === name)!
}

let pluginsDir: string
let pluginsPath: string
let prevPluginsDir: string | undefined
let prevPluginsPath: string | undefined

beforeEach(() => {
  mockExecFileSync.mockReset()

  pluginsDir = mkdtempSync(join(tmpdir(), 'hip-plugins-'))
  pluginsPath = join(pluginsDir, 'hip-plugins.json')
  writeFileSync(pluginsPath, JSON.stringify({ plugins: [] }), 'utf8')

  prevPluginsDir = process.env.HIP_PLUGINS_DIR
  prevPluginsPath = process.env.HIP_PLUGINS_PATH
  process.env.HIP_PLUGINS_DIR = pluginsDir
  process.env.HIP_PLUGINS_PATH = pluginsPath
})

afterEach(() => {
  if (prevPluginsDir === undefined) delete process.env.HIP_PLUGINS_DIR
  else process.env.HIP_PLUGINS_DIR = prevPluginsDir

  if (prevPluginsPath === undefined) delete process.env.HIP_PLUGINS_PATH
  else process.env.HIP_PLUGINS_PATH = prevPluginsPath

  rmSync(pluginsDir, { recursive: true, force: true })
})

/** Create `.plugin/plugin.json` directly inside `dir`. */
function makePluginDir(dir: string, manifest: Record<string, unknown>): void {
  const pluginDir = join(dir, '.plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

function makeBareRepo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# Test Plugin', 'utf8')
}

describe('validatePluginUrl', () => {
  it('accepts a valid HTTPS URL', () => {
    expect(validatePluginUrl('https://github.com/user/repo.git')).toBeNull()
  })

  it('rejects non-HTTPS schemes (file://)', () => {
    expect(validatePluginUrl('file:///etc/passwd')).toContain('https')
  })

  it('rejects non-HTTPS schemes (ssh://)', () => {
    expect(validatePluginUrl('ssh://git@github.com/user/repo.git')).toContain('https')
  })

  it('rejects non-HTTPS schemes (git://)', () => {
    expect(validatePluginUrl('git://github.com/user/repo.git')).toContain('https')
  })

  it('rejects URLs with embedded credentials', () => {
    expect(validatePluginUrl('https://user:pass@github.com/repo.git')).toContain('credentials')
  })

  it('rejects URLs with just a username', () => {
    expect(validatePluginUrl('https://user@github.com/repo.git')).toContain('credentials')
  })

  it('rejects an invalid URL string', () => {
    expect(validatePluginUrl('not-a-url')).toContain('Invalid')
  })
})

describe('slugifyPlugin', () => {
  it('lowercases and replaces non-alphanumeric with dashes', () => {
    expect(slugifyPlugin('My Plugin!')).toBe('my-plugin')
  })

  it('collapses consecutive non-alphanumeric chars', () => {
    expect(slugifyPlugin('Hello   World')).toBe('hello-world')
  })

  it('strips trailing dashes', () => {
    expect(slugifyPlugin('Test!@#')).toBe('test')
  })

  it('returns "plugin" for empty/fully-symbol names', () => {
    expect(slugifyPlugin('!@#$%')).toBe('plugin')
  })

  it('keeps numbers intact', () => {
    expect(slugifyPlugin('plugin2-v3')).toBe('plugin2-v3')
  })

  it('matches Rust slugify_plugin behavior', () => {
    expect(slugifyPlugin('hello world')).toBe('hello-world')
    expect(slugifyPlugin('Already-Clean')).toBe('already-clean')
    expect(slugifyPlugin('  spaces  ')).toBe('spaces')
  })
})

describe('inferPluginName', () => {
  it('uses package.json name when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-infer-pkg-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-awesome-plugin' }), 'utf8')
      expect(inferPluginName(dir)).toBe('my-awesome-plugin')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('strips npm scope from package.json name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-infer-scope-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@hip/my-plugin' }), 'utf8')
      expect(inferPluginName(dir)).toBe('my-plugin')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses git remote origin URL when package.json is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-infer-git-'))
    try {
      mkdirSync(join(dir, '.git'), { recursive: true })
      mockExecFileSync.mockReturnValue(Buffer.from('https://github.com/org/repo-name.git\n'))
      expect(inferPluginName(dir)).toBe('repo-name')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prefers package.json over git remote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-infer-prefer-pkg-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pkg-name' }), 'utf8')
      mkdirSync(join(dir, '.git'), { recursive: true })
      mockExecFileSync.mockReturnValue(Buffer.from('https://github.com/org/git-name.git\n'))
      expect(inferPluginName(dir)).toBe('pkg-name')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to sourceUrl repo slug', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-infer-url-'))
    try {
      expect(inferPluginName(dir, 'https://example.com/path/plugin-repo.git')).toBe('plugin-repo')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prefers git remote over sourceUrl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-infer-prefer-git-'))
    try {
      mkdirSync(join(dir, '.git'), { recursive: true })
      mockExecFileSync.mockReturnValue(Buffer.from('https://github.com/org/git-name.git\n'))
      expect(inferPluginName(dir, 'https://example.com/url-name')).toBe('git-name')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to basename(stagingDir) when nothing else is available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-infer-base-'))
    try {
      expect(inferPluginName(dir)).toBe(slugifyPlugin(basename(dir)))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('strips .git, trailing slashes, and query from sourceUrl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-infer-url-strip-'))
    try {
      expect(inferPluginName(dir, 'https://example.com/path/my-plugin.git/?ref=main')).toBe('my-plugin')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generatePluginManifest', () => {
  it('generates a minimal manifest with name and version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-'))
    try {
      const result = generatePluginManifest(dir)
      expect(result.name).toBe(slugifyPlugin(basename(dir)))
      expect(result.version).toBe('0.0.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses inferPluginName with optional sourceUrl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-url-'))
    try {
      const result = generatePluginManifest(dir, 'https://example.com/path/url-plugin.git')
      expect(result.name).toBe('url-plugin')
      expect(result.version).toBe('0.0.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects skills from skills/**/SKILL.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-skills-'))
    try {
      mkdirSync(join(dir, 'skills', 'my-skill'), { recursive: true })
      writeFileSync(join(dir, 'skills', 'my-skill', 'SKILL.md'), '# Skill', 'utf8')
      mkdirSync(join(dir, 'skills', 'other-skill'), { recursive: true })
      writeFileSync(join(dir, 'skills', 'other-skill', 'SKILL.md'), '# Other', 'utf8')
      mkdirSync(join(dir, 'skills', 'empty-dir'), { recursive: true })

      const result = generatePluginManifest(dir)
      expect(result.skills).toEqual(['./skills/my-skill', './skills/other-skill'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects .mcp.json at root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-mcp-'))
    try {
      writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{}}', 'utf8')
      const result = generatePluginManifest(dir)
      expect(result.mcpServers).toBe('./.mcp.json')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects hooks/** directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-hooks-'))
    try {
      mkdirSync(join(dir, 'hooks'), { recursive: true })
      writeFileSync(join(dir, 'hooks', 'index.cjs'), 'module.exports = {}', 'utf8')
      const result = generatePluginManifest(dir)
      expect(result.hooks).toBe('./hooks/hooks.cjs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not set hooks when hooks/ is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-hooks-empty-'))
    try {
      mkdirSync(join(dir, 'hooks'), { recursive: true })
      const result = generatePluginManifest(dir)
      expect(result.hooks).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects agents/** directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-agents-'))
    try {
      mkdirSync(join(dir, 'agents'), { recursive: true })
      writeFileSync(join(dir, 'agents', 'config.json'), '{}', 'utf8')
      const result = generatePluginManifest(dir)
      expect(result.agents).toBe('./agents.json')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses version from package.json when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-version-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'versioned-plugin', version: '2.3.4' }), 'utf8')
      const result = generatePluginManifest(dir)
      expect(result.version).toBe('2.3.4')
      expect(result.name).toBe('versioned-plugin')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to 0.0.0 when package.json has no version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-no-version-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'no-version-plugin' }), 'utf8')
      const result = generatePluginManifest(dir)
      expect(result.version).toBe('0.0.0')
      expect(result.name).toBe('no-version-plugin')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('resolveInstallSlug', () => {
  it('returns the base slug when no directory exists', () => {
    const result = resolveInstallSlug('My Plugin', pluginsDir, new Set())
    expect(result).toBe('my-plugin')
  })

  it('rejects when directory exists and is registered', () => {
    mkdirSync(join(pluginsDir, 'my-plugin'), { recursive: true })
    expect(() =>
      resolveInstallSlug('My Plugin', pluginsDir, new Set([join(pluginsDir, 'my-plugin')])),
    ).toThrow('already installed')
  })

  it('suffixes when directory exists but is NOT registered', () => {
    mkdirSync(join(pluginsDir, 'my-plugin'), { recursive: true })
    const result = resolveInstallSlug('My Plugin', pluginsDir, new Set())
    expect(result).toBe('my-plugin-2')
  })

  it('increments suffix until available', () => {
    mkdirSync(join(pluginsDir, 'my-plugin'), { recursive: true })
    mkdirSync(join(pluginsDir, 'my-plugin-2'), { recursive: true })
    const result = resolveInstallSlug('My Plugin', pluginsDir, new Set())
    expect(result).toBe('my-plugin-3')
  })
})

describe('prepareStaging', () => {
  it('returns the provided stagingDir without cloning (test seam)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-staging-seam-'))
    try {
      const result = prepareStaging('https://example.com/repo.git', pluginsDir, dir)
      expect(result.stagingDir).toBe(dir)
      expect(result.owned).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('readOrGenerateManifest', () => {
  it('reads an existing plugin.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-read-manifest-'))
    try {
      makePluginDir(dir, { name: 'test-plugin', version: '1.0.0' })

      const manifest = readOrGenerateManifest(dir)
      expect(manifest.name).toBe('test-plugin')
      expect(manifest.version).toBe('1.0.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('auto-generates a manifest when plugin.json is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-gen-manifest-'))
    try {
      mkdirSync(join(dir, 'skills', 'demo'), { recursive: true })
      writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), '# Demo', 'utf8')

      const manifest = readOrGenerateManifest(dir)
      expect(manifest.name).toBe(slugifyPlugin(basename(dir)))
      expect(manifest.version).toBe('0.0.0')
      // parsePluginManifest resolves relative paths to absolute
      expect(Array.isArray(manifest.skills)).toBe(true)
      const skills = manifest.skills as string[]
      expect(skills.length).toBe(1)
      expect(skills[0]).toBe(join(dir, 'skills', 'demo'))
      expect(existsSync(join(dir, '.plugin', 'plugin.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws for invalid existing manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-bad-manifest-'))
    try {
      const pluginDir = join(dir, '.plugin')
      mkdirSync(pluginDir, { recursive: true })
      writeFileSync(join(pluginDir, 'plugin.json'), '{ corrupt json', 'utf8')

      expect(() => readOrGenerateManifest(dir)).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('cleanupStagingDir', () => {
  it('removes the directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-cleanup-'))
    expect(existsSync(dir)).toBe(true)
    cleanupStagingDir(dir)
    expect(existsSync(dir)).toBe(false)
  })

  it('handles a non-existent directory gracefully', () => {
    expect(() => cleanupStagingDir('/tmp/nonexistent-12345')).not.toThrow()
  })
})

describe('plugin_install tool — happy path', () => {
  it('installs a plugin with existing plugin.json using the stagingDir test seam', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-install-1-'))
    const tool = findTool('plugin_install')

    try {
      makePluginDir(stagingDir, {
        name: 'My Cool Plugin',
        version: '2.0.0',
        id: 'cool-plugin',
        skills: ['./skills/main'],
      })

      mkdirSync(join(stagingDir, 'skills', 'main'), { recursive: true })
      writeFileSync(join(stagingDir, 'skills', 'main', 'SKILL.md'), '# Cool Skill', 'utf8')

      const raw = String(await tool.invoke({ url: 'https://example.com/cool.git', stagingDir }))
      const result = parseResult(raw)

      expect(result.ok).toBe(true)
      const success = result as PluginInstallSuccess
      expect(success.pluginId).toBe('cool-plugin')
      expect(success.components.skills).toBe(1)

      const configRaw = JSON.parse(readFileSync(pluginsPath, 'utf8')) as { plugins: string[] }
      expect(configRaw.plugins.length).toBe(1)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('installs a plugin with auto-generated manifest (no plugin.json)', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-install-2-'))
    const tool = findTool('plugin_install')

    try {
      makeBareRepo(stagingDir)
      mkdirSync(join(stagingDir, 'skills', 'auto-skill'), { recursive: true })
      writeFileSync(join(stagingDir, 'skills', 'auto-skill', 'SKILL.md'), '# Auto Skill', 'utf8')
      writeFileSync(join(stagingDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }), 'utf8')

      const raw = String(await tool.invoke({ url: 'https://example.com/auto.git', stagingDir }))
      const result = parseResult(raw)

      expect(result.ok).toBe(true)
      const success = result as PluginInstallSuccess
      expect(success.components.skills).toBe(1)
      expect(success.components.mcpServers).toBe(0)

      expect(existsSync(join(stagingDir, '.plugin', 'plugin.json'))).toBe(true)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('installs a minimal plugin with no components', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-install-min-'))
    const tool = findTool('plugin_install')

    try {
      makePluginDir(stagingDir, { name: 'minimal', version: '0.1.0' })

      const raw = String(await tool.invoke({ url: 'https://example.com/min.git', stagingDir }))
      const result = parseResult(raw)

      expect(result.ok).toBe(true)
      const success = result as PluginInstallSuccess
      expect(success.components.skills).toBe(0)
      expect(success.components.mcpServers).toBe(0)
      expect(success.components.agents).toBe(0)
      expect(success.components.hooks).toBe(0)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('installs a plugin with auto-generated manifest derived from URL when no package.json or git config', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-install-url-'))
    const tool = findTool('plugin_install')

    try {
      makeBareRepo(stagingDir)
      mkdirSync(join(stagingDir, 'skills', 'url-skill'), { recursive: true })
      writeFileSync(join(stagingDir, 'skills', 'url-skill', 'SKILL.md'), '# URL Skill', 'utf8')

      const raw = String(await tool.invoke({ url: 'https://example.com/path/url-plugin.git', stagingDir }))
      const result = parseResult(raw)

      expect(result.ok).toBe(true)
      const success = result as PluginInstallSuccess
      expect(success.components.skills).toBe(1)

      const manifestRaw = JSON.parse(readFileSync(join(stagingDir, '.plugin', 'plugin.json'), 'utf8')) as { name: string }
      expect(manifestRaw.name).toBe('url-plugin')
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })
})

describe('plugin_install tool — failure modes', () => {
  it('rejects a non-HTTPS URL', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-fail-url-'))
    const tool = findTool('plugin_install')

    try {
      makePluginDir(stagingDir, { name: 'test', version: '1.0.0' })
      const raw = String(await tool.invoke({ url: 'file:///etc/passwd', stagingDir }))
      const result = parseResult(raw)
      expect(result.ok).toBe(false)
      expect((result as PluginInstallFailure).error).toContain('https')
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('rejects a duplicate plugin (already installed)', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-fail-dup-'))
    const tool = findTool('plugin_install')

    try {
      makePluginDir(stagingDir, {
        name: 'Duplicate Plugin',
        version: '1.0.0',
        id: 'dup-plugin',
      })

      const dupPath = join(pluginsDir, 'duplicate-plugin')
      mkdirSync(dupPath, { recursive: true })
      const existingConfig = { plugins: [dupPath] }
      writeFileSync(pluginsPath, JSON.stringify(existingConfig), 'utf8')

      const raw = String(await tool.invoke({ url: 'https://example.com/dup.git', stagingDir }))
      const result = parseResult(raw)
      expect(result.ok).toBe(false)
      expect((result as PluginInstallFailure).error).toContain('already installed')
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('returns an error when HIP_PLUGINS_DIR is not set', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-fail-env-'))
    const tool = findTool('plugin_install')

    try {
      makePluginDir(stagingDir, { name: 'test', version: '1.0.0' })

      delete process.env.HIP_PLUGINS_DIR
      const raw = String(await tool.invoke({ url: 'https://example.com/test.git', stagingDir }))
      const result = parseResult(raw)
      expect(result.ok).toBe(false)
      expect((result as PluginInstallFailure).error).toContain('HIP_PLUGINS_DIR')
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('returns an error when HIP_PLUGINS_PATH is not set', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-fail-env2-'))
    const tool = findTool('plugin_install')

    try {
      makePluginDir(stagingDir, { name: 'test', version: '1.0.0' })

      delete process.env.HIP_PLUGINS_PATH
      const raw = String(await tool.invoke({ url: 'https://example.com/test.git', stagingDir }))
      const result = parseResult(raw)
      expect(result.ok).toBe(false)
      expect((result as PluginInstallFailure).error).toContain('HIP_PLUGINS_PATH')
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('cleans up and does NOT write config on parse error', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-fail-parse-'))
    const tool = findTool('plugin_install')

    try {
      const manifestDir = join(stagingDir, '.plugin')
      mkdirSync(manifestDir, { recursive: true })
      writeFileSync(join(manifestDir, 'plugin.json'), '{ corrupt', 'utf8')

      const raw = String(await tool.invoke({ url: 'https://example.com/bad.git', stagingDir }))
      const result = parseResult(raw)
      expect(result.ok).toBe(false)

      const configRaw = JSON.parse(readFileSync(pluginsPath, 'utf8')) as { plugins: string[] }
      expect(configRaw.plugins.length).toBe(0)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('returns an error for a manifest missing required fields', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-fail-valid-'))
    const tool = findTool('plugin_install')

    try {
      // plugin.json with no "name" field (required)
      const manifestDir = join(stagingDir, '.plugin')
      mkdirSync(manifestDir, { recursive: true })
      writeFileSync(join(manifestDir, 'plugin.json'), JSON.stringify({ version: '1.0.0' }), 'utf8')

      const raw = String(await tool.invoke({ url: 'https://example.com/noname.git', stagingDir }))
      const result = parseResult(raw)
      expect(result.ok).toBe(false)
      expect((result as PluginInstallFailure).error).toContain('name')
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })
})

describe('prepareStaging — git clone timeout', () => {
  it('throws a timeout error when git clone exceeds 60s', () => {
    const stagingRoot = mkdtempSync(join(tmpdir(), 'hip-timeout-'))
    try {
      mockExecFileSync.mockImplementation(
        (_file: string, _args: readonly string[], opts?: { timeout?: number }) => {
          expect(opts?.timeout).toBe(60_000)
          const err = new Error('ETIMEDOUT: git clone timed out after 60000ms')
          ;(err as NodeJS.ErrnoException).code = 'ETIMEDOUT'
          throw err
        },
      )

      expect(() => prepareStaging('https://example.com/slow.git', stagingRoot)).toThrow(
        'git clone timed out after 60s',
      )
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true })
    }
  })

  it('handles a generic git clone failure (non-timeout)', () => {
    const stagingRoot = mkdtempSync(join(tmpdir(), 'hip-clone-fail-'))
    try {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('fatal: repository not found')
      })

      expect(() => prepareStaging('https://example.com/nope.git', stagingRoot)).toThrow(
        'git clone failed',
      )
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true })
    }
  })
})

describe('plugin_install tool — chat mode gating', () => {
  it('is NOT registered in chat mode', () => {
    const tools = buildTools('/fake-root', undefined, undefined, undefined, { permissionMode: 'chat' })
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('plugin_install')
  })

  it('IS registered in edit mode (default)', () => {
    const tools = buildTools('/fake-root')
    const names = tools.map((t) => t.name)
    expect(names).toContain('plugin_install')
  })

  it('IS registered in full mode', () => {
    const tools = buildTools('/fake-root', undefined, undefined, undefined, { permissionMode: 'full' })
    const names = tools.map((t) => t.name)
    expect(names).toContain('plugin_install')
  })
})
