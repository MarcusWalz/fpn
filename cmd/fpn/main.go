// Command fpn builds a static notebook site from a folder of Markdown.
package main

import (
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/marcuswalz/fpn/internal/content"
	"github.com/marcuswalz/fpn/internal/scaffold"
	"github.com/marcuswalz/fpn/internal/site"
	"github.com/marcuswalz/fpn/web"
)

const usage = `fpn — static notebook site generator

Usage:
  fpn build  [flags]   render content/ into public/
  fpn serve  [flags]   preview locally with live reload
  fpn check  [flags]   build to a temp dir; exit 1 on broken links or other warnings
                       (-no-stubs also fails while empty chapters or stub pages remain)
  fpn status [flags]   show how many chapters have content, per book
  fpn scaffold -from taxonomy.json [flags]
                       create placeholder folders/pages from a taxonomy (never overwrites)

Flags:
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	cmd := os.Args[1]
	fl := flag.NewFlagSet(cmd, flag.ExitOnError)
	contentDir := fl.String("content", "content", "content directory")
	out := fl.String("out", "public", "output directory (build)")
	base := fl.String("base", "/", "URL base path, e.g. /notebook/")
	siteURL := fl.String("url", "", "absolute site origin for sitemap.xml, e.g. https://example.org")
	addr := fl.String("addr", "localhost:1313", "listen address (serve)")
	refsDir := fl.String("refs", "references", "folder of CSL-JSON reference libraries for [@key] citations (e.g. a Zotero Better BibTeX auto-export)")
	allowIndex := fl.Bool("index", false, "allow search engines (default writes noindex meta + robots.txt Disallow)")
	noStubs := fl.Bool("no-stubs", false, "check: fail while any chapter is empty or any page is a stub")
	from := fl.String("from", "", "scaffold: taxonomy JSON file")
	pages := fl.Bool("pages", false, "scaffold: create a stub page per topic instead of planned: lists")
	all := fl.Bool("all", false, "status: list every chapter, not just books")
	webDir := fl.String("web", "", "use templates/static from this dir instead of the embedded ones (serve defaults to ./web if present)")
	fl.Usage = func() { fmt.Fprint(os.Stderr, usage); fl.PrintDefaults() }

	switch cmd {
	case "build", "serve", "check", "status", "scaffold":
	case "-h", "--help", "help":
		fl.Usage()
		return
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", cmd)
		fl.Usage()
		os.Exit(2)
	}
	fl.Parse(os.Args[2:])

	var webFS fs.FS = web.FS
	watch := []string{*contentDir, *refsDir}
	if *webDir == "" && cmd == "serve" {
		if st, err := os.Stat(filepath.Join("web", "templates")); err == nil && st.IsDir() {
			*webDir = "web"
		}
	}
	if *webDir != "" {
		webFS = os.DirFS(*webDir)
		watch = append(watch, *webDir)
	}

	cfg := site.Config{ContentDir: *contentDir, OutDir: *out, Base: *base, SiteURL: *siteURL, Web: webFS, AllowIndex: *allowIndex, RefsDir: *refsDir}

	switch cmd {
	case "build":
		res, err := site.Build(cfg)
		exitOn(err)
		printWarnings(res.Warnings)
		fmt.Printf("built %d pages, %d sections, %d assets → %s in %s\n",
			res.Pages, res.Sections, res.Assets, *out, res.Duration.Round(time.Millisecond))
		printProgress(res)
	case "check":
		tmp, err := os.MkdirTemp("", "fpn-check-*")
		exitOn(err)
		defer os.RemoveAll(tmp)
		cfg.OutDir = filepath.Join(tmp, "public")
		res, err := site.Build(cfg)
		exitOn(err)
		printWarnings(res.Warnings)
		printProgress(res)
		problems := len(res.Warnings)
		if empty := res.Chapters - res.WrittenChapters; *noStubs && empty+res.Stubs > 0 {
			fmt.Fprintf(os.Stderr, "error: %d empty chapter(s), %d stub page(s) (-no-stubs)\n", empty, res.Stubs)
			problems++
		}
		if problems > 0 {
			fmt.Printf("check failed: %d problem(s)\n", problems)
			os.RemoveAll(tmp)
			os.Exit(1)
		}
		fmt.Printf("ok: %d pages, %d sections, no problems\n", res.Pages, res.Sections)
	case "serve":
		exitOn(site.Serve(cfg, *addr, watch))
	case "status":
		tree, err := content.Load(*contentDir, "/")
		exitOn(err)
		printStatus(tree.Root, *all)
	case "scaffold":
		if *from == "" {
			exitOn(fmt.Errorf("scaffold needs -from taxonomy.json"))
		}
		res, err := scaffold.FromFile(*from, *contentDir, scaffold.Options{Pages: *pages})
		exitOn(err)
		fmt.Printf("scaffolded %d sections, %d planned topics, %d stub pages into %s (%d existing files left untouched)\n",
			res.Sections, res.Planned, res.Pages, *contentDir, res.Skipped)
	}
}

func printProgress(res *site.Result) {
	if res.Chapters == 0 {
		return
	}
	fmt.Printf("progress: %d/%d chapters have content (%.1f%%) · %d page(s) written, %d stub page(s)\n",
		res.WrittenChapters, res.Chapters, float64(res.WrittenChapters)*100/float64(res.Chapters),
		res.Pages-res.Stubs, res.Stubs)
}

func printStatus(root *content.Node, all bool) {
	bar := func(n *content.Node) string {
		const w = 20
		filled := 0
		if n.ChapterCount() > 0 {
			filled = n.WrittenChapters() * w / n.ChapterCount()
		}
		return "[" + strings.Repeat("#", filled) + strings.Repeat(".", w-filled) + "]"
	}
	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "BOOK\tCHAPTERS WITH CONTENT\tPAGES\tPROGRESS\t")
	for _, b := range root.Sections() {
		fmt.Fprintf(tw, "%s\t%d/%d\t%d\t%s %d%%\t\n", b.Title, b.WrittenChapters(), b.ChapterCount(), b.DoneCount(), bar(b), b.Percent())
		if all {
			for _, c := range b.Sections() {
				state := "empty"
				if c.Written() {
					state = "✓"
				}
				fmt.Fprintf(tw, "  %s\t%s\t%d\t\t\n", c.Title, state, c.DoneCount())
			}
		}
	}
	fmt.Fprintf(tw, "TOTAL\t%d/%d\t%d\t%s %d%%\t\n", root.WrittenChapters(), root.ChapterCount(), root.DoneCount(), bar(root), root.Percent())
	tw.Flush()
}

func printWarnings(ws []string) {
	for _, w := range ws {
		fmt.Fprintln(os.Stderr, "warn:", w)
	}
}

func exitOn(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
