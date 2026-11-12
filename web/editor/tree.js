// File tree for the fpn dev editor: browse, create, rename, delete, drag to
// move, and drop files from the computer to upload.

const H = { "X-FPN-Editor": "1" };
export const DRAG_TYPE = "application/x-fpn-path";
const IMG = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);
const join = (a, b) => (a ? a + "/" + b : b);
export const slugify = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "untitled";

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
  return r.status === 204 ? null : r.headers.get("Content-Type")?.includes("json") ? r.json() : r.text();
}

export function initTree({ current, onOpen, toast, isDirty }) {
  const body = document.getElementById("tree-body");
  const filter = document.getElementById("tree-filter");
  let data = null, status = {}, selectedDir = dirOf(current);
  let open = new Set();
  try { open = new Set(JSON.parse(localStorage.getItem("fpn-tree-open") || "[]")); } catch {}
  // Accordion: only one book (top-level folder) is open at a time.
  const bookOf = (p) => p.split("/")[0];
  const collapseOtherBooks = (book) => {
    for (const p of [...open]) if (bookOf(p) !== book) open.delete(p);
  };
  // Inside a folder with many sub-folders (>= 10), only one of them is open
  // at a time too. Needs the loaded tree to count sub-folders.
  const ACCORDION_MIN = 10;
  const entries = new Map();
  const index = (e) => { entries.set(e.path, e); (e.children || []).forEach(index); };
  const collapseSiblings = (dirPath) => {
    const parent = dirOf(dirPath);
    if (!parent) return; // books are handled by collapseOtherBooks
    const pe = entries.get(parent);
    const subdirs = (pe?.children || []).filter((c) => c.dir).length;
    if (subdirs < ACCORDION_MIN) return;
    for (const p of [...open]) {
      if (p.startsWith(parent + "/") && p !== dirPath && !p.startsWith(dirPath + "/")) open.delete(p);
    }
  };
  // Always reveal the current file, and show only its book.
  if (current.includes("/")) collapseOtherBooks(bookOf(current));
  for (let d = dirOf(current); d; d = dirOf(d)) open.add(d);
  const saveOpen = () => { try { localStorage.setItem("fpn-tree-open", JSON.stringify([...open])); } catch {} };

  async function load() {
    try {
      const [tree, st] = await Promise.all([api("/__api/tree"), api("/__api/git/status").catch(() => ({ files: {} }))]);
      data = tree;
      status = st.files || {};
      entries.clear();
      index(data);
      // On load, the current file's folders win over any other open siblings.
      for (let d = dirOf(current); d.includes("/"); d = dirOf(d)) collapseSiblings(d);
      saveOpen();
      render();
    } catch (e) {
      body.textContent = "Couldn't load files: " + e.message;
    }
  }
  async function refreshStatus() {
    try { status = (await api("/__api/git/status")).files || {}; render(); } catch {}
  }

  // Does a folder contain git changes?
  const dirChanged = (p) => Object.keys(status).some((f) => f.startsWith(p ? p + "/" : ""));

  // Focus mode: hide folders that contain no pages (only _index.md files),
  // except the folders leading to the open file and the selected folder.
  const focusBox = document.getElementById("tree-focus");
  try { focusBox.checked = localStorage.getItem("fpn-tree-focus") !== "0"; } catch {}
  const hasPages = (e) => (e.children || []).some((c) => (c.dir ? hasPages(c) : c.name !== "_index.md"));
  const keep = (e) => !e.dir || hasPages(e) || current.startsWith(e.path + "/") || e.path === selectedDir;
  const hiddenCount = (e) => (e.children || []).reduce((n, c) => n + (c.dir ? (keep(c) ? hiddenCount(c) : 1) : 0), 0);

  function matches(e, q) {
    if (!q) return true;
    if ((e.name + " " + (e.title || "")).toLowerCase().includes(q)) return true;
    return e.dir && (e.children || []).some((c) => matches(c, q));
  }

  function render() {
    if (!data) return;
    const q = filter.value.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    const rootRow = row(data, 0, q);
    rootRow.classList.add("root");
    frag.append(rootRow);
    walk(data, 1, q, frag);
    if (focusBox.checked && !q) {
      const n = hiddenCount(data);
      if (n) {
        const note = document.createElement("p");
        note.className = "tree-hidden-note";
        note.textContent = `${n} empty folder${n === 1 ? "" : "s"} hidden · type in the filter or untick Focus to see them`;
        frag.append(note);
      }
    }
    body.replaceChildren(frag);
    body.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  }

  function walk(dir, depth, q, frag) {
    for (const e of dir.children || []) {
      if (!matches(e, q)) continue;
      if (focusBox.checked && !q && !keep(e)) continue;
      frag.append(row(e, depth, q));
      if (e.dir && (open.has(e.path) || q)) walk(e, depth + 1, q, frag);
    }
  }

  function row(e, depth, q) {
    const el = document.createElement("div");
    el.className = "node" + (e.dir ? " dir" : " file") + (e.path === current ? " current" : "") +
      (e.dir && e.path === selectedDir ? " selected" : "") + (e.stub ? " stub" : "");
    el.style.setProperty("--depth", depth);
    el.setAttribute("role", "treeitem");
    el.dataset.path = e.path;
    el.dataset.dir = e.dir ? "1" : "";
    el.title = e.path || "content/";
    if (e.dir) el.setAttribute("aria-expanded", open.has(e.path) || !!q ? "true" : "false");
    el.draggable = e.path !== "";

    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = e.dir && e.path !== "" ? (open.has(e.path) || q ? "▾" : "▸") : "";
    const ico = document.createElement("span");
    ico.className = "ico";
    ico.textContent = e.dir ? "▣" : e.name.endsWith(".md") ? (e.name === "_index.md" ? "◆" : "▤") : IMG.test(e.name) ? "▨" : "▫";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = e.name === "_index.md" ? "index" : (e.title && e.name.endsWith(".md") ? e.title : e.name);
    if (e.dir && e.title && e.path) label.textContent = e.title;
    el.append(caret, ico, label);

    const st = e.dir ? (e.path && dirChanged(e.path) ? "•" : "") : status[e.path] || "";
    if (st) {
      const b = document.createElement("span");
      b.className = "git git-" + ({ "?": "new", "•": "dot" }[st] || st);
      b.textContent = st === "?" ? "U" : st;
      b.title = { M: "modified", A: "added", D: "deleted", R: "renamed", "?": "new (untracked)", "•": "contains changes" }[st] || st;
      el.append(b);
    }
    if (e.path !== "") {
      const more = document.createElement("button");
      more.className = "more";
      more.type = "button";
      more.textContent = "⋯";
      more.title = "Rename, delete…";
      more.addEventListener("click", (ev) => { ev.stopPropagation(); menu(e, more); });
      el.append(more);
    }

    // The caret only folds/unfolds, without opening anything.
    caret.addEventListener("click", (ev) => {
      if (!e.dir || !e.path) return;
      ev.stopPropagation();
      if (open.has(e.path)) open.delete(e.path);
      else { if (!e.path.includes("/")) collapseOtherBooks(e.path); else collapseSiblings(e.path); open.add(e.path); }
      saveOpen();
      render();
    });

    el.addEventListener("click", () => {
      // Clicking a book unfolds it (folding the others) and opens its index page.
      if (e.dir && e.path && !e.path.includes("/")) {
        const idx = join(e.path, "_index.md");
        collapseOtherBooks(e.path);
        open.add(e.path);
        selectedDir = e.path;
        saveOpen();
        if (current !== idx) return onOpen(idx);
        render();
        return;
      }
      if (e.dir) {
        selectedDir = e.path;
        if (e.path) {
          if (open.has(e.path)) open.delete(e.path);
          else {
            if (!e.path.includes("/")) collapseOtherBooks(e.path); // opening a book closes the others
            else collapseSiblings(e.path); // ...and a chapter closes its siblings in big books
            open.add(e.path);
          }
        }
        saveOpen();
        render();
      } else if (e.name.endsWith(".md")) {
        onOpen(e.path);
      } else {
        window.open("/__api/raw?path=" + encodeURIComponent(e.path), "_blank", "noopener");
      }
    });

    // drag source
    el.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ path: e.path, dir: !!e.dir, title: e.title || "" }));
      ev.dataTransfer.setData("text/plain", e.path);
      ev.dataTransfer.effectAllowed = "copyMove";
    });
    // drop target (folders, and files act as their folder)
    const target = e.dir ? e.path : dirOf(e.path);
    el.addEventListener("dragover", (ev) => {
      const t = ev.dataTransfer.types;
      if (!t.includes(DRAG_TYPE) && !t.includes("Files")) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = t.includes("Files") ? "copy" : "move";
      highlight(target);
    });
    el.addEventListener("dragleave", () => highlight(null));
    el.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); highlight(null); dropInto(target, ev.dataTransfer); });
    return el;
  }

  function highlight(dir) {
    body.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target"));
    if (dir === null) return;
    body.querySelector(`.node.dir[data-path="${CSS.escape(dir)}"]`)?.classList.add("drop-target");
  }

  // Dropping on empty space in the tree targets the content root.
  body.addEventListener("dragover", (ev) => {
    const t = ev.dataTransfer.types;
    if (t.includes(DRAG_TYPE) || t.includes("Files")) { ev.preventDefault(); highlight(""); }
  });
  body.addEventListener("drop", (ev) => { ev.preventDefault(); highlight(null); dropInto("", ev.dataTransfer); });

  async function dropInto(dir, dt) {
    if (dt.types.includes(DRAG_TYPE)) {
      const src = JSON.parse(dt.getData(DRAG_TYPE));
      const to = join(dir, baseOf(src.path));
      if (to === src.path || dir === src.path || (dir + "/").startsWith(src.path + "/")) return;
      await move(src.path, to);
    } else if (dt.files?.length) {
      await uploadFiles(dir, [...dt.files]);
    }
  }

  async function move(from, to) {
    if ((current === from || current.startsWith(from + "/")) && isDirty()) {
      toast("Save your changes before moving the open file.", true);
      return;
    }
    try {
      await api(`/__api/move?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: "POST" });
      toast(`Moved to ${to}. Links pointing at the old path will break — run ./fpn check.`);
      if (current === from) return onOpen(to);
      if (current.startsWith(from + "/")) return onOpen(to + current.slice(from.length));
      open.add(dirOf(to));
      saveOpen();
      load();
    } catch (e) { toast("Move failed: " + e.message, true); }
  }

  async function uploadFiles(dir, files) {
    const done = [];
    for (const f of files) {
      try {
        const r = await api(`/__api/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
        done.push(r.name);
      } catch (e) { toast(`${f.name}: ${e.message}`, true); }
    }
    if (done.length) {
      toast(`Uploaded ${done.join(", ")} to ${dir || "content/"}`);
      if (dir) open.add(dir);
      saveOpen();
      load();
    }
  }

  async function newPage(dir = selectedDir) {
    const title = prompt(`New page in ${dir || "content/"}\n\nTitle:`);
    if (!title || !title.trim()) return;
    const p = join(dir, slugify(title.trim()) + ".md");
    try {
      const r = await fetch("/__api/file?path=" + encodeURIComponent(p));
      if (r.ok) { toast(`${p} already exists`, true); return onOpen(p); }
      const text = `---\ntitle: ${/[:#'"]/.test(title) ? JSON.stringify(title.trim()) : title.trim()}\n---\n\n## Overview\n\n- \n`;
      await api("/__api/file?path=" + encodeURIComponent(p), { method: "PUT", body: text });
      onOpen(p);
    } catch (e) { toast("Couldn't create page: " + e.message, true); }
  }

  async function newFolder(dir = selectedDir) {
    const title = prompt(`New folder (book or chapter) in ${dir || "content/"}\n\nTitle:`);
    if (!title || !title.trim()) return;
    const p = join(dir, slugify(title.trim()));
    try {
      const r = await api(`/__api/mkdir?path=${encodeURIComponent(p)}&title=${encodeURIComponent(title.trim())}`, { method: "POST" });
      selectedDir = p;
      open.add(dir); open.add(p);
      saveOpen();
      onOpen(r.index);
    } catch (e) { toast("Couldn't create folder: " + e.message, true); }
  }

  async function rename(e) {
    const name = prompt(`Rename ${e.path}\n\nNew name:`, e.name);
    if (!name || name === e.name) return;
    if (name.includes("/")) { toast("Use drag-and-drop to move between folders.", true); return; }
    await move(e.path, join(dirOf(e.path), name));
  }

  async function remove(e) {
    const what = e.dir ? `folder ${e.path}/ (only works if it's empty)` : e.path;
    if (!confirm(`Delete ${what}?\n\nThis removes it from disk. If it was committed, git can bring it back.`)) return;
    try {
      await api("/__api/delete?path=" + encodeURIComponent(e.path), { method: "POST" });
      toast(`Deleted ${e.path}`);
      if (current === e.path || current.startsWith(e.path + "/")) return onOpen(join(dirOf(e.path), "_index.md"));
      load();
    } catch (err) { toast("Delete failed: " + err.message, true); }
  }

  // Tiny popup menu for a node.
  function menu(e, anchor) {
    document.querySelector(".tmenu")?.remove();
    const m = document.createElement("div");
    m.className = "tmenu";
    const items = [["Rename", () => rename(e)], ["Delete", () => remove(e)]];
    if (e.dir) items.unshift(["New page here", () => newPage(e.path)], ["New folder here", () => newFolder(e.path)]);
    for (const [label, fn] of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", () => { m.remove(); fn(); });
      m.append(b);
    }
    const r = anchor.getBoundingClientRect();
    m.style.top = r.bottom + 4 + "px";
    m.style.left = Math.min(r.left, innerWidth - 180) + "px";
    document.body.append(m);
    setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }));
  }

  document.getElementById("new-page").addEventListener("click", () => newPage());
  document.getElementById("new-folder").addEventListener("click", () => newFolder());
  document.getElementById("tree-refresh").addEventListener("click", load);
  filter.addEventListener("input", render);
  focusBox.addEventListener("change", () => {
    try { localStorage.setItem("fpn-tree-focus", focusBox.checked ? "1" : "0"); } catch {}
    render();
  });

  load();
  return { reload: load, refreshStatus, uploadFiles, dirOf, getStatus: () => status };
}
