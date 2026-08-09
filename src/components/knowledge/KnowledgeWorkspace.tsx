import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Download,
  FilePlus,
  History,
  MoreHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  registerBeforeOpenDocFlush,
  useKnowledgeStore,
} from '@/store/knowledgeStore'
import { resolveParentForNew } from '@/domain/knowledge/parentForNew'
import { isKnowledgeLiveEnabled } from '@/domain/knowledge/editorMode'
import { KNOWLEDGE_LARGE_DOC_CHARS } from '@/domain/knowledge/limits'
import { insertTextAtCursor } from '@/domain/knowledge/mdEdit'
import { importAssetFromPath } from '@/domain/knowledge/importAsset'
import type { KnowledgeNode, KnowledgeVersionEntry } from '@/domain/knowledge/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { HipLogo } from '@/components/login/HipLogo'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'
import { pickAttachmentFiles, pickSavePath } from '@/ipc/dialog'
import {
  knowledgeErrorMessage,
  knowledgeExportDoc,
  knowledgeExportText,
  knowledgeReadVersion,
} from '@/ipc/knowledge'
import { buildDocHtmlDocument } from '@/domain/knowledge/htmlExport'
import { diffLines } from '@/domain/knowledge/textDiff'
import {
  revealHeadingInRoot,
  revealInCodeMirror,
  findRevealElementInRoot,
  revealBlockInRoot,
  revealLineInCodeMirror,
} from '@/domain/knowledge/searchReveal'
import { extractDocOutline } from '@/domain/knowledge/mdPreview'
import {
  dismissCompatBanner,
  isCompatDismissed,
} from '@/domain/knowledge/editorMode'
import { DocManagerBrowse } from './DocManagerBrowse'
import { DocEditor, type DocEditorHandle } from './DocEditor'
import type { DocLiveEditorHandle } from './DocBlockNoteEditor'
import { KnowledgeDocCanvas } from './KnowledgeDocCanvas'
import { WikiCreateModal } from './WikiCreateModal'
import { KnowledgeGraphModal } from './KnowledgeGraphModal'
import { PageHeader } from './page/PageHeader'
import { VersionTimeline } from './version/VersionTimeline'
import { VersionDiffView } from './version/VersionDiffView'

/** Lazy so Source-only sessions pay 0 for BlockNote chunk. */
const DocLiveEditor = lazy(() =>
  import('./DocBlockNoteEditor').then((m) => ({ default: m.DocBlockNoteEditor })),
)
import { TemplatePickerModal } from './TemplatePickerModal'

export function KnowledgeWorkspace() {
  const { t } = useTranslation()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const nodes = useKnowledgeStore((s) => s.nodes)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const treeFocusId = useKnowledgeStore((s) => s.treeFocusId)
  const docBody = useKnowledgeStore((s) => s.docBody)
  // Intentionally do NOT subscribe to draftBody here — Live typing would re-render
  // the whole workspace (tree, chrome, toolbars). Editors keep local state; store
  // draft is read via getState() on mount / export / mode switch.
  const editorMode = useKnowledgeStore((s) => s.editorMode)
  const busy = useKnowledgeStore((s) => s.busy)
  const saveState = useKnowledgeStore((s) => s.saveState)
  const requestCreateDoc = useKnowledgeStore((s) => s.requestCreateDoc)
  const renameNode = useKnowledgeStore((s) => s.renameNode)
  const rewriteWikiLinksAfterRename = useKnowledgeStore((s) => s.rewriteWikiLinksAfterRename)
  const deleteNode = useKnowledgeStore((s) => s.deleteNode)
  const setEditorMode = useKnowledgeStore((s) => s.setEditorMode)
  const setDraftBody = useKnowledgeStore((s) => s.setDraftBody)
  const flushSave = useKnowledgeStore((s) => s.flushSave)
  const openDocStore = useKnowledgeStore((s) => s.openDoc)
  const saveDocAsTemplate = useKnowledgeStore((s) => s.saveDocAsTemplate)
  const saveVersionManual = useKnowledgeStore((s) => s.saveVersionManual)
  const listVersions = useKnowledgeStore((s) => s.listVersions)
  const restoreVersion = useKnowledgeStore((s) => s.restoreVersion)

  const space = spaces.find((s) => s.id === activeSpaceId)
  const activeNode = nodes.find((n) => n.id === activeDocId)
  const editorRef = useRef<DocEditorHandle>(null)
  /** Live host handle for attach/paste (PR-2); wired now for insertMarkdown. */
  const liveEditorRef = useRef<DocLiveEditorHandle>(null)
  // Best-effort scroll-to-match after opening a search hit / outbound fragment
  // (`pendingReveal`). Boards are title-only in search — never run reveal (Issue 18).
  // Subscribe so same-doc fragment clicks (openDoc early-return) still re-run reveal.
  const pendingReveal = useKnowledgeStore((s) => s.pendingReveal)
  useEffect(() => {
    if (!activeDocId || !activeSpaceId) return
    const pending = pendingReveal
    if (!pending?.query) return
    // Only reveal when the pending target is still the active leaf.
    if (pending.spaceId !== activeSpaceId || pending.docId !== activeDocId) return

    const leaf = useKnowledgeStore.getState().nodes.find((n) => n.id === activeDocId)
    if (leaf?.kind === 'board') {
      useKnowledgeStore.getState().clearPendingReveal()
      return
    }

    let cancelled = false
    let attempts = 0
    // Large CM docs can take >350ms to mount; allow ~2s of retries.
    const maxAttempts = 24
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const schedule = (ms: number) => {
      timeoutId = setTimeout(tryReveal, ms)
    }

    const tryReveal = () => {
      if (cancelled) return
      const still = useKnowledgeStore.getState().pendingReveal
      if (!still?.query) return
      if (still.spaceId !== activeSpaceId || still.docId !== activeDocId) {
        useKnowledgeStore.getState().clearPendingReveal()
        return
      }

      // Live: ProseMirror host; Source fallback: CodeMirror.
      if (editorMode === 'source') {
        const view = editorRef.current?.getView()
        if (view) {
          revealInCodeMirror(view, still.query)
          useKnowledgeStore.getState().clearPendingReveal()
          return
        }
      } else {
        const liveRoot =
          document.querySelector('[data-testid="knowledge-doc-live-editor"]') ??
          document.querySelector('.knowledge-blocknote-editor')
        if (liveRoot instanceof HTMLElement) {
          // V2-E1 块引用：优先块 id（data-id），其次标题/文本匹配。
          const el = still.fragment
            ? revealBlockInRoot(liveRoot, still.fragment, still.query)
            : findRevealElementInRoot(liveRoot, still.query)
          if (el) {
            // Flash the matched block ~1.2s (prototype `.flash` behavior).
            const target = el.closest('.bn-block-outer') ?? el
            target.classList.add('kb-reveal-flash')
            setTimeout(() => target.classList.remove('kb-reveal-flash'), 1200)
          }
          useKnowledgeStore.getState().clearPendingReveal()
          return
        }
        // Live still mounting — also try CM if source briefly visible.
        const view = editorRef.current?.getView()
        if (view) {
          revealInCodeMirror(view, still.query)
          useKnowledgeStore.getState().clearPendingReveal()
          return
        }
      }

      attempts += 1
      if (attempts < maxAttempts) {
        schedule(80)
      } else {
        // Give up without blocking later navigations.
        useKnowledgeStore.getState().clearPendingReveal()
      }
    }

    schedule(30)
    return () => {
      cancelled = true
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [activeDocId, activeSpaceId, editorMode, docBody, nodes, pendingReveal])

  // Outline (AppLayout right rail) → scroll Live / Source (docs only).
  const pendingOutlineJump = useKnowledgeStore((s) => s.pendingOutlineJump)
  useEffect(() => {
    if (!pendingOutlineJump || !activeDocId) return
    const clear = () => useKnowledgeStore.getState().clearPendingOutlineJump()
    const leaf = useKnowledgeStore.getState().nodes.find((n) => n.id === activeDocId)
    if (leaf?.kind === 'board') {
      clear()
      return
    }
    const item = pendingOutlineJump

    if (editorMode === 'source') {
      const view = editorRef.current?.getView()
      if (view) {
        revealLineInCodeMirror(view, item.line)
        clear()
      }
      // If CM not mounted yet, leave pending — effect re-runs when mode/body settles.
      return
    }
    // Live (BlockNote): prefer block id via scrollToHeading; fallback DOM text match.
    const body = useKnowledgeStore.getState().draftBody || useKnowledgeStore.getState().docBody
    let occurrence = 0
    for (const it of extractDocOutline(body)) {
      if (it.line === item.line) break
      if (it.text === item.text) occurrence += 1
    }
    if (liveEditorRef.current?.scrollToHeading?.(item.text, occurrence)) {
      clear()
      return
    }
    const liveRoot =
      document.querySelector('[data-testid="knowledge-doc-live-editor"]') ??
      document.querySelector('.knowledge-blocknote-editor')
    if (!(liveRoot instanceof HTMLElement)) return
    revealHeadingInRoot(liveRoot, item.text, occurrence)
    clear()
  }, [pendingOutlineJump, activeDocId, editorMode, nodes])

  const [nodeEdit, setNodeEdit] = useState<KnowledgeNode | null>(null)
  const [nodeTitle, setNodeTitle] = useState('')
  const [renameUpdateLinks, setRenameUpdateLinks] = useState(false)
  const [nodeDelete, setNodeDelete] = useState<KnowledgeNode | null>(null)
  const [versionDiff, setVersionDiff] = useState<{
    versionId: string
    lines: ReturnType<typeof diffLines>
  } | null>(null)
  const [versionSelectedId, setVersionSelectedId] = useState<string | null>(null)
  /** Broken wiki link → confirm create (K20). Never silent. */
  const [wikiCreateTitle, setWikiCreateTitle] = useState<string | null>(null)
  const [graphOpen, setGraphOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<KnowledgeVersionEntry[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<KnowledgeVersionEntry | null>(null)

  const openVersionHistory = async () => {
    if (!activeDocId) return
    setVersionsOpen(true)
    setVersionsLoading(true)
    try {
      const list = await listVersions(activeDocId)
      setVersions(list)
    } finally {
      setVersionsLoading(false)
    }
  }

  const onSaveVersion = async () => {
    const entry = await saveVersionManual()
    if (entry && versionsOpen) {
      const list = await listVersions()
      setVersions(list)
    }
  }

  const onConfirmRestore = async () => {
    if (!restoreTarget) return
    const ok = await restoreVersion(restoreTarget.id)
    if (ok) {
      setRestoreTarget(null)
      setVersionsOpen(false)
    }
  }

  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  // Toolbar create: focused folder / sibling of focused|active doc / root.
  // Wiki create-on-confirm uses the same parent rule.
  const parentForNew = resolveParentForNew({ treeFocusId, activeDocId, nodes })
  const newDoc = (parentId: string | null) => {
    void requestCreateDoc(parentId, t('knowledge.doc.untitled'))
  }
  // Boards / collection views removed — docs + folders only.
  const isBoard = activeNode?.kind === 'board'

  // Single-canvas Live (Notion/Feishu). Source only as silent fallback:
  // flag off, large doc, parse fail, or explicit source. Never mount DocReader
  // as a writing mode; legacy `preview` normalizes to live for canvas selection.
  // Board leaves never mount Live / Source CM.
  const liveEnabled = isKnowledgeLiveEnabled()
  /**
   * Live parse-fail suppress: only blocks the *current* Live attempt token.
   * A later openDoc / setEditorMode('live') bumps the token so e2e and users
   * can retry Live instead of being stuck on Source for the session.
   */
  const liveAttemptTokenRef = useRef(0)
  const [liveBlock, setLiveBlock] = useState<{ docId: string; token: number } | null>(
    null,
  )
  // Residual in-memory `preview` → `live` without reseed (preview is no longer read-only).
  useEffect(() => {
    if (editorMode !== 'preview') return
    useKnowledgeStore.setState({ editorMode: 'live' })
  }, [editorMode])
  // Entering Live (or switching docs) opens a new attempt — prior parse-fail no longer applies.
  useEffect(() => {
    if (editorMode !== 'live' || !activeDocId || isBoard) return
    liveAttemptTokenRef.current += 1
  }, [editorMode, activeDocId, isBoard])
  const draftLen = useKnowledgeStore.getState().draftBody.length
  const bodyLen = Math.max(docBody.length, draftLen)
  const liveBlocked =
    liveBlock != null &&
    liveBlock.docId === activeDocId &&
    liveBlock.token === liveAttemptTokenRef.current
  const liveSuppressed =
    liveBlocked || bodyLen > KNOWLEDGE_LARGE_DOC_CHARS
  const canvasMode = editorMode === 'preview' ? 'live' : editorMode
  const showLiveEditor =
    !isBoard && canvasMode === 'live' && liveEnabled && !liveSuppressed
  const showSourceEditor = !isBoard && !showLiveEditor
  /** Body for editor mount (mode/doc switch); not a per-keystroke subscription. */
  const mountMarkdown = useKnowledgeStore.getState().draftBody || docBody

  const copyPageLink = async () => {
    if (!activeSpaceId || !activeDocId) return
    const link = `hip://knowledge/${activeSpaceId}/${activeDocId}`
    try {
      await navigator.clipboard.writeText(link)
      toast.success(t('knowledge.doc.linkCopied'))
    } catch {
      toast.error(t('knowledge.doc.linkCopyFailed'))
    }
  }

  const createSubdoc = () => {
    if (!activeDocId) return
    const parentId =
      activeNode?.kind === 'folder' ? activeDocId : activeNode?.parentId ?? null
    void requestCreateDoc(parentId, t('knowledge.doc.untitled'))
  }

  const onLiveParseError = () => {
    // V2-E0: 内部兜底（无 toast——非侵入提示由兼容视图 banner 负责）。
    if (activeDocId) {
      setLiveBlock({ docId: activeDocId, token: liveAttemptTokenRef.current })
    }
    void setEditorMode('source')
  }

  const sanitizeExportName = (title: string, fallback: string) =>
    title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || fallback

  const exportActiveDoc = async () => {
    if (!activeSpaceId || !activeDocId) return
    await flushSave()
    const title = activeNode?.title ?? 'document'
    const safe = sanitizeExportName(title, 'document')
    const dest = await pickSavePath({
      defaultPath: `${safe}.md`,
      title: t('knowledge.export.doc'),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'HTML', extensions: ['html'] },
      ],
    })
    if (!dest) return
    try {
      if (dest.toLowerCase().endsWith('.html') || dest.toLowerCase().endsWith('.htm')) {
        const raw =
          useKnowledgeStore.getState().draftBody ||
          useKnowledgeStore.getState().docBody
        const html = buildDocHtmlDocument({
          title,
          rawMd: raw,
          spaceName: space?.name,
        })
        await knowledgeExportText(dest, html)
        toast.success(t('knowledge.export.htmlDone'))
      } else {
        await knowledgeExportDoc(activeSpaceId, activeDocId, dest)
        toast.success(t('knowledge.export.docDone'))
      }
    } catch (e) {
      toast.error(knowledgeErrorMessage(e))
    }
  }


  const openVersionDiff = async (versionId: string) => {
    if (!activeSpaceId || !activeDocId) return
    try {
      await flushSave()
      const oldBody = await knowledgeReadVersion(activeSpaceId, activeDocId, versionId)
      const st = useKnowledgeStore.getState()
      const cur = st.draftBody || st.docBody
      const lines = diffLines(oldBody, cur)
      setVersionDiff({ versionId, lines })
    } catch (e) {
      toast.error(knowledgeErrorMessage(e))
    }
  }

  const confirmRenameNode = async () => {
    if (!nodeEdit || !nodeTitle.trim()) return
    const oldTitle = nodeEdit.title
    const next = nodeTitle.trim()
    const updateLinks = renameUpdateLinks && nodeEdit.kind === 'doc'
    setNodeEdit(null)
    setRenameUpdateLinks(false)
    await renameNode(nodeEdit.id, next)
    if (updateLinks && oldTitle !== next) {
      const n = await rewriteWikiLinksAfterRename(oldTitle, next)
      if (n > 0) toast.success(t('knowledge.tree.renameLinksDone', { count: n }))
    }
  }

  const toastAssetError = (
    reason: 'too_large_paste' | 'too_large_disk' | 'unsupported' | 'error',
  ) => {
    if (reason === 'too_large_paste') {
      toast.error(t('knowledge.asset.tooLargePaste'))
    } else if (reason === 'too_large_disk') {
      toast.error(t('knowledge.asset.tooLargeDisk'))
    } else if (reason === 'unsupported') {
      toast.error(t('knowledge.asset.unsupported'))
    } else {
      toast.error(t('knowledge.asset.importFailed'))
    }
  }

  const attachFiles = async () => {
    if (!activeSpaceId || !activeDocId) return
    const paths = await pickAttachmentFiles()
    if (!paths?.length) return

    // Re-read mode after OS dialog (Live↔Source may flip while the picker is open).
    const st = useKnowledgeStore.getState()
    const spaceId = st.activeSpaceId
    const docId = st.activeDocId
    if (!spaceId || !docId) return
    const canvasMode = st.editorMode === 'preview' ? 'live' : st.editorMode
    const bodyLenNow = Math.max(st.docBody.length, st.draftBody.length)
    const liveBlockedNow =
      liveBlock != null &&
      liveBlock.docId === docId &&
      liveBlock.token === liveAttemptTokenRef.current
    const useLive =
      canvasMode === 'live' && liveEnabled && !liveBlockedNow &&
      bodyLenNow <= KNOWLEDGE_LARGE_DOC_CHARS

    // Live: structured insert via Milkdown (never multi-line tr.insertText).
    if (useLive) {
      for (const sourcePath of paths) {
        const result = await importAssetFromPath(spaceId, sourcePath)
        if (!result.ok) {
          toastAssetError(result.reason)
          continue
        }
        const ok = liveEditorRef.current?.insertMarkdown(result.markdown)
        if (!ok) toastAssetError('error')
      }
      return
    }

    // Source: CodeMirror string insert at caret.
    const view = editorRef.current?.getView()
    if (!view) return
    for (const sourcePath of paths) {
      const result = await importAssetFromPath(spaceId, sourcePath)
      if (!result.ok) {
        toastAssetError(result.reason)
        continue
      }
      const pos = view.state.selection.main.from
      const before = pos > 0 ? view.state.sliceDoc(pos - 1, pos) : '\n'
      let snippet = result.markdown
      if (before !== '\n') snippet = `\n${snippet}`
      snippet = `${snippet}\n`
      if (insertTextAtCursor(view, snippet)) {
        setDraftBody(view.state.doc.toString(), {
          docId: useKnowledgeStore.getState().activeDocId ?? undefined,
        })
      }
    }
  }

  // Flush Live/Source draft before openDoc / leaf switch.
  useEffect(() => {
    registerBeforeOpenDocFlush(() => {
      const st = useKnowledgeStore.getState()
      const currentId = st.activeDocId
      if (!currentId) return
      const node = st.nodes.find((n) => n.id === currentId)
      if (node?.kind === 'board') return
      liveEditorRef.current?.flushDraft()
      const view = editorRef.current?.getView()
      if (view) {
        st.setDraftBody(view.state.doc.toString(), {
          docId: currentId,
          persist: 'none',
        })
      }
    })
    return () => {
      registerBeforeOpenDocFlush(null)
    }
  }, [])

  const openDoc = openDocStore

  /* V2-E0: 无源码模式切换 UI（live 唯一编辑表面；source 仅内部兜底）。
     modal={false}: modal menu + version-history / save-as-template Modal both lock
     body pointer-events; stacking leaves the app unclickable after close. */
  const docMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          aria-label={t('knowledge.space.menu')}
          data-testid="knowledge-doc-menu"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid="knowledge-save-version"
          onClick={() => void onSaveVersion()}
        >
          <History size={14} />
          {t('knowledge.versions.menuSave')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="knowledge-version-history"
          onClick={() => void openVersionHistory()}
        >
          <History size={14} />
          {t('knowledge.versions.menuHistory')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="knowledge-export-doc"
          onClick={() => void exportActiveDoc()}
        >
          <Download size={14} />
          {t('knowledge.export.doc')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="knowledge-save-as-template"
          onClick={() => {
            setTemplateName(activeNode?.title ?? t('knowledge.doc.untitled'))
            setSaveTemplateOpen(true)
          }}
        >
          <FilePlus size={14} />
          {t('knowledge.template.saveAs')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  // T10 保存状态静默化：saving 持续 >800ms 才显示，error 必须显示；saved 静默。
  const [savingShown, setSavingShown] = useState(false)
  useEffect(() => {
    if (saveState === 'saving') {
      const id = window.setTimeout(() => setSavingShown(true), 800)
      return () => window.clearTimeout(id)
    }
    setSavingShown(false)
  }, [saveState])

  return (
    <div className="flex min-h-0 flex-1" data-testid="knowledge-workspace">
      <main className="flex min-w-0 flex-1 flex-col bg-surface-content">
        {!activeDocId ? (
          <DocManagerBrowse />
        ) : isBoard ? (
          <div
            className="flex min-h-0 flex-1 items-center justify-center px-8 py-6"
            data-testid="knowledge-board-removed"
          >
            <EmptyState
              tier="friendly"
              title={t('knowledge.workspace.noDocTitle')}
              description={t('knowledge.workspace.noDocHint')}
              className="w-full max-w-md border-0 py-16"
              action={{
                label: t('knowledge.tree.newDoc'),
                onClick: () => newDoc(null),
              }}
            >
              <HipLogo size={32} decorative />
            </EmptyState>
          </div>
        ) : showLiveEditor ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <KnowledgeDocCanvas
              className="min-h-0 flex-1"
              paperClassName="overflow-hidden"
            >
              <PageHeader
                docId={activeDocId}
                title={activeNode?.title ?? t('knowledge.doc.untitled')}
                onTitleCommit={(title) => void renameNode(activeDocId, title)}
                onTitleEnter={() => {
                  liveEditorRef.current?.focus({ at: 'start' })
                }}
                menu={docMenu}
              />
              <Suspense
                fallback={
                  <div
                    className="flex min-h-0 flex-1 flex-col gap-3 pt-2"
                    data-testid="knowledge-doc-live-loading"
                    aria-busy="true"
                    aria-label={t('knowledge.doc.liveLoading')}
                  >
                    <Skeleton className="h-4 w-2/5 rounded" />
                    <Skeleton className="h-4 w-full rounded" />
                    <Skeleton className="h-4 w-11/12 rounded" />
                    <Skeleton className="h-4 w-4/5 rounded" />
                    <Skeleton className="mt-2 h-4 w-3/5 rounded" />
                    <Skeleton className="h-4 w-full rounded" />
                    <Skeleton className="h-4 w-2/3 rounded" />
                  </div>
                }
              >
                <DocLiveEditor
                  ref={liveEditorRef}
                  key={`${activeDocId}-live`}
                  docId={activeDocId}
                  initialMarkdown={mountMarkdown}
                  spaceId={activeSpaceId}
                  onDraftChange={(v, meta) =>
                    setDraftBody(v, { docId: meta.docId })
                  }
                  onBlur={() => void flushSave()}
                  onSave={() => void flushSave()}
                  onParseError={onLiveParseError}
                  onAssetImportError={toastAssetError}
                  onRequestAttach={() => void attachFiles()}
                  placeholder={t('knowledge.doc.placeholderSlash')}
                  wikiNodes={nodes}
                  onWikiNavigate={({ title, nodeId, broken, fragment }) => {
                    if (nodeId) {
                      if (fragment && activeSpaceId) {
                        // 块引用：先登记 reveal 目标（块 id → 标题/文本回退），再打开文档。
                        useKnowledgeStore.getState().setPendingReveal({
                          query: fragment,
                          spaceId: activeSpaceId,
                          docId: nodeId,
                          fragment,
                        })
                      }
                      void openDoc(nodeId)
                      return
                    }
                    if (broken || !nodeId) {
                      setWikiCreateTitle(title)
                    }
                  }}
                  onCreateSubdoc={createSubdoc}
                  onCopyPageLink={() => void copyPageLink()}
                />
              </Suspense>
            </KnowledgeDocCanvas>
          </div>
        ) : showSourceEditor ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <KnowledgeDocCanvas
              className="min-h-0 flex-1"
              paperClassName="overflow-hidden"
            >
              <PageHeader
                docId={activeDocId}
                title={activeNode?.title ?? t('knowledge.doc.untitled')}
                onTitleCommit={(title) => void renameNode(activeDocId, title)}
                onTitleEnter={() => {
                  editorRef.current?.focus()
                }}
                menu={docMenu}
              />
              {liveSuppressed && activeDocId && !isCompatDismissed(activeDocId) ? (
                <div
                  className="knowledge-doc-inline-pad mt-2"
                  data-testid="knowledge-compat-banner-wrap"
                >
                  <div
                    className="knowledge-doc-measure flex items-center gap-2 rounded-md border border-border bg-surface-muted/80 px-3 py-2 text-meta text-ink-secondary"
                    data-testid="knowledge-compat-banner"
                    role="status"
                  >
                    <span className="min-w-0 flex-1">
                      {t('knowledge.doc.compatView')}
                    </span>
                    <button
                      type="button"
                      data-no-drag
                      data-testid="knowledge-compat-banner-close"
                      onClick={() => {
                        if (!activeDocId) return
                        dismissCompatBanner(activeDocId)
                        // 关闭 = 免打扰 24h + 重试 live（大文档会静默回到兼容视图）。
                        void setEditorMode('live')
                      }}
                      className="shrink-0 rounded-sm px-1.5 py-0.5 text-caption font-medium text-accent-strong transition-colors hover:bg-state-hover"
                    >
                      {t('knowledge.doc.compatViewClose')}
                    </button>
                  </div>
                </div>
              ) : null}
              <DocEditor
                ref={editorRef}
                key={`${activeDocId}-source`}
                docId={activeDocId}
                initialValue={mountMarkdown}
                spaceId={activeSpaceId}
                onDraftChange={(v) => setDraftBody(v, { docId: activeDocId })}
                onBlur={() => void flushSave()}
                onSave={() => void flushSave()}
                onAssetImportError={toastAssetError}
                onRequestAttach={() => void attachFiles()}
                placeholder={t('knowledge.doc.placeholder')}
                wikiNodes={nodes}
              />
            </KnowledgeDocCanvas>
          </div>
        ) : null}
        {activeDocId &&
        !isBoard &&
        (saveState === 'error' || (saveState === 'saving' && savingShown)) ? (
          /* T10: 保存状态底部状态栏——saved 静默，仅 saving>800ms / error 出现。 */
          <div
            className="flex h-6 shrink-0 items-center gap-1.5 border-t border-border px-4 text-meta"
            data-testid="knowledge-save-status"
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                saveState === 'error' ? 'bg-danger' : 'bg-warning animate-pulse',
              )}
              aria-hidden
            />
            {saveState === 'error' ? (
              <span className="text-danger">{t('knowledge.doc.saveFailed')}</span>
            ) : (
              <span className="text-ink-tertiary">{t('knowledge.doc.saving')}</span>
            )}
            {saveState === 'error' ? (
              <button
                type="button"
                className="ml-1 rounded-sm px-1 text-meta font-medium text-accent-strong hover:underline"
                data-testid="knowledge-save-retry"
                onClick={() => void flushSave()}
              >
                {t('knowledge.doc.saveRetry')}
              </button>
            ) : null}
          </div>
        ) : null}
      </main>

      <Modal
        open={nodeEdit != null}
        onOpenChange={(o) => !o && setNodeEdit(null)}
        title={t('knowledge.tree.rename')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-rename-node-cancel"
              onClick={() => setNodeEdit(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-rename-node-confirm"
              disabled={!nodeTitle.trim() || busy}
              onClick={() => void confirmRenameNode()}
            >
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-body text-ink-secondary">{t('knowledge.tree.nameLabel')}</span>
            <Input
              data-testid="knowledge-rename-node-name"
              value={nodeTitle}
              onChange={(e) => setNodeTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !nodeTitle.trim() || !nodeEdit) return
                e.preventDefault()
                void confirmRenameNode()
              }}
            />
          </label>
          {nodeEdit?.kind === 'doc' ? (
            <label className="flex items-start gap-2 text-meta text-ink-secondary">
              <input
                type="checkbox"
                className="mt-0.5"
                data-testid="knowledge-rename-update-links"
                checked={renameUpdateLinks}
                onChange={(e) => setRenameUpdateLinks(e.target.checked)}
              />
              <span>{t('knowledge.tree.renameUpdateLinks')}</span>
            </label>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={nodeDelete != null}
        onOpenChange={(o) => !o && setNodeDelete(null)}
        title={t('knowledge.tree.deleteTitle', {
          title: nodeDelete?.title ?? '',
        })}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-delete-node-cancel"
              onClick={() => setNodeDelete(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              data-testid="knowledge-delete-node-confirm"
              disabled={busy}
              onClick={() => {
                if (nodeDelete) void deleteNode(nodeDelete.id)
                setNodeDelete(null)
              }}
            >
              {t('knowledge.tree.delete')}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4">
          <p className="text-body leading-relaxed text-ink-secondary">
            {nodeDelete?.kind === 'folder'
              ? t('knowledge.tree.deleteFolderBody')
              : nodeDelete?.kind === 'board'
                ? t('knowledge.tree.deleteBoardBody')
                : t('knowledge.tree.deleteDocBody')}
          </p>
        </div>
      </Modal>

      <WikiCreateModal
        open={wikiCreateTitle != null}
        title={wikiCreateTitle ?? ''}
        busy={busy}
        onOpenChange={(o) => {
          if (!o) setWikiCreateTitle(null)
        }}
        onConfirm={() => {
          const title = wikiCreateTitle?.trim()
          if (!title) return
          setWikiCreateTitle(null)
          void requestCreateDoc(parentForNew, title)
        }}
      />

      <Modal
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        title={t('knowledge.versions.title')}
        className="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-versions-close"
              onClick={() => setVersionsOpen(false)}
            >
              {t('common.close')}
            </Button>
            <Button data-testid="knowledge-versions-save" onClick={() => void onSaveVersion()}>
              {t('knowledge.versions.menuSave')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2 px-5 py-4" data-testid="knowledge-versions-list">
          <VersionTimeline
            versions={versions}
            loading={versionsLoading}
            selectedId={versionSelectedId}
            onSelect={(v) => setVersionSelectedId(v.id)}
            onDiff={(v) => void openVersionDiff(v.id)}
            onRestore={(v) => setRestoreTarget(v)}
            largeByteThreshold={KNOWLEDGE_LARGE_DOC_CHARS}
          />
        </div>
      </Modal>

      <Modal
        open={versionDiff != null}
        onOpenChange={(o) => {
          if (!o) setVersionDiff(null)
        }}
        title={t('knowledge.versions.diffTitle')}
        className="max-w-3xl"
        resizable
        defaultSize={{ width: 720, height: 520 }}
        storageKey="hip-knowledge-version-diff"
        footer={
          <div className="flex justify-end">
            <Button
              variant="secondary"
              data-testid="knowledge-version-diff-close"
              onClick={() => setVersionDiff(null)}
            >
              {t('common.close')}
            </Button>
          </div>
        }
      >
        {versionDiff ? <VersionDiffView lines={versionDiff.lines} /> : null}
      </Modal>

      <Modal
        open={restoreTarget != null}
        onOpenChange={(o) => {
          if (!o) setRestoreTarget(null)
        }}
        title={t('knowledge.versions.restoreTitle')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-version-restore-cancel"
              onClick={() => setRestoreTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-version-restore-confirm"
              onClick={() => void onConfirmRestore()}
            >
              {t('knowledge.versions.restoreConfirm')}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4">
          <p className="text-body leading-relaxed text-ink-secondary">
            {t('knowledge.versions.restoreBody')}
          </p>
        </div>
      </Modal>

      <Modal
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        title={t('knowledge.template.saveAsTitle')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-save-template-cancel"
              onClick={() => setSaveTemplateOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-save-template-confirm"
              disabled={!templateName.trim() || busy}
              onClick={() => {
                void saveDocAsTemplate(templateName).then((ok) => {
                  if (ok) setSaveTemplateOpen(false)
                })
              }}
            >
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-body text-ink-secondary">
              {t('knowledge.template.nameLabel')}
            </span>
            <Input
              data-testid="knowledge-save-template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder={t('knowledge.template.namePlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !templateName.trim()) return
                e.preventDefault()
                void saveDocAsTemplate(templateName).then((ok) => {
                  if (ok) setSaveTemplateOpen(false)
                })
              }}
            />
          </label>
        </div>
      </Modal>

      <TemplatePickerModal />

      {activeSpaceId ? (
        <KnowledgeGraphModal
          open={graphOpen}
          onOpenChange={setGraphOpen}
          spaceId={activeSpaceId}
          focusDocId={activeDocId}
          onOpenDoc={(docId) => void openDoc(docId)}
        />
      ) : null}
    </div>
  )
}

