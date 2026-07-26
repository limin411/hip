import { useTranslation } from 'react-i18next'
import type { RoundtableEdge } from '@hip/protocol'
import { useFocusStore } from '@/store/focusStore'
import { councilAgentId, type CouncilPersona } from '@/lib/roundtableCouncil'
import { cn } from '@/lib/utils'

const PERSONAS = new Set(['strategist', 'skeptic', 'creative', 'operator', 'audience'])

function labelPersona(
  id: string,
  t: (k: string) => string,
): string {
  if (PERSONAS.has(id)) return t(`chat.roundtable.personas.${id}`)
  if (id.startsWith('roundtable:')) {
    const p = id.slice('roundtable:'.length)
    if (PERSONAS.has(p)) return t(`chat.roundtable.personas.${p}`)
  }
  return id
}

export function CouncilEdges({ edges }: { edges: RoundtableEdge[] }) {
  const { t } = useTranslation()
  const setFocusedAgentId = useFocusStore((s) => s.setFocusedAgentId)
  if (!edges.length) return null

  return (
    <div className="px-1.5" data-testid="council-edges">
      <div className="mb-1 text-caption font-medium text-ink-tertiary">
        {t('chat.roundtable.edgesTitle')}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {edges.map((e, i) => {
          const fromId = PERSONAS.has(e.from)
            ? councilAgentId(e.from as CouncilPersona)
            : e.from
          const rel =
            e.relation === 'rebut'
              ? t('chat.roundtable.edgeRebut')
              : e.relation === 'support'
                ? t('chat.roundtable.edgeSupport')
                : t('chat.roundtable.edgeQuestion')
          return (
            <li key={`${e.round}-${e.from}-${e.to}-${i}`}>
              <button
                type="button"
                className={cn(
                  'w-full rounded-md border border-border/60 bg-surface/40 px-2 py-1.5 text-left text-meta',
                  'hover:bg-state-hover',
                )}
                onClick={() => setFocusedAgentId(fromId)}
                data-testid="council-edge-row"
              >
                <span className="font-medium text-ink">{labelPersona(e.from, t as (k: string) => string)}</span>
                <span className="mx-1 text-ink-tertiary">· R{e.round} ·</span>
                <span className="text-accent-strong">{rel}</span>
                <span className="mx-1 text-ink-tertiary">→</span>
                <span className="font-medium text-ink">{labelPersona(e.to, t as (k: string) => string)}</span>
                {e.summary ? (
                  <div className="mt-0.5 truncate text-caption text-ink-tertiary" title={e.summary}>
                    {e.summary}
                  </div>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
