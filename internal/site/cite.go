package site

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Citations: pages cite with [@key] (pandoc style), keys come from CSL-JSON
// files in the references directory, e.g. a Zotero "Better CSL JSON"
// auto-export made by the Better BibTeX add-on.

// CSLItem is the subset of CSL-JSON fields used for formatting.
type CSLItem struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Author    []CSLName  `json:"author"`
	Editor    []CSLName  `json:"editor"`
	Issued    CSLDate    `json:"issued"`
	Container string     `json:"container-title"`
	Short     string     `json:"container-title-short"`
	Journal   string     `json:"journalAbbreviation"`
	Volume    flexString `json:"volume"`
	Issue     flexString `json:"issue"`
	Page      flexString `json:"page"`
	Publisher string     `json:"publisher"`
	DOI       string     `json:"DOI"`
	URL       string     `json:"URL"`
	Edition   flexString `json:"edition"`
}

// CSLName is a person (family/given) or an organization (literal).
type CSLName struct {
	Family  string `json:"family"`
	Given   string `json:"given"`
	Literal string `json:"literal"`
}

// CSLDate holds {"date-parts": [[2023, 5, 1]]} or {"raw": "2023"}.
type CSLDate struct {
	Parts [][]flexString `json:"date-parts"`
	Raw   string         `json:"raw"`
}

// flexString accepts JSON strings or numbers (CSL exporters use both).
type flexString string

func (f *flexString) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		*f = flexString(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	*f = flexString(n.String())
	return nil
}

// Library maps citation keys to items.
type Library map[string]*CSLItem

// loadLibrary reads every *.json file in dir (CSL-JSON arrays). A missing
// dir is fine (empty library); bad files are reported as warnings.
func loadLibrary(dir string) (Library, []string) {
	lib := Library{}
	if dir == "" {
		return lib, nil
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	sort.Strings(files)
	var warns []string
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			warns = append(warns, fmt.Sprintf("(references) %s: %v", filepath.Base(f), err))
			continue
		}
		var items []*CSLItem
		if err := json.Unmarshal(data, &items); err != nil {
			warns = append(warns, fmt.Sprintf("(references) %s: not a CSL-JSON list: %v", filepath.Base(f), err))
			continue
		}
		for _, it := range items {
			if it != nil && it.ID != "" {
				lib[it.ID] = it
			}
		}
	}
	return lib, warns
}

// ---- formatting (AMA-like, as is usual in medicine) ----

func (n CSLName) short() string {
	if n.Literal != "" {
		return n.Literal
	}
	initials := ""
	for _, part := range strings.FieldsFunc(n.Given, func(r rune) bool { return r == ' ' || r == '-' || r == '.' }) {
		for _, r := range part {
			initials += string(r)
			break
		}
	}
	if initials == "" {
		return n.Family
	}
	return n.Family + " " + initials
}

func (d CSLDate) year() string {
	if len(d.Parts) > 0 && len(d.Parts[0]) > 0 {
		return string(d.Parts[0][0])
	}
	if len(d.Raw) >= 4 {
		return d.Raw[:4]
	}
	return ""
}

// formatRef renders one reference as HTML (escaped).
func formatRef(it *CSLItem) string {
	e := html.EscapeString
	var b strings.Builder
	names := it.Author
	if len(names) == 0 {
		names = it.Editor
	}
	if len(names) > 0 {
		var ns []string
		for i, n := range names {
			if i == 3 && len(names) > 4 {
				ns = append(ns, "et al")
				break
			}
			ns = append(ns, n.short())
		}
		b.WriteString(e(strings.Join(ns, ", ")) + ". ")
	}
	if it.Title != "" {
		t := strings.TrimRight(it.Title, ".")
		b.WriteString(e(t) + ". ")
	}
	container := it.Journal
	if container == "" {
		container = it.Short
	}
	if container == "" {
		container = it.Container
	}
	year := it.Issued.year()
	switch {
	case it.Type == "book" || (container == "" && it.Publisher != ""):
		if it.Edition != "" {
			b.WriteString(e(string(it.Edition)) + " ed. ")
		}
		if it.Publisher != "" {
			b.WriteString(e(it.Publisher))
			if year != "" {
				b.WriteString("; ")
			}
		}
		if year != "" {
			b.WriteString(e(year))
		}
		b.WriteString(".")
	default:
		if container != "" {
			b.WriteString("<em>" + e(container) + "</em>. ")
		}
		b.WriteString(e(year))
		if it.Volume != "" {
			b.WriteString(";" + e(string(it.Volume)))
		}
		if it.Issue != "" {
			b.WriteString("(" + e(string(it.Issue)) + ")")
		}
		if it.Page != "" {
			b.WriteString(":" + e(strings.ReplaceAll(string(it.Page), "--", "–")))
		}
		b.WriteString(".")
	}
	switch {
	case it.DOI != "":
		doi := strings.TrimPrefix(strings.TrimPrefix(it.DOI, "https://doi.org/"), "doi:")
		b.WriteString(fmt.Sprintf(` <a href="https://doi.org/%s">doi:%s</a>`, e(doi), e(doi)))
	case it.URL != "":
		b.WriteString(fmt.Sprintf(` <a href="%s">%s</a>`, e(it.URL), e(it.URL)))
	}
	return strings.TrimSpace(b.String())
}

// ---- [@key] processing ----

var citeRe = regexp.MustCompile(`\[(-?@[^\[\]\n]+)\]`)

// citeState numbers citations in order of first appearance on one page.
type citeState struct {
	lib   Library
	order []string
	num   map[string]int
	locs  map[string][]string // key -> distinct locators ("p. 312"), shown in the reference list
	warns []string
}

func newCiteState(lib Library) *citeState {
	return &citeState{lib: lib, num: map[string]int{}, locs: map[string][]string{}}
}

// preprocess replaces [@key], [@a; @b] and [@key, p. 12] with superscript
// citation links (raw HTML). Lines inside code fences and [@x](url) links are
// left alone. Line structure is preserved.
func (c *citeState) preprocess(src []byte) []byte {
	if !bytes.Contains(src, []byte("[@")) && !bytes.Contains(src, []byte("[-@")) {
		return src
	}
	lines := strings.Split(string(src), "\n")
	inFence := false
	for i, line := range lines {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence || !strings.Contains(line, "@") {
			continue
		}
		var out strings.Builder
		last := 0
		for _, m := range citeRe.FindAllStringSubmatchIndex(line, -1) {
			if m[1] < len(line) && line[m[1]] == '(' {
				continue // a normal link like [@someone](https://…)
			}
			html, ok := c.render(line[m[2]:m[3]])
			if !ok {
				continue
			}
			out.WriteString(line[last:m[0]])
			out.WriteString(html)
			last = m[1]
		}
		if last > 0 {
			out.WriteString(line[last:])
			lines[i] = out.String()
		}
	}
	return []byte(strings.Join(lines, "\n"))
}

// render turns the inside of [...] into a <sup> citation, or ok=false if it
// isn't a citation group.
func (c *citeState) render(inner string) (string, bool) {
	var parts []string
	for _, item := range strings.Split(inner, ";") {
		item = strings.TrimSpace(item)
		item = strings.TrimPrefix(item, "-") // pandoc's "suppress author" makes no difference here
		if !strings.HasPrefix(item, "@") {
			return "", false
		}
		key, locator := item[1:], ""
		if i := strings.IndexAny(key, ", "); i >= 0 {
			key, locator = key[:i], strings.TrimSpace(strings.TrimLeft(key[i:], ", "))
		}
		if key == "" {
			return "", false
		}
		label := ""
		if _, ok := c.lib[key]; ok {
			n, seen := c.num[key]
			if !seen {
				c.order = append(c.order, key)
				n = len(c.order)
				c.num[key] = n
			}
			label = fmt.Sprintf(`<a href="#ref-%d">%d</a>`, n, n)
			// Locators (pages, chapters…) go in the reference list, not inline.
			if locator != "" && !contains(c.locs[key], locator) {
				c.locs[key] = append(c.locs[key], locator)
			}
		} else {
			c.warns = append(c.warns, fmt.Sprintf(`unknown citation "@%s" (not in the references library)`, key))
			label = `<span class="cite-missing" title="Not found in the references library">?` + html.EscapeString(key) + `</span>`
		}
		parts = append(parts, label)
	}
	return `<sup class="cite">` + strings.Join(parts, "; ") + `</sup>`, true
}

var refsHeadingRe = regexp.MustCompile(`<h2[^>]*\bid="references"[^>]*>`)

// appendReferences inserts the numbered reference list at the end of the
// page's "References" section, or adds that section if the page has none.
func (c *citeState) appendReferences(body string) string {
	if len(c.order) == 0 {
		return body
	}
	var list strings.Builder
	list.WriteString(`<ol class="citations">`)
	for i, key := range c.order {
		loc := ""
		if ls := c.locs[key]; len(ls) > 0 {
			loc = ` <span class="cite-loc">Cited: ` + html.EscapeString(strings.Join(ls, "; ")) + `.</span>`
		}
		fmt.Fprintf(&list, `<li id="ref-%d">%s%s</li>`, i+1, formatRef(c.lib[key]), loc)
	}
	list.WriteString(`</ol>`)
	if loc := refsHeadingRe.FindStringIndex(body); loc != nil {
		rest := body[loc[1]:]
		if next := strings.Index(rest, "<h2"); next >= 0 {
			at := loc[1] + next
			return body[:at] + list.String() + "\n" + body[at:]
		}
		return body + list.String()
	}
	return body + `<h2 id="references">References</h2>` + list.String()
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// ---- private source notes ----

// A note written when an image's source was skipped:
//
//	<!-- source note: from Dr. Lee's slides -->
//
// It belongs to the closest image above it. Notes are removed before
// rendering (never reach the site) and shown in the problem for that image.
var (
	sourceNoteRe = regexp.MustCompile(`^\s*<!--\s*source note:\s*(.*?)\s*-->\s*$`)
	imageDestRe  = regexp.MustCompile(`!\[[^\]]*\]\(\s*<?([^)\s>]+)`)
)

// extractSourceNotes blanks out source-note lines (keeping line numbers) and
// returns the notes keyed by the destination of the image they follow.
func extractSourceNotes(src []byte) ([]byte, map[string]string) {
	if !bytes.Contains(src, []byte("source note:")) {
		return src, nil
	}
	notes := map[string]string{}
	lines := strings.Split(string(src), "\n")
	lastImage := ""
	for i, line := range lines {
		if m := sourceNoteRe.FindStringSubmatch(line); m != nil {
			if lastImage != "" && m[1] != "" {
				notes[lastImage] = m[1]
			}
			lines[i] = ""
			continue
		}
		if all := imageDestRe.FindAllStringSubmatch(line, -1); len(all) > 0 {
			lastImage = all[len(all)-1][1]
		}
	}
	return []byte(strings.Join(lines, "\n")), notes
}
