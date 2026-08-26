# ng-js-vite

A Vite plugin that resolves AngularJS-style `templateUrl` references in `.ts`/`.js` source files and emits the referenced HTML templates as content-hashed assets.

## What it does

If a source file contains something like:

```ts
angular.module("app").component("appRoot", {
  templateUrl: "./app-root.html",
  controller: AppRootController,
})
```

(the same applies to `.directive()` definitions or `$routeProvider`/`ui-router` state configs — anywhere a `templateUrl: '...'` string literal shows up)

the plugin will:

1. Find the `templateUrl` string during Vite's `transform` step.
2. Resolve it to a real file path — relative (`./`, `../`), root-absolute (`/...`), `src/`-prefixed, or a bare filename next to the source file.
3. Hash the template's contents (`sha256`, first 8 hex chars) and rewrite the `templateUrl` in the compiled output to point at `templates/<name>-<hash>.html`.
4. On build, emit the template as a real asset under `templates/` in the output bundle.
5. In dev (`vite dev`), serve the original template content whenever it's requested by its hashed name, so the rewritten URL resolves without needing a build.

This keeps templates content-addressed and cacheable in production while staying transparent in dev.

## Install

```bash
bun add ng-js-vite
# or: npm install ng-js-vite
```

Requires `vite@^8` and `typescript@^5` as peer dependencies.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite"
import { ngJsTemplateParser } from "ng-js-vite"

export default defineConfig({
  plugins: [ngJsTemplateParser()],
})
```

## Options

| Option   | Type      | Default | Description                                                                                   |
| -------- | --------- | ------- | ----------------------------------------------------------------------------------------------- |
| `hashed` | `boolean` | `true`  | When `true`, template filenames are content-hashed and `templateUrl` is rewritten to match. When `false`, templates are emitted under their original filename and `templateUrl` is left untouched. |

```ts
ngJsTemplateParser({ hashed: false })
```

## Development

```bash
bun install
bun test    # run the unit tests for src/utils
```

The core logic lives in `index.ts`; the supporting pieces (file filtering, `templateUrl` extraction, path resolution, hashing) are in `src/utils/`, each with its own test file.

## License

MIT © Max Flores — see [LICENSE](./LICENSE).
