import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping"
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
        const result = (await templateTransform.transform("class Foo {}", path.join(dir, "foo.ts")))?.code
        expect(result).toBeUndefined()
    })

    test("inlines the scoped template and injects the style into document.head", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div class='card'><p>hola</p></div>")
        writeFileSync(path.join(dir, "card.css"), ".card { color: red; }")

        const code = `@Component({ selector: "app-card", templateUrl: "./card.html", styleUrl: "./card.css" }) class Card {}`
        const result = (await templateTransform.transform(code, path.join(dir, "card.ts")))?.code

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
        const result = (await templateTransform.transform(code, path.join(dir, "card.ts")))?.code

        expect(result).toBeDefined()
        expect(result).toContain("template:")
        expect(result).not.toContain("document.head.appendChild")
    })

    test("devuelve el source map al .ts: el template inline de varias líneas pasa a una, el resto no se corre", async () => {
        writeFileSync(path.join(dir, "alert.css"), ".close { color: red; }")
        const file = path.join(dir, "alert.ts")
        const code = [
            "@Component({",
            "    selector: \"ngb-alert\",",
            "    styleUrl: \"./alert.css\",",
            "    template: `",
            "        <p>uno</p>",
            "        <p>dos</p>",
            "    `,",
            "})",
            "class Alert {",
            "    close() { throw new Error(\"boom\") }",
            "}",
        ].join("\n")

        const output = (await templateTransform.transform(code, file))!
        const lines = output.code.split("\n")
        const line = lines.findIndex((text) => text.includes("boom")) + 1
        const column = lines[line - 1]!.indexOf("boom")
        expect(line).not.toBe(10)
        const source = file.split(path.sep).join("/")
        expect(output.map.sources).toEqual([source])
        expect(originalPositionFor(new TraceMap(output.map as never), { line, column })).toMatchObject({ source, line: 10 })
    })

    test("template inline + styleUrl: escopea el template en el código e inyecta el CSS", async () => {
        writeFileSync(path.join(dir, "alert.css"), ":host { display: block; } .close { color: red; }")

        const code = "@Component({ selector: \"ngb-alert\", styleUrl: \"./alert.css\", template: `<ng-content></ng-content>\n<button class=\"close\" ng-click=\"$.close()\">x</button>` }) class Alert {}"
        const result = (await templateTransform.transform(code, path.join(dir, "alert.ts")))?.code

        expect(result).toBeDefined()
        expect(result).not.toContain("styleUrl")
        expect(result).not.toContain("`")
        const scope = result!.match(/_content-[0-9a-f]{8}/)![0]
        expect(result).toContain(`<button class=\\"close\\" ng-click=\\"$.close()\\" ${scope}=\\"\\">`)
        expect(result).toContain("<ng-content")
        expect(result).toContain("ngb-alert{display:block}")
        expect(result).toContain(`.close[${scope}]`)
        expect(result).toContain("document.head.appendChild(s)")
    })

    test("template inline sin styleUrl: no se toca", async () => {
        const code = "@Component({ selector: \"app-x\", template: `<p>x</p>` }) class X {}"
        expect((await templateTransform.transform(code, path.join(dir, "x.ts")))?.code).toBeUndefined()
    })
})

/** El CSS que el módulo transformado agrega a `document.head` en un `<style>` (o `undefined` si no agrega). */
function injectedCss(code: string | undefined): string | undefined {
    const literal = code?.match(/s\.textContent = ("(?:[^"\\]|\\.)*")/)?.[1]
    return literal === undefined ? undefined : JSON.parse(literal)
}

describe("TemplateFiles (esbuild, templates en archivos aparte)", () => {
    let dir: string

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "ng-js-vite-template-files-test-"))
    })

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    const card = `@Component({ selector: "app-card", templateUrl: "./card.html", styleUrl: "./card.css" }) class Card {}`

    test("template inline + styleUrl: el template queda en el código y el CSS va en un <style> del módulo", async () => {
        writeFileSync(path.join(dir, "alert.css"), ":host { display: block; }")
        const files = TemplateFiles.create()
        const code = "@Component({ selector: \"ngb-alert\", styleUrl: \"./alert.css\", template: '<p>hola</p>' }) class Alert {}"

        const result = (await files.transform(code, path.join(dir, "alert.ts")))?.code
        expect(result).not.toContain("templateUrl")
        expect(result).toMatch(/template: "<p _content-[0-9a-f]{8}=\\"\\">hola<\/p>"/)
        expect(injectedCss(result)).toBe("ngb-alert{display:block}")

        const out = path.join(dir, "dist")
        await files.emit(out)
        expect(existsSync(out)).toBe(false) // nada que publicar: ni template ni CSS aparte
        expect(files.ownersOf(path.join(dir, "alert.css"))).toEqual([path.join(dir, "alert.ts")])
    })

    test("styleUrls (Angular 16) y styles inline: una sola hoja escopeada — primero styles, después cada styleUrls — y se sacan del código", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div class='card'><i class='icon'></i></div>")
        writeFileSync(path.join(dir, "card.css"), ".card { color: red; }")
        writeFileSync(path.join(dir, "icons.css"), ".icon { width: 1px; }")
        const files = TemplateFiles.create()
        const code = [
            "@Component({",
            "    selector: \"app-card\",",
            "    templateUrl: \"./card.html\",",
            "    styleUrls: [\"./card.css\", './icons.css'],",
            "    styles: [`:host { display: block; }`, \"a[href] { color: blue; }\",],",
            "})",
            "class Card {}",
        ].join("\n")

        const result = (await files.transform(code, path.join(dir, "card.ts")))!.code
        expect(result).not.toContain("styleUrls")
        expect(result).not.toContain("styles:")
        expect(result).toContain("selector: \"app-card\"")
        const css = injectedCss(result)
        expect(css).toMatch(/^app-card\{display:block\}a\[href\]\[_content-[0-9a-f]{8}\]\{color:blue\}\.card\[_content-[0-9a-f]{8}\]\{color:red\}\.icon\[_content-[0-9a-f]{8}\]\{width:1px\}$/)
        expect(files.ownersOf(path.join(dir, "icons.css"))).toEqual([path.join(dir, "card.ts")])
    })

    test("template inline + solo styles inline: el CSS va escopeado en el <style> del módulo", async () => {
        const files = TemplateFiles.create()
        const code = "@Component({ selector: \"app-x\", template: '<p>hola</p>', styles: `p { margin: 0; }` }) class X {}"

        const result = (await files.transform(code, path.join(dir, "x.component.ts")))!.code
        expect(result).toMatch(/template: "<p _content-[0-9a-f]{8}=\\"\\">hola<\/p>"/)
        expect(result).not.toContain("styles:")
        expect(injectedCss(result)).toMatch(/^p\[_content-[0-9a-f]{8}\]\{margin:0\}$/)
    })

    test("reescribe templateUrl a la URL pública con hash y emite el template escopeado en templates/", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div class='card'></div>")
        writeFileSync(path.join(dir, "card.css"), ".card { color: red; }")
        const files = TemplateFiles.create()

        const result = (await files.transform(card, path.join(dir, "card.ts")))?.code
        const url = result?.match(/templateUrl: "([^"]+)"/)?.[1]
        expect(url).toMatch(/^templates\/card-[0-9a-f]{8}\.html$/)

        const out = path.join(dir, "dist")
        await files.emit(out)
        const [emitted] = readdirSync(path.join(out, "templates"))
        expect(`templates/${emitted}`).toBe(url!)
        expect(readFileSync(path.join(out, "templates", emitted!), "utf8")).toMatch(/class="card" _content-[0-9a-f]{8}=""/)
    })

    test("el CSS va en el JS (escopeado) y el módulo lo agrega en un <style>, como Angular: sin archivo ni <link> aparte", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div class='card'></div>")
        writeFileSync(path.join(dir, "card.css"), ".card { color: red; }")
        const files = TemplateFiles.create()

        const result = (await files.transform(card, path.join(dir, "card.ts")))!.code
        expect(result).not.toContain("styleUrl")
        expect(result).not.toContain('rel = "stylesheet"') // nada de <link>: un pedido aparte deja la vista sin estilos
        expect(result).toContain("document.head.appendChild(s)")
        expect(injectedCss(result)).toMatch(/^\.card\[_content-[0-9a-f]{8}\]\{color:red\}$/)

        const out = path.join(dir, "dist")
        await files.emit(out)
        expect(readdirSync(out)).toEqual(["templates"])
    })

    test("un template con <ng-content> agrega ɵngContent (el compilador no ve el template para decidir transclude)", async () => {
        writeFileSync(path.join(dir, "panel.html"), "<section><ng-content></ng-content></section>")
        writeFileSync(path.join(dir, "card.html"), "<p>ng-content no es un tag acá</p>")
        const files = TemplateFiles.create({ hashed: false })
        const panel = (await files.transform(`@Component({ selector: "app-panel", templateUrl: "./panel.html" }) class Panel {}`, path.join(dir, "panel.ts")))?.code
        const card = (await files.transform(`@Component({ selector: "app-card", templateUrl: "./card.html" }) class Card {}`, path.join(dir, "card.ts")))?.code
        expect(panel).toContain(`templateUrl: "templates/panel.html", ɵngContent: true`)
        expect(card).not.toContain("ɵngContent")
    })

    test("ownersOf: el componente dueño de cada template y CSS (para recargar en el dev-server)", async () => {
        writeFileSync(path.join(dir, "card.html"), "<p>x</p>")
        writeFileSync(path.join(dir, "card.css"), "p { color: red; }")
        const files = TemplateFiles.create({ hashed: false })
        await files.transform(card, path.join(dir, "card.ts"))
        expect(files.ownersOf(path.join(dir, "card.html"))).toEqual([path.join(dir, "card.ts")])
        expect(files.ownersOf(path.join(dir, "card.css"))).toEqual([path.join(dir, "card.ts")])
        expect(files.ownersOf(path.join(dir, "otro.html"))).toEqual([])
    })

    test("sin estilos el módulo no agrega ningún <style>", async () => {
        writeFileSync(path.join(dir, "card.html"), "<div></div>")
        const files = TemplateFiles.create()
        const result = (await files.transform(`@Component({ selector: "app-card", templateUrl: "./card.html" }) class Card {}`, path.join(dir, "card.ts")))?.code
        expect(injectedCss(result)).toBeUndefined()

        const out = path.join(dir, "dist")
        await files.emit(out)
        expect(readdirSync(out)).toEqual(["templates"])
    })

    test("hashed: false usa el nombre fijo y el middleware sirve el template releído del disco", async () => {
        writeFileSync(path.join(dir, "card.html"), "<p>v1</p>")
        writeFileSync(path.join(dir, "card.css"), "p { color: red; }")
        const files = TemplateFiles.create({ hashed: false })
        const result = (await files.transform(card, path.join(dir, "card.ts")))!.code
        expect(result).toContain(`templateUrl: "templates/card.html"`)
        expect(injectedCss(result)).toContain("red")

        writeFileSync(path.join(dir, "card.html"), "<p>v2</p>")
        const request = (url: string) => new Promise<{ body: string; type: string }>((resolve, reject) => {
            let type = ""
            files.middleware()({ url }, { statusCode: 0, setHeader: (_: string, value: string) => { type = value }, end: (body: Buffer) => resolve({ body: body.toString(), type }) }, reject)
        })
        expect((await request("/templates/card.html?x=1")).body).toContain("v2")
        // URL relativa: la página la pide con su <base href> adelante (GitHub Pages en un subpath).
        expect((await request("/ngb-js-docs/templates/card.html")).body).toContain("v2")
        let passed = false
        files.middleware()({ url: "/otra/cosa.html" }, { statusCode: 0, setHeader() {}, end() {} }, () => { passed = true })
        expect(passed).toBe(true)
    })

    test("un mismo .css compartido por dos componentes se escopea distinto para cada uno", async () => {
        writeFileSync(path.join(dir, "shared.css"), "p { color: red; }")
        for (const sub of ["a", "b"]) {
            mkdirSync(path.join(dir, sub))
            writeFileSync(path.join(dir, sub, `${sub}.html`), `<p>${sub}</p>`)
        }
        const shared = (sub: string) => `@Component({ selector: "app-${sub}", templateUrl: "./${sub}.html", styleUrl: "../shared.css" }) class C {}`
        for (const hashed of [true, false]) {
            const files = TemplateFiles.create({ hashed })
            const a = injectedCss((await files.transform(shared("a"), path.join(dir, "a", "a.ts")))!.code)
            const b = injectedCss((await files.transform(shared("b"), path.join(dir, "b", "b.ts")))!.code)
            expect(a).toMatch(/^p\[_content-[0-9a-f]{8}\]\{color:red\}$/)
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

    test("un componente que pasa de templateUrl a template inline (y borra su .html) suelta lo publicado", async () => {
        writeFileSync(path.join(dir, "card.html"), "<p>card</p>")
        const files = TemplateFiles.create()
        const file = path.join(dir, "card.ts")
        await files.transform(`@Component({ selector: "app-card", templateUrl: "./card.html" }) class Card {}`, file)

        rmSync(path.join(dir, "card.html"))
        await files.transform(`@Component({ selector: "app-card", template: "<p>card</p>" }) class Card {}`, file)

        const out = path.join(dir, "dist")
        await files.emit(out)
        expect(existsSync(path.join(out, "templates"))).toBe(false)
        expect(files.ownersOf(path.join(dir, "card.html"))).toEqual([])
    })

    test("un template compartido sigue publicado mientras otro componente lo use", async () => {
        writeFileSync(path.join(dir, "shared.html"), "<p>shared</p>")
        const files = TemplateFiles.create()
        const component = (name: string) => `@Component({ selector: "app-${name}", templateUrl: "./shared.html" }) class C {}`
        await files.transform(component("a"), path.join(dir, "a.ts"))
        await files.transform(component("b"), path.join(dir, "b.ts"))

        await files.transform(`@Component({ selector: "app-a", template: "" }) class C {}`, path.join(dir, "a.ts"))

        const out = path.join(dir, "dist")
        await files.emit(out)
        expect(readdirSync(path.join(out, "templates"))).toHaveLength(1)
    })

    test("reset(): una compilación nueva no arrastra lo de un componente borrado", async () => {
        writeFileSync(path.join(dir, "card.html"), "<p>card</p>")
        const files = TemplateFiles.create()
        await files.transform(card.replace(', styleUrl: "./card.css"', ""), path.join(dir, "card.ts"))

        rmSync(path.join(dir, "card.html"))
        files.reset()

        const out = path.join(dir, "dist")
        await files.emit(out)
        expect(existsSync(path.join(out, "templates"))).toBe(false)
    })
})


describe("TemplateFiles: url() del CSS de un componente", () => {
    let dir: string

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "ng-js-vite-style-assets-test-"))
        mkdirSync(path.join(dir, "app", "card"), { recursive: true })
        mkdirSync(path.join(dir, "assets"), { recursive: true })
        writeFileSync(path.join(dir, "assets", "logo.png"), "PNG")
        writeFileSync(path.join(dir, "app", "card", "card.html"), "<i class=\"logo\"></i>")
    })

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    const card = "@Component({ selector: \"app-card\", templateUrl: \"./card.html\", styleUrls: [\"./card.css\"] }) class Card {}"
    const component = () => path.join(dir, "app", "card", "card.ts")

    test("un url() relativo se resuelve contra el .css, el archivo sale en media/ con hash y el CSS apunta ahí (con el base del build)", async () => {
        writeFileSync(path.join(dir, "app", "card", "card.css"), ".logo { mask: url(\"../../assets/logo.png\") center / contain no-repeat; }")
        const files = TemplateFiles.create({ base: "/Client/dist/" })

        const css = injectedCss((await files.transform(card, component()))!.code)

        const out = path.join(dir, "dist")
        await files.emit(out)
        const [media] = readdirSync(path.join(out, "media"))
        expect(media).toMatch(/^logo-[0-9a-f]{8}\.png$/)
        expect(readFileSync(path.join(out, "media", media!), "utf8")).toBe("PNG")
        // El CSS va en un <style> del documento: la URL es la de lo publicado, no relativa a una hoja.
        expect(css).toContain(`url(/Client/dist/media/${media})`)
    })

    test("quedan tal cual: absolutas al sitio, con esquema, data: y fragmentos; ?query y #fragment se conservan", async () => {
        writeFileSync(
            path.join(dir, "app", "card", "card.css"),
            [
                ".a { background: url(/img/x.png); }",
                ".b { background: url(https://cdn.test/x.png); }",
                ".c { background: url(data:image/png;base64,AAAA); }",
                ".d { filter: url(#blur); }",
                ".e { background: url(../../assets/logo.png?v=2#frag); }",
            ].join("\n"),
        )
        const files = TemplateFiles.create()
        const css = injectedCss((await files.transform(card, component()))!.code)

        const out = path.join(dir, "dist")
        await files.emit(out)
        const media = readdirSync(path.join(out, "media"))
        expect(media).toHaveLength(1)
        expect(css).toContain("url(/img/x.png)")
        expect(css).toContain("url(https://cdn.test/x.png)")
        expect(css).toContain("url(data:image/png;base64,AAAA)")
        expect(css).toContain("url(#blur)")
        expect(css).toContain(`url(media/${media[0]}?v=2#frag)`) // sin base: relativa al <base href>
    })

    test("un url() a un archivo que no existe falla nombrando el .css y el archivo", async () => {
        writeFileSync(path.join(dir, "app", "card", "card.css"), ".logo { background: url(./nope.png); }")
        const files = TemplateFiles.create()
        await expect(files.transform(card, component())).rejects.toThrow(/card\.css.*nope\.png.*no existe/s)
    })

    test("sin hash (dev-server): nombre estable por ruta y el middleware sirve media/", async () => {
        writeFileSync(path.join(dir, "app", "card", "card.css"), ".logo { background: url(../../assets/logo.png); }")
        const files = TemplateFiles.create({ hashed: false })
        await files.transform(card, component())

        const out = path.join(dir, "dist")
        await files.emit(out)
        const [media] = readdirSync(path.join(out, "media"))

        const served = await new Promise<{ type: string; body: string }>((resolve, reject) => {
            const res = {
                statusCode: 0,
                type: "",
                setHeader(_name: string, value: string) { this.type = value },
                end(body: Buffer) { resolve({ type: this.type, body: body.toString("utf8") }) },
            }
            files.middleware()({ url: `/media/${media}` }, res, () => reject(new Error("no lo sirvió")))
        })
        expect(served).toEqual({ type: "image/png", body: "PNG" })
    })
})
