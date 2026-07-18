// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FixedAgentCard } from './FixedAgentCard'
import type { AgentConfig } from '@hip/protocol'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'settings.agents.builtin') return 'Built-in'
      if (key === 'settings.agents.badgeGlobalModel') return 'Global model'
      if (key === 'settings.agents.enableThis') return 'Available as sub-agent'
      if (key === 'settings.agents.fixedCoderDesc') return 'Default sub-agent. Reads, writes files, executes commands, searches code, and implements changes.'
      return options?.defaultValue ?? key
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

afterEach(() => {
  cleanup()
})

const coder: AgentConfig = {
  id: 'coder',
  name: 'Coder',
  description: 'Default sub-agent. Reads, writes, files.',
  kind: 'internal',
  command: '',
  args: [],
  enabled: true,
  prompt: 'You are a coder.',
}

describe('FixedAgentCard', () => {
  it('renders agent name and description', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.getByText('Coder')).toBeInTheDocument()
    expect(screen.getByText('Default sub-agent. Reads, writes files, executes commands, searches code, and implements changes.')).toBeInTheDocument()
  })

  it('shows built-in badge', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.getByText(/内置|Built-in|內建/)).toBeInTheDocument()
  })

  it('built-in badge uses accent identity chip', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    const badge = screen.getByText(/内置|Built-in|內建/)
    expect(badge).toHaveClass('bg-accent/10')
    expect(badge).toHaveClass('text-accent')
    expect(badge).not.toHaveClass('bg-accent-subtle')
  })

  it('shows lock icon', () => {
    const { container } = render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    // Lock icon is rendered via lucide-react Lock component
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('does NOT render edit button', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.queryByLabelText(/edit|编辑|編輯/i)).toBeNull()
  })

  it('does NOT render delete button', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.queryByLabelText(/delete|删除|刪除/i)).toBeNull()
  })

  it('does NOT render kebab menu', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.queryByLabelText(/more|更多/i)).toBeNull()
  })

  it('renders switch with correct checked state', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    const switchEl = screen.getByRole('switch')
    expect(switchEl).toBeChecked()
  })

  it('renders unchecked switch when disabled', () => {
    render(<FixedAgentCard agent={coder} enabled={false} onToggle={() => {}} />)
    const switchEl = screen.getByRole('switch')
    expect(switchEl).not.toBeChecked()
  })

  it('calls onToggle when switch is clicked', () => {
    const onToggle = vi.fn()
    render(<FixedAgentCard agent={coder} enabled onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })
})
