# Next up: CSS as a separate global asset

`v1.0.0` ships CSS isolation (scoped view encapsulation) working end-to-end:
`TemplatePatcher._scopeTemplate` (parse5) adds a unique `_content-xxxxxxxx` attribute to
every element in a component's template, and `TemplatePatcher._scopeStyle` (css-tree)
rewrites every selector in the component's `styleUrl` CSS to require that same attribute —
including selectors nested inside `:not()`/`:is()`/`:where()`/`:has()`. Validated against
186 real `styleUrl` components in a real app (see git history / README changelog for
details) — build clean, no visual regressions.

## The next architectural change

Right now `TemplatePatcher.buffer` (`src/writing/template-patcher.ts`) concatenates the
scoped CSS as a literal `<style data-ng-js-vite>` block **prepended into the same
template Buffer** that gets emitted as `templates/xxx.html`. Every template fetch ships
its own copy of its component's CSS inline.

The planned change: since every rule is already scoped with a unique
`[_content-xxxxxxxx]` attribute selector, it's safe to merge **every component's CSS into
one global stylesheet** — there's no collision risk, that's the whole point of the
scoping. Emit that as **one combined CSS asset**, loaded normally (e.g. a `<link
rel="stylesheet">` in the app's `index.html`, or hooked into Vite's own CSS output),
instead of splicing `<style>` text into every template's HTML.

Why this is better than the current approach:
- Templates stop re-shipping duplicate CSS text on every fetch.
- The browser can cache/parallelize a normal `.css` asset instead of re-parsing inline
  `<style>` blocks embedded in HTML fetched via AngularJS's `$templateRequest`.
- Closer to how real Angular's Ivy compiler actually works: it scopes each component's
  CSS independently at compile time and stores it apart from the template
  (`ɵcmp.styles`), joined only by the shared scope id — not concatenated into one blob.

## Where to start

- `index.ts` — collect each component's scoped CSS during `transform` (instead of
  discarding it once folded into the template buffer), and in `generateBundle` emit one
  aggregated CSS file via `this.emitFile({ type: "asset", ... })`.
- `src/writing/template-patcher.ts` — `TemplatePatcher.buffer` would stop concatenating
  style + template; something needs to expose the scoped CSS separately (e.g. a
  `.style` getter alongside `.buffer`, or split into two artifacts entirely).
- The dev server middleware in `index.ts` (`configureServer`) also needs to keep serving
  the global CSS somewhere reachable, not just per-template.
- Decide how the app actually loads the emitted CSS asset — probably needs a documented
  step in the README (a `<link>` tag, or an entry point import) since nothing currently
  wires it into `index.html` automatically.

No code has been written for this yet — this file is a handoff note, not a plan that's
been reviewed. Talk it through and validate design choices (regex vs. real tooling,
edge cases) before writing anything — that's how the current feature got built, and it
held up.
