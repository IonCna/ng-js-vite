import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CodeReader } from "@ng-js-vite/reading/code-reader.ts";
import { FileReader } from "@ng-js-vite/reading/file-resolver.ts";
import { MappedCode, type MappedOutput } from "@ng-js-vite/writing/mapped-code.ts";
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
  /**
   * Prefijo de las URLs publicadas. Por defecto ninguno: `templates/…`/`styles/…` relativas, que el navegador resuelve
   * contra el `<base href>` de la app (como los scripts de Angular) — la misma build sirve en `/` o en un subpath
   * (GitHub Pages). Un prefijo absoluto (`/app/`) las fija.
   */
  base?: string;
};

/** Qué parte del componente publica un directorio: el template escopeado o su CSS escopeado. */
type PublishedPart = "template" | "style";

/**
 * Un directorio publicado (`templates/`, `styles/`): nombre publicado → componente fuente. El contenido se relee y
 * escopea al emitir/servir (`TemplatePatcher`), nunca se guarda — así en dev un cambio al `.html`/`.css` se ve al
 * recargar.
 *
 * Cada nombre sabe qué componentes (`.ts`) lo publican: dos pueden compartir un template. Un componente que se
 * vuelve a transformar suelta lo suyo (`release`) y el nombre se va cuando ya nadie lo usa — sin eso, un
 * `templateUrl` que pasó a `template` inline (y su `.html` borrado) seguía en el registro y `emit` fallaba con ENOENT.
 */
class PublishedDir {
  private readonly sources = new Map<string, FileReader>();
  private readonly users = new Map<string, Set<string>>();

  constructor(
    readonly dir: string,
    private readonly part: PublishedPart,
    private readonly contentType: string,
  ) {}

  /** Sin hash dos archivos con el mismo nombre chocarían: error claro en vez de pisarse. */
  register(fileName: string, fileReader: FileReader, component: string): void {
    const existing = this.sources.get(fileName);
    if (existing && this.sourcePath(existing) !== this.sourcePath(fileReader)) {
      throw new Error(
        `ng-js-vite: "${this.sourcePath(existing)}" y "${this.sourcePath(fileReader)}" se publican los dos como "${this.dir}/${fileName}" — renombrá uno.`,
      );
    }
    this.sources.set(fileName, fileReader);
    let users = this.users.get(fileName);
    if (!users) this.users.set(fileName, (users = new Set()));
    users.add(component);
  }

  /** Lo que publicaba `component`: cada nombre sin otro componente que lo use sale del registro. */
  release(component: string): void {
    for (const [fileName, users] of this.users) {
      if (!users.delete(component) || users.size) continue;
      this.users.delete(fileName);
      this.sources.delete(fileName);
    }
  }

  clear(): void {
    this.sources.clear();
    this.users.clear();
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
    return this.part === "template" ? fileReader.templatePath : `${fileReader.stylePaths.join(", ") || "styles"} (${fileReader.templatePath})`;
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
  /** `.html`/`.css` fuente → los componentes (`.ts`) que lo usan (ver `ownersOf`). */
  private readonly owners = new Map<string, Set<string>>();
  private readonly styles = new PublishedDir(TemplateFiles.STYLES_DIR, "style", "text/css; charset=utf-8");
  private readonly hashed: boolean;
  private readonly base: string;

  private constructor(options: TemplateFilesOptions) {
    this.hashed = options.hashed ?? true;
    const base = options.base ?? "";
    this.base = base === "" || base.endsWith("/") ? base : `${base}/`;
  }

  static create(options: TemplateFilesOptions = {}): TemplateFiles {
    return new TemplateFiles(options);
  }

  async transform(code: string, filePath: string): Promise<MappedOutput | undefined> {
    // Antes de validar: un componente que ya no publica nada (pasó a `template` inline sin `styleUrl`) suelta lo de antes.
    this.release(filePath);
    if (!FileReader.validate(filePath, code)) return undefined;

    const reader = CodeReader.from(code);
    const fileReader = FileReader.parse(reader, filePath);
    const patched = await TemplatePatcher.from(fileReader, { preventCache: true });
    if (fileReader.inline) return this.inlineTransform(MappedCode.from(code, filePath), reader, fileReader, patched, filePath).output();

    const templateName = this.templateName(reader, fileReader, patched.template);
    this.templates.register(templateName, fileReader, path.resolve(filePath));
    this.addOwner(fileReader.templatePath, filePath);
    for (const stylePath of fileReader.stylePaths) this.addOwner(stylePath, filePath);
    // El compilador decide `transclude: true` viendo `<ng-content>` en el template; con `templateUrl` no lo ve, así
    // que se le avisa con `ɵngContent` (sin eso AngularJS tira el contenido proyectado del componente).
    const projectsContent = /<ng-content[\s>/]/.test(patched.template.toString("utf-8"));
    const rewritten = MappedCode.from(code, filePath).replace(
      CodeReader.templateRegExp,
      `templateUrl: ${JSON.stringify(this.url(this.templates, templateName))}${projectsContent ? ", ɵngContent: true" : ""}`,
    );
    if (!patched.style) return rewritten.output();

    const styleName = this.styleName(fileReader, patched.style, patched.scope);
    this.styles.register(styleName, fileReader, path.resolve(filePath));
    return StyleInjector.link(rewritten, this.url(this.styles, styleName)).output();
  }

  /**
   * `template` inline + estilos: el template no se publica (queda en el código, escopeado); solo el CSS va a
   * `styles/` con su `<link>`, igual que con `templateUrl`.
   */
  private inlineTransform(code: MappedCode, reader: CodeReader, fileReader: FileReader, patched: TemplatePatcher, filePath: string): MappedCode {
    const rewritten = code.replace(reader.templateDeclaration, `template: ${JSON.stringify(patched.template.toString("utf-8"))}`);
    if (!patched.style) return rewritten;

    for (const stylePath of fileReader.stylePaths) this.addOwner(stylePath, fileReader.templatePath);
    const styleName = this.styleName(fileReader, patched.style, patched.scope);
    this.styles.register(styleName, fileReader, path.resolve(filePath));
    return StyleInjector.link(rewritten, this.url(this.styles, styleName));
  }

  /**
   * Los componentes (`.ts`) cuyo `templateUrl`/`styleUrl` es `file`. El dev-server los da por cambiados cuando cambia
   * el `.html`/`.css` (no están en el grafo de módulos de Vite: los sirve `middleware()`), así se recompilan — un
   * `<ng-content>` nuevo cambia `ɵngContent` — y la página recarga.
   */
  ownersOf(file: string): string[] {
    return [...(this.owners.get(path.resolve(file)) ?? [])];
  }

  /**
   * Empezar una compilación nueva (`ngjs build --watch`): un componente borrado del proyecto no se vuelve a
   * transformar, así que no soltaría lo suyo — el registro se rearma con lo que transforme esta compilación.
   */
  reset(): void {
    this.templates.clear();
    this.styles.clear();
    this.owners.clear();
  }

  /** Lo que publicaba `component` (y su lugar como dueño de un `.html`/`.css`) antes de volver a transformarlo. */
  private release(component: string): void {
    const key = path.resolve(component);
    this.templates.release(key);
    this.styles.release(key);
    for (const [source, components] of this.owners) {
      components.delete(key);
      if (!components.size) this.owners.delete(source);
    }
  }

  private addOwner(source: string, component: string): void {
    const key = path.resolve(source);
    let components = this.owners.get(key);
    if (!components) this.owners.set(key, (components = new Set()));
    components.add(path.resolve(component));
  }

  /** Escribe cada template y CSS escopeado en `<outDir>/templates/` y `<outDir>/styles/`. */
  async emit(outDir: string): Promise<void> {
    await this.templates.emit(outDir);
    await this.styles.emit(outDir);
  }

  /**
   * Middleware connect (Vite `server.middlewares`): sirve `…/templates/<nombre>` y `…/styles/<nombre>` releyendo el
   * fuente. Con URLs relativas el pedido llega con el `<base href>` de la página adelante (`/docs/templates/x.html`):
   * cuenta el último segmento; con un `base` absoluto, solo bajo ese prefijo.
   */
  middleware() {
    return (req: IncomingRequest, res: OutgoingResponse, next: (error?: unknown) => void): void => {
      const pathname = new URL(req.url ?? "/", "http://ng-js-vite.local").pathname;
      for (const dir of [this.templates, this.styles]) {
        const marker = `/${dir.dir}/`;
        const at = pathname.lastIndexOf(marker);
        if (at === -1) continue;
        if (this.base.startsWith("/") && !pathname.startsWith(`${this.base}${dir.dir}/`)) continue;
        const fileName = pathname.slice(at + marker.length);
        if (fileName && !fileName.includes("/") && dir.serve(fileName, res, next)) return;
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
   * para cada uno (el scope sale del template) y son dos archivos publicados. Con varios `styleUrls` el nombre sale
   * del primero; solo con `styles` inline, del componente (`card.component.ts` → `card.component-<hash>.css`).
   */
  private styleName(fileReader: FileReader, content: Buffer, scope: string): string {
    const name = path.basename(fileReader.stylePath ?? fileReader.templatePath);
    const extension = path.extname(name);
    const source = this.hashed ? content : scope;
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
    return `${name.slice(0, name.length - extension.length)}-${hash}.css`;
  }
}
