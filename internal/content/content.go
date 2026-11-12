// Package content loads a folder of Markdown files into a navigable tree.
//
// Folders are sections (book, chapter, …), .md files are pages, and
// everything else is a static asset copied through unchanged. The only
// assumption about a page is that it is a Markdown file; front matter is
// optional.
package content

import (
	"bytes"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"gopkg.in/yaml.v3"
)

// Node is a section (folder) or a page (.md file).
type Node struct {
	Rel         string // source path relative to the content root, slash-separated ("" = root folder)
	Slug        string // URL path without leading/trailing slash ("" = root)
	URL         string // final URL including the site base path
	Title       string
	TitleFromH1 bool // title was taken from the first "# " heading in Body
	Order       int
	HasOrder    bool
	Meta        map[string]any // all front matter, including unknown keys
	Body        []byte         // Markdown without front matter
	IsSection   bool
	Parent      *Node
	Children    []*Node
	Depth       int        // 0 = root, 1 = book, 2 = chapter, …
	Stub        bool       // page is a placeholder: `status: stub` or no body content
	Planned     []*Planned // sections: topics from `planned:` front matter

	pageCount       int
	stubCount       int
	chapterCount    int  // chapters at or beneath this section
	writtenChapters int  // of those, chapters with content
	hasIntro        bool // _index.md has body text beyond its title
	hasIndex        bool
}

// Planned is an outline topic listed in a section's `planned:` front matter.
// It counts as outstanding until a page with the same title (or legacy path)
// exists in that section.
type Planned struct {
	Title  string
	Legacy string
	Page   *Node // matching page, if one exists
}

// File is the file name a page for this topic would conventionally use.
func (p *Planned) File() string { return Slugify(p.Title) + ".md" }

// Outstanding reports whether the topic still needs writing.
func (p *Planned) Outstanding() bool { return p.Page == nil || p.Page.Stub }

// StubStatuses are front-matter `status:` values that mark a placeholder page.
var StubStatuses = map[string]bool{"stub": true, "placeholder": true, "todo": true}

// Asset is a non-Markdown file copied to the output as-is.
type Asset struct {
	Src string // absolute source path
	Out string // output path relative to the output root (slash-separated)
	URL string
}

// Tree is the loaded content.
type Tree struct {
	Root     *Node
	Pages    []*Node // every page, in tree order
	Sections []*Node // every section including root, in tree order
	ByRel    map[string]*Node
	Assets   map[string]*Asset // keyed by source Rel
	Warnings []string

	base  string
	slugs map[string]string // slug -> rel, for collision detection
}

// Load reads dir into a Tree. base is the site base path ("/" or "/sub/").
func Load(dir, base string) (*Tree, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", dir)
	}
	t := &Tree{
		ByRel:  map[string]*Node{},
		Assets: map[string]*Asset{},
		base:   base,
		slugs:  map[string]string{},
	}
	root, err := t.loadDir(dir, "", nil)
	if err != nil {
		return nil, err
	}
	t.Root = root
	t.collect(root)
	root.countPages()
	return t, nil
}

func (t *Tree) collect(n *Node) {
	if n.IsSection {
		t.Sections = append(t.Sections, n)
	} else {
		t.Pages = append(t.Pages, n)
	}
	for _, c := range n.Children {
		t.collect(c)
	}
}

func (t *Tree) url(slug string) string {
	if slug == "" {
		return t.base
	}
	return t.base + slug + "/"
}

func (t *Tree) claimSlug(slug, rel string) {
	if prev, ok := t.slugs[slug]; ok {
		t.Warnings = append(t.Warnings, fmt.Sprintf("%s: URL /%s/ collides with %s", rel, slug, prev))
		return
	}
	t.slugs[slug] = rel
}

func (t *Tree) loadDir(fsDir, rel string, parent *Node) (*Node, error) {
	n := &Node{Rel: rel, IsSection: true, Parent: parent, Meta: map[string]any{}}
	if parent != nil {
		n.Depth = parent.Depth + 1
		n.Slug = joinSlug(parent.Slug, Slugify(path.Base(rel)))
		t.claimSlug(n.Slug, rel)
	}
	n.URL = t.url(n.Slug)
	t.ByRel[rel] = n

	entries, err := os.ReadDir(fsDir)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") || (strings.HasPrefix(name, "_") && name != "_index.md") {
			continue
		}
		childRel := path.Join(rel, name)
		childFS := filepath.Join(fsDir, name)
		switch {
		case e.IsDir():
			c, err := t.loadDir(childFS, childRel, n)
			if err != nil {
				return nil, err
			}
			if len(c.Children) == 0 && !c.hasIndex {
				// Asset-only folder (e.g. images/): not a section.
				delete(t.ByRel, c.Rel)
				continue
			}
			n.Children = append(n.Children, c)
		case name == "_index.md":
			if err := t.loadFile(n, childFS, childRel); err != nil {
				return nil, err
			}
			n.hasIndex = true
			t.ByRel[childRel] = n
		case strings.EqualFold(path.Ext(name), ".md"):
			p := &Node{Rel: childRel, Parent: n, Depth: n.Depth + 1, Meta: map[string]any{}}
			p.Slug = joinSlug(n.Slug, Slugify(strings.TrimSuffix(name, path.Ext(name))))
			p.URL = t.url(p.Slug)
			t.claimSlug(p.Slug, childRel)
			if err := t.loadFile(p, childFS, childRel); err != nil {
				return nil, err
			}
			t.ByRel[childRel] = p
			n.Children = append(n.Children, p)
		default:
			out := joinSlug(n.Slug, name)
			t.Assets[childRel] = &Asset{Src: childFS, Out: out, URL: t.base + (&url.URL{Path: out}).EscapedPath()}
		}
	}

	if n.Title == "" {
		if parent == nil {
			n.Title = "Notebook"
		} else {
			n.Title = Prettify(path.Base(rel))
		}
	}
	sortNodes(n.Children)
	n.Planned = parsePlanned(n.Meta["planned"], n.Pages())
	return n, nil
}

func parsePlanned(v any, pages []*Node) []*Planned {
	list, _ := v.([]any)
	if len(list) == 0 {
		return nil
	}
	byTitle := map[string]*Node{}
	byLegacy := map[string]*Node{}
	for _, p := range pages {
		byTitle[strings.ToLower(p.Title)] = p
		if l := p.MetaString("legacy"); l != "" {
			byLegacy[l] = p
		}
	}
	var out []*Planned
	for _, item := range list {
		p := &Planned{}
		switch it := item.(type) {
		case string:
			p.Title = it
		case map[string]any:
			p.Title, _ = it["title"].(string)
			p.Legacy, _ = it["legacy"].(string)
		}
		p.Title = strings.TrimSpace(p.Title)
		if p.Title == "" {
			continue
		}
		if pg := byLegacy[p.Legacy]; p.Legacy != "" && pg != nil {
			p.Page = pg
		} else {
			p.Page = byTitle[strings.ToLower(p.Title)]
		}
		out = append(out, p)
	}
	return out
}

func (t *Tree) loadFile(n *Node, fsPath, rel string) error {
	raw, err := os.ReadFile(fsPath)
	if err != nil {
		return err
	}
	if err := n.SetSource(raw, rel); err != nil {
		t.Warnings = append(t.Warnings, fmt.Sprintf("%s: front matter: %v", rel, err))
	}
	return nil
}

// SetSource (re)initializes a node's metadata, body, title and status from
// raw file contents. rel is the source path, used for the fallback title.
// A front-matter parse error is returned, but the body is still applied.
func (n *Node) SetSource(raw []byte, rel string) error {
	meta, body, ferr := SplitFrontMatter(raw)
	n.Meta = map[string]any{}
	if meta != nil {
		n.Meta = meta
	}
	n.Title, n.TitleFromH1, n.Stub, n.hasIntro = "", false, false, false
	n.Order, n.HasOrder = 0, false
	n.Body = body
	if s, ok := n.Meta["title"].(string); ok && strings.TrimSpace(s) != "" {
		n.Title = strings.TrimSpace(s)
	} else if h1 := FirstH1(body); h1 != "" {
		n.Title, n.TitleFromH1 = h1, true
	} else if !n.IsSection {
		n.Title = Prettify(strings.TrimSuffix(path.Base(rel), path.Ext(rel)))
	} else if n.Parent != nil {
		n.Title = Prettify(path.Base(path.Dir(rel)))
	}
	if n.IsSection {
		n.hasIntro = !isEmptyBody(body, n.TitleFromH1)
	} else {
		status, _ := n.Meta["status"].(string)
		n.Stub = StubStatuses[strings.ToLower(strings.TrimSpace(status))] || isEmptyBody(body, n.TitleFromH1)
	}
	switch v := n.Meta["order"].(type) {
	case int:
		n.Order, n.HasOrder = v, true
	case float64:
		n.Order, n.HasOrder = int(v), true
	}
	return ferr
}

// SourceRel is the Markdown file that defines a node: the page itself, or a
// section's _index.md (which may not exist yet).
func (n *Node) SourceRel() string {
	if n.IsSection {
		return path.Join(n.Rel, "_index.md")
	}
	return n.Rel
}

// SplitFrontMatter separates an optional leading YAML block ("---" … "---").
func SplitFrontMatter(raw []byte) (map[string]any, []byte, error) {
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf"))
	raw = bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
	if !bytes.HasPrefix(raw, []byte("---\n")) {
		return nil, raw, nil
	}
	rest := raw[4:]
	end := bytes.Index(rest, []byte("\n---\n"))
	var fm, body []byte
	switch {
	case end >= 0:
		fm, body = rest[:end], rest[end+5:]
	case bytes.HasSuffix(rest, []byte("\n---")):
		fm, body = rest[:len(rest)-4], nil
	case bytes.HasPrefix(rest, []byte("---\n")) || bytes.Equal(rest, []byte("---")):
		return map[string]any{}, bytes.TrimPrefix(rest, []byte("---\n")), nil
	default:
		return nil, raw, nil // no closing fence: treat everything as body
	}
	meta := map[string]any{}
	if err := yaml.Unmarshal(fm, &meta); err != nil {
		return nil, body, err
	}
	return meta, body, nil
}

// FirstH1 returns the text of the first ATX "# " heading outside code fences.
func FirstH1(body []byte) string {
	inFence := false
	for _, line := range strings.Split(string(body), "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "```") || strings.HasPrefix(trim, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		if strings.HasPrefix(line, "# ") {
			return strings.TrimSpace(strings.TrimRight(strings.TrimSpace(line[2:]), "#"))
		}
	}
	return ""
}

// isEmptyBody reports whether a body has no content beyond its title heading.
func isEmptyBody(body []byte, titleFromH1 bool) bool {
	for _, line := range strings.Split(string(body), "\n") {
		t := strings.TrimSpace(line)
		if t == "" {
			continue
		}
		if titleFromH1 && strings.HasPrefix(line, "# ") {
			titleFromH1 = false // skip only the first H1
			continue
		}
		return false
	}
	return true
}

// Slugify turns a file or folder name into a URL segment.
func Slugify(s string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '.':
			b.WriteRune(r)
			dash = false
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			dash = false
		default:
			if !dash && b.Len() > 0 {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-.")
	if out == "" {
		return "untitled"
	}
	return out
}

// Prettify turns "atrial-fibrillation" into "Atrial fibrillation".
func Prettify(s string) string {
	s = strings.TrimSpace(strings.NewReplacer("-", " ", "_", " ").Replace(s))
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

func joinSlug(a, b string) string {
	if a == "" {
		return b
	}
	return a + "/" + b
}

func sortNodes(ns []*Node) {
	sort.SliceStable(ns, func(i, j int) bool {
		a, b := ns[i], ns[j]
		if a.IsSection != b.IsSection {
			return a.IsSection
		}
		if a.HasOrder != b.HasOrder {
			return a.HasOrder
		}
		if a.HasOrder && a.Order != b.Order {
			return a.Order < b.Order
		}
		return strings.ToLower(a.Title) < strings.ToLower(b.Title)
	})
}

func (n *Node) countPages() (pages, stubs int) {
	if !n.IsSection {
		if n.Stub {
			return 1, 1
		}
		return 1, 0
	}
	chapters, written := 0, 0
	for _, c := range n.Children {
		p, s := c.countPages()
		pages += p
		stubs += s
		chapters += c.chapterCount
		written += c.writtenChapters
	}
	n.pageCount, n.stubCount = pages, stubs
	if n.IsChapter() {
		chapters, written = 1, 0
		if n.hasIntro || pages > stubs {
			written = 1
		}
	}
	n.chapterCount, n.writtenChapters = chapters, written
	return pages, stubs
}

// IsChapter reports whether n is a leaf section: a folder with no sub-folders
// (other than the root). Progress is counted in chapters.
func (n *Node) IsChapter() bool {
	return n.IsSection && n.Parent != nil && len(n.Sections()) == 0
}

// Written reports whether a chapter has content: at least one non-stub page,
// or intro text in its _index.md. For a page, whether it isn't a stub.
func (n *Node) Written() bool {
	if !n.IsSection {
		return !n.Stub
	}
	return n.writtenChapters > 0 && n.IsChapter()
}

// ChapterCount is the number of chapters at or beneath a section.
func (n *Node) ChapterCount() int { return n.chapterCount }

// WrittenChapters is the number of chapters at or beneath a section that have content.
func (n *Node) WrittenChapters() int { return n.writtenChapters }

// EmptyChapters is ChapterCount minus WrittenChapters.
func (n *Node) EmptyChapters() int { return n.chapterCount - n.writtenChapters }

// OutstandingPlanned lists this section's planned topics that don't have a written page yet.
// They are suggestions only and do not count toward progress.
func (n *Node) OutstandingPlanned() []*Planned {
	var out []*Planned
	for _, p := range n.Planned {
		if p.Outstanding() {
			out = append(out, p)
		}
	}
	return out
}

// StubCount is the number of placeholder pages beneath a section (0/1 for a page).
func (n *Node) StubCount() int {
	if !n.IsSection {
		if n.Stub {
			return 1
		}
		return 0
	}
	return n.stubCount
}

// DoneCount is the number of written (non-placeholder) pages.
func (n *Node) DoneCount() int { return n.PageCount() - n.StubCount() }

// Percent is the share of chapters written, 0–100 (100 when there are none).
func (n *Node) Percent() int {
	if n.chapterCount == 0 {
		return 100
	}
	return n.writtenChapters * 100 / n.chapterCount
}

// PageCount is the number of pages beneath a section (1 for a page).
func (n *Node) PageCount() int {
	if !n.IsSection {
		return 1
	}
	return n.pageCount
}

// Sections returns child sections.
func (n *Node) Sections() []*Node {
	var out []*Node
	for _, c := range n.Children {
		if c.IsSection {
			out = append(out, c)
		}
	}
	return out
}

// Pages returns child pages.
func (n *Node) Pages() []*Node {
	var out []*Node
	for _, c := range n.Children {
		if !c.IsSection {
			out = append(out, c)
		}
	}
	return out
}

// Ancestors returns root … parent.
func (n *Node) Ancestors() []*Node {
	var out []*Node
	for p := n.Parent; p != nil; p = p.Parent {
		out = append([]*Node{p}, out...)
	}
	return out
}

// Book returns the top-level section containing n (nil for root or root pages).
func (n *Node) Book() *Node {
	for c := n; c != nil; c = c.Parent {
		if c.Depth == 1 && c.IsSection {
			return c
		}
	}
	return nil
}

// Trail returns the section titles between the book and the node, inclusive of the book.
func (n *Node) Trail() []string {
	var out []string
	for _, a := range n.Ancestors() {
		if a.Parent != nil {
			out = append(out, a.Title)
		}
	}
	return out
}

// MetaString returns a string front-matter value or "".
func (n *Node) MetaString(key string) string {
	s, _ := n.Meta[key].(string)
	return s
}

// Aliases returns other names for the page from `aliases:` front matter
// (a list, or one string), e.g. abbreviations like "PMOS". Search finds the
// page by any of them.
func (n *Node) Aliases() []string {
	var out []string
	add := func(s string) {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	switch v := n.Meta["aliases"].(type) {
	case string:
		add(v)
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok {
				add(s)
			}
		}
	}
	return out
}
