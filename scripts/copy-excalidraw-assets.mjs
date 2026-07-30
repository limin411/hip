/**
 * Copy @excalidraw/excalidraw production fonts into public/excalidraw-assets/fonts
 * so EXCALIDRAW_ASSET_PATH can load them offline (no esm.sh CDN).
 *
 * Run: node scripts/copy-excalidraw-assets.mjs
 * Wired as postinstall so yarn install keeps assets in sync with the locked package.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
// package.json is not in "exports"; resolve by well-known node_modules path.
const pkgRoot = join(root, 'node_modules', '@excalidraw', 'excalidraw')
const srcFonts = join(pkgRoot, 'dist', 'prod', 'fonts')
const destRoot = join(root, 'public', 'excalidraw-assets')
const destFonts = join(destRoot, 'fonts')

if (!existsSync(pkgRoot) || !existsSync(srcFonts)) {
  console.warn(
    `[copy-excalidraw-assets] fonts not found at ${srcFonts}; skip (install deps first)`,
  )
  process.exit(0)
}

mkdirSync(destRoot, { recursive: true })
if (existsSync(destFonts)) {
  rmSync(destFonts, { recursive: true, force: true })
}
cpSync(srcFonts, destFonts, { recursive: true })

// Attribution note kept next to redistributed fonts (SIL/OFL families vary by face).
writeFileSync(
  join(destRoot, 'FONTS-LICENSE.txt'),
  [
    'Fonts bundled from @excalidraw/excalidraw (MIT) for offline hip whiteboards.',
    'Individual typefaces ship under their own licenses (typically SIL Open Font License).',
    'Source package: node_modules/@excalidraw/excalidraw/dist/prod/fonts',
    'See the hip NOTICE file and the upstream Excalidraw project for details.',
    '',
  ].join('\n'),
  'utf8',
)

console.log(`[copy-excalidraw-assets] copied fonts → ${destFonts}`)
