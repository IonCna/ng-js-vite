import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CodeReader } from "@ng-js-vite/reading/code-reader.ts";
import { FileReader } from "@ng-js-vite/reading/file-resolver.ts";
import { StyleInjector } from "@ng-js-vite/writing/style-injector.ts";
import { TemplatePatcher } from "@ng-js-vite/writing/template-patcher.ts";

type IncomingRequest = { url?: string };
type OutgoingResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: Buffer): void;
};

export type TemplateFilesOptions = {
  /** `true` (build): `nombre-<hash>.ext`, cacheable para siempre. `false` (dev): nombre fijo, se relee en cada request. */
  hashed?: boolean;
  /** Prefijo público de las URLs (`<base href>` de la app). */
  base?: string;
};

/** Qué parte del componente publica un directorio: el template escopeado o su CSS escopeado. */
type PublishedPart = "template" | "style";

/**
 * Un directorio publicado (`templates/`, `styles/`): nombre publicado → componente fuente. El contenido se relee y
 * escopea al emitir/servir (`TemplatePatcher`), nunca se guarda — así en dev un cambio al `.html`/`.css` se ve al
 * recargar.
 */
class PublishedDir {
  private readonly sources = new Map<string, FileReader>();

  constructor(
    readonly dir: string,
    private readonly part: PublishedPart,
    private readonly contentType: string,
  ) {}

  /** Sin hash dos archivos con el mismo nombre chocarían: error claro en vez de pisarse. */
  register(fileName: string, fileReader: FileReader): void {
    const existing = this.sources.get(fileName);
    if (existing && this.sourcePath(existing) !== this.sourcePath(fileReader)) {
      throw new Error(
        `ng-js-vite: "${this.sourcePath(existing)}" y "${this.sourcePath(fileReader)}" se publican los dos como "${this.dir}/${fileName}" — renombrá uno.`,
      );
    }
    this.sources.set(fileName, fileReader);
  }

  async emit(outDir: string): Promise<void> {
    if (!this.sources.size) return;
    const dir = path.join(outDir, this.dir);
    await mkdir(dir, { recursive: true });
    for (const [fileName, fileReader] of this.sources) {
      await writeFile(path.join(dir, fileName), await this.content(fileReader));
    }
  }

  /** `true` si respondió (el nombre es de este directorio); `false` para seguir con el próximo middleware. */
  serve(fileName: string, res: OutgoingResponse, next: (error?: unknown) => void): boolean {
    const fileReader = this.sources.get(fileName);
    if (!fileReader) return false;
    this.content(fileReader).then((body) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", this.contentType);
      res.end(body);
    }, next);
    return true;
  }

  private async content(fileReader: FileReader): Promise<Buffer> {
    const patched = await TemplatePatcher.from(fileReader, { preventCache: true });
    return (this.part === "template" ? patched.template : patched.style) ?? Buffer.alloc(0);
  }

  /** El CSS se escopea por template: mismo `.css` con otro template es otro archivo publicado. */
  private sourcePath(fileReader: FileReader): string | undefined {
    return this.part === "template" ? fileReader.templatePath : `${fileReader.stylePath} (${fileReader.templatePath})`;
  }
}

/**
 * Template y CSS de cada componente en archivos aparte (`templates/`, `styles/`), como `ngJsTemplateParser` en
 * Vite, pero con la forma de transform plano (`{ transform(code, path) }`) que corre ANTES del escaneo del
 * compilador: el `templateUrl` del decorador pasa a ser la URL pública (`/templates/card.component-1a2b3c4d.html`),
 * así `ModuleWriter` registra esa URL y no la ruta relativa al componente. El `styleUrl` se reemplaza por un
 * `<link>` que el propio módulo agrega al evaluarse (`StyleInjector.link`): el CSS de un módulo lazy llega con su
 * chunk, sin un cargador aparte. Los dos se escopean igual (`_content-<hash>`).
 *
 * Con estado: una instancia por build/servidor. `emit(outDir)` escribe lo visto (build) y `middleware()` lo sirve
 * (dev-server, releído del disco en cada request).
 */
export class TemplateFiles {
  static readonly DIR = "templates";
  static readonly STYLES_DIR = "styles";

  private readonly templates = new PublishedDir(TemplateFiles.DIR, "template", "text/html; charset=utf-8");
  private readonly styles = new PublishedDir(TemplateFiles.STYLES_DIR, "style", "text/css; charset=utf-8");
  private readonly hashed: boolean;
  private readonly base: string;

  private constructor(options: TemplateFilesOptions) {
    this.hashed = options.hashed ?? true;
    const base = options.base ?? "/";
    this.base = base.endsWith("/") ? base : `${base}/`;
  }

  static create(options: TemplateFilesOptions = {}): TemplateFiles {
    return new TemplateFiles(options);
  }

  async transform(code: string, filePath: string): Promise<string | undefined> {
    if (!FileReader.validate(filePath, code)) return undefined;

    const reader = CodeReader.from(code);
    const fileReader = FileReader.parse(reader, filePath);
    const patched = await TemplatePatcher.from(fileReader, { preventCache: true });

    const templateName = this.templateName(reader, fileReader, patched.template);
    this.templates.register(templateName, fileReader);
    const rewritten = code.replace(
      CodeReader.templateRegExp,
      `templateUrl: ${JSON.stringify(this.url(this.templates, templateName))}`,
    );
    if (!patched.style || !fileReader.stylePath) return rewritten;

    const styleName = this.styleName(fileReader.stylePath, patched.style, patched.scope);
    this.styles.register(styleName, fileReader);
    return StyleInjector.link(rewritten, this.url(this.styles, styleName));
  }

  /** Escribe cada template y CSS escopeado en `<outDir>/templates/` y `<outDir>/styles/`. */
  async emit(outDir: string): Promise<void> {
    await this.templates.emit(outDir);
    await this.styles.emit(outDir);
  }

  /** Middleware connect (Vite `server.middlewares`): sirve `/templates/<nombre>` y `/styles/<nombre>` releyendo el fuente. */
  middleware() {
    return (req: IncomingRequest, res: OutgoingResponse, next: (error?: unknown) => void): void => {
      const pathname = new URL(req.url ?? "/", "http://ng-js-vite.local").pathname;
      for (const dir of [this.templates, this.styles]) {
        const prefix = `${this.base}${dir.dir}/`;
        if (pathname.startsWith(prefix) && dir.serve(pathname.slice(prefix.length), res, next)) return;
      }
      next();
    };
  }

  private url(dir: PublishedDir, fileName: string): string {
    return `${this.base}${dir.dir}/${fileName}`;
  }

  /** El del template sale de `CodeReader.hash` (mismo nombre que emitía `ngJsTemplateParser`). */
  private templateName(reader: CodeReader, fileReader: FileReader, template: Buffer): string {
    if (this.hashed) return path.basename(reader.hash(template.toString("utf-8")).templateUrl);
    return path.basename(fileReader.templatePath);
  }

  /**
   * `card.component.css` → `card.component-<hash>.css`: del contenido escopeado (build) o del scope (dev, estable
   * entre ediciones). Nunca el nombre pelado: un mismo `.css` compartido por dos componentes se escopea distinto
   * para cada uno (el scope sale del template) y son dos archivos publicados.
   */
  private styleName(sourcePath: string, content: Buffer, scope: string): string {
    const name = path.basename(sourcePath);
    const extension = path.extname(name);
    const source = this.hashed ? content : scope;
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
    return `${name.slice(0, name.length - extension.length)}-${hash}${extension}`;
  }
}
