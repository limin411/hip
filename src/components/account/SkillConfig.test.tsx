import { vi, describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => children,
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  const React = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'menu-content' }, children),
    DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => React.createElement('button', { onClick: onSelect }, children),
    DropdownMenuSeparator: () => React.createElement('hr'),
  }
})

import { SkillCard, derivePluginSkills } from './SkillConfig'
import type { SkillMeta } from '@hip/protocol'

function skill(overrides: Partial<SkillMeta> = {}): SkillMeta {
  return {
    id: 'standalone-skill',
    name: 'Standalone Skill',
    description: 'A standalone skill',
    dir: '/tmp/skills/standalone',
    hasScripts: false,
    ...overrides,
  }
}

describe('SkillCard plugin variant', () => {
  it('renders skill name, description, and a "via plugin" badge', () => {
    const html = renderToStaticMarkup(
      <SkillCard
        skill={skill({ id: 'plugin-skill', name: 'Plugin Skill', pluginId: 'p1', scope: 'plugin' })}
        enabled={false}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={() => {}}
        readOnly={{ pluginName: 'TestPlugin' }}
      />,
    )
    expect(html).toContain('Plugin Skill')
    expect(html).toContain('A standalone skill')
    expect(html).toContain('via TestPlugin')
  })

  it('renders a dimmed, disabled switch', () => {
    const html = renderToStaticMarkup(
      <SkillCard
        skill={skill({ id: 'plugin-skill', pluginId: 'p1', scope: 'plugin' })}
        enabled={false}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={() => {}}
        readOnly={{ pluginName: 'TestPlugin' }}
      />,
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-disabled="true"')
  })

  it('omits the delete menu item', () => {
    const html = renderToStaticMarkup(
      <SkillCard
        skill={skill({ id: 'plugin-skill', pluginId: 'p1', scope: 'plugin' })}
        enabled={false}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={() => {}}
        readOnly={{ pluginName: 'TestPlugin' }}
      />,
    )
    expect(html).toContain('settings.skill.view')
    expect(html).not.toContain('settings.skill.delete')
  })
})

describe('SkillCard standalone variant', () => {
  it('remains interactive and keeps the delete menu item', () => {
    const html = renderToStaticMarkup(
      <SkillCard
        skill={skill()}
        enabled={true}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('aria-disabled="true"')
    expect(html).toContain('settings.skill.view')
    expect(html).toContain('settings.skill.delete')
  })
})

describe('derivePluginSkills duplicate policy', () => {
  it('lets standalone skills win over plugin skills with the same id', () => {
    const plugins = [
      {
        id: 'p1',
        name: 'Plugin One',
        version: '1.0.0',
        description: '',
        dir: '/tmp/p1',
        skills: ['shared', 'unique'],
        mcpServers: [],
        agents: [],
        hookCount: 0,
      },
    ]
    const result = derivePluginSkills(plugins, new Set(['shared']))
    expect(result.map((r) => r.skill.id)).toEqual(['unique'])
  })
})
