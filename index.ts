import { type Plugin } from "vite"
import { isValidFiles } from "./src/utils/is-valid-files.ts";
import { obtainTemplateUrl } from "./src/utils/obtain-template-url.ts";
import { obtainStyleUrl } from "./src/utils/obtain-style-url.ts";
import { createHashedName } from "./src/utils/hash-name.ts";
import path from "node:path";
import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { resolveTemplatePath } from "./src/utils/resolve-template-path.ts";

type NgJsTemplateParserOptions = {
    hashed?: boolean;
}

type NgJsTemplateObject = {
    defaultName: string,
    hashedName: string,
    dir: string,
    sourceId: string,
    stylePath?: string,
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

    let base = "/"
    const root = process.cwd()

    return {
        name: 'ngJsTemplateParser',

        configResolved(config) {
            base = config.base.endsWith("/") ? config.base : `${config.base}/`;
        },

        async transform(code, id) {
            if (!isValidFiles(id)) return

            const templateObj = obtainTemplateUrl(code)
            if (!templateObj) return

            const styleObj = obtainStyleUrl(code)
            let transformedCode = code

            const { templateUrl } = templateObj
            const templatePath = resolveTemplatePath(
                root,
                id,
                templateUrl
            )

            const stylePath = styleObj
                ? resolveTemplatePath(root, id, styleObj.styleUrl)
                : undefined

            const source = await readTemplateWithInlineStyle.call(
                this,
                templateUrl,
                templatePath,
                id,
                styleObj?.styleUrl,
                stylePath
            )

            const defaultName = path.basename(templatePath)
            const hashed = createHashedName(
                defaultName,
                source
            )

            templates.set(templatePath, {
                defaultName,
                hashedName: hashed.value,
                dir: path.dirname(templatePath),
                sourceId: id,
                stylePath,
            })

            const outputName = options.hashed ? hashed.value : defaultName
            const publicUrl = `${base}templates/${outputName}`;

            transformedCode = transformedCode.replace(templateUrl, publicUrl)

            if (styleObj) {
                transformedCode = transformedCode.replace(styleObj.match, "ngJsViteInlineStyle: true")
            }

            return {
                code: transformedCode,
                map: null,
            }
        },

        async generateBundle() {
            const emitted = new Set<string>()

            for (const template of templates.values()) {
                let fileName = options.hashed ? template.hashedName : template.defaultName
                fileName = fileName.replace(/^\/+/, "")

                const outputPath = path.join("templates", fileName)

                if (emitted.has(outputPath)) {
                    this.warn(
                        `ngJsTemplateParser: two templates resolve to "${outputPath}" - skipping the one referenced from "${template.sourceId}". ` +
                        `Hashed filenames are unique by design; with "hashed: false" templates that share a basename collide. ` +
                        `Rename one of them or enable hashing.`
                    )
                    continue
                }

                const sourcePath = path.join(
                    template.dir,
                    template.defaultName
                )

                const source = await readTemplateWithInlineStyle.call(
                    this,
                    sourcePath,
                    sourcePath,
                    template.sourceId,
                    template.stylePath,
                    template.stylePath
                )

                emitted.add(outputPath)

                this.emitFile({
                    type: "asset",
                    fileName: outputPath,
                    source
                })
            }
        },

        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = req.url
                if (!url) return next();

                let pathname = new URL(url, "http://ng-js-vite.local").pathname.replace(/^\/+/, "")
                const normalizedBase = base.replace(/^\/+|\/+$/g, "")
                if (normalizedBase && pathname.startsWith(`${normalizedBase}/`)) {
                    pathname = pathname.slice(normalizedBase.length + 1)
                }

                const template = [...templates.values()].find(
                    template => getTemplateRequestPath(template, options.hashed ?? true) === pathname
                )

                if (!template) return next();

                try {
                    const filePath = path.join(
                        template.dir,
                        template.defaultName
                    )

                    const source = readTemplateWithInlineStyleSync(
                        filePath,
                        template.stylePath
                    )

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

async function readTemplateWithInlineStyle(
    this: { error: (message: string) => never },
    templateUrl: string,
    templatePath: string,
    sourceId: string,
    styleUrl?: string,
    stylePath?: string,
) {
    let template!: Buffer
    try {
        template = await readFile(templatePath)
    } catch (error) {
        this.error(
            `ngJsTemplateParser: could not read template "${templateUrl}" (resolved to "${templatePath}") referenced from "${sourceId}": ${(error as Error).message}`
        )
    }

    if (!stylePath) return template

    let style!: Buffer
    try {
        style = await readFile(stylePath)
    } catch (error) {
        this.error(
            `ngJsTemplateParser: could not read style "${styleUrl}" (resolved to "${stylePath}") referenced from "${sourceId}": ${(error as Error).message}`
        )
    }

    return inlineStyle(template, style)
}

function readTemplateWithInlineStyleSync(templatePath: string, stylePath?: string) {
    const template = readFileSync(templatePath)
    if (!stylePath) return template

    const style = readFileSync(stylePath)
    return inlineStyle(template, style)
}

function inlineStyle(template: Buffer, style: Buffer) {
    return Buffer.concat([
        Buffer.from(`<style data-ng-js-vite>\n`),
        style,
        Buffer.from(`\n</style>\n`),
        template,
    ])
}

function getTemplateRequestPath(template: NgJsTemplateObject, hashedFiles: boolean) {
    const fileName = hashedFiles ? template.hashedName : template.defaultName
    return `templates/${fileName}`
}
