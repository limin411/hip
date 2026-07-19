#!/usr/bin/env node
/**
 * Generate product progressive-disclosure embeds from docs/product/ (SoT).
 *
 * Outputs:
 *   packages/sidecar/src/session/product/content.ts  — agent L0–L3 strings
 *   src/domain/product/productDocs.generated.ts      — UI Help panel strings
 *
 * Usage:
 *   node scripts/generate-product-content.mjs           # write both
 *   node scripts/generate-product-content.mjs --check   # exit 1 if either is stale
 *
 * Also verifies README path smoke strings + package.json vs tauri.conf version.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SOT = join(ROOT, 'docs', 'product')
const OUT_SIDECAR = join(ROOT, 'packages', 'sidecar', 'src', 'session', 'product', 'content.ts')
const OUT_UI = join(ROOT, 'src', 'domain', 'product', 'productDocs.generated.ts')
const PKG = join(ROOT, 'package.json')
const README = join(ROOT, 'README.md')

const REF_ORDER = [
  'memory.md',
  'config-and-data.md',
  'troubleshooting.md',
  'agents-and-plugins.md',
]

const REF_SECTION_META = {
  'memory.md': { id: 'memory', titleKey: 'settings.productHelp.sections.memory' },
  'config-and-data.md': { id: 'config', titleKey: 'settings.productHelp.sections.config' },
  'troubleshooting.md': { id: 'troubleshooting', titleKey: 'settings.productHelp.sections.troubleshooting' },
  'agents-and-plugins.md': { id: 'agents', titleKey: 'settings.productHelp.sections.agents' },
}

/** Paths that must appear in README (lightweight drift guard). */
const README_MUST_CONTAIN = [
  '~/.hip/config/auth.json',
  '~/.hip/db/hip.db',
  'Settings → Memory',
]

function die(msg) {
  console.error(`[generate-product-content] ${msg}`)
  process.exit(1)
}

function readText(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch (e) {
    die(`missing file: ${relative(ROOT, p)} (${e.message})`)
  }
}

function applyPlaceholders(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (vars[key] === undefined) die(`unknown placeholder {{${key}}}`)
    return vars[key]
  })
}

/** Emit a TS template-literal body; escape backticks and ${ */
function asTemplateLiteral(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

function asSingleQuoted(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

const UI_LOCALES = ['en', 'zh-CN', 'zh-TW']

function loadMeta() {
  const raw = JSON.parse(readText(join(SOT, 'meta.json')))
  for (const k of ['skillId', 'skillName', 'skillVersion', 'description']) {
    if (typeof raw[k] !== 'string' || !raw[k].trim()) die(`meta.json missing string field: ${k}`)
  }
  return raw
}

/** Load one UI locale pack. en lives at docs/product root; others under locales/<id>/. */
function loadUiLocalePack(locale, vars, enFallback) {
  const root = locale === 'en' ? SOT : join(SOT, 'locales', locale)
  if (locale !== 'en' && !existsSync(root)) {
    die(`missing locale pack: locales/${locale}/`)
  }
  const skillPath = join(root, 'SKILL.md')
  const capPath = join(root, 'capability-map.md')
  const descPath = join(root, 'description.txt')
  if (!existsSync(skillPath) || !existsSync(capPath)) {
    die(`locale ${locale}: need SKILL.md and capability-map.md under ${relative(ROOT, root)}`)
  }
  const skillBody = applyPlaceholders(readText(skillPath).replace(/\r\n/g, '\n').trimEnd() + '\n', vars)
  const capabilityMap = applyPlaceholders(readText(capPath).replace(/\r\n/g, '\n').trimEnd(), vars)
  let description = enFallback.description
  if (existsSync(descPath)) {
    description = applyPlaceholders(readText(descPath).replace(/\r\n/g, '\n').trim(), vars)
  } else if (locale === 'en') {
    description = enFallback.description
  }
  const refBodies = {}
  for (const name of REF_ORDER) {
    const p = join(root, 'references', name)
    if (!existsSync(p)) {
      if (locale === 'en') die(`missing reference: references/${name}`)
      // Fall back to English reference for partial locale packs
      refBodies[name] = enFallback.refBodies[name]
      console.warn(`[generate-product-content] locale ${locale}: using en fallback for references/${name}`)
    } else {
      refBodies[name] = applyPlaceholders(readText(p).replace(/\r\n/g, '\n').trimEnd() + '\n', vars)
    }
  }
  const sections = [
    {
      id: 'overview',
      titleKey: 'settings.productHelp.sections.overview',
      markdown: skillBody,
    },
    ...REF_ORDER.map((name) => ({
      id: REF_SECTION_META[name].id,
      titleKey: REF_SECTION_META[name].titleKey,
      markdown: refBodies[name],
    })),
  ]
  return { description, capabilityMap, sections, skillBody, refBodies }
}

function build() {
  const meta = loadMeta()
  const pkg = JSON.parse(readText(PKG))
  const productVersion = typeof pkg.version === 'string' ? pkg.version : die('package.json version missing')
  const vars = { HIP_PRODUCT_VERSION: productVersion }

  // Agent embeds stay English (model-facing).
  const skillBody = applyPlaceholders(readText(join(SOT, 'SKILL.md')).replace(/\r\n/g, '\n').trimEnd() + '\n', vars)
  const descEscaped = meta.description.replace(/"/g, '\\"')
  const skillMd =
    `---\nname: ${meta.skillName}\ndescription: "${descEscaped}"\n---\n\n` + skillBody

  const capabilityMap = applyPlaceholders(
    readText(join(SOT, 'capability-map.md')).replace(/\r\n/g, '\n').trimEnd(),
    vars,
  )
  const helpGuidance = applyPlaceholders(
    readText(join(SOT, 'help-guidance.md')).replace(/\r\n/g, '\n').trim(),
    vars,
  )
  const helpFallback = applyPlaceholders(
    readText(join(SOT, 'help-fallback.md')).replace(/\r\n/g, '\n').trim(),
    vars,
  )

  const refBodies = {}
  for (const name of REF_ORDER) {
    const p = join(SOT, 'references', name)
    if (!existsSync(p)) die(`missing reference: references/${name}`)
    refBodies[name] = applyPlaceholders(readText(p).replace(/\r\n/g, '\n').trimEnd() + '\n', vars)
  }

  const listed = new Set(REF_ORDER)
  for (const f of readdirSync(join(SOT, 'references'))) {
    if (!f.endsWith('.md')) continue
    if (!listed.has(f)) {
      console.warn(`[generate-product-content] warning: references/${f} not in REF_ORDER (skipped)`)
    }
  }

  const enPack = {
    description: meta.description,
    capabilityMap,
    skillBody,
    refBodies,
  }
  const localePacks = {}
  for (const loc of UI_LOCALES) {
    localePacks[loc] =
      loc === 'en'
        ? {
            description: meta.description,
            capabilityMap,
            sections: [
              { id: 'overview', titleKey: 'settings.productHelp.sections.overview', markdown: skillBody },
              ...REF_ORDER.map((name) => ({
                id: REF_SECTION_META[name].id,
                titleKey: REF_SECTION_META[name].titleKey,
                markdown: refBodies[name],
              })),
            ],
          }
        : loadUiLocalePack(loc, vars, enPack)
  }

  const fingerprint = createHash('sha256')
    .update(meta.skillVersion)
    .update('\0').update(skillMd)
    .update('\0').update(capabilityMap)
    .update('\0').update(helpGuidance)
    .update('\0').update(helpFallback)
  for (const name of REF_ORDER) {
    fingerprint.update('\0').update(name).update('\0').update(refBodies[name])
  }
  for (const loc of UI_LOCALES) {
    fingerprint.update('\0').update(loc).update('\0').update(localePacks[loc].description)
    fingerprint.update('\0').update(localePacks[loc].capabilityMap)
    for (const s of localePacks[loc].sections) {
      fingerprint.update('\0').update(s.id).update('\0').update(s.markdown)
    }
  }
  const contentHash = fingerprint.digest('hex').slice(0, 16)
  const header = `/**
 * AUTO-GENERATED by scripts/generate-product-content.mjs — DO NOT EDIT BY HAND.
 * Source of truth: docs/product/
 * Regenerate: yarn product:content
 * Check:      yarn product:content:check
 *
 * contentHash=${contentHash} skillVersion=${meta.skillVersion} productVersion=${productVersion}
 */`

  const sidecarOut = `${header}

/** Schema / materialization version for builtin skill files (from docs/product/meta.json). */
export const PRODUCT_SKILL_VERSION = ${asSingleQuoted(meta.skillVersion)}

/** App version from root package.json (also used in L0/L2 placeholders). */
export const HIP_PRODUCT_VERSION = ${asSingleQuoted(productVersion)}

export const HIP_SKILL_ID = ${asSingleQuoted(meta.skillId)}
export const HIP_SKILL_NAME = ${asSingleQuoted(meta.skillName)}

export const HIP_SKILL_DESCRIPTION = ${asSingleQuoted(meta.description)}

/** Level-2 body (frontmatter + markdown). */
export const HIP_SKILL_MD = \`${asTemplateLiteral(skillMd)}\`

export const MEMORY_REFERENCE_MD = \`${asTemplateLiteral(refBodies['memory.md'])}\`

export const CONFIG_REFERENCE_MD = \`${asTemplateLiteral(refBodies['config-and-data.md'])}\`

export const TROUBLESHOOTING_REFERENCE_MD = \`${asTemplateLiteral(refBodies['troubleshooting.md'])}\`

export const AGENTS_PLUGINS_REFERENCE_MD = \`${asTemplateLiteral(refBodies['agents-and-plugins.md'])}\`

/** L0 always-on product facts (main agent system prompt). */
export const PRODUCT_CAPABILITY_MAP = \`${asTemplateLiteral(capabilityMap)}\`

/** L0 help when hip skill is on the session skill list. */
export const PRODUCT_HELP_GUIDANCE = \`${asTemplateLiteral(helpGuidance)}\`

/** L0 help when hip skill is unavailable — never instruct use_skill("hip"). */
export const PRODUCT_HELP_FALLBACK = \`${asTemplateLiteral(helpFallback)}\`

/** Ordered materialization entries: relative path → body. */
export const PRODUCT_SKILL_FILES: ReadonlyArray<{ rel: string; body: string }> = [
  { rel: 'SKILL.md', body: HIP_SKILL_MD },
  { rel: 'references/memory.md', body: MEMORY_REFERENCE_MD },
  { rel: 'references/config-and-data.md', body: CONFIG_REFERENCE_MD },
  { rel: 'references/troubleshooting.md', body: TROUBLESHOOTING_REFERENCE_MD },
  { rel: 'references/agents-and-plugins.md', body: AGENTS_PLUGINS_REFERENCE_MD },
]
`

  function emitSections(sections) {
    return sections
      .map(
        (s) =>
          `  {\n    id: ${asSingleQuoted(s.id)},\n    titleKey: ${asSingleQuoted(s.titleKey)},\n    markdown: \`${asTemplateLiteral(s.markdown)}\`,\n  }`,
      )
      .join(',\n')
  }

  function emitPack(pack) {
    return `{
  description: ${asSingleQuoted(pack.description)},
  capabilityMap: \`${asTemplateLiteral(pack.capabilityMap)}\`,
  sections: [
${emitSections(pack.sections)}
  ],
}`
  }

  const sectionIds = localePacks.en.sections.map((s) => s.id)

  const uiOut = `${header}

export type ProductHelpSectionId = ${sectionIds.map((id) => asSingleQuoted(id)).join(' | ')}

/** UI product-help locale ids (matches app language tags). */
export type ProductHelpLocale = ${UI_LOCALES.map((l) => asSingleQuoted(l)).join(' | ')}

export interface ProductHelpSection {
  id: ProductHelpSectionId
  /** i18n key for the tab / nav label */
  titleKey: string
  /** Markdown body for this locale. */
  markdown: string
}

export interface ProductHelpLocalePack {
  description: string
  capabilityMap: string
  sections: readonly ProductHelpSection[]
}

/** App version from root package.json. */
export const HIP_PRODUCT_VERSION = ${asSingleQuoted(productVersion)}

/** Content schema version from docs/product/meta.json. */
export const PRODUCT_SKILL_VERSION = ${asSingleQuoted(meta.skillVersion)}

/** English defaults (agent-aligned). Prefer getProductHelpPack(lang) in UI. */
export const HIP_SKILL_DESCRIPTION = ${asSingleQuoted(meta.description)}

/** L0 capability map English (agent + default UI). */
export const PRODUCT_CAPABILITY_MAP = \`${asTemplateLiteral(capabilityMap)}\`

/** English help sections (backward compatible). */
export const PRODUCT_HELP_SECTIONS: readonly ProductHelpSection[] = [
${emitSections(localePacks.en.sections)}
] as const

/** All UI locales for Settings → Product help. Agent embeds stay English. */
export const PRODUCT_HELP_LOCALES: Record<ProductHelpLocale, ProductHelpLocalePack> = {
  en: ${emitPack(localePacks.en)},
  'zh-CN': ${emitPack(localePacks['zh-CN'])},
  'zh-TW': ${emitPack(localePacks['zh-TW'])},
}

/** Map app language / BCP-47 tag → product help locale. */
export function resolveProductHelpLocale(lang: string | null | undefined): ProductHelpLocale {
  const raw = (lang ?? '').trim()
  if (raw === 'zh-CN' || raw === 'zh-TW' || raw === 'en') return raw
  if (raw.startsWith('zh-TW') || raw.startsWith('zh-HK') || raw === 'zh-Hant') return 'zh-TW'
  if (raw.startsWith('zh')) return 'zh-CN'
  if (raw.startsWith('en')) return 'en'
  return 'en'
}

/** Locale pack for Settings Help; falls back to English. */
export function getProductHelpPack(lang: string | null | undefined): ProductHelpLocalePack {
  return PRODUCT_HELP_LOCALES[resolveProductHelpLocale(lang)]
}
`

  return { sidecarOut, uiOut, contentHash, productVersion, meta }
}

function checkReadmePaths() {
  const readme = readText(README)
  const missing = README_MUST_CONTAIN.filter((s) => !readme.includes(s))
  if (missing.length) {
    die(
      `README.md missing product path strings (update README or docs/product contract):\n  - ${missing.join('\n  - ')}`,
    )
  }
}

function checkTauriVersion(productVersion) {
  const tauriPath = join(ROOT, 'src-tauri', 'tauri.conf.json')
  if (!existsSync(tauriPath)) return
  try {
    const tauri = JSON.parse(readText(tauriPath))
    if (typeof tauri.version === 'string' && tauri.version !== productVersion) {
      die(
        `version mismatch: package.json=${productVersion} vs src-tauri/tauri.conf.json=${tauri.version}`,
      )
    }
  } catch (e) {
    die(`could not parse tauri.conf.json: ${e.message}`)
  }
}

function assertFresh(path, expected, label) {
  if (!existsSync(path)) die(`missing generated file: ${relative(ROOT, path)} — run yarn product:content`)
  const current = readFileSync(path, 'utf8')
  if (current !== expected) {
    die(`${label} is stale vs docs/product/. Run: yarn product:content`)
  }
}

function main() {
  const check = process.argv.includes('--check')
  const { sidecarOut, uiOut, contentHash, productVersion, meta } = build()
  checkReadmePaths()
  checkTauriVersion(productVersion)

  if (check) {
    assertFresh(OUT_SIDECAR, sidecarOut, 'sidecar content.ts')
    assertFresh(OUT_UI, uiOut, 'UI productDocs.generated.ts')
    console.log(
      `[generate-product-content] ok (check) hash=${contentHash} skill=${meta.skillVersion} product=${productVersion}`,
    )
    return
  }

  writeFileSync(OUT_SIDECAR, sidecarOut, 'utf8')
  writeFileSync(OUT_UI, uiOut, 'utf8')
  console.log(
    `[generate-product-content] wrote ${relative(ROOT, OUT_SIDECAR)} + ${relative(ROOT, OUT_UI)} hash=${contentHash} skill=${meta.skillVersion} product=${productVersion}`,
  )
}

main()
