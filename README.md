# fpn

A small Go static site generator for a medical notebook. Content is plain Markdown in git, organized as **Book → Chapter → Page** folders, and the site works on phones.

```sh
go build -o fpn ./cmd/fpn
./fpn serve          # http://localhost:1313, live reload
./fpn build          # writes public/
./fpn check          # exits 1 on broken links / missing images (-no-stubs: also while chapters are empty)
./fpn status -all    # which chapters have content, per book
```

Flags: `-content content`, `-out public`, `-base /` (use a sub-path for GitHub Pages project sites), `-url https://…` (writes sitemap.xml), `-addr`, `-web dir` (override the embedded templates and CSS; `serve` uses `./web` automatically).

## Writing content

```
content/
  _index.md                       # optional: site title (front matter) + home intro
  cardiology/                     # book      -> /cardiology/
    _index.md                     # optional: title, order, icon, intro
    hypertension/                 # chapter   -> /cardiology/hypertension/
      overview.md                 # page      -> /cardiology/hypertension/overview/
      diagram.png                 # copied as-is
```

- One Markdown file per page. Front matter is optional.
- **Title**: `title:` from front matter if set, otherwise the first `# Heading`, otherwise the file name.
- **Order**: `order:` (a number) if set, otherwise alphabetical by title.
- **Icon** (books and chapters): `icon:` set to one of `heart brain bone eye pill flask tooth leaf drop baby lungs virus ear stomach smile cross book star map`. If it isn't set, the generator guesses from the folder name.
- **Links**: write relative links to `.md` files, e.g. `[causes](causes.md)` or `[ACE](../../pharmacology/antihypertensives/ace-inhibitors.md#dosing)`. They work on GitHub and are rewritten to site URLs. Broken links fail `fpn check`.
- **Images**: put them next to the page or in a subfolder, then reference them relatively: `![Alt text](images/chart.png)`. An italic line directly under an image is styled as its caption. Folders that contain only images are treated as asset folders, not chapters. Missing images fail `fpn check`.
- Every folder gets an index page automatically, and `/sitemap/` lists the whole tree.
- Unknown front-matter keys are kept, ready for future fields such as aliases or tags.

## Local editor (dev only)

While `./fpn serve` is running, open http://localhost:1313/__editor/ or click **✎ Edit** on any page. Each topic idea on a chapter page also has a **✎ write** link that opens a new page pre-filled with its title.

- **Layout:** the file tree is on the left, then the page **Preview** (with a **Diff** tab), then the Markdown editor (CodeMirror). The preview re-renders as you type, before you save, using the real templates, and shows broken-link warnings. Preview and editor **scroll in sync**, in both directions.
- **File tree:** click to open. **+ Page** and **+ Folder** create in the selected folder; a new folder gets an `_index.md`, so it's a chapter right away. Use **⋯** to rename, delete, or create inside a folder. Git status badges show **M**odified, **U**ntracked, and so on.
- **Drag and drop:**
  - Drag tree items onto a folder to move them. Links to a moved page break, and `fpn check` finds them.
  - Drop files from your computer onto a folder to upload them.
  - Drop or paste images into the editor to save them in the page's `images/` folder and insert the Markdown.
  - Drag a tree item into the editor to insert a link to it.
- **Diff:** compares the editor buffer against the last commit (git `HEAD`) or the saved file, with only the changed lines (plus context) or the whole file.
- **⌘S / Ctrl+S** saves. The watcher rebuilds the site and other open tabs reload.
- If the file changed on disk since you opened it (another editor, `git pull`), saving asks before overwriting.
- Drag the divider to resize. On narrow screens, a button switches between editor and preview.
- Offline, it falls back to a plain textarea.
- It only exists in `fpn serve`. The static build has no editor and no edit links. The API only answers on localhost, rejects cross-site requests, and only writes `.md` files inside `content/`.

### Study critique in the editor (needs Claude Code installed)

- **Critique:** runs the `critique-page` skill (read-only) on the saved page: gaps, claims to double-check, and test-yourself questions, with no answers. Results are cached until the page changes.
- It runs `claude -p` locally on the machine running `fpn serve`, using that machine's Claude login. It isn't part of the static build.

## Outline, placeholders and progress

The notebook's outline comes from the 2011 fpnotebook.com sitemap:
- `taxonomy/fpnotebook-2011.json` is the raw sitemap: 31 books, 741 chapters, 8,157 topics.
- `taxonomy/outline.json` is the trimmed version: 30 books, 373 chapters, 8,140 topics.

To regenerate the trimmed outline and scaffold it:

```sh
python3 taxonomy/trim.py taxonomy/fpnotebook-2011.json taxonomy/outline.json
./fpn scaffold -from taxonomy/outline.json     # never overwrites existing files
```

The trim drops the Jokes book. It also folds crossover chapters (e.g. Neurology › "Pediatrics") and chapters with 1–2 topics into each book's General chapter.

Scaffolding creates a folder and an `_index.md` for every book and chapter. The old topic list is kept as a `planned:` list of **topic ideas** (title plus legacy fpnotebook path), shown on each chapter page. Ideas don't count toward anything.

**Progress counts chapters.** A chapter has content once it has at least one written page, or intro text in its `_index.md`. A page with `status: stub` or an empty body doesn't count.
- `fpn build`/`check` print `progress: N/373 chapters have content`.
- Books show a progress bar, and empty chapters are dashed and grey.
- `/progress/` and `fpn status -all` list every chapter as ✓ or empty.
- `fpn check -no-stubs` fails while any chapter is empty.

## Hosting

Every push to `main` deploys to GitHub Pages through `.github/workflows/pages.yml`, which runs the tests, `fpn check`, and a build with the right base path. The site is at https://marcuswalz.github.io/fpn/. Pull requests are checked by `ci.yml`.

## Citations and image sources

- **Citations:** write `[@citekey]`, `[@a; @b]` or `[@key, p. 12]`. Keys come from CSL-JSON files in `references/` (change the folder with `-refs`). This is typically a Zotero **Better BibTeX** "Better CSL JSON" auto-export; see [docs/zotero.md](docs/zotero.md). Citations render as numbered superscripts; locators like `, p. 12` are listed in the reference entry ("Cited: p. 12."), not inline. The formatted (AMA-like) list goes at the end of the page's `## References` section, which is added if missing. Unknown keys are reported as problems.
- **Image sources:** every image needs "Source:" in its caption line (the italic line under it), in the same paragraph, or in its title. Images without one are reported as problems, so `fpn check` fails.

## Robots

Builds are **noindex by default**: every page gets `<meta name="robots" content="noindex, nofollow, noarchive">`, and `robots.txt` disallows all crawlers. Pass `-index` when the site is ready to be public.

## Search

The search box in the header does instant title search over `pages.json`, which the build writes. Page bodies are marked with `data-pagefind-body`, so full-text search can be added later as a post-build step with `npx pagefind --site public`. See PLAN.md.

## Claude Code skills

- `/getting-started [name]` is an interactive onboarding exercise for new contributors (written for Chloe). They run the site, write their first page from a planned topic, practice links, images and `fpn check`, get a critique, and commit.
- `/critique-page content/…/page.md` runs a study critique (`.claude/skills/critique-page`). It flags knowledge gaps, suspect or outdated claims, and inconsistencies, and asks test-yourself questions, without giving the answers.
