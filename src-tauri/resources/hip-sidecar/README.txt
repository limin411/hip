Production sidecar runtime is staged here by `yarn sidecar:prod-bin`
(or `yarn release:macos` / `yarn release:windows`):

  node / node.exe  — copy of the Node.js runtime (platform-native)
  index.js         — esbuild bundle of packages/sidecar
  package.json

These files are gitignored (large). For a distributable installer ALWAYS run
`yarn sidecar:prod-bin` on the *target OS* before `yarn tauri build`.

Windows: if this folder only contains README.txt after install, the build
skipped prod-bin (or used the dev sidecar launcher). Result: UI shows
「连接错误」and tauri.log only has sidecar:spawn → sidecar:exit.
