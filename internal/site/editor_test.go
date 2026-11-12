package site

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/marcuswalz/fpn/web"
)

func TestCleanPaths(t *testing.T) {
	for _, bad := range []string{"../x.md", "a/../../x.md", ".git/config.md", "a/.hidden/x.md", "x.sh", ""} {
		if _, err := cleanRel(bad); err == nil {
			t.Errorf("cleanRel(%q) should fail", bad)
		}
	}
	if p, err := cleanRel("/book/x.md"); err != nil || p != "book/x.md" {
		t.Errorf("cleanRel = %q, %v", p, err)
	}
	if _, err := cleanAny("../../evil.png", false); err == nil {
		t.Error("cleanAny should reject ..")
	}
	if p, err := cleanAny("", true); err != nil || p != "" {
		t.Error("cleanAny should allow the root when asked")
	}
	if got := sanitizeName("My Pic (1).PNG"); got != "my-pic-1.png" {
		t.Errorf("sanitizeName = %q", got)
	}
}

func TestEditorAPIGuardsAndFiles(t *testing.T) {
	dir := t.TempDir()
	content := filepath.Join(dir, "content")
	os.MkdirAll(filepath.Join(content, "book"), 0o755)
	os.WriteFile(filepath.Join(content, "book", "_index.md"), []byte("# Book\n"), 0o644)
	cfg := Config{ContentDir: content, Base: "/", Web: web.FS}
	pv, err := NewPreviewer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	(&editorAPI{cfg: cfg, preview: func() *Previewer { return pv }}).mount(mux)

	do := func(method, url, body string, hdr map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, url, strings.NewReader(body))
		r.Host = "localhost:1313"
		for k, v := range hdr {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	ed := map[string]string{"X-FPN-Editor": "1"}

	if w := do("PUT", "/__api/file?path=book/new.md", "x", nil); w.Code != 403 {
		t.Errorf("write without editor header = %d, want 403", w.Code)
	}
	if w := do("PUT", "/__api/file?path=book/new.md", "x", map[string]string{"X-FPN-Editor": "1", "Origin": "https://evil.example"}); w.Code != 403 {
		t.Errorf("cross-origin write = %d, want 403", w.Code)
	}
	if w := do("PUT", "/__api/file?path=book/new.md", "# New\n\nHi\n", ed); w.Code != 204 {
		t.Fatalf("create = %d %s", w.Code, w.Body)
	}
	if w := do("POST", "/__api/mkdir?path=book/chap&title=My%20Chap", "", ed); w.Code != 200 {
		t.Fatalf("mkdir = %d %s", w.Code, w.Body)
	}
	if b, _ := os.ReadFile(filepath.Join(content, "book", "chap", "_index.md")); !strings.Contains(string(b), "title: My Chap") {
		t.Errorf("mkdir index = %q", b)
	}
	if w := do("POST", "/__api/upload?dir=book/chap/images&name=A%20B.png&mkdir=1", "png", ed); w.Code != 200 || !strings.Contains(w.Body.String(), "a-b.png") {
		t.Errorf("upload = %d %s", w.Code, w.Body)
	}
	if w := do("POST", "/__api/move?from=book/new.md&to=book/chap/new.md", "", ed); w.Code != 200 {
		t.Errorf("move = %d %s", w.Code, w.Body)
	}
	if w := do("POST", "/__api/delete?path=book/chap", "", ed); w.Code != 409 {
		t.Errorf("delete non-empty folder = %d, want 409", w.Code)
	}
	if w := do("POST", "/__api/preview?path=book/chap/new.md", "---\ntitle: Live\n---\n\n[x](missing.md)\n", ed); w.Code != 200 ||
		!strings.Contains(w.Body.String(), "Live") || !strings.Contains(w.Body.String(), "broken link") {
		t.Errorf("preview = %d %s", w.Code, w.Body)
	}
}

func TestParseProblems(t *testing.T) {
	ps := parseProblems([]string{
		`z/b.md: broken link "../x/oops.md"`,
		`a/_index.md: front matter: yaml: line 3: could not find expected ':'`,
		`(build): template error`,
	})
	if ps[0].Path != "" || ps[1].Path != "a/_index.md" || ps[2].Path != "z/b.md" {
		t.Fatalf("paths/sort wrong: %+v", ps)
	}
	if ps[2].Message != `broken link "../x/oops.md"` || ps[2].Find != "../x/oops.md" {
		t.Errorf("broken link parse: %+v", ps[2])
	}
	if ps[1].Find != "" && ps[1].Find != ":" {
		t.Errorf("front matter find: %+v", ps[1])
	}
}
