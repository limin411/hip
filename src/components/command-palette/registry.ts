import type { GlobalCommandContext, PaletteGroup } from './buildGlobalCommands'
import { buildGlobalCommandGroups } from './buildGlobalCommands'
import type { GlobalCommand } from './types'
import type { SkillMeta } from '@hip/protocol'
import { goSettingsPage } from '@/domain/commands'
import { insertComposerText } from './composerBridge'

export type CommandProvider = (ctx: GlobalCommandContext) => PaletteGroup[]

const extraProviders: CommandProvider[] = []

/** Register an extra provider; returns unregister. */
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

/**
 * Skills appear only when the user is searching (long-tail).
 * Prefer composer insert; fall back to Skills settings.
 */
export function skillsCommandProvider(ctx: GlobalCommandContext): PaletteGroup[] {
  const search = (ctx.search ?? '').trim()
  if (!search) return []
  const skills = ctx.skills ?? []
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
      if (!insertComposerText(text)) {
        goSettingsPage('skill')
      }
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

/** Core builder + registered providers. */
export function buildAllGroups(
  ctx: GlobalCommandContext,
  opts?: { search?: string },
): PaletteGroup[] {
  const search = opts?.search ?? ctx.search ?? ''
  const ctxWithSearch: GlobalCommandContext = { ...ctx, search }
  const core = buildGlobalCommandGroups(ctxWithSearch, { search })
  const extras = [
    skillsCommandProvider(ctxWithSearch),
    ...extraProviders.map((p) => p(ctxWithSearch)),
  ].flat()
  return mergeGroups(core, extras)
}

export type { SkillMeta }
