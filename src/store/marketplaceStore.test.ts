import { describe, expect, it } from 'vitest'
import type { MarketPluginEntry } from '@hip/protocol'
import { filterEntries } from './marketplaceStore'

function entry(partial: Partial<MarketPluginEntry> & Pick<MarketPluginEntry, 'name'>): MarketPluginEntry {
  return {
    key: `${partial.marketSourceId ?? 'grok-official'}::${partial.name}`,
    marketSourceId: 'grok-official',
    marketKind: 'grok',
    downloadState: 'not_downloaded',
    enabled: false,
    install: null,
    ...partial,
  }
}

describe('filterEntries', () => {
  const catalog = [
    entry({ name: 'Alpha', downloadState: 'not_downloaded' }),
    entry({ name: 'Beta', downloadState: 'downloaded', localPluginId: 'beta', enabled: true }),
    entry({ name: 'Gamma', downloadState: 'not_downloaded' }),
    entry({ name: 'Delta', downloadState: 'downloaded', localPluginId: 'delta', enabled: false }),
    entry({
      name: 'OtherSrc',
      marketSourceId: 'claude-official',
      marketKind: 'claude',
      downloadState: 'downloaded',
      localPluginId: 'other',
    }),
  ]

  it('puts downloaded plugins before not-downloaded within a source tab', () => {
    const names = filterEntries(catalog, 'grok', '').map((e) => e.name)
    expect(names).toEqual(['Beta', 'Delta', 'Alpha', 'Gamma'])
  })

  it('keeps installed-first order after text search', () => {
    const names = filterEntries(catalog, 'grok', 'a').map((e) => e.name)
    // Beta, Delta, Alpha, Gamma all contain 'a' (case-insensitive); OtherSrc filtered by tab
    expect(names).toEqual(['Beta', 'Delta', 'Alpha', 'Gamma'])
  })

  it('returns empty list for custom tab', () => {
    expect(filterEntries(catalog, 'custom', '')).toEqual([])
  })

  it('filters by source id for user-added tabs', () => {
    const withCustom = [
      ...catalog,
      entry({
        name: 'Acme',
        marketSourceId: 'custom-acme',
        marketKind: 'claude',
        downloadState: 'not_downloaded',
      }),
      entry({
        name: 'AcmeInstalled',
        marketSourceId: 'custom-acme',
        marketKind: 'claude',
        downloadState: 'downloaded',
        localPluginId: 'acme-i',
      }),
    ]
    const names = filterEntries(withCustom, 'custom-acme', '').map((e) => e.name)
    expect(names).toEqual(['AcmeInstalled', 'Acme'])
  })
})
