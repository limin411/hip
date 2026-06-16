import { z, type ZodObject, type ZodRawShape, type ZodTypeAny } from 'zod'

/** The minimal JSON-Schema shape we read off an MCP tool's `inputSchema`. */
export interface JsonSchema {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
}

/** Convert one JSON-Schema node to a zod type. Unknown/unsupported nodes degrade to z.any(). */
function nodeToZod(node: JsonSchema | undefined): ZodTypeAny {
  if (!node || typeof node !== 'object') return z.any()

  // enum (string enums are the common MCP case; anything else falls through to permissive z.any)
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const strings = node.enum.filter((v): v is string => typeof v === 'string')
    if (strings.length === node.enum.length) {
      return z.enum(strings as [string, ...string[]])
    }
    return z.any()
  }

  switch (node.type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'integer':
      return z.number().int()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(nodeToZod(node.items))
    case 'object':
      return objectToZod(node)
    default:
      return z.any()
  }
}

/** Build a zod object from a JSON-Schema object node (honouring `required`). */
function objectToZod(node: JsonSchema | undefined): ZodObject<ZodRawShape> {
  const props = node?.properties ?? {}
  const required = new Set(node?.required ?? [])
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, child] of Object.entries(props)) {
    let t = nodeToZod(child)
    if (child?.description) t = t.describe(child.description)
    shape[key] = required.has(key) ? t : t.optional()
  }
  // passthrough so MCP servers that send extra fields don't break parsing
  return z.object(shape).passthrough()
}

/**
 * Convert an MCP tool's JSON-Schema `inputSchema` into a zod object schema usable by
 * LangChain's `tool({ schema })`. A missing/non-object schema becomes an open object.
 */
export function jsonSchemaToZod(schema: JsonSchema | undefined): ZodObject<ZodRawShape> {
  if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
    return z.object({}).passthrough()
  }
  return objectToZod(schema)
}
