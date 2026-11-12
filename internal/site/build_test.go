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

func TestLinkedPagesPanel(t *testing.T) {
	dir := t.TempDir()
	content := filepath.Join(dir, "content")
	write := func(rel, s string) {
		p := filepath.Join(content, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(s), 0o644)
	}
	write("book/a/one.md", "# One\n\nSee [two](two.md), [two again](two.md#x) and [chapter b](../b/_index.md).\n")
	write("book/a/two.md", "# Two\n\nBack to [one](one.md). Self [two](two.md).\n")
	write("book/b/_index.md", "# B\n")
	write("book/b/three.md", "# Three\n\nNo links.\n")

	out := filepath.Join(dir, "public")
	if _, err := Build(Config{ContentDir: content, OutDir: out, Base: "/", Web: web.FS}); err != nil {
		t.Fatal(err)
	}
	read := func(p string) string { b, _ := os.ReadFile(filepath.Join(out, p)); return string(b) }

	one := read("book/a/one/index.html")
	if !strings.Contains(one, `<details class="panel card links-panel"`) || strings.Contains(one, `links-panel" open`) {
		t.Fatal("one: panel missing or not collapsed")
	}
	if !strings.Contains(one, "2 → · ← 1") { // links to two + chapter b (deduped); linked from two
		t.Errorf("one: wrong counts")
	}
	if two := read("book/a/two/index.html"); !strings.Contains(two, "1 → · ← 1") { // self-link ignored
		t.Errorf("two: wrong counts")
	}
	if b := read("book/b/index.html"); !strings.Contains(b, "0 → · ← 1") {
		t.Errorf("chapter b should list its backlink from one")
	}
	if three := read("book/b/three/index.html"); strings.Contains(three, "links-panel") {
		t.Errorf("three has no links; panel should be hidden")
	}
}

func TestLinkGroupsSorted(t *testing.T) {
	dir := t.TempDir()
	content := filepath.Join(dir, "content")
	write := func(rel, s string) {
		p := filepath.Join(content, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(s), 0o644)
	}
	write("zoology/c/zebra.md", "# Zebra\n\nx\n")
	write("zoology/c/aardvark.md", "# Aardvark\n\nx\n")
	write("anatomy/d/knee.md", "# Knee\n\nx\n")
	write("hub.md", "# Hub\n\n[z](zoology/c/zebra.md) [k](anatomy/d/knee.md) [a](zoology/c/aardvark.md)\n")
	out := filepath.Join(dir, "public")
	if _, err := Build(Config{ContentDir: content, OutDir: out, Base: "/", Web: web.FS}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(out, "hub", "index.html"))
	h := string(b)
	order := []string{">Anatomy<", ">Knee<", ">Zoology<", ">Aardvark<", ">Zebra<"}
	last := -1
	for _, s := range order {
		i := strings.Index(h[strings.Index(h, "links-panel"):], s)
		if i < 0 || i < last {
			t.Fatalf("%s out of order (books A→Z, then pages A→Z)", s)
		}
		last = i
	}
}
