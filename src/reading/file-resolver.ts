import {CodeReader} from "@ng-js-vite/reading/code-reader.ts";
import path from "node:path";
import {readFile} from "node:fs/promises";

export type FileReaderReadOptions = {
    preventCache?: boolean
    /** Pasa por cada hoja antes de unirlas: `from` es el `.css` (con `styles` inline, el template o el componente). */
    styleTransform?: (css: string, from: string) => string
}

export class FileReader {
    private static root= process.cwd()
    private static blacklist = new Set([
        "node_modules"
    ])

    public static base = "/"

    private _template!: Buffer
    private _style?: Buffer

    private constructor(
        /** El `.html` del `templateUrl`; con template inline, el propio componente (de ahí sale el scope). */
        public readonly templatePath: string,
        /** Los `.css` de `styleUrls`/`styleUrl`, en orden. */
        public readonly stylePaths: string[] = [],
        /** El `selector` del componente — a qué se traduce `:host` en su CSS (`TemplatePatcher`). */
        public readonly hostSelector?: string,
        /** El `template` inline del componente (sin `templateUrl`): no se lee de disco. */
        public readonly inlineTemplate?: Buffer,
        /** `styles` del componente (CSS inline), en orden. */
        public readonly inlineStyles: string[] = [],
    ) {}

    public get inline(): boolean {
        return this.inlineTemplate !== undefined
    }

    /** El primer `.css` (o `undefined`): de él toma el nombre la hoja publicada. */
    public get stylePath(): string | undefined {
        return this.stylePaths[0]
    }

    public get hasStyles(): boolean {
        return this.stylePaths.length > 0 || this.inlineStyles.length > 0
    }

    /** Como Angular: primero `styles`, después cada `styleUrls`, en una sola hoja. */
    public async read(options: FileReaderReadOptions = { }) {
        if(this._template && !options.preventCache) return {
            template: this._template,
            style: this._style
        }

        const readTemplate = () => this.inlineTemplate ?? readFile(this.templatePath)

        if(!this.hasStyles) {
            this._template = await readTemplate()
            return { template: this._template }
        }

        const [template, files] = await Promise.all([
            readTemplate(),
            Promise.all(this.stylePaths.map(stylePath => readFile(stylePath, "utf-8"))),
        ])

        this._template = template
        const transform = options.styleTransform
        const sheets = transform
            ? [
                ...this.inlineStyles.map(css => transform(css, this.templatePath)),
                ...files.map((css, index) => transform(css, this.stylePaths[index]!)),
            ]
            : [...this.inlineStyles, ...files]
        this._style = Buffer.from(sheets.join("\n"), "utf-8")

        return {
            template: this._template,
            style: this._style,
        }
    }

    static configure(root: string, base: string) {
        FileReader.root = root
        FileReader.base = base.endsWith("/") ? base : `${base}/`
    }

    static parse(reader: CodeReader, id: string) {
        const styleLocations = reader.styleUrls.map(styleUrl => FileReader._resolve(styleUrl, id))
        if(reader.inlineTemplate !== undefined) {
            const [componentPath = id] = id.split("?")
            return new FileReader(path.resolve(componentPath), styleLocations, reader.selector, Buffer.from(reader.inlineTemplate, "utf-8"), reader.styles)
        }

        const templateLocation = FileReader._resolve(reader.templateUrl!, id)
        return new FileReader(templateLocation, styleLocations, reader.selector, undefined, reader.styles)
    }

    static validate(id: string, content: string) {
        const [cleanId = id, query] = id.split("?")
        const queryParams = new URLSearchParams(query)
        if (queryParams.has("raw")) return false

        const isBanned = [...FileReader.blacklist].some(
            entry => cleanId.split(/[\\/]/).includes(entry)
        )
        if(isBanned) return false

        const candidates = /\.(ts|js)$/
        const isCandidate = candidates.test(cleanId)

        if(!isCandidate) return false
        if (!content.includes("templateUrl") && !/\bstyle(Url|Urls|s)\b/.test(content)) return false
        return CodeReader.templateRegExp.test(CodeReader.withoutComments(content)) || CodeReader.hasInlineTemplateWithStyle(content)
    }

    private static _resolve(templateUrl: string, id: string) {
        if (templateUrl.startsWith("/")) {
            return path.resolve(FileReader.root, templateUrl.slice(1))
        }

        if (templateUrl.startsWith("./") || templateUrl.startsWith("../")) {
            return path.resolve(path.dirname(id), templateUrl)
        }

        if (templateUrl.startsWith("src/")) {
            return path.resolve(FileReader.root, templateUrl)
        }

        return path.resolve(path.dirname(id), templateUrl)
    }
}
