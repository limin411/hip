---
name: release
description: >-
  Bump version, commit, tag, and publish a GitHub release for the hip project.
  Use when cutting a new version, creating releases, or when the user says
  "release", "publish", "打版本", "发版".
---

# Release process (hip)

## Steps

### 1. Bump version (3 个手写文件 + 1 个生成物！)

Update version in **all three** handwritten files:

- `package.json` → `"version": "X.Y.Z"`
- `src-tauri/Cargo.toml` → `version = "X.Y.Z"`
- `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"` ← **容易漏！这是 Tauri 实际打包版本**

Then regenerate the generated product-content file — **第 4 处，漏了它 App 内版本号还是旧的**：

```bash
yarn product:content      # 重写 packages/sidecar/src/session/product/content.ts
yarn product:content:check
```

`generate-product-content.mjs` 只校验 `package.json` vs `tauri.conf.json`（会报错），
但**不校验生成物**，所以这一步必须自己记得跑。`HIP_PRODUCT_VERSION` 与 L0 的
`- Version:` 都在里面。

### 2. Verify build

```bash
cd /d/0_code_project/my-life/hip
npx tsc --noEmit          # TypeScript（或 yarn type-check）
cd src-tauri && cargo build  # Rust (needs Zig 0.15.2 in PATH + proxy for deps)
```

**没有 Zig 时不要硬跑 `cargo build`**（libghostty-vt 的 build script 会卡住）。
只做 manifest/lock 层的校验即可：

```bash
cargo metadata --offline --format-version 1 > /dev/null   # 校验 manifest + 刷 Cargo.lock
```

> 若本次**由 GitHub Actions 打包**（本地不出安装包），这一步就够，Rust 编译交给 CI。
### 3. Commit & tag

```bash
git add -A
git commit -m "vX.Y.Z: <summary>"
git tag vX.Y.Z
```

### 4. Push

```bash
git push origin dev --tags
```

### 5. Create GitHub Release

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "## vX.Y.Z — <title>

### 新增
- ...

### 修复
- ...

### 已知问题
- ..."
```

Release URL: https://github.com/limin411/hip/releases

## GitHub Actions 打包（推荐）

`.github/workflows/release.yml` 的触发条件是：

```yaml
on:
  release:
    types: [published]
```

**只 push tag 不会触发，必须先 push tag、再 `gh release create`**。Release 一经发布，
CI 自动在 macOS / Windows 上构建并把 `.dmg` / `hip.app.tar.gz` / NSIS `.exe` 上传为
Release assets。双平台约 25–30 分钟（v2.0.2 实测 27m30s）。触发后可用下面命令盯：

```bash
gh run list --workflow=release --limit 5
gh run watch <run-id>
```

也支持手动补传资产到已有 tag：

```bash
gh workflow run release.yml -f tag=v2.0.3
```

## Gotchas

- **四处** for version bump — `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`，
  外加生成物 `packages/sidecar/src/session/product/content.ts`（`yarn product:content`）。
  漏掉 `tauri.conf.json` 会导致打包版本号错误（2026-08 实际踩坑）。
- **Release notes 很长时别用 `--notes "..."`**：写临时 md 文件再 `--notes-file <path>`，
  省掉 shell 对中文、反引号、`$` 的转义麻烦。
- Release notes 内容来源：`git log vX.Y.Z..HEAD --pretty=format:'%s'`，按
  新增 / 修复 / 移除 / 工程 / 已知问题 分段。
- **Cargo.lock** auto-updates on `cargo build` — commit it too.
- `gh` CLI must be authenticated: `gh auth status`.
- Tag name must match `vX.Y.Z` format (with `v` prefix).
- Creating a git tag alone does NOT create a GitHub Release. Must use `gh release create`.
- Proxy needed for Rust/Zig builds: `export https_proxy=http://10.155.150.169:7890`
- Zig 0.15.2 needed in PATH for libghostty-vt: `export PATH="/tmp/zig-install-0.15/zig-x86_64-windows-0.15.2:$PATH"`

## Quick reference

```bash
# One-liner (after version bump + build verify)
git add -A && git commit -m "v1.0.8: description" && git tag v1.0.8 && git push origin dev --tags && gh release create v1.0.8 --title "v1.0.8" --notes "Release notes here"
```
