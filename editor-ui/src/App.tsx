import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Problem } from "./types";
import MarkdownEditor, { disposeModel, type MarkdownEditorHandle } from "./components/MarkdownEditor";
import EditorTabs, { tabLabel } from "./components/EditorTabs";
import FileTree, { DRAG_TYPE, type FileTreeHandle } from "./components/FileTree";
import PreviewPane, { type PreviewHandle } from "./components/PreviewPane";
import DiffPane from "./components/DiffPane";
import BottomPanel from "./components/BottomPanel";
import { findMention } from "./lib/mentions";
import CaptionDialog, { type CaptionRequest } from "./components/CaptionDialog";
import QuickOpen from "./components/QuickOpen";
import Toasts, { type ToastMsg } from "./components/Toast";
import Bedtime, { useBedtime } from "./components/Bedtime";
import Hudson from "./components/Hudson";
import { IMG, dirOf, join, mdLink, pageSkeleton, relFrom, slugify } from "./lib/paths";
import { diffStats } from "./lib/diff";

const pathFromURL = () => (new URLSearchParams(location.search).get("path") || "_index.md").replace(/^\/+|^content\//g, "");
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

// One open file. `text` follows the editor's model; `saved` is what's on disk.
interface Doc { text: string; saved: string; head: string | null; isNew: boolean; mtime: string }
const isDirtyDoc = (d?: Doc) => !!d && (d.text !== d.saved || d.isNew);
const loadTabs = (): string[] => { try { const v = JSON.parse(ls.get("fpn-tabs") || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };

export default function App() {
  // ---------- open files (tabs) ----------
  const [path, setPath] = useState(pathFromURL); // the active tab
  const [tabs, setTabs] = useState<string[]>(() => { const t = loadTabs(), p = pathFromURL(); return t.includes(p) ? t : [...t, p]; });
  const [transient, setTransient] = useState<string | null>(null); // replaced by the next file opened
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [loadKey, setLoadKey] = useState(0); // bumps when a file is shown (find-on-load, pending link)
  const doc = docs[path] as Doc | undefined;
  const text = doc?.text ?? "", saved = doc?.saved ?? "", head = doc?.head ?? null, isNew = doc?.isNew ?? false;
  // The file in the editor: the active one once it has loaded, else the last one shown.
  const shownRef = useRef<string | null>(null);
  if (doc) shownRef.current = path;
  const shown = shownRef.current;
  const pathRef = useRef(path), tabsRef = useRef(tabs), docsRef = useRef(docs), transientRef = useRef(transient);
  pathRef.current = path; tabsRef.current = tabs; docsRef.current = docs; transientRef.current = transient;

  const [status, setStatus] = useState<{ text: string; kind?: "dirty" | "error" | "busy" }>({ text: "Loading…" });
  const [html, setHtml] = useState("");
  const [viewURL, setViewURL] = useState("/");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<"preview" | "diff">((ls.get("fpn-left-tab") as "preview" | "diff") || "preview");
  const [diffBase, setDiffBase] = useState<"head" | "saved">((ls.get("fpn-diff-base") as "head" | "saved") || "head");
  const [sideBySide, setSideBySide] = useState(ls.get("fpn-diff-sbs") === "1");
  const [savedTick, setSavedTick] = useState(0);
  const [hudsonOut, setHudsonOut] = useState(() => { try { return localStorage.getItem("fpn-hudson") === "out"; } catch { return false; } });
  const toggleHudson = () => setHudsonOut((v) => { try { localStorage.setItem("fpn-hudson", v ? "in" : "out"); } catch { /* fine */ } return !v; });
  const [stats, setStats] = useState({ add: 0, del: 0 });
  const [diffMounted, setDiffMounted] = useState(leftTab === "diff");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [panel, setPanel] = useState<null | "problems" | "links" | "critique">(null);
  const [links, setLinks] = useState<Problem[]>([]);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [treeHidden, setTreeHidden] = useState(ls.get("fpn-tree-hidden") === "1" || innerWidth < 900);
  const [split, setSplit] = useState(ls.get("fpn-split") || "50%");
  const [narrowPreview, setNarrowPreview] = useState(false);
  const [caption, setCaption] = useState<CaptionRequest | null>(null);
  const [quick, setQuick] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [dropHint, setDropHint] = useState("");
  const [previewTick, setPreviewTick] = useState(0); // re-render the preview after uploads land

  const editor = useRef<MarkdownEditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const treeRef = useRef<FileTreeHandle>(null);
  const editorQuietUntil = useRef(0);
  const findOnLoad = useRef(new URLSearchParams(location.search).get("find") || "");
  const dirty = isDirtyDoc(doc);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const isDirtyPath = useCallback((p: string) => isDirtyDoc(docsRef.current[p]), []);
  const anyDirtyUnder = (prefix: string) => tabsRef.current.some((t) => (t === prefix || t.startsWith(prefix + "/")) && isDirtyPath(t));
  const pageDir = dirOf(path);

  const toast = useCallback((t: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs, { id, text: t, error }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), error ? 6000 : 3500);
  }, []);

  useEffect(() => { ls.set("fpn-tabs", JSON.stringify(tabs.slice(-30))); }, [tabs]);
  // Editing a temporary tab keeps it.
  useEffect(() => { if (dirty && transient === path) setTransient(null); }, [dirty, transient, path]);

  const patchDoc = useCallback((p: string, patch: Partial<Doc>) =>
    setDocs((ds) => (ds[p] ? { ...ds, [p]: { ...ds[p], ...patch } } : ds)), []);
  /** Forget a closed file: its text and its editor model (once it's off screen). */
  const forget = useCallback((p: string) => {
    setDocs((ds) => { if (!(p in ds)) return ds; const r = { ...ds }; delete r[p]; return r; });
    setTimeout(() => { if (!tabsRef.current.includes(p) && shownRef.current !== p) disposeModel(p); }, 500);
  }, []);

  // ---------- navigation & loading ----------
  /** Show p, adding a tab for it if needed. A new tab goes after the active one,
   *  or replaces the temporary tab if that one is untouched. */
  const activate = useCallback((p: string, opts: { pin?: boolean; history?: "push" | "replace" | "none"; find?: string } = {}) => {
    findOnLoad.current = opts.find || "";
    const ts = tabsRef.current, cur = pathRef.current, tr = transientRef.current;
    if (!ts.includes(p)) {
      let next: string[];
      if (tr && tr !== p && ts.includes(tr) && !isDirtyPath(tr)) { next = ts.map((x) => (x === tr ? p : x)); forget(tr); }
      else { next = [...ts]; next.splice(ts.indexOf(cur) + 1, 0, p); }
      setTabs(next);
      setTransient(opts.pin ? null : p);
    } else if (opts.pin && tr === p) setTransient(null);
    if (opts.history !== "none") {
      const url = `?path=${encodeURIComponent(p)}${opts.find ? "&find=" + encodeURIComponent(opts.find) : ""}`;
      if (opts.history === "replace") history.replaceState(null, "", url); else if (p !== cur || opts.find) history.pushState(null, "", url);
    }
    if (p === cur) { if (opts.find) selectFind(); return; }
    setPath(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forget, isDirtyPath]);
  const openFile = useCallback((p: string, find = "", pin = false) => activate(p, { find, pin }), [activate]);
  const activateRef = useRef(activate);
  activateRef.current = activate;

  const closeTab = useCallback((p: string) => {
    const ts = tabsRef.current;
    if (ts.length <= 1 || !ts.includes(p)) return;
    if (isDirtyPath(p) && !confirm(`${tabLabel(p)} has unsaved changes.\n\nClose it and lose them?`)) return;
    const i = ts.indexOf(p), rest = ts.filter((x) => x !== p);
    setTabs(rest);
    if (transientRef.current === p) setTransient(null);
    if (p === pathRef.current) activate(rest[Math.min(i, rest.length - 1)], { history: "replace" });
    forget(p);
  }, [activate, forget, isDirtyPath]);

  // The file tree moved or deleted something: tabs follow (they're never dirty here).
  const onMoved = useCallback((from: string, to: string) => {
    const map = (t: string) => (t === from ? to : t.startsWith(from + "/") ? to + t.slice(from.length) : t);
    const ts = tabsRef.current;
    if (!ts.some((t) => map(t) !== t)) return;
    ts.forEach((t) => { if (map(t) !== t) forget(t); });
    const next = ts.map(map).filter((t, i, a) => a.indexOf(t) === i);
    setTabs(next);
    if (transientRef.current) setTransient(map(transientRef.current));
    const cur = pathRef.current;
    if (map(cur) !== cur) { tabsRef.current = next; activate(map(cur), { history: "replace" }); }
  }, [activate, forget]);
  const onDeleted = useCallback((p: string) => {
    const gone = (t: string) => t === p || t.startsWith(p + "/");
    const ts = tabsRef.current;
    if (!ts.some(gone)) return;
    ts.filter(gone).forEach(forget);
    let rest = ts.filter((t) => !gone(t));
    const cur = pathRef.current;
    if (gone(cur)) {
      const i = ts.indexOf(cur);
      const next = rest.length ? rest[Math.min(i, rest.length - 1)] : join(dirOf(p), "_index.md");
      if (!rest.length) rest = [next];
      setTabs(rest); tabsRef.current = rest;
      activate(next, { history: "replace" });
    } else setTabs(rest);
  }, [activate, forget]);

  useEffect(() => {
    const onPop = () => activate(pathFromURL(), { history: "none", find: new URLSearchParams(location.search).get("find") || "" });
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [activate]);

  // Load the active file the first time it's shown.
  const loading = useRef(new Set<string>());
  useEffect(() => {
    const p = path;
    document.title = `${p} · fpn editor`;
    if (docsRef.current[p] || loading.current.has(p)) return;
    loading.current.add(p);
    setStatus({ text: "Loading…" });
    (async () => {
      try {
        const f = await api.loadFile(p);
        const t = f.isNew ? pageSkeleton(new URLSearchParams(location.search).get("title") || p.split("/").pop()!.replace(/\.md$/i, "").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()), p.endsWith("_index.md")) : f.text;
        const h = f.isNew ? null : await api.gitShow(p).catch(() => null);
        if (!tabsRef.current.includes(p)) return; // closed while loading
        setDocs((ds) => (ds[p] ? ds : { ...ds, [p]: { text: t, saved: f.isNew ? "" : t, head: h, isNew: f.isNew, mtime: f.mtime } }));
      } catch (e) {
        if (p === pathRef.current) setStatus({ text: "Couldn't open file", kind: "error" });
        toast(`${p}: ${(e as Error).message}`, true);
      } finally { loading.current.delete(p); }
    })();
  }, [path, toast]);

  // Each time a file comes on screen: its status, and any pending find.
  const ready = !!doc;
  useEffect(() => {
    if (!ready) return;
    const d = docsRef.current[path];
    setStatus(isDirtyDoc(d) ? { text: d.isNew ? "New file, not saved yet" : "Unsaved", kind: "dirty" } : { text: "Saved" });
    setLoadKey((k) => k + 1);
  }, [path, ready]);

  function selectFind() {
    const f = findOnLoad.current;
    if (!f || !editor.current) return;
    const i = editor.current.getValue().indexOf(f);
    if (i >= 0) editor.current.select(i, i + f.length);
    findOnLoad.current = "";
  }
  useEffect(() => { const t = setTimeout(selectFind, 120); return () => clearTimeout(t); }, [loadKey]);

  // ---------- preview, diff stats ----------
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const seq = ++previewSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.preview(path, text);
        if (seq !== previewSeq.current) return;
        setHtml(r.html); setViewURL(r.url); setWarnings(r.warnings || []);
      } catch (e) { setWarnings(["preview: " + (e as Error).message]); }
      setStats(diffStats(diffBase === "head" ? head ?? "" : saved, text));
    }, 200);
    return () => clearTimeout(t);
  }, [text, path, ready, head, diffBase, saved, previewTick]);

  // ---------- save ----------
  const save = useCallback(async (p: string = pathRef.current, force = false): Promise<void> => {
    const d = docsRef.current[p];
    if (!d || (!isDirtyDoc(d) && !force)) return;
    const active = p === pathRef.current;
    const body = p === shownRef.current && editor.current ? editor.current.getValue() : d.text;
    if (active) setStatus({ text: "Saving…", kind: "busy" });
    try {
      const m = await api.saveFile(p, body, force ? "" : d.mtime);
      // Only `saved` moves: anything typed while saving stays unsaved.
      patchDoc(p, { saved: body, isNew: false, mtime: m });
      if (p === pathRef.current) { setStatus({ text: "Saved ✓" }); setSavedTick((n) => n + 1); }
      setTimeout(() => (d.isNew ? treeRef.current?.reload() : treeRef.current?.refreshStatus()), 300);
      setTimeout(refreshProblems, 1500);
    } catch (e) {
      if (e instanceof api.ConflictError) {
        if (active) setStatus({ text: "Conflict", kind: "error" });
        if (confirm(`${p} changed on disk since you opened it (another editor, or git).\n\nOverwrite it with your version?`)) return save(p, true);
        return;
      }
      if (active) setStatus({ text: "Save failed", kind: "error" });
      toast(`Save failed (${tabLabel(p)}): ${(e as Error).message}`, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchDoc, toast]);
  const saveAll = useCallback(async () => {
    for (const t of tabsRef.current) if (isDirtyPath(t)) await save(t);
  }, [save, isDirtyPath]);
  const saveRef = useRef(save), saveAllRef = useRef(saveAll), closeRef = useRef(closeTab);
  saveRef.current = save; saveAllRef.current = saveAll; closeRef.current = closeTab;
  // Overnight lock: save every unsaved file first, then cover the editor.
  const bedtime = useBedtime(() => { saveAllRef.current(); });

  useEffect(() => {
    if (dirty) setStatus((s) => (s.kind === "busy" ? s : { text: isNew ? "New file, not saved yet" : "Unsaved", kind: "dirty" }));
  }, [dirty, isNew]);

  // ---------- problems ----------
  const refreshProblems = useCallback(async () => {
    try { setProblems(await api.problems()); } catch { /* server restarting */ }
    try { setLinks(await api.linkSuggestions()); } catch { /* server restarting */ }
  }, []);
  useEffect(() => { refreshProblems(); const t = setInterval(refreshProblems, 3000); return () => clearInterval(t); }, [refreshProblems]);
  // Backlinks: clicking a suggestion turns the mention into the link.
  const pendingLink = useRef<Problem | null>(null);
  function applyLink(p: Problem) {
    const ed = editor.current;
    if (!ed || !p.find || !p.replace) return;
    const target = p.replace.slice(p.replace.indexOf("]("));
    if (ed.getValue().includes(target)) { toast("Already linked. Save to update the Backlinks list."); return; }
    const r = findMention(ed.getValue(), p.find);
    if (!r) { toast(`Couldn't find "${p.find}" as plain text on this page any more.`, true); return; }
    ed.replace(r.from, r.to, p.replace);
    ed.select(r.from, r.from + p.replace.length);
    toast("Link added. Save (⌘S) to keep it.");
  }
  useEffect(() => {
    const p = pendingLink.current;
    if (!p) return;
    pendingLink.current = null;
    if (p.path !== path) return;
    const t = setTimeout(() => applyLink(p), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);
  const fixLink = (p: Problem) => {
    if (!p.path || !p.replace) return jump(p);
    if (p.path === path) applyLink(p);
    else { pendingLink.current = p; openFile(p.path); }
  };
  const jump = (p: Problem) => {
    if (!p.path) return;
    if (p.path === path) { findOnLoad.current = p.find || ""; selectFind(); } else openFile(p.path, p.find || "");
  };

  // ---------- keyboard & unload ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const alt = e.altKey && !e.ctrlKey;
      // ⌥ shortcuts use e.code: on a Mac, ⌥ changes the character (⌥W is ∑).
      if (mod && alt && e.code === "KeyS") { e.preventDefault(); e.stopPropagation(); saveAllRef.current(); }
      else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveRef.current(); }
      else if (alt && !e.metaKey && e.code === "KeyW") { e.preventDefault(); e.stopPropagation(); closeRef.current(pathRef.current); }
      else if (alt && !e.metaKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        e.preventDefault(); e.stopPropagation();
        const ts = tabsRef.current, i = ts.indexOf(pathRef.current);
        activateRef.current(ts[(i + (e.code === "BracketRight" ? 1 : ts.length - 1)) % ts.length]);
      }
      else if (mod && e.key.toLowerCase() === "p" && !e.shiftKey) { e.preventDefault(); setQuick(true); }
      else if (mod && e.key === "j") { e.preventDefault(); setPanel((p) => (p ? null : "problems")); }
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (tabsRef.current.some((t) => isDirtyDoc(docsRef.current[t]))) { e.preventDefault(); e.returnValue = ""; } };
    addEventListener("keydown", onKey, true);
    addEventListener("beforeunload", onUnload);
    return () => { removeEventListener("keydown", onKey, true); removeEventListener("beforeunload", onUnload); };
  }, []);

  // ---------- images & links dropped/pasted into the editor ----------
  const askCaption = (target: string, alt: string, thumb: string) =>
    new Promise<string>((resolve) => setCaption({ target, alt, thumb, resolve: (b) => { setCaption(null); resolve(b); } }));

  async function uploadAndInsert(list: File[], x?: number, y?: number) {
    const ed = editor.current!;
    let pos = ed.offsetAt(x, y);
    const others: string[] = [];
    for (const f of list) {
      const dir = pageDir ? pageDir + "/images" : "images";
      try {
        const r = await api.upload(dir, f, f.name || "pasted.png", true);
        const alt = r.name.replace(/\.[^.]+$/, "").replace(/-/g, " ");
        if (IMG.test(r.name)) {
          treeRef.current?.reload();
          pos = ed.insertBlock(await askCaption(relFrom(pageDir, r.path), alt, URL.createObjectURL(f)), pos);
        } else others.push(mdLink(relFrom(pageDir, r.path), alt, false));
      } catch (e) { toast(`${f.name}: ${(e as Error).message}`, true); }
    }
    if (others.length) { pos = ed.insertBlock(others.join("\n\n"), pos); treeRef.current?.reload(); }
    // The site rebuild that picks up new files takes a moment; re-check then.
    setTimeout(() => setPreviewTick((t) => t + 1), 1500);
  }

  const wanted = (dt: DataTransfer | null) => !!dt && (dt.types.includes("Files") || dt.types.includes(DRAG_TYPE));
  const onEditorDragOver = (e: React.DragEvent) => {
    if (!wanted(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    setDropHint(e.dataTransfer.types.includes(DRAG_TYPE) ? "Drop to insert a link" : "Drop to upload into images/ and insert");
  };
  const onEditorDrop = async (e: React.DragEvent) => {
    if (!wanted(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    setDropHint("");
    const ed = editor.current!;
    if (e.dataTransfer.types.includes(DRAG_TYPE)) {
      const src = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as { path: string; dir: boolean; title: string };
      if (src.dir) { toast("Drop a file, not a folder, to insert a link.", true); return; }
      const name = src.path.split("/").pop()!;
      const label = src.title || name.replace(/\.[^.]+$/, "").replace(/-/g, " ");
      const pos = ed.offsetAt(e.clientX, e.clientY);
      if (IMG.test(name)) ed.insertBlock(await askCaption(relFrom(pageDir, src.path), label, api.rawURL(src.path)), pos);
      else ed.insert(mdLink(relFrom(pageDir, src.path), label, false), pos);
    } else {
      await uploadAndInsert([...e.dataTransfer.files], e.clientX, e.clientY);
    }
  };
  const onEditorPaste = async (e: React.ClipboardEvent) => {
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => IMG.test(f.name) || f.type.startsWith("image/"));
    if (!imgs.length) return;
    e.preventDefault(); e.stopPropagation();
    const base = slugify(path.split("/").pop()!.replace(/\.md$/, "")).replace(/^index$/, "image");
    await uploadAndInsert(imgs.map((f) => (f.name && f.name !== "image.png" ? f : new File([f], `${base}-${Date.now().toString(36)}.png`, { type: f.type }))));
  };

  // ---------- scroll sync ----------
  const onEditorScroll = () => {
    if (performance.now() < editorQuietUntil.current || leftTab !== "preview" || !editor.current) return;
    previewRef.current?.syncToLine(editor.current.topLine(), editor.current.lineCount());
  };
  const onPreviewScrollLine = (line: number) => {
    editorQuietUntil.current = performance.now() + 160;
    editor.current?.scrollToLine(line);
  };

  // A link clicked in the preview: notebook pages open here in the editor;
  // anything else (external sites, the home page's extras) in a browser tab.
  const onPreviewLink = async (url: URL, broken: boolean) => {
    if (broken) { toast(`That link doesn't go anywhere yet: ${url.pathname.split("/").pop()}`, true); return; }
    if (url.origin === location.origin) {
      try {
        const want = decodeURIComponent(url.pathname).replace(/\/?$/, "/");
        const hit = (await api.files()).find((f) => decodeURIComponent(f.url).replace(/\/?$/, "/") === want);
        if (hit) { openFile(hit.path); return; }
      } catch { /* fall through to a browser tab */ }
    }
    window.open(url.href, "_blank", "noopener");
  };

  // ---------- layout ----------
  const splitRef = useRef<HTMLDivElement>(null);
  const startDrag = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("dragging");
    const move = (ev: PointerEvent) => {
      const r = splitRef.current!.getBoundingClientRect();
      const v = Math.min(80, Math.max(20, ((ev.clientX - r.left) / r.width) * 100)).toFixed(1) + "%";
      setSplit(v); ls.set("fpn-split", v);
    };
    const up = () => { el.removeEventListener("pointermove", move); document.body.classList.remove("dragging"); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up, { once: true });
  };
  const toggleTree = () => setTreeHidden((h) => { ls.set("fpn-tree-hidden", h ? "0" : "1"); return !h; });
  const setTab = (t: "preview" | "diff") => { setLeftTab(t); ls.set("fpn-left-tab", t); if (t === "diff") setDiffMounted(true); };

  const problemCount = problems.length;
  const here = problems.filter((p) => p.path === path).length;
  const linksHere = links.filter((p) => p.path === path).length;

  return (
    <div className={"workbench" + (treeHidden ? " tree-hidden" : "") + (panel ? " with-panel" : "")}>
      <header className="titlebar">
        <button className="icon-btn codicon codicon-layout-sidebar-left" title="Toggle explorer" aria-pressed={!treeHidden} onClick={toggleTree} />
        <a className="logo" href="/" title="Back to the site">FPN<span>EDIT</span></a>
        <button className="command-center" onClick={() => setQuick(true)} title="Go to page (⌘P)">
          <span className="codicon codicon-search" /> <span className="cc-path">{path}</span> <kbd>⌘P</kbd>
        </button>
        <span className="titlebar-actions">
          <vscode-button secondary icon="mortar-board" title="Study critique of this page" onClick={() => setPanel(panel === "critique" ? null : "critique")}>Critique</vscode-button>
          <button className="narrow-only icon-btn codicon codicon-open-preview" title="Switch editor / preview" onClick={() => setNarrowPreview((v) => !v)} />
          <vscode-button secondary icon="link-external" title="Open the page in a new tab" onClick={() => open(viewURL, "_blank", "noopener")}>Open</vscode-button>
          <vscode-button icon="save" disabled={!dirty || undefined} title="Save (⌘S)" onClick={() => save()}>Save</vscode-button>
        </span>
      </header>

      <div className="main">
        {!treeHidden && <FileTree ref={treeRef} current={path} isDirty={anyDirtyUnder} onOpen={(p, pin) => openFile(p, "", pin)} onMoved={onMoved} onDeleted={onDeleted} toast={toast} />}
        <div className="editor-area">
          <div className={"split" + (narrowPreview ? " narrow-preview" : "")} ref={splitRef} style={{ gridTemplateColumns: `${split} 6px 1fr` }}>
            <section className="left" aria-label="Preview and diff">
              <div className="tabbar" role="tablist">
                <button role="tab" aria-selected={leftTab === "preview"} className={"tab" + (leftTab === "preview" ? " active" : "")} onClick={() => setTab("preview")}>
                  <span className="codicon codicon-preview" /> Preview
                </button>
                <button role="tab" aria-selected={leftTab === "diff"} className={"tab" + (leftTab === "diff" ? " active" : "")} onClick={() => setTab("diff")}>
                  <span className="codicon codicon-diff" /> Diff {(stats.add > 0 || stats.del > 0) && <span className="tab-stat"><span className="add">+{stats.add}</span> <span className="del">−{stats.del}</span></span>}
                </button>
              </div>
              <div className="tabcontent">
                <div className="tabpane" hidden={leftTab !== "preview"}>
                  <PreviewPane ref={previewRef} html={html} pageKey={viewURL} onLink={onPreviewLink} onScrollLine={onPreviewScrollLine}
                    onLoad={() => editor.current && previewRef.current?.syncToLine(editor.current.topLine(), editor.current.lineCount(), true)} />
                </div>
                {diffMounted && (
                  <div className="tabpane" hidden={leftTab !== "diff"}>
                    <DiffPane base={diffBase} onBase={(b) => { setDiffBase(b); ls.set("fpn-diff-base", b); }} sideBySide={sideBySide}
                      onSideBySide={(v) => { setSideBySide(v); ls.set("fpn-diff-sbs", v ? "1" : "0"); }}
                      original={diffBase === "head" ? head : saved} modified={text} stats={stats} />
                  </div>
                )}
              </div>
            </section>
            <div className="sash" role="separator" aria-orientation="vertical" title="Drag to resize" onPointerDown={startDrag} />
            <section className="right" aria-label="Markdown editor"
              onDragOverCapture={onEditorDragOver} onDropCapture={onEditorDrop} onPasteCapture={onEditorPaste}
              onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropHint(""); }}>
              <EditorTabs tabs={tabs} active={path} transient={transient} isDirty={isDirtyPath}
                onSelect={(p) => activate(p)} onClose={closeTab} onPin={(p) => { if (transient === p) setTransient(null); }} onReorder={setTabs} />
              <div className="monaco-host">
                {shown && (
                  <MarkdownEditor ref={editor} file={shown} initialValue={docs[shown]?.text ?? ""} onChange={(t, f) => patchDoc(f, { text: t })}
                    onSave={() => saveRef.current()} onScroll={onEditorScroll} onCursor={(line, col) => setCursor({ line, col })} />
                )}
                {dropHint && <div className="dropzone">{dropHint}</div>}
              </div>
              {warnings.length > 0 && (
                <ul className="warnings">{warnings.map((w, i) => <li key={i}><span className="codicon codicon-warning" /> {w}</li>)}</ul>
              )}
            </section>
          </div>
          {panel && <BottomPanel tab={panel} onTab={setPanel} onClose={() => setPanel(null)} problems={problems} links={links} current={path} onJump={jump} onFixLink={fixLink} dirty={dirty} save={() => save()} />}
        </div>
      </div>

      <footer className="statusbar">
        <span className={"sb-item sb-status " + (status.kind || "")}>
          <span className={"codicon " + (status.kind === "error" ? "codicon-error" : status.kind === "busy" ? "codicon-sync codicon-modifier-spin" : dirty ? "codicon-circle-filled" : "codicon-check")} /> {status.text}
        </span>
        <button className={"sb-item sb-btn" + (problemCount ? " has" : "")} title="Problems on the whole site (⌘J)" onClick={() => setPanel(panel === "problems" ? null : "problems")}>
          <span className="codicon codicon-warning" /> {problemCount}{here ? ` (${here} here)` : ""}
        </button>
        <button className={"sb-item sb-btn" + (links.length ? " has-links" : "")} title="Missed links: pages that mention another page without linking to it" onClick={() => setPanel(panel === "links" ? null : "links")}>
          <span className="codicon codicon-link" /> {links.length}{linksHere ? ` (${linksHere} here)` : ""}
        </button>
        <span className="spacer" />
        <button className="sb-item sb-btn" title={hudsonOut ? "Let Hudson back in" : "Send Hudson outside"} onClick={toggleHudson}>🐕 {hudsonOut ? "Hudson is outside" : "Hudson"}</button>
        <span className="sb-item">Ln {cursor.line}, Col {cursor.col}</span>
        <span className="sb-item">Spaces: 2</span>
        <span className="sb-item">Markdown</span>
      </footer>

      {caption && <CaptionDialog req={caption} />}
      {quick && <QuickOpen onClose={() => setQuick(false)} onOpen={(p) => { setQuick(false); openFile(p); }} />}
      <Toasts items={toasts} />
      {!hudsonOut && !bedtime && <Hudson path={path} text={text} base={head ?? ""} dirty={dirty} problemsHere={here} savedTick={savedTick} onHide={toggleHudson} />}
      {bedtime && <Bedtime />}
    </div>
  );
}
