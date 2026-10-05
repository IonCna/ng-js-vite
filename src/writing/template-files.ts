import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CodeReader } from "@ng-js-vite/reading/code-reader.ts";
import { FileReader, type FileReaderReadOptions } from "@ng-js-vite/reading/file-resolver.ts";
import { MappedCode, type MappedOutput } from "@ng-js-vite/writing/mapped-code.ts";
import { StyleAssets } from "@ng-js-vite/writing/style-assets.ts";
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
   * Prefijo de las URLs publicadas. Por defecto ninguno: `templates/…`/`media/…` relativas, que el navegador resuelve
   * contra el `<base href>` de la app (como los scripts de Angular) — la misma build sirve en `/` o en un subpath
   * (GitHub Pages). Un prefijo absoluto (`/app/`) las fija.
   */
  base?: string;
};

/**
 * El directorio `templates/`: nombre publicado → componente fuente. El contenido se relee y escopea al emitir/servir
 * (`TemplatePatcher`), nunca se guarda — así en dev un cambio al `.html` se ve al recargar.
 *
 * Cada nombre sabe qué componentes (`.ts`) lo publican: dos pueden compartir un template. Un componente que se
 * vuelve a transformar suelta lo suyo (`release`) y el nombre se va cuando ya nadie lo usa — sin eso, un
 * `templateUrl` que pasó a `template` inline (y su `.html` borrado) seguía en el registro y `emit` fallaba con ENOENT.
 */
class PublishedTemplates {
  static readonly CONTENT_TYPE = "text/html; charset=utf-8";

  private readonly sources = new Map<string, FileReader>();
  private readonly users = new Map<string, Set<string>>();

  constructor(readonly dir: string) {}

  /** Sin hash dos archivos con el mismo nombre chocarían: error claro en vez de pisarse. */
  register(fileName: string, fileReader: FileReader, component: string): void {
    const existing = this.sources.get(fileName);
    if (existing && existing.templatePath !== fileReader.templatePath) {
      throw new Error(
        `ng-js-vite: "${existing.templatePath}" y "${fileReader.templatePath}" se publican los dos como "${this.dir}/${fileName}" — renombrá uno.`,
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
      res.setHeader("Content-Type", PublishedTemplates.CONTENT_TYPE);
      res.end(body);
    }, next);
    return true;
  }

  private async content(fileReader: FileReader): Promise<Buffer> {
    return (await TemplatePatcher.from(fileReader, { preventCache: true })).template;
  }
}

/**
 * El template de cada componente en un archivo aparte (`templates/`) y su CSS dentro del propio módulo, como
 * Angular. Tiene la forma de transform plano (`{ transform(code, path) }`) que corre ANTES del escaneo del
 * compilador: el `templateUrl` del decorador pasa a ser la URL pública (`/templates/card.component-1a2b3c4d.html`),
 * así `ModuleWriter` registra esa URL y no la ruta relativa al componente.
 *
 * El CSS (`styleUrls`/`styleUrl`/`styles`) se escopea igual que el template (`_content-<hash>`) y viaja en el JS: el
 * módulo lo agrega a `document.head` en un `<style>` al evaluarse (`StyleInjector`), antes de que exista ningún
 * componente — sin pedido aparte, la vista nunca se pinta sin sus estilos; el de un módulo lazy llega con su chunk.
 * Lo que ese CSS referencia con `url()` sale en `media/` (`StyleAssets`).
 *
 * Con estado: una instancia por build/servidor. `emit(outDir)` escribe lo visto (build) y `middleware()` lo sirve
 * (dev-server, releído del disco en cada request).
 */
export class TemplateFiles {
  static readonly DIR = "templates";

  private readonly templates = new PublishedTemplates(TemplateFiles.DIR);
  /** `.html`/`.css` fuente → los componentes (`.ts`) que lo usan (ver `ownersOf`). */
  private readonly owners = new Map<string, Set<string>>();
  private readonly assets: StyleAssets;
  private readonly hashed: boolean;
  private readonly base: string;

  private constructor(options: TemplateFilesOptions) {
    this.hashed = options.hashed ?? true;
    const base = options.base ?? "";
    this.base = base === "" || base.endsWith("/") ? base : `${base}/`;
    // El CSS va en un `<style>` del documento: sus `url()` se resuelven como el resto de lo publicado.
    this.assets = new StyleAssets(this.hashed, `${this.base}${StyleAssets.DIR}/`);
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
    const patched = await TemplatePatcher.from(fileReader, this.readOptions());
    for (const stylePath of fileReader.stylePaths) this.addOwner(stylePath, filePath);

    if (fileReader.inline) {
      // `template` inline: no se publica (queda en el código, escopeado).
      const rewritten = MappedCode.from(code, filePath).replace(
        reader.templateDeclaration,
        `template: ${JSON.stringify(patched.template.toString("utf-8"))}`,
      );
      return StyleInjector.apply(rewritten, patched.style).output();
    }

    const templateName = this.templateName(reader, fileReader, patched.template);
    this.templates.register(templateName, fileReader, path.resolve(filePath));
    this.addOwner(fileReader.templatePath, filePath);
    // El compilador decide `transclude: true` viendo `<ng-content>` en el template; con `templateUrl` no lo ve, así
    // que se le avisa con `ɵngContent` (sin eso AngularJS tira el contenido proyectado del componente).
    const projectsContent = /<ng-content[\s>/]/.test(patched.template.toString("utf-8"));
    const rewritten = MappedCode.from(code, filePath).replace(
      CodeReader.templateRegExp,
      `templateUrl: ${JSON.stringify(this.url(templateName))}${projectsContent ? ", ɵngContent: true" : ""}`,
    );
    return StyleInjector.apply(rewritten, patched.style).output();
  }

  /**
   * Los componentes (`.ts`) cuyo `templateUrl`/`styleUrl` es `file`. El dev-server los da por cambiados cuando cambia
   * el `.html`/`.css` (no están en el grafo de módulos de Vite), así se recompilan — un `<ng-content>` nuevo cambia
   * `ɵngContent`, y el CSS va dentro del módulo — y la página recarga.
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
    this.assets.clear();
    this.owners.clear();
  }

  /** Lo que publicaba `component` (y su lugar como dueño de un `.html`/`.css`) antes de volver a transformarlo. */
  private release(component: string): void {
    const key = path.resolve(component);
    this.templates.release(key);
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

  /**
   * Escribe cada template escopeado en `<outDir>/templates/` y, en `<outDir>/media/`, lo que el CSS de los componentes
   * referencia con `url()`.
   */
  async emit(outDir: string): Promise<void> {
    await this.templates.emit(outDir);
    await this.assets.emit(outDir);
  }

  /**
   * Middleware connect (Vite `server.middlewares`): sirve `…/templates/<nombre>` y `…/media/<nombre>` (lo que el CSS
   * referencia con `url()`) releyendo el fuente. Con URLs relativas el pedido llega con el `<base href>` de la página
   * adelante (`/docs/templates/x.html`): cuenta el último segmento; con un `base` absoluto, solo bajo ese prefijo.
   */
  middleware() {
    return (req: IncomingRequest, res: OutgoingResponse, next: (error?: unknown) => void): void => {
      const pathname = new URL(req.url ?? "/", "http://ng-js-vite.local").pathname;
      const template = this.publishedName(pathname, this.templates.dir);
      if (template && this.templates.serve(template, res, next)) return;
      const asset = this.publishedName(pathname, StyleAssets.DIR);
      if (asset && this.assets.serve(asset, res, next)) return;
      next();
    };
  }

  /** El nombre de archivo de un pedido a `…/<dir>/<nombre>`, o `undefined` si no es de ese directorio. */
  private publishedName(pathname: string, dir: string): string | undefined {
    const marker = `/${dir}/`;
    const at = pathname.lastIndexOf(marker);
    if (at === -1) return undefined;
    if (this.base.startsWith("/") && !pathname.startsWith(`${this.base}${dir}/`)) return undefined;
    const fileName = decodeURIComponent(pathname.slice(at + marker.length));
    return fileName && !fileName.includes("/") ? fileName : undefined;
  }

  private readOptions(): FileReaderReadOptions {
    return { preventCache: true, styleTransform: (css, from) => this.assets.rebase(css, from) };
  }

  private url(fileName: string): string {
    return `${this.base}${TemplateFiles.DIR}/${fileName}`;
  }

  /** El del template sale de `CodeReader.hash` (mismo nombre que emitía `ngJsTemplateParser`). */
  private templateName(reader: CodeReader, fileReader: FileReader, template: Buffer): string {
    if (this.hashed) return path.basename(reader.hash(template.toString("utf-8")).templateUrl);
    return path.basename(fileReader.templatePath);
  }
}
