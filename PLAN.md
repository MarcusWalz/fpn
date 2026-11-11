# FPN Static Site — Plan

Goal: a Go static site generator that renders a notebook from Markdown stored in git.

- It keeps the general organization of fpnotebook.com (Book → Chapter → Page).
- It is mobile-friendly.
- It is built so search can be added.

Content will be migrated later. The generator assumes nothing about page contents beyond "a Markdown file".

## 1. Organization = folders

The folder tree is the taxonomy:

```
content/
  _index.md                   # optional: home page text
  cardiology/                 # Book
    _index.md                 # optional: title/intro/order for the book
    hypertension/             # Chapter
      _index.md               # optional
      hypertension.md         # Page -> /cardiology/hypertension/hypertension/
      causes.md               # Page -> /cardiology/hypertension/causes/
  neurology/
    ...
```

- One page per `.md` file.
- A page's URL is its path with clean URLs: `/cardiology/hypertension/causes/`.
- Folders are sections. The usual depth is Book/Chapter/Page, but the generator does not hard-code depth, so any nesting renders.
- Every folder gets an auto-generated index page listing its subsections and pages. `_index.md` adds optional intro text above that list.
- `/sitemap/` is generated from the tree: the whole notebook as one nested, collapsible list.
- Images and other non-`.md` files in `content/` are copied through as-is, so a page can reference images next to it.

### Minimal metadata (all optional)

Front matter is allowed but never required:

```yaml
---
title: Hypertension     # else: first "# H1" in the file, else filename prettified
order: 10               # else: sorted alphabetically by title
---
```

Unknown front-matter keys are kept and made available to templates. This leaves room for future fields (aka, tags, related…) without changing the generator.

## 2. Generator (Go)

A single binary, `cmd/fpn`, with templates and CSS embedded via `embed`.

| Command | Does |
|---|---|
| `fpn build` | `content/` → `public/` |
| `fpn serve` | local preview server, rebuilds on change |
| `fpn check` | reports broken internal links and missing images |

Dependencies: `goldmark` (Markdown + GFM tables etc.), `yaml.v3`, and the standard library `html/template`.

Pipeline:
1. Walk `content/` and build the tree. Sort entries by `order`, then by title.
2. Render Markdown to HTML. Collect headings for an on-page table of contents, which is shown only when a page has several headings.
3. Rewrite relative `.md` links (`[x](../exam/blood-pressure.md)`) to their output URLs. This lets links work both on GitHub and on the site.
4. Render the page, folder index, home, sitemap, and 404 templates.
5. Write `sitemap.xml` and copy static assets.

## 3. Visual style

The design is original. Only the taxonomy is borrowed, not the look.

- **Green-forward palette** with color tokens on `:root`:
  - Deep forest green (`#14532d`) for the header and headings.
  - Bright leaf green (`#22c55e`) for accents and links-on-hover.
  - Mint tint (`#ecfdf5`) for cards and callouts.
  - A warm lime/yellow highlight (`#d9f99d`) for "you are here" and search hits.
  - Dark mode inverts to a deep green-black background with mint text.
- **Pixel-art accents** (the fun layer; body text stays clean):
  - Pixel font for the logo, headings, and UI labels: "Press Start 2P" for the logo and "Silkscreen" or "VT323" for headings. Body text uses a clean system font so long clinical text stays readable.
  - Chunky "pixel" borders and hard offset shadows (`box-shadow: 4px 4px 0`), with no blur and square corners.
  - Pixel icons are inline SVGs drawn on a grid with `shape-rendering: crispEdges`, so they scale crisply. Built-ins: heart, brain, bone, eye, pill, flask, baby, tooth, leaf, and more. A book picks one via optional `icon:` in `_index.md`.
  - Book cards on the home page each get their own green shade and pixel icon. On hover they "press" (the shadow shrinks and the card shifts), like a game button.
  - Pixel-styled breadcrumb chips, a pixel divider under headings, and a blinking-cursor 404 page ("PAGE NOT FOUND — PRESS HOME").
  - Animations are short and steppy (`steps()`), and are disabled under `prefers-reduced-motion`.
- **Effective first**:
  - Color contrast meets WCAG AA, so green is never the only signal.
  - A large readable body size.
  - Motion respects `prefers-reduced-motion`.

## 4. Layout (mobile-first)

- Sticky top bar: site name, a search slot, and a menu button. The menu opens the book list.
- Breadcrumb: Home › Book › Chapter › Page.
- The page body uses a readable line length and comfortable tap targets. Nested lists indent compactly on small screens. Wide tables scroll inside their own box, so the page never scrolls sideways.
- Table of contents and sibling pages:
  - On phones they are collapsible `<details>` blocks.
  - On wide screens they become a sidebar.
- Prev/next links between pages within a chapter.
- Dark mode and print styles.
- Pages work without JavaScript.

## 5. Search

**Done:** the header has instant title search over the `pages.json` the build emits. Page bodies carry `data-pagefind-body` and a `book` filter attribute.

**Next: full-text search with [Pagefind](https://pagefind.app)** as a post-build step. It is static, loads in chunks, scales to many thousands of pages, and supports filtering by book. Pagefind has no synonym support, so the Go build should add a curated abbreviation/synonym list (e.g. "HTN" → hypertension) to each page's index text. That gives more search quality per unit of effort than any embedding work.

**Later, opt-in semantic search.** Research (Nov 2026) says client-side embedding search works only as an add-on to keyword search:
- Pagefind declined to add vectors (issue #810).
- The working pattern:
  - Build time: compute page/section embeddings into a few MB of int8 vectors (`embeddings.bin` + `ids.json`).
  - Browser: embed only the query with Transformers.js and bge-small or MedEmbed-small (~34 MB int8, lazily loaded and cached). Brute-force cosine over a few thousand vectors takes milliseconds, so no HNSW is needed.
  - Merge the vector results with the Pagefind results via reciprocal rank fusion.
- The build and the browser must use the same model and quantization.
- Embedding happens in a separate Python/Node step, cached by content hash. Running the model in Go (hugot) is possible but heavier.
- The same embeddings also give "related pages" for free.
- Avoid anything that ships 100+ MB to phones.

## 6. Repo layout

```
cmd/fpn/            CLI entry
internal/content/   tree loading, front matter, titles
internal/render/    markdown, link rewriting, templates
internal/site/      build orchestration, sitemap, assets
web/templates/      *.html (embedded)
web/static/         css, js (embedded)
content/            notebook Markdown (a few placeholder pages for now)
```

## 7. Phases

1. **Core**: tree loader, Markdown rendering, page/index/home/sitemap templates, `build` and `serve`, plus a few placeholder pages.
2. **Mobile UI**: responsive CSS, menu, TOC and sibling pages, prev/next, dark mode.
3. **Integrity**: link rewriting and `fpn check`, and CI that builds and checks on every push.
4. **Search**: Pagefind and `pages.json`.
5. **Deploy**: GitHub Actions to the chosen static host.
6. **Migration**: import existing content (separate effort).
