// fpn dev editor: Markdown on the right, live page preview on the left.
// Served only by `fpn serve`; never part of the static build.

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const path = (params.get("path") || "_index.md").replace(/^\/+|^content\//g, "");
const newTitle = params.get("title") || "";
const H = { "X-FPN-Editor": "1" };

const status = $("status"), saveBtn = $("save"), frame = $("preview");
let mtime = "", saved = "", dirty = false, editor;

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
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        theme,
        EditorView.updateListener.of((u) => u.docChanged && onChange()),
      ],
    });
    return {
      get: () => view.state.doc.toString(),
      focus: () => view.focus(),
    };
  } catch (err) {
    console.warn("CodeMirror unavailable, using plain textarea:", err);
    const ta = document.createElement("textarea");
    ta.className = "fallback";
    ta.value = doc;
    ta.spellcheck = true;
    ta.addEventListener("input", onChange);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: t } = ta;
        ta.setRangeText("  ", s, t, "end");
        onChange();
      }
    });
    parent.append(ta);
    return { get: () => ta.value, focus: () => ta.focus() };
  }
}

// ---------- status ----------
function setStatus(text, cls = "") {
  status.textContent = text;
  status.className = "status " + cls;
}
function markDirty() {
  dirty = editor.get() !== saved;
  saveBtn.disabled = !dirty;
  setStatus(dirty ? "unsaved" : "saved", dirty ? "dirty" : "");
  document.title = (dirty ? "● " : "") + path + " · fpn editor";
}

// ---------- preview ----------
let previewTimer, previewSeq = 0;
function schedulePreview(delay = 200) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, delay);
}
async function renderPreview() {
  const seq = ++previewSeq;
  try {
    const r = await fetch("/__api/preview?path=" + encodeURIComponent(path), { method: "POST", headers: H, body: editor.get() });
    if (!r.ok) throw new Error(await r.text());
    const { html, url, warnings } = await r.json();
    if (seq !== previewSeq) return; // a newer preview is on its way
    $("view").href = url;
    showWarnings(warnings || []);
    const y = frame.contentWindow ? frame.contentWindow.scrollY : 0;
    frame.onload = () => { try { frame.contentWindow.scrollTo(0, y); } catch {} };
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
  if (!r.ok) {
    setStatus("save failed", "error");
    alert("Save failed: " + (await r.text()));
    return;
  }
  mtime = r.headers.get("X-FPN-Mtime") || "";
  saved = text;
  markDirty();
  setStatus("saved ✓");
}

// ---------- file switcher ----------
async function loadFileList() {
  const input = $("file-input");
  input.value = path;
  try {
    const files = await (await fetch("/__api/files")).json();
    $("file-list").replaceChildren(...files.map((f) => Object.assign(document.createElement("option"), { value: f.path, label: f.title })));
  } catch {}
  input.addEventListener("change", () => {
    const next = input.value.trim();
    if (next && next !== path) location.search = "?path=" + encodeURIComponent(next);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.dispatchEvent(new Event("change")); });
}

// ---------- resizable split ----------
function setupGutter() {
  const gutter = $("gutter"), split = $("split");
  let stored = null;
  try { stored = localStorage.getItem("fpn-editor-split"); } catch {}
  if (stored) document.documentElement.style.setProperty("--split", stored);
  const setPct = (pct) => {
    const v = Math.min(80, Math.max(20, pct)).toFixed(1) + "%";
    document.documentElement.style.setProperty("--split", v);
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
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--split")) || 55;
    if (e.key === "ArrowLeft") setPct(cur - 2);
    if (e.key === "ArrowRight") setPct(cur + 2);
  });
  $("toggle").addEventListener("click", () => {
    const on = split.classList.toggle("show-preview");
    $("toggle").textContent = on ? "Edit" : "Preview";
    if (on) renderPreview(); else editor.focus();
  });
}

// ---------- boot ----------
async function boot() {
  let text = "";
  const r = await fetch("/__api/file?path=" + encodeURIComponent(path));
  if (r.ok) {
    text = await r.text();
    mtime = r.headers.get("X-FPN-Mtime") || "";
    saved = text;
  } else if (r.status === 404) {
    // New page: start from a minimal skeleton.
    const title = newTitle || path.split("/").pop().replace(/\.md$/i, "").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
    text = path.endsWith("_index.md") ? `---\ntitle: ${title}\n---\n` : `---\ntitle: ${title}\n---\n\n## Overview\n\n- \n`;
    saved = "";
  } else {
    setStatus("error", "error");
    showWarnings([await r.text()]);
    return;
  }

  editor = await makeEditor($("editor"), text, () => { markDirty(); schedulePreview(); });
  markDirty();
  if (r.status === 404) setStatus("new file — unsaved", "dirty");
  renderPreview();
  loadFileList();
  setupGutter();
  editor.focus();

  saveBtn.addEventListener("click", () => save());
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  }, true);
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
}

boot();
