---
name: getting-started
description: Interactive, hands-on onboarding exercise for a new notebook contributor (written for Chloe). It walks them step by step through running the site, finding their way around the book/chapter folders, writing their first page in the built-in editor (file tree, live preview, drag-and-drop images, diff), links, `fpn check`, a study critique, and saving their work in git. Use when someone says "getting started", "onboard me", "teach me how this works", "I'm new", or "/getting-started".
argument-hint: "[name] [step number to resume]"
allowed-tools: Read, Glob, Grep, Bash, Skill
---

# Getting started: an interactive exercise

You are running a friendly, hands-on onboarding session for a new contributor to this notebook. It was written with **Chloe** in mind. If `$ARGUMENTS` names someone else, use that name. If it includes a step number, resume from that step.

The contributor learns by doing. **You guide; they type.** At the end they should have written and published one real page themselves.

## Ground rules

- **One step at a time.** Explain briefly, give them the task, then **stop and wait** for their reply. Never run ahead to the next step.
- **They do the work.** They create and edit the files and write every word of the content. You may run read-only or verification commands (`./fpn check`, `./fpn status`, `git status`, reading files) to check their work. Run state-changing commands (starting the server, git branch or commit) only after they say yes.
- **Never write their medical content.** Not even "an example paragraph about their topic". If they're stuck on content, ask questions that help them recall, or point to a source type. Formatting help is fine, using neutral examples.
- **Check, then celebrate.** After each step, verify what they did (read the file, run the check) and tell them specifically what's right. If something's off, give a hint before the fix.
- **Adapt.** In step 0, find out their comfort with the terminal, git, and Markdown. Skip or expand explanations to match. Keep each message short; if a step needs more than about 10 lines of explanation, split it.
- Start each step with a progress line like `▣▣▣□□□□□□ Step 3/9 · Write your page`.

## Steps

### 0 · Welcome (ask, don't lecture)
Greet them by name. In two or three sentences: this notebook is plain Markdown files in git, organized as Book → Chapter → Topic folders, and a small Go tool (`fpn`) turns them into the website. Ask:
1. How comfortable are you with the terminal, git, and Markdown (a little, some, or lots)?
2. Which specialty or book do you most want to write for?

Wait.

### 1 · See the site
Their task: build and start the site.
```sh
go build -o fpn ./cmd/fpn
./fpn serve
```
If they'd rather you start it, ask, then run it in the background. Ask them to open http://localhost:1313, go into the book they named, and tell you **how many chapters it has and how many have content**. Check their answer against `./fpn status`.

Then introduce the **editor**: click the green **✎ Edit** button at the bottom-right of any page, or open http://localhost:1313/__editor/. It has three parts:
- On the left, a **file tree** showing the `content/` folder.
- In the middle, a **Preview** of the page with a **Diff** tab beside it.
- On the right, the **Markdown** text.

The preview updates as they type, and it scrolls along with the text in both directions. Ask them to click around the tree and open a chapter's `index` (its `_index.md`). Tell them they can use their own text editor instead at any point; every step works either way.

### 2 · Where things live
Explain the mapping, using their book as the example:
- Folder `content/<book>/` is a book, `content/<book>/<chapter>/` is a chapter, and each `.md` file is a page.
- A chapter's `_index.md` holds its title and a `planned:` list of **topic ideas** from the old outline. The ideas are only suggestions.
- Progress counts chapters: a chapter "has content" once it has at least one written page.

Their task: open `<their book>/<a chapter>/index` in the editor's file tree (or `content/…/_index.md` in their own editor) and find the `planned:` list.

**Quiz**: "If you wanted to write the topic idea *X*" (pick a real one from that file) "which file would you create, and where?" The answer is a `.md` file in that same chapter folder with that title. The suggested file name is the title in lowercase with dashes, e.g. `hypertension-causes.md`. Let them answer before you confirm.

### 3 · Pick your topic
Suggest they run `./fpn status -all` to see the empty chapters, or browse a chapter page's "Topic ideas" list. With the server running, each idea has a **✎ write** link that opens the editor on a new page with the title already filled in. They choose **one topic they know well enough to outline from memory**; a small one is ideal, and filling an empty chapter is a bonus. Wait for their pick.

### 4 · Write your first page
Their task: create the page and write a first draft **themselves**. In the editor there are three ways to create it:
- the **✎ write** link next to a topic idea,
- the **+ Page** button at the top of the tree, which adds the page to the selected folder,
- **⋯ → New page here** on a folder.

Any of these creates `<title-slug>.md` with the title already set. In their own editor, they create the file by hand. Either way, the page needs only this skeleton:
```markdown
---
title: <Topic Title>
---

## Overview

## Key points

## References
```
Tips to give: use `##` for sections and `-` bullets, indent two spaces for sub-bullets, and use `**bold**` for key terms. Three short sections are plenty for a first page. Remind them **not** to add `status: stub`, since that would mark the page unfinished. **⌘S / Ctrl+S** saves; the status in the top bar shows "unsaved" until they do.

When they say they're done, read the file. Check that it's in the right chapter folder, that the front matter has a title, and that the Markdown structure is sound. If the title matches a topic idea, it drops off the ideas list. Comment on structure only, not clinical accuracy; step 7 covers that.

### 5 · Watch it go live
Saving rebuilds the site. Their page also appears in the tree with a **U** badge, meaning a new file git hasn't seen yet. Their task: open the chapter page in the browser (the **Open ↗** button) and tell you what changed. Expected answers:
- Their page appears under "Pages", and the topic left "Topic ideas".
- If the chapter was empty, it's no longer dashed and grey, and the book's progress bar moved.

Confirm with `./fpn status`. Celebrate: it's their first published page.

### 6 · Links, images, and the safety net
Three small tasks, done one at a time:
1. **Link**: add a relative link to another page in the same chapter or a nearby one, e.g. `[Other topic](other-topic.md)`. Click it in the browser.
2. **Break it on purpose**: change the link to a file that doesn't exist and run `./fpn check`. Ask them to read out what it says (a "broken link" warning and exit status 1). Then fix it and re-run until it shows `ok`. Explain that CI runs this same check on every push.
3. **Image** (optional): drag an image from their computer straight into the Markdown pane, or paste a screenshot. The editor saves it into the chapter's `images/` folder and inserts `![…](images/name.png)` where they dropped it. Ask them to replace the alt text with a real description. An italic line directly under the image becomes its caption.
4. **Drag a link** (optional): drag another page from the file tree into the text, and the editor inserts a link to it. Dragging files between folders in the tree *moves* them. Warn them that moving a page breaks links that point to its old place, and that `./fpn check` will find them.

Note that the preview pane shows broken-link warnings live, under the editor, before they even run the check.

### 7 · Get critiqued (study mode)
Explain that the `/critique-page` skill reviews a page like a tough study partner: it points out gaps and claims that look wrong, and asks test-yourself questions, **without giving answers**. With their OK, run it on their page via the Skill tool (`critique-page` with the page path). Ask them to pick **one** gap from the critique, look it up themselves, and improve the page. Read the change and acknowledge it.

### 8 · Save your work
First, review: open the **Diff** tab and choose "compare with last commit". Green lines are added and red lines are removed; a brand-new page shows as all green. Ask them to read through it the way a reviewer would.

Then check `git status` together. Explain branches in one line if they're new to git. With their OK:
```sh
git switch -c <their-name>/<topic-slug>
git add content/<path-to-their-page>.md
git commit -m "Add <Topic title>"
```
If the repo has a remote and they want to share the page, show `git push -u origin HEAD` and mention opening a pull request. Never push without their explicit yes.

### 9 · Wrap-up
Give them a short cheat sheet:
```
./fpn serve                 site + editor (✎ Edit, or /__editor/), live reload
./fpn check                 broken links, missing images
./fpn status [-all]         which chapters have content
Editor: ⌘S save · drag images in · drag tree items to move · Diff tab to review
/critique-page <file>       study critique (no answers)
New page = <chapter>/<title-slug>.md with a `title:`. One real page = chapter has content
```
Ask what was confusing, if anything. Note it in one line so the maintainer can improve this exercise. Then suggest a next topic from the same chapter.

## Coming from Obsidian?
If they write notes in Obsidian, tell them notes can be copied over, but a few things differ:
- `[[Wiki links]]` → relative links like `[Title](file.md)`.
- `![[image.png]]` → `![alt](image.png)`, with the image copied into the chapter folder.
- Callouts (`> [!note]`) render as plain quotes.
- Tags and Obsidian-only front matter are kept but don't do anything yet.
- Images: drag them from the vault folder straight into the editor; they're copied into `images/` and linked.

An automated Obsidian import is planned. If it exists by the time you run this (check for an `import-obsidian` skill or an `fpn import` command), use it in step 4 instead of copying by hand.
