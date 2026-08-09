/**
 * 右侧面板「反向链接」区块（V2-L1 T5.1）。
 * 入链 / 出链 / 断链三组 + 计数，纵向逐节堆叠（非横向 tab）；长列表 >5 条折叠。
 * 区块标题样式与「大纲」一致（caption + 括号计数）。
 * 断链操作：一键创建缺失文档 / 重新指向（复用 WikiLinkPicker）。
 * 编辑态只读（交互仅跳转）。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import { ArrowLeftRight, Plus } from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import type { KnowledgeLinkOutboundRow } from '@/ipc/knowledge'
import {
  listDocsInTreeOrder,
  resolveWikiTitle,
} from '@/domain/knowledge/wikiLink'
import { WikiLinkPicker } from './WikiLinkPicker'

const COLLAPSE_AT = 5

type SectionId = 'inbound' | 'outbound' | 'broken'

interface RowItem {
  key: string
  title: string
  /** Secondary line; omit when it only repeats the title. */
  snippet: string | null
  onClick: () => void
  broken: boolean
  fromDocId: string
  raw: string
}

export function BacklinkPanel() {
  const { t } = useTranslation()
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const backlinks = useKnowledgeStore((s) => s.backlinks)
  const outboundLinks = useKnowledgeStore((s) => s.outboundLinks)
  const brokenLinks = useKnowledgeStore((s) => s.brokenLinks)
  const linkPanelStatus = useKnowledgeStore((s) => s.linkPanelStatus)
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    inbound: false,
    outbound: false,
    broken: false,
  })
  const [repointFor, setRepointFor] = useState<{
    fromDocId: string
    raw: string
  } | null>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({
    top: 120,
    left: 120,
  })

  if (!activeDocId) return null

  /** Same-space leaf open — matches in-editor wiki chips (not openRecent→openSpace). */
  const openDocNav = (docId: string, fragment?: string | null) => {
    const st = useKnowledgeStore.getState()
    const spaceId = st.activeSpaceId
    if (!spaceId) return
    if (fragment) {
      st.setPendingReveal({
        query: fragment,
        spaceId,
        docId,
        fragment,
      })
    }
    void st.openDoc(docId)
  }

  const openOutbound = (o: KnowledgeLinkOutboundRow) => {
    // Markdown URL / path — open externally when not a wiki target.
    if (o.kind === 'md') {
      const href = extractMdLinkHref(o.raw)
      if (href) {
        void openExternalHref(href)
        return
      }
    }

    const st = useKnowledgeStore.getState()
    let docId =
      o.targetDocId && o.targetDocId.trim() ? o.targetDocId.trim() : null

    // Index may lag renames; resolve title against the live tree.
    if (!docId && o.targetTitle?.trim()) {
      const docs = listDocsInTreeOrder(st.nodes)
      docId = resolveWikiTitle(o.targetTitle, docs)?.id ?? null
    }

    // Same-document heading / block: `[[#Intro]]` → empty title + fragment.
    if (!docId && o.fragment && !(o.targetTitle ?? '').trim()) {
      docId = st.activeDocId
    }

    if (docId) {
      openDocNav(docId, o.fragment)
      return
    }

    toast.message(t('knowledge.backlinks.outboundUnresolved'))
  }

  const repair = async (row: { fromDocId: string; raw: string }) => {
    const target = extractBrokenTarget(row.raw)
    if (!target) {
      toast.message(t('knowledge.backlinks.repairNoTarget'))
      return
    }
    const id = await useKnowledgeStore.getState().repairBrokenLink(
      row.fromDocId,
      row.raw,
      target,
    )
    if (id) {
      toast.success(t('knowledge.backlinks.repaired', { title: target }))
      openDocNav(id)
    } else {
      toast.error(t('knowledge.backlinks.repairFailed'))
    }
  }

  const repoint = async (newTarget: string) => {
    if (!repointFor) return
    const ok = await useKnowledgeStore.getState().repointBrokenLink(
      repointFor.fromDocId,
      repointFor.raw,
      newTarget,
    )
    setRepointFor(null)
    if (ok) toast.success(t('knowledge.backlinks.repointed'))
    else toast.error(t('knowledge.backlinks.repointFailed'))
  }

  const toggleExpanded = (id: SectionId) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  const sections: Array<{
    id: SectionId
    label: string
    emptyText: string
    rows: RowItem[]
  }> = [
    {
      id: 'inbound',
      label: t('knowledge.backlinks.inbound'),
      emptyText: t('knowledge.backlinks.emptyInbound'),
      rows: backlinks.map((b) => ({
        key: `${b.fromDocId}-${b.raw}`,
        title: b.fromTitle,
        snippet: b.raw,
        onClick: () => openDocNav(b.fromDocId, b.fragment),
        broken: false,
        fromDocId: b.fromDocId,
        raw: b.raw,
      })),
    },
    {
      id: 'outbound',
      label: t('knowledge.backlinks.outbound'),
      emptyText: t('knowledge.backlinks.emptyOutbound'),
      rows: dedupeOutboundLinks(outboundLinks).map((o, i) => {
        const label = outboundRowLabel(o)
        return {
          key: `${o.kind}-${o.targetDocId ?? o.targetTitle ?? o.raw}-${o.fragment ?? ''}-${i}`,
          title: label.title,
          snippet: label.snippet,
          onClick: () => openOutbound(o),
          broken: false,
          fromDocId: activeDocId,
          raw: o.raw,
        }
      }),
    },
    {
      id: 'broken',
      label: t('knowledge.backlinks.broken'),
      emptyText: t('knowledge.backlinks.emptyBroken'),
      rows: brokenLinks.map((b) => {
        const title = extractBrokenTarget(b.raw) ?? b.raw
        return {
          key: `${b.fromDocId}-${b.raw}`,
          title,
          // `[[Title]]` under Title is noise — only keep when raw adds context.
          snippet: b.raw === title || b.raw === `[[${title}]]` ? null : b.raw,
          onClick: () => undefined,
          broken: true,
          fromDocId: b.fromDocId,
          raw: b.raw,
        }
      }),
    },
  ]

  return (
    <section
      className="flex min-h-0 flex-col gap-3"
      data-testid="knowledge-backlink-panel"
    >
      {linkPanelStatus === 'loading' ? (
        <p className="px-1 py-1 text-meta text-ink-tertiary">
          {t('knowledge.outline.loading')}
        </p>
      ) : (
        sections.map((sec) => {
          const visible = expanded[sec.id]
            ? sec.rows
            : sec.rows.slice(0, COLLAPSE_AT)
          return (
            <div
              key={sec.id}
              className="flex min-h-0 flex-col gap-1"
              data-testid={`knowledge-backlink-section-${sec.id}`}
            >
              <div className="flex items-center gap-1 px-1 pb-1">
                <h4 className="text-caption font-medium text-ink-tertiary">
                  {sec.label}
                  <span
                    className="ml-1 font-normal normal-case text-ink-tertiary"
                    data-testid={`knowledge-backlink-count-${sec.id}`}
                  >
                    ({sec.rows.length})
                  </span>
                </h4>
                {sec.rows.length > COLLAPSE_AT ? (
                  <button
                    type="button"
                    className="ml-auto rounded-md px-1.5 py-0.5 text-caption font-medium text-accent-strong transition-colors hover:bg-state-hover"
                    data-testid={`knowledge-backlink-expand-${sec.id}`}
                    onClick={() => toggleExpanded(sec.id)}
                  >
                    {expanded[sec.id]
                      ? t('knowledge.backlinks.collapse')
                      : t('knowledge.backlinks.expand', { count: sec.rows.length })}
                  </button>
                ) : null}
              </div>
              {sec.rows.length === 0 ? (
                <p
                  className="px-1 py-1 text-meta text-ink-tertiary"
                  data-testid={`knowledge-backlink-empty-${sec.id}`}
                >
                  {sec.emptyText}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {visible.map((row) => (
                    <li key={row.key} className="flex items-center gap-1">
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-state-hover"
                        data-testid={`knowledge-backlink-row-${row.key}`}
                        onClick={row.onClick}
                      >
                        <span className="block truncate text-meta font-medium text-ink">
                          {row.title}
                        </span>
                        {row.snippet ? (
                          <span
                            className="block truncate text-caption text-ink-tertiary"
                            title={row.snippet}
                          >
                            {row.snippet}
                          </span>
                        ) : null}
                      </button>
                      {row.broken ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            className="rounded-md p-1 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-accent"
                            title={t('knowledge.backlinks.createDoc')}
                            aria-label={t('knowledge.backlinks.createDoc')}
                            data-testid={`knowledge-backlink-create-${row.key}`}
                            onClick={() => void repair(row)}
                          >
                            <Plus size={13} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="rounded-md p-1 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-accent"
                            title={t('knowledge.backlinks.repoint')}
                            aria-label={t('knowledge.backlinks.repoint')}
                            data-testid={`knowledge-backlink-repoint-${row.key}`}
                            onClick={(e) => {
                              setAnchor({ top: e.clientY, left: e.clientX })
                              setRepointFor({ fromDocId: row.fromDocId, raw: row.raw })
                            }}
                          >
                            <ArrowLeftRight size={13} aria-hidden />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })
      )}

      {repointFor ? (
        <WikiLinkPicker
          query=""
          nodes={useKnowledgeStore.getState().nodes}
          anchor={anchor}
          onClose={() => setRepointFor(null)}
          onPick={repoint}
        />
      ) : null}
    </section>
  )
}

/** `[[目标]]` / `[[目标|别名]]` / `[[目标#锚]]` → 目标标题；其他 raw 返回 null。 */
export function extractBrokenTarget(raw: string): string | null {
  const m = raw.trim().match(/^\[\[([^\]|#]+?)(?:#|\]\]|\|)/)
  return m?.[1]?.trim() || null
}

/** `[label](dest)` / `![alt](dest)` → dest href. */
export function extractMdLinkHref(raw: string): string | null {
  const m = raw.trim().match(/^!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/)
  const href = m?.[2]?.trim()
  return href || null
}

/**
 * Primary + optional secondary label for an outbound row.
 * Avoids the old “Title / [[Title]]” double line when both say the same thing.
 */
export function outboundRowLabel(o: KnowledgeLinkOutboundRow): {
  title: string
  snippet: string | null
} {
  const display = o.display?.trim() || ''
  const target = o.targetTitle?.trim() || ''
  const title = display || target || extractBrokenTarget(o.raw) || o.raw

  if (o.kind === 'md') {
    const href = extractMdLinkHref(o.raw)
    if (href && href !== title) return { title, snippet: href }
    return { title, snippet: null }
  }

  // Alias different from target → show real target underneath.
  if (display && target && display !== target) {
    const frag = o.fragment?.trim()
    return { title: display, snippet: frag ? `${target} #${frag}` : target }
  }

  // Fragment-only secondary (same-doc or title#heading already collapsed into title).
  if (o.fragment?.trim()) {
    const frag = o.fragment.trim()
    // Title already ends with the fragment label → skip.
    if (title === frag || title.endsWith(`#${frag}`)) return { title, snippet: null }
    return { title, snippet: `#${frag}` }
  }

  return { title, snippet: null }
}

/** Unique targets for the panel (same doc linked twice → one row). */
export function dedupeOutboundLinks(
  links: readonly KnowledgeLinkOutboundRow[],
): KnowledgeLinkOutboundRow[] {
  const seen = new Set<string>()
  const out: KnowledgeLinkOutboundRow[] = []
  for (const o of links) {
    const key = outboundDedupeKey(o)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(o)
  }
  return out
}

function outboundDedupeKey(o: KnowledgeLinkOutboundRow): string {
  const frag = o.fragment?.trim() ?? ''
  if (o.targetDocId?.trim()) return `${o.kind}|id:${o.targetDocId.trim()}|f:${frag}`
  if (o.targetTitle?.trim()) return `${o.kind}|t:${o.targetTitle.trim()}|f:${frag}`
  if (o.kind === 'md') {
    const href = extractMdLinkHref(o.raw)
    if (href) return `md|href:${href}|f:${frag}`
  }
  return `${o.kind}|r:${o.raw}`
}

async function openExternalHref(href: string): Promise<void> {
  try {
    await openExternal(href)
  } catch {
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}
