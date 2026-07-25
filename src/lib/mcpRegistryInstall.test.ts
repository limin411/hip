import { describe, it, expect } from 'vitest'
import type { McpRegistryEntry } from '@hip/protocol'
import {
  buildMcpRegistryInstallDraft,
  isMcpRegistryEntryInstallable,
} from './mcpRegistryInstall'

function entry(partial: Partial<McpRegistryEntry> & Pick<McpRegistryEntry, 'name'>): McpRegistryEntry {
  return {
    key: `mcp-official::${partial.name}`,
    marketSourceId: 'mcp-official',
    installState: 'not_installed',
    enabled: false,
    ...partial,
  }
}

describe('buildMcpRegistryInstallDraft', () => {
  it('prefers streamable-http remote for GitHub MCP', () => {
    const e = entry({
      name: 'io.github.github/github-mcp-server',
      title: 'GitHub',
      version: '1.7.0',
      packages: [
        {
          registryType: 'oci',
          identifier: 'ghcr.io/github/github-mcp-server:1.7.0',
          environmentVariables: [
            {
              name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
              isRequired: true,
              isSecret: true,
              description: 'PAT',
            },
          ],
        },
      ],
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: [
            {
              name: 'Authorization',
              isSecret: true,
              description: 'PAT or App token',
            },
          ],
        },
      ],
    })
    const draft = buildMcpRegistryInstallDraft(e)
    expect(draft).not.toBeNull()
    expect(draft!.transport).toBe('http')
    expect(draft!.url).toBe('https://api.githubcopilot.com/mcp/')
    expect(draft!.name).toBe('GitHub')
    expect(draft!.method).toBe('remote-http')
    expect(draft!.registryName).toBe('io.github.github/github-mcp-server')
    expect(draft!.requiredSecrets.some((s) => s.name === 'Authorization')).toBe(true)
    expect(draft!.headers?.Authorization).toBe('')
  })

  it('maps npm packages to npx -y', () => {
    const e = entry({
      name: 'io.github.user/foo',
      version: '1.2.3',
      packages: [{ registryType: 'npm', identifier: '@user/foo', version: '1.2.3' }],
    })
    const draft = buildMcpRegistryInstallDraft(e)!
    expect(draft.command).toBe('npx')
    expect(draft.args).toEqual(['-y', '@user/foo@1.2.3'])
    expect(draft.method).toBe('npm')
  })

  it('maps pypi packages to uvx', () => {
    const e = entry({
      name: 'io.github.user/bar',
      packages: [{ registryType: 'pypi', identifier: 'bar-mcp', version: '0.1.0' }],
    })
    const draft = buildMcpRegistryInstallDraft(e)!
    expect(draft.command).toBe('uvx')
    expect(draft.args).toEqual(['bar-mcp==0.1.0'])
  })

  it('maps oci packages to docker run when no remote', () => {
    const e = entry({
      name: 'io.github.github/github-mcp-server',
      packages: [
        {
          registryType: 'oci',
          identifier: 'ghcr.io/github/github-mcp-server:1.7.0',
          environmentVariables: [
            { name: 'GITHUB_PERSONAL_ACCESS_TOKEN', isRequired: true, isSecret: true },
          ],
        },
      ],
    })
    const draft = buildMcpRegistryInstallDraft(e)!
    expect(draft.command).toBe('docker')
    expect(draft.args).toEqual([
      'run',
      '-i',
      '--rm',
      '-e',
      'GITHUB_PERSONAL_ACCESS_TOKEN',
      'ghcr.io/github/github-mcp-server:1.7.0',
    ])
    expect(draft.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('')
  })

  it('returns null when nothing installable', () => {
    const e = entry({ name: 'io.github.user/empty' })
    expect(buildMcpRegistryInstallDraft(e)).toBeNull()
    expect(isMcpRegistryEntryInstallable(e)).toBe(false)
  })
})
