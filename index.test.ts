import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Plugin } from "vite"
import { ngJsTemplateParser } from "./index.ts"
import {FileReader} from "@ng-js-vite/reading/file-resolver"

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

const callConfigResolved = (plugin: Plugin, config: {root: string, base: string}) => {
    return (plugin.configResolved as Function).call({}, config)
}

const callLoad = (plugin: Plugin, id: string) => {
    return (plugin.load as Function).call({}, id)
}

const styleImportId = (transformedCode: string | undefined) => {
    const [, quoted] = transformedCode?.match(/^import ("[^"]+\.css")/) ?? []
    if (!quoted) throw new Error("no style import found in transformed code")
    return JSON.parse(quoted) as string
}

const dir = mkdtempSync(path.join(tmpdir(), "ng-js-vite-"))
const componentPath = path.join(dir, "app-root.component.ts")
const templatePath = path.join(dir, "app-root.html")
const stylePath = path.join(dir, "app-root.css")

writeFileSync(templatePath, "<div>hello</div>")
writeFileSync(stylePath, ".title { color: red; }")

const code = `angular.module("app").component("appRoot", { templateUrl: "./app-root.html" })`
const codeWithStyle = `angular.module("app").component("appRoot", { templateUrl: "./app-root.html", styleUrl: "./app-root.css" })`

beforeEach(() => FileReader.configure(dir, "/"))

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

    test("rewrites templateUrl, imports the component's styles as a virtual module, and leaves the code's styleUrl untouched", async () => {
        const plugin = ngJsTemplateParser()
        const result = await callTransform(plugin, {}, codeWithStyle, componentPath)

        expect(result?.code).toMatch(/^import "[^"]+\.css";\n/)
        expect(result?.code).toMatch(/templateUrl: "\/?templates\/app-root-[0-9a-f]{8}\.html"/)
        expect(result?.code).toContain(`styleUrl: "./app-root.css"`)
    })

    test("leaves code untouched when there is no templateUrl or styleUrl", async () => {
        const plugin = ngJsTemplateParser()
        const result = await callTransform(plugin, {}, "const x = 1", componentPath)

        expect(result).toBeUndefined()
    })

    test("ignores unsupported files and dependencies", async () => {
        const plugin = ngJsTemplateParser()

        expect(await callTransform(plugin, {}, code, path.join(dir, "component.html"))).toBeUndefined()
        expect(await callTransform(plugin, {}, code, path.join(dir, "node_modules", "pkg", "component.ts"))).toBeUndefined()
    })

    test("uses the configured Vite root and base", async () => {
        const rootedTemplate = path.join(dir, "views", "rooted.html")
        mkdirSync(path.dirname(rootedTemplate), {recursive: true})
        writeFileSync(rootedTemplate, "<div>rooted</div>")
        const plugin = ngJsTemplateParser({hashed: false})
        callConfigResolved(plugin, {root: dir, base: "/application"})

        const result = await callTransform(
            plugin,
            {},
            `{ templateUrl: "/views/rooted.html" }`,
            componentPath,
        )

        expect(result?.code).toBe(`{ templateUrl: "/application/templates/rooted.html" }`)
    })

    test("scopes and exposes each component's styles independently", async () => {
        const firstDir = path.join(dir, "hash-style-a")
        const secondDir = path.join(dir, "hash-style-b")
        mkdirSync(firstDir, {recursive: true})
        mkdirSync(secondDir, {recursive: true})
        for (const target of [firstDir, secondDir]) {
            writeFileSync(path.join(target, "card.html"), "<div>same</div>")
        }
        writeFileSync(path.join(firstDir, "card.css"), "div { color: red; }")
        writeFileSync(path.join(secondDir, "card.css"), "div { color: blue; }")
        const plugin = ngJsTemplateParser()
        const styledCode = `{ templateUrl: "./card.html", styleUrl: "./card.css" }`

        const first = await callTransform(plugin, {}, styledCode, path.join(firstDir, "card.ts"))
        const second = await callTransform(plugin, {}, styledCode, path.join(secondDir, "card.ts"))

        const firstCss = callLoad(plugin, styleImportId(first?.code))
        const secondCss = callLoad(plugin, styleImportId(second?.code))

        expect(firstCss).toMatch(/div\[_content-[0-9a-f]{8}]\{color:red}/)
        expect(secondCss).toMatch(/div\[_content-[0-9a-f]{8}]\{color:blue}/)
        expect(firstCss).not.toBe(secondCss)
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

    test("emits the scoped template without inlining styles", async () => {
        const plugin = ngJsTemplateParser()
        const emits: EmittedAsset[] = []
        const ctx = {
            error: (m: string) => { throw new Error(m) },
            warn: () => undefined,
            emitFile: (f: EmittedAsset) => emits.push(f),
        }

        const result = await callTransform(plugin, ctx, codeWithStyle, componentPath)
        await callGenerateBundle(plugin, ctx)

        expect(emits).toHaveLength(1)
        const [emit] = emits
        const source = emit?.source.toString()

        expect(emit?.fileName).toMatch(/templates[\\/]app-root-[0-9a-f]{8}\.html/)
        expect(source).not.toContain("<style")
        expect(source).toMatch(/<div _content-[0-9a-f]{8}="">hello<\/div>/)

        expect(callLoad(plugin, styleImportId(result?.code))).toMatch(/\.title\[_content-[0-9a-f]{8}]\{color:red}/)
    })

    test("keeps distinct template names when their content is identical", async () => {
        const fixtureDir = path.join(dir, "same-content")
        mkdirSync(fixtureDir, {recursive: true})
        writeFileSync(path.join(fixtureDir, "first.html"), "<p>same</p>")
        writeFileSync(path.join(fixtureDir, "second.html"), "<p>same</p>")
        const plugin = ngJsTemplateParser()
        const emits: EmittedAsset[] = []
        const ctx = {
            warn: () => undefined,
            emitFile: (file: EmittedAsset) => emits.push(file),
        }

        await callTransform(plugin, ctx, `{ templateUrl: "./first.html" }`, path.join(fixtureDir, "first.ts"))
        await callTransform(plugin, ctx, `{ templateUrl: "./second.html" }`, path.join(fixtureDir, "second.ts"))
        await callGenerateBundle(plugin, ctx)

        expect(emits).toHaveLength(2)
        expect(emits.map(file => file.fileName).join(" ")).toContain("first-")
        expect(emits.map(file => file.fileName).join(" ")).toContain("second-")
    })
})

describe("ngJsTemplateParser development server", () => {
    test("serves fresh patched content and forwards unknown requests", async () => {
        const plugin = ngJsTemplateParser({hashed: false})
        callConfigResolved(plugin, {root: dir, base: "/app"})
        await callTransform(plugin, {}, codeWithStyle, componentPath)

        let middleware!: (req: {url?: string}, res: Record<string, unknown>, next: (error?: unknown) => void) => Promise<void>
        ;(plugin.configureServer as Function).call({}, {
            middlewares: {
                use: (handler: typeof middleware) => { middleware = handler },
            },
        })

        writeFileSync(templatePath, "<div>fresh</div>")
        writeFileSync(stylePath, ".title { color: blue; }")
        const headers = new Map<string, string>()
        let body: Buffer | undefined
        const response = {
            statusCode: 0,
            setHeader: (name: string, value: string) => headers.set(name, value),
            end: (value: Buffer) => { body = value },
        }
        let forwarded = false

        await middleware({url: "/app/templates/app-root.html"}, response, () => undefined)
        await middleware({url: "/app/unknown.html"}, response, () => { forwarded = true })

        expect(response.statusCode).toBe(200)
        expect(headers.get("Content-Type")).toBe("text/html; charset=utf-8")
        expect(body?.toString()).not.toContain("<style")
        expect(body?.toString()).toMatch(/<div _content-[0-9a-f]{8}="">fresh<\/div>/)
        expect(forwarded).toBeTrue()

        writeFileSync(templatePath, "<div>hello</div>")
        writeFileSync(stylePath, ".title { color: red; }")
    })
})
