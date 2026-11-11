package site

import (
	"fmt"
	"hash/fnv"
	"html/template"
	"sort"
	"strings"

	"github.com/marcuswalz/fpn/internal/content"
)

// Pixel icons drawn on a grid. '#' = main color (currentColor),
// 'o' = highlight (--px-hi), anything else = transparent.
var iconGrids = map[string][]string{
	"heart": {
		"............",
		".###....###.",
		"#oo##..#####",
		"#o##########",
		"############",
		"############",
		".##########.",
		"..########..",
		"...######...",
		"....####....",
		".....##.....",
		"............",
	},
	"brain": {
		"............",
		"...##.###...",
		"..###o####..",
		".####o#####.",
		"####o##o####",
		"###o###o####",
		"####o####o##",
		".####o##o##.",
		"..########..",
		"......###...",
		".......##...",
		"............",
	},
	"bone": {
		"............",
		"............",
		".##......##.",
		"####....####",
		"#o##########",
		".#oooooooo#.",
		".##########.",
		"####....####",
		".##......##.",
		"............",
		"............",
		"............",
	},
	"eye": {
		"............",
		"............",
		"....####....",
		"..##oooo##..",
		".#oo####oo#.",
		"#oo##..##oo#",
		"#oo##..##oo#",
		".#oo####oo#.",
		"..##oooo##..",
		"....####....",
		"............",
		"............",
	},
	"pill": {
		"............",
		"............",
		"............",
		"..####oooo..",
		".#####ooooo.",
		".#o###ooooo.",
		".#####ooooo.",
		"..####oooo..",
		"............",
		"............",
		"............",
		"............",
	},
	"flask": {
		"...######...",
		"....#oo#....",
		"....#oo#....",
		"....#oo#....",
		"...#oooo#...",
		"..#oooooo#..",
		"..#oooooo#..",
		".##########.",
		"#####o######",
		"######o#####",
		"############",
		".##########.",
	},
	"tooth": {
		".####..####.",
		"############",
		"#oo#########",
		"#o##########",
		"############",
		".##########.",
		".####..####.",
		".###....###.",
		".##......##.",
		".##......##.",
		"..#......#..",
		"............",
	},
	"leaf": {
		"............",
		"........####",
		"......######",
		".....#######",
		"....####o###",
		"...####o####",
		"...###o#####",
		"...##o#####.",
		"...#o#####..",
		"..#o#####...",
		".#o.###.....",
		"#o..........",
	},
	"drop": {
		".....##.....",
		"....####....",
		"....####....",
		"...######...",
		"..##o#####..",
		"..#o######..",
		".##o#######.",
		".##########.",
		".##########.",
		"..########..",
		"...######...",
		"............",
	},
	"baby": {
		"....####....",
		"...######...",
		"..#oooooo#..",
		"..#o#oo#o#..",
		"..#oooooo#..",
		"..#oo##oo#..",
		"...######...",
		"..########..",
		".##########.",
		".##o####o##.",
		"..########..",
		"...##..##...",
	},
	"lungs": {
		".....##.....",
		".....##.....",
		"..##.##.##..",
		".###o##o###.",
		"####o##o####",
		"###o#..#o###",
		"####....####",
		"####....####",
		"####....####",
		".###....###.",
		"..##....##..",
		"............",
	},
	"virus": {
		".....##.....",
		"..#..##..#..",
		"...######...",
		"..##o##o##..",
		"####oooo####",
		"####o##o####",
		"..##oooo##..",
		"...######...",
		"..#..##..#..",
		".....##.....",
		"............",
		"............",
	},
	"ear": {
		"...#####....",
		"..##ooo##...",
		".##o###o##..",
		".#o##..#o#..",
		".#o#...#o#..",
		".#o#..#o#...",
		"..##.#o#....",
		"....#o#.....",
		"...#o#......",
		"..#o#.......",
		"..##........",
		"............",
	},
	"stomach": {
		"..##........",
		"..##........",
		"..###.......",
		"...####.....",
		"...######...",
		"..##oooo##..",
		".##oooooo##.",
		".#ooooooo##.",
		".##ooooo##..",
		"..######....",
		".....###....",
		"......##....",
	},
	"smile": {
		"...######...",
		"..#oooooo#..",
		".#oooooooo#.",
		"#oo##oo##oo#",
		"#oo##oo##oo#",
		"#oooooooooo#",
		"#o#oooooo#o#",
		"#oo#oooo#oo#",
		".#oo####oo#.",
		"..#oooooo#..",
		"...######...",
		"............",
	},
	"cross": {
		"....####....",
		"....#oo#....",
		"....#oo#....",
		"#####oo#####",
		"#oooooooooo#",
		"#oooooooooo#",
		"#####oo#####",
		"....#oo#....",
		"....#oo#....",
		"....####....",
		"............",
		"............",
	},
	"book": {
		"............",
		".####..####.",
		"#oooo##oooo#",
		"#o##o##o##o#",
		"#oooo##oooo#",
		"#o##o##o##o#",
		"#oooo##oooo#",
		"#oooo##oooo#",
		"############",
		".####..####.",
		"............",
		"............",
	},
	"page": {
		".#######....",
		".#ooooo##...",
		".#ooooo#o#..",
		".#ooooo####.",
		".#o####ooo#.",
		".#ooooooooo#",
		".#o######oo#",
		".#ooooooooo#",
		".#o######oo#",
		".#ooooooooo#",
		".###########",
		"............",
	},
	"star": {
		".....##.....",
		".....##.....",
		"....#oo#....",
		"#####oo#####",
		".##oooooo##.",
		"...#oooo#...",
		"...#oooo#...",
		"..##o##o##..",
		".##......##.",
		"............",
		"............",
		"............",
	},
	"home": {
		".....##.....",
		"....####....",
		"...######...",
		"..########..",
		".##########.",
		"############",
		".#oo####oo#.",
		".#oo####oo#.",
		".##########.",
		".####..####.",
		".####..####.",
		".####..####.",
	},
	"menu": {
		"............",
		"############",
		"############",
		"............",
		"............",
		"############",
		"############",
		"............",
		"............",
		"############",
		"############",
		"............",
	},
	"map": {
		"............",
		"###..###..##",
		"#o#..#o#..o#",
		"#o####o####o",
		"#o#..#o#..o#",
		"#o#..#o#..o#",
		"#o#..#o#..o#",
		"#o####o####o",
		"#o#..#o#..o#",
		"###..###..##",
		"............",
		"............",
	},
}

// iconSprite renders every icon as a <symbol> in one SVG file. Pages
// reference it with <use>, so each icon is downloaded once and cached.
// currentColor and --px-hi inherit into the <use> tree, so CSS still themes it.
func iconSprite() string {
	names := make([]string, 0, len(iconGrids))
	for n := range iconGrids {
		names = append(names, n)
	}
	sort.Strings(names)
	var b strings.Builder
	b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg">`)
	for _, n := range names {
		svg := renderGrid(iconGrids[n], "currentColor", "")
		svg = strings.Replace(svg, `class="px-hi"`, `style="fill:var(--px-hi,#86efac)"`, 1)
		// Turn <svg class="px" viewBox=… …>…</svg> into <symbol id=… viewBox=…>…</symbol>.
		vb := svg[strings.Index(svg, `viewBox="`):]
		vb = vb[:strings.Index(vb[9:], `"`)+10]
		body := svg[strings.Index(svg, ">")+1 : strings.LastIndex(svg, "</svg>")]
		fmt.Fprintf(&b, `<symbol id="%s" %s shape-rendering="crispEdges">%s</symbol>`, n, vb, body)
	}
	b.WriteString(`</svg>`)
	return b.String()
}

// iconFunc returns the template "icon" function for a site base path.
func iconFunc(base string) func(string) template.HTML {
	return func(name string) template.HTML {
		if _, ok := iconGrids[name]; !ok {
			name = "book"
		}
		return template.HTML(fmt.Sprintf(
			`<svg class="px" aria-hidden="true" focusable="false"><use href="%sstatic/icons.svg?v=%s#%s"/></svg>`,
			base, spriteVersion, name))
	}
}

// spriteVersion changes whenever the icon set changes (cache busting).
var spriteVersion = func() string {
	h := fnv.New32a()
	h.Write([]byte(iconSprite()))
	return fmt.Sprintf("%x", h.Sum32())
}()

// renderGrid turns a grid into a crisp SVG. Empty fill args mean "use CSS".
func renderGrid(grid []string, mainFill, hiFill string) string {
	w := 0
	for _, row := range grid {
		if len(row) > w {
			w = len(row)
		}
	}
	runs := func(want byte) string {
		var d strings.Builder
		for y, row := range grid {
			for x := 0; x < len(row); {
				if row[x] != want {
					x++
					continue
				}
				start := x
				for x < len(row) && row[x] == want {
					x++
				}
				fmt.Fprintf(&d, "M%d %dh%dv1h-%dz", start, y, x-start, x-start)
			}
		}
		return d.String()
	}
	attr := func(fill, class string) string {
		if fill != "" {
			return fmt.Sprintf(` fill="%s"`, fill)
		}
		if class != "" {
			return fmt.Sprintf(` class="%s"`, class)
		}
		return ""
	}
	var b strings.Builder
	fmt.Fprintf(&b, `<svg class="px" viewBox="0 0 %d %d" aria-hidden="true" focusable="false" shape-rendering="crispEdges">`, w, len(grid))
	if d := runs('#'); d != "" {
		fmt.Fprintf(&b, `<path%s d="%s"/>`, attr(mainFill, ""), d)
	}
	if d := runs('o'); d != "" {
		fmt.Fprintf(&b, `<path%s d="%s"/>`, attr(hiFill, "px-hi"), d)
	}
	b.WriteString(`</svg>`)
	return b.String()
}

// Keyword hints so books get a fitting icon without any front matter.
var iconHints = []struct {
	icon  string
	words []string
}{
	{"smile", []string{"joke", "humor"}},
	{"virus", []string{"infect", "hiv", "immunodef", "virus", "microb"}},
	{"ear", []string{"otolaryng", "ent", "ear", "hearing"}},
	{"stomach", []string{"gastro", "gi", "digest", "hepat", "liver"}},
	{"heart", []string{"cardio", "heart", "vascular"}},
	{"brain", []string{"neuro", "brain", "psych", "mental"}},
	{"bone", []string{"ortho", "bone", "sport", "musculo", "rheum", "radiol"}},
	{"eye", []string{"eye", "ophth", "vision"}},
	{"pill", []string{"pharm", "drug", "medication"}},
	{"flask", []string{"lab", "patho", "chem"}},
	{"tooth", []string{"dent", "tooth", "oral"}},
	{"drop", []string{"heme", "hemat", "blood", "onc", "renal", "nephro", "kidney", "uro", "endocrin"}},
	{"baby", []string{"peds", "pediat", "neonat", "nicu", "obstet", "child", "gyn"}},
	{"lungs", []string{"lung", "pulm", "respir", "chest"}},
	{"leaf", []string{"derm", "skin", "prevent", "nutrition", "wellness", "geriat"}},
	{"cross", []string{"emerg", "er", "urgent", "trauma", "manage", "practice", "surg"}},
}

// iconFor picks a node's icon: front-matter `icon:` first, then keyword hints.
func iconFor(n *content.Node) string {
	if s := n.MetaString("icon"); s != "" {
		if _, ok := iconGrids[s]; ok {
			return s
		}
	}
	if !n.IsSection {
		return "page"
	}
	hay := strings.ToLower(n.Title + " " + n.Slug)
	words := strings.FieldsFunc(hay, func(r rune) bool { return !(r >= 'a' && r <= 'z') })
	for _, h := range iconHints {
		for _, w := range h.words {
			for _, tok := range words {
				if (len(w) <= 2 && tok == w) || (len(w) > 2 && strings.HasPrefix(tok, w)) {
					return h.icon
				}
			}
		}
	}
	return "book"
}
