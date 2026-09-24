import {createHash} from "node:crypto";

export type CodeHashResult = {
    templateUrl: string
    key: string
}

export class CodeReader {
    static templateRegExp = /templateUrl\s*:\s*(['"])(.*?)\1/
    static styleRegExp = /styleUrl\s*:\s*(['"])(.*?)\1/
    /** El `selector` del decorador: es el host del componente (`:host` del CSS se traduce a él). */
    static selectorRegExp = /\bselector\s*:\s*(['"])(.*?)\1/

    private constructor(
        public readonly templateUrl: string,
        public readonly styleUrl?: string,
        public readonly selector?: string,
    ) {}

    private _hash!: string
    private _hashedName!: string

    public get hashes(): CodeHashResult {
        return {
            key: this._hash,
            templateUrl: this._hashedName,
        }
    }

    public hash(html: string): CodeHashResult {
        if(this._hash && this._hashedName) return this.hashes

        const contentHash = createHash("sha256")
        const hashStr = contentHash.update(html).digest("hex").slice(0, 8)

        const extensionIndex = this.templateUrl.lastIndexOf(".")
        const base = this.templateUrl.slice(0, extensionIndex)
        const extension = this.templateUrl.slice(extensionIndex)

        this._hash = hashStr
        this._hashedName = `${base}-${hashStr}${extension}`

        return this.hashes
    }

    static from(content: string): CodeReader {
        const templateUrl = CodeReader._getTemplate(content)
        const styleUrl = CodeReader._getStyle(content)
        const selector = content.match(CodeReader.selectorRegExp)?.[2]

        return new CodeReader(templateUrl, styleUrl, selector)
    }

    private static _getStyle(content: string): string | undefined {
        if (!content.includes("styleUrl")) return

        const match = content.match(CodeReader.styleRegExp)
        if (!match) return

        const [,,styleUrl] = match
        if (styleUrl === undefined) return

        return styleUrl
    }

    private static _getTemplate(content: string): string {
        if (!content.includes("templateUrl")) {
            throw new Error("content must have templateUrl")
        }

        const match = content.match(
            CodeReader.templateRegExp,
        )

        if (!match) {
            throw new Error("templateUrl must be defined")
        }

        const [,,templateUrl] = match
        if (templateUrl === undefined) {
            throw new Error("templateUrl must be defined")
        }

        return templateUrl
    }
}
