import type { GlobalCommandContext, PaletteGroup } from './buildGlobalCommands'
import { buildGlobalCommandGroups } from './buildGlobalCommands'
import type { GlobalCommand } from './types'
import type { SkillMeta } from '@hip/protocol'
import { insertComposerText } from './composerBridge'
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
      const text = `/${s.name} `
      if (insertComposerText(text)) return
      toast.message(i18n.t('commandPalette.skills.needComposer'))
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
    ...extraProviders.map((p) => p(ctxWithSearch)),
  ].flat()
  return mergeGroups(core, extras)
}

export type { SkillMeta }
