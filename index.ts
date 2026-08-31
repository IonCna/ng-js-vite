import { type Plugin } from "vite"
import { isValidFiles } from "./src/utils/is-valid-files.ts";
import { obtainTemplateUrl } from "./src/utils/obtain-template-url.ts";
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

            const { templateUrl } = templateObj

            const resolvedPath = resolveTemplatePath(
                root,
                id,
                templateUrl
            )

            let source!: Buffer
            try {
                source = await readFile(resolvedPath)
            } catch (error) {
                this.error(
                    `ngJsTemplateParser: could not read template "${templateUrl}" (resolved to "${resolvedPath}") referenced from "${id}": ${(error as Error).message}`
                )
            }

            const defaultName = path.basename(resolvedPath)

            const hashed = createHashedName(
                defaultName,
                source
            )

            templates.set(hashed.key, {
                defaultName,
                hashedName: hashed.value,
                dir: path.dirname(resolvedPath),
                sourceId: id,
            })

            const outputName = options.hashed ? hashed.value : defaultName
            const publicUrl = `${base}templates/${outputName}`;

            return {
                code: code.replace(templateUrl, publicUrl),
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
                        `ngJsTemplateParser: two templates resolve to "${outputPath}" — skipping the one referenced from "${template.sourceId}". ` +
                        `Hashed filenames are unique by design; with "hashed: false" templates that share a basename collide. ` +
                        `Rename one of them or enable hashing.`
                    )
                    continue
                }

                const sourcePath = path.join(
                    template.dir,
                    template.defaultName
                )

                let source!: Buffer
                try {
                    source = await readFile(sourcePath)
                } catch (error) {
                    this.error(
                        `ngJsTemplateParser: could not read template "${sourcePath}" referenced from "${template.sourceId}": ${(error as Error).message}`
                    )
                }

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

                const fileName = path.basename(url)
                const template = [...templates.values()].find(
                    template => (options.hashed ? template.hashedName : template.defaultName) === fileName
                )

                if (!template) return next();

                try {
                    const filePath = path.join(
                        template.dir,
                        template.defaultName
                    )

                    const source = readFileSync(filePath)

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