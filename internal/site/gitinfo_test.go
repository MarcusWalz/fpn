package site

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/marcuswalz/fpn/web"
)

func TestUpdatedFromGit(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	dir := t.TempDir()
	run := func(env []string, args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), env...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	write := func(rel, s string) {
		p := filepath.Join(dir, "content", rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte(s), 0o644)
	}
	who := func(name, date string) []string {
		return []string{"GIT_AUTHOR_NAME=" + name, "GIT_AUTHOR_EMAIL=a@example.com", "GIT_AUTHOR_DATE=" + date,
			"GIT_COMMITTER_NAME=" + name, "GIT_COMMITTER_EMAIL=a@example.com", "GIT_COMMITTER_DATE=" + date}
	}
	run(nil, "init", "-q")
	write("book/chap/a.md", "# A\n\none\n")
	write("book/chap/b.md", "# B\n\none\n")
	run(nil, "add", ".")
	run(who("Ada Lovelace", "2026-01-02T10:00:00Z"), "commit", "-q", "-m", "first")
	write("book/chap/b.md", "# B\n\ntwo\n")
	run(nil, "add", ".")
	run(who("Chloe", "2026-03-04T10:00:00Z"), "commit", "-q", "-m", "second")
	write("book/chap/a.md", "# A\n\nlocal edit\n") // uncommitted

	u := loadUpdated(filepath.Join(dir, "content"))
	if b := u["book/chap/b.md"]; !b.Committed || b.Author != "Chloe" || b.DateText() != "4 Mar 2026" {
		t.Errorf("b.md = %+v", b)
	}
	if a := u["book/chap/a.md"]; a.Committed || a.Author != "" {
		t.Errorf("a.md should be uncommitted: %+v", a)
	}

	out := filepath.Join(dir, "public")
	if _, err := Build(Config{ContentDir: filepath.Join(dir, "content"), OutDir: out, Base: "/", Web: web.FS}); err != nil {
		t.Fatal(err)
	}
	html, _ := os.ReadFile(filepath.Join(out, "book/chap/b/index.html"))
	if !strings.Contains(string(html), `Updated <time datetime="2026-03-04">4 Mar 2026</time></p>`) || strings.Contains(string(html), "Chloe") {
		t.Errorf("b page should show the date only, without the author")
	}
	html, _ = os.ReadFile(filepath.Join(out, "book/chap/a/index.html"))
	if !strings.Contains(string(html), "not saved to git yet") {
		t.Errorf("a page should say not saved to git yet")
	}
}
