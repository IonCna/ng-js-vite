import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
