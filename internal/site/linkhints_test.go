package site

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/marcuswalz/fpn/internal/content"
)

func TestLinkSuggestions(t *testing.T) {
	dir := t.TempDir()
	write := func(rel, s string) {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(s), 0o644)
	}
	write("endo/dm/diabetes.md", "---\ntitle: Diabetes Mellitus\n---\n\nRisk in PMOS and hypertension. pmos lowercase.\n\n`Dyslipidemia` in code.\n")
	write("endo/meta/pmos.md", "---\ntitle: Polyendocrine Metabolic Ovarian Syndrome\naliases: [PMOS]\n---\n\nSee [DM](../dm/diabetes.md); diabetes mellitus again.\n")
	write("cardio/htn/hypertension.md", "---\ntitle: Hypertension\naliases: []\n---\n\nText.\n")
	write("cardio/lipid/dyslipidemia.md", "---\ntitle: Dyslipidemia\n---\n\nText.\n")
	tree, err := content.Load(dir, "/")
	if err != nil {
		t.Fatal(err)
	}
	got := linkSuggestions(tree)
	var lines []string
	for _, p := range got {
		lines = append(lines, p.Path+" | "+p.Find+" | "+p.Message)
	}
	all := strings.Join(lines, "\n")
	for _, want := range []string{
		`endo/dm/diabetes.md | PMOS | mentions "PMOS" — click to link it to Polyendocrine Metabolic Ovarian Syndrome: [PMOS](../meta/pmos.md)`,
		`endo/dm/diabetes.md | hypertension | mentions "hypertension" — click to link it to Hypertension: [hypertension](../../cardio/htn/hypertension.md)`,
	} {
		if !strings.Contains(all, want) {
			t.Errorf("missing %q in\n%s", want, all)
		}
	}
	if got[0].Replace == "" || !strings.HasPrefix(got[0].Replace, "["+got[0].Find+"](") {
		t.Errorf("replace = %q", got[0].Replace)
	}
	if len(got) != 2 { // pmos page already links to diabetes; code is ignored
		t.Errorf("want 2 suggestions, got:\n%s", all)
	}
}
