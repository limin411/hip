// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { CurrentModelHero } from './CurrentModelHero'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

afterEach(() => cleanup())

describe('CurrentModelHero', () => {
  it('uses base empty-state keys by default', () => {
    const { getByText } = render(
      <CurrentModelHero providerName={null} modelID={null} model={undefined} keyConfigured={false} purpose="base" />,
    )
    expect(getByText('settings.modelConfig.purpose.base.noModel')).toBeInTheDocument()
    expect(getByText('settings.modelConfig.purpose.base.noModelHint')).toBeInTheDocument()
  })

  it('uses embedding empty-state keys', () => {
    const { getByText } = render(
      <CurrentModelHero
        providerName={null}
        modelID={null}
        model={undefined}
        keyConfigured={false}
      />,
    )
    expect(getByText('settings.modelConfig.purpose.base.noModel')).toBeInTheDocument()
  })

  it('shows purpose currentModel label when filled', () => {
    const { getByText } = render(
      <CurrentModelHero
        providerName="OpenAI"
        modelID="gpt-4o-mini"
        model={undefined}
        keyConfigured={true}
      />,
    )
    expect(getByText(/settings.modelConfig.purpose.base.currentModel/)).toBeInTheDocument()
    expect(getByText('gpt-4o-mini')).toBeInTheDocument()
  })
})
