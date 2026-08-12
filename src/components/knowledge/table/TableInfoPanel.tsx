/**
 * 右侧面板「表格信息」区块（table-right-panel PR-2，spec T2）。
 *
 * 订阅 tableDraft（与编辑器同一草稿）——保存/撤销/编辑即时同步，不新增数据接口。
 * 展示：行×列统计、列类型分布、列结构清单（类型色块 + 列名 + 宽度）。
 * 点击列 → requestTableColumnJump(colId)；TableEditor 消费后滚动定位 + 列头闪烁（PR-3）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CheckSquare, ChevronDown, Hash, Type } from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { csvToTable, type TableColType } from '@/domain/knowledge/tableModel'
import { cn } from '@/lib/utils'

/** Idle debounce so stats do not re-parse on every draft tick（对齐 OUTLINE_BODY_DEBOUNCE_MS）。 */
const INFO_DEBOUNCE_MS = 200

/** 列类型 → 色板（浅底深字，对齐 TableEditor CHIP_STYLES 前 5 组，本地副本避免跨文件耦合）。 */
const STYLE_BY_TYPE: Record<TableColType, { bg: string; fg: string }> = {
  text: { bg: 'rgba(35, 131, 226, 0.14)', fg: '#1d4f91' },
  number: { bg: 'rgba(217, 115, 13, 0.14)', fg: '#8a4a06' },
  checkbox: { bg: 'rgba(95, 173, 73, 0.14)', fg: '#2f6b1f' },
  date: { bg: 'rgba(137, 87, 229, 0.14)', fg: '#5b2fa8' },
  select: { bg: 'rgba(226, 75, 99, 0.14)', fg: '#9c1f36' },
}

const TYPE_ICONS: Record<TableColType, typeof Type> = {
  text: Type,
  number: Hash,
  checkbox: CheckSquare,
  date: CalendarDays,
  select: ChevronDown,
}

export function TableInfoPanel() {
  const { t } = useTranslation()
  const draft = useKnowledgeStore((s) => s.tableDraft)
  const [data, setData] = useState(() =>
    draft ? csvToTable(draft.csv, draft.meta) : null,
  )
  const prevDraftRef = useRef(draft)
  /** 点击定位后该项短暂高亮（0.6s，PR-3 反馈）。 */
  const [flashColId, setFlashColId] = useState<string | null>(null)

  useEffect(() => {
    if (prevDraftRef.current === draft) return
    prevDraftRef.current = draft
    if (!draft) {
      setData(null)
      return
    }
    const id = window.setTimeout(
      () => setData(csvToTable(draft.csv, draft.meta)),
      INFO_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(id)
  }, [draft])

  useEffect(() => {
    if (flashColId == null) return
    const id = window.setTimeout(() => setFlashColId(null), 600)
    return () => window.clearTimeout(id)
  }, [flashColId])

  /** 类型分布（顺序按首现列序）。 */
  const dist = useMemo(() => {
    if (!data) return []
    const m = new Map<TableColType, number>()
    for (const c of data.cols) m.set(c.type, (m.get(c.type) ?? 0) + 1)
    return [...m.entries()]
  }, [data])

  if (!draft || !data) return null

  const isEmpty = data.rows.length === 0

  return (
    <section
      className="flex min-h-0 flex-col gap-3"
      data-testid="knowledge-table-info"
    >
      {isEmpty ? (
        <p
          className="px-1 py-2 text-meta text-ink-tertiary"
          data-testid="table-info-empty"
        >
          {t('knowledge.tableInfo.empty')}
        </p>
      ) : (
        <>
          {/* 统计：行 × 列 */}
          <div
            className="flex items-baseline gap-1.5 px-1"
            data-testid="table-info-stats"
          >
            <span className="text-body font-semibold tabular-nums text-ink">
              {data.rows.length}
            </span>
            <span className="text-meta text-ink-tertiary">
              {t('knowledge.tableInfo.rowsCols', {
                rows: data.rows.length,
                cols: data.cols.length,
              })}
            </span>
          </div>

          {/* 类型分布 */}
          {dist.length > 1 ? (
            <div
              className="flex flex-wrap gap-1 px-1"
              data-testid="table-info-dist"
            >
              {dist.map(([ty, n]) => {
                const st = STYLE_BY_TYPE[ty]
                return (
                  <span
                    key={ty}
                    data-testid={`table-info-dist-${ty}`}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption font-medium"
                    style={{ backgroundColor: st.bg, color: st.fg }}
                  >
                    {t(`knowledge.table.types.${ty}`)}
                    <span className="opacity-70">{n}</span>
                  </span>
                )
              })}
            </div>
          ) : null}

          {/* 列结构清单 */}
          <div
            className="flex min-h-0 flex-col gap-0.5"
            data-testid="table-info-cols"
          >
            {data.cols.map((c, i) => {
              const st = STYLE_BY_TYPE[c.type]
              const Icon = TYPE_ICONS[c.type]
              return (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`table-info-col-${i}`}
                  data-col-id={c.id}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-state-hover',
                    flashColId === c.id && 'bg-state-hover',
                  )}
                  onClick={() => {
                    setFlashColId(c.id)
                    useKnowledgeStore.getState().requestTableColumnJump(c.id)
                  }}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: st.bg, color: st.fg }}
                  >
                    <Icon size={10} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink">
                    {c.name || t('knowledge.table.columnLabel', { n: i + 1 })}
                  </span>
                  <span className="shrink-0 text-caption tabular-nums text-ink-tertiary">
                    {t('knowledge.tableInfo.width', { width: c.width })}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
