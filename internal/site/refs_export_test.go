package site

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestExportCited(t *testing.T) {
	dir := t.TempDir()
	content, refs := filepath.Join(dir, "content"), filepath.Join(dir, "references")
	os.MkdirAll(filepath.Join(content, "book", "chap"), 0o755)
	os.MkdirAll(refs, 0o755)
	// A "private" library with an extra item nobody cites and a field the
	// formatter doesn't use (it must survive the copy).
	lib := `[
 {"id":"whelton2018","type":"article-journal","title":"BP guideline","note":"keep me"},
 {"id":"harrison","type":"book","title":"Harrison's"},
 {"id":"private","type":"document","title":"Where to fish"}
]`
	os.WriteFile(filepath.Join(refs, "zotero.json"), []byte(lib), 0o644)
	page := "# P\n\nBP [@whelton2018]. Book [@harrison, p. 12; @whelton2018]. Typo [@nope].\n" +
		"A link [@someone](https://example.org) is not a citation.\n\n" +
		"```\n[@private] inside a code block\n```\n"
	os.WriteFile(filepath.Join(content, "book", "chap", "p.md"), []byte(page), 0o644)

	out := filepath.Join(refs, "cited.json")
	res, err := ExportCited(content, refs, out)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"harrison", "whelton2018"}; !reflect.DeepEqual(res.Keys, want) {
		t.Errorf("keys = %v, want %v", res.Keys, want)
	}
	if want := []string{"nope"}; !reflect.DeepEqual(res.Missing, want) {
		t.Errorf("missing = %v, want %v", res.Missing, want)
	}

	var items []map[string]any
	data, _ := os.ReadFile(out)
	if err := json.Unmarshal(data, &items); err != nil {
		t.Fatalf("output is not a JSON list: %v\n%s", err, data)
	}
	if len(items) != 2 || items[0]["id"] != "harrison" || items[1]["id"] != "whelton2018" {
		t.Fatalf("unexpected items: %s", data)
	}
	if items[1]["note"] != "keep me" {
		t.Errorf("extra CSL fields were dropped: %s", data)
	}

	if !res.Changed {
		t.Error("first run should report Changed")
	}

	// Running again with the output file inside refs gives the same result
	// and doesn't touch the file (fpn serve relies on this to avoid a loop).
	st1, _ := os.Stat(out)
	again, _ := ExportCited(content, refs, out)
	data2, _ := os.ReadFile(out)
	st2, _ := os.Stat(out)
	if !reflect.DeepEqual(again.Keys, res.Keys) || string(data2) != string(data) {
		t.Errorf("second run changed the output:\n%s", data2)
	}
	if again.Changed || !st1.ModTime().Equal(st2.ModTime()) {
		t.Error("second run rewrote an unchanged file")
	}

	// With only cited.json (as on GitHub), the site still resolves every citation.
	os.Remove(filepath.Join(refs, "zotero.json"))
	full, _ := loadLibrary(refs)
	for _, k := range res.Keys {
		if full[k] == nil {
			t.Errorf("%s missing from cited.json alone", k)
		}
	}
}
