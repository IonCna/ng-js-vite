import { describe, expect, test } from "bun:test"
import { obtainTemplateUrl } from "./obtain-template-url.ts"

describe("obtainTemplateUrl", () => {
    test("returns undefined when there is no templateUrl in the code", () => {
        expect(obtainTemplateUrl("const x = 1")).toBeUndefined()
    })

    test("extracts a single-quoted templateUrl", () => {
        const code = `@Component({ templateUrl: './foo.component.html' })`

        expect(obtainTemplateUrl(code)).toEqual({ templateUrl: "./foo.component.html" })
    })

    test("extracts a double-quoted templateUrl", () => {
        const code = `@Component({ templateUrl: "./foo.component.html" })`

        expect(obtainTemplateUrl(code)).toEqual({ templateUrl: "./foo.component.html" })
    })

    test("returns undefined when templateUrl key is present but malformed", () => {
        const code = `@Component({ templateUrl: 123 })`

        expect(obtainTemplateUrl(code)).toBeUndefined()
    })

    test("preserves a leading slash (root-absolute path) untouched", () => {
        const code = `@Component({ templateUrl: '/src/foo.component.html' })`

        expect(obtainTemplateUrl(code)).toEqual({ templateUrl: "/src/foo.component.html" })
    })
})
