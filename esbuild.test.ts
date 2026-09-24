import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { TemplateFiles, templateTransform } from "./esbuild.ts"

describe("templateTransform (esbuild)", () => {
    let dir: string

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "ng-js-vite-esbuild-test-"))
    })

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    test("returns undefined if the file has no templateUrl", async () => {
        const result = await templateTransform.transform("class Foo {}", path.join(dir, "foo.ts"))
        expect(result).toBeUndefined()
    })

    test("inlines the scoped template and injects the style into document.head", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div class='card'><p>hola</p></div>")
        writeFileSync(path.join(dir, "card.css"), ".card { color: red; }")

        const code = `@Component({ selector: "app-card", templateUrl: "./card.html", styleUrl: "./card.css" }) class Card {}`
        const result = await templateTransform.transform(code, path.join(dir, "card.ts"))

        expect(result).toBeDefined()
        expect(result).toContain("template:")
        expect(result).not.toContain("styleUrl")
        expect(result).toMatch(/_content-[0-9a-f]{8}/)
        expect(result).toContain("document.head.appendChild(s)")
        expect(result).toContain(".card[_content-")
    })

    test("does not break syntax when there is no styleUrl (no style injection)", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div class='card'></div>")

        const code = `@Component({ selector: "app-card", templateUrl: "./card.html" }) class Card {}`
        const result = await templateTransform.transform(code, path.join(dir, "card.ts"))

        expect(result).toBeDefined()
        expect(result).toContain("template:")
        expect(result).not.toContain("document.head.appendChild")
    })
})

describe("TemplateFiles (esbuild, templates en archivos aparte)", () => {
    let dir: string

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "ng-js-vite-template-files-test-"))
    })

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    const card = `@Component({ selector: "app-card", templateUrl: "./card.html", styleUrl: "./card.css" }) class Card {}`

    test("reescribe templateUrl a la URL pública con hash y emite el template escopeado en templates/", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div class='card'></div>")
        writeFileSync(path.join(dir, "card.css"), ".card { color: red; }")
        const files = TemplateFiles.create()

        const result = await files.transform(card, path.join(dir, "card.ts"))
        const url = result?.match(/templateUrl: "([^"]+)"/)?.[1]
        expect(url).toMatch(/^\/templates\/card-[0-9a-f]{8}\.html$/)

        const out = path.join(dir, "dist")
        await files.emit(out)
        const [emitted] = readdirSync(path.join(out, "templates"))
        expect(`/templates/${emitted}`).toBe(url!)
        expect(readFileSync(path.join(out, "templates", emitted!), "utf8")).toMatch(/class="card" _content-[0-9a-f]{8}=""/)
    })

    test("el CSS sale aparte en styles/ (escopeado, con hash) y el módulo agrega su <link> una sola vez", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div class='card'></div>")
        writeFileSync(path.join(dir, "card.css"), ".card { color: red; }")
        const files = TemplateFiles.create()

        const result = (await files.transform(card, path.join(dir, "card.ts")))!
        const href = result.match(/var h = "([^"]+)"/)?.[1]
        expect(href).toMatch(/^\/styles\/card-[0-9a-f]{8}\.css$/)
        expect(result).not.toContain("styleUrl")
        expect(result).not.toContain("textContent") // nada de <style> inline
        expect(result).toContain('l.rel = "stylesheet"')
        expect(result).toContain("data-ngjs-style")

        const out = path.join(dir, "dist")
        await files.emit(out)
        const [emitted] = readdirSync(path.join(out, "styles"))
        expect(`/styles/${emitted}`).toBe(href!)
        expect(readFileSync(path.join(out, "styles", emitted!), "utf8")).toMatch(/\.card\[_content-[0-9a-f]{8}\]/)
    })

    test("sin styleUrl no hay link ni carpeta styles/", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div></div>")
        const files = TemplateFiles.create()
        const result = await files.transform(`@Component({ selector: "app-card", templateUrl: "./card.html" }) class Card {}`, path.join(dir, "card.ts"))
        expect(result).not.toContain("data-ngjs-style")

        const out = path.join(dir, "dist")
        await files.emit(out)
        expect(readdirSync(out)).toEqual(["templates"])
    })

    test("hashed: false usa el nombre fijo y el middleware sirve template y CSS releídos del disco", async () => {
        writeFileSync(path.join(dir, "card.html"), "<p>v1</p>")
        writeFileSync(path.join(dir, "card.css"), "p { color: red; }")
        const files = TemplateFiles.create({ hashed: false })
        const result = (await files.transform(card, path.join(dir, "card.ts")))!
        expect(result).toContain(`templateUrl: "/templates/card.html"`)
        const href = result.match(/var h = "([^"]+)"/)![1]!
        expect(href).toMatch(/^\/styles\/card-[0-9a-f]{8}\.css$/)

        writeFileSync(path.join(dir, "card.html"), "<p>v2</p>")
        writeFileSync(path.join(dir, "card.css"), "p { color: blue; }")
        const request = (url: string) => new Promise<{ body: string; type: string }>((resolve, reject) => {
            let type = ""
            files.middleware()({ url }, { statusCode: 0, setHeader: (_: string, value: string) => { type = value }, end: (body: Buffer) => resolve({ body: body.toString(), type }) }, reject)
        })
        expect((await request("/templates/card.html?x=1")).body).toContain("v2")
        const css = await request(href)
        expect(css.type).toContain("text/css")
        expect(css.body).toContain("blue")

        let passed = false
        files.middleware()({ url: "/otra/cosa.html" }, { statusCode: 0, setHeader() {}, end() {} }, () => { passed = true })
        expect(passed).toBe(true)
    })

    test("un mismo .css compartido por dos componentes se publica una vez por scope (no se pisan)", async () => {
        writeFileSync(path.join(dir, "shared.css"), "p { color: red; }")
        for (const sub of ["a", "b"]) {
            mkdirSync(path.join(dir, sub))
            writeFileSync(path.join(dir, sub, `${sub}.html`), `<p>${sub}</p>`)
        }
        const shared = (sub: string) => `@Component({ selector: "app-${sub}", templateUrl: "./${sub}.html", styleUrl: "../shared.css" }) class C {}`
        for (const hashed of [true, false]) {
            const files = TemplateFiles.create({ hashed })
            const a = (await files.transform(shared("a"), path.join(dir, "a", "a.ts")))!.match(/var h = "([^"]+)"/)![1]
            const b = (await files.transform(shared("b"), path.join(dir, "b", "b.ts")))!.match(/var h = "([^"]+)"/)![1]
            expect(a).not.toBe(b)
        }
    })

    test("hashed: false con dos templates del mismo nombre falla con un error claro", async () => {
        for (const sub of ["a", "b"]) {
            mkdirSync(path.join(dir, sub))
            writeFileSync(path.join(dir, sub, "card.html"), `<p>${sub}</p>`)
            writeFileSync(path.join(dir, sub, "card.css"), "p {}")
        }
        const files = TemplateFiles.create({ hashed: false })
        await files.transform(card, path.join(dir, "a", "card.ts"))
        await expect(files.transform(card, path.join(dir, "b", "card.ts"))).rejects.toThrow(/renombrá uno/)
    })
})
