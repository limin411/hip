import { readFileSync } from 'node:fs'
import type { ActiveModel, ProvidersConfig } from '@hip/protocol'

export const DEEPSEEK_DEFAULT: ActiveModel = {
  providerID: 'deepseek',
  modelID: 'deepseek-reasoner',
  baseURL: 'https://api.deepseek.com/v1',
}

let active: ActiveModel = DEEPSEEK_DEFAULT

export function getActiveModel(): ActiveModel {
  return active
}

export function setActiveModel(m: ActiveModel): void {
  active = m
}

/** Initialise the process-global active model from HIP_PROVIDERS_PATH (call once at boot). */
export function loadActiveModelFromEnv(): void {
  const file = process.env.HIP_PROVIDERS_PATH?.trim()
  if (!file) { active = DEEPSEEK_DEFAULT; return }
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as ProvidersConfig
    const sel = cfg.activeModel
    if (!sel) { active = DEEPSEEK_DEFAULT; return }
    const baseURL = cfg.providers?.[sel.providerID]?.baseURL ?? DEEPSEEK_DEFAULT.baseURL
    active = { providerID: sel.providerID, modelID: sel.modelID, baseURL }
  } catch {
    active = DEEPSEEK_DEFAULT
  }
}
