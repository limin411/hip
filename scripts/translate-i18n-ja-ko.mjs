#!/usr/bin/env node
/**
 * One-shot: translate en UI strings + product-content packs to ja / ko via DeepSeek.
 * Usage (from repo root):
 *   node scripts/translate-i18n-ja-ko.mjs
 *   node scripts/translate-i18n-ja-ko.mjs --ui-only
 *   node scripts/translate-i18n-ja-ko.mjs --product-only
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SCRATCH =
  process.env.HIP_I18N_SCRATCH ||
  join(homedir(), '.cache', 'hip-i18n-translate')
const require = createRequire(import.meta.url)

const API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions'
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
const BATCH = Number(process.env.I18N_BATCH || 35)
const CONCURRENCY = Number(process.env.I18N_CONCURRENCY || 3)

function loadApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  if (process.env.HIP_MODEL_DEEPSEEK_API_KEY) return process.env.HIP_MODEL_DEEPSEEK_API_KEY
  const authPath = join(homedir(), '.hip', 'config', 'auth.json')
  const raw = JSON.parse(readFileSync(authPath, 'utf8'))
  const key = raw.HIP_MODEL_DEEPSEEK_API_KEY || raw.DEEPSEEK_API_KEY
  if (!key) throw new Error('No DeepSeek API key in ~/.hip/config/auth.json')
  return key
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, path, out)
    } else {
      out[path] = v
    }
  }
  return out
}

function unflatten(flat) {
  const root = {}
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.')
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]
      if (!(p in cur) || typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}
      cur = cur[p]
    }
    cur[parts[parts.length - 1]] = value
  }
  return root
}

function emitLocaleTs(exportName, tree) {
  const body = JSON.stringify(tree, null, 2)
  return `export const ${exportName} = {\n  translation: ${body},\n}\n`
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function chat(apiKey, system, user, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (res.status === 429 || res.status >= 500) {
      const wait = 1500 * (attempt + 1)
      console.warn(`  retry ${attempt + 1} after ${res.status}, wait ${wait}ms`)
      await sleep(wait)
      continue
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`API ${res.status}: ${text.slice(0, 400)}`)
    }
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  }
  throw new Error('API retries exhausted')
}

function extractJsonObject(text) {
  const trimmed = text.trim()
  // strip fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1].trim() : trimmed
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error(`no JSON object in model response: ${body.slice(0, 200)}`)
  return JSON.parse(body.slice(start, end + 1))
}

function langName(code) {
  return code === 'ja' ? 'Japanese' : 'Korean'
}

function systemPrompt(target) {
  return `You translate UI strings for a desktop AI coding workbench (hip).
Target language: ${langName(target)} (${target}).
Rules:
- Return ONLY a JSON object mapping the same string keys to translated values.
- Keep i18next placeholders EXACTLY: {{name}}, {{count}}, {{path}}, etc.
- Keep product identifiers, paths, CLI flags, tool names, and brand "hip" as-is when they are technical tokens (e.g. ~/.hip/, write_file, MCP, SKILL.md).
- Natural, concise UI tone (not overly formal). Japanese: polite です/ます where natural for settings; short labels can be noun phrases. Korean: 해요/합니다 mixed is fine for UI; short labels as noun phrases.
- Do not add explanations.`
}

async function translateFlatMap(apiKey, target, flat, cachePath) {
  mkdirSync(dirname(cachePath), { recursive: true })
  let cache = {}
  if (existsSync(cachePath)) {
    try {
      cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    } catch {
      cache = {}
    }
  }

  const entries = Object.entries(flat)
  const missing = entries.filter(([k, v]) => {
    if (typeof v !== 'string') return false
    const c = cache[k]
    return typeof c !== 'string' || c.length === 0
  })
  console.log(`[${target}] total string leaves=${entries.filter(([, v]) => typeof v === 'string').length}, to translate=${missing.length}`)

  const batches = chunk(missing, BATCH)
  let done = 0

  async function runBatch(batch) {
    const payload = Object.fromEntries(batch)
    const user = `Translate these UI strings to ${langName(target)}. Keys are stable ids; values are English source.\n${JSON.stringify(payload, null, 0)}`
    const content = await chat(apiKey, systemPrompt(target), user)
    let parsed
    try {
      parsed = extractJsonObject(content)
    } catch (e) {
      // one repair attempt
      const repair = await chat(
        apiKey,
        'Return only valid JSON object. No markdown.',
        `Fix into pure JSON object with same keys:\n${content.slice(0, 8000)}`,
      )
      parsed = extractJsonObject(repair)
    }
    for (const [k] of batch) {
      const val = parsed[k]
      if (typeof val === 'string' && val.trim()) {
        cache[k] = val
      } else {
        console.warn(`  missing translation for ${k}, keeping English temporarily`)
        cache[k] = flat[k]
      }
    }
    done += batch.length
    writeFileSync(cachePath, JSON.stringify(cache))
    process.stdout.write(`  [${target}] ${done}/${missing.length}\r`)
  }

  // simple concurrency pool
  let idx = 0
  async function worker() {
    while (idx < batches.length) {
      const i = idx++
      await runBatch(batches[i])
      await sleep(80)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length || 1) }, () => worker()))
  console.log(`\n[${target}] translation cache saved: ${cachePath}`)

  const out = { ...flat }
  for (const [k, v] of Object.entries(flat)) {
    if (typeof v === 'string') out[k] = cache[k] ?? v
  }
  // language display labels (force correct endonyms)
  out['settings.languages.zh-CN'] = '简体中文'
  out['settings.languages.zh-TW'] = '繁體中文'
  out['settings.languages.en'] = 'English'
  out['settings.languages.ja'] = '日本語'
  out['settings.languages.ko'] = '한국어'
  return out
}

async function translateUi(apiKey) {
  // Load en via dynamic import of TS through node --experimental or transpile: use jiti if available
  let en
  try {
    const mod = await import(pathToFileURL(join(ROOT, 'src/i18n/en.ts')).href)
    en = mod.en
  } catch {
    // Fallback: use tsx/register if present
    try {
      require('tsx/cjs/api').register()
      en = require(join(ROOT, 'src/i18n/en.ts')).en
    } catch (e) {
      throw new Error(`Cannot load src/i18n/en.ts: ${e.message}. Run with: yarn node --import tsx scripts/translate-i18n-ja-ko.mjs`)
    }
  }

  // Ensure language keys exist in source tree before flatten (we'll inject)
  const tree = structuredClone(en.translation)
  tree.settings = tree.settings || {}
  tree.settings.languages = {
    ...tree.settings.languages,
    ja: '日本語',
    ko: '한국어',
  }

  const flat = flatten(tree)
  for (const target of ['ja', 'ko']) {
    const cachePath = join(SCRATCH, `${target}-ui-cache.json`)
    const translatedFlat = await translateFlatMap(apiKey, target, flat, cachePath)
    const outTree = unflatten(translatedFlat)
    const exportName = target === 'ja' ? 'ja' : 'ko'
    const file = join(ROOT, 'src/i18n', `${target}.ts`)
    writeFileSync(file, emitLocaleTs(exportName, outTree))
    console.log(`[${target}] wrote ${file}`)
  }
}

async function translateMarkdownFile(apiKey, target, text, kind) {
  const system = `You translate product documentation for hip (desktop AI coding workbench) into ${langName(target)} (${target}).
Rules:
- Keep markdown structure, headings, tables, code fences, backticks.
- Keep paths, config keys, tool names, identifiers exact: ~/.hip/, hip.toml, write_file, use_skill, task_batch, MCP, SKILL.md, etc.
- Keep {{HIP_PRODUCT_VERSION}} and other {{PLACEHOLDERS}} exact.
- Keep brand name "hip" as-is.
- Return ONLY the translated markdown, no preamble.`
  const user = `Translate this ${kind} document:\n\n${text}`
  return (await chat(apiKey, system, user)).trim() + (text.endsWith('\n') ? '\n' : '')
}

async function translateProduct(apiKey) {
  const SOT = join(ROOT, 'packages/product-content')
  const files = [
    'SKILL.md',
    'capability-map.md',
    'description.txt',
    'references/memory.md',
    'references/config-and-data.md',
    'references/troubleshooting.md',
    'references/agents-and-plugins.md',
  ]

  for (const target of ['ja', 'ko']) {
    for (const rel of files) {
      const src = rel === 'description.txt' || rel === 'SKILL.md' || rel === 'capability-map.md'
        ? join(SOT, rel === 'description.txt' ? 'meta.json' : rel)
        : join(SOT, rel)
      // description from meta or en root description pattern: use English meta description for description.txt source
      let sourceText
      if (rel === 'description.txt') {
        const meta = JSON.parse(readFileSync(join(SOT, 'meta.json'), 'utf8'))
        sourceText = meta.description
      } else if (rel === 'SKILL.md' || rel === 'capability-map.md') {
        sourceText = readFileSync(join(SOT, rel), 'utf8')
      } else {
        sourceText = readFileSync(join(SOT, rel), 'utf8')
      }

      const cachePath = join(SCRATCH, `${target}-product`, rel.replace(/\//g, '__') + '.txt')
      mkdirSync(dirname(cachePath), { recursive: true })
      let translated
      if (existsSync(cachePath) && readFileSync(cachePath, 'utf8').trim().length > 40) {
        translated = readFileSync(cachePath, 'utf8')
        console.log(`[${target}] cache hit product ${rel}`)
      } else {
        console.log(`[${target}] translating product ${rel}…`)
        translated = await translateMarkdownFile(apiKey, target, sourceText, rel)
        // description.txt: single line / short paragraph only
        if (rel === 'description.txt') {
          translated = translated.replace(/^["']|["']$/g, '').trim()
        }
        writeFileSync(cachePath, translated)
      }
      const dest = join(SOT, 'locales', target, rel)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, translated.endsWith('\n') ? translated : translated + '\n')
      console.log(`[${target}] wrote ${dest}`)
    }
  }
}

const args = new Set(process.argv.slice(2))
const apiKey = loadApiKey()
mkdirSync(SCRATCH, { recursive: true })

if (!args.has('--product-only')) {
  await translateUi(apiKey)
}
if (!args.has('--ui-only')) {
  await translateProduct(apiKey)
}
console.log('done')
