import { defineConfig } from "tsup"

export default defineConfig({
    entry: { index: "index.ts", core: "src/core.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    outDir: "dist",
    external: ["vite"],
})
