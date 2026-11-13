A specimen of every text style a notebook page can use, rendered by the same Markdown pipeline as real pages. Use it to check heading sizes, spacing and rhythm after changing `web/static/style.css`. It's built into the site at `/typography/`; nothing links to it.

## Section heading (`##`)

A section opens with a short paragraph. Body text is set at a comfortable size with generous line spacing, and lines stop at a readable width so the eye can find the start of the next line. This paragraph is long on purpose, so you can judge the measure: a line of roughly sixty to eighty characters is easiest to read, and much longer lines make it easy to lose your place.

### Topic heading (`###`)

Topics are the working level of most pages. A topic usually holds a few short paragraphs, a list, or a table.

- A bullet point with a **bold lead-in:** followed by ordinary text.
- A second point that runs long enough to wrap onto a second line, so you can see how wrapped lines align with the text above them.
  - A nested point, indented one level.
    - And one more level, the deepest most pages go.
- A last point.

#### Sub-heading (`####`)

Sub-headings split a topic into parts, such as presentation, workup and management.

1. A numbered step.
2. Another step, with `inline code` and a [link to another section](#tables-notes-and-quotes).
3. A step with ==highlighted text==.

##### Label heading (`#####`)

A label marks a small group of points inside a sub-heading.

###### Small heading (`######`)

The smallest heading, for a run-in label before a paragraph or two.

## Headings back to back

### A topic straight after its section

#### And a sub-heading straight after that

When headings follow each other with no text between them, the gaps between them should shrink, so the stack reads as one unit instead of three floating lines.

## A skipped level

#### Written as `####` directly under a `##`

The site renumbers skipped levels for screen readers, so this renders as the next level down. It should look like the level it renders at.

## Tables, notes and quotes

**Table 1.1—A table caption, written as a bold line starting with "Table"**

| Column | Another column | Notes |
|---|---|---|
| A short value | 12 | A longer note that wraps inside its cell when the table is narrow |
| Another value | 34 | — |

Note: A paragraph starting with "Note:" is set smaller, tucked under the table above.

> A quote, or an Obsidian callout after import. It sits on a tinted background with a bar down the left.

*Figure: an italic line starting with "Figure" is a figure caption.*

A closing paragraph after the specials, to check that ordinary text picks up its normal rhythm again.
