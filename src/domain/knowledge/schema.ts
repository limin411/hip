/**
 * Per-space property schema (`.hip/schema.json`).
 */

export type PropType =
  | 'string'
  | 'number'
  | 'date'
  | 'select'
  | 'multi-select'
  | 'url'
  | 'checkbox'

export type SpacePropertyDef = {
  key: string
  type: PropType
  label?: string
  options?: string[]
}

export type SpaceSchemaV1 = {
  version: 1
  properties: SpacePropertyDef[]
}

/** Built-in keys always recognized by the FM parser. */
export const BUILTIN_PROP_KEYS = [
  'tags',
  'status',
  'aliases',
  'date',
  'priority',
] as const

export type BuiltinPropKey = (typeof BUILTIN_PROP_KEYS)[number]

export const DEFAULT_SPACE_SCHEMA: SpaceSchemaV1 = {
  version: 1,
  properties: [
    {
      key: 'status',
      type: 'select',
      label: 'Status',
      options: ['draft', 'active', 'done'],
    },
    { key: 'tags', type: 'multi-select', label: 'Tags' },
    { key: 'aliases', type: 'multi-select', label: 'Aliases' },
    { key: 'date', type: 'date', label: 'Date' },
    {
      key: 'priority',
      type: 'select',
      label: 'Priority',
      options: ['low', 'medium', 'high'],
    },
  ],
}

const KEY_RE = /^[a-z][a-z0-9_]*$/

export function isValidPropKey(key: string): boolean {
  return KEY_RE.test(key)
}

/** Merge disk schema with defaults (ensure builtins exist, keep custom props). */
export function normalizeSpaceSchema(raw: unknown): SpaceSchemaV1 {
  const base = DEFAULT_SPACE_SCHEMA
  if (!raw || typeof raw !== 'object') return structuredClone(base)
  const o = raw as { version?: number; properties?: unknown }
  const propsIn = Array.isArray(o.properties) ? o.properties : []
  const seen = new Set<string>()
  const properties: SpacePropertyDef[] = []

  for (const p of propsIn) {
    if (!p || typeof p !== 'object') continue
    const rec = p as Record<string, unknown>
    const key = typeof rec.key === 'string' ? rec.key.trim().toLowerCase() : ''
    if (!isValidPropKey(key) || seen.has(key)) continue
    const type = normalizePropType(rec.type)
    if (!type) continue
    seen.add(key)
    const def: SpacePropertyDef = { key, type }
    if (typeof rec.label === 'string' && rec.label.trim()) def.label = rec.label.trim()
    if (Array.isArray(rec.options)) {
      def.options = rec.options
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    properties.push(def)
  }

  // Ensure builtins present
  for (const b of base.properties) {
    if (!seen.has(b.key)) {
      properties.unshift({ ...b, options: b.options ? [...b.options] : undefined })
      seen.add(b.key)
    }
  }

  return { version: 1, properties }
}

function normalizePropType(t: unknown): PropType | null {
  const s = typeof t === 'string' ? t : ''
  switch (s) {
    case 'string':
    case 'number':
    case 'date':
    case 'select':
    case 'multi-select':
    case 'url':
    case 'checkbox':
      return s
    default:
      return null
  }
}

export function propDefByKey(
  schema: SpaceSchemaV1,
  key: string,
): SpacePropertyDef | undefined {
  return schema.properties.find((p) => p.key === key)
}

/** Select-typed fields eligible for board grouping. */
export function selectPropKeys(schema: SpaceSchemaV1): string[] {
  return schema.properties.filter((p) => p.type === 'select').map((p) => p.key)
}
