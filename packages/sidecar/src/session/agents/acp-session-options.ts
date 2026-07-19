/**
 * Normalize / synthesize ACP session config options for hip's model/mode UI.
 *
 * Standard agents return `configOptions` (type: select) from session/new.
 * Grok Build (and similar) advertise `models.currentModelId` + `availableModels`
 * (and optional reasoning efforts under model `_meta`) instead.
 */

export interface AcpSelectOption {
  value: string
  name: string
  description?: string
}

/** Raw select-shaped option as used by AcpAgentProvider.normalizeConfigOptions. */
export interface AcpSelectConfigOption {
  type: 'select'
  id: string
  name: string
  category?: string
  currentValue: string
  options: AcpSelectOption[]
}

/**
 * Extract select config options from a session/new (or set_config_option) result.
 * Prefers standard `configOptions`; otherwise synthesizes from `models`.
 */
export function extractAcpConfigOptions(sessionResult: unknown): AcpSelectConfigOption[] {
  const r = sessionResult as {
    configOptions?: unknown[]
    models?: {
      currentModelId?: string
      availableModels?: Array<{
        modelId?: string
        name?: string
        description?: string
        _meta?: {
          reasoningEffort?: string
          reasoningEfforts?: Array<{
            id?: string
            value?: string
            label?: string
            description?: string
            default?: boolean
          }>
        }
      }>
    }
  } | null | undefined

  if (!r) return []

  const standard = normalizeSelectOptions(r.configOptions)
  if (standard.length > 0) return standard

  return synthesizeFromModels(r.models)
}

/** Update currentValue for one option id; returns a shallow-copied options array. */
export function patchConfigOptionValue(
  options: AcpSelectConfigOption[],
  configId: string,
  value: string,
): AcpSelectConfigOption[] {
  return options.map((o) => (o.id === configId ? { ...o, currentValue: value } : o))
}

function normalizeSelectOptions(opts: unknown[] | undefined): AcpSelectConfigOption[] {
  if (!Array.isArray(opts)) return []
  const out: AcpSelectConfigOption[] = []
  for (const raw of opts) {
    const o = raw as Partial<AcpSelectConfigOption> & { type?: string }
    if (o?.type !== 'select' || typeof o.id !== 'string') continue
    const options = (Array.isArray(o.options) ? o.options : [])
      .map((x) => {
        const v = x as Partial<AcpSelectOption>
        if (typeof v.value !== 'string') return null
        return {
          value: v.value,
          name: typeof v.name === 'string' ? v.name : v.value,
          ...(typeof v.description === 'string' ? { description: v.description } : {}),
        } satisfies AcpSelectOption
      })
      .filter((x): x is AcpSelectOption => x !== null)
    out.push({
      type: 'select',
      id: o.id,
      name: typeof o.name === 'string' ? o.name : o.id,
      ...(typeof o.category === 'string' ? { category: o.category } : {}),
      currentValue: typeof o.currentValue === 'string' ? o.currentValue : (options[0]?.value ?? ''),
      options,
    })
  }
  return out
}

function synthesizeFromModels(
  models: {
    currentModelId?: string
    availableModels?: Array<{
      modelId?: string
      name?: string
      description?: string
      _meta?: {
        reasoningEffort?: string
        reasoningEfforts?: Array<{
          id?: string
          value?: string
          label?: string
          description?: string
          default?: boolean
        }>
      }
    }>
  } | undefined,
): AcpSelectConfigOption[] {
  const list = models?.availableModels
  if (!Array.isArray(list) || list.length === 0) return []

  const modelOptions: AcpSelectOption[] = []
  for (const m of list) {
    if (typeof m?.modelId !== 'string' || !m.modelId) continue
    modelOptions.push({
      value: m.modelId,
      name: typeof m.name === 'string' && m.name ? m.name : m.modelId,
      ...(typeof m.description === 'string' ? { description: m.description } : {}),
    })
  }
  if (modelOptions.length === 0) return []

  const currentModel =
    (typeof models?.currentModelId === 'string' && models.currentModelId) ||
    modelOptions[0]!.value

  const out: AcpSelectConfigOption[] = [
    {
      type: 'select',
      id: 'model',
      name: 'Model',
      category: 'model',
      currentValue: currentModel,
      options: modelOptions,
    },
  ]

  const currentMeta =
    list.find((m) => m.modelId === currentModel)?._meta ??
    list.find((m) => m._meta?.reasoningEfforts?.length)?._meta
  const efforts = currentMeta?.reasoningEfforts
  if (Array.isArray(efforts) && efforts.length > 0) {
    const effortOptions: AcpSelectOption[] = []
    for (const e of efforts) {
      const value = (typeof e.value === 'string' && e.value) || (typeof e.id === 'string' && e.id) || ''
      if (!value) continue
      effortOptions.push({
        value,
        name: (typeof e.label === 'string' && e.label) || value,
        ...(typeof e.description === 'string' ? { description: e.description } : {}),
      })
    }
    if (effortOptions.length > 0) {
      const defaultEffort = efforts.find((e) => e.default)
      const currentEffort =
        (typeof currentMeta?.reasoningEffort === 'string' && currentMeta.reasoningEffort) ||
        (typeof defaultEffort?.value === 'string' && defaultEffort.value) ||
        (typeof defaultEffort?.id === 'string' && defaultEffort.id) ||
        effortOptions[0]!.value
      out.push({
        type: 'select',
        id: 'mode',
        name: 'Effort',
        category: 'mode',
        currentValue: currentEffort,
        options: effortOptions,
      })
    }
  }

  return out
}
