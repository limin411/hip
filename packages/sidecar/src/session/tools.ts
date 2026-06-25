import { buildAllTools } from './tools/index.js'
import type { ApprovalDecision, ApprovalFn, DispatchSpec, BuildToolsOpts } from './tools/index.js'

export { buildAllTools }
export type { ApprovalDecision, ApprovalFn, DispatchSpec, BuildToolsOpts }
export { substituteSkillBody, SELF_GATED_TOOLS } from './tools/index.js'

/** Build the file-tool set sandboxed to `root`. Each returns a short string result for the model.
 *  @deprecated Use `buildAllTools` directly — kept for backward compatibility. */
export const buildTools = buildAllTools
