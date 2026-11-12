import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Built into ../web/editor (embedded in the Go binary and served by `fpn serve`
// at /__editor/). `npm run dev` proxies the API and site to a running
// `fpn serve` on :1313 for hot reload while working on the editor.
export default defineConfig({
  base: "/__editor/",
  plugins: [react()],
  resolve: {
    alias: {
      // Monaco's internals, bypassing its package "exports" (used by src/monaco-slim.js).
      "monaco-esm": fileURLToPath(new URL("./node_modules/monaco-editor/esm/vs", import.meta.url)),
    },
  },
  build: {
    outDir: "../web/editor",
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
  server: {
    port: 5173,
    proxy: {
      "/__api": "http://localhost:1313",
      "^/(?!__editor|@|src/|node_modules/).*": "http://localhost:1313",
    },
  },
});
