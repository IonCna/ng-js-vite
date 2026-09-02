import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Plugin } from "vite"
import { ngJsTemplateParser } from "./index.ts"

type TransformHook = Exclude<Plugin["transform"], undefined>
type GenerateBundleHook = Exclude<Plugin["generateBundle"], undefined>
type EmittedAsset = {
    type: "asset",
    fileName: string,
    source: string | Uint8Array,
}

const callTransform = (plugin: Plugin, context: unknown, source: string, id: string) => {
    return (plugin.transform as TransformHook & Function).call(context, source, id)
}

const callGenerateBundle = (plugin: Plugin, context: unknown) => {
    return (plugin.generateBundle as GenerateBundleHook & Function).call(context)
}

const dir = mkdtempSync(path.join(tmpdir(), "ng-js-vite-"))
const componentPath = path.join(dir, "app-root.component.ts")
const templatePath = path.join(dir, "app-root.html")
const stylePath = path.join(dir, "app-root.css")

writeFileSync(templatePath, "<div>hello</div>")
writeFileSync(stylePath, ".title { color: red; }")

const code = `angular.module("app").component("appRoot", { templateUrl: "./app-root.html" })`
const codeWithStyle = `angular.module("app").component("appRoot", { templateUrl: "./app-root.html", styleUrl: "./app-root.css" })`

afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
})

describe("ngJsTemplateParser transform", () => {
    test("hashed:true (default) rewrites templateUrl to a hashed templates/ path", async () => {
        const plugin = ngJsTemplateParser()
        const result = await callTransform(plugin, {}, code, componentPath)

        expect(result?.code).toMatch(/templateUrl: "\/?templates\/app-root-[0-9a-f]{8}\.html"/)
    })

    test("hashed:false still rewrites templateUrl, to a stable un-hashed templates/ path", async () => {
        const plugin = ngJsTemplateParser({ hashed: false })
        const result = await callTransform(plugin, {}, code, componentPath)

        expect(result?.code).toBe(code.replace("./app-root.html", "/templates/app-root.html"))
    })

    test("inlines styleUrl into the emitted template and removes styleUrl from code", async () => {
        const plugin = ngJsTemplateParser()
        const result = await callTransform(plugin, {}, codeWithStyle, componentPath)

        expect(result?.code).toMatch(/templateUrl: "\/?templates\/app-root-[0-9a-f]{8}\.html"/)
        expect(result?.code).not.toContain(`styleUrl: "./app-root.css"`)
        expect(result?.code).toContain("ngJsViteInlineStyle: true")
    })

    test("leaves code untouched when there is no templateUrl or styleUrl", async () => {
        const plugin = ngJsTemplateParser()
        const result = await callTransform(plugin, {}, "const x = 1", componentPath)

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
        const emits: EmittedAsset[] = []
        const ctx = {
            error: (m: string) => { throw new Error(m) },
            warn: (m: string) => warnings.push(m),
            emitFile: (f: EmittedAsset) => emits.push(f),
        }

        await callTransform(plugin, ctx, code, path.join(dir, "a", "x.component.ts"))
        await callTransform(plugin, ctx, code, path.join(dir, "b", "y.component.ts"))
        await callGenerateBundle(plugin, ctx)

        expect(emits).toHaveLength(1)
        const [emit] = emits
        expect(emit?.fileName).toBe(path.join("templates", "app-root.html"))
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain("two templates resolve to")
    })

    test("emits template assets with inlined styles", async () => {
        const plugin = ngJsTemplateParser()
        const emits: EmittedAsset[] = []
        const ctx = {
            error: (m: string) => { throw new Error(m) },
            warn: () => undefined,
            emitFile: (f: EmittedAsset) => emits.push(f),
        }

        await callTransform(plugin, ctx, codeWithStyle, componentPath)
        await callGenerateBundle(plugin, ctx)

        expect(emits).toHaveLength(1)
        const [emit] = emits
        const source = emit?.source.toString()

        expect(emit?.fileName).toMatch(/templates[\\/]app-root-[0-9a-f]{8}\.html/)
        expect(source).toContain("<style data-ng-js-vite>")
        expect(source).toContain(".title { color: red; }")
        expect(source).toContain("<div>hello</div>")
    })
})
