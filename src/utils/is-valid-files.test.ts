import { describe, expect, test } from "bun:test"
import { isValidFiles } from "./is-valid-files.ts"

describe("isValidFiles", () => {
    test("accepts .ts files", () => {
        expect(isValidFiles("src/app.component.ts")).toBeTruthy()
    })

    test("accepts .js files", () => {
        expect(isValidFiles("src/app.component.js")).toBeTruthy()
    })

    test("rejects other extensions", () => {
        expect(isValidFiles("src/app.component.html")).toBeFalsy()
        expect(isValidFiles("src/styles.css")).toBeFalsy()
    })

    test("rejects anything under node_modules regardless of extension", () => {
        expect(isValidFiles("/repo/node_modules/pkg/index.ts")).toBeFalsy()
    })

    test("accepts ids with a Vite query suffix (?raw, ?t=, ?v=)", () => {
        expect(isValidFiles("src/app.component.ts?raw")).toBeTruthy()
        expect(isValidFiles("src/app.component.ts?t=1700000000000")).toBeTruthy()
        expect(isValidFiles("src/app.component.js?v=abc123")).toBeTruthy()
    })

    test("still rejects non-ts/js ids that merely contain a query suffix", () => {
        expect(isValidFiles("src/app.component.html?raw")).toBeFalsy()
    })
})
