import { CodeReader } from "@ng-js-vite/reading/code-reader.ts";
import { FileReader } from "@ng-js-vite/reading/file-resolver.ts";
import { TemplatePatcher } from "@ng-js-vite/writing/template-patcher.ts";

/**
 * Implementación esbuild del scoping de template/CSS — mismo mecanismo que
 * `ngJsTemplateParser` (el plugin de Vite, en `./vite`), pero como un
 * transform de código plano (`{ transform(code, path) }`), sin depender de
 * ningún paquete externo por el tipo — cualquier consumidor con esa forma
 * (duck typing) lo puede usar tal cual, no hace falta importar nada de acá.
 *
 * Inlinea el template (escopeado) directo en el código; el CSS se inyecta al
 * `document.head` desde el propio módulo compilado, autocontenido (sin
 * dev-server sirviendo `/templates/...`, a diferencia del modo Vite).
 */
export const templateTransform = {
  async transform(code: string, path: string): Promise<string | undefined> {
    if (!FileReader.validate(path, code)) return undefined;

    const reader = CodeReader.from(code);
    const fileReader = FileReader.parse(reader, path);
    const patched = await TemplatePatcher.from(fileReader);

    let result = code.replace(
      CodeReader.templateRegExp,
      `template: ${JSON.stringify(patched.template.toString("utf8"))}`,
    );

    if (patched.style) {
      const removeStyleUrl = new RegExp(`${CodeReader.styleRegExp.source},?`);
      result = result.replace(removeStyleUrl, "");
      result += `\n(function () { var s = document.createElement("style"); s.textContent = ${JSON.stringify(
        patched.style.toString("utf8"),
      )}; document.head.appendChild(s); })();\n`;
    }

    return result;
  },
};
