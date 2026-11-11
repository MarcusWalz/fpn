// Diff viewer for the fpn dev editor: the editor buffer vs. the last commit
// (git HEAD) or vs. the saved file. Self-contained line diff (LCS).

const CONTEXT = 3;

// Line-level diff. Returns [{t:" "|"-"|"+", a?:oldLineNo, b?:newLineNo, s:text}].
export function diffLines(oldText, newText) {
  const a = oldText.split("\n"), b = newText.split("\n");
  // Trim the common prefix/suffix so the LCS table stays small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const A = a.slice(start, endA), B = b.slice(start, endB);
  const n = A.length, m = B.length;
  const out = [];
  for (let i = 0; i < start; i++) out.push({ t: " ", a: i + 1, b: i + 1, s: a[i] });

  if (n * m > 25e6) {
    // Too big for a table: show as a full replacement.
    A.forEach((s, i) => out.push({ t: "-", a: start + i + 1, s }));
    B.forEach((s, j) => out.push({ t: "+", b: start + j + 1, s }));
  } else {
    // lcs[i][j] = LCS length of A[i..] and B[j..], stored row-major.
    const w = m + 1, lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * w + j] = A[i] === B[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { out.push({ t: " ", a: start + i + 1, b: start + j + 1, s: A[i] }); i++; j++; }
      else if (j < m && (i === n || lcs[i * w + j + 1] > lcs[(i + 1) * w + j])) { out.push({ t: "+", b: start + j + 1, s: B[j] }); j++; }
      else { out.push({ t: "-", a: start + i + 1, s: A[i] }); i++; }
    }
  }
  for (let k = 0; k < a.length - endA; k++) out.push({ t: " ", a: endA + k + 1, b: endB + k + 1, s: a[endA + k] });
  return out;
}

export function initDiff({ path, getText, getSaved, onStats }) {
  const box = document.getElementById("diff");
  const baseSel = document.getElementById("diff-base");
  const ctx = document.getElementById("diff-context");
  const statsEl = document.getElementById("diff-stats");
  let head = null, headLoaded = false, headMissing = false;

  try { baseSel.value = localStorage.getItem("fpn-diff-base") || "head"; } catch {}

  async function loadHead(force = false) {
    if (headLoaded && !force) return;
    const r = await fetch("/__api/git/show?path=" + encodeURIComponent(path));
    headLoaded = true;
    headMissing = !r.ok;
    head = r.ok ? await r.text() : "";
  }

  // Compute stats vs HEAD for the tab badge, even when the diff tab is hidden.
  async function stats() {
    await loadHead();
    const d = diffLines(head, getText());
    const add = d.filter((x) => x.t === "+").length, del = d.filter((x) => x.t === "-").length;
    onStats?.({ add, del, isNew: headMissing });
  }

  async function render() {
    const base = baseSel.value;
    let old;
    if (base === "head") { await loadHead(); old = head; } else { old = getSaved(); }
    const cur = getText();
    const d = diffLines(old, cur);
    const add = d.filter((x) => x.t === "+").length, del = d.filter((x) => x.t === "-").length;
    statsEl.innerHTML = "";
    statsEl.append(
      Object.assign(document.createElement("span"), { className: "add", textContent: "+" + add }),
      Object.assign(document.createElement("span"), { className: "del", textContent: "−" + del }),
    );
    box.replaceChildren();
    if (base === "head" && headMissing) box.append(note("New file — not in the last commit yet. Everything shows as added."));
    if (!add && !del) { box.append(note(base === "head" ? "No changes since the last commit." : "No unsaved changes.")); return; }

    // Which lines to show: changes plus CONTEXT lines around them.
    const show = new Array(d.length).fill(!ctx.checked);
    if (ctx.checked) d.forEach((x, i) => { if (x.t !== " ") for (let k = Math.max(0, i - CONTEXT); k <= Math.min(d.length - 1, i + CONTEXT); k++) show[k] = true; });

    const table = document.createElement("div");
    table.className = "diff-lines";
    let hidden = 0;
    const flushHidden = () => {
      if (!hidden) return;
      table.append(Object.assign(document.createElement("div"), { className: "dl skip", textContent: `⋯ ${hidden} unchanged line${hidden === 1 ? "" : "s"}` }));
      hidden = 0;
    };
    d.forEach((x, i) => {
      if (!show[i]) { hidden++; return; }
      flushHidden();
      const row = document.createElement("div");
      row.className = "dl " + ({ "+": "ins", "-": "del", " ": "ctx" }[x.t]);
      const na = Object.assign(document.createElement("span"), { className: "ln", textContent: x.a ?? "" });
      const nb = Object.assign(document.createElement("span"), { className: "ln", textContent: x.b ?? "" });
      const mk = Object.assign(document.createElement("span"), { className: "mk", textContent: x.t === " " ? "" : x.t === "-" ? "−" : "+" });
      const tx = Object.assign(document.createElement("span"), { className: "tx", textContent: x.s || " " });
      row.append(na, nb, mk, tx);
      table.append(row);
    });
    flushHidden();
    box.append(table);
  }

  function note(text) {
    return Object.assign(document.createElement("p"), { className: "diff-note", textContent: text });
  }

  baseSel.addEventListener("change", () => { try { localStorage.setItem("fpn-diff-base", baseSel.value); } catch {} render(); });
  ctx.addEventListener("change", render);

  return {
    render,
    stats,
    // After a commit the HEAD version changes; re-fetch it.
    reloadHead: async () => { await loadHead(true); },
  };
}
