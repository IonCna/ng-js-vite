import {createHash} from "node:crypto";

export type CodeHashResult = {
    templateUrl: string
    key: string
}

export class CodeReader {
    static templateRegExp = /templateUrl\s*:\s*(['"])(.*?)\1/
    /**
     * `template` inline como literal (comillas o backticks sin `${...}`). Solo cuenta si el componente además tiene
     * estilos: el CSS se escopea con un atributo que el template también tiene que llevar.
     */
    static inlineTemplateRegExp = /\btemplate\s*:\s*(`(?:[^`\\$]|\\[\s\S]|\$(?!\{))*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/
    /** El `selector` del decorador: es el host del componente (`:host` del CSS se traduce a él). */
    static selectorRegExp = /\bselector\s*:\s*(['"])(.*?)\1/

    private constructor(
        public readonly templateUrl: string | undefined,
        /** `styleUrls: [...]` (Angular 16) y/o `styleUrl: "..."`, en orden. */
        public readonly styleUrls: string[] = [],
        public readonly selector?: string,
        /** El valor del `template` inline (sin `templateUrl`, con estilos). */
        public readonly inlineTemplate?: string,
        /** `styles: [...]` / `styles: "..."`: CSS inline del componente, en orden. */
        public readonly styles: string[] = [],
    ) {}

    /** El primer `styleUrl`/`styleUrls` (o `undefined`). */
    public get styleUrl(): string | undefined {
        return this.styleUrls[0]
    }

    public get hasStyles(): boolean {
        return this.styleUrls.length > 0 || this.styles.length > 0
    }

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
        const declarations = CodeReader.styleDeclarations(content)
        const styleUrls = declarations.flatMap(declaration => declaration.urls)
        const styles = declarations.flatMap(declaration => declaration.styles)
        const selector = content.match(CodeReader.selectorRegExp)?.[2]

        const inlineTemplate = !CodeReader.templateRegExp.test(content) && declarations.length > 0
            ? CodeReader._getInlineTemplate(content)
            : undefined
        if (inlineTemplate !== undefined) return new CodeReader(undefined, styleUrls, selector, inlineTemplate, styles)

        return new CodeReader(CodeReader._getTemplate(content), styleUrls, selector, undefined, styles)
    }

    /** Componente con `template` inline + estilos (`styleUrl`/`styleUrls`/`styles`), sin `templateUrl`. */
    static hasInlineTemplateWithStyle(source: string): boolean {
        if (!/\bstyle(Url|Urls|s)\b/.test(source)) return false
        const content = CodeReader.withoutComments(source)
        return !CodeReader.templateRegExp.test(content)
            && CodeReader.styleDeclarations(content).length > 0
            && CodeReader.inlineTemplateRegExp.test(content)
    }

    /**
     * Cada `styleUrl: "..."`, `styleUrls: ["...", ...]` y `styles: "..."`/`styles: [\`...\`, ...]` del código (sin
     * comentarios, ver `withoutComments`), con su rango — `end` incluye la coma que lo sigue, para sacarlo entero.
     * Solo literales (comillas o backticks sin `${...}`): un valor que no se puede leer en build no es una declaración.
     */
    static styleDeclarations(content: string): { start: number, end: number, urls: string[], styles: string[] }[] {
        const declarations: { start: number, end: number, urls: string[], styles: string[] }[] = []
        for (const match of content.matchAll(/\b(styleUrls|styleUrl|styles)\s*:\s*/g)) {
            const key = match[1]!
            const at = match.index! + match[0].length
            const list = content[at] === "["
            if (key === "styleUrl" && list) continue
            if (key === "styleUrls" && !list) continue
            const parsed = list ? CodeReader._literalList(content, at) : CodeReader._literal(content, at)
            if (!parsed) continue
            const values = Array.isArray(parsed.value) ? parsed.value : [parsed.value]
            const comma = /^\s*,/.exec(content.slice(parsed.end))
            declarations.push({
                start: match.index!,
                end: parsed.end + (comma ? comma[0].length : 0),
                urls: key === "styles" ? [] : values,
                styles: key === "styles" ? values : [],
            })
        }
        return declarations
    }

    /** Un literal de string en `at` (`'...'`, `"..."` o backticks sin `${...}`), ya evaluado. */
    private static _literal(content: string, at: number): { value: string, end: number, quote: string } | undefined {
        const quote = content[at]
        if (quote !== "'" && quote !== '"' && quote !== "`") return
        let i = at + 1
        while (i < content.length && content[i] !== quote) {
            if (content[i] === "\\") i += 2
            else if (quote !== "`" && content[i] === "\n") return
            else if (quote === "`" && content[i] === "$" && content[i + 1] === "{") return
            else i++
        }
        if (i >= content.length) return
        return { value: new Function(`return ${content.slice(at, i + 1)}`)() as string, end: i + 1, quote }
    }

    /** `[literal, literal, ...]` en `at` (coma final permitida). */
    private static _literalList(content: string, at: number): { value: string[], end: number } | undefined {
        const values: string[] = []
        let i = at + 1
        const skip = () => { while (/\s/.test(content[i] ?? "")) i++ }
        skip()
        while (content[i] !== "]") {
            const literal = CodeReader._literal(content, i)
            if (!literal) return
            values.push(literal.value)
            i = literal.end
            skip()
            if (content[i] === ",") { i++; skip() }
            else if (content[i] !== "]") return
        }
        return { value: values, end: i + 1 }
    }

    private static _getInlineTemplate(content: string): string | undefined {
        const literal = content.match(CodeReader.inlineTemplateRegExp)?.[1]
        if (literal === undefined) return
        // Un literal sin `${...}`: evaluarlo da su valor ya "cocinado" (escapes, `\n`, etc.).
        return new Function(`return ${literal}`)() as string
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
