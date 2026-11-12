package site

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Updated says when a source file last changed and who changed it.
type Updated struct {
	Date      time.Time
	Author    string // git author name; empty when not committed
	Committed bool   // false: changed on disk but not yet committed
}

// DateText formats the date for display, e.g. "11 Nov 2026".
func (u Updated) DateText() string { return u.Date.Format("2 Jan 2006") }

// ISO is the date for <time datetime>.
func (u Updated) ISO() string { return u.Date.Format("2006-01-02") }

// loadUpdated maps content-relative file paths to their last change, using
// one `git log` pass (latest commit per file) plus `git status` for files
// changed since. Outside a git repo it falls back to file modification times.
func loadUpdated(contentDir string) map[string]Updated {
	out := map[string]Updated{}
	root, crel, ok := gitRootFor(contentDir)
	if !ok {
		return out
	}
	toContent := func(repoPath string) (string, bool) {
		if crel == "." {
			return repoPath, true
		}
		if !strings.HasPrefix(repoPath, crel+"/") {
			return "", false
		}
		return strings.TrimPrefix(repoPath, crel+"/"), true
	}

	// Commits newest first; the first time we see a file is its latest change.
	logOut, err := exec.Command("git", "-C", root, "log", "--format=%x1e%an%x1f%aI", "--name-only", "--", crel).Output()
	if err == nil {
		for _, rec := range bytes.Split(logOut, []byte{0x1e}) {
			lines := strings.Split(strings.TrimSpace(string(rec)), "\n")
			if len(lines) < 2 {
				continue
			}
			head := strings.SplitN(lines[0], "\x1f", 2)
			if len(head) != 2 {
				continue
			}
			when, err := time.Parse(time.RFC3339, head[1])
			if err != nil {
				continue
			}
			for _, f := range lines[1:] {
				f = strings.TrimSpace(f)
				if rel, ok := toContent(f); ok && f != "" {
					if _, seen := out[rel]; !seen {
						out[rel] = Updated{Date: when, Author: head[0], Committed: true}
					}
				}
			}
		}
	}

	// Files changed or added since the last commit: use their modification time.
	st, err := exec.Command("git", "-C", root, "status", "--porcelain=v1", "-z", "-uall", "--", crel).Output()
	if err == nil {
		recs := bytes.Split(st, []byte{0})
		for i := 0; i < len(recs); i++ {
			r := string(recs[i])
			if len(r) < 4 {
				continue
			}
			if strings.ContainsRune(r[:2], 'R') {
				i++ // skip rename source
			}
			rel, ok := toContent(r[3:])
			if !ok {
				continue
			}
			if fi, err := os.Stat(filepath.Join(root, filepath.FromSlash(r[3:]))); err == nil {
				out[rel] = Updated{Date: fi.ModTime()}
			}
		}
	}
	return out
}
