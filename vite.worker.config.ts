import { defineConfig } from "vite";

/**
 * Standalone build for the worker, emitted to dist/worker/index.mjs. The desktop
 * app spawns this in PACKAGED builds; in dev it runs the TS source via tsx, so
 * this is intentionally separate from the main vite/electron build.
 *
 * @prisma/client is kept external (resolved from node_modules at runtime), same
 * as the Electron main process.
 */
export default defineConfig({
  build: {
    outDir: "dist/worker",
    emptyOutDir: false,
    ssr: true, // Node target: don't bundle/transform for the browser.
    rollupOptions: {
      input: "src/worker/index.ts",
      external: ["@prisma/client", ".prisma/client"],
      output: { entryFileNames: "index.mjs", format: "esm" },
    },
  },
});
