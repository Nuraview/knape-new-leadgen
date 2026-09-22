import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      enabled: false,
    },
  },
  resolve: {
    // Mirrors vite.config.ts: a duplicated prosemirror-model breaks every
    // cross-copy Fragment/Node call, which is exactly what mention insertion hits.
    dedupe: [
      "prosemirror-model",
      "prosemirror-transform",
      "prosemirror-view",
      "prosemirror-state",
    ],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@i18n": path.resolve(__dirname, "../../i18n"),
    },
  },
});
