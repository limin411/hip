/**
 * Build a SessionConfig for an automation fire (normative design algorithm).
 * Mirrors configFromDraft / resolveModelConfig / resolveValidAcpAgentId paths.
 */
import type { SessionConfig } from '@hip/protocol'
import { normalizeSessionConfig } from '@hip/protocol'
import { isDirectory } from '@/ipc/pathExists'
import { resolveModelConfig, activeModelKey } from '@/lib/modelKey'
import { clampEffortForKey } from '@/lib/modelEffort'
import { resolveValidAcpAgentId } from '@/lib/sessionAgent'
import { projectPathKey } from '@/lib/sessionProjectGroups'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import i18n from '@/i18n'
import { normalizeAppLanguage, type AppLanguage } from '@/store/uiStore'
import { useDetectionStore } from '@/store/detectionStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useProvidersStore } from '@/store/providersStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import type { Automation } from './types'

/** Same mapping as sessionService.currentLanguage (avoid importing sessionService). */
function currentLanguage(): AppLanguage {
  return normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language) ?? 'en'
}

export type BuildSessionConfigResult =
  | { ok: true; config: SessionConfig }
  | { ok: false; error: string }

/**
 * Awaitable project-path probe: updates projectPathStore cache then returns status.
 * design: never create on 'unknown'; probe first when status is unknown.
 */
export async function probeProjectPath(
  path: string,
): Promise<'ok' | 'missing' | 'unknown'> {
  const key = projectPathKey(path)
  if (!key) return 'missing'

  const exists = await isDirectory(key)
  const store = useProjectPathStore.getState()
  if (exists === true) {
    store.markOk(key)
    return 'ok'
  }
  if (exists === false) {
    useProjectPathStore.setState((prev) => ({
      byKey: {
        ...prev.byKey,
        [key]: { exists: false, checkedAt: Date.now(), inFlight: false },
      },
    }))
    return 'missing'
  }
  // Probe could not run (non-Tauri / IPC failure) — leave unknown.
  return 'unknown'
}

/**
 * Resolve SessionConfig from an Automation (project gate + model/agent).
 * Failures return `{ ok: false, error }` with stable codes:
 * `project_missing` | `project_required` | `no_model_configured` | `model_unresolvable`
 */
export async function buildSessionConfigFromAutomation(
  a: Automation,
): Promise<BuildSessionConfigResult> {
  // 1. Project gate — never create on 'unknown'; probe first
  if (a.projectPath?.trim()) {
    let st = useProjectPathStore.getState().statusOf(a.projectPath)
    if (st === 'unknown') {
      st = await probeProjectPath(a.projectPath)
    }
    if (st === 'unknown' || st === 'missing') {
      return { ok: false, error: 'project_missing' }
    }
  }

  // surface is code iff projectPath is non-empty (project_required is reserved
  // for a future explicit surface pin without path; unreachable with current mapping).
  const surface: 'chat' | 'code' = a.projectPath?.trim() ? 'code' : 'chat'

  // 2. Mirror configFromDraft model/agent path
  const agents = useHipConfigStore.getState().config.agents ?? []
  const { installed, checked: detectionChecked } = useDetectionStore.getState()
  const externalAgentId = resolveValidAcpAgentId(a.agentId, agents, {
    installed,
    detectionChecked,
  })

  let base: SessionConfig =
    surface === 'code'
      ? { ...DEFAULT_CONFIG, surface, cwd: a.projectPath!.trim() }
      : { ...DEFAULT_CONFIG, surface }

  // 3. permissionMode — KD-14
  const permissionMode =
    a.permissionMode ?? (surface === 'code' ? 'edit' : 'chat')
  base = { ...base, permissionMode }

  // 4. ACP agent: hip model fields unused
  if (externalAgentId) {
    return {
      ok: true,
      config: normalizeSessionConfig({
        ...base,
        agentId: externalAgentId,
        language: currentLanguage(),
      }),
    }
  }

  // 5. Model key: explicit provider/model → key; else global activeModel
  const { catalog, config: providersCfg } = useProvidersStore.getState()
  const modelKey =
    a.llmProvider && a.model
      ? `${a.llmProvider}/${a.model}`
      : activeModelKey(providersCfg)
  if (!modelKey) {
    return { ok: false, error: 'no_model_configured' }
  }
  const { llmProvider, model, baseURL } = resolveModelConfig(
    catalog,
    providersCfg,
    modelKey,
  )
  if (!llmProvider || !model) {
    return { ok: false, error: 'model_unresolvable' }
  }
  const effort = clampEffortForKey(catalog, modelKey, a.effort)
  return {
    ok: true,
    config: normalizeSessionConfig({
      ...base,
      llmProvider,
      model,
      ...(baseURL ? { baseURL } : {}),
      ...(effort ? { effort } : {}),
      language: currentLanguage(),
    }),
  }
}
