import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as csstree from "css-tree";

type OutgoingResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: Buffer): void;
};

/**
 * Los archivos que el CSS de un componente referencia con `url()` (imágenes, fuentes). Como Angular: un `url()`
 * relativo se resuelve contra el `.css` que lo declara (con `styles` inline, contra el componente) y el archivo se
 * publica en `media/` — `logo-<hash>.png` en build, cacheable para siempre. El `url()` se reescribe a
 * `<prefix><nombre>`: el CSS va en un `<style>` del documento, así que la URL es la de lo publicado (`media/…`
 * relativa al `<base href>`, o con el `base` absoluto del build).
 *
 * Quedan tal cual, como en los estilos globales: absolutas al sitio (`/img/x.png`, un `assets` publicado), con
 * esquema (`https:`, `data:`) y fragmentos (`#filtro`).
 */
export class StyleAssets {
  static readonly DIR = "media";

  private static readonly EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/|#)/i;

  private static readonly CONTENT_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".eot": "application/vnd.ms-fontobject",
  };

  /** Nombre publicado → archivo fuente. */
  private readonly sources = new Map<string, string>();

  constructor(
    /** `true` (build): el hash sale del contenido. `false` (dev): de la ruta, estable entre ediciones. */
    private readonly hashed: boolean,
    /** Lo que va delante del nombre publicado en el `url()` reescrito (`media/`, `/app/media/`). */
    private readonly prefix: string = `${StyleAssets.DIR}/`,
  ) {}

  /** `css` con sus `url()` relativos apuntando a lo publicado; `from` es el archivo contra el que se resuelven. */
  rebase(css: string, from: string): string {
    if (!/url\(/i.test(css)) return css;

    const ast = csstree.parse(css);
    let changed = false;
    csstree.walk(ast, {
      visit: "Url",
      enter: (node) => {
        const published = this.publish(node.value, from);
        if (published === undefined) return;
        node.value = published;
        changed = true;
      },
    });
    return changed ? csstree.generate(ast) : css;
  }

  clear(): void {
    this.sources.clear();
  }

  async emit(outDir: string): Promise<void> {
    if (!this.sources.size) return;
    const dir = path.join(outDir, StyleAssets.DIR);
    await mkdir(dir, { recursive: true });
    for (const [fileName, source] of this.sources) {
      await writeFile(path.join(dir, fileName), await readFile(source));
    }
  }

  /** `true` si respondió (el nombre es un archivo publicado); `false` para seguir con el próximo middleware. */
  serve(fileName: string, res: OutgoingResponse, next: (error?: unknown) => void): boolean {
    const source = this.sources.get(fileName);
    if (!source) return false;
    readFile(source).then((body) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", StyleAssets.CONTENT_TYPES[path.extname(source).toLowerCase()] ?? "application/octet-stream");
      res.end(body);
    }, next);
    return true;
  }

  /** La URL publicada de `url` (con su `?query`/`#fragment`), o `undefined` si no es un archivo relativo. */
  private publish(url: string, from: string): string | undefined {
    const value = url.trim();
    if (!value || StyleAssets.EXTERNAL.test(value)) return undefined;

    const [, file = "", suffix = ""] = /^([^?#]*)(.*)$/.exec(value) ?? [];
    if (!file) return undefined;

    const source = path.resolve(path.dirname(from), decodeURI(file));
    const fileName = this.fileName(source, from, value);
    this.sources.set(fileName, source);
    return `${this.prefix}${fileName}${suffix}`;
  }

  private fileName(source: string, from: string, url: string): string {
    const extension = path.extname(source);
    const name = path.basename(source, extension);
    return `${name}-${this.hash(source, from, url)}${extension}`;
  }

  private hash(source: string, from: string, url: string): string {
    const hash = createHash("sha256");
    if (!this.hashed) return hash.update(source).digest("hex").slice(0, 8);
    try {
      return hash.update(readFileSync(source)).digest("hex").slice(0, 8);
    } catch {
      throw new Error(`ng-js-vite: "${from}" referencia url(${url}), pero "${source}" no existe.`);
    }
  }
}
