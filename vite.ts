import { type Plugin } from "vite"
import path from "node:path";
import {FileReader} from "@ng-js-vite/reading/file-resolver.ts";
import {type CodeHashResult, CodeReader} from "@ng-js-vite/reading/code-reader.ts";
import {CodePatcher} from "@ng-js-vite/writing/code-patcher.ts";
import {TemplatePatcher} from "@ng-js-vite/writing/template-patcher.ts";
import {MappedCode} from "@ng-js-vite/writing/mapped-code.ts";

type NgJsTemplateParserOptions = {
    hashed?: boolean;
}

type NgJsTemplateObject = {
    reader: CodeReader,
    fileReader: FileReader,
    hashed: CodeHashResult
}

const DEFAULT_OPTIONS: NgJsTemplateParserOptions = {
    hashed: true,
}

const VIRTUAL_PREFIX = "\0ng-js-vite:"

export function ngJsTemplateParser(params?: NgJsTemplateParserOptions): Plugin {
    const templates = new Map<string, NgJsTemplateObject>()
    const styles = new Map<string, string>()
    const options = {
        ...DEFAULT_OPTIONS,
        ...params
    }

    /** El CSS escopeado como módulo virtual: Vite lo mete en su hoja de estilos. */
    const withStyleImport = (code: MappedCode, scope: string, style: Buffer) => {
        const virtualId = `${VIRTUAL_PREFIX}${scope}.css`
        styles.set(virtualId, style.toString("utf-8"))
        return code.prepend(`import ${JSON.stringify(virtualId)};\n`)
    }

    return {
        name: 'ngJsTemplateParser',

        configResolved(config) {
            FileReader.configure(config.root, config.base)
        },

        async transform(code, id) {
            if(!FileReader.validate(id, code)) return

            const reader = CodeReader.from(code)
            const fileReader = FileReader.parse(reader, id)

            const source = await TemplatePatcher.from(fileReader)

            if (fileReader.inline) {
                // `template` inline + `styleUrl`: el template queda en el código (escopeado), no se publica.
                const inlined = MappedCode.from(code, id).replace(
                    reader.templateDeclaration,
                    `template: ${JSON.stringify(source.template.toString("utf-8"))}`,
                )
                return (source.style ? withStyleImport(inlined, source.scope, source.style) : inlined).output()
            }

            const hashed = reader.hash(source.template.toString("utf-8"))

            templates.set(fileReader.templatePath, { reader, fileReader, hashed })

            const publicUrl = CodePatcher.url({ hashed: options.hashed }, fileReader, hashed)
            const transformed = MappedCode.from(code, id)
                .replace(CodeReader.templateRegExp, `templateUrl: ${JSON.stringify(publicUrl)}`)

            return (source.style ? withStyleImport(transformed, source.scope, source.style) : transformed).output()
        },

        resolveId(id) {
            if (id.startsWith(VIRTUAL_PREFIX)) return id
        },

        load(id) {
            return styles.get(id)
        },

        async generateBundle() {
            const emitted = new Set<string>()

            for (const template of templates.values()) {
                const hashedTemplateUrl = template.hashed.templateUrl
                const rawTemplatePath = template.fileReader.templatePath

                const templateUrl = options.hashed ? hashedTemplateUrl : rawTemplatePath
                const templateName = path.basename(templateUrl)
                const templateOut = path.join("templates", templateName)

                if (emitted.has(templateOut)) {
                    this.warn(
                        `ngJsTemplateParser: two templates resolve to "${templateOut}" - skipping "${rawTemplatePath}". ` +
                        `Hashed filenames are unique by design; with "hashed: false" templates that share a basename collide. ` +
                        `Rename one of them or enable hashing.`
                    )
                    continue
                }
                emitted.add(templateOut)

                const source = await TemplatePatcher.from(template.fileReader)

                this.emitFile({
                    type: "asset",
                    fileName: templateOut,
                    source: source.template,
                })
            }
        },

        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = req.url
                if (!url) return next();

                let pathname = new URL(url, "http://ng-js-vite.local").pathname.replace(/^\/+/, "")
                const normalizedBase = FileReader.base.replace(/^\/+|\/+$/g, "")
                if (normalizedBase && pathname.startsWith(`${normalizedBase}/`)) {
                    pathname = pathname.slice(normalizedBase.length + 1)
                }

                const template = [...templates.values()].find(
                    template => getTemplateRequestPath(template, options.hashed ?? true) === pathname
                )

                if (!template) return next();

                try {
                    const source = await TemplatePatcher.from(template.fileReader, { preventCache: true })

                    res.statusCode = 200
                    res.setHeader(
                        "Content-Type",
                        "text/html; charset=utf-8"
                    )

                    res.end(source.template)
                } catch (error) {
                    next(error)
                }
            })
        }
    }
}

function getTemplateRequestPath(template: NgJsTemplateObject, hashedFiles: boolean) {
    const templateUrl = hashedFiles
        ? template.hashed.templateUrl
        : template.fileReader.templatePath

    const fileName = path.basename(templateUrl)

    return `templates/${fileName}`
}
