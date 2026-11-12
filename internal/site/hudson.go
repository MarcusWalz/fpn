package site

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Hudson (the editor's resident dog) writes his remarks with a small, fast
// model through the Claude Code CLI: no tools, no session, one line out.
// The editor sends only what changed; the server never reads or writes files here.
// If `claude` isn't installed, the editor falls back to its built-in remarks.

const hudsonPrompt = `You are Hudson, a large black lab mix who lives with four backyard hens (Buff, Blue, Ginger and Red). You watch someone edit their family-medicine study notes, and you throw shade.

Speak in the first person and never say your own name. Write ONE sentence, at most 18 words, reacting to the specific changes you are given. Quote or name something specific from them (a word, heading, phrase, or the sheer amount).

Rules:
- Non-constructive. Never give advice, tips, corrections, the right spelling, facts, doses, or how to fix anything. You notice; you don't help.
- Dry, deadpan, playful. Never cruel, nothing about the person's looks or intelligence, no swearing.
- Sometimes (not always) mention the hens, naps, walks, treats, or squirrels.
- Don't repeat the earlier remarks you're shown.
- Output only the line: no name prefix, no quotation marks around it, no emoji.

The length and tone to aim for (don't reuse these):
"walk more i guess." Inspiring. Buff walks more than that, and she's a chicken.
Three TODOs. Bold to schedule this much procrastination.
Deleted the whole Overview. Mood.
Twelve new lines about insulin. I'll be napping.`

type hudsonReq struct {
	Path     string   `json:"path"`
	Title    string   `json:"title"`
	Added    []string `json:"added"`
	Removed  []string `json:"removed"`
	Problems int      `json:"problems"`
	Unsaved  int      `json:"unsavedMinutes"`
	Event    string   `json:"event"` // "change", "poke", "save", "open"
	Recent   []string `json:"recent"`
}

var hudsonMu sync.Mutex // one remark at a time

func (a *editorAPI) hudson(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	claude, err := exec.LookPath("claude")
	if err != nil {
		http.Error(w, "claude not installed", http.StatusNotImplemented)
		return
	}
	var req hudsonReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if !hudsonMu.TryLock() {
		http.Error(w, "Hudson is busy", http.StatusTooManyRequests)
		return
	}
	defer hudsonMu.Unlock()

	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, claude, "-p", "--model", "haiku", "--tools", "",
		"--no-session-persistence", "--output-format", "text", "--system-prompt", hudsonPrompt)
	cmd.Stdin = strings.NewReader(hudsonInput(req))
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		http.Error(w, "Hudson is napping", http.StatusBadGateway)
		return
	}
	jsonOut(w, map[string]string{"text": cleanQuip(out.String())})
}

func hudsonInput(q hudsonReq) string {
	var b strings.Builder
	b.WriteString("Page: " + q.Title + " (" + q.Path + ")\n")
	switch q.Event {
	case "poke":
		b.WriteString("They just poked you to ask what you think.\n")
	case "save":
		b.WriteString("They just saved.\n")
	case "open":
		b.WriteString("They just opened this page; these are its changes since the last commit.\n")
	}
	if q.Unsaved > 0 {
		b.WriteString("Unsaved for " + itoa(q.Unsaved) + " minutes.\n")
	}
	if q.Problems > 0 {
		b.WriteString("Build problems on this page: " + itoa(q.Problems) + "\n")
	}
	b.WriteString("Hour of day: " + itoa(time.Now().Hour()) + "\n")
	lines := func(label string, ls []string, sign string) {
		if len(ls) == 0 {
			return
		}
		b.WriteString(label + " (" + itoa(len(ls)) + "):\n")
		n := 0
		for _, l := range ls {
			if n += len(l); n > 3000 {
				b.WriteString("…(more)\n")
				break
			}
			b.WriteString(sign + " " + l + "\n")
		}
	}
	lines("Added lines", q.Added, "+")
	lines("Removed lines", q.Removed, "-")
	if len(q.Added) == 0 && len(q.Removed) == 0 {
		b.WriteString("Nothing has changed since the last commit.\n")
	}
	if len(q.Recent) > 0 {
		b.WriteString("Your earlier remarks (don't repeat): " + strings.Join(q.Recent, " | ") + "\n")
	}
	return b.String()
}

func itoa(n int) string { return strconv.Itoa(n) }

// selfIntro matches "Hudson:", "**Hudson's verdict:**", "Hudson here," and the like.
var selfIntro = regexp.MustCompile(`(?i)^[*\s]*hudson(?:'s)?(?:\s+[a-z]+){0,2}[*\s]*[:,—–-]\s*\**\s*`)

// cleanQuip keeps the first non-empty line and strips "Hudson:" prefixes and wrapping quotes.
func cleanQuip(s string) string {
	for _, l := range strings.Split(s, "\n") {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		l = strings.TrimSpace(selfIntro.ReplaceAllString(l, ""))
		l = strings.Trim(l, "\"“”*")
		if len(l) > 280 {
			l = l[:280] + "…"
		}
		return l
	}
	return "…"
}
