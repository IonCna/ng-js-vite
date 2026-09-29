import {describe, expect, test} from "bun:test"
import {CodeReader} from "@ng-js-vite/reading/code-reader.ts"

describe("CodeReader", () => {
    test("reads templateUrl and optional styleUrl with either quote style", () => {
        const withStyle = CodeReader.from(`{ templateUrl: './view.html', styleUrl: "./view.css" }`)
        const withoutStyle = CodeReader.from(`{ templateUrl: "./plain.html" }`)

        expect(withStyle.templateUrl).toBe("./view.html")
        expect(withStyle.styleUrl).toBe("./view.css")
        expect(withoutStyle.templateUrl).toBe("./plain.html")
        expect(withoutStyle.styleUrl).toBeUndefined()
    })

    test("reads an inline template (quotes or backticks) only alongside styleUrl", () => {
        const backticks = CodeReader.from("{ styleUrl: './a.css', template: `<p class=\"x\">\\u00e1</p>\n<i>$ 1</i>` }")
        const quoted = CodeReader.from(`{ template: '<p>it\\'s</p>', styleUrl: "./a.css" }`)

        expect(backticks.templateUrl).toBeUndefined()
        expect(backticks.inlineTemplate).toBe(`<p class="x">\u00e1</p>\n<i>$ 1</i>`)
        expect(quoted.inlineTemplate).toBe("<p>it's</p>")
        expect(CodeReader.hasInlineTemplateWithStyle("{ template: `<p></p>` }")).toBeFalse()
        expect(CodeReader.hasInlineTemplateWithStyle("{ styleUrl: './a.css', template: `<p>${x}</p>` }")).toBeFalse()
    })

    test("ignores templateUrl/styleUrl quoted inside comments", () => {
        const code = [
            "/** upstream: `styleUrl: './day.scss'` */",
            "// templateUrl: './old.html'",
            "const url = 'http://x' // styleUrl: './nope.css'",
            "const t = `a // b ${ { k: 1 }.k } /* c */`",
            "@Component({ selector: 'x', template: `<p></p>` }) class X {}",
        ].join("\n")

        expect(CodeReader.withoutComments(code)).toHaveLength(code.length)
        expect(CodeReader.withoutComments(code)).toContain("const url = 'http://x'")
        expect(CodeReader.withoutComments(code)).toContain("`a // b ${ { k: 1 }.k } /* c */`")
        expect(CodeReader.withoutComments(code)).not.toContain("styleUrl")
        expect(CodeReader.hasInlineTemplateWithStyle(code)).toBeFalse()
        expect(() => CodeReader.from(code)).toThrow("content must have templateUrl")
    })

    test("replace skips commented matches and does not expand $ patterns", () => {
        const code = `// templateUrl: "./a.html"\n{ templateUrl: "./b.html" }`
        const replaced = CodeReader.replace(code, CodeReader.templateRegExp, `template: "$& $1"`)

        expect(replaced).toBe(`// templateUrl: "./a.html"\n{ template: "$& $1" }`)
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
