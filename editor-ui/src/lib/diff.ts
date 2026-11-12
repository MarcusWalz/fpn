// Line diff (LCS) used for the Diff tab badge (+added −removed).
export function diffStats(oldText: string, newText: string): { add: number; del: number } {
  const a = oldText.split("\n"), b = newText.split("\n");
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb), n = A.length, m = B.length;
  if (n * m > 25e6) return { add: m, del: n };
  const w = m + 1, l = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      l[i * w + j] = A[i] === B[j] ? l[(i + 1) * w + j + 1] + 1 : Math.max(l[(i + 1) * w + j], l[i * w + j + 1]);
  const common = l[0];
  return { add: m - common, del: n - common };
}
