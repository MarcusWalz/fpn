package site

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/marcuswalz/fpn/internal/content"
)

// Files the editor may upload into content/ (besides Markdown).
var uploadExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".avif": true, ".svg": true,
	".pdf": true, ".mp4": true, ".webm": true, ".csv": true, ".txt": true, ".md": true,
}

const maxUpload = 25 << 20

// cleanAny validates a content-relative path (file or folder, any type).
// The empty string means the content root and is allowed only if root is true.
func cleanAny(p string, root bool) (string, error) {
	for _, seg := range strings.Split(strings.ReplaceAll(p, "\\", "/"), "/") {
		if seg == ".." {
			return "", errors.New("paths may not contain ..")
		}
	}
	p = strings.TrimPrefix(path.Clean("/"+strings.ReplaceAll(p, "\\", "/")), "/")
	if p == "." {
		p = ""
	}
	if p == "" && !root {
		return "", errors.New("path required")
	}
	for _, seg := range strings.Split(p, "/") {
		if strings.HasPrefix(seg, ".") {
			return "", errors.New("hidden paths are not allowed")
		}
	}
	return p, nil
}

func jsonOut(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// ---- tree ----

type treeEntry struct {
	Name     string       `json:"name"`
	Path     string       `json:"path"`
	Dir      bool         `json:"dir,omitempty"`
	Title    string       `json:"title,omitempty"`
	Stub     bool         `json:"stub,omitempty"`
	Children []*treeEntry `json:"children,omitempty"`
}

func (a *editorAPI) tree(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	var titles *content.Tree
	if p := a.preview(); p != nil {
		titles = p.Tree()
	}
	var walk func(abs, rel string) *treeEntry
	walk = func(abs, rel string) *treeEntry {
		e := &treeEntry{Name: path.Base(rel), Path: rel, Dir: true}
		if rel == "" {
			e.Name = "content"
		}
		if titles != nil {
			if n, ok := titles.ByRel[rel]; ok {
				e.Title = n.Title
			}
		}
		entries, _ := os.ReadDir(abs)
		for _, de := range entries {
			name := de.Name()
			if strings.HasPrefix(name, ".") {
				continue
			}
			crel := path.Join(rel, name)
			if de.IsDir() {
				e.Children = append(e.Children, walk(filepath.Join(abs, name), crel))
				continue
			}
			c := &treeEntry{Name: name, Path: crel}
			if titles != nil {
				if n, ok := titles.ByRel[crel]; ok && !n.IsSection {
					c.Title, c.Stub = n.Title, n.Stub
				}
			}
			e.Children = append(e.Children, c)
		}
		sort.SliceStable(e.Children, func(i, j int) bool {
			x, y := e.Children[i], e.Children[j]
			if x.Dir != y.Dir {
				return x.Dir
			}
			if (x.Name == "_index.md") != (y.Name == "_index.md") {
				return x.Name == "_index.md"
			}
			return strings.ToLower(x.Name) < strings.ToLower(y.Name)
		})
		return e
	}
	jsonOut(w, walk(a.cfg.ContentDir, ""))
}

// ---- create folder ----

func (a *editorAPI) mkdir(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || !post(w, r) {
		return
	}
	rel, err := cleanAny(r.URL.Query().Get("path"), false)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	abs := a.abs(rel)
	if _, err := os.Stat(abs); err == nil {
		http.Error(w, "already exists", http.StatusConflict)
		return
	}
	if st, err := os.Stat(filepath.Dir(abs)); err != nil || !st.IsDir() {
		http.Error(w, "parent folder doesn't exist", http.StatusBadRequest)
		return
	}
	if err := os.Mkdir(abs, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// An _index.md makes the folder a section (book/chapter) right away.
	title := strings.TrimSpace(r.URL.Query().Get("title"))
	if title == "" {
		title = content.Prettify(path.Base(rel))
	}
	idx := fmt.Sprintf("---\ntitle: %s\n---\n", yamlScalar(title))
	if err := os.WriteFile(filepath.Join(abs, "_index.md"), []byte(idx), 0o644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOut(w, map[string]string{"path": rel, "index": path.Join(rel, "_index.md")})
}

// yamlScalar quotes a string for YAML when needed.
func yamlScalar(s string) string {
	if strings.ContainsAny(s, ":#'\"{}[],&*!|>%@`") || strings.TrimSpace(s) != s {
		return "'" + strings.ReplaceAll(s, "'", "''") + "'"
	}
	return s
}

// ---- move / rename ----

func (a *editorAPI) move(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || !post(w, r) {
		return
	}
	from, err1 := cleanAny(r.URL.Query().Get("from"), false)
	to, err2 := cleanAny(r.URL.Query().Get("to"), false)
	if err := errors.Join(err1, err2); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if from == to {
		jsonOut(w, map[string]string{"path": to})
		return
	}
	if strings.HasPrefix(to+"/", from+"/") {
		http.Error(w, "can't move a folder into itself", http.StatusBadRequest)
		return
	}
	src, dst := a.abs(from), a.abs(to)
	st, err := os.Stat(src)
	if err != nil {
		http.Error(w, "source doesn't exist", http.StatusNotFound)
		return
	}
	if !st.IsDir() && path.Ext(from) != path.Ext(to) {
		http.Error(w, "keep the same file extension", http.StatusBadRequest)
		return
	}
	if _, err := os.Stat(dst); err == nil {
		http.Error(w, "something with that name already exists there", http.StatusConflict)
		return
	}
	if pst, err := os.Stat(filepath.Dir(dst)); err != nil || !pst.IsDir() {
		http.Error(w, "destination folder doesn't exist", http.StatusBadRequest)
		return
	}
	if err := os.Rename(src, dst); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOut(w, map[string]string{"path": to})
}

// ---- delete ----

func (a *editorAPI) remove(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || !post(w, r) {
		return
	}
	rel, err := cleanAny(r.URL.Query().Get("path"), false)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	abs := a.abs(rel)
	st, err := os.Stat(abs)
	if err != nil {
		http.Error(w, "doesn't exist", http.StatusNotFound)
		return
	}
	if st.IsDir() {
		// Only folders that are empty, or hold nothing but an _index.md.
		entries, _ := os.ReadDir(abs)
		for _, e := range entries {
			if e.Name() != "_index.md" {
				http.Error(w, "folder isn't empty; move or delete its files first", http.StatusConflict)
				return
			}
		}
		err = os.RemoveAll(abs)
	} else {
		err = os.Remove(abs)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- upload ----

// upload stores the request body as dir/name, picking a free name if taken.
func (a *editorAPI) upload(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || !post(w, r) {
		return
	}
	dir, err := cleanAny(r.URL.Query().Get("dir"), true)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	name := sanitizeName(r.URL.Query().Get("name"))
	ext := strings.ToLower(path.Ext(name))
	if name == "" || !uploadExts[ext] {
		http.Error(w, "unsupported file type "+ext, http.StatusBadRequest)
		return
	}
	absDir := a.abs(dir)
	if r.URL.Query().Get("mkdir") == "1" {
		if err := os.MkdirAll(absDir, 0o755); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if st, err := os.Stat(absDir); err != nil || !st.IsDir() {
		http.Error(w, "folder doesn't exist", http.StatusBadRequest)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxUpload+1))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if len(data) > maxUpload {
		http.Error(w, "file too large (max 25 MB)", http.StatusRequestEntityTooLarge)
		return
	}
	base := strings.TrimSuffix(name, path.Ext(name))
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(absDir, name)); errors.Is(err, fs.ErrNotExist) {
			break
		}
		name = fmt.Sprintf("%s-%d%s", base, i, path.Ext(name))
	}
	if err := os.WriteFile(filepath.Join(absDir, name), data, 0o644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOut(w, map[string]string{"path": path.Join(dir, name), "name": name})
}

// sanitizeName makes an uploaded file name safe and URL-friendly.
func sanitizeName(n string) string {
	n = path.Base(strings.ReplaceAll(n, "\\", "/"))
	ext := strings.ToLower(path.Ext(n))
	stem := content.Slugify(strings.TrimSuffix(n, path.Ext(n)))
	if stem == "" || n == "." || n == "/" {
		return ""
	}
	return stem + ext
}

// ---- git ----

// gitRoot returns the repository root and the content dir relative to it.
func (a *editorAPI) gitRoot() (root, contentRel string, ok bool) {
	return gitRootFor(a.cfg.ContentDir)
}

// gitRootFor returns the repository root containing dir, and dir relative to it.
func gitRootFor(dir string) (root, contentRel string, ok bool) {
	absContent, err := filepath.Abs(dir)
	if err != nil {
		return "", "", false
	}
	out, err := exec.Command("git", "-C", absContent, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return "", "", false
	}
	root = strings.TrimSpace(string(out))
	if real, err := filepath.EvalSymlinks(absContent); err == nil {
		absContent = real
	}
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	rel, err := filepath.Rel(root, absContent)
	if err != nil {
		return "", "", false
	}
	return root, filepath.ToSlash(rel), true
}

// gitStatus maps content-relative paths to a short status: M, A, D, R or ?.
func (a *editorAPI) gitStatus(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	root, crel, ok := a.gitRoot()
	if !ok {
		jsonOut(w, map[string]any{"git": false, "files": map[string]string{}})
		return
	}
	out, err := exec.Command("git", "-C", root, "status", "--porcelain=v1", "-z", "-uall", "--", crel).Output()
	if err != nil {
		http.Error(w, "git status failed", http.StatusInternalServerError)
		return
	}
	files := map[string]string{}
	recs := bytes.Split(out, []byte{0})
	for i := 0; i < len(recs); i++ {
		rec := string(recs[i])
		if len(rec) < 4 {
			continue
		}
		xy, p := rec[:2], rec[3:]
		code := strings.TrimSpace(xy)
		switch {
		case xy == "??":
			code = "?"
		case strings.ContainsRune(xy, 'R'):
			code = "R"
			i++ // the next record is the rename source
		case strings.ContainsRune(xy, 'D'):
			code = "D"
		case strings.ContainsRune(xy, 'A'):
			code = "A"
		default:
			code = "M"
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(p, crel), "/")
		if crel == "." {
			rel = p
		}
		files[rel] = code
	}
	jsonOut(w, map[string]any{"git": true, "files": files})
}

// gitShow returns a file's contents at HEAD (404 if it isn't committed).
func (a *editorAPI) gitShow(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	rel, err := cleanAny(r.URL.Query().Get("path"), false)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	root, crel, ok := a.gitRoot()
	if !ok {
		http.Error(w, "not a git repository", http.StatusNotFound)
		return
	}
	spec := "HEAD:" + path.Join(crel, rel)
	out, err := exec.Command("git", "-C", root, "show", spec).Output()
	if err != nil {
		http.Error(w, "not in the last commit", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(out)
}

// raw serves any content file (e.g. images) for the tree's previews.
func (a *editorAPI) raw(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	rel, err := cleanAny(r.URL.Query().Get("path"), false)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, a.abs(rel))
}

func post(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	return true
}

func (a *editorAPI) mountFiles(mux *http.ServeMux) {
	mux.HandleFunc("/__api/tree", a.tree)
	mux.HandleFunc("/__api/mkdir", a.mkdir)
	mux.HandleFunc("/__api/move", a.move)
	mux.HandleFunc("/__api/delete", a.remove)
	mux.HandleFunc("/__api/upload", a.upload)
	mux.HandleFunc("/__api/git/status", a.gitStatus)
	mux.HandleFunc("/__api/git/show", a.gitShow)
	mux.HandleFunc("/__api/raw", a.raw)
	mux.HandleFunc("/__api/problems", a.problemsHandler)
	mux.HandleFunc("/__api/refs", a.refs)
	mux.HandleFunc("/__api/critique", a.critique)
}

// ---- problems (all build warnings, for batch fixing) ----

// Problem is one build warning, split into the file and what's wrong.
type Problem struct {
	Path    string `json:"path"` // content-relative source file ("" if unknown)
	Message string `json:"message"`
	Find    string `json:"find,omitempty"` // text to highlight in the file, e.g. the broken link target
}

var quoted = regexp.MustCompile(`"([^"]+)"`)

// parseProblems turns "path: message" warnings into Problems, sorted by path.
func parseProblems(warnings []string) []Problem {
	out := make([]Problem, 0, len(warnings))
	for _, w := range warnings {
		p := Problem{Message: w}
		if i := strings.Index(w, ": "); i > 0 && !strings.ContainsAny(w[:i], " ()") {
			p.Path, p.Message = w[:i], w[i+2:]
		}
		if m := quoted.FindStringSubmatch(p.Message); m != nil {
			p.Find = m[1]
		}
		out = append(out, p)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func (a *editorAPI) problemsHandler(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	var ws []string
	if a.problems != nil {
		ws = a.problems()
	}
	jsonOut(w, parseProblems(ws))
}

// refs lists citation keys from the references library, for the editor's
// image-source helper (autocomplete).
func (a *editorAPI) refs(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	type ref struct {
		Key   string `json:"key"`
		Label string `json:"label"`
	}
	out := []ref{}
	if p := a.preview(); p != nil {
		p.mu.Lock()
		lib := p.b.lib
		p.mu.Unlock()
		for k, it := range lib {
			label := it.Title
			if len(it.Author) > 0 {
				label = it.Author[0].short() + " " + it.Issued.year() + " · " + label
			}
			if len(label) > 90 {
				label = label[:87] + "…"
			}
			out = append(out, ref{Key: k, Label: label})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	}
	jsonOut(w, out)
}
