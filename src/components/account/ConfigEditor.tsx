import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHipConfigStore } from '@/store/hipConfigStore'
import type { HipConfig, ProviderEntry, McpServerConfig, SkillEntry, AgentConfig } from '@hip/protocol'

// ── Pure-logic exports (tested in ConfigEditor.logic.test.ts) ────

/**
 * Convert a HipConfig object to a human-readable TOML-like text representation.
 *
 * Produces valid TOML that can be round-tripped back via `parseConfigToml`.
 * Intentionally simple: supports the HipConfig schema subset of TOML
 * (top-level scalars, arrays-of-tables for providers/mcp_servers/skills/agents,
 * and inline tables for permissions/toolPermissions).
 */
export function configToToml(config: HipConfig): string {
  const lines: string[] = []

  lines.push(`# hip config — edit and click "Parse & Validate" to save`)
  lines.push(`version = ${config.version}`)
  lines.push('')

  // providers: array of tables
  if (config.providers && config.providers.length > 0) {
    for (const p of config.providers) {
      lines.push('[[providers]]')
      lines.push(`id = ${tomlStr(p.id)}`)
      lines.push(`name = ${tomlStr(p.name)}`)
      lines.push(`base_url = ${tomlStr(p.baseUrl)}`)
      if (p.apiKey) lines.push(`api_key = ${tomlStr(p.apiKey)}`)
      lines.push('')
    }
  }

  // mcp_servers: array of tables
  if (config.mcpServers && config.mcpServers.length > 0) {
    for (const s of config.mcpServers) {
      lines.push('[[mcp_servers]]')
      lines.push(`id = ${tomlStr(s.id)}`)
      lines.push(`name = ${tomlStr(s.name)}`)
      lines.push(`transport = ${tomlStr(s.transport)}`)
      lines.push(`enabled = ${s.enabled}`)
      if (s.command) lines.push(`command = ${tomlStr(s.command)}`)
      if (s.args?.length) lines.push(`args = ${tomlArr(s.args)}`)
      if (s.env && Object.keys(s.env).length) lines.push(`env = ${tomlRecord(s.env)}`)
      if (s.url) lines.push(`url = ${tomlStr(s.url)}`)
      if (s.headers && Object.keys(s.headers).length) lines.push(`headers = ${tomlRecord(s.headers)}`)
      if (s.enabledTools?.length) lines.push(`enabled_tools = ${tomlArr(s.enabledTools)}`)
      if (s.disabledTools?.length) lines.push(`disabled_tools = ${tomlArr(s.disabledTools)}`)
      lines.push('')
    }
  }

  // skills: array of tables
  if (config.skills && config.skills.length > 0) {
    for (const s of config.skills) {
      lines.push('[[skills]]')
      lines.push(`id = ${tomlStr(s.id)}`)
      lines.push(`enabled = ${s.enabled}`)
      lines.push('')
    }
  }

  // agents: array of tables
  if (config.agents && config.agents.length > 0) {
    for (const a of config.agents) {
      lines.push('[[agents]]')
      lines.push(`id = ${tomlStr(a.id)}`)
      lines.push(`name = ${tomlStr(a.name)}`)
      lines.push(`kind = ${tomlStr(a.kind)}`)
      lines.push(`command = ${tomlStr(a.command)}`)
      lines.push(`args = ${tomlArr(a.args)}`)
      lines.push(`enabled = ${a.enabled}`)
      if (a.description) lines.push(`description = ${tomlStr(a.description)}`)
      if (a.prompt) lines.push(`prompt = ${tomlStr(a.prompt)}`)
      if (a.quirks) lines.push(`quirks = ${tomlStr(a.quirks)}`)
      if (a.boundModel) lines.push(`bound_model = ${tomlStr(JSON.stringify(a.boundModel))}`)
      if (a.env && Object.keys(a.env).length) lines.push(`env = ${tomlRecord(a.env)}`)
      if (a.allowedSkills?.length) lines.push(`allowed_skills = ${tomlArr(a.allowedSkills)}`)
      if (a.allowedMcpServers?.length) lines.push(`allowed_mcp_servers = ${tomlArr(a.allowedMcpServers)}`)
      lines.push('')
    }
  }

  // Remove trailing blank line
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n') + '\n'
}

/** TOML string value */
function tomlStr(v: string): string {
  return JSON.stringify(v) // handles escaping correctly
}

/** TOML array of strings */
function tomlArr(arr: string[]): string {
  return '[' + arr.map((v) => JSON.stringify(v)).join(', ') + ']'
}

/** TOML inline table for Record<string, string> */
function tomlRecord(rec: Record<string, string>): string {
  const entries = Object.entries(rec).map(([k, v]) => `${tomlStr(k)} = ${tomlStr(v)}`)
  return '{ ' + entries.join(', ') + ' }'
}

/**
 * Attempt to parse a TOML-like text into a HipConfig object.
 *
 * Returns `{ config }` on success, or `{ errors: string[] }` with
 * human-readable messages on failure. Accepts both valid TOML and
 * JSON as input (JSON is auto-detected by leading `{` character).
 */
export function parseConfigToml(text: string): { config: HipConfig } | { errors: string[] } {
  const trimmed = text.trim()
  if (!trimmed) return { errors: ['Config is empty'] }

  // Treat leading `{` as JSON
  if (trimmed.startsWith('{')) {
    return parseJsonConfig(trimmed)
  }

  return parseTomlConfig(trimmed)
}

function parseJsonConfig(json: string): { config: HipConfig } | { errors: string[] } {
  try {
    const parsed = JSON.parse(json)
    return validateConfigShape(parsed)
  } catch (e) {
    return { errors: [`Invalid JSON: ${e instanceof Error ? e.message : 'unknown error'}`] }
  }
}

function parseTomlConfig(text: string): { config: HipConfig } | { errors: string[] } {
  const errors: string[] = []
  const lines = text.split('\n').map((l) => l.trim())
  const config: Record<string, unknown> = {}
  config.version = 1

  // State for building sections
  //   isArrayTable=true  → [[section]] accumulates array entries
  //   isArrayTable=false → [section] builds a single object placed directly in config
  let sectionName: string | null = null
  let isArrayTable = false
  let currentObject: Record<string, unknown> | null = null
  const arrays: Record<string, unknown[]> = {}

  function flushCurrent() {
    if (!sectionName || !currentObject) return
    if (isArrayTable) {
      // [[xxx]] → accumulate into arrays
      if (!arrays[sectionName]) arrays[sectionName] = []
      arrays[sectionName].push(currentObject)
    } else {
      // [xxx] → assign directly to config (single table, not array)
      config[sectionName] = currentObject
    }
    currentObject = null
    sectionName = null
  }

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue

    // Array of tables: [[name]]
    const arrMatch = line.match(/^\[\[(\w+)\]\]$/)
    if (arrMatch) {
      flushCurrent()
      sectionName = arrMatch[1]
      isArrayTable = true
      currentObject = {}
      continue
    }

    // Regular table: [name]
    const tblMatch = line.match(/^\[(\w+)\]$/)
    if (tblMatch) {
      flushCurrent()
      sectionName = tblMatch[1]
      isArrayTable = false
      currentObject = {}
      continue
    }

    // Key = value (supports dotted keys like tool_permissions.run_script)
    const kvMatch = line.match(/^(\w+(?:\.\w+)*)\s*=\s*(.+)$/)
    if (!kvMatch) {
      errors.push(`Line "${line}" is not valid TOML`)
      continue
    }

    const fullKey = kvMatch[1]
    const rawValue = kvMatch[2].trim()

    try {
      const value = parseTomlValue(rawValue)

      if (sectionName && currentObject) {
        // Inside a section: set key (supporting dotted keys for nesting)
        setNested(currentObject, fullKey, value)
      } else {
        setNested(config, fullKey, value)
      }
    } catch (e) {
      errors.push(`Cannot parse value for "${fullKey}": ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  flushCurrent()

  // Apply array-of-tables sections to config
  for (const [key, arr] of Object.entries(arrays)) {
    const mappedKey = mapKey(key)
    config[mappedKey] = arr
  }

  // Map single-table section keys as well (e.g., permissions remains "permissions")
  // but handle snake_case keys that weren't applied yet.
  for (const key of Object.keys(config)) {
    const mapped = mapKey(key)
    if (mapped !== key) {
      config[mapped] = config[key]
      delete config[key]
    }
  }

  if (errors.length > 0) return { errors }

  return validateConfigShape(config)
}

/** Set a value at a possibly-dotted key path, creating intermediate objects. */
function setNested(obj: Record<string, unknown>, key: string, value: unknown): void {
  // Normalize snake_case in the key path
  const parts = key.split('.').map(mapKey)
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
      current[parts[i]] = {}
    }
    current = current[parts[i]] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

/** Map TOML snake_case key to HipConfig camelCase key */
function mapKey(key: string): string {
  if (key === 'mcp_servers') return 'mcpServers'
  if (key === 'base_url') return 'baseUrl'
  if (key === 'api_key') return 'apiKey'
  if (key === 'bound_model') return 'boundModel'
  if (key === 'allowed_skills') return 'allowedSkills'
  if (key === 'allowed_mcp_servers') return 'allowedMcpServers'
  if (key === 'enabled_tools') return 'enabledTools'
  if (key === 'disabled_tools') return 'disabledTools'
  return key
}

function parseTomlValue(raw: string): unknown {
  raw = raw.trim()

  // Boolean
  if (raw === 'true') return true
  if (raw === 'false') return false

  // Number (integer)
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10)

  // Number (float)
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(raw)) return parseFloat(raw)

  // Inline table { key = val, ... }
  if (raw.startsWith('{') && raw.endsWith('}')) {
    return parseInlineTable(raw)
  }

  // Array [val, val, ...]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return parseTomlArray(raw)
  }

  // String (JSON-quoted or bare)
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return JSON.parse(raw) as string
  }

  // Bare string
  return raw
}

function parseInlineTable(raw: string): Record<string, string> {
  const inner = raw.slice(1, -1).trim()
  if (!inner) return {}
  const result: Record<string, string> = {}

  // Simple comma-split — handles "key" = "val", "key2" = "val2"
  let i = 0
  while (i < inner.length) {
    i = skipWhitespace(inner, i)
    if (i >= inner.length) break

    const keyMatch = inner.slice(i).match(/^"([^"]*)"\s*=\s*/)
    if (!keyMatch) break
    const key = keyMatch[1]
    i += keyMatch[0].length

    const valMatch = inner.slice(i).match(/^"([^"]*)"\s*/)
    if (valMatch) {
      result[key] = valMatch[1]
      i += valMatch[0].length
      if (inner[i] === ',') i++
    }
  }
  return result
}

function skipWhitespace(s: string, i: number): number {
  while (i < s.length && s[i] === ' ') i++
  return i
}

function parseTomlArray(raw: string): string[] {
  const inner = raw.slice(1, -1).trim()
  if (!inner) return []
  return parseTomlArrayItems(inner)
}

function parseTomlArrayItems(s: string): string[] {
  const result: string[] = []
  let i = 0
  while (i < s.length) {
    i = skipWhitespace(s, i)
    if (i >= s.length) break

    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1)
      if (end === -1) break
      result.push(s.slice(i + 1, end))
      i = end + 1
      if (s[i] === ',') i++
    } else {
      // Bare string until comma or end
      let end = i
      while (end < s.length && s[end] !== ',') end++
      result.push(s.slice(i, end).trim())
      i = end
      if (s[i] === ',') i++
    }
  }
  return result
}

function validateConfigShape(raw: unknown): { config: HipConfig } | { errors: string[] } {
  if (typeof raw !== 'object' || raw === null) return { errors: ['Config must be an object'] }

  const obj = raw as Record<string, unknown>
  const errors: string[] = []

  if (typeof obj.version !== 'number') errors.push('version must be a number')

  if (obj.providers !== undefined && obj.providers !== null) {
    if (!Array.isArray(obj.providers)) {
      errors.push('providers must be an array')
    } else {
      for (let i = 0; i < obj.providers.length; i++) {
        const p = obj.providers[i] as Record<string, unknown> | null
        if (typeof p !== 'object' || p === null) {
          errors.push(`providers[${i}] must be an object`)
          continue
        }
        if (typeof p.id !== 'string') errors.push(`providers[${i}].id must be a string`)
        if (typeof p.name !== 'string') errors.push(`providers[${i}].name must be a string`)
        if (typeof p.baseUrl !== 'string' && typeof p.base_url !== 'string')
          errors.push(`providers[${i}].baseUrl (or base_url) must be a string`)
        // Normalize base_url → baseUrl
        if (p.base_url !== undefined && p.baseUrl === undefined) p.baseUrl = p.base_url
        if (p.api_key !== undefined && p.apiKey === undefined) p.apiKey = p.api_key
      }
    }
  }

  if (obj.mcpServers != null || obj.mcp_servers != null) {
    const v = (obj.mcpServers ?? obj.mcp_servers) as unknown[]
    if (v != null) {
      if (!Array.isArray(v)) {
        errors.push('mcpServers must be an array')
      } else {
        for (let i = 0; i < v.length; i++) {
        const s = v[i] as Record<string, unknown> | null
        if (typeof s !== 'object' || s === null) {
          errors.push(`mcpServers[${i}] must be an object`)
          continue
        }
        if (typeof s.id !== 'string') errors.push(`mcpServers[${i}].id must be a string`)
        if (typeof s.name !== 'string') errors.push(`mcpServers[${i}].name must be a string`)
        if (typeof s.transport !== 'string') errors.push(`mcpServers[${i}].transport must be a string`)
        if (typeof s.enabled !== 'boolean') errors.push(`mcpServers[${i}].enabled must be a boolean`)
        // Normalize snake_case
        if (s.enabled_tools !== undefined && s.enabledTools === undefined) s.enabledTools = s.enabled_tools
        if (s.disabled_tools !== undefined && s.disabledTools === undefined) s.disabledTools = s.disabled_tools
      }
    }
    }
  }

  // Normalize mcp_servers → mcpServers
  if (obj.mcp_servers !== undefined && obj.mcpServers === undefined) {
    obj.mcpServers = obj.mcp_servers
  }

  if (obj.skills !== undefined && obj.skills !== null) {
    if (!Array.isArray(obj.skills)) {
      errors.push('skills must be an array')
    } else {
      for (let i = 0; i < obj.skills.length; i++) {
        const s = obj.skills[i] as Record<string, unknown> | null
        if (typeof s !== 'object' || s === null) {
          errors.push(`skills[${i}] must be an object`)
          continue
        }
        if (typeof s.id !== 'string') errors.push(`skills[${i}].id must be a string`)
        if (typeof s.enabled !== 'boolean') errors.push(`skills[${i}].enabled must be a boolean`)
      }
    }
  }

  if (obj.agents !== undefined && obj.agents !== null) {
    if (!Array.isArray(obj.agents)) {
      errors.push('agents must be an array')
    } else {
      for (let i = 0; i < obj.agents.length; i++) {
        const a = obj.agents[i] as Record<string, unknown> | null
        if (typeof a !== 'object' || a === null) {
          errors.push(`agents[${i}] must be an object`)
          continue
        }
        if (typeof a.id !== 'string') errors.push(`agents[${i}].id must be a string`)
        if (typeof a.name !== 'string') errors.push(`agents[${i}].name must be a string`)
        if (typeof a.kind !== 'string') errors.push(`agents[${i}].kind must be a string`)
        if (typeof a.command !== 'string') errors.push(`agents[${i}].command must be a string`)
        if (!Array.isArray(a.args)) errors.push(`agents[${i}].args must be an array of strings`)
        if (typeof a.enabled !== 'boolean') errors.push(`agents[${i}].enabled must be a boolean`)
        // Normalize snake_case
        if (a.bound_model !== undefined && a.boundModel === undefined) a.boundModel = a.bound_model
        if (a.allowed_skills !== undefined && a.allowedSkills === undefined) a.allowedSkills = a.allowed_skills
        if (a.allowed_mcp_servers !== undefined && a.allowedMcpServers === undefined)
          a.allowedMcpServers = a.allowed_mcp_servers
      }
    }
  }

  if (errors.length > 0) return { errors }

  // Build clean HipConfig
  const cfg: HipConfig = {
    version: obj.version as number,
  }
  if (obj.providers) cfg.providers = obj.providers as ProviderEntry[]
  if (obj.mcpServers) cfg.mcpServers = obj.mcpServers as McpServerConfig[]
  if (obj.skills) cfg.skills = obj.skills as SkillEntry[]
  if (obj.agents) cfg.agents = obj.agents as AgentConfig[]

  return { config: cfg }
}

// ── Component ────────────────────────────────────────────────────

export function ConfigEditor() {
  const { t } = useTranslation()
  const config = useHipConfigStore((s) => s.config)
  const loaded = useHipConfigStore((s) => s.loaded)
  const error = useHipConfigStore((s) => s.error)
  const load = useHipConfigStore((s) => s.load)
  const save = useHipConfigStore((s) => s.save)

  const [text, setText] = useState('')
  const [parseErrors, setParseErrors] = useState<string[] | null>(null)
  const [parseSuccess, setParseSuccess] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  // When loaded config changes externally, update the textarea
  useEffect(() => {
    if (loaded) {
      setText(configToToml(config))
    }
  }, [loaded, config])

  // Initial load
  useEffect(() => {
    void load()
  }, [load])

  const handleParse = useCallback(async () => {
    setParseErrors(null)
    setParseSuccess(false)

    const result = parseConfigToml(text)
    if ('errors' in result) {
      setParseErrors(result.errors)
      return
    }

    setSaving(true)
    try {
      await save(result.config)
      setParseSuccess(true)
    } catch (e) {
      setParseErrors([e instanceof Error ? e.message : 'Failed to save config'])
    } finally {
      setSaving(false)
    }
  }, [text, save])

  const handleLoad = useCallback(async () => {
    setLoading(true)
    setParseErrors(null)
    setParseSuccess(false)
    try {
      await load()
      void load // eslint-disable-next-line react-hooks/exhaustive-deps
    } finally {
      setLoading(false)
    }
  }, [load])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-border">
        <div>
          <h2 className="text-title font-semibold text-ink">{t('settings.config')}</h2>
          <p className="mt-0.5 text-body text-ink-secondary">{t('settings.configDesc')}</p>
        </div>
        {loaded && (
          <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-0.5 text-meta text-ink-tertiary">
            {t('settings.configLoaded')}
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border">
        <button
          onClick={handleParse}
          disabled={saving || !text.trim()}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body font-medium transition-colors',
            'bg-accent text-white hover:bg-accent-strong',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {saving ? (
            <>
              <LoaderCircle size={14} className="animate-spin" />
              {t('settings.configSaving')}
            </>
          ) : (
            <>
              <FileCode size={14} />
              {t('settings.configParse')}
            </>
          )}
        </button>

        <button
          onClick={handleLoad}
          disabled={loading}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body font-medium transition-colors',
            'border border-border bg-surface text-ink-secondary hover:bg-surface-muted hover:text-ink',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {loading ? (
            <>
              <LoaderCircle size={14} className="animate-spin" />
              {t('settings.configLoading')}
            </>
          ) : (
            t('settings.configLoad')
          )}
        </button>
      </div>

      {/* Status messages */}
      {(parseErrors || parseSuccess || error) && (
        <div className="px-6 pt-3">
          {parseErrors && (
            <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2">
              <div className="text-caption font-medium text-error">{t('settings.configErrors')}</div>
              <ul className="mt-1 list-inside list-disc text-caption text-error/80">
                {parseErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {parseSuccess && (
            <div className="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2">
              <div className="text-caption font-medium text-green-600">{t('settings.configSaved')}</div>
            </div>
          )}
          {error && !parseErrors && !parseSuccess && (
            <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2">
              <div className="text-caption font-medium text-error">{t('settings.configError')}</div>
              <p className="mt-1 text-caption text-error/80">{error}</p>
            </div>
          )}
        </div>
      )}

      {/* Textarea */}
      <div className="flex-1 min-h-0 px-6 pb-6 pt-3">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setParseErrors(null)
            setParseSuccess(false)
          }}
          className="w-full h-full min-h-[300px] resize-none rounded-md border border-border bg-surface p-4 font-mono text-body text-ink placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-accent/60"
          placeholder={t('settings.configPlaceholder')}
          spellCheck={false}
        />
      </div>
    </div>
  )
}
