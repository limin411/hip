/**
 * @hip/protocol token-estimation — pure shared estimator + gate math.
 * No Node / LangChain dependencies (KD-4).
 */

export {
  CHARS_PER_TOKEN,
  IMAGE_TOKEN_ESTIMATE,
  TOOL_SCHEMA_OVERHEAD_CHARS,
  DEFAULT_OUTPUT_BUFFER_CAP,
} from './constants.js'

export {
  estimateTextTokens,
  estimateImageTokens,
  estimateToolSchemaTokens,
  estimateToolsTokens,
  type ToolSchemaEstimateInput,
} from './estimate.js'

export {
  clampThresholdPercent,
  exceedsThreshold,
  exceedsThresholdWithBuffer,
  usableContextTokens,
  usableContextTokensFromBuffer,
  exceedsGate,
  freeTokens,
  usagePercentage,
  type ContextGateMode,
  type ExceedsGateOptions,
} from './threshold.js'
