import { CodeReader } from "@ng-js-vite/reading/code-reader.ts";

/**
 * CSS escopeado de un componente en los transforms de esbuild: se quita el `styleUrl` y el propio módulo compilado
 * lo agrega a `document.head` al evaluarse — así el CSS de un componente lazy llega con su chunk, no antes.
 */
export class StyleInjector {
  /** El CSS inline, en un `<style>` (`templateTransform`: todo autocontenido en el JS). */
  static apply(code: string, style: Buffer | undefined): string {
    if (!style) return code;
    return `${StyleInjector.withoutStyleUrl(code)}\n(function () { var s = document.createElement("style"); s.textContent = ${JSON.stringify(
      style.toString("utf8"),
    )}; document.head.appendChild(s); })();\n`;
  }

  /**
   * Un `<link rel="stylesheet">` a un `.css` publicado aparte (`TemplateFiles`). Una sola vez por `href`: el módulo
   * se evalúa una vez, pero un bundle con dos entry points que lo comparten no debe duplicarlo.
   */
  static link(code: string, href: string): string {
    const literal = JSON.stringify(href);
    return `${StyleInjector.withoutStyleUrl(code)}\n(function () { var h = ${literal}; if (document.querySelector('link[data-ngjs-style="' + h + '"]')) return; var l = document.createElement("link"); l.rel = "stylesheet"; l.href = h; l.setAttribute("data-ngjs-style", h); document.head.appendChild(l); })();\n`;
  }

  private static withoutStyleUrl(code: string): string {
    return code.replace(new RegExp(`${CodeReader.styleRegExp.source},?`), "");
  }
}
