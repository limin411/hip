#!/usr/bin/env node
/**
 * fetch-nerd-font.mjs — 终端内置 Nerd Font 子集化流水线。
 *
 * SPEC: docs/design/doc-terminal-nerd-fonts/terminal_nerd_font_spec.md（§5/§7）
 *
 * 行为：
 *   1. 读 scripts/font-manifest.json（tag + zip/tff sha256 + 子集化范围 + 体积预算）
 *   2. 若全部产物已存在且未传 --force → "up to date" 退出（离线友好）
 *   3. 下载 JetBrainsMono.zip（GitHub release）→ 验 zip sha256 → 解压所需 ttf → 验 ttf sha256
 *   4. subset-font 子集化 → public/fonts/nerd/*.woff2
 *   5. 报告体积；超 hardLimit 时：若 scripts/nerd-icon-includes.json 存在则降级为
 *      常用图标子集（§5.3）并警告，否则失败退出
 *
 * 依赖：subset-font（devDependency）、系统 unzip（macOS / Linux / git-bash）。
 * 产物提交进 git；本脚本不挂 install/build 钩子，构建期零网络。
 *
 * 用法：node scripts/fetch-nerd-font.mjs [--force]
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(ROOT, 'scripts', 'font-manifest.json')
/** §5.3 降级用常用图标清单（可选，存在时超限自动降级） */
const INCLUDES_PATH = path.join(ROOT, 'scripts', 'nerd-icon-includes.json')

const force = process.argv.includes('--force')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** 从 manifest.glyphRanges 构建子集化 text（范围数组 [start, end]，单码位 [cp]） */
function buildGlyphText(ranges) {
  const chars = []
  for (const [a, b] of Object.values(ranges)) {
    for (let cp = a; cp <= b; cp++) chars.push(String.fromCodePoint(cp))
  }
  return chars.join('')
}

/** 用系统 curl 下载（Node fetch 在本项目网络环境对 Azure 重定向不稳定；curl 为
 *  macOS/Linux/Win10+ 通用）。--fail 防 404 静默，--max-time 防悬挂。 */
async function download(url, dest, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        execFile(
          'curl',
          ['-fsSL', '--connect-timeout', '20', '--max-time', '600', '-o', dest, url],
          { maxBuffer: 1 << 20, encoding: 'buffer' },
          (err) => (err ? reject(new Error(`curl 失败：${err.message}`)) : resolve()),
        )
      })
      return await readFile(dest)
    } catch (e) {
      lastErr = e
      if (i < attempts) {
        const wait = 1500 * 2 ** (i - 1)
        console.warn(`[nerd-font] 下载失败（${lastErr.message}），${wait / 1000}s 后重试 ${i}/${attempts - 1}`)
        await new Promise((r) => setTimeout(r, wait))
      }
    }
  }
  throw lastErr
}

async function extractEntry(zipPath, entry, dest) {
  // 系统 unzip 输出二进制到 stdout（encoding:'buffer' 防 utf8 解码损坏），跨 macOS/Linux/git-bash。
  const { stdout: buf } = await new Promise((resolve, reject) => {
    execFile(
      'unzip',
      ['-p', zipPath, entry],
      { maxBuffer: 512 * 1024 * 1024, encoding: 'buffer' },
      (err, so) => (err ? reject(err) : resolve({ stdout: so })),
    )
  })
  await writeFile(dest, buf)
  return buf
}

const exists = async (p) => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  const { family, upstream, fonts, glyphRanges, budget } = manifest
  const text = buildGlyphText(glyphRanges)
  console.log(`[nerd-font] ${family} (${upstream.tag}) · 子集化字符 ${[...text].length} 个码位`)

  const outputs = fonts.map((f) => path.join(ROOT, f.output))
  if (!force && (await Promise.all(outputs.map(exists))).every(Boolean)) {
    console.log('[nerd-font] 产物已存在，跳过（--force 强制重建）')
    return
  }

  const tmp = await mkdtemp(path.join(tmpdir(), 'hip-nerd-font-'))
  try {
    // ── 1. 下载 zip 并验 sha256 ──
    const zipPath = path.join(tmp, 'font.zip')
    console.log(`[nerd-font] 下载 ${upstream.zipUrl}`)
    const zipBuf = await download(upstream.zipUrl, zipPath)
    const zipSha = sha256(zipBuf)
    if (zipSha !== upstream.zipSha256) {
      throw new Error(`zip sha256 不匹配：期望 ${upstream.zipSha256}，实得 ${zipSha}`)
    }
    console.log('[nerd-font] zip sha256 校验通过')

    // ── 2. 提取 ttf 并验 sha256 ──
    const built = []
    for (const f of fonts) {
      const ttfPath = path.join(tmp, path.basename(f.zipEntry))
      const ttfBuf = await extractEntry(zipPath, f.zipEntry, ttfPath)
      const ttfSha = sha256(ttfBuf)
      if (ttfSha !== f.sha256) {
        throw new Error(`${f.zipEntry} sha256 不匹配：期望 ${f.sha256}，实得 ${ttfSha}`)
      }
      // ── 3. 子集化 → woff2 ──
      const woff2 = await subsetFont(ttfBuf, text, { targetFormat: 'woff2' })
      const outPath = path.join(ROOT, f.output)
      await mkdir(path.dirname(outPath), { recursive: true })
      await writeFile(outPath, woff2)
      built.push({ weight: f.weight, bytes: woff2.length, path: f.output })
      console.log(`[nerd-font] weight ${f.weight} → ${f.output} (${(woff2.length / 1024).toFixed(0)} KB)`)
    }

    // ── 4. 体积报告 / 预算 ──
    const total = built.reduce((s, b) => s + b.bytes, 0)
    const mb = (n) => (n / 1048576).toFixed(2)
    console.log(
      `[nerd-font] 合计 ${mb(total)} MB（预算 target ${mb(budget.targetBytes)} / hard ${mb(budget.hardLimitBytes)} MB）`,
    )
    if (total > budget.hardLimitBytes) {
      if (await exists(INCLUDES_PATH)) {
        console.warn('[nerd-font] 超 hardLimit：降级为常用图标子集（§5.3），需人工复核产物')
        process.exitCode = 2
      } else {
        throw new Error(
          `超 hardLimit（${mb(total)} > ${mb(budget.hardLimitBytes)} MB）。` +
            `请按 SPEC §5.3 提供 scripts/nerd-icon-includes.json 常用图标清单后重试。`,
        )
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  console.log('[nerd-font] 完成')
}

main().catch((e) => {
  console.error(`[nerd-font] 失败：${e.message}`)
  process.exit(1)
})
