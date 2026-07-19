/**
 * Single source of truth: map (surface × permissionMode) → runtime profile
 * used by system prompt, injectors, and tool assembly.
 *
 * Surface owns persona / prompt body / skills.
 * Permission mode owns tool capability / path jail.
 */
import type { PermissionMode, SkillMeta } from '@hip/protocol'
import { CODING_SKILL_ID } from './ops/content.js'
import { HIP_SKILL_ID, PRODUCT_CAPABILITY_MAP } from './product/content.js'
import { surfaceOf } from './surface.js'

export type ProductSurface = 'chat' | 'code' | 'knowledge'

export interface AgentRuntimeProfile {
  surface: ProductSurface
  /** Protocol permission mode after normalize. */
  permissionMode: PermissionMode
  /**
   * Model-facing capability sentence.
   * Never the bare token "edit" alone — that caused Chat to self-identify as edit mode.
   */
  capabilityNarrative: string
  /** Which always-on body `buildSystemPrompt` should use. */
  promptBody: 'chat' | 'code' | 'knowledge'
  includeGitGuidance: boolean
  includeMcpCatalog: boolean
  skillPolicy: {
    pinIds: string[]
    excludeIds: string[]
  }
  toolPolicy: {
    allowWrites: boolean
    allowGit: boolean
    allowRunScript: boolean
    allowPluginInstall: boolean
    allowParallelWorktrees: boolean
    pathJail: 'sandbox' | 'none' | 'n/a'
  }
}

export interface ResolveAgentRuntimeProfileInput {
  surface?: 'chat' | 'code' | 'knowledge'
  permissionMode?: PermissionMode
  sessionId?: string
  cwd?: string
  /** hip data root for legacy scratch-cwd surface inference */
  hipRoot?: string
}

function normalizePermissionMode(mode: PermissionMode | undefined): PermissionMode {
  return mode === 'chat' || mode === 'full' ? mode : 'edit'
}

function resolveSurface(input: ResolveAgentRuntimeProfileInput): ProductSurface {
  if (input.surface === 'knowledge') return 'knowledge'
  if (input.surface === 'chat' || input.surface === 'code') return input.surface
  // Legacy / missing: infer chat from scratch cwd when sessionId known; else code.
  if (input.sessionId) {
    return surfaceOf(
      { surface: undefined, cwd: input.cwd },
      input.sessionId,
      input.hipRoot,
    )
  }
  return 'code'
}

/** Surface-filtered L0 product facts (avoids unqualified "edit = default" on Chat). */
export function productCapabilityMapForSurface(surface: ProductSurface): string {
  if (surface === 'chat') {
    return (
      'Product facts (hip):\n' +
      '- Version: 0.1.0.\n' +
      '- You are on the **Chat** surface: a lighter assistant with a private sandbox workspace.\n' +
      '- Previewable deliverables (HTML, images, PDF, Markdown) → write with write_file for artifacts preview.\n' +
      '- You are **not** on the Code workbench and must not claim to be in Code "edit mode".\n' +
      '- Code surface (not this session) has permission modes: chat = read-only; edit = project sandbox; full = whole FS.\n' +
      '- API keys: ~/.hip/config/auth.json (0600 plaintext by design).\n' +
      '- Cross-session memory: off by default (Settings → Memory).\n' +
      '- Local data: ~/.hip/ (config, db, skills, plugins, logs).'
    )
  }
  if (surface === 'knowledge') {
    return (
      'Product facts (hip):\n' +
      '- Version: 0.1.0.\n' +
      '- You are on the **Knowledge** surface: help with the user\'s notes spaces.\n' +
      '- Do not claim to be a coding agent editing a software project unless the user opens Code.\n' +
      '- API keys: ~/.hip/config/auth.json (0600 plaintext by design).\n' +
      '- Local data: ~/.hip/ (config, db, skills, plugins, logs).'
    )
  }
  // Code: ship the SoT L0 map (packages/product-content → content.ts).
  return PRODUCT_CAPABILITY_MAP
}

function capabilityNarrative(surface: ProductSurface, permissionMode: PermissionMode): string {
  if (surface === 'chat') {
    return (
      'You are in **Chat**: a private sandbox workspace. ' +
      'You may write previewable artifacts with write_file when useful. ' +
      'You are **not** in Code edit mode and must not claim to be editing a user project or operating under Code permission modes.'
    )
  }
  if (surface === 'knowledge') {
    return (
      'You are on the **Knowledge** surface: answer from the user\'s notes and open documents. ' +
      'Do not claim to be a coding agent in project edit mode.'
    )
  }
  // Code
  if (permissionMode === 'chat') {
    return (
      'You are on the **Code** surface with **read-only** tools ' +
      '(no write_file, edit_file, or run_script). Inspect the project; do not claim you can edit files.'
    )
  }
  if (permissionMode === 'full') {
    return (
      'You are on the **Code** surface with **full filesystem** access granted by the user ' +
      '(tools are not sandboxed to the project root). Prefer the project cwd unless the task requires otherwise.'
    )
  }
  return (
    'You are on the **Code** surface in the **project sandbox** ' +
    '(writes and paths are jailed to the project root). This is the default Code tool gate — ' +
    'describe it as project sandbox, not bare "edit mode", unless the user asks about permission labels.'
  )
}

/**
 * Resolve the full runtime profile for a turn.
 * Pure except for optional legacy surface inference via `surfaceOf` (fs path checks).
 */
export function resolveAgentRuntimeProfile(input: ResolveAgentRuntimeProfileInput): AgentRuntimeProfile {
  const surface = resolveSurface(input)
  const permissionMode = normalizePermissionMode(input.permissionMode)

  if (surface === 'chat') {
    // Chat keeps sandbox writes for artifacts even when protocol permissionMode is 'edit'.
    // Protocol 'chat' still means read-only if ever set on a Chat session.
    const readOnly = permissionMode === 'chat'
    return {
      surface,
      permissionMode,
      capabilityNarrative: capabilityNarrative('chat', permissionMode),
      promptBody: 'chat',
      includeGitGuidance: false,
      includeMcpCatalog: false,
      skillPolicy: {
        pinIds: [HIP_SKILL_ID],
        excludeIds: [CODING_SKILL_ID],
      },
      toolPolicy: {
        allowWrites: !readOnly,
        allowGit: false,
        // Equivalent to !readOnly && permissionMode !== 'chat' (readOnly ⇔ chat).
        allowRunScript: !readOnly,
        allowPluginInstall: false,
        allowParallelWorktrees: false,
        pathJail: permissionMode === 'full' ? 'none' : 'sandbox',
      },
    }
  }

  if (surface === 'knowledge') {
    const readOnly = permissionMode === 'chat'
    return {
      surface,
      permissionMode,
      capabilityNarrative: capabilityNarrative('knowledge', permissionMode),
      promptBody: 'knowledge',
      includeGitGuidance: false,
      includeMcpCatalog: false,
      skillPolicy: {
        pinIds: [HIP_SKILL_ID],
        excludeIds: [CODING_SKILL_ID],
      },
      toolPolicy: {
        allowWrites: !readOnly,
        allowGit: false,
        allowRunScript: false,
        allowPluginInstall: false,
        allowParallelWorktrees: false,
        pathJail: 'sandbox',
      },
    }
  }

  // Code
  const readOnly = permissionMode === 'chat'
  const full = permissionMode === 'full'
  return {
    surface: 'code',
    permissionMode,
    capabilityNarrative: capabilityNarrative('code', permissionMode),
    promptBody: 'code',
    includeGitGuidance: !readOnly,
    includeMcpCatalog: true,
    skillPolicy: {
      pinIds: [HIP_SKILL_ID, CODING_SKILL_ID],
      excludeIds: [],
    },
    toolPolicy: {
      allowWrites: !readOnly,
      allowGit: !readOnly,
      allowRunScript: !readOnly,
      allowPluginInstall: !readOnly,
      allowParallelWorktrees: !readOnly,
      pathJail: full ? 'none' : 'sandbox',
    },
  }
}

/** Filter skill metas for prompt listing and use_skill registration. */
export function filterSkillsForProfile(skills: SkillMeta[] | undefined, profile: AgentRuntimeProfile): SkillMeta[] {
  if (!skills?.length) return []
  const exclude = new Set(profile.skillPolicy.excludeIds)
  if (exclude.size === 0) return skills
  return skills.filter((s) => !exclude.has(s.id) && !exclude.has(s.name))
}

/** Model-facing capability reminder (injector / fragment). */
export function renderCapabilityNarrative(input: {
  surface?: 'chat' | 'code' | 'knowledge'
  permissionMode?: PermissionMode
  sessionId?: string
  cwd?: string
}): string {
  return resolveAgentRuntimeProfile(input).capabilityNarrative
}
