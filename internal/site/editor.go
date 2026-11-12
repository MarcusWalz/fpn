package site

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/marcuswalz/fpn/internal/content"
)

// Previewer renders single pages from unsaved Markdown, for the dev editor.
type Previewer struct {
	mu sync.Mutex
	b  *builder
}

// NewPreviewer loads the content tree and templates once; create a new one
// whenever the content changes on disk.
func NewPreviewer(cfg Config) (*Previewer, error) {
	cfg.Base = NormalizeBase(cfg.Base)
	tree, err := content.Load(cfg.ContentDir, cfg.Base)
	if err != nil {
		return nil, err
	}
	tpl, err := loadTemplates(cfg.Web, cfg.Base)
	if err != nil {
		return nil, err
	}
	sd := newSiteData(tree, cfg, time.Now())
	sd.Dev = false // no live-reload script or edit button inside the preview
	b := &builder{cfg: cfg, tree: tree, md: newMarkdown(), tpl: tpl, site: sd, srcLines: true}
	b.lib, _ = loadLibrary(cfg.RefsDir)
	b.backlinks = b.buildBacklinks()
	b.updated = loadUpdated(cfg.ContentDir)
	return &Previewer{b: b}, nil
}

// Tree returns the current content snapshot.
func (p *Previewer) Tree() *content.Tree {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.b.tree
}

// reload re-reads the content tree (e.g. a folder was just created and the
// watcher hasn't rebuilt yet).
func (p *Previewer) reload() error {
	fresh, err := NewPreviewer(p.b.cfg)
	if err != nil {
		return err
	}
	p.b = fresh.b
	return nil
}

// Render returns the HTML page for source file rel (e.g. "book/chap/x.md" or
// "book/_index.md") as if its contents were raw. The file need not exist yet,
// but its folder must. It also returns the page's URL.
func (p *Previewer) Render(rel string, raw []byte) ([]byte, string, []string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	n, err := p.nodeFor(rel)
	if err != nil {
		// The folder may be newer than our snapshot of the tree.
		if st, serr := os.Stat(filepath.Join(p.b.cfg.ContentDir, filepath.FromSlash(path.Dir(rel)))); serr == nil && st.IsDir() {
			if rerr := p.reload(); rerr == nil {
				n, err = p.nodeFor(rel)
			}
		}
	}
	if err != nil {
		return nil, "", nil, err
	}
	var warns []string
	if err := n.SetSource(raw, rel); err != nil {
		warns = append(warns, "front matter: "+err.Error())
	}
	// Lines before the body (front matter), so data-src-line matches the editor.
	norm := strings.ReplaceAll(strings.TrimPrefix(string(raw), "\xef\xbb\xbf"), "\r\n", "\n")
	p.b.srcLineOffset = strings.Count(norm, "\n") - strings.Count(string(n.Body), "\n")
	kind, d, w := p.b.pageData(n)
	warns = append(warns, w...)
	var buf bytes.Buffer
	if err := p.b.tpl[kind].ExecuteTemplate(&buf, "base", d); err != nil {
		return nil, "", warns, err
	}
	return buf.Bytes(), n.URL, warns, nil
}

// nodeFor returns a private copy of the node for rel, or a fresh page node
// if the file doesn't exist yet.
// Callers must hold p.mu.
func (p *Previewer) nodeFor(rel string) (*content.Node, error) {
	t := p.b.tree
	if path.Base(rel) == "_index.md" {
		dir := path.Dir(rel)
		if dir == "." {
			dir = ""
		}
		sec, ok := t.ByRel[dir]
		if !ok {
			return nil, fmt.Errorf("no folder %q", dir)
		}
		c := *sec
		return &c, nil
	}
	if n, ok := t.ByRel[rel]; ok && !n.IsSection {
		c := *n
		return &c, nil
	}
	dir := path.Dir(rel)
	if dir == "." {
		dir = ""
	}
	parent, ok := t.ByRel[dir]
	if !ok || !parent.IsSection {
		return nil, fmt.Errorf("folder %q doesn't exist", dir)
	}
	slug := content.Slugify(strings.TrimSuffix(path.Base(rel), path.Ext(rel)))
	if parent.Slug != "" {
		slug = parent.Slug + "/" + slug
	}
	return &content.Node{
		Rel: rel, Slug: slug, URL: p.b.cfg.Base + slug + "/",
		Parent: parent, Depth: parent.Depth + 1, Meta: map[string]any{},
	}, nil
}

// ---- HTTP API (mounted by Serve) ----

type editorAPI struct {
	cfg      Config
	preview  func() *Previewer
	problems func() []string // warnings from the latest full build
}

// cleanRel validates an editor path: a .md file inside the content dir.
func cleanRel(p string) (string, error) {
	for _, seg := range strings.Split(strings.ReplaceAll(p, "\\", "/"), "/") {
		if seg == ".." {
			return "", errors.New("paths may not contain ..")
		}
	}
	p = strings.TrimPrefix(path.Clean("/"+strings.ReplaceAll(p, "\\", "/")), "/")
	if p == "" || p == "." || !strings.EqualFold(path.Ext(p), ".md") {
		return "", errors.New("path must be a .md file inside content/")
	}
	for _, seg := range strings.Split(p, "/") {
		if strings.HasPrefix(seg, ".") {
			return "", errors.New("hidden paths are not editable")
		}
	}
	return p, nil
}

// guard rejects cross-site and DNS-rebinding requests: the editor API is
// for the local browser tab only.
func guard(w http.ResponseWriter, r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
	}
	local := host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
	if !local {
		http.Error(w, "editor is only available on localhost", http.StatusForbidden)
		return false
	}
	if o := r.Header.Get("Origin"); o != "" && !strings.HasSuffix(o, "://"+r.Host) {
		http.Error(w, "cross-origin request refused", http.StatusForbidden)
		return false
	}
	if r.Method != http.MethodGet && r.Header.Get("X-FPN-Editor") != "1" {
		http.Error(w, "missing editor header", http.StatusForbidden)
		return false
	}
	return true
}

func (a *editorAPI) abs(rel string) string {
	return filepath.Join(a.cfg.ContentDir, filepath.FromSlash(rel))
}

func mtimeOf(fi os.FileInfo) string { return strconv.FormatInt(fi.ModTime().UnixNano(), 10) }

func (a *editorAPI) file(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	rel, err := cleanRel(r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	p := a.abs(rel)
	switch r.Method {
	case http.MethodGet:
		fi, err := os.Stat(p)
		if errors.Is(err, fs.ErrNotExist) {
			http.Error(w, "new file", http.StatusNotFound)
			return
		} else if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		data, err := os.ReadFile(p)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("X-FPN-Mtime", mtimeOf(fi))
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Write(data)
	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if fi, err := os.Stat(p); err == nil {
			if want := r.Header.Get("X-FPN-Mtime"); want != "" && want != mtimeOf(fi) {
				http.Error(w, "file changed on disk since it was opened", http.StatusConflict)
				return
			}
		} else if st, err := os.Stat(filepath.Dir(p)); err != nil || !st.IsDir() {
			http.Error(w, "folder doesn't exist", http.StatusBadRequest)
			return
		}
		if err := os.WriteFile(p, body, 0o644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		fi, _ := os.Stat(p)
		w.Header().Set("X-FPN-Mtime", mtimeOf(fi))
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *editorAPI) previewHandler(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rel, err := cleanRel(r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	p := a.preview()
	if p == nil {
		http.Error(w, "preview not ready", http.StatusServiceUnavailable)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	html, url, warns, err := p.Render(rel, raw)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"html": string(html), "url": url, "warnings": warns})
}

// files lists every editable page and section index for the file switcher.
func (a *editorAPI) files(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	p := a.preview()
	if p == nil {
		http.Error(w, "not ready", http.StatusServiceUnavailable)
		return
	}
	type f struct {
		Path  string `json:"path"`
		Title string `json:"title"`
		URL   string `json:"url"` // lets the preview map a clicked link back to its file
	}
	var out []f
	t := p.Tree()
	for _, s := range t.Sections {
		out = append(out, f{Path: s.SourceRel(), Title: strings.Join(append(s.Trail(), s.Title), " › ") + " (index)", URL: s.URL})
	}
	for _, pg := range t.Pages {
		out = append(out, f{Path: pg.Rel, Title: strings.Join(append(pg.Trail(), pg.Title), " › "), URL: pg.URL})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func (a *editorAPI) static(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/__editor/")
	if name == "" {
		name = "index.html"
	}
	data, err := fs.ReadFile(a.cfg.Web, "editor/"+path.Clean(name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	switch ext := path.Ext(name); ext {
	case ".html":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case ".js":
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	case ".css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	default:
		if t := mime.TypeByExtension(ext); t != "" {
			w.Header().Set("Content-Type", t)
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Write(data)
}

func (a *editorAPI) mount(mux *http.ServeMux) {
	mux.HandleFunc("/__editor/", a.static)
	mux.HandleFunc("/__api/file", a.file)
	mux.HandleFunc("/__api/preview", a.previewHandler)
	mux.HandleFunc("/__api/files", a.files)
	a.mountFiles(mux)
}
