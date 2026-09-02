import { describe, expect, test } from "bun:test"
import { obtainStyleUrl } from "./obtain-style-url.ts"

describe("obtainStyleUrl", () => {
    test("returns undefined when there is no styleUrl in the code", () => {
        expect(obtainStyleUrl("const x = 1")).toBeUndefined()
    })

    test("extracts a single-quoted styleUrl", () => {
        const code = `angular.module("app").component("appRoot", { styleUrl: './foo.component.css' })`

        expect(obtainStyleUrl(code)).toEqual({
            styleUrl: "./foo.component.css",
            match: `styleUrl: './foo.component.css'`,
        })
    })

    test("extracts a double-quoted styleUrl", () => {
        const code = `angular.module("app").component("appRoot", { styleUrl: "./foo.component.css" })`

        expect(obtainStyleUrl(code)).toEqual({
            styleUrl: "./foo.component.css",
            match: `styleUrl: "./foo.component.css"`,
        })
    })

    test("returns undefined when styleUrl key is present but malformed", () => {
        const code = `angular.module("app").component("appRoot", { styleUrl: 123 })`

        expect(obtainStyleUrl(code)).toBeUndefined()
    })
})
