import path from "node:path";
import {CodeReader, type CodeHashResult} from "@ng-js-vite/reading/code-reader.ts";
import {FileReader} from "@ng-js-vite/reading/file-resolver.ts";

export type CodePatcherParams = {
    code: string
    hashed?: boolean
}

export class CodePatcher {
    public static from(
        params: CodePatcherParams,
        reader: CodeReader,
        fileReader: FileReader,
        hashed: CodeHashResult,
    ): string {
        const templateName = params.hashed
            ? path.basename(hashed.templateUrl)
            : path.basename(fileReader.templatePath)
        const publicUrl = `${FileReader.base}templates/${templateName}`
        return params.code.replace(reader.templateUrl, publicUrl)
    }
}
