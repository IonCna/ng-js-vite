import { defineConfig } from "tsup"

export default defineConfig({
    entry: { vite: "vite.ts", esbuild: "esbuild.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    outDir: "dist",
    external: ["vite"],
})
