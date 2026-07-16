import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'packages/sidecar/src/**/*.test.ts',
      'packages/protocol/src/**/*.test.ts',
      'packages/cli/src/**/*.test.ts',
      'e2e/eval/**/*.test.ts',
    ],
    // Real-LLM suites read HIP_MODEL_<ID>_API_KEY. vitest.setup.ts seeds those from the
    // single source of truth (~/.hip/config/auth.json — the same file the desktop app
    // writes); when it's absent (e.g. CI) those suites skipIf-skip.
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**', 'packages/sidecar/src/**', 'packages/protocol/src/**'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.integration.test.ts',
        '**/*.contract.test.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/src-tauri/**',
        '**/coverage/**',
      ],
    },
  },
})
