import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import packageJson from "../../package.json";
import { brandHtml } from "./vite-plugin-brand-html";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  base: "/",
  plugins: [
    brandHtml(),
    tanstackRouter({ autoCodeSplitting: true }),
    tailwindcss(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
  ],
  server: {
    host: true,
    hmr: true,
    port: 5173,
  },
  optimizeDeps: {
    exclude: ["better-auth"],
  },
  ssr: {
    noExternal: ["better-auth"],
  },
  resolve: {
    // apps/web (the legacy Next app) pins react exactly 19.2.4 while this SPA
    // wants ^19.2.7, so the hoisted workspace tree carries two copies:
    // node_modules/react@19.2.8 and apps/web/node_modules/react@19.2.4.
    // Without dedupe, Vite pre-bundles both and every hook call throws
    // "Invalid hook call ... more than one copy of React". Remove once
    // apps/web is retired and only one React version remains.
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@i18n": path.resolve(__dirname, "../../i18n"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
    commonjsOptions: {
      include: [/better-auth/, /node_modules/],
      transformMixedEsModules: true,
    },
    target: "esnext",
  },
});
