import { describe, it, expect } from 'vitest'
import type {
  HipConfig,
  AgentLoopConfig,
  LangSmithConfig,
  ProviderEntry,
  SkillEntry,
  SkillScope,
  SkillMeta,
  McpServerConfig,
  McpResource,
  McpResourceTemplate,
  McpPromptArgument,
  McpPrompt,
  McpPromptMessage,
  McpResourceContent,
  ClientMessage,
  ServerMessage,
  ActiveModel,
} from './index.js'

// ──────────────────────────────────────────────────────────────────
// TYPE GUARDS (checked only by tsc, NOT by vitest)
// ──────────────────────────────────────────────────────────────────

const _skillScopes = (['global', 'project', 'plugin'] as const) satisfies readonly SkillScope[]
void _skillScopes

// ──────────────────────────────────────────────────────────────────
// Todo 1 — Unified TOML Config Types
// ──────────────────────────────────────────────────────────────────

describe('protocol: HipConfig (Todo 1)', () => {
  it('instantiates HipConfig with all sections populated', () => {
    const activeModel: ActiveModel = { providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' }
    const cfg: HipConfig = {
      version: 1,
      providers: [{ id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', enabled: true }],
      activeModel,
      mcpServers: [{ id: 'srv-1', name: 'Local', transport: 'stdio', command: 'npx', args: [], enabled: true }],
      skills: [{ id: 'pdf-tools', enabled: true }],
      agents: [{ id: 'helper', name: 'Helper', kind: 'internal', command: '', args: [], enabled: true, prompt: 'You help.' }],
    }
    expect(cfg.version).toBe(1)
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.activeModel).toEqual(activeModel)
    expect(cfg.mcpServers).toHaveLength(1)
    expect(cfg.skills).toHaveLength(1)
    expect(cfg.agents).toHaveLength(1)
  })

  it('allows all top-level sections to be absent', () => {
    const cfg: HipConfig = { version: 1 }
    expect(cfg.version).toBe(1)
    expect(cfg.providers).toBeUndefined()
    expect(cfg.activeModel).toBeUndefined()
    expect(cfg.mcpServers).toBeUndefined()
    expect(cfg.skills).toBeUndefined()
    expect(cfg.agents).toBeUndefined()
    expect(cfg.agentLoop).toBeUndefined()
  })

  it('round-trips HipConfig through JSON', () => {
    const cfg: HipConfig = {
      version: 1,
      providers: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', enabled: true }],
      activeModel: { providerID: 'deepseek', modelID: 'deepseek-reasoner', baseURL: 'https://api.deepseek.com/v1' },
    }
    const round = JSON.parse(JSON.stringify(cfg)) as HipConfig
    expect(round.version).toBe(1)
    expect(round.providers![0].id).toBe('deepseek')
    expect(round.activeModel?.providerID).toBe('deepseek')
  })
})

describe('protocol: AgentLoopConfig', () => {
  it('models optional step budgets, depth, and inline_partial HITL', () => {
    const loop: AgentLoopConfig = {
      maxSteps: 800,
      childMaxSteps: 25,
      exploreChildMaxSteps: 40,
      maxDepth: 3,
      subagentHitl: 'inline_partial',
    }
    expect(loop.maxSteps).toBe(800)
    expect(loop.childMaxSteps).toBe(25)
    expect(loop.exploreChildMaxSteps).toBe(40)
    expect(loop.maxDepth).toBe(3)
    expect(loop.subagentHitl).toBe('inline_partial')
  })

  it('allows all agentLoop fields to be absent', () => {
    const loop: AgentLoopConfig = {}
    expect(loop.maxSteps).toBeUndefined()
    expect(loop.childMaxSteps).toBeUndefined()
    expect(loop.exploreChildMaxSteps).toBeUndefined()
    expect(loop.maxDepth).toBeUndefined()
    expect(loop.subagentHitl).toBeUndefined()
  })

  it('round-trips agentLoop on HipConfig through JSON', () => {
    const cfg: HipConfig = {
      version: 1,
      agentLoop: {
        maxSteps: 100,
        childMaxSteps: 10,
        exploreChildMaxSteps: 15,
        maxDepth: 2,
        subagentHitl: 'inline_partial',
      },
    }
    const round = JSON.parse(JSON.stringify(cfg)) as HipConfig
    expect(round.agentLoop).toEqual({
      maxSteps: 100,
      childMaxSteps: 10,
      exploreChildMaxSteps: 15,
      maxDepth: 2,
      subagentHitl: 'inline_partial',
    })
  })
})

describe('protocol: ProviderEntry (Todo 1)', () => {
  it('models a provider with all fields', () => {
    const p: ProviderEntry = {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-abc',
      enabled: true,
    }
    expect(p.id).toBe('openai')
    expect(p.name).toBe('OpenAI')
    expect(p.baseUrl).toBe('https://api.openai.com/v1')
    expect(p.apiKey).toBe('sk-abc')
    expect(p.enabled).toBe(true)
  })

  it('allows optional apiKey to be absent', () => {
    const p: ProviderEntry = { id: 'x', name: 'X', baseUrl: 'https://x.com', enabled: false }
    expect(p.apiKey).toBeUndefined()
    expect(p.enabled).toBe(false)
  })

  it('round-trips through JSON', () => {
    const p: ProviderEntry = { id: 'p1', name: 'P1', baseUrl: 'https://p1.example.com', enabled: true }
    const round = JSON.parse(JSON.stringify(p)) as ProviderEntry
    expect(round.id).toBe('p1')
    expect(round.name).toBe('P1')
    expect(round.enabled).toBe(true)
  })
})

describe('protocol: SkillEntry (Todo 1)', () => {
  it('models a skill enable/disable entry', () => {
    const s: SkillEntry = { id: 'pdf-tools', enabled: true }
    expect(s.id).toBe('pdf-tools')
    expect(s.enabled).toBe(true)
  })

  it('round-trips through JSON', () => {
    const s: SkillEntry = { id: 'git-tools', enabled: false }
    const round = JSON.parse(JSON.stringify(s)) as SkillEntry
    expect(round.id).toBe('git-tools')
    expect(round.enabled).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────
// Todo 8 — Multi-level Skill Types
// ──────────────────────────────────────────────────────────────────

describe('protocol: SkillScope + SkillMeta extension (Todo 8)', () => {
  it('SkillMeta supports optional scope and pluginId', () => {
    const meta: SkillMeta = {
      id: 'pdf-tools',
      name: 'PDF Tools',
      description: 'Read and edit PDFs',
      dir: '/Users/me/.hip/skills/pdf-tools',
      hasScripts: true,
      scope: 'project',
      pluginId: 'plug-1',
    }
    expect(meta.scope).toBe('project')
    expect(meta.pluginId).toBe('plug-1')
  })

  it('SkillMeta is backwards-compatible (new fields absent)', () => {
    const meta: SkillMeta = {
      id: 'old-skill',
      name: 'Old Skill',
      description: 'No scope',
      dir: '/tmp/skills/old',
      hasScripts: false,
    }
    // existing fields still work
    expect(meta.id).toBe('old-skill')
    // new fields are optional
    expect(meta.scope).toBeUndefined()
    expect(meta.pluginId).toBeUndefined()
  })

  it('SkillMeta with scope=plugin retains pluginId', () => {
    const meta: SkillMeta = {
      id: 'plug-skill',
      name: 'Plugin Skill',
      description: 'From a plugin',
      dir: '/tmp/plugins/p/.hip/skills/plug-skill',
      hasScripts: true,
      scope: 'plugin',
      pluginId: 'my-plugin',
    }
    const round = JSON.parse(JSON.stringify(meta)) as SkillMeta
    expect(round.scope).toBe('plugin')
    expect(round.pluginId).toBe('my-plugin')
  })

  it('SkillScope admits exactly the three literals', () => {
    const scopes: SkillScope[] = ['global', 'project', 'plugin']
    expect(scopes).toEqual(['global', 'project', 'plugin'])
  })
})

// ──────────────────────────────────────────────────────────────────
// Todo 14 — SkillMeta Extended Frontmatter Fields
// ──────────────────────────────────────────────────────────────────

describe('protocol: SkillMeta extended frontmatter fields (Todo 14)', () => {
  it('SkillMeta with autoInvoke=false', () => {
    const meta: SkillMeta = {
      id: 'manual-skill',
      name: 'Manual Skill',
      description: 'Only invoked via $',
      dir: '/tmp/skills/manual',
      hasScripts: false,
      autoInvoke: false,
    }
    expect(meta.autoInvoke).toBe(false)
  })

  it('SkillMeta with allowedTools', () => {
    const meta: SkillMeta = {
      id: 'safe-skill',
      name: 'Safe Skill',
      description: 'Limited tooling',
      dir: '/tmp/skills/safe',
      hasScripts: true,
      allowedTools: ['bash', 'git'],
    }
    expect(meta.allowedTools).toEqual(['bash', 'git'])
    expect(meta.disallowedTools).toBeUndefined()
  })

  it('SkillMeta with disallowedTools', () => {
    const meta: SkillMeta = {
      id: 'locked-skill',
      name: 'Locked Skill',
      description: 'Block dangerous tools',
      dir: '/tmp/skills/locked',
      hasScripts: false,
      disallowedTools: ['delete_file', 'run_script'],
    }
    expect(meta.disallowedTools).toEqual(['delete_file', 'run_script'])
    expect(meta.allowedTools).toBeUndefined()
  })

  it('SkillMeta with context=fork', () => {
    const meta: SkillMeta = {
      id: 'isolated-skill',
      name: 'Isolated Skill',
      description: 'Runs in a forked subagent',
      dir: '/tmp/skills/isolated',
      hasScripts: true,
      context: 'fork',
    }
    expect(meta.context).toBe('fork')
  })

  it('SkillMeta with paths glob patterns', () => {
    const meta: SkillMeta = {
      id: 'path-bound-skill',
      name: 'Path-Bound',
      description: 'Only activates in matching dirs',
      dir: '/tmp/skills/path-bound',
      hasScripts: false,
      paths: ['**/*.py', '**/*.rs'],
    }
    expect(meta.paths).toEqual(['**/*.py', '**/*.rs'])
  })

  it('SkillMeta with model override', () => {
    const meta: SkillMeta = {
      id: 'model-skill',
      name: 'Model Override',
      description: 'Uses a specific model',
      dir: '/tmp/skills/model',
      hasScripts: false,
      model: 'claude-sonnet-4-20250514',
    }
    expect(meta.model).toBe('claude-sonnet-4-20250514')
  })

  it('SkillMeta with effort level', () => {
    const meta: SkillMeta = {
      id: 'effort-skill',
      name: 'High Effort',
      description: 'Uses max reasoning',
      dir: '/tmp/skills/effort',
      hasScripts: false,
      effort: 'xhigh',
    }
    expect(meta.effort).toBe('xhigh')
  })

  it('SkillMeta with arguments', () => {
    const meta: SkillMeta = {
      id: 'arg-skill',
      name: 'With Args',
      description: 'Accepts named arguments',
      dir: '/tmp/skills/arg',
      hasScripts: true,
      arguments: [
        { name: 'env', description: 'Target environment', required: true },
        { name: 'region', description: 'Cloud region' },
      ],
    }
    expect(meta.arguments).toHaveLength(2)
    expect(meta.arguments![0].name).toBe('env')
    expect(meta.arguments![0].description).toBe('Target environment')
    expect(meta.arguments![0].required).toBe(true)
    expect(meta.arguments![1].name).toBe('region')
    expect(meta.arguments![1].required).toBeUndefined()
  })

  it('SkillMeta with shell override', () => {
    const meta: SkillMeta = {
      id: 'ps-skill',
      name: 'PowerShell Skill',
      description: 'Runs PowerShell commands',
      dir: '/tmp/skills/ps',
      hasScripts: false,
      shell: 'powershell',
    }
    expect(meta.shell).toBe('powershell')
  })

  it('SkillMeta with disableShellExecution', () => {
    const meta: SkillMeta = {
      id: 'no-shell-skill',
      name: 'No Shell',
      description: 'Blocks !`cmd` execution',
      dir: '/tmp/skills/no-shell',
      hasScripts: false,
      disableShellExecution: true,
    }
    expect(meta.disableShellExecution).toBe(true)
  })

  it('SkillMeta with hasReferences and hasAssets', () => {
    const meta: SkillMeta = {
      id: 'rich-skill',
      name: 'Rich Skill',
      description: 'Has reference docs and assets',
      dir: '/tmp/skills/rich',
      hasScripts: true,
      hasReferences: true,
      hasAssets: false,
    }
    expect(meta.hasReferences).toBe(true)
    expect(meta.hasAssets).toBe(false)
  })

  it('SkillMeta with all 15+ new fields populated', () => {
    const meta: SkillMeta = {
      id: 'full-skill',
      name: 'Full Skill',
      description: 'All frontmatter fields',
      dir: '/tmp/skills/full',
      hasScripts: true,
      scope: 'project',
      pluginId: 'plug-x',
      autoInvoke: true,
      userInvocable: true,
      allowedTools: ['bash', 'git', 'read_file'],
      disallowedTools: ['delete_file'],
      context: 'fork',
      paths: ['**/*.ts', '**/*.tsx'],
      model: 'claude-opus-4-20250514',
      effort: 'high',
      arguments: [
        { name: 'task', description: 'Task to perform', required: true },
      ],
      shell: 'bash',
      disableShellExecution: false,
      hasReferences: true,
      hasAssets: true,
    }
    expect(meta.id).toBe('full-skill')
    expect(meta.scope).toBe('project')
    expect(meta.pluginId).toBe('plug-x')
    expect(meta.autoInvoke).toBe(true)
    expect(meta.userInvocable).toBe(true)
    expect(meta.allowedTools).toEqual(['bash', 'git', 'read_file'])
    expect(meta.disallowedTools).toEqual(['delete_file'])
    expect(meta.context).toBe('fork')
    expect(meta.paths).toEqual(['**/*.ts', '**/*.tsx'])
    expect(meta.model).toBe('claude-opus-4-20250514')
    expect(meta.effort).toBe('high')
    expect(meta.arguments).toHaveLength(1)
    expect(meta.shell).toBe('bash')
    expect(meta.disableShellExecution).toBe(false)
    expect(meta.hasReferences).toBe(true)
    expect(meta.hasAssets).toBe(true)
  })

  it('SkillMeta backwards-compatible — old 5-field object still valid', () => {
    const meta: SkillMeta = {
      id: 'old-skill',
      name: 'Old Skill',
      description: 'Only the 5 original fields',
      dir: '/tmp/skills/old',
      hasScripts: false,
      scope: 'global',
    }
    expect(meta.id).toBe('old-skill')
    expect(meta.name).toBe('Old Skill')
    expect(meta.description).toBe('Only the 5 original fields')
    expect(meta.dir).toBe('/tmp/skills/old')
    expect(meta.hasScripts).toBe(false)
    expect(meta.scope).toBe('global')
    // all new fields absent
    expect(meta.autoInvoke).toBeUndefined()
    expect(meta.userInvocable).toBeUndefined()
    expect(meta.allowedTools).toBeUndefined()
    expect(meta.disallowedTools).toBeUndefined()
    expect(meta.context).toBeUndefined()
    expect(meta.paths).toBeUndefined()
    expect(meta.model).toBeUndefined()
    expect(meta.effort).toBeUndefined()
    expect(meta.arguments).toBeUndefined()
    expect(meta.shell).toBeUndefined()
    expect(meta.disableShellExecution).toBeUndefined()
    expect(meta.hasReferences).toBeUndefined()
    expect(meta.hasAssets).toBeUndefined()
  })

  it('SkillMeta round-trips all new fields through JSON', () => {
    const meta: SkillMeta = {
      id: 'rt-skill',
      name: 'Round-Trip',
      description: 'Round-trip test',
      dir: '/tmp/skills/rt',
      hasScripts: true,
      autoInvoke: false,
      userInvocable: true,
      allowedTools: ['bash'],
      disallowedTools: ['run_script'],
      context: 'fork',
      paths: ['**/*.py'],
      model: 'gpt-5',
      effort: 'max',
      arguments: [{ name: 'env', description: 'Target', required: true }],
      shell: 'powershell',
      disableShellExecution: true,
      hasReferences: true,
      hasAssets: false,
    }
    const round = JSON.parse(JSON.stringify(meta)) as SkillMeta
    expect(round.autoInvoke).toBe(false)
    expect(round.userInvocable).toBe(true)
    expect(round.allowedTools).toEqual(['bash'])
    expect(round.disallowedTools).toEqual(['run_script'])
    expect(round.context).toBe('fork')
    expect(round.paths).toEqual(['**/*.py'])
    expect(round.model).toBe('gpt-5')
    expect(round.effort).toBe('max')
    expect(round.arguments).toHaveLength(1)
    expect(round.arguments![0].name).toBe('env')
    expect(round.shell).toBe('powershell')
    expect(round.disableShellExecution).toBe(true)
    expect(round.hasReferences).toBe(true)
    expect(round.hasAssets).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────
// Todo 28 — MCP Resources & Prompts Types
// ──────────────────────────────────────────────────────────────────

describe('protocol: McpResource (Todo 28)', () => {
  it('models a resource with all fields', () => {
    const r: McpResource = {
      uri: 'file:///etc/hosts',
      name: 'Hosts file',
      description: 'System hosts file',
      mimeType: 'text/plain',
    }
    expect(r.uri).toBe('file:///etc/hosts')
    expect(r.name).toBe('Hosts file')
    expect(r.description).toBe('System hosts file')
    expect(r.mimeType).toBe('text/plain')
  })

  it('allows optional fields absent', () => {
    const r: McpResource = { uri: 'db://users', name: 'Users' }
    expect(r.description).toBeUndefined()
    expect(r.mimeType).toBeUndefined()
  })

  it('round-trips through JSON', () => {
    const r: McpResource = { uri: 's3://bucket/key', name: 'My File' }
    const round = JSON.parse(JSON.stringify(r)) as McpResource
    expect(round.uri).toBe('s3://bucket/key')
    expect(round.name).toBe('My File')
  })
})

describe('protocol: McpResourceTemplate (Todo 28)', () => {
  it('models a resource template', () => {
    const t: McpResourceTemplate = {
      uriTemplate: 'file:///{path}',
      name: 'File by path',
      description: 'Access any file',
    }
    expect(t.uriTemplate).toBe('file:///{path}')
    expect(t.name).toBe('File by path')
    expect(t.description).toBe('Access any file')
  })

  it('allows optional description absent', () => {
    const t: McpResourceTemplate = { uriTemplate: 'db://{table}', name: 'Table' }
    expect(t.description).toBeUndefined()
  })
})

describe('protocol: McpPromptArgument (Todo 28)', () => {
  it('models a required prompt argument', () => {
    const a: McpPromptArgument = { name: 'path', description: 'File path', required: true }
    expect(a.name).toBe('path')
    expect(a.description).toBe('File path')
    expect(a.required).toBe(true)
  })

  it('models an optional prompt argument', () => {
    const a: McpPromptArgument = { name: 'format' }
    expect(a.name).toBe('format')
    expect(a.description).toBeUndefined()
    expect(a.required).toBeUndefined()
  })
})

describe('protocol: McpPrompt (Todo 28)', () => {
  it('models a prompt with arguments', () => {
    const p: McpPrompt = {
      name: 'review-code',
      description: 'Review a code change',
      arguments: [
        { name: 'path', description: 'File path', required: true },
        { name: 'context', required: false },
      ],
    }
    expect(p.name).toBe('review-code')
    expect(p.description).toBe('Review a code change')
    expect(p.arguments).toHaveLength(2)
    expect(p.arguments![0].name).toBe('path')
    expect(p.arguments![0].required).toBe(true)
    expect(p.arguments![1].name).toBe('context')
    expect(p.arguments![1].required).toBe(false)
  })

  it('models a prompt without arguments', () => {
    const p: McpPrompt = { name: 'hello' }
    expect(p.name).toBe('hello')
    expect(p.description).toBeUndefined()
    expect(p.arguments).toBeUndefined()
  })

  it('round-trips through JSON', () => {
    const p: McpPrompt = {
      name: 'summarize',
      description: 'Summarize text',
      arguments: [{ name: 'text', required: true }],
    }
    const round = JSON.parse(JSON.stringify(p)) as McpPrompt
    expect(round.name).toBe('summarize')
    expect(round.arguments![0].name).toBe('text')
  })
})

describe('protocol: McpPromptMessage (Todo 28)', () => {
  it('models a user message', () => {
    const m: McpPromptMessage = { role: 'user', content: 'Hello' }
    expect(m.role).toBe('user')
    expect(m.content).toBe('Hello')
  })

  it('models an assistant message', () => {
    const m: McpPromptMessage = { role: 'assistant', content: 'Hi there' }
    expect(m.role).toBe('assistant')
    expect(m.content).toBe('Hi there')
  })

  it('round-trips through JSON', () => {
    const m: McpPromptMessage = { role: 'user', content: 'Review this code' }
    const round = JSON.parse(JSON.stringify(m)) as McpPromptMessage
    expect(round.role).toBe('user')
    expect(round.content).toBe('Review this code')
  })
})

describe('protocol: McpResourceContent (Todo 28)', () => {
  it('models text content', () => {
    const c: McpResourceContent = {
      uri: 'file:///readme.md',
      mimeType: 'text/markdown',
      text: '# Hello',
    }
    expect(c.uri).toBe('file:///readme.md')
    expect(c.mimeType).toBe('text/markdown')
    expect(c.text).toBe('# Hello')
    expect(c.blob).toBeUndefined()
  })

  it('models blob content', () => {
    const c: McpResourceContent = {
      uri: 'file:///image.png',
      mimeType: 'image/png',
      blob: 'base64data',
    }
    expect(c.uri).toBe('file:///image.png')
    expect(c.blob).toBe('base64data')
    expect(c.text).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────────
// Todo 28 — MCP ClientMessage & ServerMessage variants
// ──────────────────────────────────────────────────────────────────

describe('protocol: MCP ClientMessage variants (Todo 28)', () => {
  it('mcp:listResources', () => {
    const m: ClientMessage = { type: 'mcp:listResources', serverId: 'srv-1' }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'mcp:listResources' }>
    expect(rt.type).toBe('mcp:listResources')
    expect(rt.serverId).toBe('srv-1')
  })

  it('mcp:readResource', () => {
    const m: ClientMessage = { type: 'mcp:readResource', serverId: 'srv-1', uri: 'file:///etc/hosts' }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'mcp:readResource' }>
    expect(rt.type).toBe('mcp:readResource')
    expect(rt.serverId).toBe('srv-1')
    expect(rt.uri).toBe('file:///etc/hosts')
  })

  it('mcp:listPrompts', () => {
    const m: ClientMessage = { type: 'mcp:listPrompts', serverId: 'srv-1' }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'mcp:listPrompts' }>
    expect(rt.type).toBe('mcp:listPrompts')
    expect(rt.serverId).toBe('srv-1')
  })

  it('mcp:getPrompt', () => {
    const m: ClientMessage = {
      type: 'mcp:getPrompt',
      serverId: 'srv-1',
      name: 'review-code',
      arguments: { path: 'src/index.ts' },
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'mcp:getPrompt' }>
    expect(rt.type).toBe('mcp:getPrompt')
    expect(rt.serverId).toBe('srv-1')
    expect(rt.name).toBe('review-code')
    expect(rt.arguments).toEqual({ path: 'src/index.ts' })
  })

  it('mcp:getPrompt allows optional arguments absent', () => {
    const m: ClientMessage = { type: 'mcp:getPrompt', serverId: 'srv-1', name: 'hello' }
    expect(m.type).toBe('mcp:getPrompt')
    expect((m as any).arguments).toBeUndefined()
  })
})

describe('protocol: MCP ServerMessage variants (Todo 28)', () => {
  it('mcp:listResources:result', () => {
    const m: ServerMessage = {
      type: 'mcp:listResources:result',
      serverId: 'srv-1',
      resources: [{ uri: 'file:///etc/hosts', name: 'Hosts' }],
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'mcp:listResources:result' }>
    expect(rt.type).toBe('mcp:listResources:result')
    expect(rt.serverId).toBe('srv-1')
    expect(rt.resources).toHaveLength(1)
    expect(rt.resources[0].uri).toBe('file:///etc/hosts')
  })

  it('mcp:listResources:result with resourceTemplates and error', () => {
    const m: ServerMessage = {
      type: 'mcp:listResources:result',
      serverId: 'srv-1',
      resources: [],
      resourceTemplates: [{ uriTemplate: 'file:///{path}', name: 'File' }],
      error: 'timeout',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'mcp:listResources:result' }>
    expect(rt.resources).toEqual([])
    expect(rt.resourceTemplates).toHaveLength(1)
    expect(rt.error).toBe('timeout')
  })

  it('mcp:readResource:result', () => {
    const m: ServerMessage = {
      type: 'mcp:readResource:result',
      serverId: 'srv-1',
      uri: 'file:///readme.md',
      contents: [{ uri: 'file:///readme.md', mimeType: 'text/markdown', text: '# Hi' }],
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'mcp:readResource:result' }>
    expect(rt.type).toBe('mcp:readResource:result')
    expect(rt.uri).toBe('file:///readme.md')
    expect(rt.contents[0].text).toBe('# Hi')
  })

  it('mcp:listPrompts:result', () => {
    const m: ServerMessage = {
      type: 'mcp:listPrompts:result',
      serverId: 'srv-1',
      prompts: [{ name: 'review', description: 'Review code' }],
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'mcp:listPrompts:result' }>
    expect(rt.type).toBe('mcp:listPrompts:result')
    expect(rt.prompts).toHaveLength(1)
    expect(rt.prompts[0].name).toBe('review')
  })

  it('mcp:getPrompt:result', () => {
    const m: ServerMessage = {
      type: 'mcp:getPrompt:result',
      serverId: 'srv-1',
      name: 'review-code',
      messages: [{ role: 'user', content: 'Review src/index.ts' }],
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'mcp:getPrompt:result' }>
    expect(rt.type).toBe('mcp:getPrompt:result')
    expect(rt.name).toBe('review-code')
    expect(rt.messages[0].role).toBe('user')
    expect(rt.messages[0].content).toBe('Review src/index.ts')
  })
})

// ──────────────────────────────────────────────────────────────────
// Todo 1 — McpServerConfig extension (enabledTools / disabledTools)
// ──────────────────────────────────────────────────────────────────

describe('protocol: McpServerConfig extended fields (Todo 1)', () => {
  it('supports enabledTools allowlist', () => {
    const srv: McpServerConfig = {
      id: 'srv-a',
      name: 'Filtered',
      transport: 'stdio',
      command: 'npx',
      args: [],
      enabledTools: ['read_file', 'search'],
      enabled: true,
    }
    expect(srv.enabledTools).toEqual(['read_file', 'search'])
    expect(srv.disabledTools).toBeUndefined()
  })

  it('supports disabledTools denylist', () => {
    const srv: McpServerConfig = {
      id: 'srv-b',
      name: 'Safe',
      transport: 'sse',
      url: 'https://example.com',
      disabledTools: ['delete_file'],
      enabled: true,
    }
    expect(srv.disabledTools).toEqual(['delete_file'])
    expect(srv.enabledTools).toBeUndefined()
  })

  it('existing McpServerConfig without new fields is backwards-compatible', () => {
    const srv: McpServerConfig = {
      id: 'srv-c',
      name: 'Legacy',
      transport: 'http',
      url: 'https://old.example.com',
      enabled: false,
    }
    expect(srv.enabledTools).toBeUndefined()
    expect(srv.disabledTools).toBeUndefined()
  })

  it('round-trips new fields through JSON', () => {
    const srv: McpServerConfig = {
      id: 'srv-d',
      name: 'Test',
      transport: 'stdio',
      command: 'test',
      args: [],
      enabledTools: ['tool1', 'tool2'],
      disabledTools: ['tool3'],
      enabled: true,
    }
    const round = JSON.parse(JSON.stringify(srv)) as McpServerConfig
    expect(round.enabledTools).toEqual(['tool1', 'tool2'])
    expect(round.disabledTools).toEqual(['tool3'])
  })
})
  it('admits all doomLoopStrategy literals', () => {
    const strategies: DoomLoopStrategy[] = ['nudge_then_pause', 'pause_immediately', 'auto_continue']
    expect(strategies).toHaveLength(3)
  })

  it('models agentLoop with doomLoopStrategy', () => {
    const agentLoop: AgentLoopConfig = { doomLoopStrategy: 'nudge_then_pause' }
    const cfg: HipConfig = { version: 1, agentLoop }
    expect(cfg.agentLoop?.doomLoopStrategy).toBe('nudge_then_pause')
  })

  it('round-trips langsmith on HipConfig through JSON', () => {
    const langsmith: LangSmithConfig = {
      enabled: true,
      apiKey: 'lsv2_x',
      project: 'hip',
      endpoint: 'https://eu.api.smith.langchain.com',
    }
    const cfg: HipConfig = { version: 1, langsmith }
    const round = JSON.parse(JSON.stringify(cfg)) as HipConfig
    expect(round.langsmith).toEqual(langsmith)
  })

