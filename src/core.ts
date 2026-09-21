/**
 * Superficie reusable del scoping de template/CSS, para consumidores que no
 * son un `Plugin` de Vite (p.ej. un plugin de esbuild en `ng-js-cli`).
 * `CodePatcher` queda afuera a propósito: asume `FileReader.base` + un
 * dev-server sirviendo `/templates/...` en runtime, específico del modo dev
 * de Vite.
 */
export { CodeReader, type CodeHashResult } from "@ng-js-vite/reading/code-reader.ts";
export { FileReader, type FileReaderReadOptions } from "@ng-js-vite/reading/file-resolver.ts";
export { TemplatePatcher } from "@ng-js-vite/writing/template-patcher.ts";
