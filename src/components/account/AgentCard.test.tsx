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
    expect(screen.getByText('Not installed')).toBeInTheDocument()
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
