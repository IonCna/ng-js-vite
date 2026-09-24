import { CodeReader } from "@ng-js-vite/reading/code-reader.ts";
import { FileReader } from "@ng-js-vite/reading/file-resolver.ts";
import { StyleInjector } from "@ng-js-vite/writing/style-injector.ts";
import { TemplatePatcher } from "@ng-js-vite/writing/template-patcher.ts";

export { TemplateFiles, type TemplateFilesOptions } from "@ng-js-vite/writing/template-files.ts";

/**
 * Implementación esbuild del scoping de template/CSS — mismo mecanismo que
 * `ngJsTemplateParser` (el plugin de Vite, en `./vite`), pero como un
 * transform de código plano (`{ transform(code, path) }`), sin depender de
 * ningún paquete externo por el tipo — cualquier consumidor con esa forma
 * (duck typing) lo puede usar tal cual, no hace falta importar nada de acá.
 *
 * Inlinea el template (escopeado) directo en el código; el CSS se inyecta al
 * `document.head` desde el propio módulo compilado, autocontenido (sin
 * dev-server sirviendo `/templates/...`). Para templates en archivos aparte
 * (`templates/`), ver `TemplateFiles`.
 */
export const templateTransform = {
  async transform(code: string, path: string): Promise<string | undefined> {
    if (!FileReader.validate(path, code)) return undefined;

    const reader = CodeReader.from(code);
    const fileReader = FileReader.parse(reader, path);
    const patched = await TemplatePatcher.from(fileReader);

    const result = code.replace(
      CodeReader.templateRegExp,
      `template: ${JSON.stringify(patched.template.toString("utf8"))}`,
    );

    return StyleInjector.apply(result, patched.style);
  },
};
