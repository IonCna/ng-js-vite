import { type Plugin } from "vite"
import path from "node:path";
import {FileReader} from "@ng-js-vite/reading/file-resolver.ts";
import {type CodeHashResult, CodeReader} from "@ng-js-vite/reading/code-reader.ts";
import {CodePatcher} from "@ng-js-vite/writing/code-patcher.ts";
import {TemplatePatcher} from "@ng-js-vite/writing/template-patcher.ts";

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

export function ngJsTemplateParser(params?: NgJsTemplateParserOptions): Plugin {
    const templates = new Map<string, NgJsTemplateObject>()
    const options = {
        ...DEFAULT_OPTIONS,
        ...params
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

            const content = await fileReader.read()
            const source = TemplatePatcher.from({
                ...content,
                scope: TemplatePatcher.scope(fileReader.templatePath),
            })

            const hashed = reader.hash(source.toString("utf-8"))

            templates.set(fileReader.templatePath, { reader, fileReader, hashed })

            const transformedCode = CodePatcher.from({
                code,
                hashed: options.hashed,
                styleIsolate: true,
            }, reader, fileReader, hashed)

            return {
                code: transformedCode,
                map: null,
            }
        },

        async generateBundle() {
            const emitted = new Set<string>()

            for (const template of templates.values()) {
                const fileName = path.basename(
                    options.hashed
                        ? template.hashed.templateUrl
                        : template.fileReader.templatePath
                )

                const outputPath = path.join("templates", fileName)

                if (emitted.has(outputPath)) {
                    this.warn(
                        `ngJsTemplateParser: two templates resolve to "${outputPath}" - skipping "${template.fileReader.templatePath}". ` +
                        `Hashed filenames are unique by design; with "hashed: false" templates that share a basename collide. ` +
                        `Rename one of them or enable hashing.`
                    )
                    continue
                }

                const { template: templateBuffer, style: styleBuffer } = await template.fileReader.read()

                const source = TemplatePatcher.from({
                    template: templateBuffer,
                    scope: TemplatePatcher.scope(template.fileReader.templatePath),
                    style: styleBuffer
                })

                emitted.add(outputPath)

                this.emitFile({
                    type: "asset",
                    fileName: outputPath,
                    source
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
                    const { template: templateBuffer, style: styleBuffer } = await template.fileReader.read({ preventCache: true })

                    const source = TemplatePatcher.from({
                        template: templateBuffer,
                        scope: TemplatePatcher.scope(template.fileReader.templatePath),
                        style: styleBuffer
                    })

                    res.statusCode = 200
                    res.setHeader(
                        "Content-Type",
                        "text/html; charset=utf-8"
                    )

                    res.end(source)
                } catch (error) {
                    next(error)
                }
            })
        }
    }
}

function getTemplateRequestPath(template: NgJsTemplateObject, hashedFiles: boolean) {
    const fileName = path.basename(
        hashedFiles
            ? template.hashed.templateUrl
            : template.fileReader.templatePath
    )
    return `templates/${fileName}`
}
