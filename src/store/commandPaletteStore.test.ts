// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { useCommandPaletteStore } from './commandPaletteStore'

describe('commandPaletteStore', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ open: false, page: null, previousSearch: '' })
  })

  it('starts closed with no page', () => {
    expect(useCommandPaletteStore.getState().open).toBe(false)
    expect(useCommandPaletteStore.getState().page).toBeNull()
  })

  it('setOpen(true) opens without setting a page', () => {
    useCommandPaletteStore.getState().setOpen(true)
    expect(useCommandPaletteStore.getState().open).toBe(true)
    expect(useCommandPaletteStore.getState().page).toBeNull()
  })

  it('setOpen(false) clears page', () => {
    useCommandPaletteStore.getState().openPage('theme')
    useCommandPaletteStore.getState().setOpen(false)
    expect(useCommandPaletteStore.getState().open).toBe(false)
    expect(useCommandPaletteStore.getState().page).toBeNull()
  })

  it('toggle opens then closes and clears page', () => {
    useCommandPaletteStore.getState().toggle()
    expect(useCommandPaletteStore.getState().open).toBe(true)
    useCommandPaletteStore.getState().openPage('model')
    useCommandPaletteStore.getState().toggle()
    expect(useCommandPaletteStore.getState().open).toBe(false)
    expect(useCommandPaletteStore.getState().page).toBeNull()
  })

  it('openPage opens and sets nested page with previousSearch', () => {
    useCommandPaletteStore.getState().openPage('theme', 'mod')
    expect(useCommandPaletteStore.getState().open).toBe(true)
    expect(useCommandPaletteStore.getState().page).toBe('theme')
    expect(useCommandPaletteStore.getState().previousSearch).toBe('mod')
  })

  it('goBack restores previousSearch and clears page', () => {
    useCommandPaletteStore.getState().openPage('model', 'switch')
    const restored = useCommandPaletteStore.getState().goBack()
    expect(restored).toBe('switch')
    expect(useCommandPaletteStore.getState().page).toBeNull()
    expect(useCommandPaletteStore.getState().previousSearch).toBe('')
  })

  it('close clears open and page', () => {
    useCommandPaletteStore.getState().openPage('theme')
    useCommandPaletteStore.getState().close()
    expect(useCommandPaletteStore.getState().open).toBe(false)
    expect(useCommandPaletteStore.getState().page).toBeNull()
  })

  it('setPage updates nested page without toggling open', () => {
    useCommandPaletteStore.getState().setOpen(true)
    useCommandPaletteStore.getState().setPage('theme')
    expect(useCommandPaletteStore.getState().open).toBe(true)
    expect(useCommandPaletteStore.getState().page).toBe('theme')
    useCommandPaletteStore.getState().setPage(null)
    expect(useCommandPaletteStore.getState().page).toBeNull()
  })
})
