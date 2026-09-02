# ng-js-vite

Vite plugin for AngularJS apps that keeps external component templates working after build.

It finds a component `templateUrl`, copies that HTML template into the final build, gives it a content hash, and rewrites the URL so AngularJS can load it in production.

If the same component also has a `styleUrl`, the CSS is inlined into the emitted template:

```html
<style data-ng-js-vite>
/* component css */
</style>

<!-- component html -->
```

## Example

```js
import angular from "angular"

const appRootComponent = {
  templateUrl: "./app-root.html",
  styleUrl: "./app-root.css",
  controller: AppRootController,
}

angular.module("app").component("appRoot", appRootComponent)
```

`styleUrl` is a plugin-only property. AngularJS does not load it by itself; `ng-js-vite` reads it at build time, inlines the CSS into the emitted template, and removes the original `styleUrl` from the compiled component.

With the default config, the template is emitted as something like:

```txt
templates/app-root-a1b2c3d4.html
```

And the compiled component points AngularJS to that generated file.

## Install

```bash
bun add ng-js-vite
# or
npm install ng-js-vite
```

Requires `vite@^8` and `typescript@^5`.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite"
import { ngJsTemplateParser } from "ng-js-vite"

export default defineConfig({
  plugins: [ngJsTemplateParser()],
})
```

## File Scope

For now, this plugin supports **one `templateUrl` per source file**.

If a `styleUrl` exists in that same file, it is paired with that template and inlined into it.

Recommended component shape:

```txt
app-root.component.js
app-root.component.html
app-root.component.css
```

The same pattern works with TypeScript. Avoid putting multiple components with different `templateUrl` values in the same `.js` or `.ts` file. Split them into separate files instead.

## TypeScript

`styleUrl` is not part of AngularJS' built-in `IComponentOptions` type, so TypeScript will complain if you add it to a typed component definition.

Add a project-level `.d.ts` file:

```ts
import "angular"

declare module "angular" {
  interface IComponentOptions {
    styleUrl?: string
  }
}
```

Make sure that `.d.ts` file is included by your `tsconfig.json`. After that, `styleUrl` can be used directly in AngularJS component options:

```ts
import type { IComponentOptions } from "angular"

export const appRootComponent: IComponentOptions = {
  templateUrl: "./app-root.html",
  styleUrl: "./app-root.css",
  controller: AppRootController,
}
```

## Options

| Option   | Type      | Default | Description |
| -------- | --------- | ------- | ----------- |
| `hashed` | `boolean` | `true`  | Adds a content hash to emitted template filenames. |

```ts
ngJsTemplateParser({ hashed: false })
```

When `hashed` is disabled, templates are emitted with their original filename:

```txt
templates/app-root.html
```

## Base Path

Generated template URLs respect Vite's `base` option.

If your app uses routes, keep a base tag in `index.html` so AngularJS resolves template URLs from the app root:

```html
<base href="/">
```

## Roadmap

Future versions are expected to support runtime CSS isolation, so each `templateUrl` can keep its inlined `styleUrl` styles scoped to that component template.
