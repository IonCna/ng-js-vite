import { CodeReader } from "@ng-js-vite/reading/code-reader.ts";
import type { MappedCode } from "@ng-js-vite/writing/mapped-code.ts";

/**
 * CSS escopeado de un componente en los transforms de esbuild: se quita el `styleUrl` y el propio módulo compilado
 * lo agrega a `document.head` en un `<style>` al evaluarse, como Angular — síncrono, antes de que exista ningún
 * componente (la vista nunca se pinta sin sus estilos), y el de un componente lazy llega con su chunk, no antes.
 */
export class StyleInjector {
  /** El CSS, en un `<style>` que agrega el módulo. */
  static apply(code: MappedCode, style: Buffer | undefined): MappedCode {
    if (!style) return code;
    return StyleInjector.withoutStyleUrl(code).append(
      `\n(function () { var s = document.createElement("style"); s.textContent = ${JSON.stringify(
        style.toString("utf8"),
      )}; document.head.appendChild(s); })();\n`,
    );
  }

  /** Saca `styleUrl`/`styleUrls`/`styles` del código: el CSS ya viaja escopeado por otro lado. */
  private static withoutStyleUrl(code: MappedCode): MappedCode {
    return code.removeRanges((source) => CodeReader.styleDeclarations(CodeReader.withoutComments(source)));
  }
}
