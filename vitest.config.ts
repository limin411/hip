import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { resolve } from 'path'

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'packages/sidecar/src/**/*.test.ts'],
    // Load .env (and .env.local etc.) into process.env so the real-LLM test
    // suites can read HIP_MODEL_DEEPSEEK_API_KEY; without it they skipIf-skip. The ''
    // prefix loads unprefixed vars too. See .env.example.
    env: loadEnv(mode, __dirname, ''),
  },
}))
