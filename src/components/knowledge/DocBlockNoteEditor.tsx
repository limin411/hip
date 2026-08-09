/**
 * Live document editor on BlockNote (TipTap/ProseMirror).
 * Thin host: schema, find, keymap, wiki navigate, dialect bridge.
 * Storage: Markdown + YAML frontmatter (lossy MD round-trip — product-accepted).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { offset, shift } from '@floating-ui/dom'
import { BlockNoteView } from '@blocknote/mantine'
import {
  BasicTextStyleButton,
  ColorStyleButton,
  CreateLinkButton,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  SideMenuController,
  SuggestionMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useExtension,
  useExtensionState,
  RemoveBlockItem,
  BlockColorsItem,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import {
  en as bnEn,
  ja as bnJa,
  ko as bnKo,
  zh as bnZh,
  zhTW as bnZhTw,
  type Dictionary as BlockNoteDictionary,
} from '@blocknote/core/locales'
import i18n from '@/i18n'
import { BlockNoteHipSlashMenu } from './BlockNoteHipSlashMenu'
import { MantineProvider } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Link2, ListChecks, Trash2 } from 'lucide-react'
import {
  joinYamlFrontmatter,
  splitYamlFrontmatter,
} from '@/domain/knowledge/frontmatter'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import {
  importAssetFromClipboardItems,
  importAssetFromFile,
} from '@/domain/knowledge/importAsset'
import { resolveAssetDataUrl } from '@/domain/knowledge/assetUrl'
import {
  isKnowledgePerfEnabled,
  kbPerfLiveCreateEnd,
  kbPerfLiveCreateStart,
  kbPerfSerialize,
} from '@/domain/knowledge/knowledgePerf'
import {
  buildKnowledgeSlashItems,
  type BlockNoteSlashEditor,
} from '@/domain/knowledge/blockNoteSlash'
import {
  SIDE_MENU_BLOCKS,
  cloneBlockForDuplicate,
  insertSideMenuBlock,
  sideMenuLabelKey,
  turnIntoSideMenuBlock,
  type SideMenuBlockId,
} from '@/domain/knowledge/sideMenuBlocks'
import {
  formatWikiLink,
  listDocsInTreeOrder,
  resolveWikiTitle,
  wikiLinkQueryAt,
} from '@/domain/knowledge/wikiLink'
import {
  slashGroupLabelKey,
  slashItemLabelKey,
  type KnowledgeSlashId,
} from '@/domain/knowledge/slashMenu'
import {
  CODE_BLOCK_CHROME,
  normalizeCodeBlockThemeId,
} from '@/domain/knowledge/codeBlockTheme'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { WikiLinkPicker } from './WikiLinkPicker'
import { DocFindBar } from './find/DocFindBar'
import { knowledgeBlockSchema } from '@/domain/knowledge/blocks/schema'
import { setLiveCodeBlockThemePref } from '@/domain/knowledge/blocks/codeBlockHighlight'
import {
  KnowledgeEditorHostContext,
  type KnowledgeEditorHost,
} from '@/domain/knowledge/blocks/knowledgeEditorHostContext'
import {
  detectDialectLoss,
  serializeLiveDocumentToMd,
  preParseMdForLive,
} from '@/domain/knowledge/blocks/dialectBridge'
import {
  handleBlockKeydown,
  type BlockKeymapEditor,
} from '@/domain/knowledge/blocks/blockKeymap'

/**
 * BlockNote ships its own UI dictionaries (table handle menus, drag handle menu,
 * side-menu labels, …). Pick the one matching the app locale. The editor instance
 * is created once per doc, so a language switch applies on the next doc open —
 * recreating mid-edit would re-seed from the last saved markdown and lose drafts.
 */
const BN_DICTIONARY_BY_LANGUAGE: Record<string, BlockNoteDictionary> = {
  'zh-CN': bnZh,
  'zh-TW': bnZhTw,
  ja: bnJa,
  ko: bnKo,
  en: bnEn,
}

function blockNoteDictionary(): BlockNoteDictionary {
  return BN_DICTIONARY_BY_LANGUAGE[i18n.language] ?? bnEn
}
import {
  hasInlineMath,
  splitInlineMath,
  type InlineMathSegment,
} from '@/domain/knowledge/blocks/mathInlineConvert'

import '@blocknote/mantine/style.css'
import '@mantine/core/styles.css'
import './knowledge-blocknote.css'

/** Same handle surface as legacy DocLiveEditor (Workspace / attach paths). */
export type DocLiveEditorHandle = {
  insertMarkdown: (md: string) => boolean
  focus: (opts?: { at?: 'start' | 'end' }) => boolean
  flushDraft: () => void
  /** Scroll to heading by outline text + occurrence (0-based). */
  scrollToHeading?: (text: string, occurrence?: number) => boolean
  getSelectionText?: () => string
}

export type DocBlockNoteEditorHandle = DocLiveEditorHandle

export interface DocBlockNoteEditorProps {
  docId: string
  initialMarkdown: string
  onDraftChange: (v: string, meta: { docId: string }) => void
  onBlur?: () => void
  onSave?: () => void
  onParseError?: (err: unknown) => void
  placeholder?: string
  wikiNodes?: KnowledgeNode[]
  spaceId?: string | null
  onAssetImportError?: (
    reason: 'too_large_paste' | 'too_large_disk' | 'unsupported' | 'error',
  ) => void
  onAssetImported?: () => void
  onRequestAttach?: () => void
  onWikiNavigate?: (payload: {
    title: string
    nodeId: string | null
    broken: boolean
    /** 块引用锚点（V2-E1）。 */
    fragment?: string | null
  }) => void
  onCreateSubdoc?: () => void
  onCopyPageLink?: () => void
}

const DRAFT_THROTTLE_MS = 120

/**
 * TipTap EditorContent.componentWillUnmount calls `view.setProps({ nodeViews: {} })`,
 * which re-enters ProseMirror update/iterDeco. Guard setProps/destroy for this view only.
 */
function hardenTiptapViewTeardown(editor: {
  _tiptapEditor?: {
    isDestroyed?: boolean
    view?: {
      isDestroyed?: boolean
      setProps: (props: Record<string, unknown>) => void
      destroy: () => void
    }
  }
}): () => void {
  const tt = editor._tiptapEditor
  const view = tt?.view
  if (!tt || !view) return () => {}

  const origSetProps = view.setProps.bind(view)
  const origDestroy = view.destroy.bind(view)

  view.setProps = (props: Record<string, unknown>) => {
    try {
      if (tt.isDestroyed || view.isDestroyed) return
      return origSetProps(props)
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[DocBlockNoteEditor] suppressed setProps during teardown', err)
      }
    }
  }

  view.destroy = () => {
    try {
      if (view.isDestroyed) return
      origDestroy()
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[DocBlockNoteEditor] suppressed destroy error', err)
      }
    }
  }

  return () => {
    view.setProps = origSetProps
    view.destroy = origDestroy
  }
}

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false
    return (
      document.documentElement.classList.contains('dark') ||
      document.documentElement.dataset.theme === 'dark' ||
      document.body.dataset.theme === 'dark'
    )
  })
  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      setDark(
        root.classList.contains('dark') ||
          root.dataset.theme === 'dark' ||
          document.body.dataset.theme === 'dark',
      )
    }
    const mo = new MutationObserver(sync)
    mo.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return dark
}

/** 细线 ＋（14 / stroke 2.25）— 非 MdAdd 填充。 */
function SideMenuPlusIcon() {
  return (
    <svg
      className="kb-side-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** 实心 2×3 六点 SVG（非 radial-gradient）。 */
function SideMenuSixDotIcon() {
  return (
    <svg
      className="kb-side-icon"
      width="10"
      height="16"
      viewBox="0 0 10 16"
      fill="currentColor"
      aria-hidden
      data-test="dragHandle"
    >
      <circle cx="2.5" cy="2" r="1.25" />
      <circle cx="7.5" cy="2" r="1.25" />
      <circle cx="2.5" cy="8" r="1.25" />
      <circle cx="7.5" cy="8" r="1.25" />
      <circle cx="2.5" cy="14" r="1.25" />
      <circle cx="7.5" cy="14" r="1.25" />
    </svg>
  )
}

function KnowledgeDragHandleMenu({ children }: { children?: React.ReactNode }) {
  const Components = useComponentsContext()
  if (!Components) return null
  return (
    <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-drag-handle-menu">
      {children ?? <DragHandleMenu />}
    </Components.Generic.Menu.Dropdown>
  )
}

function ComponentsSeparator() {
  const Components = useComponentsContext()
  if (!Components) return null
  return <Components.Generic.Menu.Divider />
}

/** 转换成… ▸（对齐 BlockColorsItem 的 sub 写法）。 */
function TurnIntoItem() {
  const { t } = useTranslation()
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })
  if (!Components || !block) return null
  return (
    <Components.Generic.Menu.Root position="right" sub>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item
          className="bn-menu-item"
          subTrigger
          data-testid="kb-turn-into"
        >
          {t('knowledge.doc.blockMenuTurnInto')}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {SIDE_MENU_BLOCKS.map((item) => (
          <Components.Generic.Menu.Item
            key={item.id}
            className="bn-menu-item"
            data-testid={`kb-turn-into-${item.id}`}
            onClick={() => {
              try {
                turnIntoSideMenuBlock(editor, block, item.id)
              } catch {
                toast.error(t('knowledge.doc.blockMenuTurnIntoFailed'))
              }
            }}
          >
            <span className="kb-add-menu-icon" aria-hidden>
              {item.icon}
            </span>
            {t(sideMenuLabelKey(item.id), { defaultValue: item.label })}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}

function CopyBlockLinkItem({
  blockId,
  onCopy,
}: {
  blockId: string
  onCopy: (blockId: string) => void
}) {
  const { t } = useTranslation()
  const Components = useComponentsContext()
  if (!Components) return null
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      data-testid="kb-copy-block-link"
      icon={<Link2 size={14} strokeWidth={1.75} />}
      onClick={() => onCopy(blockId)}
    >
      {t('knowledge.doc.copyBlockLink')}
    </Components.Generic.Menu.Item>
  )
}

function DuplicateBlockItem() {
  const { t } = useTranslation()
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })
  if (!Components || !block) return null
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      data-testid="kb-duplicate-block"
      icon={<Copy size={14} strokeWidth={1.75} />}
      onClick={() => {
        try {
          const clone = cloneBlockForDuplicate(block)
          editor.insertBlocks([clone], block, 'after')
        } catch {
          toast.error(t('knowledge.doc.blockMenuDuplicateFailed'))
        }
      }}
    >
      {t('knowledge.doc.blockMenuDuplicate')}
    </Components.Generic.Menu.Item>
  )
}

function MultiSelectItem({
  isSelected,
  onToggle,
  onClear,
}: {
  isSelected: boolean
  onToggle: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const Components = useComponentsContext()
  if (!Components) return null
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      data-testid="kb-multiselect-item"
      aria-pressed={isSelected}
      icon={<ListChecks size={14} strokeWidth={1.75} />}
      onClick={() => (isSelected ? onClear() : onToggle())}
    >
      {isSelected
        ? t('knowledge.doc.multiSelectClear')
        : t('knowledge.doc.multiSelectAdd')}
    </Components.Generic.Menu.Item>
  )
}

function DeleteBlockItem() {
  const { t } = useTranslation()
  const Components = useComponentsContext()
  if (!Components) return null
  return (
    <RemoveBlockItem>
      <span className="kb-menu-danger-label" data-testid="kb-delete-block">
        <Trash2 size={14} strokeWidth={1.75} style={{ marginRight: 8, verticalAlign: -2 }} />
        {t('knowledge.doc.blockMenuDelete')}
      </span>
    </RemoveBlockItem>
  )
}

/**
 * + 按钮：贴手柄打开插入菜单（空块转换 / 非空下方插入）。
 * freezeMenu 保持侧栏在菜单打开时不卸载。
 */
function KnowledgeAddBlockButton({
  menuOpen,
  onOpenChange,
}: {
  menuOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const Components = useComponentsContext()
  const editor = useBlockNoteEditor<any, any, any>()
  const sideMenu = useExtension(SideMenuExtension)
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })
  const wrapRef = useRef<HTMLDivElement>(null)
  const hasOpenedRef = useRef(false)

  useEffect(() => {
    if (!sideMenu) return
    if (menuOpen) {
      hasOpenedRef.current = true
      sideMenu.freezeMenu()
    } else if (hasOpenedRef.current) {
      // 仅在实际关闭菜单时解冻——挂载时调用 unfreezeMenu 会把
      // SideMenuExtension 的 show 重置为 false，导致手柄瞬间消失。
      sideMenu.unfreezeMenu()
    }
    return () => {
      if (menuOpen) sideMenu.unfreezeMenu()
    }
  }, [menuOpen, sideMenu])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menuOpen, onOpenChange])

  if (!Components || !block) return null

  const runInsert = (id: SideMenuBlockId) => {
    try {
      editor.setTextCursorPosition(block)
      insertSideMenuBlock(editor as BlockNoteSlashEditor, id)
    } catch {
      toast.error(t('knowledge.doc.blockMenuInsertFailed'))
    }
    onOpenChange(false)
  }

  return (
    <div className="kb-add-wrap" ref={wrapRef}>
      <Components.SideMenu.Button
        className="bn-button kb-add-block"
        label={t('knowledge.doc.sideMenuAdd')}
        icon={
          <span
            data-test="dragHandleAdd"
            data-testid="kb-add-block"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenChange(!menuOpen)
            }}
          >
            <SideMenuPlusIcon />
          </span>
        }
      />
      {menuOpen ? (
        <div className="kb-add-menu" role="menu" data-testid="kb-add-menu">
          {SIDE_MENU_BLOCKS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="kb-add-menu-item"
              data-testid={`kb-add-${item.id}`}
              onClick={() => runInsert(item.id)}
            >
              <span className="kb-add-menu-icon" aria-hidden>
                {item.icon}
              </span>
              {t(sideMenuLabelKey(item.id), { defaultValue: item.label })}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 六点手柄：拖拽排序 + 点击块菜单（position right）。
 * BN Generic.Menu 无受控 opened；拖/点冲突用 suppress + remount 关菜单。
 */
function KnowledgeDragHandleButton({
  children,
  closeSignal,
  onMenuOpenChange,
}: {
  children?: React.ReactNode
  /** Increment to force-close (e.g. when + menu opens). */
  closeSignal: number
  onMenuOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const Components = useComponentsContext()
  const sideMenu = useExtension(SideMenuExtension)
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  })
  const suppressClickRef = useRef(false)
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const [menuKey, setMenuKey] = useState(0)
  const menuOpenRef = useRef(false)

  useEffect(() => {
    // Parent asked to close (mutual exclusion with + menu).
    if (menuOpenRef.current) {
      menuOpenRef.current = false
      onMenuOpenChange(false)
      sideMenu?.unfreezeMenu()
      setMenuKey((k) => k + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeSignal is the trigger
  }, [closeSignal])

  if (!Components || !block || !sideMenu) return null

  return (
    <Components.Generic.Menu.Root
      key={menuKey}
      onOpenChange={(open: boolean) => {
        if (open && suppressClickRef.current) {
          suppressClickRef.current = false
          // Force-close: remount (BN Menu has no controlled `opened`).
          setMenuKey((k) => k + 1)
          return
        }
        menuOpenRef.current = open
        onMenuOpenChange(open)
        if (open) sideMenu.freezeMenu()
        else sideMenu.unfreezeMenu()
      }}
      position="right"
    >
      <Components.Generic.Menu.Trigger>
        <Components.SideMenu.Button
          label={t('knowledge.doc.sideMenuDragHandle')}
          draggable
          onDragStart={(e: React.DragEvent) => {
            suppressClickRef.current = true
            sideMenu.blockDragStart(e, block)
          }}
          onDragEnd={() => {
            sideMenu.blockDragEnd()
            suppressClickRef.current = true
            window.setTimeout(() => {
              suppressClickRef.current = false
            }, 0)
          }}
          className="bn-button kb-drag-handle"
          icon={
            <span
              onPointerDown={(e) => {
                downRef.current = { x: e.clientX, y: e.clientY }
                suppressClickRef.current = false
              }}
              onPointerMove={(e) => {
                if (!downRef.current) return
                const dx = e.clientX - downRef.current.x
                const dy = e.clientY - downRef.current.y
                if (dx * dx + dy * dy > 16) suppressClickRef.current = true
              }}
              onPointerUp={() => {
                downRef.current = null
              }}
            >
              <SideMenuSixDotIcon />
            </span>
          }
        />
      </Components.Generic.Menu.Trigger>
      <KnowledgeDragHandleMenu>{children}</KnowledgeDragHandleMenu>
    </Components.Generic.Menu.Root>
  )
}

/**
 * Side-menu gutter (v3): 横向 [+][⋮⋮] + 真 SVG。
 * + → 插入菜单；⋮⋮ → Notion 式块操作（拖拽排序保留）。
 */
function KnowledgeSideMenu({
  selectedIds,
  onToggleSelect,
  onClearSelection,
  onCopyBlockLink,
}: {
  selectedIds: string[]
  onToggleSelect: (id: string) => void
  onClearSelection: () => void
  onCopyBlockLink: (blockId: string) => void
}) {
  const { t } = useTranslation()
  const editor = useBlockNoteEditor<any, any, any>()
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })
  const [addOpen, setAddOpen] = useState(false)
  const [dragCloseSignal, setDragCloseSignal] = useState(0)

  if (!block) return null
  const isSelected = selectedIds.includes(block.id)

  return (
    <div
      className="bn-side-menu"
      data-testid="kb-side-menu"
      data-block-id={block.id}
      data-block-type={block.type}
    >
      <KnowledgeAddBlockButton
        menuOpen={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open)
          if (open) setDragCloseSignal((n) => n + 1)
        }}
      />
      <KnowledgeDragHandleButton
        closeSignal={dragCloseSignal}
        onMenuOpenChange={(open) => {
          if (open) setAddOpen(false)
        }}
      >
        <TurnIntoItem />
        <BlockColorsItem>{t('knowledge.doc.blockMenuColors')}</BlockColorsItem>
        <CopyBlockLinkItem blockId={block.id} onCopy={onCopyBlockLink} />
        <DuplicateBlockItem />
        <ComponentsSeparator />
        <MultiSelectItem
          isSelected={isSelected}
          onToggle={() => onToggleSelect(block.id)}
          onClear={onClearSelection}
        />
        <ComponentsSeparator />
        <DeleteBlockItem />
      </KnowledgeDragHandleButton>
    </div>
  )
}

const SIDE_MENU_FLOATING_UI = {
  useFloatingOptions: {
    middleware: [offset(6), shift({ padding: 8 })],
  },
}

function blockPlainText(block: {
  content?: unknown
}): string {
  const c = block.content
  if (!Array.isArray(c)) return typeof c === 'string' ? c : ''
  return c
    .map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: string }).text ?? '')
      }
      if (part && typeof part === 'object' && 'type' in part) {
        const p = part as { type?: string; props?: { title?: string; alias?: string; src?: string } }
        if (p.type === 'wikiLink') {
          const alias = p.props?.alias?.trim()
          const title = p.props?.title?.trim() ?? ''
          return alias || title
        }
        if (p.type === 'mathInline') {
          return `$${p.props?.src ?? ''}$`
        }
      }
      return ''
    })
    .join('')
}

function caretAnchor(): { top: number; left: number } {
  try {
    const sel = window.getSelection()
    if (sel?.rangeCount) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (rect && (rect.width || rect.height || rect.top || rect.left)) {
        return { top: rect.bottom + 4, left: rect.left }
      }
    }
  } catch {
    // ignore
  }
  return { top: 120, left: 120 }
}

function coordsAtPos(editor: {
  _tiptapEditor?: {
    view?: {
      coordsAtPos?: (pos: number) => { top: number; bottom: number; left: number }
    }
    state?: { selection?: { from: number } }
  }
}): { top: number; left: number } {
  try {
    const tt = editor._tiptapEditor
    const pos = tt?.state?.selection?.from
    if (typeof pos === 'number' && tt?.view?.coordsAtPos) {
      const c = tt.view.coordsAtPos(pos)
      return { top: c.bottom + 4, left: c.left }
    }
  } catch {
    // ignore
  }
  return caretAnchor()
}

export const DocBlockNoteEditor = forwardRef<
  DocBlockNoteEditorHandle,
  DocBlockNoteEditorProps
>(function DocBlockNoteEditor(
  {
    docId,
    initialMarkdown,
    onDraftChange,
    onBlur,
    onSave,
    onParseError,
    placeholder,
    wikiNodes,
    spaceId,
    onAssetImportError,
    onAssetImported,
    onRequestAttach,
    onWikiNavigate,
    onCreateSubdoc,
    onCopyPageLink,
  },
  ref,
) {
  const { t } = useTranslation()
  const boundDocIdRef = useRef(docId)
  boundDocIdRef.current = docId
  const fmTextRef = useRef('')
  const onDraftChangeRef = useRef(onDraftChange)
  onDraftChangeRef.current = onDraftChange
  const onBlurRef = useRef(onBlur)
  onBlurRef.current = onBlur
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onParseErrorRef = useRef(onParseError)
  onParseErrorRef.current = onParseError
  const spaceIdRef = useRef(spaceId)
  spaceIdRef.current = spaceId
  const onAssetImportErrorRef = useRef(onAssetImportError)
  onAssetImportErrorRef.current = onAssetImportError
  const onAssetImportedRef = useRef(onAssetImported)
  onAssetImportedRef.current = onAssetImported
  const onRequestAttachRef = useRef(onRequestAttach)
  onRequestAttachRef.current = onRequestAttach
  const onWikiNavigateRef = useRef(onWikiNavigate)
  onWikiNavigateRef.current = onWikiNavigate
  const onCreateSubdocRef = useRef(onCreateSubdoc)
  onCreateSubdocRef.current = onCreateSubdoc
  const onCopyPageLinkRef = useRef(onCopyPageLink)
  onCopyPageLinkRef.current = onCopyPageLink
  const wikiNodesRef = useRef(wikiNodes)
  wikiNodesRef.current = wikiNodes
  const seedBodyRef = useRef('')
  const lossToastShownRef = useRef(false)
  const lossKeyRef = useRef('')

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftDirtyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const skipNextChangeRef = useRef(true)
  const isDark = usePrefersDark()
  const codeBlockThemePref = useHipConfigStore((s) =>
    normalizeCodeBlockThemeId(s.config.codeBlock?.colorTheme),
  )
  const codeBlockChrome = useMemo(() => {
    // T7: 文档域默认 = 纸张（浅色跟随主题时）；显式 light/dark 保持 GitHub 风。
    const mode =
      codeBlockThemePref === 'follow'
        ? isDark
          ? 'dark'
          : 'paper'
        : codeBlockThemePref
    return CODE_BLOCK_CHROME[mode]
  }, [codeBlockThemePref, isDark])
  const codeBlockStyle = useMemo(
    () =>
      ({
        ['--kb-code-bg' as string]: codeBlockChrome.background,
        ['--kb-code-fg' as string]: codeBlockChrome.text,
        ['--kb-code-border' as string]: codeBlockChrome.border,
      }) as React.CSSProperties,
    [codeBlockChrome],
  )

  const [wikiPicker, setWikiPicker] = useState<{
    query: string
    from: number
    to: number
    anchor: { top: number; left: number }
  } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findReplace, setFindReplace] = useState(false)
  /** Live↔Source fidelity losses still present in the current serialized draft. */
  const [losses, setLosses] = useState<string[]>([])
  /** Multi-selected block ids (Shift+click on side-menu handle). */
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const { fmText, body } = useMemo(
    () => splitYamlFrontmatter(initialMarkdown),
    // Parent remounts via key={docId}; seed once per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  )
  fmTextRef.current = fmText
  seedBodyRef.current = body

  const resolvedPlaceholder =
    placeholder ?? t('knowledge.doc.placeholderSlash')

  const editor = useCreateBlockNote(
    {
      schema: knowledgeBlockSchema,
      dictionary: blockNoteDictionary(),
      placeholders: {
        default: resolvedPlaceholder,
      },
      setIdAttribute: true,
      tables: {
        headers: true,
      },
      uploadFile: async (file: File) => {
        const sid = spaceIdRef.current
        if (!sid) throw new Error('no space')
        const res = await importAssetFromFile(sid, file)
        if (!res.ok) {
          onAssetImportErrorRef.current?.(
            res.reason === 'too_large_paste'
              ? 'too_large_paste'
              : res.reason === 'too_large_disk'
                ? 'too_large_disk'
                : res.reason === 'unsupported'
                  ? 'unsupported'
                  : 'error',
          )
          throw new Error(res.reason)
        }
        onAssetImportedRef.current?.()
        return res.meta.relPath
      },
      resolveFileUrl: async (url: string) => {
        const sid = spaceIdRef.current
        if (!sid) return url
        if (
          url.startsWith('data:') ||
          url.startsWith('http://') ||
          url.startsWith('https://') ||
          url.startsWith('blob:')
        ) {
          return url
        }
        const resolved = await resolveAssetDataUrl(sid, url)
        return resolved?.dataUrl ?? url
      },
    },
    [docId],
  )

  // Re-run prosemirror-highlight when app/code-block theme flips so token
  // colors match the chrome (plugin honors `prosemirror-highlight-refresh`).
  useEffect(() => {
    setLiveCodeBlockThemePref(codeBlockThemePref)
    try {
      const tt = editor._tiptapEditor
      if (!tt || tt.isDestroyed) return
      const { tr } = tt.state
      tt.view.dispatch(tr.setMeta('prosemirror-highlight-refresh', true))
    } catch {
      // editor not mounted yet
    }
  }, [editor, isDark, codeBlockThemePref])

  const slashEditor = editor as unknown as BlockNoteSlashEditor

  const hostValue = useMemo<KnowledgeEditorHost>(
    () => ({
      spaceId: spaceId ?? null,
      nodes: wikiNodes ?? [],
      onWikiNavigate,
      onOpenDoc: (id, fragment) => {
        onWikiNavigate?.({
          title: '',
          nodeId: id,
          broken: false,
          fragment: fragment ?? null,
        })
      },
    }),
    [spaceId, wikiNodes, onWikiNavigate],
  )

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    let restore = hardenTiptapViewTeardown(editor)
    const rebind = () => {
      restore()
      restore = hardenTiptapViewTeardown(editor)
    }
    const raf = requestAnimationFrame(rebind)
    const tt = editor._tiptapEditor as
      | { on?: (e: string, cb: () => void) => void; off?: (e: string, cb: () => void) => void }
      | undefined
    tt?.on?.('mount', rebind)
    return () => {
      aliveRef.current = false
      cancelAnimationFrame(raf)
      tt?.off?.('mount', rebind)
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current)
        draftTimerRef.current = null
      }
      try {
        if (draftDirtyRef.current) {
          draftDirtyRef.current = false
          const bodyMd = serializeLiveDocumentToMd(editor)
          onDraftChangeRef.current(
            joinYamlFrontmatter(fmTextRef.current, bodyMd),
            { docId: boundDocIdRef.current },
          )
        }
      } catch {
        // editor already torn down
      }
      restore()
    }
  }, [editor])

  // Initial markdown → blocks (via dialect pre-parse)
  useEffect(() => {
    kbPerfLiveCreateStart()
    try {
      skipNextChangeRef.current = true
      const prepared = preParseMdForLive(body || '')
      const blocks = editor.tryParseMarkdownToBlocks(prepared)
      const ids = editor.document.map((b) => b.id)
      if (blocks.length > 0) {
        editor.replaceBlocks(ids, blocks)
      }
      kbPerfLiveCreateEnd()
    } catch (err) {
      onParseErrorRef.current?.(err)
    }
    const tmr = window.setTimeout(() => {
      skipNextChangeRef.current = false
    }, 0)
    return () => window.clearTimeout(tmr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const emitDraft = useCallback(() => {
    draftDirtyRef.current = false
    if (!aliveRef.current) return
    try {
      if (editor._tiptapEditor?.isDestroyed) return
      const t0 = isKnowledgePerfEnabled() ? performance.now() : 0
      const bodyMd = serializeLiveDocumentToMd(editor)
      if (isKnowledgePerfEnabled()) kbPerfSerialize(performance.now() - t0)

      // Honesty: toast once per editor instance if dialect markers lost, and
      // keep a persistent banner while the loss is still present in the draft.
      const lost = detectDialectLoss(seedBodyRef.current, bodyMd)
      const lossIds = lost.map((l) => l.id)
      const lossKey = lossIds.join(',')
      if (lossKey !== lossKeyRef.current) {
        lossKeyRef.current = lossKey
        setLosses(lossIds)
      }
      if (lost.length > 0 && !lossToastShownRef.current) {
        lossToastShownRef.current = true
        toast.message(t('knowledge.doc.dialectLoss'), {
          description: lost.map((l) => l.id).join(', '),
        })
      }

      onDraftChangeRef.current(
        joinYamlFrontmatter(fmTextRef.current, bodyMd),
        { docId: boundDocIdRef.current },
      )
    } catch {
      // keep last good draft
    }
  }, [editor, t])

  const flushDraft = useCallback(() => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current)
      draftTimerRef.current = null
    }
    if (!draftDirtyRef.current) return
    emitDraft()
  }, [emitDraft])

  const scheduleDraft = useCallback(() => {
    draftDirtyRef.current = true
    if (draftTimerRef.current) return
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null
      emitDraft()
    }, DRAFT_THROTTLE_MS)
  }, [emitDraft])


  const clearSelection = useCallback(() => setSelectedIds([]), [])
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }, [])

  /** Batch ops on the multi-selection. */
  const batchTransform = useCallback(
    (update: { type: string; props?: Record<string, unknown> }) => {
      const blocks = editor.document.filter((b) => selectedIds.includes(b.id))
      if (blocks.length === 0) return
      try {
        for (const block of blocks) {
          editor.updateBlock(block, update as never)
        }
        scheduleDraft()
      } catch {
        // ignore — some blocks may reject the transform
      }
      clearSelection()
    },
    [editor, selectedIds, scheduleDraft, clearSelection],
  )
  const batchDelete = useCallback(() => {
    const blocks = editor.document.filter((b) => selectedIds.includes(b.id))
    if (blocks.length === 0) return
    try {
      editor.removeBlocks(blocks)
      scheduleDraft()
    } catch {
      // ignore
    }
    clearSelection()
  }, [editor, selectedIds, scheduleDraft, clearSelection])

  // Visual selection: reflect selected ids onto block DOM (class-based).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root
      .querySelectorAll('.kb-multiselect')
      .forEach((el) => el.classList.remove('kb-multiselect'))
    for (const id of selectedIds) {
      const el =
        root.querySelector(`[data-id="${id}"]`) ??
        root.querySelector(`#${CSS.escape(id)}`)
      el?.classList.add('kb-multiselect')
    }
  }, [selectedIds])

  // Stable refs for effects that must not re-register when selection changes.
  const clearSelectionRef = useRef(clearSelection)
  clearSelectionRef.current = clearSelection
  const batchDeleteRef = useRef(batchDelete)
  batchDeleteRef.current = batchDelete
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds

  const openWikiPickerNearCaret = useCallback(() => {
    try {
      const block = editor.getTextCursorPosition().block
      const local = blockPlainText(block)
      const localQ = wikiLinkQueryAt(local, local.length)
      const anchor = coordsAtPos(editor)
      if (localQ) {
        setWikiPicker({
          query: localQ.query,
          from: localQ.from,
          to: localQ.to,
          anchor,
        })
        return
      }
      setWikiPicker({
        query: '',
        from: local.length,
        to: local.length,
        anchor,
      })
    } catch {
      // ignore
    }
  }, [editor])

  const getSlashItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      return buildKnowledgeSlashItems(
        slashEditor,
        {
          labelFor: (id, fallback) =>
            t(slashItemLabelKey(id as KnowledgeSlashId), { defaultValue: fallback }),
          groupLabelFor: (group, fallback) =>
            t(slashGroupLabelKey(group as 'basic'), { defaultValue: fallback }),
          onRequestAttach: () => onRequestAttachRef.current?.(),
          onWikiInsert: () => {
            window.setTimeout(() => openWikiPickerNearCaret(), 0)
          },
          onCreateSubdoc: () => onCreateSubdocRef.current?.(),
          onCopyPageLink: () => onCopyPageLinkRef.current?.(),
        },
        query,
      )
    },
    [slashEditor, t, openWikiPickerNearCaret],
  )

  const scrollToHeading = useCallback(
    (text: string, occurrence = 0): boolean => {
      try {
        const target = text.trim()
        let seen = 0
        for (const block of editor.document) {
          if (block.type !== 'heading') continue
          const label = blockPlainText(block).trim()
          if (label !== target) continue
          if (seen === occurrence) {
            const el =
              typeof document !== 'undefined'
                ? document.getElementById(block.id)
                : null
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              try {
                editor.setTextCursorPosition(block, 'start')
              } catch {
                // ignore
              }
              return true
            }
            const root = rootRef.current
            if (root) {
              const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6')
              let n = 0
              for (const h of headings) {
                if ((h.textContent ?? '').trim() !== target) continue
                if (n === occurrence) {
                  ;(h as HTMLElement).scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  })
                  return true
                }
                n += 1
              }
            }
            return false
          }
          seen += 1
        }
      } catch {
        return false
      }
      return false
    },
    [editor],
  )

  const getSelectionText = useCallback((): string => {
    try {
      const sel = window.getSelection()?.toString() ?? ''
      if (sel.trim()) return sel
      const block = editor.getTextCursorPosition().block
      return blockPlainText(block)
    } catch {
      return ''
    }
  }, [editor])

  useImperativeHandle(
    ref,
    () => ({
      insertMarkdown: (md: string) => {
        try {
          const prepared = preParseMdForLive(md)
          const blocks = editor.tryParseMarkdownToBlocks(prepared)
          if (blocks.length === 0) return false
          const cursor = editor.getTextCursorPosition()
          editor.insertBlocks(blocks, cursor.block, 'after')
          scheduleDraft()
          return true
        } catch {
          return false
        }
      },
      focus: (opts) => {
        try {
          if (opts?.at === 'end') {
            const last = editor.document[editor.document.length - 1]
            if (last) editor.setTextCursorPosition(last, 'end')
          } else {
            const first = editor.document[0]
            if (first) editor.setTextCursorPosition(first, 'start')
          }
          editor.focus()
          return true
        } catch {
          return false
        }
      },
      flushDraft,
      scrollToHeading,
      getSelectionText,
    }),
    [editor, flushDraft, scheduleDraft, scrollToHeading, getSelectionText],
  )

  // Keymap: save, find, block ops, headings
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next && root.contains(next)) return
      window.setTimeout(() => {
        if (!root.contains(document.activeElement)) {
          flushDraft()
          onBlurRef.current?.()
        }
      }, 0)
    }

    const onMouseDownOutside = (e: MouseEvent) => {
      if (selectedIdsRef.current.length === 0) return
      const target = e.target as Element | null
      if (!target) return
      if (
        target.closest('.kb-multiselect') ||
        target.closest('[data-testid="kb-multiselect-bar"]')
      ) {
        return
      }
      clearSelectionRef.current()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const mod = e.metaKey || e.ctrlKey

      // Multi-select: Esc clears; Backspace/Delete batch-deletes.
      const hasSelection = selectedIdsRef.current.length > 0
      if (hasSelection) {
        if (e.key === 'Escape') {
          e.preventDefault()
          clearSelectionRef.current()
          return
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          batchDeleteRef.current()
          return
        }
      }

      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindReplace(Boolean(e.altKey))
        setFindOpen(true)
        return
      }

      if (mod && e.key === 's') {
        e.preventDefault()
        flushDraft()
        onSaveRef.current?.()
        return
      }

      const keymapEditor = editor as unknown as BlockKeymapEditor
      if (handleBlockKeydown(e, keymapEditor)) {
        scheduleDraft()
        return
      }

      // Heading shortcuts Mod-Alt-1/2/3
      if (mod && e.altKey && !e.shiftKey) {
        const level =
          e.key === '1' || e.code === 'Digit1'
            ? 1
            : e.key === '2' || e.code === 'Digit2'
              ? 2
              : e.key === '3' || e.code === 'Digit3'
                ? 3
                : 0
        if (level) {
          e.preventDefault()
          try {
            const block = editor.getTextCursorPosition().block
            editor.updateBlock(block, {
              type: 'heading',
              props: { level },
            })
            scheduleDraft()
          } catch {
            // ignore
          }
        }
      }
      if (mod && e.shiftKey) {
        const k = e.key.toLowerCase()
        try {
          if (k === '8' || e.code === 'Digit8') {
            e.preventDefault()
            editor.updateBlock(editor.getTextCursorPosition().block, {
              type: 'bulletListItem',
            })
            scheduleDraft()
          } else if (k === '7' || e.code === 'Digit7') {
            e.preventDefault()
            editor.updateBlock(editor.getTextCursorPosition().block, {
              type: 'numberedListItem',
            })
            scheduleDraft()
          } else if (k === '.' || e.code === 'Period') {
            e.preventDefault()
            editor.updateBlock(editor.getTextCursorPosition().block, {
              type: 'quote',
            })
            scheduleDraft()
          }
        } catch {
          // ignore
        }
      }
    }

    root.addEventListener('focusout', onFocusOut)
    root.addEventListener('keydown', onKeyDown)
    root.addEventListener('mousedown', onMouseDownOutside)
    return () => {
      root.removeEventListener('focusout', onFocusOut)
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('mousedown', onMouseDownOutside)
    }
  }, [editor, flushDraft, scheduleDraft])

  // Wiki [[ detection + Mod+Click navigate (inline range)
  // + inline math $…$ auto-convert (keyup).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const maybeConvertInlineMath = () => {
      try {
        const block = editor.getTextCursorPosition().block
        const content = block.content as unknown
        if (!Array.isArray(content)) return
        if (
          content.some(
            (c) =>
              typeof c === 'object' &&
              c !== null &&
              (c as { type?: string }).type === 'mathInline',
          )
        ) {
          return
        }
        const text = blockPlainText(block)
        if (!hasInlineMath(text)) return
        const segments: InlineMathSegment[] = splitInlineMath(text)
        if (!segments.some((s) => s.type === 'mathInline')) return
        const rebuilt = segments.map((s) =>
          s.type === 'text'
            ? { type: 'text' as const, text: s.text, styles: {} }
            : { type: 'mathInline' as const, props: { src: s.src } },
        )
        editor.updateBlock(block, { content: rebuilt })
        scheduleDraft()
      } catch {
        // ignore — conversion is best-effort
      }
    }

    const syncWikiQuery = () => {
      try {
        const block = editor.getTextCursorPosition().block
        const local = blockPlainText(block)
        const localQ = wikiLinkQueryAt(local, local.length)
        if (localQ) {
          setWikiPicker({
            query: localQ.query,
            from: localQ.from,
            to: localQ.to,
            anchor: coordsAtPos(editor),
          })
          return
        }
        setWikiPicker(null)
      } catch {
        // ignore
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.isComposing) return
      syncWikiQuery()
      maybeConvertInlineMath()
    }

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      // Chip path
      const chip = target.closest('[data-testid="knowledge-wiki-chip"]') as HTMLElement | null
      if (chip) {
        if (!(e.metaKey || e.ctrlKey)) return
        const title = chip.getAttribute('data-wiki-title')?.trim() ?? ''
        if (!title) return
        e.preventDefault()
        e.stopPropagation()
        const docs = listDocsInTreeOrder(wikiNodesRef.current ?? [])
        const resolved = resolveWikiTitle(title, docs)
        onWikiNavigateRef.current?.({
          title,
          nodeId: resolved?.id ?? null,
          broken: !resolved,
        })
        return
      }

      // Text range detection for plain [[title]]
      if (!(e.metaKey || e.ctrlKey)) return
      try {
        const sel = document.caretRangeFromPoint?.(e.clientX, e.clientY)
        const textNode = sel?.startContainer
        const offset = sel?.startOffset ?? 0
        const text =
          textNode?.nodeType === Node.TEXT_NODE
            ? textNode.textContent ?? ''
            : (target.textContent ?? '')
        // Find wiki token containing offset
        const re = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g
        let m: RegExpExecArray | null
        while ((m = re.exec(text))) {
          const start = m.index
          const end = start + m[0].length
          if (offset >= start && offset <= end) {
            const title = m[1]!.trim()
            e.preventDefault()
            e.stopPropagation()
            const docs = listDocsInTreeOrder(wikiNodesRef.current ?? [])
            const resolved = resolveWikiTitle(title, docs)
            onWikiNavigateRef.current?.({
              title,
              nodeId: resolved?.id ?? null,
              broken: !resolved,
            })
            return
          }
        }
      } catch {
        // ignore
      }
    }

    root.addEventListener('keyup', onKeyUp)
    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('keyup', onKeyUp)
      root.removeEventListener('click', onClick)
    }
  }, [editor])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onPaste = (event: ClipboardEvent) => {
      const sid = spaceIdRef.current
      if (!sid || !event.clipboardData) return
      // V2-E1 块引用粘贴：`hip://doc/<nodeId>#<blockId>` → `[[title#blockId]]`。
      const text = event.clipboardData.getData('text/plain')
      if (text) {
        const refs = [...text.matchAll(/hip:\/\/doc\/([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)/g)]
        if (refs.length > 0) {
          const nodes = wikiNodesRef.current ?? []
          let converted = text
          for (const m of refs) {
            const node = nodes.find((n) => n.id === m[1])
            if (!node) continue
            converted = converted.replace(
              m[0],
              `[[${node.title}#${m[2]}]]`,
            )
          }
          if (converted !== text) {
            event.preventDefault()
            try {
              const prepared = preParseMdForLive(converted)
              const blocks = editor.tryParseMarkdownToBlocks(prepared)
              const cursor = editor.getTextCursorPosition()
              editor.insertBlocks(blocks, cursor.block, 'after')
              scheduleDraft()
            } catch {
              // ignore
            }
            return
          }
        }
      }
      const items = event.clipboardData.items
      if (!items?.length) return
      void (async () => {
        const res = await importAssetFromClipboardItems(sid, items)
        if (!res) return
        if (!res.ok) {
          onAssetImportErrorRef.current?.(res.reason)
          return
        }
        event.preventDefault()
        onAssetImportedRef.current?.()
        try {
          const prepared = preParseMdForLive(res.markdown)
          const blocks = editor.tryParseMarkdownToBlocks(prepared)
          const cursor = editor.getTextCursorPosition()
          editor.insertBlocks(blocks, cursor.block, 'after')
          scheduleDraft()
        } catch {
          // ignore
        }
      })()
    }
    root.addEventListener('paste', onPaste, true)
    return () => root.removeEventListener('paste', onPaste, true)
  }, [editor, scheduleDraft])

  const onWikiPick = useCallback(
    (title: string) => {
      if (!wikiPicker) return
      try {
        const block = editor.getTextCursorPosition().block
        const text = blockPlainText(block)
        const q = wikiLinkQueryAt(text, text.length)
        if (q) {
          const before = text.slice(0, q.from)
          const after = text.slice(q.to)
          const needsClose = !after.startsWith(']]')
          const insert = needsClose ? `${title}]]` : title
          const next = before + insert + after
          // Prefer wikiLink inline when block is empty-ish after insert
          const onlyWiki = next.trim() === formatWikiLink(title)
          if (onlyWiki) {
            editor.updateBlock(block, {
              type: 'paragraph',
              content: [
                {
                  type: 'wikiLink',
                  props: { title, alias: '' },
                },
              ],
            } as never)
          } else {
            editor.updateBlock(block, {
              type: 'paragraph',
              content: next,
            } as never)
          }
        } else {
          editor.updateBlock(block, {
            type: 'paragraph',
            content: [
              {
                type: 'wikiLink',
                props: { title, alias: '' },
              },
            ],
          } as never)
        }
        scheduleDraft()
      } catch {
        // ignore
      }
      setWikiPicker(null)
      try {
        editor.focus()
      } catch {
        // ignore
      }
    },
    [editor, scheduleDraft, wikiPicker],
  )

  return (
    <KnowledgeEditorHostContext.Provider value={hostValue}>
      <div
        ref={rootRef}
        className="knowledge-blocknote-editor knowledge-doc-inline-pad flex min-h-0 w-full flex-1 flex-col overflow-y-auto"
        data-testid="knowledge-doc-live-editor"
        data-code-block-theme={codeBlockThemePref}
        style={codeBlockStyle}
      >
        {losses.length > 0 ? (
          <div
            className="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-meta text-ink-secondary"
            data-testid="knowledge-doc-loss-banner"
            role="status"
          >
            <span className="mr-1.5 font-medium">
              {t('knowledge.doc.dialectLoss')}
            </span>
            <span className="font-mono">{losses.join(', ')}</span>
            <span className="ml-1.5 text-ink-tertiary">
              {t('knowledge.doc.dialectLossHint')}
            </span>
          </div>
        ) : null}
        {selectedIds.length > 0 ? (
          <div
            className="flex shrink-0 items-center gap-1 border-b border-border/70 bg-surface px-3 py-1.5 text-meta"
            data-testid="kb-multiselect-bar"
          >
            <span className="mr-1 font-medium text-ink-secondary" data-testid="kb-multiselect-count">
              {t('knowledge.doc.multiSelectCount', { count: selectedIds.length })}
            </span>
            <button
              type="button"
              className="rounded-sm px-2 py-0.5 text-ink hover:bg-state-hover"
              data-testid="kb-multiselect-to-paragraph"
              onClick={() => batchTransform({ type: 'paragraph' })}
            >
              {t('knowledge.doc.multiSelectParagraph')}
            </button>
            <button
              type="button"
              className="rounded-sm px-2 py-0.5 text-ink hover:bg-state-hover"
              data-testid="kb-multiselect-to-heading"
              onClick={() =>
                batchTransform({ type: 'heading', props: { level: 2 } })
              }
            >
              {t('knowledge.doc.multiSelectHeading')}
            </button>
            <button
              type="button"
              className="rounded-sm px-2 py-0.5 text-ink hover:bg-state-hover"
              data-testid="kb-multiselect-to-quote"
              onClick={() => batchTransform({ type: 'quote' })}
            >
              {t('knowledge.doc.multiSelectQuote')}
            </button>
            <button
              type="button"
              className="ml-auto rounded-sm px-2 py-0.5 text-danger hover:bg-danger/10"
              data-testid="kb-multiselect-delete"
              onClick={batchDelete}
            >
              {t('knowledge.doc.multiSelectDelete')}
            </button>
            <button
              type="button"
              className="rounded-sm px-1.5 py-0.5 text-ink-tertiary hover:bg-state-hover"
              data-testid="kb-multiselect-clear"
              aria-label={t('common.clear')}
              onClick={clearSelection}
            >
              ✕
            </button>
          </div>
        ) : null}
        <DocFindBar
          open={findOpen}
          onClose={() => setFindOpen(false)}
          root={rootRef.current}
          enableReplace={findReplace}
        />
        <MantineProvider forceColorScheme={isDark ? 'dark' : 'light'}>
          <BlockNoteView
            editor={editor}
            theme={isDark ? 'dark' : 'light'}
            slashMenu={false}
            formattingToolbar={false}
            sideMenu={false}
            onChange={() => {
              if (skipNextChangeRef.current) return
              scheduleDraft()
            }}
          >
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={getSlashItems}
              suggestionMenuComponent={BlockNoteHipSlashMenu}
            />
            <SideMenuController
              floatingUIOptions={SIDE_MENU_FLOATING_UI}
              sideMenu={() => (
                <KnowledgeSideMenu
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onClearSelection={clearSelection}
                  onCopyBlockLink={(blockId) => {
                    // V2-E1 块引用：`hip://doc/<nodeId>#<blockId>`（粘贴时还原为 wiki 引用）。
                    const link = `hip://doc/${boundDocIdRef.current}#${blockId}`
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => toast.success(t('knowledge.blockRef.linkCopied')))
                      .catch(() => {})
                  }}
                />
              )}
            />
            <FormattingToolbarController
              formattingToolbar={() => (
                /* T9: B/I/U/S + 链接 + 颜色（移除块类型下拉/行内码/清除格式——Notion 气泡风格）。 */
                <FormattingToolbar>
                  <BasicTextStyleButton basicTextStyle="bold" key="bold" />
                  <BasicTextStyleButton basicTextStyle="italic" key="italic" />
                  <BasicTextStyleButton
                    basicTextStyle="underline"
                    key="underline"
                  />
                  <BasicTextStyleButton
                    basicTextStyle="strike"
                    key="strike"
                  />
                  <CreateLinkButton key="createLink" />
                  <ColorStyleButton key="color" />
                </FormattingToolbar>
              )}
            />
          </BlockNoteView>
        </MantineProvider>
        {wikiPicker ? (
          <WikiLinkPicker
            query={wikiPicker.query}
            nodes={wikiNodes ?? []}
            anchor={wikiPicker.anchor}
            onPick={onWikiPick}
            onClose={() => setWikiPicker(null)}
          />
        ) : null}
      </div>
    </KnowledgeEditorHostContext.Provider>
  )
})

DocBlockNoteEditor.displayName = 'DocBlockNoteEditor'

export default DocBlockNoteEditor
