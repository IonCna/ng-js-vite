import MagicString from "magic-string"
import { CodeReader } from "@ng-js-vite/reading/code-reader.ts"

/** Source map v3 del código transformado al que se recibió (`sources` = el path del archivo). */
export type SourceMapV3 = {
    version: number
    file?: string
    sourceRoot?: string
    sources: string[]
    sourcesContent?: string[]
    names: string[]
    mappings: string
}

/** El código transformado con su source map — la forma que devuelven los transforms (Vite y la cadena de esbuild). */
export type MappedOutput = { code: string; map: SourceMapV3 }

/**
 * Las ediciones de un transform (reemplazar el `templateUrl`, sacar el `styleUrl`, agregar el `<link>`/`import` del
 * CSS) con su source map: el resto del componente sigue apuntando a su línea del `.ts` aunque el template inline
 * de varias líneas pase a ser un string de una. Los reemplazos buscan sobre el código ORIGINAL (sin comentarios,
 * que `withoutComments` deja como espacios: mismos offsets).
 */
export class MappedCode {
    private readonly text: MagicString

    private constructor(private readonly code: string, private readonly path: string) {
        this.text = new MagicString(code)
    }

    static from(code: string, path: string): MappedCode {
        return new MappedCode(code, path)
    }

    /** El primer match de `regExp` fuera de comentarios, por `replacement` (literal; vacío = lo saca). */
    replace(regExp: RegExp, replacement: string): this {
        const match = CodeReader.withoutComments(this.code).match(regExp)
        if (!match || match.index === undefined) return this
        const end = match.index + match[0].length
        if (replacement) this.text.overwrite(match.index, end, replacement)
        else this.text.remove(match.index, end)
        return this
    }

    prepend(text: string): this {
        this.text.prepend(text)
        return this
    }

    append(text: string): this {
        this.text.append(text)
        return this
    }

    output(): MappedOutput {
        const map = this.text.generateMap({ source: this.path, hires: true, includeContent: true })
        return { code: this.text.toString(), map: JSON.parse(map.toString()) as SourceMapV3 }
    }
}
