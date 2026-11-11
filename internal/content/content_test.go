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

func TestChapterProgress(t *testing.T) {
	dir := t.TempDir()
	write := func(rel, s string) {
		p := filepath.Join(dir, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(s), 0o644)
	}
	// written: has a real page; planned topics don't matter
	write("book/written/_index.md", "---\ntitle: Written\nplanned:\n  - title: Alpha\n  - Gamma\n---\n")
	write("book/written/alpha.md", "# Alpha\n\nReal content.\n")
	// empty: only planned topics and a stub page
	write("book/empty/_index.md", "---\ntitle: Empty\nplanned:\n  - title: Beta\n    legacy: X/Beta.htm\n---\n")
	write("book/empty/b.md", "---\ntitle: Renamed\nlegacy: X/Beta.htm\nstatus: stub\n---\n")
	// intro: chapter with intro text but no pages counts as written
	write("book/intro/_index.md", "# Intro\n\nSome intro text.\n")
	// planned-only chapter is empty
	write("other/plan/_index.md", "---\ntitle: Plan\nplanned: [One, Two]\n---\n")

	tr, err := Load(dir, "/")
	if err != nil {
		t.Fatal(err)
	}
	for rel, want := range map[string]bool{"book/written": true, "book/empty": false, "book/intro": true, "other/plan": false} {
		if got := tr.ByRel[rel].Written(); got != want {
			t.Errorf("%s written = %v, want %v", rel, got, want)
		}
	}
	if got := len(tr.ByRel["book/written"].OutstandingPlanned()); got != 1 { // Gamma
		t.Errorf("written chapter outstanding ideas = %d, want 1", got)
	}
	if got := len(tr.ByRel["book/empty"].OutstandingPlanned()); got != 1 { // Beta has only a stub page
		t.Errorf("empty chapter outstanding ideas = %d, want 1", got)
	}
	r, book := tr.Root, tr.ByRel["book"]
	if book.IsChapter() || book.ChapterCount() != 3 || book.WrittenChapters() != 2 || book.Percent() != 66 {
		t.Errorf("book: chapter=%v chapters=%d written=%d pct=%d", book.IsChapter(), book.ChapterCount(), book.WrittenChapters(), book.Percent())
	}
	if r.ChapterCount() != 4 || r.WrittenChapters() != 2 || r.EmptyChapters() != 2 || r.Percent() != 50 || r.DoneCount() != 1 {
		t.Errorf("root: chapters=%d written=%d empty=%d pct=%d done=%d", r.ChapterCount(), r.WrittenChapters(), r.EmptyChapters(), r.Percent(), r.DoneCount())
	}
}
