// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { SkillMeta, PluginMeta } from '@hip/protocol'
import { useSkillsStore } from '@/store/skillsStore'
import { usePluginsStore } from '@/store/pluginsStore'

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

type MenuProps = {
  kind: string
  payload: {
    skillId: string
    name: string
    canDelete: boolean
    onView: () => void
    onDelete: () => void
  }
  children: React.ReactNode
}

let lastSkillMenuProps: MenuProps | null = null

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: (props: MenuProps) => {
    lastSkillMenuProps = props
    return <>{props.children}</>
  },
}))

import { SkillConfig, SkillCard, derivePluginSkills } from './SkillConfig'

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

function plugin(overrides: Partial<PluginMeta> = {}): PluginMeta {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    dir: '/tmp/plugins/test',
    skills: [] as string[],
    mcpServers: [],
    agents: [],
    hookCount: 0,
    hookEvents: [],
    ...overrides,
  }
}

beforeEach(() => {
  useSkillsStore.setState({ skills: [], enabled: {}, loaded: true })
  usePluginsStore.setState({ plugins: [], loaded: true })
  lastSkillMenuProps = null
})

afterEach(() => cleanup())

describe('SkillCard plugin variant', () => {
  it('renders skill name, description, and a "via plugin" badge', () => {
    render(
      <SkillCard
        skill={skill({ id: 'plugin-skill', name: 'Plugin Skill', pluginId: 'p1', scope: 'plugin' })}
        enabled={false}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={() => {}}
        readOnly={{ pluginName: 'TestPlugin' }}
      />,
    )
    expect(screen.getByText('Plugin Skill')).toBeInTheDocument()
    expect(screen.getByText('A standalone skill')).toBeInTheDocument()
    expect(screen.getByText('via TestPlugin')).toBeInTheDocument()
  })

  it('renders an interactive switch that defaults to enabled', () => {
    render(
      <SkillCard
        skill={skill({ id: 'plugin-skill', pluginId: 'p1', scope: 'plugin' })}
        enabled={true}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={() => {}}
        readOnly={{ pluginName: 'TestPlugin' }}
      />,
    )
    const toggle = screen.getByRole('switch')
    expect(toggle).not.toBeDisabled()
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onToggle when the plugin skill switch is clicked', () => {
    const onToggle = vi.fn()
    render(
      <SkillCard
        skill={skill({ id: 'plugin-skill', pluginId: 'p1', scope: 'plugin' })}
        enabled={true}
        onToggle={onToggle}
        onView={() => {}}
        onDelete={() => {}}
        readOnly={{ pluginName: 'TestPlugin' }}
      />,
    )
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('omits the delete menu item', () => {
    render(
      <SkillCard
        skill={skill({ id: 'plugin-skill', pluginId: 'p1', scope: 'plugin' })}
        enabled={false}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={() => {}}
        readOnly={{ pluginName: 'TestPlugin' }}
      />,
    )
    expect(screen.getByText('settings.skill.view')).toBeInTheDocument()
    expect(screen.queryByText('settings.skill.delete')).not.toBeInTheDocument()
  })

  it('wires DeclarativeContextMenu with canDelete false for plugin skills', () => {
    render(
      <SkillCard
        skill={skill({ id: 'plugin-skill', name: 'Plugin Skill', pluginId: 'p1', scope: 'plugin' })}
        enabled={false}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={() => {}}
        readOnly={{ pluginName: 'TestPlugin' }}
      />,
    )
    expect(lastSkillMenuProps?.kind).toBe('skillConfig')
    expect(lastSkillMenuProps?.payload).toMatchObject({
      skillId: 'plugin-skill',
      name: 'Plugin Skill',
      canDelete: false,
    })
  })
})

describe('SkillCard standalone variant', () => {
  it('remains interactive and keeps the delete menu item', () => {
    render(
      <SkillCard
        skill={skill()}
        enabled={true}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={() => {}}
      />,
    )
    const toggle = screen.getByRole('switch')
    expect(toggle).not.toBeDisabled()
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('settings.skill.view')).toBeInTheDocument()
    expect(screen.getByText('settings.skill.delete')).toBeInTheDocument()
  })

  it('wires DeclarativeContextMenu with canDelete true for standalone skills', () => {
    const onView = vi.fn()
    const onDelete = vi.fn()
    render(
      <SkillCard
        skill={skill()}
        enabled={true}
        onToggle={() => {}}
        onView={onView}
        onDelete={onDelete}
      />,
    )
    expect(lastSkillMenuProps?.kind).toBe('skillConfig')
    expect(lastSkillMenuProps?.payload.skillId).toBe('standalone-skill')
    expect(lastSkillMenuProps?.payload.canDelete).toBe(true)
    lastSkillMenuProps!.payload.onView()
    lastSkillMenuProps!.payload.onDelete()
    expect(onView).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('skill-card')).toBeInTheDocument()
  })

  it('calls onToggle when the switch is clicked', () => {
    const onToggle = vi.fn()
    render(
      <SkillCard
        skill={skill()}
        enabled={false}
        onToggle={onToggle}
        onView={() => {}}
        onDelete={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('calls onView when the view menu item is clicked', () => {
    const onView = vi.fn()
    render(
      <SkillCard
        skill={skill()}
        enabled={true}
        onToggle={() => {}}
        onView={onView}
        onDelete={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('settings.skill.view'))
    expect(onView).toHaveBeenCalled()
  })

  it('calls onDelete when the delete menu item is clicked', () => {
    const onDelete = vi.fn()
    render(
      <SkillCard
        skill={skill()}
        enabled={true}
        onToggle={() => {}}
        onView={() => {}}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByText('settings.skill.delete'))
    expect(onDelete).toHaveBeenCalled()
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
    hookEvents: [],
      },
    ]
    const result = derivePluginSkills(plugins, new Set(['shared']))
    expect(result.map((r) => r.skill.id)).toEqual(['unique'])
  })
})

describe('SkillConfig list layout', () => {
  it('renders the empty state when there are no standalone or plugin skills', () => {
    render(<SkillConfig />)
    expect(screen.getByText('settings.skill.empty')).toBeInTheDocument()
    expect(screen.getByText('settings.skill.emptyHint')).toBeInTheDocument()
  })

  it('renders standalone skills and plugin skills with the section header', () => {
    useSkillsStore.setState({
      skills: [
        skill({ id: 's1', name: 'Standalone One' }),
        skill({ id: 's2', name: 'Standalone Two' }),
      ],
      enabled: { s1: true, s2: false },
      loaded: true,
    })
    usePluginsStore.setState({
      plugins: [plugin({ skills: ['ps1', 'ps2'] })],
      loaded: true,
    })

    render(<SkillConfig />)

    expect(screen.getByText('Standalone One')).toBeInTheDocument()
    expect(screen.getByText('Standalone Two')).toBeInTheDocument()
    expect(screen.getByText('settings.skill.pluginSkills')).toBeInTheDocument()
    expect(screen.getByText('ps1')).toBeInTheDocument()
    expect(screen.getByText('ps2')).toBeInTheDocument()
    expect(screen.queryByText('settings.skill.empty')).not.toBeInTheDocument()
  })

  it('does not render the plugin section when there are no plugin skills', () => {
    useSkillsStore.setState({
      skills: [skill({ id: 's1', name: 'Standalone One' })],
      enabled: { s1: true },
      loaded: true,
    })

    render(<SkillConfig />)

    expect(screen.getByText('Standalone One')).toBeInTheDocument()
    expect(screen.queryByText('settings.skill.pluginSkills')).not.toBeInTheDocument()
  })

  it('reflects the enabled map for plugin skills and toggles them', async () => {
    useSkillsStore.setState({
      skills: [],
      enabled: { ps1: false },
      loaded: true,
    })
    usePluginsStore.setState({
      plugins: [plugin({ skills: ['ps1'] })],
      loaded: true,
    })

    render(<SkillConfig />)

    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)
    await waitFor(() => {
      expect(useSkillsStore.getState().enabled.ps1).toBe(true)
    })
  })
})
