Production sidecar runtime is staged here by `yarn sidecar:prod-bin`
(or `yarn release:macos`):

  node       — copy of the Node.js runtime
  index.js   — esbuild bundle of packages/sidecar
  package.json

These files are gitignored (large). For a distributable DMG always run
`yarn release:macos`, which builds them before `tauri build`.
