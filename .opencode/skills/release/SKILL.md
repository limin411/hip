---
name: release
description: >-
  Bump version, commit, tag, and publish a GitHub release for the hip project.
  Use when cutting a new version, creating releases, or when the user says
  "release", "publish", "打版本", "发版".
---

# Release process (hip)

## Steps

### 1. Bump version

Update version in **both** files:

- `package.json` → `"version": "X.Y.Z"`
- `src-tauri/Cargo.toml` → `version = "X.Y.Z"`

### 2. Verify build

```bash
cd /d/0_code_project/my-life/hip
npx tsc --noEmit          # TypeScript
cd src-tauri && cargo build  # Rust (needs Zig 0.15.2 in PATH + proxy for deps)
```

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

## Gotchas

- **Two files** for version bump — `package.json` AND `src-tauri/Cargo.toml`. Missing one causes mismatch.
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
