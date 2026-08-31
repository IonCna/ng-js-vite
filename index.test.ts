import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ngJsTemplateParser } from "./index.ts"

const dir = mkdtempSync(path.join(tmpdir(), "ng-js-vite-"))
const componentPath = path.join(dir, "app-root.component.ts")
const templatePath = path.join(dir, "app-root.html")

writeFileSync(templatePath, "<div>hello</div>")

const code = `angular.module("app").component("appRoot", { templateUrl: "./app-root.html" })`

afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
})

describe("ngJsTemplateParser transform", () => {
    test("hashed:true (default) rewrites templateUrl to a hashed templates/ path", async () => {
        const plugin = ngJsTemplateParser()
        const result = await (plugin.transform as any).call({}, code, componentPath)

        expect(result?.code).toMatch(/templateUrl: "templates\/app-root-[0-9a-f]{8}\.html"/)
    })

    test("hashed:false still rewrites templateUrl, to a stable un-hashed templates/ path", async () => {
        const plugin = ngJsTemplateParser({ hashed: false })
        const result = await (plugin.transform as any).call({}, code, componentPath)

        expect(result?.code).toBe(code.replace("./app-root.html", "templates/app-root.html"))
    })

    test("leaves code untouched when there is no templateUrl", async () => {
        const plugin = ngJsTemplateParser()
        const result = await (plugin.transform as any).call({}, "const x = 1", componentPath)

        expect(result).toBeUndefined()
    })
})

describe("ngJsTemplateParser generateBundle", () => {
    test("hashed:false warns and skips when two templates collide on the same output name", async () => {
        mkdirSync(path.join(dir, "a"))
        mkdirSync(path.join(dir, "b"))
        writeFileSync(path.join(dir, "a", "app-root.html"), "<div>a</div>")
        writeFileSync(path.join(dir, "b", "app-root.html"), "<div>b</div>")

        const plugin = ngJsTemplateParser({ hashed: false })
        const warnings: string[] = []
        const emits: any[] = []
        const ctx = {
            error: (m: string) => { throw new Error(m) },
            warn: (m: string) => warnings.push(m),
            emitFile: (f: any) => emits.push(f),
        }

        await (plugin.transform as any).call(ctx, code, path.join(dir, "a", "x.component.ts"))
        await (plugin.transform as any).call(ctx, code, path.join(dir, "b", "y.component.ts"))
        await (plugin.generateBundle as any).call(ctx)

        expect(emits).toHaveLength(1)
        expect(emits[0].fileName).toBe(path.join("templates", "app-root.html"))
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain("two templates resolve to")
    })
})
