import type { ContextKind, ContextMenuItemMeta } from './types'

const STATIC_CATALOG: ContextMenuItemMeta[] = [
  {
    id: 'message.regenerate',
    labelKey: 'contextMenu.message.regenerate',
    kind: 'message',
    group: 'primary',
  },
  {
    id: 'message.quote',
    labelKey: 'contextMenu.message.quote',
    kind: 'message',
    group: 'edit',
  },
  {
    id: 'message.copy',
    labelKey: 'contextMenu.message.copy',
    kind: 'message',
    group: 'clipboard',
  },
  {
    id: 'message.copyId',
    labelKey: 'contextMenu.message.copyId',
    kind: 'message',
    group: 'debug',
  },
  {
    id: 'session.exportDebugBundle',
    labelKey: 'contextMenu.session.exportDebugBundle',
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
  {
    id: 'diffFile.copyPath',
    labelKey: 'contextMenu.diffFile.copyPath',
    kind: 'diffFile',
    group: 'clipboard',
    icon: 'code',
  },
  {
    id: 'diffFile.copyAbsolutePath',
    labelKey: 'contextMenu.diffFile.copyAbsolutePath',
    kind: 'diffFile',
    group: 'clipboard',
  },
  {
    id: 'diffFile.openInFiles',
    labelKey: 'contextMenu.diffFile.openInFiles',
    kind: 'diffFile',
    group: 'navigation',
    icon: 'code',
  },
  {
    id: 'diffFile.toggleCollapse',
    labelKey: 'contextMenu.diffFile.collapse',
    kind: 'diffFile',
    group: 'edit',
  },
  {
    id: 'diffFile.showFull',
    labelKey: 'contextMenu.diffFile.showFull',
    kind: 'diffFile',
    group: 'edit',
  },
  {
    id: 'diffFile.collapseFull',
    labelKey: 'contextMenu.diffFile.collapseFull',
    kind: 'diffFile',
    group: 'edit',
  },
  {
    id: 'diffHunk.copy',
    labelKey: 'contextMenu.diffHunk.copy',
    kind: 'diffHunk',
    group: 'clipboard',
    icon: 'code',
  },
  {
    id: 'diffHunk.annotate',
    labelKey: 'contextMenu.diffHunk.annotate',
    kind: 'diffHunk',
    group: 'agent',
  },
  {
    id: 'diffHunk.quoteToComposer',
    labelKey: 'contextMenu.diffHunk.quoteToComposer',
    kind: 'diffHunk',
    group: 'agent',
  },
  {
    id: 'commit.copySha',
    labelKey: 'contextMenu.commit.copySha',
    kind: 'commit',
    group: 'clipboard',
    icon: 'git-branch',
  },
  {
    id: 'commit.copyMessage',
    labelKey: 'contextMenu.commit.copyMessage',
    kind: 'commit',
    group: 'clipboard',
  },
  {
    id: 'terminal.restart',
    labelKey: 'contextMenu.terminal.restart',
    kind: 'terminal',
    group: 'primary',
    icon: 'history',
  },
  {
    id: 'terminal.changeFolder',
    labelKey: 'contextMenu.terminal.changeFolder',
    kind: 'terminal',
    group: 'workspace',
  },
  {
    id: 'terminal.copyCwd',
    labelKey: 'contextMenu.terminal.copyCwd',
    kind: 'terminal',
    group: 'clipboard',
  },
  {
    id: 'terminal.openFiles',
    labelKey: 'contextMenu.terminal.openFiles',
    kind: 'terminal',
    group: 'navigation',
    icon: 'code',
  },
  {
    id: 'managedTerminal.rename',
    labelKey: 'contextMenu.managedTerminal.rename',
    kind: 'managedTerminal',
    group: 'edit',
  },
  {
    id: 'managedTerminal.copyTitle',
    labelKey: 'contextMenu.managedTerminal.copyTitle',
    kind: 'managedTerminal',
    group: 'clipboard',
  },
  {
    id: 'managedTerminal.close',
    labelKey: 'contextMenu.managedTerminal.close',
    kind: 'managedTerminal',
    group: 'danger',
    danger: true,
  },
  {
    id: 'managedTerminal.newAgentChat',
    labelKey: 'contextMenu.managedTerminal.newAgentChat',
    kind: 'managedTerminal',
    group: 'primary',
  },
  {
    id: 'managedTerminal.reconnect',
    labelKey: 'contextMenu.managedTerminal.reconnect',
    kind: 'managedTerminal',
    group: 'navigation',
  },
  {
    id: 'managedTerminal.deleteRecord',
    labelKey: 'contextMenu.managedTerminal.deleteRecord',
    kind: 'managedTerminal',
    group: 'danger',
    danger: true,
  },
  {
    id: 'terminalAgentSession.open',
    labelKey: 'contextMenu.terminalAgentSession.open',
    kind: 'terminalAgentSession',
    group: 'primary',
  },
  {
    id: 'terminalAgentSession.rename',
    labelKey: 'contextMenu.terminalAgentSession.rename',
    kind: 'terminalAgentSession',
    group: 'edit',
  },
  {
    id: 'terminalAgentSession.delete',
    labelKey: 'contextMenu.terminalAgentSession.delete',
    kind: 'terminalAgentSession',
    group: 'danger',
    danger: true,
  },
  {
    id: 'sftp.download',
    labelKey: 'contextMenu.sftp.download',
    kind: 'sftpEntry',
    group: 'primary',
  },
  {
    id: 'sftp.upload',
    labelKey: 'contextMenu.sftp.upload',
    kind: 'sftpEntry',
    group: 'primary',
  },
  {
    id: 'sftp.copyPath',
    labelKey: 'contextMenu.sftp.copyPath',
    kind: 'sftpEntry',
    group: 'clipboard',
  },
  {
    id: 'sftp.copyName',
    labelKey: 'contextMenu.sftp.copyName',
    kind: 'sftpEntry',
    group: 'clipboard',
  },
  {
    id: 'sftp.refresh',
    labelKey: 'contextMenu.sftp.refresh',
    kind: 'sftpEntry',
    group: 'workspace',
  },
  {
    id: 'sftp.refreshParent',
    labelKey: 'contextMenu.sftp.refresh',
    kind: 'sftpEntry',
    group: 'workspace',
  },
  {
    id: 'termFs.copyPath',
    labelKey: 'contextMenu.termFs.copyPath',
    kind: 'termFsEntry',
    group: 'clipboard',
  },
  {
    id: 'termFs.copyName',
    labelKey: 'contextMenu.termFs.copyName',
    kind: 'termFsEntry',
    group: 'clipboard',
  },
  {
    id: 'termFs.refresh',
    labelKey: 'contextMenu.termFs.refresh',
    kind: 'termFsEntry',
    group: 'workspace',
  },
  {
    id: 'termFs.refreshParent',
    labelKey: 'contextMenu.termFs.refresh',
    kind: 'termFsEntry',
    group: 'workspace',
  },
  {
    id: 'termFs.openContainingFolder',
    labelKey: 'contextMenu.termFs.openContainingFolder',
    kind: 'termFsEntry',
    group: 'navigation',
  },
  {
    id: 'filePreview.copyPath',
    labelKey: 'contextMenu.filePreview.copyPath',
    kind: 'filePreview',
    group: 'clipboard',
  },
  {
    id: 'filePreview.copyContent',
    labelKey: 'contextMenu.filePreview.copyContent',
    kind: 'filePreview',
    group: 'clipboard',
  },
  {
    id: 'filePreview.openContainingFolder',
    labelKey: 'contextMenu.filePreview.openContainingFolder',
    kind: 'filePreview',
    group: 'navigation',
  },
  {
    id: 'filePreview.refresh',
    labelKey: 'contextMenu.filePreview.refresh',
    kind: 'filePreview',
    group: 'workspace',
  },
  {
    id: 'toolCall.copyInput',
    labelKey: 'contextMenu.toolCall.copyInput',
    kind: 'toolCall',
    group: 'clipboard',
  },
  {
    id: 'toolCall.copyOutput',
    labelKey: 'contextMenu.toolCall.copyOutput',
    kind: 'toolCall',
    group: 'clipboard',
  },
  {
    id: 'toolCall.copyError',
    labelKey: 'contextMenu.toolCall.copyError',
    kind: 'toolCall',
    group: 'clipboard',
  },
  {
    id: 'subAgent.copyId',
    labelKey: 'contextMenu.subAgent.copyId',
    kind: 'subAgent',
    group: 'clipboard',
  },
  {
    id: 'subAgent.copyTask',
    labelKey: 'contextMenu.subAgent.copyTask',
    kind: 'subAgent',
    group: 'clipboard',
  },
  {
    id: 'subAgent.copyOutput',
    labelKey: 'contextMenu.subAgent.copyOutput',
    kind: 'subAgent',
    group: 'clipboard',
  },
  {
    id: 'agentConfig.edit',
    labelKey: 'settings.agents.edit',
    kind: 'agentConfig',
    group: 'edit',
  },
  {
    id: 'agentConfig.delete',
    labelKey: 'settings.agents.delete',
    kind: 'agentConfig',
    group: 'danger',
    danger: true,
  },
  {
    id: 'knowledgeNode.newDoc',
    labelKey: 'knowledge.tree.newDoc',
    kind: 'knowledgeNode',
    group: 'primary',
  },
  {
    id: 'knowledgeNode.newBoard',
    labelKey: 'knowledge.tree.newBoard',
    kind: 'knowledgeNode',
    group: 'primary',
  },
  {
    id: 'knowledgeNode.newFolder',
    labelKey: 'knowledge.tree.newFolder',
    kind: 'knowledgeNode',
    group: 'primary',
  },
  {
    id: 'knowledgeNode.rename',
    labelKey: 'knowledge.tree.rename',
    kind: 'knowledgeNode',
    group: 'edit',
  },
  {
    id: 'knowledgeNode.reveal',
    labelKey: 'knowledge.tree.reveal',
    kind: 'knowledgeNode',
    group: 'navigation',
  },
  {
    id: 'knowledgeNode.delete',
    labelKey: 'knowledge.tree.delete',
    kind: 'knowledgeNode',
    group: 'danger',
    danger: true,
  },
  {
    id: 'knowledgeSpace.rename',
    labelKey: 'knowledge.tree.rename',
    kind: 'knowledgeSpace',
    group: 'edit',
  },
  {
    id: 'knowledgeSpace.delete',
    labelKey: 'knowledge.tree.delete',
    kind: 'knowledgeSpace',
    group: 'danger',
    danger: true,
  },
  {
    id: 'knowledgeTree.newDoc',
    labelKey: 'knowledge.tree.newDoc',
    kind: 'knowledgeTree',
    group: 'primary',
  },
  {
    id: 'knowledgeTree.newBoard',
    labelKey: 'knowledge.tree.newBoard',
    kind: 'knowledgeTree',
    group: 'primary',
  },
  {
    id: 'knowledgeTree.newFolder',
    labelKey: 'knowledge.tree.newFolder',
    kind: 'knowledgeTree',
    group: 'primary',
  },
  {
    id: 'skillConfig.view',
    labelKey: 'settings.skill.view',
    kind: 'skillConfig',
    group: 'primary',
  },
  {
    id: 'skillConfig.delete',
    labelKey: 'settings.skill.delete',
    kind: 'skillConfig',
    group: 'danger',
    danger: true,
  },
  {
    id: 'mcpServer.edit',
    labelKey: 'settings.mcp.edit',
    kind: 'mcpServer',
    group: 'edit',
  },
  {
    id: 'mcpServer.delete',
    labelKey: 'settings.mcp.delete',
    kind: 'mcpServer',
    group: 'danger',
    danger: true,
  },
  {
    id: 'plugin.view',
    labelKey: 'settings.plugins.view',
    kind: 'plugin',
    group: 'primary',
  },
  {
    id: 'plugin.uninstall',
    labelKey: 'settings.plugins.uninstall',
    kind: 'plugin',
    group: 'danger',
    danger: true,
  },
  {
    id: 'terminal.copySelection',
    labelKey: 'contextMenu.terminal.copySelection',
    kind: 'terminal',
    group: 'clipboard',
  },
  {
    id: 'terminal.sendSelectionToChat',
    labelKey: 'contextMenu.terminal.sendSelectionToChat',
    kind: 'terminal',
    group: 'agent',
  },
  {
    id: 'terminal.paste',
    labelKey: 'contextMenu.terminal.paste',
    kind: 'terminal',
    group: 'clipboard',
  },
  {
    id: 'workItem.open',
    labelKey: 'contextMenu.workItem.open',
    kind: 'workItem',
    group: 'primary',
  },
  {
    id: 'workItem.complete',
    labelKey: 'workItems.actions.complete',
    kind: 'workItem',
    group: 'primary',
  },
  {
    id: 'workItem.reopen',
    labelKey: 'workItems.actions.reopen',
    kind: 'workItem',
    group: 'primary',
  },
  {
    id: 'workItem.setInProgress',
    labelKey: 'workItems.status.in_progress',
    kind: 'workItem',
    group: 'edit',
  },
  {
    id: 'workItem.cancel',
    labelKey: 'workItems.actions.cancel',
    kind: 'workItem',
    group: 'edit',
  },
  {
    id: 'workItem.archive',
    labelKey: 'workItems.actions.archive',
    kind: 'workItem',
    group: 'edit',
  },
  {
    id: 'workItem.unarchive',
    labelKey: 'workItems.actions.unarchive',
    kind: 'workItem',
    group: 'edit',
  },
  {
    id: 'workItem.openSession',
    labelKey: 'contextMenu.workItem.openSession',
    kind: 'workItem',
    group: 'navigation',
  },
  {
    id: 'workItem.openKnowledge',
    labelKey: 'contextMenu.workItem.openKnowledge',
    kind: 'workItem',
    group: 'navigation',
  },
  {
    id: 'workItem.openUrl',
    labelKey: 'contextMenu.workItem.openUrl',
    kind: 'workItem',
    group: 'navigation',
  },
  {
    id: 'workItem.copyTitle',
    labelKey: 'contextMenu.workItem.copyTitle',
    kind: 'workItem',
    group: 'clipboard',
  },
  {
    id: 'workItem.delete',
    labelKey: 'workItems.actions.delete',
    kind: 'workItem',
    group: 'danger',
    danger: true,
  },
  {
    id: 'workItemBlank.create',
    labelKey: 'workItems.newItem',
    kind: 'workItemBlank',
    group: 'primary',
  },
  {
    id: 'trashEntry.restore',
    labelKey: 'trash.restore',
    kind: 'trashEntry',
    group: 'primary',
  },
  {
    id: 'trashEntry.copyTitle',
    labelKey: 'contextMenu.trashEntry.copyTitle',
    kind: 'trashEntry',
    group: 'clipboard',
  },
  {
    id: 'trashEntry.hardDelete',
    labelKey: 'trash.deleteForever',
    kind: 'trashEntry',
    group: 'danger',
    danger: true,
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
