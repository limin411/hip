// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { AgentModelGroup } from '@/lib/agentModelOptions'
import { ModelSelectField } from './ModelSelectField'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
  }),
}))

const groups: AgentModelGroup[] = [
  {
    providerID: 'openai',
    providerName: 'OpenAI',
    models: [
      { key: 'openai/gpt-4o', modelID: 'gpt-4o' },
      { key: 'openai/gpt-4o-mini', modelID: 'gpt-4o-mini' },
    ],
  },
  {
    providerID: 'anthropic',
    providerName: 'Anthropic',
    models: [{ key: 'anthropic/claude-sonnet-4', modelID: 'claude-sonnet-4' }],
  },
]

describe('ModelSelectField', () => {
  afterEach(() => cleanup())

  it('opens searchable list and filters by query', () => {
    const onChange = vi.fn()
    render(
      <ModelSelectField
        value=""
        onChange={onChange}
        groups={groups}
        emptyLabel="Active model"
        data-testid="ms"
      />,
    )

    fireEvent.click(screen.getByTestId('ms'))
    expect(screen.getByTestId('ms-search')).toBeInTheDocument()
    expect(screen.getAllByTestId('ms-item')).toHaveLength(3)

    fireEvent.change(screen.getByTestId('ms-search'), {
      target: { value: 'mini' },
    })
    expect(screen.getAllByTestId('ms-item')).toHaveLength(1)
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument()
  })

  it('selects a model key', () => {
    const onChange = vi.fn()
    render(
      <ModelSelectField
        value=""
        onChange={onChange}
        groups={groups}
        emptyLabel="Active model"
        data-testid="ms"
      />,
    )
    fireEvent.click(screen.getByTestId('ms'))
    fireEvent.click(screen.getByText('gpt-4o'))
    expect(onChange).toHaveBeenCalledWith('openai/gpt-4o')
  })

  it('selects empty default option', () => {
    const onChange = vi.fn()
    render(
      <ModelSelectField
        value="openai/gpt-4o"
        onChange={onChange}
        groups={groups}
        emptyLabel="Active model"
        data-testid="ms"
      />,
    )
    fireEvent.click(screen.getByTestId('ms'))
    fireEvent.click(screen.getByTestId('ms-default'))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
