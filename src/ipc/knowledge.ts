import { invoke } from '@tauri-apps/api/core'
import type {
  KnowledgeSpace,
  KnowledgeTemplate,
  KnowledgeTreeFile,
  KnowledgeVersionEntry,
  KnowledgeVersionKind,
} from '@/domain/knowledge/types'

export function knowledgeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

export async function knowledgeEnsureRoot(): Promise<void> {
  await invoke('knowledge_ensure_root')
}

export async function knowledgeListSpaces(): Promise<KnowledgeSpace[]> {
  return invoke<KnowledgeSpace[]>('knowledge_list_spaces')
}

export async function knowledgeCreateSpace(name: string, icon?: string): Promise<KnowledgeSpace> {
  return invoke<KnowledgeSpace>('knowledge_create_space', {
    args: { name, icon },
  })
}

export async function knowledgeUpdateSpace(
  id: string,
  patch: { name?: string; icon?: string },
): Promise<KnowledgeSpace> {
  return invoke<KnowledgeSpace>('knowledge_update_space', {
    args: { id, name: patch.name, icon: patch.icon },
  })
}

export async function knowledgeDeleteSpace(id: string): Promise<void> {
  await invoke('knowledge_delete_space', { args: { id } })
}

/** Soft-delete space into product recycle bin. */
export async function knowledgeSoftDeleteSpace(id: string): Promise<void> {
  await invoke('knowledge_soft_delete_space', { args: { id } })
}

/** Soft-delete tree nodes (doc or folder subtree) into recycle bin. */
export async function knowledgeSoftDeleteNodes(
  spaceId: string,
  nodeIds: string[],
): Promise<string[]> {
  return invoke<string[]>('knowledge_soft_delete_nodes', {
    args: { spaceId, nodeIds },
  })
}

export type KnowledgeTrashKind = 'space' | 'doc' | 'folder'

export interface KnowledgeTrashItem {
  id: string
  kind: KnowledgeTrashKind
  entityId: string
  spaceId: string
  title: string
  deletedAt: number
  spaceName?: string
  parentId?: string | null
}

export async function knowledgeListTrash(): Promise<KnowledgeTrashItem[]> {
  return invoke<KnowledgeTrashItem[]>('knowledge_list_trash')
}

export async function knowledgeRestoreTrashEntry(entryId: string): Promise<KnowledgeTrashItem> {
  return invoke<KnowledgeTrashItem>('knowledge_restore_trash_entry', {
    args: { entryId },
  })
}

export async function knowledgeHardDeleteTrashEntry(entryId: string): Promise<void> {
  await invoke('knowledge_hard_delete_trash_entry', { args: { entryId } })
}

export async function knowledgeEmptyTrash(): Promise<number> {
  return invoke<number>('knowledge_empty_trash')
}

export async function knowledgePurgeExpiredTrash(retentionDays?: number): Promise<string[]> {
  return invoke<string[]>('knowledge_purge_expired_trash', {
    args: { retentionDays },
  })
}

export async function knowledgeReconcileTrash(): Promise<number> {
  return invoke<number>('knowledge_reconcile_trash')
}

export async function knowledgeGetTree(spaceId: string): Promise<KnowledgeTreeFile> {
  return invoke<KnowledgeTreeFile>('knowledge_get_tree', { args: { spaceId } })
}

export async function knowledgeSaveTree(spaceId: string, tree: KnowledgeTreeFile): Promise<void> {
  await invoke('knowledge_save_tree', { args: { spaceId, tree } })
}

export async function knowledgeReadDoc(spaceId: string, docId: string): Promise<string> {
  return invoke<string>('knowledge_read_doc', { args: { spaceId, docId } })
}

/**
 * Write doc body. E2E can force failures via `globalThis.__hipKnowledgeWriteFail`
 * (boolean true, or a function that returns true for this write). In the browser
 * this is the same object as `window`.
 */
export async function knowledgeWriteDoc(spaceId: string, docId: string, body: string): Promise<void> {
  const fail = (globalThis as unknown as {
    __hipKnowledgeWriteFail?: boolean | ((spaceId: string, docId: string) => boolean)
  }).__hipKnowledgeWriteFail
  const shouldFail = typeof fail === 'function' ? fail(spaceId, docId) : fail === true
  if (shouldFail) {
    throw new Error('e2e knowledge write fail')
  }
  await invoke('knowledge_write_doc', { args: { spaceId, docId, body } })
}

export async function knowledgeDeleteDocFile(spaceId: string, docId: string): Promise<void> {
  await invoke('knowledge_delete_doc_file', { args: { spaceId, docId } })
}

export async function knowledgeExportDoc(
  spaceId: string,
  docId: string,
  destPath: string,
): Promise<void> {
  await invoke('knowledge_export_doc', { args: { spaceId, docId, destPath } })
}

export async function knowledgeExportText(destPath: string, body: string): Promise<void> {
  await invoke('knowledge_export_text', { args: { destPath, body } })
}

export async function knowledgeExportSpaceZip(spaceId: string, destPath: string): Promise<void> {
  await invoke('knowledge_export_space_zip', { args: { spaceId, destPath } })
}

export async function knowledgeImportFolder(
  sourcePath: string,
): Promise<{ spaceId: string; importedDocs: number }> {
  return invoke('knowledge_import_folder', { args: { sourcePath } })
}

export async function knowledgeRevealDoc(spaceId: string, docId: string): Promise<void> {
  await invoke('knowledge_reveal_doc', { args: { spaceId, docId } })
}

// ── Assets (P1.5) ─────────────────────────────────────────────────────────

export type KnowledgeAssetMeta = {
  relPath: string
  mime: string
  byteLength: number
}

export type KnowledgeAssetData = {
  mime: string
  base64: string
}

/** Path import — disk cap 25MB; returns meta only (no file bytes). */
export async function knowledgeImportAssetFromPath(
  spaceId: string,
  sourcePath: string,
): Promise<KnowledgeAssetMeta> {
  return invoke<KnowledgeAssetMeta>('knowledge_import_asset_from_path', {
    args: { spaceId, sourcePath },
  })
}

/** Paste/bytes import — raw ≤ 1.5MB; returns meta only (no base64 echo). */
export async function knowledgeImportAssetBytes(
  spaceId: string,
  args: { base64: string; fileName: string; mime: string },
): Promise<KnowledgeAssetMeta> {
  return invoke<KnowledgeAssetMeta>('knowledge_import_asset_bytes', {
    args: { spaceId, base64: args.base64, fileName: args.fileName, mime: args.mime },
  })
}

/** Preview data URL path — refuses oversize inline. */
export async function knowledgeReadAssetData(
  spaceId: string,
  relPath: string,
): Promise<KnowledgeAssetData> {
  return invoke<KnowledgeAssetData>('knowledge_read_asset_data', {
    args: { spaceId, relPath },
  })
}

export async function knowledgeAssetAbsPath(
  spaceId: string,
  relPath: string,
): Promise<{ absolutePath: string }> {
  return invoke('knowledge_asset_abs_path', { args: { spaceId, relPath } })
}

/** Reveal docs/… or assets/… under space (safe_join). */
export async function knowledgeRevealPath(spaceId: string, relPath: string): Promise<void> {
  await invoke('knowledge_reveal_path', { args: { spaceId, relPath } })
}

// ── Templates (P1.7) ──────────────────────────────────────────────────────

export async function knowledgeListTemplates(spaceId: string): Promise<KnowledgeTemplate[]> {
  return invoke<KnowledgeTemplate[]>('knowledge_list_templates', { args: { spaceId } })
}

export async function knowledgeSaveTemplate(
  spaceId: string,
  args: { id?: string; name: string; body: string },
): Promise<KnowledgeTemplate> {
  return invoke<KnowledgeTemplate>('knowledge_save_template', {
    args: { spaceId, id: args.id, name: args.name, body: args.body },
  })
}

export async function knowledgeDeleteTemplate(spaceId: string, id: string): Promise<void> {
  await invoke('knowledge_delete_template', { args: { spaceId, id } })
}

// ── Versions (P1.8) ───────────────────────────────────────────────────────

export async function knowledgeSaveVersion(
  spaceId: string,
  docId: string,
  kind: KnowledgeVersionKind,
  dayKey?: string,
): Promise<KnowledgeVersionEntry | null> {
  return invoke<KnowledgeVersionEntry | null>('knowledge_save_version', {
    args: { spaceId, docId, kind, dayKey },
  })
}

export async function knowledgeListVersions(
  spaceId: string,
  docId: string,
): Promise<KnowledgeVersionEntry[]> {
  return invoke<KnowledgeVersionEntry[]>('knowledge_list_versions', {
    args: { spaceId, docId },
  })
}

export async function knowledgeReadVersion(
  spaceId: string,
  docId: string,
  versionId: string,
): Promise<string> {
  return invoke<string>('knowledge_read_version', {
    args: { spaceId, docId, versionId },
  })
}

/** Atomically restores snapshot into the live doc; returns restored body. */
export async function knowledgeRestoreVersion(
  spaceId: string,
  docId: string,
  versionId: string,
): Promise<string> {
  return invoke<string>('knowledge_restore_version', {
    args: { spaceId, docId, versionId },
  })
}

// ── Link index (SQLite under space/.hip/) ─────────────────────────────────

export type KnowledgeLinkOutboundIn = {
  kind: string
  raw: string
  targetTitle: string | null
  targetDocId: string | null
  fragment: string | null
  display: string | null
}

export type KnowledgeLinkDocPayload = {
  docId: string
  title: string
  aliases: string[]
  tags: string[]
  status: string | null
  props: Record<string, unknown>
  contentHash: string
  updatedAt: number
  outbound: KnowledgeLinkOutboundIn[]
}

export type KnowledgeLinkBacklink = {
  fromDocId: string
  fromTitle: string
  raw: string
  kind: string
  fragment: string | null
}

export type KnowledgeLinkOutboundRow = {
  kind: string
  raw: string
  targetTitle: string | null
  targetDocId: string | null
  fragment: string | null
  display: string | null
}

export type KnowledgeLinkBrokenRow = {
  fromDocId: string
  fromTitle: string
  raw: string
  kind: string
}

export async function knowledgeLinkIndexUpsert(
  spaceId: string,
  doc: KnowledgeLinkDocPayload,
): Promise<void> {
  await invoke('knowledge_link_index_upsert', { args: { spaceId, doc } })
}

export async function knowledgeLinkIndexRemoveDoc(
  spaceId: string,
  docId: string,
): Promise<void> {
  await invoke('knowledge_link_index_remove_doc', { args: { spaceId, docId } })
}

export async function knowledgeLinkIndexReplaceAll(
  spaceId: string,
  docs: KnowledgeLinkDocPayload[],
): Promise<void> {
  await invoke('knowledge_link_index_replace_all', { args: { spaceId, docs } })
}

export async function knowledgeLinkIndexBacklinks(
  spaceId: string,
  docId: string,
): Promise<KnowledgeLinkBacklink[]> {
  return invoke<KnowledgeLinkBacklink[]>('knowledge_link_index_backlinks', {
    args: { spaceId, docId },
  })
}

export async function knowledgeLinkIndexOutbound(
  spaceId: string,
  docId: string,
): Promise<KnowledgeLinkOutboundRow[]> {
  return invoke<KnowledgeLinkOutboundRow[]>('knowledge_link_index_outbound', {
    args: { spaceId, docId },
  })
}

export async function knowledgeLinkIndexBroken(
  spaceId: string,
): Promise<KnowledgeLinkBrokenRow[]> {
  return invoke<KnowledgeLinkBrokenRow[]>('knowledge_link_index_broken', {
    args: { spaceId },
  })
}

export async function knowledgeLinkIndexDocCount(spaceId: string): Promise<number> {
  return invoke<number>('knowledge_link_index_doc_count', { args: { spaceId } })
}

export type KnowledgeGraphNode = { id: string; title: string }
export type KnowledgeGraphEdge = { from: string; to: string; kind: string }
export type KnowledgeGraphPayload = {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
}

export async function knowledgeLinkIndexGraph(
  spaceId: string,
): Promise<KnowledgeGraphPayload> {
  return invoke<KnowledgeGraphPayload>('knowledge_link_index_graph', {
    args: { spaceId },
  })
}

/** Raw JSON string or null when file missing. */
export async function knowledgeGetSchema(spaceId: string): Promise<string | null> {
  return invoke<string | null>('knowledge_get_schema', { args: { spaceId } })
}

export async function knowledgeSetSchema(spaceId: string, json: string): Promise<void> {
  await invoke('knowledge_set_schema', { args: { spaceId, json } })
}

export async function knowledgeGetViews(spaceId: string): Promise<string | null> {
  return invoke<string | null>('knowledge_get_views', { args: { spaceId } })
}

export async function knowledgeSetViews(spaceId: string, json: string): Promise<void> {
  await invoke('knowledge_set_views', { args: { spaceId, json } })
}
