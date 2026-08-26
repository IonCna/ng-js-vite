export function isValidFiles(filename: string) {
    if(filename.includes("node_modules")) return

    const regExp = /\.(ts|js)(\?.*)?$/
    return regExp.test(filename)
}
