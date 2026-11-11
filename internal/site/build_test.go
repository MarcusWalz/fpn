package site

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/marcuswalz/fpn/web"
)

func TestBuild(t *testing.T) {
	dir := t.TempDir()
	content := filepath.Join(dir, "content")
	write := func(rel, s string) {
		p := filepath.Join(content, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(s), 0o644)
	}
	write("cardio/htn/overview.md", "# Overview\n\n## A\n\nsee [causes](causes.md#x) and [bad](nope.md)\n\n## B\n")
	write("cardio/htn/causes.md", "# Causes\n")

	out := filepath.Join(dir, "public")
	res, err := Build(Config{ContentDir: content, OutDir: out, Base: "/nb", Web: web.FS})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Warnings) != 1 || !strings.Contains(res.Warnings[0], "nope.md") {
		t.Fatalf("warnings = %v", res.Warnings)
	}
	html, err := os.ReadFile(filepath.Join(out, "cardio/htn/overview/index.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`href="/nb/cardio/htn/causes/#x"`, `href="#a"`, `<h1 class="page-title">Overview</h1>`} {
		if !strings.Contains(string(html), want) {
			t.Errorf("overview missing %s", want)
		}
	}
	if strings.Count(string(html), ">Overview</h1>") != 1 {
		t.Errorf("title H1 should not be duplicated")
	}
	for _, f := range []string{"index.html", "cardio/index.html", "sitemap/index.html", "404.html", "pages.json", "static/style.css"} {
		if _, err := os.Stat(filepath.Join(out, f)); err != nil {
			t.Errorf("missing %s", f)
		}
	}
}

func TestSafeOutDir(t *testing.T) {
	if err := safeOutDir(".", "content"); err == nil {
		t.Error("expected refusal for cwd")
	}
	if err := safeOutDir("content/x", "content"); err == nil {
		t.Error("expected refusal for out inside content")
	}
}
