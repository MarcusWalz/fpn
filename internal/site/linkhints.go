package site

import (
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/marcuswalz/fpn/internal/content"
)

// Missed links: places where a page mentions another page's title or alias
// in plain text but never links to it. Shown in the editor's Backlinks tab as
// suggestions (they are not problems, so `fpn check` doesn't fail on them).

var (
	hintLinkRe    = regexp.MustCompile(`!?\[[^\]]*\]\([^)]*\)`) // [text](url) and images
	hintCodeRe    = regexp.MustCompile("`[^`]*`")
	hintCommentRe = regexp.MustCompile(`<!--.*?-->`)
	hintURLRe     = regexp.MustCompile(`https?://\S+`)
)

type hintTarget struct {
	node  *content.Node
	terms []*regexp.Regexp
}

// linkSuggestions lists, for each page, the first unlinked mention of every
// other page it doesn't already link to.
func linkSuggestions(tree *content.Tree) []Problem {
	var targets []hintTarget
	for _, p := range tree.Pages {
		var res []*regexp.Regexp
		names := append([]string{p.Title}, p.Aliases()...)
		for i, name := range names {
			name = strings.TrimSpace(name)
			if len([]rune(name)) < 2 {
				continue
			}
			pat := regexp.QuoteMeta(name)
			pat = strings.ReplaceAll(pat, `\-`, `[-\s]`)
			pat = strings.ReplaceAll(pat, " ", `[-\s]+`)
			pat = `(?:^|[^\pL\pN])(` + pat + `)(?:$|[^\pL\pN])`
			// Short all-capital aliases ("PMOS", "DM") must match exactly, so
			// ordinary words aren't mistaken for them.
			if !(i > 0 && name == strings.ToUpper(name)) {
				pat = `(?i)` + pat
			}
			res = append(res, regexp.MustCompile(pat))
		}
		if len(res) > 0 {
			targets = append(targets, hintTarget{node: p, terms: res})
		}
	}

	var out []Problem
	for _, src := range tree.Pages {
		body := string(src.Body)
		lines := plainLines(body)
		for _, t := range targets {
			if t.node == src || linksTo(src, body, t.node) {
				continue
			}
			if found := firstMention(lines, t.terms); found != "" {
				out = append(out, Problem{
					Path:    src.Rel,
					Message: `mentions "` + found + `" — link it to ` + t.node.Title + `: [` + found + `](` + relLink(src, t.node) + `)`,
					Find:    found,
				})
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

// plainLines returns the body's lines with code, links, comments and URLs
// blanked out, so only plain prose is searched.
func plainLines(body string) []string {
	var out []string
	inFence := false
	for _, line := range strings.Split(body, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		for _, re := range []*regexp.Regexp{hintCommentRe, hintLinkRe, hintCodeRe, hintURLRe} {
			line = re.ReplaceAllString(line, " ")
		}
		out = append(out, line)
	}
	return out
}

func firstMention(lines []string, terms []*regexp.Regexp) string {
	for _, line := range lines {
		for _, re := range terms {
			if m := re.FindStringSubmatch(line); m != nil {
				return m[1]
			}
		}
	}
	return ""
}

// linksTo reports whether src already links to dst anywhere (by file or URL).
func linksTo(src *content.Node, body string, dst *content.Node) bool {
	file := path.Base(dst.Rel)
	return strings.Contains(body, "("+file) || strings.Contains(body, "/"+file) ||
		(dst.Slug != "" && strings.Contains(body, "/"+dst.Slug))
}

// relLink is the Markdown link target from src's folder to dst's file.
func relLink(src, dst *content.Node) string {
	r, err := filepath.Rel(filepath.FromSlash(path.Dir(src.Rel)), filepath.FromSlash(dst.Rel))
	if err != nil {
		return dst.Rel
	}
	return filepath.ToSlash(r)
}
