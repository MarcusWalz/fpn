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

- The page preview is on the left and the Markdown editor (CodeMirror) is on the right. The preview re-renders as you type, before you save, using the real templates. It also shows broken-link warnings.
- **⌘S / Ctrl+S** saves. The watcher rebuilds the site and other open tabs reload.
- If the file changed on disk since you opened it (another editor, `git pull`), saving asks before overwriting.
- Drag the divider to resize. On narrow screens, a button switches between editor and preview.
- Offline, it falls back to a plain textarea.
- It only exists in `fpn serve`. The static build has no editor and no edit links. The API only answers on localhost, rejects cross-site requests, and only writes `.md` files inside `content/`.

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

## Robots

Builds are **noindex by default**: every page gets `<meta name="robots" content="noindex, nofollow, noarchive">`, and `robots.txt` disallows all crawlers. Pass `-index` when the site is ready to be public.

## Search

The search box in the header does instant title search over `pages.json`, which the build writes. Page bodies are marked with `data-pagefind-body`, so full-text search can be added later as a post-build step with `npx pagefind --site public`. See PLAN.md.

## Claude Code skills

- `/getting-started [name]` is an interactive onboarding exercise for new contributors (written for Chloe). They run the site, write their first page from a planned topic, practice links, images and `fpn check`, get a critique, and commit.
- `/critique-page content/…/page.md` runs a study critique (`.claude/skills/critique-page`). It flags knowledge gaps, suspect or outdated claims, and inconsistencies, and asks test-yourself questions, without giving the answers.
