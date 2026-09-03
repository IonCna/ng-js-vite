import { createHash } from "node:crypto";

export type TemplatePatcherParams = {
    template: Buffer,
    scope?: string,
    style?: Buffer
}

export class TemplatePatcher {
    static from({template, style}: TemplatePatcherParams): Buffer {
        if(!style) return template

        return Buffer.concat([
            Buffer.from("<style data-ng-js-vite>\n"),
            style,
            Buffer.from("\n</style>\n"),
            template,
        ])
    }

    static scope(templatePath: string): string {
        const hash = createHash("sha256")
            .update(templatePath)
            .digest("hex")
            .slice(0, 8)

        return `_content-${hash}`
    }
}
