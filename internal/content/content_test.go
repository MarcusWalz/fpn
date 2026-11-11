package content

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSlugify(t *testing.T) {
	for in, want := range map[string]string{
		"Atrial Fibrillation": "atrial-fibrillation",
		"ACE_inhibitors":      "ace-inhibitors",
		"  --weird!!name-- ":  "weird-name",
		"":                    "untitled",
	} {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFrontMatterAndTitle(t *testing.T) {
	meta, body, err := SplitFrontMatter([]byte("---\ntitle: X\norder: 2\n---\n# Heading\ntext"))
	if err != nil || meta["title"] != "X" || meta["order"] != 2 || string(body) != "# Heading\ntext" {
		t.Fatalf("got meta=%v body=%q err=%v", meta, body, err)
	}
	if _, body, _ := SplitFrontMatter([]byte("no front matter")); string(body) != "no front matter" {
		t.Fatalf("plain body changed: %q", body)
	}
	if got := FirstH1([]byte("```\n# not this\n```\n\n# Real title\n")); got != "Real title" {
		t.Fatalf("FirstH1 = %q", got)
	}
}

func TestLoadTree(t *testing.T) {
	dir := t.TempDir()
	write := func(rel, s string) {
		p := filepath.Join(dir, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(s), 0o644)
	}
	write("_index.md", "---\ntitle: Site\n---\n")
	write("book-b/chap/page-one.md", "# Page One\n")
	write("book-b/chap/zeta.md", "---\norder: 1\n---\nno heading")
	write("book-a/_index.md", "# Book A\n")
	write("book-a/img.png", "x")
	write("book-b/chap/images/my pic.png", "x")

	tr, err := Load(dir, "/")
	if err != nil {
		t.Fatal(err)
	}
	if tr.Root.Title != "Site" || len(tr.Pages) != 2 || tr.Root.PageCount() != 2 {
		t.Fatalf("root=%q pages=%d", tr.Root.Title, len(tr.Pages))
	}
	books := tr.Root.Sections()
	if books[0].Title != "Book A" || books[1].Title != "Book b" {
		t.Fatalf("books = %q, %q", books[0].Title, books[1].Title)
	}
	chap := tr.ByRel["book-b/chap"]
	if p := chap.Pages(); p[0].Title != "Zeta" || p[1].URL != "/book-b/chap/page-one/" {
		t.Fatalf("order/url wrong: %q %q", p[0].Title, p[1].URL)
	}
	if a := tr.Assets["book-a/img.png"]; a == nil || a.URL != "/book-a/img.png" {
		t.Fatalf("asset = %+v", a)
	}
	if len(chap.Sections()) != 0 {
		t.Fatalf("asset-only folder became a section")
	}
	if a := tr.Assets["book-b/chap/images/my pic.png"]; a == nil || a.URL != "/book-b/chap/images/my%20pic.png" {
		t.Fatalf("spaced asset = %+v", a)
	}
}

func TestPlannedTopics(t *testing.T) {
	dir := t.TempDir()
	write := func(rel, s string) {
		p := filepath.Join(dir, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(s), 0o644)
	}
	write("book/chap/_index.md", "---\ntitle: Chap\nplanned:\n  - title: Alpha\n  - title: Beta\n    legacy: X/Beta.htm\n  - Gamma\n---\n")
	write("book/chap/alpha.md", "# Alpha\n\nReal content.\n")                               // written: matches by title
	write("book/chap/b.md", "---\ntitle: Renamed\nlegacy: X/Beta.htm\nstatus: stub\n---\n") // stub: matches by legacy
	write("book/chap/extra.md", "# Extra\n\nNot in the outline.\n")

	tr, err := Load(dir, "/")
	if err != nil {
		t.Fatal(err)
	}
	chap := tr.ByRel["book/chap"]
	if got := len(chap.OutstandingPlanned()); got != 2 { // Beta (stub) + Gamma (no page)
		t.Fatalf("outstanding = %d, want 2", got)
	}
	r := tr.Root
	// pages: alpha, b(stub), extra = 3; todo: Gamma = 1; total 4; done 2
	if r.TotalCount() != 4 || r.DoneCount() != 2 || r.TodoCount() != 1 || r.OutstandingCount() != 2 || r.Percent() != 50 {
		t.Fatalf("total=%d done=%d todo=%d outstanding=%d pct=%d", r.TotalCount(), r.DoneCount(), r.TodoCount(), r.OutstandingCount(), r.Percent())
	}
}
