import { describe, it, expect } from 'vitest'
import type { HeroModel, ZoneModel } from '../workbenchTypes'
import { resolveHeroAction, resolveHeroAnchor } from './FarmHero'

const idleHero: HeroModel = {
  state: 'idle',
  titleKey: 'workbench.hero.titleIdle',
  subtitleKey: 'workbench.hero.subIdle',
  runningCount: 0,
  attentionCount: 0,
  doneCount: 0,
}

function zone(id: ZoneModel['id'], state: ZoneModel['state']): ZoneModel {
  return {
    id,
    state,
    labelKey: `workbench.zone.${id}` as ZoneModel['labelKey'],
    progress: null,
    primaryMetricKey: 'workbench.metric.sessionsIdle',
    hrefView: 'chat',
    accentClass: '',
  }
}

describe('resolveHeroAnchor', () => {
  it('follows hover plot', () => {
    expect(resolveHeroAnchor('knowledge', [zone('sessions', 'idle')], idleHero)).toEqual({
      col: 0,
      row: 2,
    })
  })

  it('prefers running plot when not hovering', () => {
    const zones = [zone('sessions', 'idle'), zone('tasks', 'running')]
    expect(resolveHeroAnchor(null, zones, { ...idleHero, state: 'running', runningCount: 1 })).toEqual({
      col: 2,
      row: 0,
    })
  })

  it('defaults to courtyard yard cell', () => {
    expect(resolveHeroAnchor(null, [zone('sessions', 'idle')], idleHero)).toEqual({
      col: 2,
      row: 1,
    })
  })
})

describe('resolveHeroAction', () => {
  it('uses zone action when hovering', () => {
    expect(resolveHeroAction('terminals', [zone('terminals', 'idle')], idleHero)).toBe('coffee')
  })

  it('uses hero action when idle field', () => {
    expect(resolveHeroAction(null, [zone('sessions', 'idle')], idleHero)).toBe('wave')
  })
})
