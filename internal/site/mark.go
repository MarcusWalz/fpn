package site

// ==highlight== support (as in Obsidian): renders <mark>…</mark>. Built like
// goldmark's ~~strikethrough~~ extension, so the usual delimiter rules apply:
// "x == y" (spaces around) and code spans are left alone.

import (
	"github.com/yuin/goldmark"
	gast "github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// KindMark is the AST kind of a ==highlighted== span.
var KindMark = gast.NewNodeKind("Mark")

// Mark is a ==highlighted== inline span.
type Mark struct{ gast.BaseInline }

func (n *Mark) Dump(source []byte, level int) { gast.DumpHelper(n, source, level, nil, nil) }
func (n *Mark) Kind() gast.NodeKind           { return KindMark }

type markDelimiters struct{}

func (markDelimiters) IsDelimiter(b byte) bool { return b == '=' }
func (markDelimiters) CanOpenCloser(opener, closer *parser.Delimiter) bool {
	return opener.Char == closer.Char
}
func (markDelimiters) OnMatch(consumes int) gast.Node { return &Mark{} }

type markParser struct{}

func (markParser) Trigger() []byte { return []byte{'='} }

func (markParser) Parse(parent gast.Node, block text.Reader, pc parser.Context) gast.Node {
	before := block.PrecendingCharacter()
	line, segment := block.PeekLine()
	node := parser.ScanDelimiter(line, before, 2, markDelimiters{})
	if node == nil || node.OriginalLength != 2 || before == '=' {
		return nil // exactly "==", so "===" or a lone "=" stays text
	}
	node.Segment = segment.WithStop(segment.Start + node.OriginalLength)
	block.Advance(node.OriginalLength)
	pc.PushDelimiter(node)
	return node
}

func (markParser) CloseBlock(parent gast.Node, pc parser.Context) {}

type markRenderer struct{}

func (markRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindMark, func(w util.BufWriter, _ []byte, _ gast.Node, entering bool) (gast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString("<mark>")
		} else {
			_, _ = w.WriteString("</mark>")
		}
		return gast.WalkContinue, nil
	})
}

type markExtension struct{}

func (markExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithInlineParsers(util.Prioritized(markParser{}, 500)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(markRenderer{}, 500)))
}
