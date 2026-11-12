---
name: import-obsidian
description: Import a note from Obsidian into the notebook. It converts Obsidian-only syntax (wiki links, image embeds, callouts, highlights, comments, block IDs) into notebook Markdown, copies its images into the chapter's images/ folder, and places the page in the right book and chapter. It never changes the medical content. Use when the user says "import from Obsidian", "bring in my Obsidian note", "convert this Obsidian note", or "/import-obsidian".
argument-hint: "[note name or path in obsidian-inbox/] [target chapter]"
---

# Import a note from Obsidian

You convert one Obsidian note (or a few) into a notebook page. **Change the syntax, never the substance.** Every clinical sentence, number, list item and heading the user wrote must come through word for word. Don't fix, reword, summarise, reorder or "improve" their content, and don't add any medical content of your own. If something looks clinically wrong, you may mention it at the end, but leave it as written.

## 0 · Find the note

The user's Obsidian vault is outside this project, and their settings block reading outside it. So notes come in through **`obsidian-inbox/`** at the project root (ignored by git on their computer, and not part of the site).

- If `$ARGUMENTS` names a note, look for it in `obsidian-inbox/` (match the file name loosely, case-insensitive).
- If the inbox is empty or missing, ask them to copy the note's `.md` file into `obsidian-inbox/` from Finder, along with any images it embeds (Obsidian usually keeps those in an attachments folder). Or they can paste the note's text into the chat, and drop just the images in the inbox. Then wait.
- Never try to read their vault directly or ask them to loosen their settings.

Read the whole note before changing anything.

## 1 · Choose where it goes

Content is `content/<book>/<chapter>/<page>.md`. Suggest a chapter:

- Search chapter titles and their `_index.md` `planned:` topic lists for the note's subject (Grep `content/`). A note that matches a planned topic idea is a great fit, because the idea will drop off the chapter's list once the page exists.
- Offer your best one or two matches with their paths, and ask the user to confirm. If `$ARGUMENTS` already names a chapter, use it.
- **File name:** the page title in lowercase with dashes (`Heart Failure Drugs` → `heart-failure-drugs.md`). Obsidian titles come from the file name, so use that unless the note has a `title:` or a single `# Heading`.
- If that file already exists, stop and ask: merge into it, pick another name, or skip. Never overwrite.

## 2 · Convert

Apply only the changes below. Keep a short list of everything you changed, to report at the end.

**Front matter**
- Keep the existing YAML front matter, including `tags:`, `aliases:` and any other keys. The site keeps unknown keys.
- Make sure there's a `title:`. If missing, add one from the file name.
- Remove Obsidian-only plugin keys only if they would break YAML. Otherwise leave them.

**Links between notes**
- `[[Note]]`, `[[Note|text]]` and `[[Note#Heading]]`: look for a notebook page with that title or file name (Grep `content/` for `title: Note` and for `note.md`).
  - Found: write a relative link from the new page's folder, e.g. `[text](../other-chapter/note.md)` or `[text](note.md#heading)`. Heading anchors are the heading in lowercase with dashes.
  - Not found: write the link text as plain text (the alias if there is one), and list it under "Links I couldn't match". Don't create a link to a page that doesn't exist, because `fpn check` fails on broken links.
- `![[Other note]]` (embedding a whole note): replace with a normal link to it, using the same matching, and mention it, because the site can't embed one page inside another.

**Images**
- `![[picture.png]]`, `![[picture.png|300]]` and `![alt](attachments/picture.png)`: find the image in `obsidian-inbox/` and copy it to `content/<book>/<chapter>/images/`, renamed in lowercase with dashes. If a file with that name is already there and differs, add `-2`.
- Write `![Alt text](images/picture.png)`. Use the note's alt text if it has any. Otherwise ask the user for a short description; don't invent one from the image.
- **Every image needs a "Source:" caption** on the line under it, or the site flags it. Ask the user for each image's source: their own work (`Source: Own work`), a Zotero reference (`Source: [@key]`), or a website (`Source: [Name](https://…)`). Never guess a source. If they don't know yet, leave the caption out so it shows up in the editor's Problems panel, and tell them.
- If an embedded image isn't in the inbox, keep the line as plain text, `(missing image: picture.png)`, and list it.

**Obsidian formatting**
- Callouts: `> [!note] Title` followed by `> text` → a plain quote with a bold label, `> **Note: Title**` then `> text`. Keep the callout type as the label (Warning, Tip, Important…). Drop the `+`/`-` folding markers.
- Highlights: keep `==text==` as it is; the site renders it as a green highlight. Coloured text (`<span style="color:…">text</span>`) becomes `==text==` too, since custom colours usually fail contrast in one of the themes.
- Comments: `%% … %%` (inline or multi-line) are private in Obsidian. **Remove them** so they don't get published, and tell the user how many you removed.
- Block IDs: remove `^abc123` at the end of lines.
- Inline `#tags` in the text: leave the words, but move the tags into front matter `tags:` and remove the `#tag` from the text. Don't touch `#` headings.
- Dataview, Templater and other plugin code blocks: remove them and list what you removed. They only work inside Obsidian.
- Citations: `[@key]` is already the notebook's citation format. Keep it. Check each key exists in `references/` and list any that don't.
- Leave everything else exactly as it is: normal Markdown, tables, lists, math, code blocks, and normal `[text](https://…)` links.

## 3 · Save and check

1. Write the page to the chosen path.
2. Run `./fpn check`. Fix only problems your conversion caused, such as a link you wrote. Report the rest.
3. If `references/cited.json` exists and the page cites anything, run `./fpn refs`.
4. Don't commit. Don't delete anything from `obsidian-inbox/`. Offer to tidy the inbox once they're happy with the page.

## 4 · Report

Keep it short:
- Where the page is, with its local link: `http://localhost:1313/<book>/<chapter>/<page>/`.
- What you converted (counts are fine), and any links, images or citation keys you couldn't resolve.
- Anything that needs their input: image sources, alt text, unmatched links.
- Remind them the content itself wasn't changed, and offer to import the next note.

## Several notes at once

Import them one at a time, in the order the user gives. After the first one, confirm each chapter in one line ("`Diuretics.md` → `content/cardiovascular-medicine/congestive-heart-failure/diuretics.md`, OK?"), so it doesn't turn into a long interview. Do links between notes imported in the same batch last, once all their pages exist.
