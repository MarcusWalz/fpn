package site

import "testing"

func TestCleanQuip(t *testing.T) {
	for in, want := range map[string]string{
		`Hudson's one line: the "maybe??" is bold.`:  `the "maybe??" is bold.`,
		`Hudson here, and that line is bold.`:         `and that line is bold.`,
		`**Hudson:** "Three TODOs. Bold."`:            `Three TODOs. Bold.`,
		"\n\nDeleted the Overview. Mood.\nextra line": `Deleted the Overview. Mood.`,
		`Hudsonville is not a word I use.`:            `Hudsonville is not a word I use.`,
	} {
		if got := cleanQuip(in); got != want {
			t.Errorf("cleanQuip(%q) = %q, want %q", in, got, want)
		}
	}
}
