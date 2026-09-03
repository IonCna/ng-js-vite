import {beforeEach, describe, expect, test} from "bun:test"
import path from "node:path"
import {CodeReader} from "@ng-js-vite/reading/code-reader"
import {FileReader} from "@ng-js-vite/reading/file-resolver"
import {CodePatcher} from "@ng-js-vite/writing/code-patcher"
import {TemplatePatcher} from "@ng-js-vite/writing/template-patcher"

beforeEach(() => FileReader.configure(process.cwd(), "/app/"))

describe("CodePatcher", () => {
    const code = `{ templateUrl: "./card.html", styleUrl: "./card.css" }`

    test("writes a hashed public URL and isolates styleUrl", () => {
        const reader = CodeReader.from(code)
        const files = FileReader.parse(reader, path.join(process.cwd(), "card.ts"))
        const hash = reader.hash("content")
        const result = CodePatcher.from(
            {code, hashed: true, styleIsolate: true}, reader, files, hash,
        )

        expect(result).toContain(`/app/templates/card-${hash.key}.html`)
        expect(result).toContain("ngJsViteInlineStyle: true")
        expect(result).not.toContain("styleUrl")
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
    test("returns the original template buffer when there is no style", () => {
        const template = Buffer.from("<main>plain</main>")

        expect(TemplatePatcher.from({template})).toBe(template)
    })

    test("prepends style content to the template", () => {
        const result = TemplatePatcher.from({
            template: Buffer.from("<main>styled</main>"),
            style: Buffer.from("main { color: red; }"),
        })

        expect(result.toString()).toBe(
            "<style data-ng-js-vite>\nmain { color: red; }\n</style>\n<main>styled</main>"
        )
    })
})
