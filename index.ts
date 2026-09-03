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

const VIRTUAL_PREFIX = "\0ng-js-vite:"

export function ngJsTemplateParser(params?: NgJsTemplateParserOptions): Plugin {
    const templates = new Map<string, NgJsTemplateObject>()
    const styles = new Map<string, string>()
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

            const source = await TemplatePatcher.from(fileReader)

            const hashed = reader.hash(source.template.toString("utf-8"))

            templates.set(fileReader.templatePath, { reader, fileReader, hashed })

            let transformedCode = CodePatcher.from({
                code,
                hashed: options.hashed,
            }, reader, fileReader, hashed)

            if (source.style) {
                const virtualId = `${VIRTUAL_PREFIX}${source.scope}.css`
                styles.set(virtualId, source.style.toString("utf-8"))
                transformedCode = `import ${JSON.stringify(virtualId)};\n${transformedCode}`
            }

            return {
                code: transformedCode,
                map: null,
            }
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
