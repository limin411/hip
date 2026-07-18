// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AgentCard } from './AgentCard'
import type { AgentConfig } from '@hip/protocol'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'settings.agents.catAcp': 'ACP agent',
        'settings.agents.badgeInternal': 'Internal',
        'settings.agents.enableThis': 'Available as sub-agent',
        'settings.agents.statusInstalled': 'Installed',
        'settings.agents.statusNotInstalled': 'Not installed',
        'settings.agents.statusAdapterNotInstalled': 'Adapter not installed',
        'settings.agents.edit': 'Edit',
        'settings.agents.delete': 'Delete',
        'settings.agents.menuMore': 'More',
      }
      if (map[key]) return map[key]
      return options?.defaultValue ?? key
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

type MenuProps = {
  kind: string
  payload: { agentId: string; onEdit: () => void; onDelete: () => void }
  children: React.ReactNode
  className?: string
}

let lastMenuProps: MenuProps | null = null

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: (props: MenuProps) => {
    lastMenuProps = props
    return <>{props.children}</>
  },
}))

afterEach(() => {
  cleanup()
  lastMenuProps = null
})

const acpAgent = (overrides?: Partial<AgentConfig>): AgentConfig => ({
  id: 'a1',
  name: 'OpenCode',
  description: 'OpenCode agent',
  kind: 'acp',
  command: 'opencode',
  args: ['acp', '--pure'],
  enabled: true,
  quirks: 'opencode',
  ...overrides,
})

const internalAgent = (): AgentConfig => ({
  id: 'i1',
  name: 'Coder',
  description: 'Internal agent',
  kind: 'internal',
  command: '',
  args: [],
  enabled: true,
  prompt: 'You are a coder.',
})

describe('AgentCard — grid view', () => {
  it('renders ACP agent and calls onToggle when binary is installed', () => {
    const onToggle = vi.fn()
    render(
      <AgentCard
        agent={acpAgent()}
        viewMode="grid"
        installed={{ opencode: true }}
        detectionChecked
        onToggle={onToggle}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByText('OpenCode')).toBeInTheDocument()
    const sw = screen.getByRole('switch')
    expect(sw).toBeChecked()
    expect(sw).not.toBeDisabled()
    fireEvent.click(sw)
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('forces switch off and disables it when the ACP binary is missing', () => {
    const onToggle = vi.fn()
    render(
      <AgentCard
        agent={acpAgent()}
        viewMode="grid"
        installed={{ opencode: false }}
        detectionChecked
        onToggle={onToggle}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const sw = screen.getByRole('switch')
    expect(sw).not.toBeChecked()
    expect(sw).toBeDisabled()
    expect(screen.getByText('Not installed')).toBeInTheDocument()
    fireEvent.click(sw)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('forces switch off and shows adapter install cmd when only the adapter is missing', () => {
    const onToggle = vi.fn()
    render(
      <AgentCard
        agent={acpAgent({
          name: 'Pi',
          command: 'pi-acp',
          args: [],
          quirks: 'pi',
        })}
        viewMode="grid"
        installed={{ pi: true, 'pi-acp': false }}
        detectionChecked
        onToggle={onToggle}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const sw = screen.getByRole('switch')
    expect(sw).not.toBeChecked()
    expect(sw).toBeDisabled()
    expect(screen.getByText('Adapter not installed')).toBeInTheDocument()
    expect(screen.getByText('npm i -g pi-acp')).toBeInTheDocument()
    expect(screen.queryByText('Not installed')).not.toBeInTheDocument()
  })

  it('does not show install status for internal agents', () => {
    render(
      <AgentCard
        agent={internalAgent()}
        viewMode="grid"
        installed={{}}
        detectionChecked
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.queryByText('Not installed')).not.toBeInTheDocument()
    expect(screen.queryByText('Installed')).not.toBeInTheDocument()
    const sw = screen.getByRole('switch')
    expect(sw).toBeChecked()
    expect(sw).not.toBeDisabled()
  })

  it('internal category badge uses accent identity chip', () => {
    render(
      <AgentCard
        agent={internalAgent()}
        viewMode="grid"
        installed={{}}
        detectionChecked
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const badge = screen.getByText('Internal')
    expect(badge).toHaveClass('bg-accent/10')
    expect(badge).toHaveClass('text-accent')
    expect(badge).not.toHaveClass('bg-accent-subtle')
  })

  it('ACP category badge stays neutral default', () => {
    render(
      <AgentCard
        agent={acpAgent()}
        viewMode="grid"
        installed={{ opencode: true }}
        detectionChecked
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const badge = screen.getByText('ACP agent')
    expect(badge).toHaveClass('bg-surface-muted')
    expect(badge).not.toHaveClass('bg-accent/10')
  })

  it('does not force off before detection has run', () => {
    render(
      <AgentCard
        agent={acpAgent()}
        viewMode="grid"
        installed={{}}
        detectionChecked={false}
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const sw = screen.getByRole('switch')
    expect(sw).toBeChecked()
    expect(sw).not.toBeDisabled()
    expect(screen.queryByText('Not installed')).not.toBeInTheDocument()
  })
})

describe('AgentCard — list view', () => {
  it('shows not-installed badge and disables switch when binary is missing', () => {
    const onToggle = vi.fn()
    render(
      <AgentCard
        agent={acpAgent()}
        viewMode="list"
        installed={{ opencode: false }}
        detectionChecked
        onToggle={onToggle}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const sw = screen.getByRole('switch')
    expect(sw).not.toBeChecked()
    expect(sw).toBeDisabled()
    // badge + install hint both say "Not installed"
    expect(screen.getAllByText('Not installed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('npm i -g opencode-ai')).toBeInTheDocument()
  })

  it('shows adapter-not-installed badge when agent is present but adapter is missing', () => {
    render(
      <AgentCard
        agent={acpAgent({
          name: 'Pi',
          command: 'pi-acp',
          args: [],
          quirks: 'pi',
        })}
        viewMode="list"
        installed={{ pi: true, 'pi-acp': false }}
        detectionChecked
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const sw = screen.getByRole('switch')
    expect(sw).not.toBeChecked()
    expect(sw).toBeDisabled()
    // badge + install hint both say "Adapter not installed"
    expect(screen.getAllByText('Adapter not installed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('npm i -g pi-acp')).toBeInTheDocument()
  })

  it('shows installed badge when binary is present', () => {
    render(
      <AgentCard
        agent={acpAgent()}
        viewMode="list"
        installed={{ opencode: true }}
        detectionChecked
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const sw = screen.getByRole('switch')
    expect(sw).toBeChecked()
    expect(sw).not.toBeDisabled()
    expect(screen.getByText('Installed')).toBeInTheDocument()
  })

  it('internal category badge uses accent identity chip', () => {
    render(
      <AgentCard
        agent={internalAgent()}
        viewMode="list"
        installed={{}}
        detectionChecked
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const badge = screen.getByText('Internal')
    expect(badge).toHaveClass('bg-accent/10')
    expect(badge).toHaveClass('text-accent')
    expect(badge).not.toHaveClass('bg-accent-subtle')
  })

  it('ACP category badge stays neutral default', () => {
    render(
      <AgentCard
        agent={acpAgent()}
        viewMode="list"
        installed={{ opencode: true }}
        detectionChecked
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const badge = screen.getByText('ACP agent')
    expect(badge).toHaveClass('bg-surface-muted')
    expect(badge).not.toHaveClass('bg-accent/10')
  })

  it('wires DeclarativeContextMenu with agentConfig kind and handlers', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <AgentCard
        agent={acpAgent()}
        viewMode="list"
        installed={{ opencode: true }}
        detectionChecked
        onToggle={() => {}}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    )
    expect(lastMenuProps?.kind).toBe('agentConfig')
    expect(lastMenuProps?.payload.agentId).toBe('a1')
    lastMenuProps!.payload.onEdit()
    lastMenuProps!.payload.onDelete()
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('agent-card')).toBeInTheDocument()
  })
})

describe('AgentCard — grid context menu wiring', () => {
  it('wires DeclarativeContextMenu on grid cards', () => {
    render(
      <AgentCard
        agent={internalAgent()}
        viewMode="grid"
        installed={{}}
        detectionChecked
        onToggle={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(lastMenuProps?.kind).toBe('agentConfig')
    expect(lastMenuProps?.payload.agentId).toBe('i1')
    expect(screen.getByTestId('agent-card')).toHaveClass('rounded-lg')
  })
})
