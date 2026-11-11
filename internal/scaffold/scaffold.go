// Package scaffold creates placeholder content from a taxonomy tree.
//
// The input is JSON: a list of nodes {"title", "href"?, "children"?}.
// Nodes with children become folders (with an _index.md). By default, leaf
// topics are recorded as a `planned:` list in their folder's _index.md, so
// the outline lives in git without thousands of empty files. With Pages,
// each leaf becomes its own page marked `status: stub` instead. Existing
// files are never overwritten, so scaffolding can be re-run safely.
package scaffold

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/marcuswalz/fpn/internal/content"
	"gopkg.in/yaml.v3"
)

// Node is one entry of the taxonomy.
type Node struct {
	Title    string  `json:"title"`
	Href     string  `json:"href,omitempty"`
	Children []*Node `json:"children,omitempty"`
}

// Result counts what happened.
type Result struct {
	Sections, Pages, Planned, Skipped int
}

// Options control scaffolding.
type Options struct {
	Pages bool // create a stub page per leaf instead of `planned:` entries
}

// FromFile scaffolds content from a JSON taxonomy file into dir.
func FromFile(jsonPath, dir string, opt Options) (*Result, error) {
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return nil, err
	}
	var nodes []*Node
	if err := json.Unmarshal(data, &nodes); err != nil {
		return nil, fmt.Errorf("%s: %w", jsonPath, err)
	}
	res := &Result{}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return res, writeLevel(nodes, dir, res, opt)
}

const maxSlug = 80

func writeLevel(nodes []*Node, dir string, res *Result, opt Options) error {
	used := map[string]bool{}
	unique := func(title string) string {
		base := content.Slugify(title)
		if len(base) > maxSlug {
			base = strings.TrimRight(base[:maxSlug], "-.")
		}
		name := base
		for i := 2; used[name]; i++ {
			name = fmt.Sprintf("%s-%d", base, i)
		}
		used[name] = true
		return name
	}
	for _, n := range nodes {
		title := strings.TrimSpace(n.Title)
		if title == "" {
			continue
		}
		name := unique(title)
		if len(n.Children) > 0 {
			sub := filepath.Join(dir, name)
			if err := os.MkdirAll(sub, 0o755); err != nil {
				return err
			}
			fm := frontMatter{Title: title, Legacy: n.Href}
			var folders []*Node
			for _, c := range n.Children {
				if len(c.Children) == 0 && !opt.Pages {
					fm.Planned = append(fm.Planned, plannedItem{Title: strings.TrimSpace(c.Title), Legacy: c.Href})
				} else {
					folders = append(folders, c)
				}
			}
			wrote, err := writeNew(filepath.Join(sub, "_index.md"), fm)
			if err != nil {
				return err
			}
			if wrote {
				res.Sections++
				res.Planned += len(fm.Planned)
			} else {
				res.Skipped++
			}
			if err := writeLevel(folders, sub, res, opt); err != nil {
				return err
			}
			continue
		}
		wrote, err := writeNew(filepath.Join(dir, name+".md"), frontMatter{Title: title, Status: "stub", Legacy: n.Href})
		if err != nil {
			return err
		}
		if wrote {
			res.Pages++
		} else {
			res.Skipped++
		}
	}
	return nil
}

type plannedItem struct {
	Title  string `yaml:"title"`
	Legacy string `yaml:"legacy,omitempty"`
}

type frontMatter struct {
	Title   string        `yaml:"title"`
	Status  string        `yaml:"status,omitempty"`
	Legacy  string        `yaml:"legacy,omitempty"`
	Planned []plannedItem `yaml:"planned,omitempty"`
}

// writeNew writes a placeholder file unless one already exists.
func writeNew(path string, fm frontMatter) (bool, error) {
	if _, err := os.Stat(path); err == nil {
		return false, nil
	}
	y, err := yaml.Marshal(fm)
	if err != nil {
		return false, err
	}
	var b bytes.Buffer
	b.WriteString("---\n")
	b.Write(y)
	b.WriteString("---\n")
	return true, os.WriteFile(path, b.Bytes(), 0o644)
}
