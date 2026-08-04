import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@hip/protocol": resolve(__dirname, "packages/protocol/src/index.ts"),
      "@": resolve(__dirname, "src"),
    },
    // BlockNote (TipTap) + Milkdown must share one prosemirror-view; two copies
    // break DecorationSet.locals (iterDeco crash on Live mount).
    dedupe: [
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-view",
      "prosemirror-transform",
      "prosemirror-tables",
      "prosemirror-keymap",
      "prosemirror-commands",
      "prosemirror-schema-list",
      "prosemirror-history",
      "prosemirror-gapcursor",
      "prosemirror-dropcursor",
      "prosemirror-inputrules",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
