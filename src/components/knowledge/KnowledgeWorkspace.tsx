import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
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
import { getPath } from '@/domain/knowledge/tree'
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
  revealInPreviewRoot,
  revealLineInCodeMirror,
} from '@/domain/knowledge/searchReveal'
import { extractDocOutline } from '@/domain/knowledge/mdPreview'
import { DocManagerBrowse } from './DocManagerBrowse'
import { DocEditor, type DocEditorHandle } from './DocEditor'
import type { DocLiveEditorHandle } from './DocBlockNoteEditor'
import { KnowledgeDocCanvas } from './KnowledgeDocCanvas'
import { WikiCreateModal } from './WikiCreateModal'
import { KnowledgeGraphModal } from './KnowledgeGraphModal'
import { PageHeader } from './page/PageHeader'
import { VersionTimeline } from './version/VersionTimeline'
import { VersionDiffView } from './version/VersionDiffView'
import { parseFrontmatter } from '@/domain/knowledge/frontmatter'
import { knowledgeAiActions } from '@/domain/knowledge/ai/knowledgeAiActions'
import type { KnowledgeAiActionId } from '@/domain/knowledge/ai/knowledgeAiActions'

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
  const backlinks = useKnowledgeStore((s) => s.backlinks)
  const toggleFolder = useKnowledgeStore((s) => s.toggleFolder)
  const openDocStore = useKnowledgeStore((s) => s.openDoc)
  const saveDocAsTemplate = useKnowledgeStore((s) => s.saveDocAsTemplate)
  const saveVersionManual = useKnowledgeStore((s) => s.saveVersionManual)
  const listVersions = useKnowledgeStore((s) => s.listVersions)
  const restoreVersion = useKnowledgeStore((s) => s.restoreVersion)

  const space = spaces.find((s) => s.id === activeSpaceId)
  const activeNode = nodes.find((n) => n.id === activeDocId)
  const pathNodes = useMemo(
    () => (activeDocId ? getPath(nodes, activeDocId) : []),
    [nodes, activeDocId],
  )

  const editorRef = useRef<DocEditorHandle>(null)
  /** Live host handle for attach/paste (PR-2); wired now for insertMarkdown. */
  const liveEditorRef = useRef<DocLiveEditorHandle>(null)
  // Best-effort scroll-to-match after opening a search hit (`pendingReveal`).
  // Boards are title-only in search — never run Milkdown/CM reveal (Issue 18).
  useEffect(() => {
    if (!activeDocId || !activeSpaceId) return
    const pending = useKnowledgeStore.getState().pendingReveal
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
          revealInPreviewRoot(liveRoot, still.query)
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
  }, [activeDocId, activeSpaceId, editorMode, docBody, nodes])

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
  const wordCount = useMemo(() => {
    const body = parseFrontmatter(mountMarkdown).bodyWithoutFm
    const words = body.trim().match(/\S+/g)
    return words?.length ?? 0
  }, [mountMarkdown])

  const runAi = (action: KnowledgeAiActionId) => {
    const title = activeNode?.title ?? ''
    const raw = useKnowledgeStore.getState().draftBody || docBody
    const body = parseFrontmatter(raw).bodyWithoutFm
    const outline = extractDocOutline(body).map((h) => h.text)
    const selection =
      liveEditorRef.current?.getSelectionText?.() ??
      window.getSelection()?.toString() ??
      ''
    knowledgeAiActions.run({
      action,
      docContext: {
        title,
        outline,
        selection,
        bodyWindow: body.slice(0, 8000),
        backlinks: backlinks.map((b) => b.fromTitle),
        spaceId: activeSpaceId,
        docId: activeDocId,
      },
    })
    toast.message(t('knowledge.doc.aiStarted'))
  }

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
    toast.error(t('knowledge.doc.liveParseFailed'))
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

  const onCrumbClick = (node: KnowledgeNode) => {
    if (node.kind === 'folder') {
      toggleFolder(node.id)
      // keep active doc; only expand
    } else {
      void openDoc(node.id)
    }
  }

  /** Prefer first + last crumbs when the path is deep (max 4 visible nodes). */
  const crumbItems = useMemo(() => {
    if (pathNodes.length <= 4) {
      return pathNodes.map((node, index) => ({ kind: 'node' as const, node, index }))
    }
    const last = pathNodes.length - 1
    return [
      { kind: 'node' as const, node: pathNodes[0], index: 0 },
      { kind: 'ellipsis' as const },
      { kind: 'node' as const, node: pathNodes[last - 1], index: last - 1 },
      { kind: 'node' as const, node: pathNodes[last], index: last },
    ]
  }, [pathNodes])

  return (
    <div className="flex min-h-0 flex-1" data-testid="knowledge-workspace">


      <main className="flex min-w-0 flex-1 flex-col bg-surface-content">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-5">
          <div className="flex min-w-0 flex-1 items-center gap-1 truncate text-meta">
            {pathNodes.length === 0 ? (
              <span className="truncate text-ink-tertiary">{space?.name}</span>
            ) : (
              crumbItems.map((item, i) => {
                if (item.kind === 'ellipsis') {
                  return (
                    <span key="crumb-ellipsis" className="flex min-w-0 items-center gap-1">
                      {i > 0 && (
                        <ChevronRight
                          size={12}
                          className="shrink-0 text-ink-tertiary"
                          aria-hidden
                        />
                      )}
                      <span className="shrink-0 text-ink-tertiary" aria-hidden>
                        …
                      </span>
                    </span>
                  )
                }
                const n = item.node
                const isLast = item.index === pathNodes.length - 1
                return (
                  <span key={n.id} className="flex min-w-0 items-center gap-1">
                    {i > 0 && (
                      <ChevronRight
                        size={12}
                        className="shrink-0 text-ink-tertiary"
                        aria-hidden
                      />
                    )}
                    {!isLast ? (
                      <button
                        type="button"
                        className="truncate rounded-sm px-1 py-0.5 text-ink-secondary transition-colors hover:bg-state-hover hover:text-ink"
                        onClick={() => onCrumbClick(n)}
                      >
                        {n.title}
                      </button>
                    ) : (
                      <span className="truncate px-1 font-medium text-ink">{n.title}</span>
                    )}
                  </span>
                )
              })
            )}
          </div>
          {(saveState === 'saving' ||
            saveState === 'saved' ||
            saveState === 'error') && (
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 text-meta transition-opacity duration-500',
                saveState === 'error' ? 'text-danger' : 'text-ink-tertiary',
                saveState === 'saved' && 'opacity-70',
              )}
              data-testid="knowledge-save-status"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  saveState === 'saving'
                    ? 'bg-warning animate-pulse'
                    : saveState === 'error'
                      ? 'bg-danger'
                      : 'bg-success',
                )}
                aria-hidden
              />
              {saveState === 'saving'
                ? t('knowledge.doc.saving')
                : saveState === 'error'
                  ? t('knowledge.doc.saveFailed')
                  : t('knowledge.doc.saved')}
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
            </span>
          )}
          {activeDocId && !isBoard && liveEnabled && !liveBlocked && (
            <div
              className="flex shrink-0 items-center rounded-md border border-border bg-surface-muted/70 p-0.5"
              role="group"
              aria-label={t('knowledge.doc.modeLabel')}
              data-testid="knowledge-editor-mode-toggle"
            >
              <button
                type="button"
                data-testid="knowledge-view-live"
                disabled={liveSuppressed && !showLiveEditor}
                title={
                  liveSuppressed && !showLiveEditor
                    ? t('knowledge.doc.largeDocForceSource')
                    : undefined
                }
                className={cn(
                  'rounded-sm px-2 py-0.5 text-meta transition-colors',
                  showLiveEditor
                    ? 'bg-surface font-medium text-ink shadow-sm'
                    : 'text-ink-secondary hover:text-ink',
                  liveSuppressed && !showLiveEditor && 'opacity-40',
                )}
                onClick={() => {
                  if (showLiveEditor) return
                  liveEditorRef.current?.flushDraft()
                  void setEditorMode('live')
                }}
              >
                {t('knowledge.doc.live')}
              </button>
              <button
                type="button"
                data-testid="knowledge-view-source"
                className={cn(
                  'rounded-sm px-2 py-0.5 text-meta transition-colors',
                  showSourceEditor
                    ? 'bg-surface font-medium text-ink shadow-sm'
                    : 'text-ink-secondary hover:text-ink',
                )}
                onClick={() => {
                  if (showSourceEditor) return
                  liveEditorRef.current?.flushDraft()
                  void setEditorMode('source')
                }}
              >
                {t('knowledge.doc.source')}
              </button>
            </div>
          )}
          {activeDocId && !isBoard && (
            /* modal={false}: modal menu + version-history / save-as-template Modal both lock
                body pointer-events; stacking leaves the app unclickable after close. */
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-sm p-1.5 text-ink-tertiary hover:bg-state-hover hover:text-ink"
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
          )}
        </div>
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
                  onWikiNavigate={({ title, nodeId, broken }) => {
                    if (nodeId) {
                      void openDoc(nodeId)
                      return
                    }
                    if (broken || !nodeId) {
                      setWikiCreateTitle(title)
                    }
                  }}
                  onAiAction={runAi}
                  onCreateSubdoc={createSubdoc}
                  onCopyPageLink={() => void copyPageLink()}
                />
              </Suspense>
              <footer
                className="knowledge-doc-inline-pad flex shrink-0 pb-6 pt-2 text-meta text-ink-tertiary"
                data-testid="knowledge-doc-footer"
              >
                <div className="knowledge-doc-measure flex items-center gap-3">
                  <span data-testid="knowledge-doc-word-count">
                    {t('knowledge.doc.wordCount', { count: wordCount })}
                  </span>
                  <span data-testid="knowledge-doc-backlink-count">
                    {t('knowledge.doc.backlinkCount', { count: backlinks.length })}
                  </span>
                </div>
              </footer>
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
              />
              {liveSuppressed ? (
                <div className="knowledge-doc-inline-pad mt-2" data-testid="knowledge-large-doc-banner-wrap">
                  <div
                    className="knowledge-doc-measure rounded-md border border-border bg-surface-muted/80 px-3 py-2 text-meta text-ink-secondary"
                    data-testid="knowledge-large-doc-banner"
                    role="status"
                  >
                    {t('knowledge.doc.largeDocHint')}
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
              <footer
                className="knowledge-doc-inline-pad flex shrink-0 pb-6 pt-2 text-meta text-ink-tertiary"
                data-testid="knowledge-doc-footer"
              >
                <div className="knowledge-doc-measure flex items-center gap-3">
                  <span>
                    {t('knowledge.doc.wordCount', { count: wordCount })}
                  </span>
                  <span>
                    {t('knowledge.doc.backlinkCount', { count: backlinks.length })}
                  </span>
                </div>
              </footer>
            </KnowledgeDocCanvas>
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

