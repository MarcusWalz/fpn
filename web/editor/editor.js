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
    const [{ EditorView, basicSetup }, { markdown }] = await Promise.all([
      import("https://esm.sh/codemirror@6.0.1"),
      import("https://esm.sh/@codemirror/lang-markdown@6.2.5"),
    ]);
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
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
      extensions: [basicSetup, markdown(), EditorView.lineWrapping, theme,
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
      // Insert text at screen coordinates (a drop) or at the cursor.
      insert(text, coords) {
        let pos = coords ? view.posAtCoords(coords) : null;
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
      insert(text) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end"); onChange(); ta.focus(); },
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
  for (const f of files) {
    const dir = pageDir ? pageDir + "/images" : "images";
    try {
      const r = await fetch(`/__api/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(f.name || "pasted.png")}&mkdir=1`, { method: "POST", headers: H, body: f });
      if (!r.ok) throw new Error(await r.text());
      const { path: p, name } = await r.json();
      const alt = name.replace(/\.[^.]+$/, "").replace(/-/g, " ");
      parts.push(mdLink(relFrom(pageDir, p), alt, IMG.test(name)));
    } catch (e) { toast(`${f.name}: ${e.message}`, true); }
  }
  if (parts.length) {
    editor.insert(parts.join("\n\n"), coords);
    toast(`Added ${parts.length} file${parts.length > 1 ? "s" : ""} to ${pageDir ? pageDir + "/" : ""}images/`);
    tree.reload();
  }
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
      editor.insert(mdLink(relFrom(pageDir, src.path), label, IMG.test(name)), coords);
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

function openFile(p) {
  location.search = "?path=" + encodeURIComponent(p); // beforeunload guards unsaved work
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

  saveBtn.addEventListener("click", () => save());
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  }, true);
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
}

boot();
