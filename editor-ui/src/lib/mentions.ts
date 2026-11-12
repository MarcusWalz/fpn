// Find a plain-text mention of `term` in a Markdown page: outside the front
// matter, code, links, comments and URLs (like the server's Backlinks check),
// as a whole word. Returns its offsets, or null.
export function findMention(text: string, term: string): { from: number; to: number } | null {
  if (!term) return null;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let t = text;
  const fm = /^---\n[\s\S]*?\n---\n/.exec(t);
  if (fm) t = blank(fm[0]) + t.slice(fm[0].length);
  t = t.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/!?\[[^\]\n]*\]\([^)\n]*\)/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/https?:\/\/\S+/g, blank);
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc})(?=$|[^\\p{L}\\p{N}])`, "u").exec(t);
  if (!m) return null;
  const from = m.index + m[1].length;
  return { from, to: from + m[2].length };
}
