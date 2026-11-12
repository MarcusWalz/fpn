// Package site renders a content.Tree into a static website.
package site

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/marcuswalz/fpn/internal/content"
	"github.com/yuin/goldmark"
)

// Config controls a build.
type Config struct {
	ContentDir string
	OutDir     string
	Base       string // URL base path, e.g. "/" or "/notebook/"
	SiteURL    string // optional absolute origin for sitemap.xml, e.g. https://example.org
	Dev        bool   // inject live-reload script
	AllowIndex bool   // let search engines index the site (default: noindex + robots.txt Disallow)
	Web        fs.FS  // contains templates/ and static/
	RefsDir    string // CSL-JSON reference libraries (e.g. Zotero Better BibTeX export); optional
}

// Result summarizes a build.
type Result struct {
	Pages, Sections, Assets int
	Stubs                   int // placeholder pages
	Chapters                int // leaf sections
	WrittenChapters         int // chapters with at least one written page or intro
	Warnings                []string
	Duration                time.Duration
}

// SiteData is shared by every template.
type SiteData struct {
	Title   string
	Base    string
	Root    *content.Node
	Books   []*content.Node
	Dev     bool
	Index   bool
	Version string
	Year    int
}

// PageData is passed to each template render.
type PageData struct {
	Site     *SiteData
	Node     *content.Node
	Title    string
	IsHome   bool
	Content  template.HTML
	TOC      []Heading
	Crumbs   []*content.Node
	Siblings []*content.Node
	Prev     *content.Node
	Next     *content.Node
	EditPath string          // source file, for the dev editor link
	LinksOut []*content.Node // pages this page links to
	LinksIn  []*content.Node // pages linking to this page
	Updated  *Updated        // last change to the source file, if known
}

type builder struct {
	cfg  Config
	tree *content.Tree
	md   goldmark.Markdown
	tpl  map[string]*template.Template
	site *SiteData

	// Editor preview only: tag blocks with data-src-line (1-based line in
	// the source file; srcLineOffset = lines before the body, i.e. front matter).
	srcLines      bool
	srcLineOffset int

	lib       Library                    // citation keys -> references
	backlinks map[string][]*content.Node // target Rel -> pages linking to it
	updated   map[string]Updated         // source Rel -> last change (from git)
}

// NormalizeBase ensures a base path starts and ends with "/".
func NormalizeBase(b string) string {
	b = strings.Trim(strings.TrimSpace(b), "/")
	if b == "" {
		return "/"
	}
	return "/" + b + "/"
}

// Build renders the site described by cfg.
func Build(cfg Config) (*Result, error) {
	start := time.Now()
	cfg.Base = NormalizeBase(cfg.Base)
	if err := safeOutDir(cfg.OutDir, cfg.ContentDir); err != nil {
		return nil, err
	}

	tree, err := content.Load(cfg.ContentDir, cfg.Base)
	if err != nil {
		return nil, fmt.Errorf("load content: %w", err)
	}
	tpl, err := loadTemplates(cfg.Web, cfg.Base)
	if err != nil {
		return nil, err
	}

	b := &builder{cfg: cfg, tree: tree, md: newMarkdown(), tpl: tpl}
	b.site = newSiteData(tree, cfg, start)
	var libWarns []string
	b.lib, libWarns = loadLibrary(cfg.RefsDir)
	b.backlinks = b.buildBacklinks()
	b.updated = loadUpdated(cfg.ContentDir)
	if err := os.RemoveAll(cfg.OutDir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(cfg.OutDir, 0o755); err != nil {
		return nil, err
	}

	res := &Result{Pages: len(tree.Pages), Sections: len(tree.Sections), Assets: len(tree.Assets), Stubs: tree.Root.StubCount(), Chapters: tree.Root.ChapterCount(), WrittenChapters: tree.Root.WrittenChapters()}
	res.Warnings = append(res.Warnings, tree.Warnings...)
	res.Warnings = append(res.Warnings, libWarns...)

	// Render all nodes in parallel.
	nodes := append(append([]*content.Node{}, tree.Sections...), tree.Pages...)
	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		firstEr error
	)
	jobs := make(chan *content.Node)
	for i := 0; i < runtime.GOMAXPROCS(0); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := range jobs {
				warns, err := b.renderNode(n)
				mu.Lock()
				res.Warnings = append(res.Warnings, warns...)
				if err != nil && firstEr == nil {
					firstEr = err
				}
				mu.Unlock()
			}
		}()
	}
	for _, n := range nodes {
		jobs <- n
	}
	close(jobs)
	wg.Wait()
	if firstEr != nil {
		return nil, firstEr
	}

	steps := []func() error{
		b.renderSitemapPage,
		b.renderProgressPage,
		b.render404,
		b.writePagesJSON,
		b.writeSitemapXML,
		b.writeRobots,
		b.copyStatic,
		b.copyAssets,
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return nil, err
		}
	}

	sort.Strings(res.Warnings)
	res.Duration = time.Since(start)
	return res, nil
}

func newSiteData(tree *content.Tree, cfg Config, now time.Time) *SiteData {
	return &SiteData{
		Title:   tree.Root.Title,
		Base:    cfg.Base,
		Root:    tree.Root,
		Books:   tree.Root.Sections(),
		Dev:     cfg.Dev,
		Index:   cfg.AllowIndex,
		Version: fmt.Sprintf("%x", now.Unix()),
		Year:    now.Year(),
	}
}

func safeOutDir(out, contentDir string) error {
	absOut, err := filepath.Abs(out)
	if err != nil {
		return err
	}
	absContent, err := filepath.Abs(contentDir)
	if err != nil {
		return err
	}
	cwd, _ := os.Getwd()
	home, _ := os.UserHomeDir()
	switch {
	case out == "", absOut == "/", absOut == cwd, absOut == home:
		return fmt.Errorf("refusing to use %q as output directory", out)
	case absOut == absContent || strings.HasPrefix(absContent+string(filepath.Separator), absOut+string(filepath.Separator)):
		return fmt.Errorf("output directory %q would delete content directory %q", out, contentDir)
	case strings.HasPrefix(absOut+string(filepath.Separator), absContent+string(filepath.Separator)):
		return fmt.Errorf("output directory %q is inside the content directory", out)
	}
	return nil
}

func loadTemplates(webFS fs.FS, base string) (map[string]*template.Template, error) {
	funcs := template.FuncMap{
		"icon":     iconFunc(base),
		"iconFor":  iconFor,
		"shade":    func(i int) int { return i % 6 },
		"join":     strings.Join,
		"pathJoin": func(a, b string) string { return path.Join(a, b) },
		"byBook":   groupByBook,
		"chTrail":  chapterTrail,
	}
	out := map[string]*template.Template{}
	for _, kind := range []string{"home", "section", "page", "sitemap", "progress", "404"} {
		t, err := template.New(kind).Funcs(funcs).ParseFS(webFS,
			"templates/base.html", "templates/partials.html", "templates/"+kind+".html")
		if err != nil {
			return nil, fmt.Errorf("templates (%s): %w", kind, err)
		}
		out[kind] = t
	}
	return out, nil
}

func (b *builder) write(rel string, kind string, data *PageData) error {
	var buf bytes.Buffer
	if err := b.tpl[kind].ExecuteTemplate(&buf, "base", data); err != nil {
		return fmt.Errorf("render %s: %w", rel, err)
	}
	return b.writeFile(rel, buf.Bytes())
}

func (b *builder) writeFile(rel string, data []byte) error {
	p := filepath.Join(b.cfg.OutDir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}

func (b *builder) renderNode(n *content.Node) ([]string, error) {
	kind, d, warns := b.pageData(n)
	return warns, b.write(path.Join(n.Slug, "index.html"), kind, d)
}

// pageData prepares the template data for a page or section node.
func (b *builder) pageData(n *content.Node) (string, *PageData, []string) {
	html, toc, warns := b.renderMarkdown(n)
	d := &PageData{
		Site:     b.site,
		Node:     n,
		Title:    n.Title,
		IsHome:   n.Parent == nil,
		Content:  html,
		TOC:      toc,
		Crumbs:   n.Ancestors(),
		EditPath: n.SourceRel(),
		LinksOut: b.linkTargets(n),
		LinksIn:  b.backlinks[n.Rel],
	}
	if u, ok := b.updated[n.SourceRel()]; ok {
		d.Updated = &u
	}
	kind := "section"
	switch {
	case n.Parent == nil:
		kind = "home"
	case !n.IsSection:
		kind = "page"
		d.Siblings = n.Parent.Pages()
		for i, s := range d.Siblings {
			if s.Rel == n.Rel {
				if i > 0 {
					d.Prev = d.Siblings[i-1]
				}
				if i < len(d.Siblings)-1 {
					d.Next = d.Siblings[i+1]
				}
			}
		}
	}
	return kind, d, warns
}

func (b *builder) renderSitemapPage() error {
	return b.write("sitemap/index.html", "sitemap", &PageData{
		Site:   b.site,
		Node:   b.tree.Root,
		Title:  "Site map",
		Crumbs: []*content.Node{b.tree.Root},
	})
}

func (b *builder) renderProgressPage() error {
	return b.write("progress/index.html", "progress", &PageData{
		Site:   b.site,
		Node:   b.tree.Root,
		Title:  "Progress",
		Crumbs: []*content.Node{b.tree.Root},
	})
}

func (b *builder) render404() error {
	return b.write("404.html", "404", &PageData{Site: b.site, Node: b.tree.Root, Title: "Page not found"})
}

// pages.json: a compact listing for title search (and future indexers).
func (b *builder) writePagesJSON() error {
	type entry struct {
		T string   `json:"t"`           // title
		U string   `json:"u"`           // url
		C string   `json:"c,omitempty"` // trail: Book › Chapter
		S bool     `json:"s,omitempty"` // is a section
		P bool     `json:"p,omitempty"` // is a placeholder page
		A []string `json:"a,omitempty"` // aliases (other names)
	}
	var list []entry
	for _, s := range b.tree.Sections {
		if s.Parent != nil {
			list = append(list, entry{T: s.Title, U: s.URL, C: strings.Join(s.Trail(), " › "), S: true, P: s.IsChapter() && !s.Written(), A: s.Aliases()})
		}
	}
	for _, p := range b.tree.Pages {
		list = append(list, entry{T: p.Title, U: p.URL, C: strings.Join(p.Trail(), " › "), P: p.Stub, A: p.Aliases()})
	}
	data, err := json.Marshal(list)
	if err != nil {
		return err
	}
	return b.writeFile("pages.json", data)
}

func (b *builder) writeSitemapXML() error {
	if b.cfg.SiteURL == "" {
		return nil
	}
	origin := strings.TrimRight(b.cfg.SiteURL, "/")
	type u struct {
		Loc string `xml:"loc"`
	}
	type set struct {
		XMLName xml.Name `xml:"urlset"`
		NS      string   `xml:"xmlns,attr"`
		URLs    []u      `xml:"url"`
	}
	s := set{NS: "http://www.sitemaps.org/schemas/sitemap/0.9"}
	for _, n := range append(append([]*content.Node{}, b.tree.Sections...), b.tree.Pages...) {
		s.URLs = append(s.URLs, u{Loc: origin + n.URL})
	}
	data, err := xml.MarshalIndent(s, "", " ")
	if err != nil {
		return err
	}
	return b.writeFile("sitemap.xml", append([]byte(xml.Header), data...))
}

// robots.txt: block all crawlers unless indexing is explicitly allowed.
func (b *builder) writeRobots() error {
	txt := "User-agent: *\nDisallow: /\n"
	if b.cfg.AllowIndex {
		txt = "User-agent: *\nAllow: /\n"
		if b.cfg.SiteURL != "" {
			txt += "Sitemap: " + strings.TrimRight(b.cfg.SiteURL, "/") + b.cfg.Base + "sitemap.xml\n"
		}
	}
	return b.writeFile("robots.txt", []byte(txt))
}

func (b *builder) copyStatic() error {
	err := fs.WalkDir(b.cfg.Web, "static", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(b.cfg.Web, p)
		if err != nil {
			return err
		}
		return b.writeFile(p, data)
	})
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := b.writeFile("static/icons.svg", []byte(iconSprite())); err != nil {
		return err
	}
	fav := renderGrid(iconGrids["cross"], "#14532d", "#4ade80")
	return b.writeFile("static/favicon.svg", []byte(strings.Replace(fav, "<svg ", `<svg xmlns="http://www.w3.org/2000/svg" `, 1)))
}

func (b *builder) copyAssets() error {
	for _, a := range b.tree.Assets {
		if err := copyFile(a.Src, filepath.Join(b.cfg.OutDir, filepath.FromSlash(a.Out))); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
