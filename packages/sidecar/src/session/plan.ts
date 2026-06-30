export interface ShouldPlanOptions {
  forcePlan?: boolean
  disablePlan?: boolean
}

export function shouldPlan(userMessage: string, options: ShouldPlanOptions = {}): boolean {
  if (options.disablePlan) {
    return false
  }
  if (options.forcePlan) {
    return true
  }

  const normalized = userMessage.trim().toLowerCase()
  // Strip image-agent result suffix injected by processInput's multimodal
  // preprocessing, so that agent-generated text does not inflate the length
  // and falsely trigger plan mode.
  const idx = normalized.indexOf('\n\n[image:')
  const cleaned = idx >= 0 ? normalized.slice(0, idx).trim() : normalized
  if (cleaned.length > 200) {
    return true
  }

  return false
}
