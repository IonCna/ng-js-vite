import { describe, expect, test } from "bun:test"
import { createHashedName } from "./hash-name.ts"

describe("createHashedName", () => {
    test("produces the same hash for the same content", () => {
        const a = createHashedName("foo.html", "<div>hi</div>")
        const b = createHashedName("foo.html", "<div>hi</div>")

        expect(a).toEqual(b)
    })

    test("produces a different hash when content changes", () => {
        const a = createHashedName("foo.html", "<div>hi</div>")
        const b = createHashedName("foo.html", "<div>bye</div>")

        expect(a.key).not.toBe(b.key)
        expect(a.value).not.toBe(b.value)
    })

    test("inserts the hash before the extension", () => {
        const { key, value } = createHashedName("foo.html", "content")

        expect(value).toBe(`foo-${key}.html`)
    })

    test("key is the first 8 hex chars of the sha256 digest", () => {
        const { key } = createHashedName("foo.html", "content")

        expect(key).toHaveLength(8)
        expect(key).toMatch(/^[0-9a-f]{8}$/)
    })

    test("accepts a Buffer as content", () => {
        const fromString = createHashedName("foo.html", "content")
        const fromBuffer = createHashedName("foo.html", Buffer.from("content"))

        expect(fromBuffer).toEqual(fromString)
    })

    test("preserves multi-dot filenames, splitting on the last dot", () => {
        const { value } = createHashedName("app.component.html", "content")

        expect(value).toMatch(/^app\.component-[0-9a-f]{8}\.html$/)
    })
})
