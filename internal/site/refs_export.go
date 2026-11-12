package site

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// CitedResult reports what ExportCited wrote.
type CitedResult struct {
	Keys    []string // cited keys found in the library, sorted
	Missing []string // cited keys not in any library file, sorted
	Changed bool     // outFile was created or its contents changed
}

// ExportCited writes outFile: a CSL-JSON list holding only the library items
// that pages in contentDir actually cite. This lets a large private library
// (e.g. a whole Zotero export) stay out of git while the small file of cited
// sources is committed, so the published site still renders its references.
//
// Items are copied verbatim from the library files and sorted by key, so the
// output is stable and diffs stay small. outFile itself may sit in refsDir;
// it is read like any other library file, which is harmless.
func ExportCited(contentDir, refsDir, outFile string) (*CitedResult, error) {
	raw, err := loadRawLibrary(refsDir)
	if err != nil {
		return nil, err
	}
	lib := Library{}
	for key := range raw {
		lib[key] = &CSLItem{ID: key}
	}

	// Find citations with the same parser the build uses, so code blocks,
	// [@name](url) links and multi-key groups are handled identically.
	cs := newCiteState(lib)
	err = filepath.WalkDir(contentDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.EqualFold(filepath.Ext(p), ".md") {
			return nil
		}
		src, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		cs.preprocess(src)
		return nil
	})
	if err != nil {
		return nil, err
	}

	res := &CitedResult{Keys: append([]string(nil), cs.order...)}
	sort.Strings(res.Keys)
	for k := range cs.unknown {
		res.Missing = append(res.Missing, k)
	}
	sort.Strings(res.Missing)

	var buf bytes.Buffer
	buf.WriteString("[")
	for i, key := range res.Keys {
		if i > 0 {
			buf.WriteString(",")
		}
		buf.WriteString("\n  ")
		if err := json.Indent(&buf, raw[key], "  ", "  "); err != nil {
			return nil, fmt.Errorf("item %q: %w", key, err)
		}
	}
	if len(res.Keys) > 0 {
		buf.WriteString("\n")
	}
	buf.WriteString("]\n")

	// Leave an up-to-date file alone, so its mtime only moves on real changes
	// (fpn serve watches this folder and would otherwise rebuild forever).
	if old, err := os.ReadFile(outFile); err == nil && bytes.Equal(old, buf.Bytes()) {
		return res, nil
	}
	if err := os.MkdirAll(filepath.Dir(outFile), 0o755); err != nil {
		return nil, err
	}
	res.Changed = true
	return res, os.WriteFile(outFile, buf.Bytes(), 0o644)
}

// CitedFile is where `fpn refs` writes, and where `fpn serve` keeps it fresh.
func CitedFile(refsDir string) string { return filepath.Join(refsDir, "cited.json") }

// refreshCited re-exports the cited references after a dev rebuild, but only
// for people who opted in by creating the file with `fpn refs`.
func refreshCited(cfg Config) {
	if cfg.RefsDir == "" || !exists(CitedFile(cfg.RefsDir)) {
		return
	}
	res, err := ExportCited(cfg.ContentDir, cfg.RefsDir, CitedFile(cfg.RefsDir))
	if err != nil {
		log.Printf("refs: %v", err)
		return
	}
	if res.Changed {
		log.Printf("refs: updated %s (%d cited reference(s))", CitedFile(cfg.RefsDir), len(res.Keys))
	}
}

// loadRawLibrary reads every *.json in dir like loadLibrary, but keeps each
// item's original JSON so no fields are lost when it is written back out.
func loadRawLibrary(dir string) (map[string]json.RawMessage, error) {
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	sort.Strings(files)
	items := map[string]json.RawMessage{}
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		var list []json.RawMessage
		if err := json.Unmarshal(data, &list); err != nil {
			return nil, fmt.Errorf("%s: not a CSL-JSON list: %w", filepath.Base(f), err)
		}
		for _, it := range list {
			var head struct {
				ID string `json:"id"`
			}
			if json.Unmarshal(it, &head) == nil && head.ID != "" {
				items[head.ID] = it
			}
		}
	}
	return items, nil
}
