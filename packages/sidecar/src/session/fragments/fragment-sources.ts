import { SystemContextRegistry } from '../system-context.js'
import { createCheckpointSource } from './checkpoint.js'
import { createPermissionSource } from './permission.js'
import { createSkillsSource } from './skills.js'
import { createSubagentSource } from './subagent.js'
import { createSystemSource } from './system.js'
import { createTimeSource } from './time.js'
import { createTokenBudgetSource } from './token-budget.js'
import type { CheckpointSourceInput } from './checkpoint.js'
import type { PermissionSourceInput } from './permission.js'
import type { SkillsSourceInput } from './skills.js'
import type { SubagentSourceInput } from './subagent.js'
import type { SystemSourceInput } from './system.js'
import type { TimeSourceInput } from './time.js'
import type { TokenBudgetSourceInput } from './token-budget.js'

// ── Input ─────────────────────────────────────────────────────────────────────

export interface FragmentSourcesInput {
  readonly system: SystemSourceInput
  readonly skills: SkillsSourceInput
  readonly time: TimeSourceInput
  readonly tokenBudget: TokenBudgetSourceInput
  readonly subagents: SubagentSourceInput
  readonly checkpoint: CheckpointSourceInput
  readonly permission: PermissionSourceInput
}

// ── Registry builder ──────────────────────────────────────────────────────────

/**
 * Register all fragment sources under deterministic keys:
 *   fragment:system, fragment:skills, fragment:time, fragment:token-budget,
 *   fragment:subagents, fragment:checkpoint, fragment:permission
 */
export function createFragmentSourceRegistry(
  input: FragmentSourcesInput,
): SystemContextRegistry {
  const registry = new SystemContextRegistry()
  registry.register(createSystemSource(input.system))
  registry.register(createSkillsSource(input.skills))
  registry.register(createTimeSource(input.time))
  registry.register(createTokenBudgetSource(input.tokenBudget))
  registry.register(createSubagentSource(input.subagents))
  registry.register(createCheckpointSource(input.checkpoint))
  registry.register(createPermissionSource(input.permission))
  return registry
}
