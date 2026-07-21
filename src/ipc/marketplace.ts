import { invoke } from '@tauri-apps/api/core'
import type { MarketSourceState, MarketplaceSnapshot } from '@hip/protocol'

export async function listMarketplaceSources(): Promise<MarketSourceState[]> {
  const raw = await invoke<string>('list_marketplace_sources')
  return JSON.parse(raw) as MarketSourceState[]
}

export async function setMarketplaceSourceEnabled(
  sourceId: string,
  enabled: boolean,
): Promise<void> {
  await invoke('set_marketplace_source_enabled', { sourceId, enabled })
}

export async function refreshMarketplaceCatalog(sourceId?: string): Promise<void> {
  await invoke('refresh_marketplace_catalog', {
    sourceId: sourceId ?? null,
  })
}

export async function listMarketplacePlugins(): Promise<MarketplaceSnapshot> {
  const raw = await invoke<string>('list_marketplace_plugins')
  return JSON.parse(raw) as MarketplaceSnapshot
}
