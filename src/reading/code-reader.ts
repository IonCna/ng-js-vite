import {createHash} from "node:crypto";

export type CodeHashResult = {
    templateUrl: string
    key: string
}

export class CodeReader {
    static templateRegExp = /templateUrl\s*:\s*(['"])(.*?)\1/
    static styleRegExp = /styleUrl\s*:\s*(['"])(.*?)\1/
    /**
     * `template` inline como literal (comillas o backticks sin `${...}`). Solo cuenta si el componente además tiene
     * `styleUrl`: el CSS se escopea con un atributo que el template también tiene que llevar.
     */
    static inlineTemplateRegExp = /\btemplate\s*:\s*(`(?:[^`\\$]|\\[\s\S]|\$(?!\{))*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/
    /** El `selector` del decorador: es el host del componente (`:host` del CSS se traduce a él). */
    static selectorRegExp = /\bselector\s*:\s*(['"])(.*?)\1/

    private constructor(
        public readonly templateUrl: string | undefined,
        public readonly styleUrl?: string,
        public readonly selector?: string,
        /** El valor del `template` inline (sin `templateUrl`, con `styleUrl`). */
        public readonly inlineTemplate?: string,
    ) {}

    private _hash!: string
    private _hashedName!: string

    public get hashes(): CodeHashResult {
        return {
            key: this._hash,
            templateUrl: this._hashedName,
        }
    }

    /** `templateUrl: "..."` o, si es inline, `template: ...`: lo que se reemplaza por el template escopeado. */
    public get templateDeclaration(): RegExp {
        return this.inlineTemplate !== undefined ? CodeReader.inlineTemplateRegExp : CodeReader.templateRegExp
    }

    public hash(html: string): CodeHashResult {
        if(this._hash && this._hashedName) return this.hashes
        if(this.templateUrl === undefined) throw new Error("an inline template has no templateUrl to hash")

        const contentHash = createHash("sha256")
        const hashStr = contentHash.update(html).digest("hex").slice(0, 8)

        const extensionIndex = this.templateUrl.lastIndexOf(".")
        const base = this.templateUrl.slice(0, extensionIndex)
        const extension = this.templateUrl.slice(extensionIndex)

        this._hash = hashStr
        this._hashedName = `${base}-${hashStr}${extension}`

        return this.hashes
    }

    /**
     * El código con los comentarios (`//`, `/* *\/`) en blanco — mismo largo, así los índices siguen valiendo para el
     * original. Un `templateUrl`/`styleUrl` citado en un comentario no es del componente. Respeta strings y template
     * literals (con `${...}` anidados); un literal de regex con `//` o comillas adentro puede confundirlo.
     */
    static withoutComments(code: string): string {
        const n = code.length
        let out = ""
        let i = 0
        /** Llaves abiertas en el código actual; al entrar a un `${` se guardan las de afuera. */
        let braces = 0
        const interpolations: number[] = []

        const templateLiteral = () => {
            while (i < n) {
                const c = code[i]
                if (c === "\\") { out += code.slice(i, i + 2); i += 2; continue }
                if (c === "`") { out += c; i++; return }
                if (c === "$" && code[i + 1] === "{") {
                    out += "${"; i += 2
                    interpolations.push(braces)
                    braces = 0
                    return
                }
                out += c; i++
            }
        }

        while (i < n) {
            const c = code[i]
            const next = code[i + 1]
            if (c === "/" && next === "/") {
                const end = code.indexOf("\n", i)
                const stop = end === -1 ? n : end
                out += " ".repeat(stop - i); i = stop
            } else if (c === "/" && next === "*") {
                const end = code.indexOf("*/", i + 2)
                const stop = end === -1 ? n : end + 2
                out += code.slice(i, stop).replace(/[^\n]/g, " "); i = stop
            } else if (c === "'" || c === '"') {
                let j = i + 1
                while (j < n && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1
                out += code.slice(i, j + 1); i = j + 1
            } else if (c === "`") {
                out += c; i++
                templateLiteral()
            } else if (c === "}" && braces === 0 && interpolations.length) {
                out += c; i++
                braces = interpolations.pop()!
                templateLiteral()
            } else {
                if (c === "{") braces++
                else if (c === "}") braces--
                out += c; i++
            }
        }
        return out.slice(0, n)
    }

    /** Reemplaza el primer match de `regExp` fuera de comentarios (literal: sin patrones `$&`/`$1` de `String.replace`). */
    static replace(code: string, regExp: RegExp, replacement: string): string {
        const match = CodeReader.withoutComments(code).match(regExp)
        if (!match || match.index === undefined) return code
        return code.slice(0, match.index) + replacement + code.slice(match.index + match[0].length)
    }

    static from(source: string): CodeReader {
        const content = CodeReader.withoutComments(source)
        const styleUrl = CodeReader._getStyle(content)
        const selector = content.match(CodeReader.selectorRegExp)?.[2]

        const inlineTemplate = !CodeReader.templateRegExp.test(content) && styleUrl !== undefined
            ? CodeReader._getInlineTemplate(content)
            : undefined
        if (inlineTemplate !== undefined) return new CodeReader(undefined, styleUrl, selector, inlineTemplate)

        return new CodeReader(CodeReader._getTemplate(content), styleUrl, selector)
    }

    /** Componente con `template` inline + `styleUrl` (sin `templateUrl`). */
    static hasInlineTemplateWithStyle(source: string): boolean {
        if (!source.includes("styleUrl")) return false
        const content = CodeReader.withoutComments(source)
        return !CodeReader.templateRegExp.test(content)
            && CodeReader.styleRegExp.test(content)
            && CodeReader.inlineTemplateRegExp.test(content)
    }

    private static _getInlineTemplate(content: string): string | undefined {
        const literal = content.match(CodeReader.inlineTemplateRegExp)?.[1]
        if (literal === undefined) return
        // Un literal sin `${...}`: evaluarlo da su valor ya "cocinado" (escapes, `\n`, etc.).
        return new Function(`return ${literal}`)() as string
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
