import {describe, expect, test} from "bun:test"
import {CodeReader} from "@ng-js-vite/reading/code-reader"

describe("CodeReader", () => {
    test("reads templateUrl and optional styleUrl with either quote style", () => {
        const withStyle = CodeReader.from(`{ templateUrl: './view.html', styleUrl: "./view.css" }`)
        const withoutStyle = CodeReader.from(`{ templateUrl: "./plain.html" }`)

        expect(withStyle.templateUrl).toBe("./view.html")
        expect(withStyle.styleUrl).toBe("./view.css")
        expect(withoutStyle.templateUrl).toBe("./plain.html")
        expect(withoutStyle.styleUrl).toBeUndefined()
    })

    test("rejects missing or non-literal templateUrl declarations", () => {
        expect(() => CodeReader.from("const value = 1")).toThrow("content must have templateUrl")
        expect(() => CodeReader.from("{ templateUrl: variable }")).toThrow("templateUrl must be defined")
    })

    test("creates a deterministic eight-character content hash", () => {
        const first = CodeReader.from(`{ templateUrl: "./views/card.html" }`)
        const second = CodeReader.from(`{ templateUrl: "./views/card.html" }`)
        const firstHash = first.hash("<div>card</div>")
        const secondHash = second.hash("<div>card</div>")

        expect(firstHash).toEqual(secondHash)
        expect(firstHash.key).toMatch(/^[0-9a-f]{8}$/)
        expect(firstHash.templateUrl).toBe(`./views/card-${firstHash.key}.html`)
    })

    test("different content produces different hashes", () => {
        const first = CodeReader.from(`{ templateUrl: "./card.html" }`)
        const second = CodeReader.from(`{ templateUrl: "./card.html" }`)

        expect(first.hash("first").key).not.toBe(second.hash("second").key)
    })

    test("returns its cached result after the first hash", () => {
        const reader = CodeReader.from(`{ templateUrl: "./card.html" }`)
        const initial = reader.hash("first")

        expect(reader.hash("different content")).toEqual(initial)
    })
})
