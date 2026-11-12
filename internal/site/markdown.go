package site

import (
	"bytes"
	"fmt"
	"html/template"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/marcuswalz/fpn/internal/content"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	gmhtml "github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
)

// Heading is a table-of-contents entry.
type Heading struct {
	Level int
	ID    string
	Text  string
}

func newMarkdown() goldmark.Markdown {
	return goldmark.New(
		goldmark.WithExtensions(extension.GFM, extension.Footnote, extension.DefinitionList),
		goldmark.WithParserOptions(parser.WithAutoHeadingID(), parser.WithAttribute()),
		goldmark.WithRendererOptions(gmhtml.WithUnsafe()),
	)
}

// renderMarkdown converts a node's body to HTML, rewriting relative links
// to output URLs and collecting h2/h3 headings for the TOC.
func (b *builder) renderMarkdown(n *content.Node) (template.HTML, []Heading, []string) {
	src := n.Body
	if len(bytes.TrimSpace(src)) == 0 {
		return "", nil, nil
	}
	src, notes := extractSourceNotes(src)
	cites := newCiteState(b.lib)
	src = cites.preprocess(src)
	doc := b.md.Parser().Parse(text.NewReader(src))

	if n.TitleFromH1 {
		for c := doc.FirstChild(); c != nil; c = c.NextSibling() {
			if h, ok := c.(*ast.Heading); ok && h.Level == 1 {
				doc.RemoveChild(doc, c)
				break
			}
		}
	}

	srcDir := n.Rel
	if !n.IsSection {
		srcDir = path.Dir(n.Rel)
	}
	if srcDir == "." {
		srcDir = ""
	}
	where := n.Rel
	if n.IsSection {
		where = path.Join(n.Rel, "_index.md")
	}

	if b.srcLines {
		tagSourceLines(doc, src, b.srcLineOffset)
	}

	var toc []Heading
	var warns []string
	_ = ast.Walk(doc, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch v := node.(type) {
		case *ast.Heading:
			if v.Level == 2 || v.Level == 3 {
				if id, ok := v.AttributeString("id"); ok {
					if idb, ok := id.([]byte); ok {
						toc = append(toc, Heading{Level: v.Level, ID: string(idb), Text: nodeText(v, src)})
					}
				}
			}
		case *ast.Link:
			if u, ok := b.resolve(string(v.Destination), srcDir); ok {
				v.Destination = []byte(u)
			} else {
				warns = append(warns, fmt.Sprintf("%s: broken link %q", where, v.Destination))
			}
		case *ast.Image:
			if !imageHasSource(v, src) {
				if note := notes[string(v.Destination)]; note != "" {
					warns = append(warns, fmt.Sprintf(`%s: image %q has no "Source:" caption — your note: %q`, where, v.Destination, note))
				} else {
					warns = append(warns, fmt.Sprintf(`%s: image %q has no "Source:" caption (add an italic line under it, e.g. *Figure: … Source: …*)`, where, v.Destination))
				}
			}
			v.SetAttributeString("loading", []byte("lazy"))
			v.SetAttributeString("decoding", []byte("async"))
			if u, ok := b.resolve(string(v.Destination), srcDir); ok {
				v.Destination = []byte(u)
			} else {
				warns = append(warns, fmt.Sprintf("%s: missing image %q", where, v.Destination))
			}
		}
		return ast.WalkContinue, nil
	})

	var buf bytes.Buffer
	if err := b.md.Renderer().Render(&buf, src, doc); err != nil {
		warns = append(warns, fmt.Sprintf("%s: render: %v", where, err))
	}
	for _, w := range cites.warns {
		warns = append(warns, where+": "+w)
	}
	out := buf.String()
	if len(cites.order) > 0 {
		hadRefs := refsHeadingRe.MatchString(out)
		out = cites.appendReferences(out)
		if !hadRefs {
			toc = append(toc, Heading{Level: 2, ID: "references", Text: "References"})
		}
	}
	return template.HTML(out), toc, warns
}

// imageHasSource reports whether an image is credited: "Source:" appears in
// its title, in the same paragraph, or in the paragraph right after it
// (the italic caption line).
func imageHasSource(img *ast.Image, src []byte) bool {
	has := func(s string) bool { return strings.Contains(strings.ToLower(s), "source:") }
	if has(string(img.Title)) {
		return true
	}
	var block ast.Node = img.Parent()
	for block != nil && block.Type() != ast.TypeBlock {
		block = block.Parent()
	}
	if block == nil {
		return false
	}
	if has(nodeText(block, src)) {
		return true
	}
	if next := block.NextSibling(); next != nil && next.Kind() == ast.KindParagraph && has(nodeText(next, src)) {
		return true
	}
	return false
}

// resolve maps a link destination relative to srcDir onto an output URL.
// External, absolute and fragment-only links are returned unchanged.
// ok=false means the link looked internal but its target doesn't exist.
func (b *builder) resolve(dest, srcDir string) (string, bool) {
	if dest == "" || strings.HasPrefix(dest, "#") || strings.HasPrefix(dest, "/") || strings.HasPrefix(dest, "//") {
		return dest, true
	}
	if u, err := url.Parse(dest); err != nil || u.Scheme != "" {
		return dest, true
	}
	target, frag := dest, ""
	if i := strings.IndexAny(target, "?#"); i >= 0 {
		target, frag = target[:i], target[i:]
	}
	if unesc, err := url.PathUnescape(target); err == nil {
		target = unesc
	}
	rel := path.Clean(path.Join(srcDir, target))
	if rel == "." {
		rel = ""
	}
	if strings.HasPrefix(rel, "../") || rel == ".." {
		return dest, false
	}
	if n, ok := b.tree.ByRel[rel]; ok {
		return n.URL + frag, true
	}
	if a, ok := b.tree.Assets[rel]; ok {
		return a.URL + frag, true
	}
	return dest, false
}

func nodeText(n ast.Node, src []byte) string {
	var sb strings.Builder
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch t := c.(type) {
		case *ast.Text:
			sb.Write(t.Segment.Value(src))
			if t.SoftLineBreak() {
				sb.WriteByte(' ')
			}
		case *ast.String:
			sb.Write(t.Value)
		case *ast.CodeSpan:
			for cc := t.FirstChild(); cc != nil; cc = cc.NextSibling() {
				if tx, ok := cc.(*ast.Text); ok {
					sb.Write(tx.Segment.Value(src))
				}
			}
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return strings.TrimSpace(sb.String())
}

// tagSourceLines sets data-src-line on top-level blocks and list items so the
// editor can keep the preview scrolled to the line being edited.
func tagSourceLines(doc ast.Node, src []byte, offset int) {
	starts := []int{0}
	for i, c := range src {
		if c == '\n' {
			starts = append(starts, i+1)
		}
	}
	lineOf := func(pos int) int {
		lo, hi := 0, len(starts)-1
		for lo < hi {
			mid := (lo + hi + 1) / 2
			if starts[mid] <= pos {
				lo = mid
			} else {
				hi = mid - 1
			}
		}
		return lo + 1 + offset
	}
	var first func(n ast.Node) int
	first = func(n ast.Node) int {
		if n.Type() == ast.TypeBlock && n.Lines().Len() > 0 {
			return n.Lines().At(0).Start
		}
		for c := n.FirstChild(); c != nil; c = c.NextSibling() {
			if p := first(c); p >= 0 {
				return p
			}
		}
		return -1
	}
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering || n.Type() != ast.TypeBlock || n.Kind() == ast.KindDocument {
			return ast.WalkContinue, nil
		}
		if n.Parent() != nil && (n.Parent().Kind() == ast.KindDocument || n.Kind() == ast.KindListItem) {
			if p := first(n); p >= 0 {
				n.SetAttributeString("data-src-line", []byte(strconv.Itoa(lineOf(p))))
			}
		}
		return ast.WalkContinue, nil
	})
}

// resolveNode returns the page or section a Markdown link points to, or nil
// for external links, assets, fragments and broken links.
func (b *builder) resolveNode(dest, srcDir string) *content.Node {
	if dest == "" || strings.HasPrefix(dest, "#") || strings.HasPrefix(dest, "/") {
		return nil
	}
	if u, err := url.Parse(dest); err != nil || u.Scheme != "" {
		return nil
	}
	target := dest
	if i := strings.IndexAny(target, "?#"); i >= 0 {
		target = target[:i]
	}
	if unesc, err := url.PathUnescape(target); err == nil {
		target = unesc
	}
	rel := path.Clean(path.Join(srcDir, target))
	if rel == "." {
		rel = ""
	}
	return b.tree.ByRel[rel]
}

// linkTargets lists the distinct pages/sections that n's body links to
// (excluding itself), in the order they first appear.
func (b *builder) linkTargets(n *content.Node) []*content.Node {
	if len(bytes.TrimSpace(n.Body)) == 0 {
		return nil
	}
	srcDir := n.Rel
	if !n.IsSection {
		srcDir = path.Dir(n.Rel)
	}
	if srcDir == "." {
		srcDir = ""
	}
	doc := b.md.Parser().Parse(text.NewReader(n.Body))
	seen := map[string]bool{n.Rel: true}
	var out []*content.Node
	_ = ast.Walk(doc, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if l, ok := node.(*ast.Link); ok && entering {
			if t := b.resolveNode(string(l.Destination), srcDir); t != nil && !seen[t.Rel] {
				seen[t.Rel] = true
				out = append(out, t)
			}
		}
		return ast.WalkContinue, nil
	})
	return out
}

// buildBacklinks maps each node's Rel to the nodes that link to it, sorted by title.
func (b *builder) buildBacklinks() map[string][]*content.Node {
	in := map[string][]*content.Node{}
	nodes := append(append([]*content.Node{}, b.tree.Sections...), b.tree.Pages...)
	for _, src := range nodes {
		for _, t := range b.linkTargets(src) {
			in[t.Rel] = append(in[t.Rel], src)
		}
	}
	for k := range in {
		sort.SliceStable(in[k], func(i, j int) bool { return strings.ToLower(in[k][i].Title) < strings.ToLower(in[k][j].Title) })
	}
	return in
}

// LinkGroup is a set of linked pages that share a top-level folder (book).
type LinkGroup struct {
	Book  string
	Items []*content.Node
}

// groupByBook groups nodes by their book, books alphabetically and pages
// alphabetically within each book. Pages outside any book go last.
func groupByBook(nodes []*content.Node) []LinkGroup {
	const other = "\uffffOther pages" // sorts after every real title
	byBook := map[string][]*content.Node{}
	for _, n := range nodes {
		name := other
		if bk := n.Book(); bk != nil {
			name = bk.Title
		}
		byBook[name] = append(byBook[name], n)
	}
	names := make([]string, 0, len(byBook))
	for k := range byBook {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool { return strings.ToLower(names[i]) < strings.ToLower(names[j]) })
	out := make([]LinkGroup, 0, len(names))
	for _, k := range names {
		items := byBook[k]
		sort.SliceStable(items, func(i, j int) bool { return strings.ToLower(items[i].Title) < strings.ToLower(items[j].Title) })
		out = append(out, LinkGroup{Book: strings.TrimPrefix(k, "\uffff"), Items: items})
	}
	return out
}

// chapterTrail is a node's section trail without the book (shown as the group heading).
func chapterTrail(n *content.Node) string {
	t := n.Trail()
	if len(t) > 0 {
		t = t[1:]
	}
	return strings.Join(t, " › ")
}
