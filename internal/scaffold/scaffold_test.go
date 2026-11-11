package scaffold

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestScaffoldPlannedAndIdempotent(t *testing.T) {
	dir := t.TempDir()
	tax := filepath.Join(dir, "tax.json")
	os.WriteFile(tax, []byte(`[{"title":"Book One","children":[{"title":"Chap","href":"B/C/","children":[{"title":"Topic: A","href":"B/C/A.htm"},{"title":"Topic: A"}]}]}]`), 0o644)
	out := filepath.Join(dir, "content")

	res, err := FromFile(tax, out, Options{})
	if err != nil || res.Sections != 2 || res.Planned != 2 || res.Pages != 0 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	idx, _ := os.ReadFile(filepath.Join(out, "book-one", "chap", "_index.md"))
	if !strings.Contains(string(idx), "title: 'Topic: A'") || !strings.Contains(string(idx), "legacy: B/C/A.htm") {
		t.Fatalf("index:\n%s", idx)
	}
	res, _ = FromFile(tax, out, Options{})
	if res.Sections != 0 || res.Skipped != 2 {
		t.Fatalf("re-run should skip existing files: %+v", res)
	}

	res, err = FromFile(tax, filepath.Join(dir, "pages"), Options{Pages: true})
	if err != nil || res.Pages != 2 {
		t.Fatalf("pages mode: %+v %v", res, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "pages", "book-one", "chap", "topic-a-2.md")); err != nil {
		t.Fatal("duplicate title should get a -2 suffix")
	}
}
