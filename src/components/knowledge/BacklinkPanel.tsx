/**
 * 文档底部「反向链接」面板（V2-L1 T5.1）。
 * 入链 / 出链 / 断链三组 + 计数 + 页签；长列表 >5 条折叠。
 * 断链操作：一键创建缺失文档 / 重新指向（复用 WikiLinkPicker）。
 * 编辑态只读（交互仅跳转）。
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeftRight, Link2, Plus, RefreshCw } from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { WikiLinkPicker } from './WikiLinkPicker'
import { cn } from '@/lib/utils'

const COLLAPSE_AT = 5

type TabId = 'inbound' | 'outbound' | 'broken'

export function BacklinkPanel() {
  const { t } = useTranslation()
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const backlinks = useKnowledgeStore((s) => s.backlinks)
  const outboundLinks = useKnowledgeStore((s) => s.outboundLinks)
  const brokenLinks = useKnowledgeStore((s) => s.brokenLinks)
  const linkPanelStatus = useKnowledgeStore((s) => s.linkPanelStatus)
  const [tab, setTab] = useState<TabId>('inbound')
  const [expanded, setExpanded] = useState(false)
  const [repointFor, setRepointFor] = useState<{
    fromDocId: string
    raw: string
  } | null>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({
    top: 120,
    left: 120,
  })

  const counts = useMemo(
    () => ({
      inbound: backlinks.length,
      outbound: outboundLinks.length,
      broken: brokenLinks.length,
    }),
    [backlinks, outboundLinks, brokenLinks],
  )

  if (!activeDocId) return null

  const openDoc = (docId: string, fragment?: string | null) => {
    const st = useKnowledgeStore.getState()
    const spaceId = st.activeSpaceId
    if (!spaceId) return
    if (fragment) {
      st.setPendingReveal({ query: fragment, spaceId, docId, fragment })
    }
    void st.openRecent({
      spaceId,
      docId,
      title: st.nodes.find((n) => n.id === docId)?.title ?? '',
      spaceName: st.spaces.find((s) => s.id === spaceId)?.name ?? '',
      at: Date.now(),
    })
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
      openDoc(id)
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

  const tabs: Array<{ id: TabId; label: string; count: number }> = [
    { id: 'inbound', label: t('knowledge.backlinks.inbound'), count: counts.inbound },
    { id: 'outbound', label: t('knowledge.backlinks.outbound'), count: counts.outbound },
    { id: 'broken', label: t('knowledge.backlinks.broken'), count: counts.broken },
  ]
  const activeTab = tab

  const list =
    activeTab === 'inbound'
      ? backlinks.map((b) => ({
          key: `${b.fromDocId}-${b.raw}`,
          title: b.fromTitle,
          snippet: b.raw,
          onClick: () => openDoc(b.fromDocId, b.fragment),
          broken: false,
          fromDocId: b.fromDocId,
          raw: b.raw,
        }))
      : activeTab === 'outbound'
        ? outboundLinks.map((o, i) => ({
            key: `${o.raw}-${i}`,
            title: o.targetTitle ?? o.raw,
            snippet: o.raw,
            onClick: () => (o.targetDocId ? openDoc(o.targetDocId, o.fragment) : undefined),
            broken: false,
            fromDocId: activeDocId,
            raw: o.raw,
          }))
        : brokenLinks.map((b) => ({
            key: `${b.fromDocId}-${b.raw}`,
            title: extractBrokenTarget(b.raw) ?? b.raw,
            snippet: b.raw,
            onClick: () => undefined,
            broken: true,
            fromDocId: b.fromDocId,
            raw: b.raw,
          }))

  const visible = expanded ? list : list.slice(0, COLLAPSE_AT)

  return (
    <section
      className="knowledge-doc-inline-pad pb-8 pt-2"
      data-testid="knowledge-backlink-panel"
    >
      <div className="knowledge-doc-measure rounded-lg border border-border bg-surface-muted/50">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <Link2 size={13} className="mr-1 text-ink-tertiary" aria-hidden />
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              data-testid={`knowledge-backlink-tab-${tb.id}`}
              disabled={tb.count === 0 && activeTab !== tb.id}
              onClick={() => {
                setTab(tb.id)
                setExpanded(false)
              }}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-meta transition-colors',
                activeTab === tb.id
                  ? 'bg-surface font-medium text-ink shadow-sm'
                  : 'text-ink-tertiary hover:bg-state-hover hover:text-ink',
                tb.count === 0 && activeTab !== tb.id && 'opacity-40',
              )}
            >
              {tb.label}
              <span
                className="rounded-full bg-surface-muted px-1.5 text-caption"
                data-testid={`knowledge-backlink-count-${tb.id}`}
              >
                {tb.count}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="ml-auto rounded-md p-1 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
            aria-label={t('knowledge.backlinks.refresh')}
            data-testid="knowledge-backlink-refresh"
            onClick={() => void useKnowledgeStore.getState().refreshLinkPanel()}
          >
            <RefreshCw size={12} aria-hidden />
          </button>
        </div>

        <div className="px-2 py-1.5">
          {linkPanelStatus === 'loading' ? (
            <p className="py-2 text-meta text-ink-tertiary">{t('knowledge.outline.loading')}</p>
          ) : list.length === 0 ? (
            <p className="py-2 text-meta text-ink-tertiary" data-testid="knowledge-backlink-panel-empty">
              {activeTab === 'inbound'
                ? t('knowledge.backlinks.emptyInbound')
                : activeTab === 'outbound'
                  ? t('knowledge.backlinks.emptyOutbound')
                  : t('knowledge.backlinks.emptyBroken')}
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
                    <span
                      className="block truncate text-caption text-ink-tertiary"
                      title={row.snippet}
                    >
                      {row.snippet}
                    </span>
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
          {list.length > COLLAPSE_AT ? (
            <button
              type="button"
              className="mt-1 rounded-md px-2 py-1 text-meta text-accent-strong transition-colors hover:bg-state-hover"
              data-testid="knowledge-backlink-expand"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t('knowledge.backlinks.collapse') : t('knowledge.backlinks.expand')}
            </button>
          ) : null}
        </div>
      </div>

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
