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
    // Load .env / .env (etc.) into process.env so real-LLM test agents
    // can read DEEPSEEK_API_KEY. '' prefix loads unprefixed vars too.
    // See .env.example.
    env: loadEnv(mode, __dirname, ''),
  },
}))
