import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { templateTransform } from "./esbuild.ts"

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
