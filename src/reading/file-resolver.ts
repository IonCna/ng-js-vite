import {CodeReader} from "@ng-js-vite/reading/code-reader.ts";
import path from "node:path";
import {readFile} from "node:fs/promises";

export type FileReaderReadOptions = {
    preventCache?: boolean
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
        public readonly stylePath?: string,
        /** El `selector` del componente — a qué se traduce `:host` en su CSS (`TemplatePatcher`). */
        public readonly hostSelector?: string,
        /** El `template` inline del componente (sin `templateUrl`): no se lee de disco. */
        public readonly inlineTemplate?: Buffer,
    ) {}

    public get inline(): boolean {
        return this.inlineTemplate !== undefined
    }

    public async read(options: FileReaderReadOptions = { }) {
        if(this._template && !options.preventCache) return {
            template: this._template,
            style: this._style
        }

        const readTemplate = () => this.inlineTemplate ?? readFile(this.templatePath)

        if(!this.stylePath) {
            this._template = await readTemplate()
            return { template: this._template }
        }

        const [template, style] = await Promise.all([
            readTemplate(),
            readFile(this.stylePath),
        ])

        this._template = template
        this._style = style

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
        if(reader.inlineTemplate !== undefined) {
            const [componentPath = id] = id.split("?")
            const styleLocation = reader.styleUrl ? FileReader._resolve(reader.styleUrl, id) : undefined
            return new FileReader(path.resolve(componentPath), styleLocation, reader.selector, Buffer.from(reader.inlineTemplate, "utf-8"))
        }

        const templateLocation = FileReader._resolve(reader.templateUrl!, id)

        if(reader.styleUrl) {
            const styleLocation = FileReader._resolve(reader.styleUrl, id)
            return new FileReader(templateLocation, styleLocation, reader.selector)
        }

        return new FileReader(templateLocation, undefined, reader.selector)
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
        if (!content.includes("templateUrl") && !content.includes("styleUrl")) return false
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
