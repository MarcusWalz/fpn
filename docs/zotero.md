# Citing from Zotero

Pages cite sources with short keys like `[@whelton2018]`. The site turns each one into a numbered citation and writes the full, formatted reference into the page's **References** section. The keys come from your Zotero library, which Zotero keeps exported into this project's `references/` folder.

## One-time setup (on your own computer)

1. Install **Zotero** (https://www.zotero.org) if you don't have it.
2. Install the free **Better BibTeX** add-on (https://retorque.re/zotero-better-bibtex/installation/). In Zotero, go to **Tools → Plugins**, choose **Install Plugin From File…**, pick the `.xpi` file you downloaded, then restart Zotero.
3. Make a collection for the notebook (or use your whole library).
4. Right-click the collection and choose **Export Collection…**:
   - **Format:** `Better CSL JSON`
   - ✅ **Keep updated**
   - Save it as `references/zotero.json` inside this project folder. Create the `references` folder if it isn't there.

From then on, Zotero rewrites that file whenever you add or edit an item in the collection, and the site picks it up straight away.

## Citing in a page

Every Zotero item now has a **Citation Key**, shown at the top of the item's Info pane, e.g. `whelton2018`.

| You write | The page shows |
|---|---|
| `Targets were lowered [@whelton2018].` | Targets were lowered¹ |
| `[@whelton2018; @carey2022]` | ¹˒² |
| `[@harrison, p. 312]` | ³ (and the reference says "Cited: p. 312.") |

- Numbers follow the order sources first appear on the page, and the same source keeps its number.
- Page numbers and other locators (`, p. 312`, `, ch. 4`) don't appear in the text. They're listed in that source's entry in the References section, e.g. "Cited: p. 312; p. 40."
- The formatted list is added at the end of your `## References` heading's section. If the page has no such heading, one is added.
- A key that isn't in the library shows up in the editor's **Problems** list, and `fpn check` fails, so typos can't reach the public site.

## Images need a source

Every image needs a caption line containing **"Source:"**, usually an italic line directly under it:

```markdown
![Correct cuff placement](images/cuff.png)

*Figure: Correct cuff placement. Source: [@whelton2018]. Used under CC BY 4.0.*
```

`Source: Own work` is fine for your own screenshots and diagrams. Images without a source show up in **Problems**.

## Keeping your library private

GitHub needs the references you cite to publish the site, but it doesn't need your whole library. To share only what you cite:

1. Keep your full export out of git. Add these two lines to the project's `.git/info/exclude` (your own computer only):
   ```
   references/*
   !references/cited.json
   ```
2. Before you commit, run:
   ```sh
   ./fpn refs
   ```
   It writes `references/cited.json` with only the sources your pages cite, copied unchanged from your library. It exits with an error if a page cites a key that isn't in the library.
3. Commit `references/cited.json` along with your pages.

Locally, the site reads both files. On GitHub, only `cited.json` is there, and that's all the published pages need.

Once `cited.json` exists, `./fpn serve` keeps it up to date for you: every time you save a page (in the editor or any other app), it adds new citations and drops ones you removed. It only rewrites the file when the list actually changes. Without `fpn serve` running, run `./fpn refs` yourself before committing.

## Notes

- If you're happy to share your whole library, you can commit `references/zotero.json` instead, so everyone builds the same references.
- You can add more `.json` files to `references/` (for example, one per collection); all of them are read.
- The reference style is AMA-like: authors, title, journal, year;volume(issue):pages, with a DOI link.
