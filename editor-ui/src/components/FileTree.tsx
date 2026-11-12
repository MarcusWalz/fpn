import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { TreeEntry } from "../types";
import { IMG, baseOf, bookOf, dirOf, join, pageSkeleton, slugify } from "../lib/paths";
import { useVsEvent } from "../lib/useVsEvent";

export const DRAG_TYPE = "application/x-fpn-path";
const ACCORDION_MIN = 10; // chapters fold each other only in books with this many
const GIT_LABEL: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", "?": "untracked" };

export interface FileTreeHandle {
  reload(): void;
  refreshStatus(): void;
}

interface Props {
  current: string;
  isDirty(): boolean;
  onOpen(path: string): void;
  toast(msg: string, error?: boolean): void;
}

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree({ current, isDirty, onOpen, toast }, ref) {
  const [data, setData] = useState<TreeEntry | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set(load<string[]>("fpn-tree-open", [])));
  const [focus, setFocus] = useState<boolean>(() => load("fpn-tree-focus", true));
  const [filter, setFilter] = useState("");
  const [selectedDir, setSelectedDir] = useState(dirOf(current));
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ entry: TreeEntry; x: number; y: number } | null>(null);
  const filterRef = useRef<HTMLElement>(null);
  const focusRef = useRef<HTMLElement>(null);

  const entries = useMemo(() => {
    const m = new Map<string, TreeEntry>();
    const walk = (e: TreeEntry) => { m.set(e.path, e); e.children?.forEach(walk); };
    if (data) walk(data);
    return m;
  }, [data]);

  // ---- open/close rules ----
  const withOpen = useCallback((fn: (s: Set<string>) => void) => {
    setOpen((prev) => { const s = new Set(prev); fn(s); store("fpn-tree-open", [...s]); return s; });
  }, []);
  const collapseOtherBooks = (s: Set<string>, book: string) => { for (const p of [...s]) if (bookOf(p) !== book) s.delete(p); };
  const collapseSiblings = (s: Set<string>, dirPath: string) => {
    const parent = dirOf(dirPath);
    if (!parent) return;
    const subdirs = (entries.get(parent)?.children || []).filter((c) => c.dir).length;
    if (subdirs < ACCORDION_MIN) return;
    for (const p of [...s]) if (p.startsWith(parent + "/") && p !== dirPath && !p.startsWith(dirPath + "/")) s.delete(p);
  };
  const toggleDir = (path: string) => withOpen((s) => {
    if (s.has(path)) { s.delete(path); return; }
    if (!path.includes("/")) collapseOtherBooks(s, path); else collapseSiblings(s, path);
    s.add(path);
  });

  // ---- loading ----
  const reload = useCallback(async () => {
    try {
      const [t, st] = await Promise.all([api.tree(), api.gitStatus()]);
      setData(t);
      setStatus(st);
    } catch (e) { toast("Couldn't load files: " + (e as Error).message, true); }
  }, [toast]);
  const refreshStatus = useCallback(async () => setStatus(await api.gitStatus()), []);
  useImperativeHandle(ref, () => ({ reload, refreshStatus }), [reload, refreshStatus]);
  useEffect(() => { reload(); }, [reload]);

  // Reveal the current file: only its book (and, in big books, its chapter) open.
  useEffect(() => {
    if (!data) return;
    withOpen((s) => {
      if (current.includes("/")) collapseOtherBooks(s, bookOf(current));
      for (let d = dirOf(current); d; d = dirOf(d)) s.add(d);
      for (let d = dirOf(current); d.includes("/"); d = dirOf(d)) collapseSiblings(s, d);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, current]);

  useVsEvent(filterRef, "input", (e) => setFilter(((e.target as HTMLInputElement).value || "").trim().toLowerCase()));
  useVsEvent(focusRef, "change", (e) => { const v = (e.target as HTMLInputElement).checked; setFocus(v); store("fpn-tree-focus", v); });

  // ---- visibility ----
  const hasPages = (e: TreeEntry): boolean => (e.children || []).some((c) => (c.dir ? hasPages(c) : c.name !== "_index.md"));
  const keep = (e: TreeEntry) => !e.dir || hasPages(e) || current.startsWith(e.path + "/") || e.path === selectedDir;
  const matches = (e: TreeEntry): boolean =>
    !filter || (e.name + " " + (e.title || "")).toLowerCase().includes(filter) || (!!e.dir && (e.children || []).some(matches));
  const hiddenCount = (e: TreeEntry): number => (e.children || []).reduce((n, c) => n + (c.dir ? (keep(c) ? hiddenCount(c) : 1) : 0), 0);
  const dirChanged = (p: string) => Object.keys(status).some((f) => f.startsWith(p + "/"));

  // ---- actions ----
  async function move(from: string, to: string) {
    if ((current === from || current.startsWith(from + "/")) && isDirty()) { toast("Save your changes before moving the open file.", true); return; }
    try {
      await api.move(from, to);
      toast(`Moved to ${to}. Links to the old path will break; the Problems panel will list them.`);
      if (current === from) return onOpen(to);
      if (current.startsWith(from + "/")) return onOpen(to + current.slice(from.length));
      withOpen((s) => s.add(dirOf(to)));
      reload();
    } catch (e) { toast("Move failed: " + (e as Error).message, true); }
  }
  async function uploadFiles(dir: string, list: File[]) {
    const done: string[] = [];
    for (const f of list) {
      try { done.push((await api.upload(dir, f)).name); } catch (e) { toast(`${f.name}: ${(e as Error).message}`, true); }
    }
    if (done.length) {
      toast(`Uploaded ${done.join(", ")} to ${dir || "content/"}`);
      if (dir) withOpen((s) => s.add(dir));
      reload();
    }
  }
  async function newPage(dir = selectedDir) {
    const title = prompt(`New page in ${dir || "content/"}\n\nTitle:`)?.trim();
    if (!title) return;
    const p = join(dir, slugify(title) + ".md");
    try {
      const existing = await api.loadFile(p);
      if (!existing.isNew) { toast(`${p} already exists`, true); return onOpen(p); }
      await api.saveFile(p, pageSkeleton(title, false), "");
      onOpen(p);
    } catch (e) { toast("Couldn't create page: " + (e as Error).message, true); }
  }
  async function newFolder(dir = selectedDir) {
    const title = prompt(`New folder (book or chapter) in ${dir || "content/"}\n\nTitle:`)?.trim();
    if (!title) return;
    try {
      const r = await api.mkdir(join(dir, slugify(title)), title);
      setSelectedDir(r.path);
      withOpen((s) => { s.add(dir); s.add(r.path); });
      onOpen(r.index);
    } catch (e) { toast("Couldn't create folder: " + (e as Error).message, true); }
  }
  async function rename(e: TreeEntry) {
    const name = prompt(`Rename ${e.path}\n\nNew name:`, e.name)?.trim();
    if (!name || name === e.name) return;
    if (name.includes("/")) { toast("Drag items onto a folder to move them.", true); return; }
    await move(e.path, join(dirOf(e.path), name));
  }
  async function del(e: TreeEntry) {
    const what = e.dir ? `folder ${e.path}/ (only works if it's empty)` : e.path;
    if (!confirm(`Delete ${what}?\n\nThis removes it from disk. If it was committed, git can bring it back.`)) return;
    try {
      await api.remove(e.path);
      toast(`Deleted ${e.path}`);
      if (current === e.path || current.startsWith(e.path + "/")) return onOpen(join(dirOf(e.path), "_index.md"));
      reload();
    } catch (err) { toast("Delete failed: " + (err as Error).message, true); }
  }

  async function dropInto(dir: string, dt: DataTransfer) {
    if (dt.types.includes(DRAG_TYPE)) {
      const src = JSON.parse(dt.getData(DRAG_TYPE)) as { path: string };
      const to = join(dir, baseOf(src.path));
      if (to === src.path || dir === src.path || (dir + "/").startsWith(src.path + "/")) return;
      await move(src.path, to);
    } else if (dt.files?.length) {
      await uploadFiles(dir, [...dt.files]);
    }
  }
  const dragOver = (dir: string) => (ev: React.DragEvent) => {
    const t = ev.dataTransfer.types;
    if (!t.includes(DRAG_TYPE) && !t.includes("Files")) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = t.includes("Files") ? "copy" : "move";
    setDropTarget(dir);
  };
  const drop = (dir: string) => (ev: React.DragEvent) => { ev.preventDefault(); ev.stopPropagation(); setDropTarget(null); dropInto(dir, ev.dataTransfer); };

  // ---- rows ----
  function iconFor(e: TreeEntry, isOpen: boolean) {
    if (e.dir) return isOpen ? "folder-opened" : "folder";
    if (e.name === "_index.md") return "book";
    if (e.name.endsWith(".md")) return "markdown";
    return IMG.test(e.name) ? "file-media" : "file";
  }
  function clickRow(e: TreeEntry) {
    if (e.dir && e.path && !e.path.includes("/")) { // a book: unfold it and open its index
      const idx = join(e.path, "_index.md");
      withOpen((s) => { collapseOtherBooks(s, e.path); s.add(e.path); });
      setSelectedDir(e.path);
      if (current !== idx) onOpen(idx);
      return;
    }
    if (e.dir) { setSelectedDir(e.path); if (e.path) toggleDir(e.path); return; }
    if (e.name.endsWith(".md")) onOpen(e.path);
    else window.open(api.rawURL(e.path), "_blank", "noopener");
  }

  const rows: React.ReactNode[] = [];
  function walk(dir: TreeEntry, depth: number) {
    for (const e of dir.children || []) {
      if (!matches(e)) continue;
      if (focus && !filter && !keep(e)) continue;
      const isOpen = !!e.dir && (open.has(e.path) || !!filter);
      const st = e.dir ? (dirChanged(e.path) ? "•" : "") : status[e.path] || "";
      const label = e.name === "_index.md" ? "index" : e.title && (e.dir || e.name.endsWith(".md")) ? e.title : e.name;
      const target = e.dir ? e.path : dirOf(e.path);
      rows.push(
        <div
          key={e.path}
          role="treeitem"
          aria-expanded={e.dir ? isOpen : undefined}
          aria-selected={e.path === current}
          className={"row" + (e.path === current ? " current" : "") + (e.dir && e.path === selectedDir ? " selected" : "") +
            (dropTarget === target && e.dir ? " drop" : "") + (e.stub ? " stub" : "")}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={e.path}
          draggable
          onClick={() => clickRow(e)}
          onDragStart={(ev) => {
            ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ path: e.path, dir: !!e.dir, title: e.title || "" }));
            ev.dataTransfer.setData("text/plain", e.path);
            ev.dataTransfer.effectAllowed = "copyMove";
          }}
          onDragOver={dragOver(target)}
          onDragLeave={() => setDropTarget(null)}
          onDrop={drop(target)}
          onContextMenu={(ev) => { ev.preventDefault(); setMenu({ entry: e, x: ev.clientX, y: ev.clientY }); }}
        >
          <span
            className={"twisty codicon " + (e.dir ? (isOpen ? "codicon-chevron-down" : "codicon-chevron-right") : "")}
            onClick={(ev) => { if (e.dir) { ev.stopPropagation(); toggleDir(e.path); } }}
          />
          <span className={"codicon codicon-" + iconFor(e, isOpen) + " ficon"} />
          <span className="label">{label}</span>
          {st && <span className={"git git-" + (st === "?" ? "U" : st === "•" ? "dot" : st)} title={GIT_LABEL[st] || "contains changes"}>{st === "?" ? "U" : st}</span>}
          <button className="more codicon codicon-ellipsis" title="More actions" onClick={(ev) => { ev.stopPropagation(); const r = (ev.target as HTMLElement).getBoundingClientRect(); setMenu({ entry: e, x: r.left, y: r.bottom }); }} />
        </div>,
      );
      if (isOpen) walk(e, depth + 1);
    }
  }
  if (data) walk(data, 0);
  const hidden = data && focus && !filter ? hiddenCount(data) : 0;

  return (
    <aside className="explorer" aria-label="Explorer">
      <div className="pane-title">
        <span>Explorer</span>
        <span className="pane-actions">
          <button className="icon-btn codicon codicon-new-file" title="New page in the selected folder" onClick={() => newPage()} />
          <button className="icon-btn codicon codicon-new-folder" title="New folder (chapter) in the selected folder" onClick={() => newFolder()} />
          <button className="icon-btn codicon codicon-refresh" title="Refresh" onClick={reload} />
        </span>
      </div>
      <div className="explorer-tools">
        <vscode-textfield ref={filterRef} placeholder="Filter files…" class="filter">
          <vscode-icon slot="content-before" name="filter" />
        </vscode-textfield>
        <vscode-checkbox ref={focusRef} label="Focus: only folders with pages" checked={focus || undefined} title="Hide books and chapters without pages. Untick to see everything." />
      </div>
      <div
        className="tree"
        role="tree"
        onDragOver={dragOver("")}
        onDrop={drop("")}
        onDragLeave={(ev) => { if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) setDropTarget(null); }}
      >
        {rows}
        {hidden > 0 && <p className="tree-note">{hidden} empty folder{hidden === 1 ? "" : "s"} hidden · type in the filter or untick Focus</p>}
      </div>
      <p className="explorer-hint">Drag to move · drop files from your computer onto a folder to upload · drag a file into the editor to link it</p>
      {menu && (
        <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(ev) => { ev.preventDefault(); setMenu(null); }}>
          <div className="context-menu" style={{ left: Math.min(menu.x, innerWidth - 200), top: Math.min(menu.y, innerHeight - 160) }} onClick={(ev) => ev.stopPropagation()}>
            {menu.entry.dir && <button onClick={() => { setMenu(null); newPage(menu.entry.path); }}><span className="codicon codicon-new-file" />New page here</button>}
            {menu.entry.dir && <button onClick={() => { setMenu(null); newFolder(menu.entry.path); }}><span className="codicon codicon-new-folder" />New folder here</button>}
            {menu.entry.path && <button onClick={() => { setMenu(null); rename(menu.entry); }}><span className="codicon codicon-edit" />Rename…</button>}
            {menu.entry.path && <button className="danger" onClick={() => { setMenu(null); del(menu.entry); }}><span className="codicon codicon-trash" />Delete</button>}
          </div>
        </div>
      )}
    </aside>
  );
});

export default FileTree;
