import type { GlobalCommandContext, PaletteGroup } from './buildGlobalCommands'
import { buildGlobalCommandGroups } from './buildGlobalCommands'
import type { GlobalCommand } from './types'
import type { SkillMeta } from '@hip/protocol'
import { insertComposerText, insertComposerTextWhenReady } from './composerBridge'
import { parsePaletteQuery, type PaletteQueryMode } from './queryPrefix'
import i18n from '@/i18n'
import { formatRelativeTime } from '@/lib/datetime'
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
  // Draft-preserving: insert slash token at caret (or append) — do not wipe the composer.
  if (insertComposerText(text)) return
  if (ctx.sessionId) {
    ctx.selectSession(ctx.sessionId)
    const ok = await insertComposerTextWhenReady(text)
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
    slashName: s.name,
    source: 'skill' as const,
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

const KNOWLEDGE_DOC_GROUP = 'knowledge'
const KNOWLEDGE_RECENT_GROUP = 'knowledge-recent'
/** Display cap for the ⌘K recent-docs group (storage cap is RECENT_CAP). */
export const KNOWLEDGE_RECENT_GROUP_LIMIT = 8

function recentItemCommand(
  r: NonNullable<GlobalCommandContext['recentDocs']>[number],
  ctx: GlobalCommandContext,
): GlobalCommand {
  const at = r.at ?? 0
  const when = at > 0 ? formatRelativeTime(at, i18n.language) : ''
  return {
    id: `knowledge-recent-${r.spaceId}-${r.docId}`,
    label: r.title,
    description: [r.spaceName, when].filter(Boolean).join(' · ') || undefined,
    icon: 'history' as const,
    keywords: [r.title, r.spaceName, 'knowledge', 'recent', '最近'],
    group: KNOWLEDGE_RECENT_GROUP,
    run: () => {
      ctx.openKnowledgeDoc?.({
        spaceId: r.spaceId,
        docId: r.docId,
        title: r.title,
        spaceName: r.spaceName,
      })
    },
  }
}

/** 最近 docs group (V2-S1). Empty when no recent docs. */
export function buildKnowledgeRecentDocsGroup(
  ctx: GlobalCommandContext,
  limit = KNOWLEDGE_RECENT_GROUP_LIMIT,
): PaletteGroup | null {
  const recent = ctx.recentDocs ?? []
  if (recent.length === 0 || !ctx.labels.groupRecentDocs) return null
  const items = recent.slice(0, limit).map((r) => recentItemCommand(r, ctx))
  return { id: KNOWLEDGE_RECENT_GROUP, heading: ctx.labels.groupRecentDocs, items, matchless: true }
}

/**
 * Knowledge docs appear when searching (search-only long tail).
 * Opens via openKnowledgeView + openRecent — never setActiveView alone.
 * V2-S1: emits 最近 (recent docs) + 文档（N） groups; doc Enter carries the
 * search query so the workspace reveals + flashes the match.
 */
export function knowledgeCommandProvider(
  ctx: GlobalCommandContext,
  opts?: { force?: boolean },
): PaletteGroup[] {
  const search = (ctx.search ?? '').trim()
  const groups: PaletteGroup[] = []
  if (!search && !opts?.force) return []

  if (!search) return groups
  if (!ctx.searchKnowledgeDocs) return groups

  if (ctx.knowledgeIndexReady === false) {
    groups.push({
      id: KNOWLEDGE_DOC_GROUP,
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
    })
    return groups
  }

  if (!search) return groups
  const hits = ctx.searchKnowledgeDocs(search).slice(0, 12)
  if (hits.length === 0) return groups

  // Recent docs group rides along only when docs hit (mockup ②: contextual).
  const recentDocs = buildKnowledgeRecentDocsGroup(ctx)
  if (recentDocs) groups.push(recentDocs)

  const items: GlobalCommand[] = hits.map((h) => ({
    id: `knowledge-doc-${h.spaceId}-${h.docId}`,
    label: h.title,
    description:
      [h.spaceName, h.path, h.snippet]
        .filter(Boolean)
        .join(' · ')
        .replace(/\s+/g, ' ') || undefined,
    icon: 'package' as const,
    keywords: [h.title, h.spaceName, h.path, 'knowledge', '知识库', '知識庫'],
    group: KNOWLEDGE_DOC_GROUP,
    run: () => {
      ctx.openKnowledgeDoc?.({
        spaceId: h.spaceId,
        docId: h.docId,
        title: h.title,
        spaceName: h.spaceName,
        query: search,
      })
    },
  }))

  groups.push({
    id: KNOWLEDGE_DOC_GROUP,
    heading: i18n.t('commandPalette.groups.count', {
      group: ctx.labels.groupDocs ?? ctx.labels.groupKnowledge,
      count: items.length,
    }),
    items,
  })
  return groups
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
    skillsCommandProvider(ctxWithSearch, {
      force: mode === 'skills' || mode === 'slash',
    }),
    knowledgeCommandProvider(ctxWithSearch),
    ...extraProviders.map((p) => p(ctxWithSearch)),
  ].flat()
  return mergeGroups(core, extras)
}

export type { SkillMeta }
