// fpn dev editor: file tree, live page preview / diff, and a Markdown editor.
// Served only by `fpn serve`; never part of the static build.

import { initTree, DRAG_TYPE, slugify } from "./tree.js";
import { initDiff } from "./diff.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const path = (params.get("path") || "_index.md").replace(/^\/+|^content\//g, "");
const pageDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const newTitle = params.get("title") || "";
const H = { "X-FPN-Editor": "1" };
const IMG = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

const status = $("status"), saveBtn = $("save"), frame = $("preview");
let mtime = "", saved = "", dirty = false, editor, tree, diff;
let tab = "preview";

// ---------- editor (CodeMirror 6, falling back to a textarea offline) ----------
async function makeEditor(parent, doc, onChange) {
  try {
    // language/highlight URLs match the ones codemirror itself imports on
    // esm.sh, so all modules share one instance.
    const [{ EditorView, basicSetup }, { markdown }, { HighlightStyle, syntaxHighlighting }, { tags: t }] = await Promise.all([
      import("https://esm.sh/codemirror@6.0.1"),
      import("https://esm.sh/@codemirror/lang-markdown@6.2.5"),
      import("https://esm.sh/@codemirror/language@^6.0.0?target=es2022"),
      import("https://esm.sh/@lezer/highlight@^1.0.0?target=es2022"),
    ]);
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    // Markdown colors with strong contrast on both backgrounds
    // (dark: #0d1f15 green-black, light: white).
    const c = dark
      ? { heading: "#bbf7d0", link: "#4ade80", url: "#fde68a", mark: "#86efac", code: "#fcd34d", quote: "#a7f3d0", meta: "#a3c9b2", strong: "#f0fdf4" }
      : { heading: "#14532d", link: "#15803d", url: "#92400e", mark: "#16a34a", code: "#9a3412", quote: "#3f6212", meta: "#476352", strong: "#052e16" };
    const mdStyle = HighlightStyle.define([
      { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: c.heading, fontWeight: "700" },
      { tag: t.link, color: c.link, textDecoration: "underline" },
      { tag: t.url, color: c.url },
      { tag: [t.processingInstruction, t.contentSeparator], color: c.mark },
      { tag: t.monospace, color: c.code },
      { tag: t.quote, color: c.quote, fontStyle: "italic" },
      { tag: t.emphasis, fontStyle: "italic" },
      { tag: t.strong, fontWeight: "700", color: c.strong },
      { tag: t.strikethrough, textDecoration: "line-through" },
      { tag: [t.meta, t.comment, t.labelName, t.string, t.escape], color: c.meta },
    ]);
    const theme = EditorView.theme({
      "&": { height: "100%", fontSize: "14px", backgroundColor: "var(--surface)", color: "var(--ink)" },
      ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
      ".cm-content": { padding: "12px 0", caretColor: "#22c55e" },
      ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", borderRight: "2px solid var(--line)" },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: dark ? "#12301f" : "#ecfdf5" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: dark ? "#365314" : "#d9f99d" },
      "&.cm-focused": { outline: "none" },
    }, { dark });
    const view = new EditorView({
      doc,
      parent,
      extensions: [basicSetup, markdown(), syntaxHighlighting(mdStyle), EditorView.lineWrapping, theme,
        EditorView.updateListener.of((u) => u.docChanged && onChange())],
    });
    return {
      get: () => view.state.doc.toString(),
      focus: () => view.focus(),
      // First visible line (1-based, fractional within the line).
      topLine() {
        const top = view.scrollDOM.scrollTop;
        const blk = view.lineBlockAtHeight(top);
        const line = view.state.doc.lineAt(blk.from).number;
        return line + Math.max(0, Math.min(1, (top - blk.top) / Math.max(1, blk.height)));
      },
      scrollToLine(n) {
        const doc = view.state.doc;
        const line = doc.line(Math.max(1, Math.min(doc.lines, Math.floor(n))));
        const blk = view.lineBlockAt(line.from);
        view.scrollDOM.scrollTop = blk.top + (n % 1) * blk.height;
      },
      onScroll: (fn) => view.scrollDOM.addEventListener("scroll", fn, { passive: true }),
      onCursor: (fn) => view.dom.addEventListener("keyup", fn),
      // Select a range and scroll it into the middle of the view.
      select(from, to) {
        view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
        view.focus();
      },
      // Document position for screen coordinates (or the cursor).
      posAt(coords) {
        const p = coords ? view.posAtCoords(coords) : null;
        return p == null ? view.state.selection.main.head : p;
      },
      // Insert a Markdown block (image + caption) on its own lines: at the end
      // of the line containing pos, with blank lines around it. Returns the
      // position right after the block, for inserting the next one.
      insertBlock(text, pos) {
        const doc = view.state.doc;
        const line = doc.lineAt(Math.max(0, Math.min(pos, doc.length)));
        const at = line.to;
        const before = line.length && line.text.trim() ? "\n\n" : line.length ? "\n" : "";
        const after = at < doc.length ? "\n" : "\n";
        const insert = before + text + after;
        view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + before.length + text.length } });
        view.focus();
        return at + before.length + text.length;
      },
      // Insert text at a position, at screen coordinates (a drop), or at the cursor.
      insert(text, where) {
        let pos = typeof where === "number" ? where : where ? view.posAtCoords(where) : null;
        if (pos == null) pos = view.state.selection.main.head;
        view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
        view.focus();
      },
    };
  } catch (err) {
    console.warn("CodeMirror unavailable, using plain textarea:", err);
    const ta = document.createElement("textarea");
    ta.className = "fallback";
    ta.value = doc;
    ta.addEventListener("input", onChange);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); onChange(); }
    });
    parent.append(ta);
    const lh = () => parseFloat(getComputedStyle(ta).lineHeight) || 22;
    return {
      get: () => ta.value,
      focus: () => ta.focus(),
      topLine: () => 1 + ta.scrollTop / lh(),
      scrollToLine: (n) => { ta.scrollTop = (n - 1) * lh(); },
      onScroll: (fn) => ta.addEventListener("scroll", fn, { passive: true }),
      onCursor: (fn) => ta.addEventListener("keyup", fn),
      select(from, to) { ta.focus(); ta.setSelectionRange(from, to); ta.scrollTop = (ta.value.slice(0, from).split("\n").length - 5) * lh(); },
      posAt: () => ta.selectionStart,
      insertBlock(text, pos) {
        const v = ta.value;
        let at = v.indexOf("\n", Math.min(pos, v.length));
        if (at < 0) at = v.length;
        const lineStart = v.lastIndexOf("\n", at - 1) + 1;
        const before = v.slice(lineStart, at).trim() ? "\n\n" : "";
        ta.setRangeText(before + text + "\n", at, at, "end");
        onChange(); ta.focus();
        return at + before.length + text.length;
      },
      insert(text, where) {
        const at = typeof where === "number" ? where : ta.selectionStart;
        ta.setRangeText(text, at, typeof where === "number" ? at : ta.selectionEnd, "end"); onChange(); ta.focus();
      },
    };
  }
}

// ---------- status & toast ----------
function setStatus(text, cls = "") { status.textContent = text; status.className = "status " + cls; }
function markDirty() {
  dirty = editor.get() !== saved;
  saveBtn.disabled = !dirty;
  setStatus(dirty ? "unsaved" : "saved", dirty ? "dirty" : "");
  document.title = (dirty ? "● " : "") + path + " · fpn editor";
}
let toastTimer;
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3500);
}

// ---------- preview ----------
let previewTimer, previewSeq = 0;
function scheduleUpdate(delay = 200) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (tab === "preview") renderPreview(); else diff.render();
    diff.stats();
  }, delay);
}
async function renderPreview() {
  const seq = ++previewSeq;
  try {
    const r = await fetch("/__api/preview?path=" + encodeURIComponent(path), { method: "POST", headers: H, body: editor.get() });
    if (!r.ok) throw new Error(await r.text());
    const { html, url, warnings } = await r.json();
    if (seq !== previewSeq) return;
    $("view").href = url;
    showWarnings(warnings || []);
    frame.onload = () => { sync.attachPreview(); sync.toPreview(true); };
    frame.srcdoc = html;
  } catch (err) {
    showWarnings(["preview: " + err.message]);
  }
}
function showWarnings(list) {
  const ul = $("warnings");
  ul.replaceChildren(...list.map((w) => Object.assign(document.createElement("li"), { textContent: "⚠ " + w })));
  ul.hidden = list.length === 0;
}

// ---------- tabs ----------
function setTab(next) {
  tab = next;
  $("tab-preview").setAttribute("aria-selected", String(next === "preview"));
  $("tab-diff").setAttribute("aria-selected", String(next === "diff"));
  $("preview-wrap").hidden = next !== "preview";
  $("diff-wrap").hidden = next !== "diff";
  if (next === "diff") diff.render(); else renderPreview();
  try { localStorage.setItem("fpn-editor-tab", next); } catch {}
}

// ---------- save ----------
async function save(force = false) {
  if (!dirty && !force) return;
  const text = editor.get();
  setStatus("saving…");
  const headers = { ...H };
  if (mtime && !force) headers["X-FPN-Mtime"] = mtime;
  const r = await fetch("/__api/file?path=" + encodeURIComponent(path), { method: "PUT", headers, body: text });
  if (r.status === 409) {
    setStatus("conflict", "error");
    if (confirm("This file changed on disk since you opened it (another editor, or git).\n\nOverwrite it with your version?")) return save(true);
    return;
  }
  if (!r.ok) { setStatus("save failed", "error"); toast("Save failed: " + (await r.text()), true); return; }
  const wasNew = !saved && !mtime;
  mtime = r.headers.get("X-FPN-Mtime") || "";
  saved = text;
  markDirty();
  setStatus("saved ✓");
  if (tab === "diff") diff.render();
  setTimeout(() => (wasNew ? tree.reload() : tree.refreshStatus()), 300);
  setTimeout(problems.refresh, 1500);
}

// ---------- dropping / pasting into the editor ----------
const relFrom = (fromDir, to) => {
  const a = fromDir ? fromDir.split("/") : [], b = to.split("/");
  while (a.length && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift(); }
  return "../".repeat(a.length) + b.join("/");
};
const mdLink = (target, label, isImg) => `${isImg ? "!" : ""}[${label}](${encodeURI(target)})`;

async function uploadAndInsert(files, coords) {
  const parts = [];
  let pos = editor.posAt(coords);
  for (const f of files) {
    const dir = pageDir ? pageDir + "/images" : "images";
    try {
      const r = await fetch(`/__api/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(f.name || "pasted.png")}&mkdir=1`, { method: "POST", headers: H, body: f });
      if (!r.ok) throw new Error(await r.text());
      const { path: p, name } = await r.json();
      const alt = name.replace(/\.[^.]+$/, "").replace(/-/g, " ");
      if (IMG.test(name)) {
        tree.reload();
        const block = await captionDialog(relFrom(pageDir, p), alt, URL.createObjectURL(f));
        pos = editor.insertBlock(block, pos);
      } else {
        parts.push(mdLink(relFrom(pageDir, p), alt, false));
      }
    } catch (e) { toast(`${f.name}: ${e.message}`, true); }
  }
  if (parts.length) {
    pos = editor.insertBlock(parts.join("\n\n"), pos);
    toast(`Added ${parts.length} file${parts.length > 1 ? "s" : ""} to ${pageDir ? pageDir + "/" : ""}images/`);
    tree.reload();
  }
}

// ---------- image source / caption helper ----------
// Every inserted image gets a caption with a "Source:" line. The dialog asks
// for the source type and shows how to cite it; "Skip" leaves a placeholder
// that the Problems list keeps flagging until it's filled in.
const CAP_TIPS = {
  own: "Use for photos, screenshots or diagrams you made yourself. If you redrew or changed someone else's figure, pick Zotero or Website for the original and tick \u201cadapted\u201d.",
  zotero: "Type the item's Citation Key from Zotero (Info pane). The full reference is added to this page's References automatically. A page or figure number goes into that reference, not the caption.",
  web: "Give the organization or author, the page title, the year it was published, the date you looked at it, and the full web address. Check the site's terms or license allow you to reuse the image.",
};
let refsLoaded = false;
async function loadRefKeys() {
  if (refsLoaded) return;
  refsLoaded = true;
  try {
    const refs = await (await fetch("/__api/refs")).json();
    $("cap-keys").replaceChildren(...refs.map((r) => Object.assign(document.createElement("option"), { value: r.key, label: r.label })));
    if (!refs.length) CAP_TIPS.zotero += " (No Zotero library found in references/ yet. See docs/zotero.md. You can still type a key.)";
  } catch {}
}
const clean = (s) => s.trim().replace(/[.\s]+$/, "");
function buildCaption() {
  const v = (id) => $(id).value.trim();
  const type = $("cap-type").value;
  const adapted = $("cap-adapted").checked ? "Adapted from " : "";
  let src = "";
  if (type === "own") src = adapted ? "Own work, adapted" : "Own work";
  else if (type === "zotero") src = v("cap-key") ? `${adapted}[@${v("cap-key").replace(/^@/, "")}${v("cap-loc") ? ", " + v("cap-loc") : ""}]` : "";
  else {
    const bits = [clean(v("cap-org")), clean(v("cap-ptitle")), v("cap-year") && `Published ${v("cap-year")}`,
      v("cap-accessed") && `Accessed ${new Date(v("cap-accessed") + "T12:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      v("cap-url")].filter(Boolean);
    src = bits.length ? adapted + bits.join(". ") : "";
  }
  const caption = clean(v("cap-caption")) || "Describe the image";
  const license = clean(v("cap-license"));
  if (!src) return { text: `*Figure: ${caption}. Source needed.*`, complete: false };
  return { text: `*Figure: ${caption}. Source: ${clean(src)}.${license ? " " + license + "." : ""}*`, complete: true };
}
function captionDialog(target, alt, thumbURL) {
  return new Promise((resolve) => {
    const dlg = $("cap-dialog");
    $("cap-form").reset();
    $("cap-accessed").value = new Date().toISOString().slice(0, 10);
    $("cap-thumb").src = thumbURL || "";
    loadRefKeys();
    const sync = () => {
      const type = $("cap-type").value;
      $("cap-tip").textContent = "💡 " + CAP_TIPS[type];
      dlg.querySelectorAll(".cap-fields").forEach((f) => (f.hidden = f.dataset.for !== type));
      const c = buildCaption();
      $("cap-preview").textContent = c.text;
      $("cap-preview").classList.toggle("incomplete", !c.complete);
    };
    dlg.oninput = sync;
    dlg.onchange = sync;
    sync();
    const finish = (skip) => {
      const c = skip ? { text: `*Figure: ${clean($("cap-caption").value) || "Describe the image"}. Source needed.*`, complete: false } : buildCaption();
      const altText = clean($("cap-caption").value) || alt;
      // A private note (hidden from the site, shown in Problems) when the source is still missing.
      const note = $("cap-note").value.replace(/-->/g, "").replace(/\s+/g, " ").trim();
      const noteLine = !c.complete && note ? `\n<!-- source note: ${note} -->` : "";
      dlg.close();
      resolve(`${mdLink(target, altText, true)}\n\n${c.text}${noteLine}`);
    };
    $("cap-form").onsubmit = (e) => { e.preventDefault(); finish(false); };
    $("cap-skip").onclick = () => finish(true);
    dlg.oncancel = (e) => { e.preventDefault(); finish(true); }; // Escape = skip, image still inserted
    dlg.showModal();
    $("cap-caption").focus();
  });
}

function setupEditorDrop() {
  const pane = document.querySelector(".editor-pane"), zone = $("dropzone");
  const wanted = (dt) => dt && (dt.types.includes("Files") || dt.types.includes(DRAG_TYPE));
  pane.addEventListener("dragover", (e) => {
    if (!wanted(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    zone.hidden = false;
    zone.textContent = e.dataTransfer.types.includes(DRAG_TYPE) ? "Drop to insert a link" : "Drop to upload into images/ and insert";
  }, true);
  pane.addEventListener("dragleave", (e) => { if (!pane.contains(e.relatedTarget)) zone.hidden = true; }, true);
  pane.addEventListener("drop", async (e) => {
    if (!wanted(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    zone.hidden = true;
    const coords = { x: e.clientX, y: e.clientY };
    if (e.dataTransfer.types.includes(DRAG_TYPE)) {
      const src = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
      if (src.dir) { toast("Drop a file, not a folder, to insert a link.", true); return; }
      const name = src.path.split("/").pop();
      const label = src.title || name.replace(/\.[^.]+$/, "").replace(/-/g, " ");
      if (IMG.test(name)) {
        const pos = editor.posAt(coords);
        const block = await captionDialog(relFrom(pageDir, src.path), label, "/__api/raw?path=" + encodeURIComponent(src.path));
        editor.insertBlock(block, pos);
      } else {
        editor.insert(mdLink(relFrom(pageDir, src.path), label, false), coords);
      }
    } else {
      await uploadAndInsert([...e.dataTransfer.files], coords);
    }
  }, true);
  pane.addEventListener("paste", async (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => IMG.test(f.name) || f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault(); e.stopPropagation();
    const named = files.map((f) => (f.name && f.name !== "image.png") ? f
      : new File([f], `${slugify(path.split("/").pop().replace(/\.md$/, ""))}-${Date.now().toString(36)}.png`, { type: f.type }));
    await uploadAndInsert(named);
  }, true);
}

// ---------- layout: resizable split, tree toggle, phone toggle ----------
function setupLayout() {
  const gutter = $("gutter"), split = $("split"), shell = $("shell");
  const root = document.documentElement;
  try {
    const s = localStorage.getItem("fpn-editor-split"); if (s) root.style.setProperty("--split", s);
    if (localStorage.getItem("fpn-tree-hidden") === "1" || innerWidth < 900) shell.classList.add("tree-hidden");
  } catch {}
  $("tree-toggle").setAttribute("aria-expanded", String(!shell.classList.contains("tree-hidden")));
  const setPct = (pct) => {
    const v = Math.min(80, Math.max(20, pct)).toFixed(1) + "%";
    root.style.setProperty("--split", v);
    try { localStorage.setItem("fpn-editor-split", v); } catch {}
  };
  gutter.addEventListener("pointerdown", (e) => {
    gutter.setPointerCapture(e.pointerId);
    frame.style.pointerEvents = "none";
    const move = (ev) => setPct(((ev.clientX - split.getBoundingClientRect().left) / split.clientWidth) * 100);
    const up = () => { gutter.removeEventListener("pointermove", move); frame.style.pointerEvents = ""; };
    gutter.addEventListener("pointermove", move);
    gutter.addEventListener("pointerup", up, { once: true });
  });
  gutter.addEventListener("keydown", (e) => {
    const cur = parseFloat(getComputedStyle(root).getPropertyValue("--split")) || 55;
    if (e.key === "ArrowLeft") setPct(cur - 2);
    if (e.key === "ArrowRight") setPct(cur + 2);
  });
  $("tree-toggle").addEventListener("click", () => {
    const hidden = shell.classList.toggle("tree-hidden");
    $("tree-toggle").setAttribute("aria-expanded", String(!hidden));
    try { localStorage.setItem("fpn-tree-hidden", hidden ? "1" : "0"); } catch {}
  });
  $("toggle").addEventListener("click", () => {
    const on = split.classList.toggle("show-preview");
    $("toggle").textContent = on ? "Edit" : "Preview";
    if (on) scheduleUpdate(0); else editor.focus();
  });
}

// ---------- file switcher (quick open) ----------
async function loadFileList() {
  const input = $("file-input");
  input.value = path;
  try {
    const files = await (await fetch("/__api/files")).json();
    $("file-list").replaceChildren(...files.map((f) => Object.assign(document.createElement("option"), { value: f.path, label: f.title })));
  } catch {}
  const go = () => { const next = input.value.trim(); if (next && next !== path) openFile(next); };
  input.addEventListener("change", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

function openFile(p, find) {
  // beforeunload guards unsaved work
  location.search = "?path=" + encodeURIComponent(p) + (find ? "&find=" + encodeURIComponent(find) : "");
}

// ---------- problems: every build warning on the site, for batch fixing ----------
const problems = (() => {
  const btn = $("problems-btn"), panel = $("problems"), list = $("problems-list"), count = $("problems-count");
  let last = "";
  async function refresh() {
    let ps;
    try { ps = await (await fetch("/__api/problems")).json(); } catch { return; }
    const key = JSON.stringify(ps);
    if (key === last) return;
    last = key;
    count.textContent = ps.length ? String(ps.length) : "✓";
    btn.classList.toggle("has-problems", ps.length > 0);
    list.replaceChildren();
    if (!ps.length) {
      list.append(Object.assign(document.createElement("p"), { className: "problems-none", textContent: "🎉 No problems. Everything checks out." }));
      return;
    }
    const byFile = new Map();
    for (const p of ps) { if (!byFile.has(p.path)) byFile.set(p.path, []); byFile.get(p.path).push(p); }
    for (const [file, items] of byFile) {
      const group = document.createElement("section");
      group.className = "pgroup" + (file === path ? " current" : "");
      group.append(Object.assign(document.createElement("h4"), { textContent: file || "Site" }));
      for (const p of items) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pitem";
        // Show the private source note (if any) in red italics so it stands out.
        const [msg, note] = p.message.split(" — your note: ");
        b.textContent = "⚠ " + msg;
        if (note) b.append(" — ", Object.assign(document.createElement("span"), { className: "pnote", textContent: "your note: " + note }));
        if (file) b.addEventListener("click", () => {
          if (file === path) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); reveal(p.find); }
          else openFile(file, p.find);
        });
        else b.disabled = true;
        group.append(b);
      }
      list.append(group);
    }
  }
  function toggle(force) {
    const show = force ?? panel.hidden;
    panel.hidden = !show;
    btn.setAttribute("aria-expanded", String(show));
    if (show) { refresh(); $("critique").hidden = true; $("critique-btn").setAttribute("aria-expanded", "false"); }
  }
  btn.addEventListener("click", () => toggle());
  $("problems-close").addEventListener("click", () => toggle(false));
  setInterval(refresh, 3000);
  return { refresh, toggle };
})();

// ---------- study critique (runs the critique-page skill via Claude Code) ----------
const critique = (() => {
  const btn = $("critique-btn"), panel = $("critique"), body = $("critique-body"), state = $("critique-state"), run = $("critique-run");
  let busy = false;
  const show = (res) => {
    body.innerHTML = res.html || "";
    state.textContent = res.html ? (res.cached ? `from ${res.when} · page unchanged since` : `done at ${res.when}`) : "";
    run.textContent = res.html ? "Run again" : "Run critique";
  };
  async function load() {
    try {
      const r = await fetch("/__api/critique?path=" + encodeURIComponent(path));
      if (r.ok) show(await r.json());
      else { body.replaceChildren(); state.textContent = (await r.text()).trim(); run.disabled = r.status === 404; }
    } catch {}
  }
  async function go() {
    if (busy) return;
    if (dirty && !confirm("You have unsaved changes. The critique reads the saved version.\n\nSave first?")) {
      // run on the saved version anyway
    } else if (dirty) { await save(); }
    busy = true; run.disabled = true;
    state.textContent = "📖 Your study partner is reading… (about a minute)";
    body.replaceChildren();
    try {
      const r = await fetch("/__api/critique?path=" + encodeURIComponent(path), { method: "POST", headers: H });
      if (!r.ok) throw new Error((await r.text()).trim());
      show(await r.json());
    } catch (e) {
      state.textContent = "";
      body.replaceChildren(Object.assign(document.createElement("p"), { className: "problems-none", textContent: "⚠ " + e.message }));
    } finally { busy = false; run.disabled = false; }
  }
  function toggle(force) {
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) { $("problems").hidden = true; $("problems-btn").setAttribute("aria-expanded", "false"); if (!busy) load(); }
  }
  btn.addEventListener("click", () => toggle());
  $("critique-close").addEventListener("click", () => toggle(false));
  run.addEventListener("click", go);
  return { toggle };
})();

// Highlight the first occurrence of text in the editor (e.g. a broken link target).
function reveal(text) {
  if (!text || !editor) return;
  const i = editor.get().indexOf(text);
  if (i >= 0) editor.select(i, i + text.length);
}

// ---------- scroll sync: editor <-> preview ----------
// The preview tags blocks with data-src-line. We interpolate between tagged
// blocks to map an editor line to a preview y-offset, and back.
const sync = (() => {
  const HEADER = 80; // sticky site header in the preview
  let lockUntil = 0, lockSide = "";
  const locked = (side) => lockSide !== side && performance.now() < lockUntil;
  const lock = (side) => { lockSide = side; lockUntil = performance.now() + 160; };

  function anchors() {
    const doc = frame.contentDocument;
    if (!doc) return [];
    const win = frame.contentWindow;
    return [...doc.querySelectorAll("[data-src-line]")]
      .map((el) => ({ line: +el.dataset.srcLine, y: el.getBoundingClientRect().top + win.scrollY }))
      .filter((a) => a.line > 0)
      .sort((a, b) => a.line - b.line || a.y - b.y);
  }

  function toPreview(force) {
    if (!force && locked("editor")) return;
    if (tab !== "preview" || !frame.contentWindow) return;
    const as = anchors();
    const win = frame.contentWindow;
    const line = editor.topLine();
    let y;
    if (!as.length || line <= as[0].line) {
      // Above the first block (front matter / title): top of the page.
      y = 0;
    } else {
      let i = as.length - 1;
      while (i > 0 && as[i].line > line) i--;
      const a = as[i], b = as[i + 1];
      const end = b || { line: editor.get().split("\n").length + 1, y: win.document.documentElement.scrollHeight };
      y = a.y + (end.y - a.y) * ((line - a.line) / Math.max(1, end.line - a.line)) - HEADER;
    }
    lock("preview");
    win.scrollTo(0, Math.max(0, y));
  }

  function toEditor() {
    if (locked("preview") || tab !== "preview") return;
    const as = anchors();
    if (!as.length) return;
    const win = frame.contentWindow;
    const y = win.scrollY + HEADER;
    if (win.scrollY <= 2) { lock("editor"); editor.scrollToLine(1); return; }
    let i = as.length - 1;
    while (i > 0 && as[i].y > y) i--;
    const a = as[i], b = as[i + 1];
    const line = b && b.y > a.y ? a.line + (b.line - a.line) * Math.min(1, (y - a.y) / (b.y - a.y)) : a.line;
    lock("editor");
    editor.scrollToLine(line);
  }

  let raf = 0;
  const throttled = (fn) => () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); };
  return {
    toPreview,
    attachEditor() {
      editor.onScroll(throttled(() => toPreview(false)));
    },
    attachPreview() {
      try { frame.contentWindow.addEventListener("scroll", throttled(toEditor), { passive: true }); } catch {}
    },
  };
})();

// ---------- boot ----------
async function boot() {
  let text = "";
  const r = await fetch("/__api/file?path=" + encodeURIComponent(path));
  const isNew = r.status === 404;
  if (r.ok) {
    text = await r.text();
    mtime = r.headers.get("X-FPN-Mtime") || "";
    saved = text;
  } else if (isNew) {
    const title = newTitle || path.split("/").pop().replace(/\.md$/i, "").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
    text = path.endsWith("_index.md") ? `---\ntitle: ${title}\n---\n` : `---\ntitle: ${title}\n---\n\n## Overview\n\n- \n`;
  } else {
    setStatus("error", "error");
    showWarnings([await r.text()]);
    return;
  }

  editor = await makeEditor($("editor"), text, () => { markDirty(); scheduleUpdate(); });
  sync.attachEditor();
  diff = initDiff({
    path,
    getText: () => editor.get(),
    getSaved: () => saved,
    onStats: ({ add, del, isNew: n }) => {
      const b = $("diff-badge");
      b.hidden = !add && !del;
      b.textContent = n ? "new" : `+${add} −${del}`;
    },
  });
  tree = initTree({ current: path, onOpen: openFile, toast, isDirty: () => dirty });

  markDirty();
  if (isNew) setStatus("new file — unsaved", "dirty");
  setupLayout();
  setupEditorDrop();
  loadFileList();
  $("tab-preview").addEventListener("click", () => setTab("preview"));
  $("tab-diff").addEventListener("click", () => setTab("diff"));
  let startTab = "preview";
  try { startTab = localStorage.getItem("fpn-editor-tab") || "preview"; } catch {}
  if (params.get("tab") === "diff" || params.get("tab") === "preview") startTab = params.get("tab");
  setTab(startTab);
  diff.stats();
  editor.focus();
  if (params.get("find")) setTimeout(() => reveal(params.get("find")), 50);
  problems.refresh();

  saveBtn.addEventListener("click", () => save());
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  }, true);
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
}

boot();
