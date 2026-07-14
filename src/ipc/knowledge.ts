import { invoke } from '@tauri-apps/api/core'
import type {
  KnowledgeSpace,
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

export async function knowledgeGetTree(spaceId: string): Promise<KnowledgeTreeFile> {
  return invoke<KnowledgeTreeFile>('knowledge_get_tree', { args: { spaceId } })
}

export async function knowledgeSaveTree(spaceId: string, tree: KnowledgeTreeFile): Promise<void> {
  await invoke('knowledge_save_tree', { args: { spaceId, tree } })
}

export async function knowledgeReadDoc(spaceId: string, docId: string): Promise<string> {
  return invoke<string>('knowledge_read_doc', { args: { spaceId, docId } })
}

export async function knowledgeWriteDoc(spaceId: string, docId: string, body: string): Promise<void> {
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
