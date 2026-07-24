Production sidecar runtime is staged here by `yarn sidecar:prod-bin`
(or the full packagers `yarn package:macos` / `yarn package:windows`):

  node / node.exe  - copy of the Node.js runtime (platform-native)
  index.js         - esbuild bundle of packages/sidecar
  package.json

These files are gitignored (large). NEVER ship with only this README.

  macOS:   yarn package:macos
  Windows: yarn package:windows

Bare `yarn tauri build` without prod-bin ships an empty hip-sidecar and
shows connection error on first launch.
