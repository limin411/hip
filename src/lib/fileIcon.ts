/**
 * File-type icons for tree / list UIs (VS Code Material Icon Theme style).
 *
 * Best practices applied:
 * - Match by basename specials first (Dockerfile, package.json), then multi-dot
 *   tails (*.d.ts, *.test.tsx), then single extension.
 * - Color encodes type at a glance; icons stay outline (lucide) for theme fit.
 * - Light + dark pairs keep readable contrast on surface backgrounds.
 * - Prefer a small, stable palette over one-off hex per language.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Binary,
  BookOpen,
  Braces,
  Code2,
  Coffee,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Hash,
  Package,
  Settings2,
  Terminal,
} from 'lucide-react'

export type FileIconSpec = {
  Icon: LucideIcon
  /** Tailwind text color classes (include dark: variants). */
  className: string
}

/** Semantic color tokens reused across related extensions. */
const C = {
  ts: 'text-sky-600 dark:text-sky-400',
  js: 'text-amber-600 dark:text-amber-400',
  react: 'text-cyan-600 dark:text-cyan-400',
  py: 'text-blue-600 dark:text-blue-400',
  rust: 'text-orange-700 dark:text-orange-400',
  go: 'text-cyan-700 dark:text-cyan-300',
  java: 'text-red-700 dark:text-red-400',
  csharp: 'text-violet-700 dark:text-violet-400',
  ruby: 'text-rose-700 dark:text-rose-400',
  php: 'text-indigo-600 dark:text-indigo-400',
  swift: 'text-orange-600 dark:text-orange-300',
  kotlin: 'text-purple-600 dark:text-purple-400',
  json: 'text-yellow-700 dark:text-yellow-400',
  yaml: 'text-rose-600 dark:text-rose-400',
  md: 'text-slate-600 dark:text-slate-300',
  html: 'text-orange-600 dark:text-orange-400',
  css: 'text-violet-600 dark:text-violet-400',
  shell: 'text-emerald-700 dark:text-emerald-400',
  docker: 'text-sky-700 dark:text-sky-300',
  sql: 'text-teal-700 dark:text-teal-400',
  image: 'text-fuchsia-600 dark:text-fuchsia-400',
  video: 'text-pink-600 dark:text-pink-400',
  audio: 'text-pink-700 dark:text-pink-300',
  archive: 'text-amber-800 dark:text-amber-500',
  config: 'text-zinc-600 dark:text-zinc-400',
  data: 'text-lime-700 dark:text-lime-400',
  pdf: 'text-red-600 dark:text-red-400',
  default: 'text-ink-tertiary',
  c: 'text-blue-700 dark:text-blue-300',
  cpp: 'text-blue-600 dark:text-blue-400',
  toml: 'text-stone-600 dark:text-stone-400',
  xml: 'text-orange-700 dark:text-orange-300',
  graphql: 'text-pink-600 dark:text-pink-400',
  lock: 'text-zinc-500 dark:text-zinc-400',
  package: 'text-red-600 dark:text-red-400',
  elixir: 'text-purple-700 dark:text-purple-400',
  haskell: 'text-violet-700 dark:text-violet-400',
  scala: 'text-red-700 dark:text-red-400',
  erlang: 'text-rose-700 dark:text-rose-400',
} as const

const DEFAULT: FileIconSpec = { Icon: File, className: C.default }

/** Basename (lowercased, no path) → icon. Checked before extensions. */
const BASENAME: Readonly<Record<string, FileIconSpec>> = {
  dockerfile: { Icon: Package, className: C.docker },
  containerfile: { Icon: Package, className: C.docker },
  makefile: { Icon: Settings2, className: C.config },
  gnumakefile: { Icon: Settings2, className: C.config },
  'package.json': { Icon: Package, className: C.package },
  'package-lock.json': { Icon: FileJson, className: C.lock },
  'pnpm-lock.yaml': { Icon: FileJson, className: C.lock },
  'yarn.lock': { Icon: FileJson, className: C.lock },
  'bun.lock': { Icon: FileJson, className: C.lock },
  'bun.lockb': { Icon: Binary, className: C.lock },
  'cargo.toml': { Icon: Settings2, className: C.rust },
  'cargo.lock': { Icon: FileJson, className: C.lock },
  'go.mod': { Icon: FileCode, className: C.go },
  'go.sum': { Icon: FileJson, className: C.lock },
  'tsconfig.json': { Icon: FileCog, className: C.ts },
  'jsconfig.json': { Icon: FileCog, className: C.js },
  'composer.json': { Icon: Package, className: C.php },
  'pyproject.toml': { Icon: Settings2, className: C.py },
  'requirements.txt': { Icon: FileText, className: C.py },
  gemfile: { Icon: Package, className: C.ruby },
  rakefile: { Icon: Settings2, className: C.ruby },
  procfile: { Icon: Settings2, className: C.config },
  license: { Icon: BookOpen, className: C.md },
  'license.md': { Icon: BookOpen, className: C.md },
  'license.txt': { Icon: BookOpen, className: C.md },
  readme: { Icon: BookOpen, className: C.md },
  'readme.md': { Icon: BookOpen, className: C.md },
  'readme.mdx': { Icon: BookOpen, className: C.md },
  changelog: { Icon: BookOpen, className: C.md },
  'changelog.md': { Icon: BookOpen, className: C.md },
  '.gitignore': { Icon: FileCog, className: C.config },
  '.gitattributes': { Icon: FileCog, className: C.config },
  '.gitmodules': { Icon: FileCog, className: C.config },
  '.dockerignore': { Icon: FileCog, className: C.docker },
  '.env': { Icon: FileCog, className: C.config },
  '.env.local': { Icon: FileCog, className: C.config },
  '.env.example': { Icon: FileCog, className: C.config },
  '.editorconfig': { Icon: FileCog, className: C.config },
  '.npmrc': { Icon: FileCog, className: C.config },
  '.nvmrc': { Icon: FileCog, className: C.config },
  '.eslintrc': { Icon: FileCog, className: C.config },
  '.prettierrc': { Icon: FileCog, className: C.config },
}

/**
 * Multi-dot / compound tails (lowercased, no leading dot), longest first.
 * e.g. "d.ts", "test.tsx", "module.css"
 */
const COMPOUND: Readonly<Record<string, FileIconSpec>> = {
  'd.ts': { Icon: FileCode, className: C.ts },
  'd.mts': { Icon: FileCode, className: C.ts },
  'd.cts': { Icon: FileCode, className: C.ts },
  'test.ts': { Icon: FileCode, className: C.ts },
  'spec.ts': { Icon: FileCode, className: C.ts },
  'test.tsx': { Icon: FileCode, className: C.react },
  'spec.tsx': { Icon: FileCode, className: C.react },
  'test.js': { Icon: FileCode, className: C.js },
  'spec.js': { Icon: FileCode, className: C.js },
  'test.jsx': { Icon: FileCode, className: C.react },
  'spec.jsx': { Icon: FileCode, className: C.react },
  'module.css': { Icon: Hash, className: C.css },
  'module.scss': { Icon: Hash, className: C.css },
  'stories.tsx': { Icon: FileCode, className: C.react },
  'stories.jsx': { Icon: FileCode, className: C.react },
  'stories.ts': { Icon: FileCode, className: C.ts },
  'stories.js': { Icon: FileCode, className: C.js },
}

/** Single extension without leading dot → icon. */
const EXT: Readonly<Record<string, FileIconSpec>> = {
  // TypeScript / JavaScript
  ts: { Icon: FileCode, className: C.ts },
  mts: { Icon: FileCode, className: C.ts },
  cts: { Icon: FileCode, className: C.ts },
  tsx: { Icon: FileCode, className: C.react },
  js: { Icon: FileCode, className: C.js },
  mjs: { Icon: FileCode, className: C.js },
  cjs: { Icon: FileCode, className: C.js },
  jsx: { Icon: FileCode, className: C.react },
  // Web
  html: { Icon: Code2, className: C.html },
  htm: { Icon: Code2, className: C.html },
  xhtml: { Icon: Code2, className: C.html },
  css: { Icon: Hash, className: C.css },
  scss: { Icon: Hash, className: C.css },
  sass: { Icon: Hash, className: C.css },
  less: { Icon: Hash, className: C.css },
  // Data / config
  json: { Icon: FileJson, className: C.json },
  jsonc: { Icon: FileJson, className: C.json },
  json5: { Icon: FileJson, className: C.json },
  yml: { Icon: FileCode, className: C.yaml },
  yaml: { Icon: FileCode, className: C.yaml },
  toml: { Icon: FileCog, className: C.toml },
  ini: { Icon: FileCog, className: C.config },
  cfg: { Icon: FileCog, className: C.config },
  conf: { Icon: FileCog, className: C.config },
  properties: { Icon: FileCog, className: C.config },
  env: { Icon: FileCog, className: C.config },
  // Docs
  md: { Icon: FileText, className: C.md },
  markdown: { Icon: FileText, className: C.md },
  mdx: { Icon: FileText, className: C.md },
  rst: { Icon: FileText, className: C.md },
  txt: { Icon: FileText, className: C.default },
  pdf: { Icon: FileType, className: C.pdf },
  // Systems languages
  rs: { Icon: FileCode, className: C.rust },
  go: { Icon: FileCode, className: C.go },
  py: { Icon: FileCode, className: C.py },
  pyi: { Icon: FileCode, className: C.py },
  pyw: { Icon: FileCode, className: C.py },
  java: { Icon: Coffee, className: C.java },
  class: { Icon: Binary, className: C.java },
  jar: { Icon: FileArchive, className: C.java },
  kt: { Icon: FileCode, className: C.kotlin },
  kts: { Icon: FileCode, className: C.kotlin },
  cs: { Icon: FileCode, className: C.csharp },
  fs: { Icon: FileCode, className: C.csharp },
  fsx: { Icon: FileCode, className: C.csharp },
  rb: { Icon: FileCode, className: C.ruby },
  erb: { Icon: FileCode, className: C.ruby },
  php: { Icon: FileCode, className: C.php },
  swift: { Icon: FileCode, className: C.swift },
  c: { Icon: FileCode, className: C.c },
  h: { Icon: FileCode, className: C.c },
  cc: { Icon: FileCode, className: C.cpp },
  cpp: { Icon: FileCode, className: C.cpp },
  cxx: { Icon: FileCode, className: C.cpp },
  hh: { Icon: FileCode, className: C.cpp },
  hpp: { Icon: FileCode, className: C.cpp },
  m: { Icon: FileCode, className: C.swift },
  mm: { Icon: FileCode, className: C.cpp },
  // Shell / scripts
  sh: { Icon: Terminal, className: C.shell },
  bash: { Icon: Terminal, className: C.shell },
  zsh: { Icon: Terminal, className: C.shell },
  fish: { Icon: Terminal, className: C.shell },
  ps1: { Icon: Terminal, className: C.shell },
  psm1: { Icon: Terminal, className: C.shell },
  bat: { Icon: Terminal, className: C.shell },
  cmd: { Icon: Terminal, className: C.shell },
  // Data / DB
  sql: { Icon: Database, className: C.sql },
  sqlite: { Icon: Database, className: C.sql },
  db: { Icon: Database, className: C.sql },
  csv: { Icon: FileSpreadsheet, className: C.data },
  tsv: { Icon: FileSpreadsheet, className: C.data },
  tab: { Icon: FileSpreadsheet, className: C.data },
  xls: { Icon: FileSpreadsheet, className: C.data },
  xlsx: { Icon: FileSpreadsheet, className: C.data },
  // Markup / schema
  xml: { Icon: Code2, className: C.xml },
  xsd: { Icon: Code2, className: C.xml },
  plist: { Icon: Code2, className: C.xml },
  svg: { Icon: FileImage, className: C.image },
  graphql: { Icon: Braces, className: C.graphql },
  gql: { Icon: Braces, className: C.graphql },
  proto: { Icon: Braces, className: C.config },
  // Images
  png: { Icon: FileImage, className: C.image },
  jpg: { Icon: FileImage, className: C.image },
  jpeg: { Icon: FileImage, className: C.image },
  gif: { Icon: FileImage, className: C.image },
  webp: { Icon: FileImage, className: C.image },
  bmp: { Icon: FileImage, className: C.image },
  ico: { Icon: FileImage, className: C.image },
  avif: { Icon: FileImage, className: C.image },
  // Media
  mp4: { Icon: FileVideo, className: C.video },
  webm: { Icon: FileVideo, className: C.video },
  mov: { Icon: FileVideo, className: C.video },
  mkv: { Icon: FileVideo, className: C.video },
  avi: { Icon: FileVideo, className: C.video },
  mp3: { Icon: FileAudio, className: C.audio },
  wav: { Icon: FileAudio, className: C.audio },
  flac: { Icon: FileAudio, className: C.audio },
  ogg: { Icon: FileAudio, className: C.audio },
  m4a: { Icon: FileAudio, className: C.audio },
  // Archives / binaries
  zip: { Icon: FileArchive, className: C.archive },
  tar: { Icon: FileArchive, className: C.archive },
  gz: { Icon: FileArchive, className: C.archive },
  tgz: { Icon: FileArchive, className: C.archive },
  bz2: { Icon: FileArchive, className: C.archive },
  '7z': { Icon: FileArchive, className: C.archive },
  rar: { Icon: FileArchive, className: C.archive },
  dmg: { Icon: FileArchive, className: C.archive },
  wasm: { Icon: Binary, className: C.config },
  bin: { Icon: Binary, className: C.config },
  exe: { Icon: Binary, className: C.config },
  dll: { Icon: Binary, className: C.config },
  so: { Icon: Binary, className: C.config },
  dylib: { Icon: Binary, className: C.config },
  // Misc languages
  lua: { Icon: FileCode, className: C.js },
  r: { Icon: FileCode, className: C.ts },
  dart: { Icon: FileCode, className: C.react },
  vue: { Icon: FileCode, className: C.shell },
  svelte: { Icon: FileCode, className: C.html },
  astro: { Icon: FileCode, className: C.html },
  zig: { Icon: FileCode, className: C.config },
  nim: { Icon: FileCode, className: C.config },
  ex: { Icon: FileCode, className: C.elixir },
  exs: { Icon: FileCode, className: C.elixir },
  erl: { Icon: FileCode, className: C.erlang },
  hs: { Icon: FileCode, className: C.haskell },
  scala: { Icon: FileCode, className: C.scala },
  clj: { Icon: FileCode, className: C.shell },
  cljs: { Icon: FileCode, className: C.shell },
  elm: { Icon: FileCode, className: C.ts },
  // Diff / lock / log
  diff: { Icon: FileCode, className: C.config },
  patch: { Icon: FileCode, className: C.config },
  lock: { Icon: FileJson, className: C.lock },
  log: { Icon: FileText, className: C.default },
}

function basenameOf(pathOrName: string): string {
  if (typeof pathOrName !== 'string' || !pathOrName) return ''
  const parts = pathOrName.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || pathOrName
}

/** Longest compound tail that matches the lowercased basename. */
function matchCompound(lowerBase: string): FileIconSpec | undefined {
  let best: FileIconSpec | undefined
  let bestLen = 0
  for (const [tail, spec] of Object.entries(COMPOUND)) {
    if (lowerBase.endsWith(`.${tail}`) && tail.length > bestLen) {
      best = spec
      bestLen = tail.length
    }
  }
  return best
}

/**
 * Resolve a lucide icon + color class for a file name or path.
 * Directories are not handled — callers keep Folder / FolderOpen.
 */
export function fileIconForName(pathOrName: string): FileIconSpec {
  const base = basenameOf(pathOrName)
  if (!base) return DEFAULT
  const lower = base.toLowerCase()

  const byBase = BASENAME[lower]
  if (byBase) return byBase

  const compound = matchCompound(lower)
  if (compound) return compound

  // Extension: last segment after final dot (dotfiles like `.env` handled in BASENAME).
  const dot = lower.lastIndexOf('.')
  if (dot > 0 && dot < lower.length - 1) {
    const ext = lower.slice(dot + 1)
    const byExt = EXT[ext]
    if (byExt) return byExt
  }

  return DEFAULT
}
