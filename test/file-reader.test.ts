import {afterAll, beforeEach, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import path from "node:path"
import {CodeReader} from "@ng-js-vite/reading/code-reader"
import {FileReader} from "@ng-js-vite/reading/file-resolver"

const root = mkdtempSync(path.join(tmpdir(), "ng-js-vite-file-reader-"))
const componentDir = path.join(root, "src", "components")
const componentId = path.join(componentDir, "card.component.ts")

mkdirSync(componentDir, {recursive: true})

beforeEach(() => FileReader.configure(root, "/"))
afterAll(() => rmSync(root, {recursive: true, force: true}))

describe("FileReader.validate", () => {
    const component = `{ templateUrl: "./card.html" }`

    test("accepts JavaScript and TypeScript ids, including Vite queries", () => {
        expect(FileReader.validate("src/card.ts", component)).toBeTrue()
        expect(FileReader.validate("src/card.js?direct", component)).toBeTrue()
    })

    test("rejects raw module ids", () => {
        expect(FileReader.validate("src/card.ts?raw", component)).toBeFalse()
        expect(FileReader.validate("src/card.ts?raw&used", component)).toBeFalse()
    })

    test("rejects unsupported files, missing templates and node_modules", () => {
        expect(FileReader.validate("src/card.html", component)).toBeFalse()
        expect(FileReader.validate("src/card.ts", "const value = 1")).toBeFalse()
        expect(FileReader.validate("src/helper.ts", "return component.$factory.templateUrl")).toBeFalse()
        expect(FileReader.validate("/repo/node_modules/pkg/card.ts", component)).toBeFalse()
        expect(FileReader.validate("C:\\repo\\node_modules\\pkg\\card.ts", component)).toBeFalse()
    })
})

describe("FileReader.parse", () => {
    test("resolves relative and bare paths from the component directory", () => {
        const relative = FileReader.parse(CodeReader.from(`{ templateUrl: "../shared.html" }`), componentId)
        const bare = FileReader.parse(CodeReader.from(`{ templateUrl: "card.html" }`), componentId)

        expect(relative.templatePath).toBe(path.resolve(componentDir, "../shared.html"))
        expect(bare.templatePath).toBe(path.resolve(componentDir, "card.html"))
    })

    test("resolves slash-prefixed and src paths from the configured root", () => {
        const absolute = FileReader.parse(CodeReader.from(`{ templateUrl: "/views/card.html" }`), componentId)
        const src = FileReader.parse(CodeReader.from(`{ templateUrl: "src/views/card.html" }`), componentId)

        expect(absolute.templatePath).toBe(path.join(root, "views", "card.html"))
        expect(src.templatePath).toBe(path.join(root, "src", "views", "card.html"))
    })

    test("resolves an optional style path", () => {
        const files = FileReader.parse(
            CodeReader.from(`{ templateUrl: "./card.html", styleUrl: "./card.css" }`),
            componentId,
        )

        expect(files.templatePath).toBe(path.join(componentDir, "card.html"))
        expect(files.stylePath).toBe(path.join(componentDir, "card.css"))
    })
})

describe("FileReader.read", () => {
    test("reads template and style buffers", async () => {
        writeFileSync(path.join(componentDir, "card.html"), "<article>card</article>")
        writeFileSync(path.join(componentDir, "card.css"), ".card { color: red; }")
        const files = FileReader.parse(
            CodeReader.from(`{ templateUrl: "./card.html", styleUrl: "./card.css" }`),
            componentId,
        )
        const content = await files.read()

        expect(content.template.toString()).toBe("<article>card</article>")
        expect(content.style?.toString()).toBe(".card { color: red; }")
    })

    test("uses cached buffers unless refresh is requested", async () => {
        const templatePath = path.join(componentDir, "cached.html")
        writeFileSync(templatePath, "first")
        const files = FileReader.parse(CodeReader.from(`{ templateUrl: "./cached.html" }`), componentId)

        expect((await files.read()).template.toString()).toBe("first")
        writeFileSync(templatePath, "second")
        expect((await files.read()).template.toString()).toBe("first")
        expect((await files.read({ preventCache: true })).template.toString()).toBe("second")
    })

    test("rejects when a referenced file does not exist", async () => {
        const files = FileReader.parse(CodeReader.from(`{ templateUrl: "./missing.html" }`), componentId)

        expect(files.read()).rejects.toThrow()
    })
})
