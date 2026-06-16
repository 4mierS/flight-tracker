import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

/**
 * One config builds three things:
 *  - renderer (React) → dist/renderer
 *  - Electron main    → dist/desktop/main.mjs (ESM; @prisma/client kept external)
 *  - preload bridge   → dist/desktop/preload.cjs (CommonJS for sandboxed preload)
 */
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "src/desktop/main.ts",
        vite: {
          build: {
            outDir: "dist/desktop",
            emptyOutDir: false,
            rollupOptions: {
              // Native/generated deps must not be bundled; resolved at runtime.
              external: ["electron", "@prisma/client", ".prisma/client"],
              output: { entryFileNames: "main.mjs", format: "esm" },
            },
          },
        },
      },
      preload: {
        input: "src/desktop/preload.ts",
        vite: {
          build: {
            outDir: "dist/desktop",
            emptyOutDir: false,
            rollupOptions: {
              external: ["electron"],
              output: { entryFileNames: "preload.cjs", format: "cjs" },
            },
          },
        },
      },
    }),
  ],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
});
