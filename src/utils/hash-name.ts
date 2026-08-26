import { createHash } from "node:crypto"

export function createHashedName(name: string, content: string | Buffer | Buffer<ArrayBufferLike>) {
    const hash = createHash("sha256")
    const hashStr = hash.update(content).digest("hex").slice(0, 8)

    const extensionIndex = name.lastIndexOf(".")
    const base = name.slice(0, extensionIndex)
    const extension = name.slice(extensionIndex)

    return {
        key: hashStr,
        value: `${base}-${hashStr}${extension}`,
    }
}
