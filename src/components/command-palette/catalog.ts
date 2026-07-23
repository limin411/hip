/**
 * Project built-in slash commands into global palette context rows.
 * Single source: `domain/commands/slashBuiltins` + domain handlers.
 */

import {
  formatMemoryStatusBody,
  openMemorySettings,
  runCompact,
  runDiff,
  runInit,
  runPlanOff,
  runPlanOn,
  setIncognito,
  setUseMemories,
  showMemoryStatus,
  toastMemoryFlagChange,
  SLASH_BUILTIN_COMMANDS,
  type ComposerSurface,
} from '@/domain/commands'
import type { GlobalCommand, PaletteIconName } from './types'

/** Minimal ctx for catalog projection (avoids cycle with buildGlobalCommands). */
export type SlashCatalogContext = {
  sessionId: string | null
  labels: {
    settings: { memory: string }
    context: {
      diff: string
      compact: string
      init: string
      plan: string
      planOff: string
      memoryOn: string
      memoryOff: string
      memoryIncognito: string
      memoryIncognitoOff: string
      memoryStatus: string
    }
  }
  memoryStatusCopy: (flags: { use: string; generate: string; incognito: string }) => {
    title: string
    body: string
  }
}

/** Slash ids that appear in the global palette Suggested group. */
const PALETTE_SLASH_IDS = new Set([
  'diff',
  'compact',
  'init',
  'plan',
  'plan-off',
  'memory',
  'memory-on',
  'memory-off',
  'memory-incognito',
  'memory-incognito-off',
  'memory-status',
])

const CONTEXT_BOOST_SESSION = 0.1

type BuiltinPaletteMeta = {
  paletteId: string
  icon: PaletteIconName
  /** Extra keywords beyond slash name */
  keywords: string[]
  contextBoost?: number
  /** Override slash `requiresSession` when palette needs a stricter gate. */
  requiresSession?: boolean
  /** Label key under labels.context or special */
  labelFrom: 'context' | 'settings.memory'
  contextKey?: keyof SlashCatalogContext['labels']['context']
}

const META: Record<string, BuiltinPaletteMeta> = {
  diff: {
    paletteId: 'ctx-diff',
    icon: 'git-branch',
    keywords: ['diff', 'changes', '变更', '變更'],
    contextBoost: CONTEXT_BOOST_SESSION,
    requiresSession: true,
    labelFrom: 'context',
    contextKey: 'diff',
  },
  compact: {
    paletteId: 'ctx-compact',
    icon: 'package',
    keywords: ['compact', 'summarize', '压缩', '壓縮'],
    contextBoost: CONTEXT_BOOST_SESSION,
    labelFrom: 'context',
    contextKey: 'compact',
  },
  init: {
    paletteId: 'ctx-init',
    icon: 'sparkles',
    keywords: ['init', 'initialize', 'agents', 'AGENTS.md', 'project', 'rules', '初始化', '项目指引'],
    contextBoost: CONTEXT_BOOST_SESSION,
    labelFrom: 'context',
    contextKey: 'init',
  },
  plan: {
    paletteId: 'ctx-plan',
    icon: 'sparkles',
    keywords: ['plan', 'planning', 'force plan', '规划', '計畫', '計画'],
    contextBoost: CONTEXT_BOOST_SESSION,
    labelFrom: 'context',
    contextKey: 'plan',
  },
  'plan-off': {
    paletteId: 'ctx-plan-off',
    icon: 'sparkles',
    keywords: ['plan-off', 'exit plan', '规划关闭', '計畫關閉'],
    labelFrom: 'context',
    contextKey: 'planOff',
  },
  memory: {
    paletteId: 'ctx-memory-settings',
    icon: 'brain',
    keywords: ['memory', 'memories', '记忆', '記憶'],
    labelFrom: 'settings.memory',
  },
  'memory-on': {
    paletteId: 'ctx-memory-on',
    icon: 'brain',
    keywords: ['memory', 'enable', 'on', 'inject', '记忆', '記憶'],
    labelFrom: 'context',
    contextKey: 'memoryOn',
  },
  'memory-off': {
    paletteId: 'ctx-memory-off',
    icon: 'brain',
    keywords: ['memory', 'disable', 'off', '记忆', '記憶'],
    labelFrom: 'context',
    contextKey: 'memoryOff',
  },
  'memory-incognito': {
    paletteId: 'ctx-memory-incognito',
    icon: 'brain',
    keywords: ['memory', 'incognito', 'private', '隐身', '隱身'],
    labelFrom: 'context',
    contextKey: 'memoryIncognito',
  },
  'memory-incognito-off': {
    paletteId: 'ctx-memory-incognito-off',
    icon: 'brain',
    keywords: ['memory', 'incognito', 'exit', '退出隐身', '退出隱身'],
    labelFrom: 'context',
    contextKey: 'memoryIncognitoOff',
  },
  'memory-status': {
    paletteId: 'ctx-memory-status',
    icon: 'brain',
    keywords: ['memory', 'status', 'flags', '状态', '狀態'],
    labelFrom: 'context',
    contextKey: 'memoryStatus',
  },
}

function labelFor(ctx: SlashCatalogContext, meta: BuiltinPaletteMeta): string {
  if (meta.labelFrom === 'settings.memory') return ctx.labels.settings.memory
  const key = meta.contextKey!
  return ctx.labels.context[key]
}

function runBuiltin(slashId: string, ctx: SlashCatalogContext): void {
  const sid = ctx.sessionId
  switch (slashId) {
    case 'diff':
      if (sid) runDiff(sid)
      return
    case 'compact':
      if (sid) runCompact(sid)
      return
    case 'init':
      if (sid) runInit(sid)
      return
    case 'plan':
      runPlanOn(sid)
      return
    case 'plan-off':
      runPlanOff(sid)
      return
    case 'memory':
      openMemorySettings()
      return
    case 'memory-on':
      if (!sid) return
      setUseMemories(sid, true)
      toastMemoryFlagChange('useOn')
      return
    case 'memory-off':
      if (!sid) return
      setUseMemories(sid, false)
      toastMemoryFlagChange('useOff')
      return
    case 'memory-incognito':
      if (!sid) return
      setIncognito(sid, true)
      toastMemoryFlagChange('incognitoOn')
      return
    case 'memory-incognito-off':
      if (!sid) return
      setIncognito(sid, false)
      toastMemoryFlagChange('incognitoOff')
      return
    case 'memory-status': {
      if (!sid) return
      const flags = formatMemoryStatusBody(sid)
      if (flags) showMemoryStatus(sid, ctx.memoryStatusCopy(flags))
      return
    }
    default:
      return
  }
}

/**
 * Build Suggested-group items from slash builtins (help/clear omitted).
 * Visibility is left to the caller's `matchesWhen`.
 */
export function buildContextFromSlashCatalog(ctx: SlashCatalogContext): GlobalCommand[] {
  const items: GlobalCommand[] = []
  for (const def of SLASH_BUILTIN_COMMANDS) {
    if (!PALETTE_SLASH_IDS.has(def.id)) continue
    const meta = META[def.id]
    if (!meta) continue

    const surfaces = def.availableIn as ComposerSurface[]
    const requiresSession =
      meta.requiresSession !== undefined
        ? meta.requiresSession
        : Boolean(def.requiresSession)
    items.push({
      id: meta.paletteId,
      label: labelFor(ctx, meta),
      icon: meta.icon,
      keywords: [def.name, ...meta.keywords, def.description],
      group: 'context',
      slashName: def.name,
      source: 'builtin-slash',
      contextBoost: meta.contextBoost,
      when: {
        requiresSession,
        surfaces: surfaces.length > 0 ? [...surfaces] : undefined,
      },
      run: () => runBuiltin(def.id, ctx),
    })
  }
  return items
}
