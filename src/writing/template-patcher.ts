export type TemplatePatcherParams = {
    template: Buffer
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
}
