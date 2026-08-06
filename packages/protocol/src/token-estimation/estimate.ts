/**
 * Pure token-count estimators (no Node / LangChain deps).
 * Text estimate uses ceil(len / 4) — hip KD-10.
 */
import {
  CHARS_PER_TOKEN,
  IMAGE_TOKEN_ESTIMATE,
  TOOL_SCHEMA_OVERHEAD_CHARS,
} from './constants.js'

/** Bytes/chars ÷ 4 token estimate for a string (ceil; KD-10). */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Token estimate for `imageCount` images at IMAGE_TOKEN_ESTIMATE each. */
export function estimateImageTokens(imageCount: number): number {
  if (!Number.isFinite(imageCount) || imageCount <= 0) return 0
  return Math.floor(imageCount) * IMAGE_TOKEN_ESTIMATE
}

/**
 * Schema / tool-definition overhead in tokens.
 * - string: estimate from schema JSON (or any serialized schema text)
 * - number: treat as character overhead (ceil / 4)
 * - omitted / invalid: TOOL_SCHEMA_OVERHEAD_CHARS default
 */
export function estimateToolSchemaTokens(schemaJsonOrOverhead?: string | number): number {
  if (typeof schemaJsonOrOverhead === 'string') {
    return estimateTextTokens(schemaJsonOrOverhead)
  }
  if (typeof schemaJsonOrOverhead === 'number' && Number.isFinite(schemaJsonOrOverhead)) {
    return Math.ceil(Math.max(0, schemaJsonOrOverhead) / CHARS_PER_TOKEN)
  }
  return Math.ceil(TOOL_SCHEMA_OVERHEAD_CHARS / CHARS_PER_TOKEN)
}

export interface ToolSchemaEstimateInput {
  name: string
  description?: string
  /** Serialized tool schema JSON when available; else fixed overhead applies. */
  schemaJson?: string
}

/**
 * Rough tool-definition cost: name + description + schema (JSON or fixed overhead).
 * Pure counterpart of sidecar `estimateToolsTokens` without LangChain.
 */
export function estimateToolsTokens(tools: readonly ToolSchemaEstimateInput[] | undefined): number {
  if (!tools?.length) return 0
  let tokens = 0
  for (const t of tools) {
    tokens += estimateTextTokens(t.name ?? '')
    tokens += estimateTextTokens(t.description ?? '')
    tokens += estimateToolSchemaTokens(
      t.schemaJson !== undefined ? t.schemaJson : TOOL_SCHEMA_OVERHEAD_CHARS,
    )
  }
  return tokens
}
