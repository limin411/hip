import { describe, it, expect, beforeEach } from 'vitest'
import { useStylesStore } from './stylesStore'

beforeEach(() => useStylesStore.setState({ presets: [] }))

describe('stylesStore', () => {
  it('addPreset appends a preset with an id and returns it', () => {
    const p = useStylesStore.getState().addPreset('Terse', 'Be brief')
    expect(p.id).toBeTruthy()
    expect(p).toMatchObject({ name: 'Terse', text: 'Be brief' })
    expect(useStylesStore.getState().presets).toEqual([p])
  })

  it('updatePreset patches name/text by id', () => {
    const p = useStylesStore.getState().addPreset('A', 'a')
    useStylesStore.getState().updatePreset(p.id, { name: 'B' })
    expect(useStylesStore.getState().presets[0]).toMatchObject({ id: p.id, name: 'B', text: 'a' })
  })

  it('removePreset drops by id', () => {
    const p = useStylesStore.getState().addPreset('A', 'a')
    useStylesStore.getState().removePreset(p.id)
    expect(useStylesStore.getState().presets).toEqual([])
  })
})
