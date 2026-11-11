package site

import (
	"fmt"
	"hash/fnv"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Serve builds the site into a temp dir, serves it, and rebuilds whenever
// files under watch change. Browsers reload via server-sent events.
func Serve(cfg Config, addr string, watch []string) error {
	cfg.Dev = true
	cfg.Base = NormalizeBase(cfg.Base)

	var (
		current atomic.Value // string: dir currently served
		version atomic.Int64
		mu      sync.Mutex
	)
	rebuild := func() {
		mu.Lock()
		defer mu.Unlock()
		dir, err := os.MkdirTemp("", "fpn-serve-*")
		if err != nil {
			log.Printf("build: %v", err)
			return
		}
		c := cfg
		c.OutDir = filepath.Join(dir, "public")
		res, err := Build(c)
		if err != nil {
			log.Printf("build failed: %v", err)
			os.RemoveAll(dir)
			return
		}
		for _, w := range res.Warnings {
			log.Printf("warn: %s", w)
		}
		log.Printf("built %d pages, %d sections in %s", res.Pages, res.Sections, res.Duration.Round(time.Millisecond))
		if old, ok := current.Load().(string); ok {
			defer os.RemoveAll(filepath.Dir(old))
		}
		current.Store(c.OutDir)
		version.Add(1)
	}
	rebuild()
	if current.Load() == nil {
		return fmt.Errorf("initial build failed")
	}
	defer func() {
		if d, ok := current.Load().(string); ok {
			os.RemoveAll(filepath.Dir(d))
		}
	}()

	go func() {
		last := fingerprint(watch)
		for range time.Tick(400 * time.Millisecond) {
			if fp := fingerprint(watch); fp != last {
				last = fp
				rebuild()
			}
		}
	}()

	files := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		root := current.Load().(string)
		p := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(r.URL.Path, "/")))
		if st, err := os.Stat(p); err != nil || (st.IsDir() && !exists(filepath.Join(p, "index.html"))) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			if data, err := os.ReadFile(filepath.Join(root, "404.html")); err == nil {
				w.Write(data)
			}
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		http.FileServer(http.Dir(root)).ServeHTTP(w, r)
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/__reload", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		flusher, _ := w.(http.Flusher)
		seen := version.Load()
		t := time.NewTicker(250 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-t.C:
				if v := version.Load(); v != seen {
					fmt.Fprint(w, "data: reload\n\n")
					if flusher != nil {
						flusher.Flush()
					}
					return
				}
			}
		}
	})
	if cfg.Base == "/" {
		mux.Handle("/", files)
	} else {
		mux.Handle(cfg.Base, http.StripPrefix(strings.TrimSuffix(cfg.Base, "/"), files))
		mux.Handle("/", http.RedirectHandler(cfg.Base, http.StatusFound))
	}

	log.Printf("serving at http://%s%s (watching %s)", addr, cfg.Base, strings.Join(watch, ", "))
	return http.ListenAndServe(addr, mux)
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

func fingerprint(dirs []string) uint64 {
	h := fnv.New64a()
	for _, d := range dirs {
		filepath.WalkDir(d, func(p string, e fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if info, err := e.Info(); err == nil {
				fmt.Fprintf(h, "%s|%d|%d\n", p, info.Size(), info.ModTime().UnixNano())
			}
			return nil
		})
	}
	return h.Sum64()
}
