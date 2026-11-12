package site

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/marcuswalz/fpn/web"
)

const testLibrary = `[
 {"id":"whelton2018","type":"article-journal","title":"2017 Guideline for High Blood Pressure in Adults.",
  "author":[{"family":"Whelton","given":"Paul K."},{"family":"Carey","given":"Robert M."},{"family":"Aronow","given":"Wilbert S."},{"family":"Casey","given":"Donald E."},{"family":"Collins","given":"Karen J."}],
  "container-title":"Hypertension","journalAbbreviation":"Hypertension","issued":{"date-parts":[[2018,6]]},
  "volume":"71","issue":6,"page":"e13--e115","DOI":"10.1161/HYP.0000000000000065"},
 {"id":"harrison","type":"book","title":"Harrison's Principles of Internal Medicine","author":[{"literal":"Loscalzo J, et al"}],
  "publisher":"McGraw Hill","edition":"21","issued":{"date-parts":[[2022]]}}
]`

func citeSite(t *testing.T, page string) (string, []string) {
	t.Helper()
	dir := t.TempDir()
	content, refs := filepath.Join(dir, "content"), filepath.Join(dir, "references")
	os.MkdirAll(filepath.Join(content, "book", "chap"), 0o755)
	os.MkdirAll(refs, 0o755)
	os.WriteFile(filepath.Join(refs, "zotero.json"), []byte(testLibrary), 0o644)
	os.WriteFile(filepath.Join(content, "book", "chap", "p.md"), []byte(page), 0o644)
	os.WriteFile(filepath.Join(content, "book", "chap", "pic.png"), []byte("x"), 0o644)
	out := filepath.Join(dir, "public")
	res, err := Build(Config{ContentDir: content, OutDir: out, Base: "/", Web: web.FS, RefsDir: refs})
	if err != nil {
		t.Fatal(err)
	}
	html, _ := os.ReadFile(filepath.Join(out, "book", "chap", "p", "index.html"))
	return string(html), res.Warnings
}

func TestCitations(t *testing.T) {
	html, warns := citeSite(t, "# P\n\nBP targets [@whelton2018]. Again [@harrison, p. 12; @whelton2018]. More [@harrison, p. 40] [@harrison, p. 12].\n"+
		"Typo [@nobody]. Link [@someone](https://example.com).\n\n```\n[@whelton2018] in code\n```\n\n## References\n\n- Extra note\n\n## After\n")
	for _, want := range []string{
		`BP targets<sup class="cite"><a href="#ref-1">1</a></sup>.`, // first citation is 1, no space before it
		`<span class="cite-loc">(p. 40)</span></sup><sup class="cite">,</sup><sup class="cite"><a href="#ref-2">2</a><span class="cite-loc">(p. 12)</span></sup>`, // side by side: joined with a comma
		`<sup class="cite"><a href="#ref-2">2</a><span class="cite-loc">(p. 12)</span>,<a href="#ref-1">1</a></sup>`,                                              // group: commas; locator inline; reuse of 1
		`<sup class="cite"><a href="#ref-2">2</a><span class="cite-loc">(p. 40)</span></sup>`,                                                                     // each cite keeps its own page
		`McGraw Hill; 2022.</li>`, // the reference list has no locators
		`Whelton PK, Carey RM, Aronow WS, et al. 2017 Guideline for High Blood Pressure in Adults. <em>Hypertension</em>. 2018;71(6):e13–e115.`,
		`href="https://doi.org/10.1161/HYP.0000000000000065"`,
		`Loscalzo J, et al. Harrison&#39;s Principles of Internal Medicine. 21 ed. McGraw Hill; 2022.`,
		`[@whelton2018] in code`,                     // fenced code untouched
		`<a href="https://example.com">@someone</a>`, // normal link untouched
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q", want)
		}
	}
	// list goes inside the existing References section, before the next h2
	refs, list, after := strings.Index(html, `id="references"`), strings.Index(html, `<ol class="citations">`), strings.Index(html, `id="after"`)
	if !(refs < list && list < after) {
		t.Errorf("reference list misplaced: refs=%d list=%d after=%d", refs, list, after)
	}
	if len(warns) != 1 || !strings.Contains(warns[0], `unknown citation "@nobody"`) {
		t.Errorf("warnings = %v", warns)
	}
}

func TestCitationsAddReferencesSection(t *testing.T) {
	html, _ := citeSite(t, "# P\n\nClaim [@whelton2018].\n")
	if !strings.Contains(html, `<h2 id="references">References</h2><ol class="citations">`) {
		t.Error("expected an added References section")
	}
}

func TestSourceNotes(t *testing.T) {
	page := "# P\n\n![Cuff](pic.png)\n\n*Figure: Cuff. Source needed.*\n<!-- source note: from Dr. Lee's slides, week 3 -->\n\nAfter.\n"
	html, warns := citeSite(t, page)
	if strings.Contains(html, "Dr. Lee") || strings.Contains(html, "source note") {
		t.Error("source note leaked into the page HTML")
	}
	if len(warns) != 1 || !strings.Contains(warns[0], `image "pic.png" has no "Source:" caption — your note: "from Dr. Lee's slides, week 3"`) {
		t.Errorf("warning should carry the note, got %v", warns)
	}
	// once a source is added, the note stays hidden and there's no warning
	html, warns = citeSite(t, strings.Replace(page, "Source needed.", "Source: Own work.", 1))
	if len(warns) != 0 || strings.Contains(html, "Dr. Lee") {
		t.Errorf("fixed image: warns=%v", warns)
	}
}

func TestImageSourceCheck(t *testing.T) {
	_, warns := citeSite(t, "# P\n\n![Cuff](pic.png)\n\nNo caption here.\n")
	if len(warns) != 1 || !strings.Contains(warns[0], `image "pic.png" has no "Source:" caption`) {
		t.Errorf("missing-source warning expected, got %v", warns)
	}
	for _, ok := range []string{
		"# P\n\n![Cuff](pic.png)\n\n*Figure: cuff. Source: Own work.*\n",
		"# P\n\n![Cuff](pic.png)\n*Source: [@whelton2018]*\n",
		"# P\n\n![Cuff](pic.png \"Source: Own work\")\n",
	} {
		if _, warns := citeSite(t, ok); len(warns) != 0 {
			t.Errorf("credited image flagged: %q → %v", ok, warns)
		}
	}
}

func TestCitationsSideBySideNoSpace(t *testing.T) {
	html, _ := citeSite(t, "# P\n\nSee [@whelton2018][@harrison] here.\n")
	want := `See<sup class="cite"><a href="#ref-1">1</a></sup><sup class="cite">,</sup><sup class="cite"><a href="#ref-2">2</a></sup> here.`
	if !strings.Contains(html, want) {
		t.Errorf("missing %s", want)
	}
}
