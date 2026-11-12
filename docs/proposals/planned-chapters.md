# Proposal: planned chapters live in the book's `_index.md`

**Requested by:** Chloe (2026-11-11) · **Decision needed from:** Marcus · **Status:** not started. No content has been changed.

## Problem

All 373 chapters exist as folders, but only 2 have pages. The file tree and site feel cluttered, and it's hard for writers to focus. The editor now has a focus mode that hides empty folders in the tree, which helps writers, but the site and the repo still carry about 371 empty chapter folders.

## Proposal

Move each **untouched** chapter out of the folder tree and into its book's `_index.md` as a `planned_chapters:` entry. Each entry keeps the chapter's title, its legacy path, and its topic ideas:

```yaml
# content/cardiovascular-medicine/_index.md
---
title: Cardiovascular Medicine
planned_chapters:
  - title: Anatomy
    legacy: CV/Anatomy/
    planned:
      - title: Cardiovascular Anatomy
        legacy: CV/Anatomy/CrdvsclrAntmy.htm
      # …
---
```

A chapter counts as "untouched" when its folder holds only an `_index.md` that is unchanged from the scaffold: no pages, no intro text, and no local edits.

## What changes in fpn

1. **Content model:** parse `planned_chapters:` on book sections. Progress becomes "chapters with content / (folder chapters + planned chapters)", so the totals stay honest.
2. **Book page:** a "Chapter ideas" list below the real chapters, styled like topic ideas.
3. **Editor:** each chapter idea gets a "✎ start chapter" action. It creates the folder and an `_index.md` with that chapter's topic ideas, then removes the entry from `planned_chapters:`.
4. **Migration command:** `fpn fold-empty-chapters [-dry-run]` (one-off). It moves untouched chapters into their book's index and deletes their folders. It skips any folder with pages, intro text, extra files, or uncommitted changes.
5. **Scaffold:** optionally write new outlines this way from the start.

## Risks and notes

- Folders with uncommitted edits right now must be **skipped**, not deleted: `orthopedics/wrist-disorders/` (Marcus's "hello world" test plus `test.md.md`) and `cardiovascular-medicine/hypertension/_index.md`.
- It's a large diff, roughly 370 folders removed and 30 book indexes grown, but it's reversible with git, and `taxonomy/outline.json` can regenerate everything.
- Old links into empty chapter URLs stop working. The site is not public or indexed yet, so the impact is low.
- The alternative is to keep folders and rely on editor focus mode (already built), which needs no content change.

## Effort

About half a day, including tests: model and templates, the editor action, and the migration command with a dry run.
