import type { GlobalCommandContext, PaletteGroup } from './buildGlobalCommands'
import { buildGlobalCommandGroups } from './buildGlobalCommands'
import type { GlobalCommand } from './types'
import type { SkillMeta } from '@hip/protocol'
import { replaceComposerText, replaceComposerTextWhenReady } from './composerBridge'
import { parsePaletteQuery, type PaletteQueryMode } from './queryPrefix'
import i18n from '@/i18n'
import { toast } from 'sonner'

export type CommandProvider = (ctx: GlobalCommandContext) => PaletteGroup[]

const extraProviders: CommandProvider[] = []

/** Register an extra provider; returns unregister. See README.md. */
export function registerCommandProvider(provider: CommandProvider): () => void {
  extraProviders.push(provider)
  return () => {
    const i = extraProviders.indexOf(provider)
    if (i >= 0) extraProviders.splice(i, 1)
  }
}

/** Test helper: clear all extra providers. */
export function clearCommandProviders(): void {
  extraProviders.length = 0
}

function mergeGroups(base: PaletteGroup[], extra: PaletteGroup[]): PaletteGroup[] {
  const byKey = new Map<string, PaletteGroup>()
  const order: string[] = []

  const keyOf = (g: PaletteGroup, i: number) => g.id ?? g.heading ?? `g-${i}`

  for (let i = 0; i < base.length; i++) {
    const g = base[i]!
    const k = keyOf(g, i)
    order.push(k)
    byKey.set(k, { ...g, items: [...g.items] })
  }
  for (let i = 0; i < extra.length; i++) {
    const g = extra[i]!
    const k = keyOf(g, base.length + i)
    const existing = byKey.get(k)
    if (existing) {
      existing.items.push(...g.items)
    } else {
      order.push(k)
      byKey.set(k, { ...g, items: [...g.items] })
    }
  }
  return order.map((k) => byKey.get(k)!).filter(Boolean)
}

/** Missing map entry → enabled (same default as settings UI). */
export function isSkillEnabled(id: string, enabled?: Record<string, boolean>): boolean {
  if (!enabled) return true
  return enabled[id] !== false
}

/**
 * Insert skill slash token into the composer.
 * If the composer is not mounted but a session is known, switch to it and retry.
 * Never silently opens Settings.
 */
export async function runSkillHandoff(
  skillName: string,
  ctx: Pick<GlobalCommandContext, 'sessionId' | 'selectSession'>,
): Promise<void> {
  const text = `/${skillName} `
  // Skill handoff intentionally *replaces* the composer so the slash token is the full draft.
  if (replaceComposerText(text)) return
  if (ctx.sessionId) {
    ctx.selectSession(ctx.sessionId)
    const ok = await replaceComposerTextWhenReady(text)
    if (ok) return
  }
  toast.message(i18n.t('commandPalette.skills.needComposer'))
}

/**
 * Skills appear when searching or when mode is `@` (skills-only).
 * Prefer composer insert; if no inserter, toast — never silent-open Settings.
 */
export function skillsCommandProvider(
  ctx: GlobalCommandContext,
  opts?: { force?: boolean },
): PaletteGroup[] {
  const search = (ctx.search ?? '').trim()
  if (!search && !opts?.force) return []
  const skills = (ctx.skills ?? []).filter((s) => isSkillEnabled(s.id, ctx.skillsEnabled))
  if (skills.length === 0) return []

  const items: GlobalCommand[] = skills.map((s) => ({
    id: `skill-${s.id}`,
    label: s.name,
    description: s.description || undefined,
    icon: 'sparkles' as const,
    keywords: [s.name, s.description ?? '', 'skill', '技能', s.id].filter(Boolean),
    group: 'skills' as const,
    run: () => {
      void runSkillHandoff(s.name, ctx)
    },
  }))

  return [
    {
      id: 'skills',
      heading: ctx.labels.groupSkills,
      items,
    },
  ]
}

/**
 * Knowledge docs appear when searching (search-only long tail).
 * Opens via openKnowledgeView + openRecent — never setActiveView alone.
 */
export function knowledgeCommandProvider(
  ctx: GlobalCommandContext,
  opts?: { force?: boolean },
): PaletteGroup[] {
  const search = (ctx.search ?? '').trim()
  if (!search && !opts?.force) return []
  if (!ctx.searchKnowledgeDocs) return []

  if (ctx.knowledgeIndexReady === false) {
    return [
      {
        id: 'knowledge',
        heading: ctx.labels.groupKnowledge,
        items: [
          {
            id: 'knowledge-indexing',
            label: ctx.labels.knowledgeIndexing,
            group: 'knowledge',
            icon: 'package',
            run: () => {},
          },
        ],
      },
    ]
  }

  const hits = ctx.searchKnowledgeDocs(search).slice(0, 12)
  if (hits.length === 0) return []

  const items: GlobalCommand[] = hits.map((h) => ({
    id: `knowledge-doc-${h.spaceId}-${h.docId}`,
    label: h.title,
    description: [h.spaceName, h.path, h.snippet].filter(Boolean).join(' · ') || undefined,
    icon: 'package' as const,
    keywords: [h.title, h.spaceName, h.path, 'knowledge', '知识库', '知識庫'],
    group: 'knowledge' as const,
    run: () => {
      ctx.openKnowledgeDoc?.({
        spaceId: h.spaceId,
        docId: h.docId,
        title: h.title,
        spaceName: h.spaceName,
      })
    },
  }))

  return [
    {
      id: 'knowledge',
      heading: ctx.labels.groupKnowledge,
      items,
    },
  ]
}

export type BuildAllGroupsOpts = {
  search?: string
  /** Pre-parsed mode; if omitted, derived from search. */
  mode?: PaletteQueryMode
}

/** Core builder + registered providers. */
export function buildAllGroups(
  ctx: GlobalCommandContext,
  opts?: BuildAllGroupsOpts,
): PaletteGroup[] {
  const rawSearch = opts?.search ?? ctx.search ?? ''
  const parsed = parsePaletteQuery(rawSearch)
  const mode = opts?.mode ?? parsed.mode
  const needle = parsed.needle

  const ctxWithSearch: GlobalCommandContext = { ...ctx, search: needle }
  const core = buildGlobalCommandGroups(ctxWithSearch, {
    search: needle,
    forceSessions: mode === 'sessions',
  })
  const extras = [
    skillsCommandProvider(ctxWithSearch, { force: mode === 'skills' }),
    knowledgeCommandProvider(ctxWithSearch),
    ...extraProviders.map((p) => p(ctxWithSearch)),
  ].flat()
  return mergeGroups(core, extras)
}

export type { SkillMeta }
