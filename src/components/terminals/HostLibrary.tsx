import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, FolderPlus, Loader2, Plus, Server, Terminal } from 'lucide-react'
import { nanoid } from 'nanoid'
import type { HostGroup, TerminalHost } from '@/ipc/terminalHosts'
import { pickDirectory } from '@/ipc/dialog'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { mintGroupId } from '@/lib/hostFormDraft'
import { isDuplicateGroupName } from '@/lib/hostGroupUi'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { HostGroupList } from './HostGroupList'
import { HostFormDialog, type HostFormMode } from './HostFormDialog'
import { useHostLibraryUi } from './hostLibraryUi'

/**
 * Host library — default landing when no managed terminal is focused.
 * CRUD for hosts/groups; Connect opens an SSH managed terminal.
 */
export function HostLibrary() {
  const { t } = useTranslation()
  const groups = useTerminalHostStore((s) => s.groups)
  const hosts = useTerminalHostStore((s) => s.hosts)
  const loaded = useTerminalHostStore((s) => s.loaded)
  const error = useTerminalHostStore((s) => s.error)
  const upsertGroup = useTerminalHostStore((s) => s.upsertGroup)
  const removeGroup = useTerminalHostStore((s) => s.removeGroup)
  const removeHost = useTerminalHostStore((s) => s.removeHost)

  const pendingCreateHost = useHostLibraryUi((s) => s.pendingCreateHost)

  const [formMode, setFormMode] = useState<HostFormMode | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [deletingHost, setDeletingHost] = useState<TerminalHost | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const [groupDialog, setGroupDialog] = useState<
    null | { mode: 'create' } | { mode: 'rename'; group: HostGroup }
  >(null)
  const [groupName, setGroupName] = useState('')
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupError, setGroupError] = useState<string | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<HostGroup | null>(null)

  useEffect(() => {
    if (!useTerminalHostStore.getState().loaded) {
      void useTerminalHostStore.getState().load()
    }
  }, [])

  // Sidebar / external "new connection" — one-shot consume so remount does not re-open.
  useEffect(() => {
    if (!pendingCreateHost) return
    if (!useHostLibraryUi.getState().consumeCreateHostRequest()) return
    setFormMode({ mode: 'create' })
    setFormOpen(true)
  }, [pendingCreateHost])

  const openCreate = useCallback(() => {
    setFormMode({ mode: 'create' })
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((host: TerminalHost) => {
    setFormMode({ mode: 'edit', host })
    setFormOpen(true)
  }, [])

  const closeForm = useCallback(() => {
    setFormOpen(false)
    setFormMode(null)
  }, [])

  const openLocalHome = useCallback(async () => {
    try {
      await useManagedTerminalStore.getState().openLocal()
    } catch (e) {
      console.error('[hip] open local terminal failed:', e)
    }
  }, [])

  const openLocalPick = useCallback(async () => {
    const dir = await pickDirectory()
    if (!dir) return
    try {
      await useManagedTerminalStore.getState().openLocal({ cwd: dir })
    } catch (e) {
      console.error('[hip] open local terminal failed:', e)
    }
  }, [])

  const connectHost = useCallback(async (host: TerminalHost) => {
    setConnectBusy(true)
    setConnectError(null)
    try {
      await useManagedTerminalStore.getState().openSsh(host)
    } catch (e) {
      console.error('[hip] open ssh terminal failed:', e)
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('Too many terminals')) {
        setConnectError(t('terminals.softCap'))
      } else {
        setConnectError(t('terminals.errorConnect'))
      }
    } finally {
      setConnectBusy(false)
    }
  }, [t])

  const confirmDeleteHost = useCallback(async () => {
    if (!deletingHost) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      // K21: force-close any open managed sessions for this host.
      const open = useManagedTerminalStore
        .getState()
        .terminals.filter((mt) => mt.hostId === deletingHost.id)
      for (const mt of open) {
        try {
          await useManagedTerminalStore.getState().close(mt.id)
        } catch {
          /* best-effort */
        }
      }
      await removeHost(deletingHost.id)
      setDeletingHost(null)
    } catch (e) {
      console.error('[hip] delete host failed:', e)
      setDeleteError(t('terminals.errorDelete'))
    } finally {
      setDeleteBusy(false)
    }
  }, [deletingHost, removeHost, t])

  const openCreateGroup = useCallback(() => {
    setGroupName('')
    setGroupError(null)
    setGroupDialog({ mode: 'create' })
  }, [])

  const openRenameGroup = useCallback((group: HostGroup) => {
    setGroupName(group.name)
    setGroupError(null)
    setGroupDialog({ mode: 'rename', group })
  }, [])

  const submitGroup = useCallback(async () => {
    const name = groupName.trim()
    if (!name || !groupDialog) {
      setGroupError(t('terminals.form.groupNameRequired'))
      return
    }
    const excludeId = groupDialog.mode === 'rename' ? groupDialog.group.id : undefined
    if (isDuplicateGroupName(name, groups, excludeId)) {
      setGroupError(t('terminals.form.groupNameDuplicate'))
      return
    }
    setGroupBusy(true)
    setGroupError(null)
    try {
      if (groupDialog.mode === 'create') {
        // `sort` kept for schema compatibility; UI orders by name.
        const sort =
          groups.length === 0 ? 0 : Math.max(...groups.map((g) => g.sort)) + 1
        await upsertGroup({ id: mintGroupId(nanoid), name, sort })
      } else {
        await upsertGroup({ ...groupDialog.group, name })
      }
      setGroupDialog(null)
    } catch (e) {
      console.error('[hip] save group failed:', e)
      setGroupError(t('terminals.form.errorSave'))
    } finally {
      setGroupBusy(false)
    }
  }, [groupName, groupDialog, groups, upsertGroup, t])

  const confirmDeleteGroup = useCallback(async () => {
    if (!deletingGroup) return
    setGroupBusy(true)
    try {
      await removeGroup(deletingGroup.id)
      setDeletingGroup(null)
    } catch (e) {
      console.error('[hip] delete group failed:', e)
    } finally {
      setGroupBusy(false)
    }
  }, [deletingGroup, removeGroup])

  if (!loaded) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 items-center justify-center"
        data-testid="host-library-loading"
      >
        <Loader2 size={18} className="animate-spin text-ink-tertiary" aria-hidden />
      </div>
    )
  }

  const isEmpty = hosts.length === 0 && groups.length === 0

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="host-library"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-semibold tracking-tight text-ink">
            {t('terminals.libraryTitle')}
          </h1>
          <p className="text-meta text-ink-tertiary">{t('terminals.librarySubtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="host-library-new-group"
            onClick={openCreateGroup}
          >
            <FolderPlus size={14} aria-hidden />
            {t('terminals.newGroup')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="host-library-new-local"
            onClick={() => void openLocalHome()}
          >
            <Terminal size={14} aria-hidden />
            {t('terminals.newLocal')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="host-library-new-local-folder"
            onClick={() => void openLocalPick()}
          >
            <FolderOpen size={14} aria-hidden />
            {t('terminals.newLocalFolder')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="host-library-new-remote"
            onClick={openCreate}
          >
            <Plus size={14} aria-hidden />
            {t('terminals.newRemote')}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <p className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-meta text-danger">
            {error}
          </p>
        ) : null}
        {connectError ? (
          <p
            className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-meta text-danger"
            role="alert"
            data-testid="host-library-connect-error"
          >
            {connectError}
          </p>
        ) : null}

        {isEmpty ? (
          <div className="flex flex-col items-center py-8" data-testid="host-library-empty">
            <EmptyState
              icon={Server}
              tier="friendly"
              title={t('terminals.emptyLibrary')}
              description={t('terminals.emptyLibraryHint')}
              className="py-6"
            />
            <div className="-mt-2 flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="host-library-empty-new-remote"
                onClick={openCreate}
              >
                <Plus size={14} aria-hidden />
                {t('terminals.newRemote')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="host-library-empty-new-local"
                onClick={() => void openLocalHome()}
              >
                <Terminal size={14} aria-hidden />
                {t('terminals.newLocal')}
              </Button>
            </div>
          </div>
        ) : (
          <HostGroupList
            groups={groups}
            hosts={hosts}
            onEditHost={openEdit}
            onDeleteHost={setDeletingHost}
            onRenameGroup={openRenameGroup}
            onDeleteGroup={setDeletingGroup}
            onConnectHost={(h) => void connectHost(h)}
            connectBusy={connectBusy}
          />
        )}
      </div>

      <HostFormDialog
        open={formOpen}
        mode={formMode}
        groups={groups}
        onClose={closeForm}
      />

      {deletingHost ? (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o && !deleteBusy) {
              setDeletingHost(null)
              setDeleteError(null)
            }
          }}
          title={t('terminals.deleteHostTitle', { label: deletingHost.label })}
          className="max-w-sm"
          closeDisabled={deleteBusy}
        >
          <div className="p-5" data-testid="host-delete-dialog">
            <p className="text-body text-ink-secondary">{t('terminals.deleteHostBody')}</p>
            {deleteError ? (
              <p className="mt-3 text-meta text-danger" role="alert">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={deleteBusy}
                onClick={() => {
                  setDeletingHost(null)
                  setDeleteError(null)
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                data-testid="host-delete-confirm"
                disabled={deleteBusy}
                onClick={() => void confirmDeleteHost()}
              >
                {deleteBusy ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : null}
                {t('terminals.deleteHost')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {groupDialog ? (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o && !groupBusy) setGroupDialog(null)
          }}
          title={
            groupDialog.mode === 'create'
              ? t('terminals.groupCreateTitle')
              : t('terminals.groupRenameTitle')
          }
          className="max-w-sm"
          closeDisabled={groupBusy}
        >
          <div className="space-y-3 p-5" data-testid="host-group-dialog">
            <div>
              <label className="mb-1.5 block text-meta text-ink-tertiary">
                {t('terminals.form.groupName')}
              </label>
              <Input
                data-testid="host-group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void submitGroup()
                  }
                }}
              />
              {groupError ? (
                <p className="mt-1 text-meta text-danger">{groupError}</p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={groupBusy}
                onClick={() => setGroupDialog(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="host-group-save"
                disabled={groupBusy || !groupName.trim()}
                onClick={() => void submitGroup()}
              >
                {t('terminals.form.save')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deletingGroup ? (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o && !groupBusy) setDeletingGroup(null)
          }}
          title={t('terminals.deleteGroupTitle', { name: deletingGroup.name })}
          className="max-w-sm"
          closeDisabled={groupBusy}
        >
          <div className="p-5" data-testid="host-group-delete-dialog">
            <p className="text-body text-ink-secondary">{t('terminals.deleteGroupBody')}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={groupBusy}
                onClick={() => setDeletingGroup(null)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                data-testid="host-group-delete-confirm"
                disabled={groupBusy}
                onClick={() => void confirmDeleteGroup()}
              >
                {t('terminals.deleteGroup')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
