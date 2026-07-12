import type { ContextKind, ContextMenuItemMeta } from './types'

/**
 * Authoritative hand-maintained static meta for prefs / Settings UI.
 * Surface PRs (message, tabs, file tree, …) append entries here.
 * Never cleared by tests — only `extraMeta` is mutable for register/clear.
 */
const STATIC_CATALOG: ContextMenuItemMeta[] = [
  {
    id: 'message.copy',
    labelKey: 'contextMenu.message.copy',
    kind: 'message',
    group: 'clipboard',
  },
  {
    id: 'message.quote',
    labelKey: 'contextMenu.message.quote',
    kind: 'message',
    group: 'edit',
  },
  {
    id: 'message.copyId',
    labelKey: 'contextMenu.message.copyId',
    kind: 'message',
    group: 'debug',
  },
  {
    id: 'message.regenerate',
    labelKey: 'contextMenu.message.regenerate',
    kind: 'message',
    group: 'primary',
  },
  {
    id: 'session.copyDebugBundle',
    labelKey: 'contextMenu.session.copyDebugBundle',
    kind: 'message',
    group: 'debug',
  },
  {
    id: 'codeBlock.copy',
    labelKey: 'contextMenu.codeBlock.copy',
    kind: 'codeBlock',
    group: 'clipboard',
  },
  {
    id: 'sessionTab.rename',
    labelKey: 'contextMenu.sessionTab.rename',
    kind: 'sessionTab',
    group: 'edit',
  },
  {
    id: 'sessionTab.copyId',
    labelKey: 'contextMenu.sessionTab.copyId',
    kind: 'sessionTab',
    group: 'clipboard',
  },
  {
    id: 'sessionTab.revealInHistory',
    labelKey: 'contextMenu.sessionTab.revealInHistory',
    kind: 'sessionTab',
    group: 'navigation',
    icon: 'history',
  },
  {
    id: 'sessionTab.close',
    labelKey: 'tabs.closeTab',
    kind: 'sessionTab',
    group: 'session',
  },
  {
    id: 'sessionTab.deleteOthers',
    labelKey: 'contextMenu.sessionTab.deleteOthers',
    kind: 'sessionTab',
    group: 'danger',
    danger: true,
  },
  {
    id: 'sessionTab.deleteToRight',
    labelKey: 'contextMenu.sessionTab.deleteToRight',
    kind: 'sessionTab',
    group: 'danger',
    danger: true,
  },
  {
    id: 'sessionTab.deleteAllOpen',
    labelKey: 'contextMenu.sessionTab.deleteAllOpen',
    kind: 'sessionTab',
    group: 'danger',
    danger: true,
  },
  {
    id: 'sessionHistory.open',
    labelKey: 'contextMenu.sessionHistory.open',
    kind: 'sessionHistory',
    group: 'primary',
  },
  {
    id: 'sessionHistory.rename',
    labelKey: 'contextMenu.sessionHistory.rename',
    kind: 'sessionHistory',
    group: 'edit',
  },
  {
    id: 'sessionHistory.delete',
    labelKey: 'history.deleteSession',
    kind: 'sessionHistory',
    group: 'danger',
    danger: true,
  },
  {
    id: 'file.open',
    labelKey: 'contextMenu.file.open',
    kind: 'fileEntry',
    group: 'primary',
  },
  {
    id: 'file.copyPath',
    labelKey: 'contextMenu.file.copyPath',
    kind: 'fileEntry',
    group: 'clipboard',
  },
  {
    id: 'file.copyRelativePath',
    labelKey: 'contextMenu.file.copyRelativePath',
    kind: 'fileEntry',
    group: 'clipboard',
  },
  {
    id: 'file.copyName',
    labelKey: 'contextMenu.file.copyName',
    kind: 'fileEntry',
    group: 'clipboard',
  },
  {
    id: 'file.openContainingFolder',
    labelKey: 'contextMenu.file.openContainingFolder',
    kind: 'fileEntry',
    group: 'navigation',
  },
  {
    id: 'file.refresh',
    labelKey: 'contextMenu.file.refresh',
    kind: 'fileEntry',
    group: 'workspace',
  },
]

/** Test / in-app extras only. Cleared by clearCatalogMeta. */
const extraMeta: ContextMenuItemMeta[] = []

function staticIds(): Set<string> {
  return new Set(STATIC_CATALOG.map((m) => m.id))
}

/** Register extra meta (tests or dynamic modules). Dedupes by id (static wins). Returns unregister. */
export function registerCatalogMeta(items: ContextMenuItemMeta[]): () => void {
  const known = new Set<string>([...staticIds(), ...extraMeta.map((m) => m.id)])
  const added: ContextMenuItemMeta[] = []
  for (const item of items) {
    if (!item.id || known.has(item.id)) continue
    known.add(item.id)
    extraMeta.push(item)
    added.push(item)
  }
  return () => {
    for (const item of added) {
      const i = extraMeta.findIndex((c) => c.id === item.id)
      if (i >= 0) extraMeta.splice(i, 1)
    }
  }
}

/** Test helper: clear extra catalog meta only. Static catalog is never wiped. */
export function clearCatalogMeta(): void {
  extraMeta.length = 0
}

/** List catalog entries (static + extras), optionally filtered by kind. Static wins on id collision. */
export function listCatalogItems(kind?: ContextKind): ContextMenuItemMeta[] {
  const seen = staticIds()
  const all = [
    ...STATIC_CATALOG,
    ...extraMeta.filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    }),
  ]
  if (kind === undefined) return all.slice()
  return all.filter((m) => m.kind === kind)
}
