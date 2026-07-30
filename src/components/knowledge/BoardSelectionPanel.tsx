import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getBoardCanvasStyleApi,
  useKnowledgeStore,
} from '@/store/knowledgeStore'
import type { BoardSelectionSnapshot } from '@/domain/knowledge/boardOutline'
import { cn } from '@/lib/utils'

/**
 * Selection style editors via canvas applyStylePatch / updateText (LKD-10).
 * Never mutates draftBody by parsing JSON.
 */
export function BoardSelectionPanel({
  selection,
}: {
  selection: BoardSelectionSnapshot | null
}) {
  const { t } = useTranslation()
  const ids = selection?.ids ?? []
  const style = selection?.style
  const mixed = style?.mixed

  const [textDraft, setTextDraft] = useState(style?.text ?? '')

  useEffect(() => {
    setTextDraft(style?.text ?? '')
  }, [style?.text, selection?.ids.join('\0')])

  if (ids.length === 0) {
    return (
      <p
        className="px-1 text-meta text-ink-tertiary"
        data-testid="knowledge-board-selection-empty"
      >
        {t('knowledge.board.selectionEmpty')}
      </p>
    )
  }

  const applyPatch = (
    patch: Partial<{
      fill: string
      stroke: string
      strokeWidth: number
      fontSize: 12 | 16 | 24
    }>,
  ) => {
    getBoardCanvasStyleApi()?.applyStylePatch(ids, patch)
  }

  const commitText = () => {
    if (style?.text === undefined) return
    if (mixed?.text) return
    const api = getBoardCanvasStyleApi()
    if (!api) return
    // Single-select text is the common path; multi with same text updates all text ids.
    for (const id of ids) {
      const item = selection?.items.find((it) => it.id === id)
      if (item?.type === 'text') api.updateText(id, textDraft)
    }
  }

  const typeSummary = (() => {
    const counts = new Map<string, number>()
    for (const it of selection?.items ?? []) {
      counts.set(it.type, (counts.get(it.type) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(
        ([ty, n]) =>
          `${n} ${t(`knowledge.board.elementType.${ty}`, { defaultValue: ty })}`,
      )
      .join(' · ')
  })()

  return (
    <div className="flex flex-col gap-2" data-testid="knowledge-board-selection">
      <p className="px-1 text-meta text-ink-secondary" data-testid="knowledge-board-selection-count">
        {t('knowledge.board.selectionCount', { count: ids.length })}
        {typeSummary ? (
          <span className="mt-0.5 block text-caption text-ink-tertiary">{typeSummary}</span>
        ) : null}
      </p>

      {style?.fill !== undefined ? (
        <label className="flex items-center justify-between gap-2 px-1 text-meta">
          <span>{t('knowledge.board.styleFill')}</span>
          <span className="flex items-center gap-1">
            {mixed?.fill ? (
              <span className="text-caption text-ink-tertiary">{t('knowledge.board.styleMixed')}</span>
            ) : null}
            <input
              type="color"
              className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
              value={normalizeColor(style.fill)}
              data-testid="knowledge-board-style-fill"
              onChange={(e) => applyPatch({ fill: e.target.value })}
            />
          </span>
        </label>
      ) : null}

      {style?.stroke !== undefined ? (
        <label className="flex items-center justify-between gap-2 px-1 text-meta">
          <span>{t('knowledge.board.styleStroke')}</span>
          <span className="flex items-center gap-1">
            {mixed?.stroke ? (
              <span className="text-caption text-ink-tertiary">{t('knowledge.board.styleMixed')}</span>
            ) : null}
            <input
              type="color"
              className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
              value={normalizeColor(style.stroke)}
              data-testid="knowledge-board-style-stroke"
              onChange={(e) => applyPatch({ stroke: e.target.value })}
            />
          </span>
        </label>
      ) : null}

      {style?.strokeWidth !== undefined ? (
        <label className="flex items-center justify-between gap-2 px-1 text-meta">
          <span>{t('knowledge.board.styleStrokeWidth')}</span>
          <span className="flex items-center gap-1">
            {mixed?.strokeWidth ? (
              <span className="text-caption text-ink-tertiary">{t('knowledge.board.styleMixed')}</span>
            ) : null}
            <input
              type="number"
              min={0}
              max={32}
              step={1}
              className={cn(
                'h-7 w-16 rounded-md border border-border bg-surface px-1.5 text-meta text-ink',
              )}
              value={style.strokeWidth}
              data-testid="knowledge-board-style-stroke-width"
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                applyPatch({ strokeWidth: Math.max(0, Math.min(32, n)) })
              }}
            />
          </span>
        </label>
      ) : null}

      {style?.fontSize !== undefined ? (
        <label className="flex items-center justify-between gap-2 px-1 text-meta">
          <span>{t('knowledge.board.styleFontSize')}</span>
          <span className="flex items-center gap-1">
            {mixed?.fontSize ? (
              <span className="text-caption text-ink-tertiary">{t('knowledge.board.styleMixed')}</span>
            ) : null}
            <select
              className="h-7 rounded-md border border-border bg-surface px-1.5 text-meta text-ink"
              value={style.fontSize}
              data-testid="knowledge-board-style-font-size"
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v === 12 || v === 16 || v === 24) applyPatch({ fontSize: v })
              }}
            >
              <option value={12}>S 12</option>
              <option value={16}>M 16</option>
              <option value={24}>L 24</option>
            </select>
          </span>
        </label>
      ) : null}

      {style?.text !== undefined && !mixed?.text ? (
        <label className="flex flex-col gap-1 px-1 text-meta">
          <span>{t('knowledge.board.styleText')}</span>
          <textarea
            className={cn(
              'min-h-[4rem] w-full resize-y rounded-md border border-border bg-surface',
              'px-2 py-1.5 font-mono text-meta text-ink',
              'whitespace-pre',
            )}
            value={textDraft}
            data-testid="knowledge-board-style-text"
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={commitText}
          />
        </label>
      ) : null}

      {style?.text !== undefined && mixed?.text ? (
        <p className="px-1 text-caption text-ink-tertiary">{t('knowledge.board.styleMixed')}</p>
      ) : null}
    </div>
  )
}

/** color input requires #rrggbb; fall back to black for named/invalid. */
function normalizeColor(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    const r = c[1]!
    const g = c[2]!
    const b = c[3]!
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return '#111111'
}
