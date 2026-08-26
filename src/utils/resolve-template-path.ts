import path from "node:path"

export function resolveTemplatePath(root: string, id: string, templateUrl: string) {
    if (templateUrl.startsWith("/")) {
        return path.resolve(root, templateUrl.slice(1))
    }

    if (templateUrl.startsWith("./") || templateUrl.startsWith("../")) {
        return path.resolve(path.dirname(id), templateUrl)
    }

    if (templateUrl.startsWith("src/")) {
        return path.resolve(root, templateUrl)
    }

    return path.resolve(path.dirname(id), templateUrl)
}