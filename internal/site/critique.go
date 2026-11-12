package site

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
)

// The editor's "Critique" button runs the critique-page skill through the
// Claude Code CLI (`claude -p`), read-only, on the saved file. Results are
// cached per file until the file changes.

type critiqueResult struct {
	Markdown string `json:"markdown"`
	HTML     string `json:"html"`
	When     string `json:"when"`
	Cached   bool   `json:"cached"`
	mtime    time.Time
}

var critiqueCache sync.Map // rel -> critiqueResult

func (a *editorAPI) critique(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	rel, err := cleanRel(r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	fi, err := os.Stat(a.abs(rel))
	if err != nil {
		http.Error(w, "save the page first — there's no saved file to critique yet", http.StatusNotFound)
		return
	}
	// GET returns the cached critique (if the file hasn't changed); POST runs one.
	if c, ok := critiqueCache.Load(rel); ok && c.(critiqueResult).mtime.Equal(fi.ModTime()) {
		res := c.(critiqueResult)
		res.Cached = true
		jsonOut(w, res)
		return
	}
	if r.Method != http.MethodPost {
		jsonOut(w, map[string]any{})
		return
	}
	claude, err := exec.LookPath("claude")
	if err != nil {
		http.Error(w, "Claude Code isn't installed on this computer, so the critique can't run here. In Claude Code, type: /critique-page content/"+rel, http.StatusNotImplemented)
		return
	}
	absContent, _ := filepath.Abs(a.cfg.ContentDir)
	root := filepath.Dir(absContent)
	target := filepath.ToSlash(filepath.Join(filepath.Base(absContent), filepath.FromSlash(rel)))

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, claude, "-p", "/critique-page "+target,
		"--allowedTools", "Read", "Glob", "Grep", "--output-format", "text")
	cmd.Dir = root
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		msg := errOut.String()
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			msg = "the critique took too long (over 5 minutes); try again"
		}
		if msg == "" {
			msg = err.Error()
		}
		http.Error(w, "critique failed: "+msg, http.StatusBadGateway)
		return
	}
	var html bytes.Buffer
	// Safe renderer (no raw HTML passthrough) for model output.
	if err := goldmark.New(goldmark.WithExtensions(extension.GFM)).Convert(out.Bytes(), &html); err != nil {
		html.WriteString("<pre>" + out.String() + "</pre>")
	}
	res := critiqueResult{Markdown: out.String(), HTML: html.String(), When: time.Now().Format("15:04"), mtime: fi.ModTime()}
	critiqueCache.Store(rel, res)
	jsonOut(w, res)
}
