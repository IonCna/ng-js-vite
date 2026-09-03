import {afterAll, beforeEach, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import path from "node:path"
import {CodeReader} from "@ng-js-vite/reading/code-reader"
import {FileReader} from "@ng-js-vite/reading/file-resolver"
import {CodePatcher} from "@ng-js-vite/writing/code-patcher"
import {TemplatePatcher} from "@ng-js-vite/writing/template-patcher"

beforeEach(() => FileReader.configure(process.cwd(), "/app/"))

describe("CodePatcher", () => {
    const code = `{ templateUrl: "./card.html", styleUrl: "./card.css" }`

    test("writes a hashed public URL and leaves styleUrl untouched", () => {
        const reader = CodeReader.from(code)
        const files = FileReader.parse(reader, path.join(process.cwd(), "card.ts"))
        const hash = reader.hash("content")
        const result = CodePatcher.from(
            {code, hashed: true}, reader, files, hash,
        )

        expect(result).toContain(`/app/templates/card-${hash.key}.html`)
        expect(result).toContain(`styleUrl: "./card.css"`)
    })

    test("writes the stable basename when hashing is disabled", () => {
        const reader = CodeReader.from(code)
        const files = FileReader.parse(reader, path.join(process.cwd(), "card.ts"))
        const result = CodePatcher.from(
            {code, hashed: false}, reader, files, reader.hash("content"),
        )

        expect(result).toContain("/app/templates/card.html")
        expect(result).toContain(`styleUrl: "./card.css"`)
    })
})

describe("TemplatePatcher", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "template-patcher-"))

    afterAll(() => rmSync(dir, {recursive: true, force: true}))

    const patch = async (templateUrl: string, styleUrl?: string) => {
        const code = styleUrl
            ? `{ templateUrl: "${templateUrl}", styleUrl: "${styleUrl}" }`
            : `{ templateUrl: "${templateUrl}" }`
        const reader = CodeReader.from(code)
        const fileReader = FileReader.parse(reader, path.join(dir, "component.ts"))

        return TemplatePatcher.from(fileReader)
    }

    test("injects the scope attribute into every element when there is no style", async () => {
        writeFileSync(path.join(dir, "plain.html"), "<main>plain</main>")

        const patched = await patch("./plain.html")

        expect(patched.template.toString()).toBe(`<main ${patched.scope}="">plain</main>`)
        expect(patched.style).toBeUndefined()
    })

    test("scopes the template and the style as separate buffers", async () => {
        writeFileSync(path.join(dir, "styled.html"), "<main>styled</main>")
        writeFileSync(path.join(dir, "styled.css"), "main { color: red; }")

        const patched = await patch("./styled.html", "./styled.css")

        expect(patched.template.toString()).toBe(`<main ${patched.scope}="">styled</main>`)
        expect(patched.style?.toString()).toBe(`main[${patched.scope}]{color:red}`)
    })

    test("places the scope attribute before a pseudo-element", async () => {
        writeFileSync(path.join(dir, "pseudo.html"), "<i>icon</i>")
        writeFileSync(path.join(dir, "pseudo.css"), "i::before { content: \"x\"; }")

        const patched = await patch("./pseudo.html", "./pseudo.css")

        expect(patched.style?.toString()).toContain(`i[${patched.scope}]::before`)
    })

    test("scopes selectors nested inside :not()/:is() and leaves @keyframes untouched", async () => {
        writeFileSync(path.join(dir, "edge.html"), "<div>edge</div>")
        writeFileSync(
            path.join(dir, "edge.css"),
            "div:not(.a, .b) { color: blue; } @keyframes spin { from { opacity: 0; } to { opacity: 1; } }"
        )

        const patched = await patch("./edge.html", "./edge.css")
        const css = patched.style?.toString() ?? ""

        expect(css).toContain(`div:not(.a[${patched.scope}],.b[${patched.scope}])[${patched.scope}]`)
        expect(css).toContain("@keyframes spin{from{opacity:0}to{opacity:1}}")
    })

    test("scopes an ancestor's :is() alternatives, not just the leaf selector", async () => {
        writeFileSync(path.join(dir, "nested.html"), "<div><span class=\"child\">x</span></div>")
        writeFileSync(path.join(dir, "nested.css"), "div:is(.a, .b) .child { color: green; }")

        const patched = await patch("./nested.html", "./nested.css")
        const css = patched.style?.toString() ?? ""

        expect(css).toContain(
            `div:is(.a[${patched.scope}],.b[${patched.scope}]) .child[${patched.scope}]`
        )
    })
})
