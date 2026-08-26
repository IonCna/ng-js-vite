import { describe, expect, test } from "bun:test"
import path from "node:path"
import { resolveTemplatePath } from "./resolve-template-path.ts"

const root = path.normalize("/repo")
const id = path.join(root, "src", "app", "app.component.ts")

describe("resolveTemplatePath", () => {
    test("resolves a root-absolute templateUrl against root", () => {
        const result = resolveTemplatePath(root, id, "/src/app/app.component.html")

        expect(result).toBe(path.resolve(root, "src/app/app.component.html"))
    })

    test("resolves a ./ relative templateUrl against the file's directory", () => {
        const result = resolveTemplatePath(root, id, "./app.component.html")

        expect(result).toBe(path.resolve(path.dirname(id), "./app.component.html"))
    })

    test("resolves a ../ relative templateUrl against the file's directory", () => {
        const result = resolveTemplatePath(root, id, "../shared/app.component.html")

        expect(result).toBe(path.resolve(path.dirname(id), "../shared/app.component.html"))
    })

    test("resolves a src/ prefixed templateUrl against root", () => {
        const result = resolveTemplatePath(root, id, "src/app/app.component.html")

        expect(result).toBe(path.resolve(root, "src/app/app.component.html"))
    })

    test("falls back to resolving against the file's directory for a bare filename", () => {
        const result = resolveTemplatePath(root, id, "app.component.html")

        expect(result).toBe(path.resolve(path.dirname(id), "app.component.html"))
    })
})
