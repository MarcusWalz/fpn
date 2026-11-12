import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Problem } from "./types";
import MarkdownEditor, { type MarkdownEditorHandle } from "./components/MarkdownEditor";
import FileTree, { DRAG_TYPE, type FileTreeHandle } from "./components/FileTree";
import PreviewPane, { type PreviewHandle } from "./components/PreviewPane";
import DiffPane from "./components/DiffPane";
import BottomPanel from "./components/BottomPanel";
import CaptionDialog, { type CaptionRequest } from "./components/CaptionDialog";
import QuickOpen from "./components/QuickOpen";
import Toasts, { type ToastMsg } from "./components/Toast";
import { IMG, dirOf, mdLink, pageSkeleton, relFrom, slugify } from "./lib/paths";
import { diffStats } from "./lib/diff";

const pathFromURL = () => (new URLSearchParams(location.search).get("path") || "_index.md").replace(/^\/+|^content\//g, "");
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

export default function App() {
  const [path, setPath] = useState(pathFromURL);
  const [loadKey, setLoadKey] = useState(0);
  const [initial, setInitial] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [isNew, setIsNew] = useState(false);
  const mtime = useRef("");
  const [status, setStatus] = useState<{ text: string; kind?: "dirty" | "error" | "busy" }>({ text: "Loading…" });
  const [html, setHtml] = useState("");
  const [viewURL, setViewURL] = useState("/");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<"preview" | "diff">((ls.get("fpn-left-tab") as "preview" | "diff") || "preview");
  const [diffBase, setDiffBase] = useState<"head" | "saved">((ls.get("fpn-diff-base") as "head" | "saved") || "head");
  const [sideBySide, setSideBySide] = useState(ls.get("fpn-diff-sbs") === "1");
  const [head, setHead] = useState<string | null>(null);
  const [stats, setStats] = useState({ add: 0, del: 0 });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [panel, setPanel] = useState<null | "problems" | "critique">(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [treeHidden, setTreeHidden] = useState(ls.get("fpn-tree-hidden") === "1" || innerWidth < 900);
  const [split, setSplit] = useState(ls.get("fpn-split") || "50%");
  const [narrowPreview, setNarrowPreview] = useState(false);
  const [caption, setCaption] = useState<CaptionRequest | null>(null);
  const [quick, setQuick] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [dropHint, setDropHint] = useState("");

  const editor = useRef<MarkdownEditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const treeRef = useRef<FileTreeHandle>(null);
  const editorQuietUntil = useRef(0);
  const findOnLoad = useRef(new URLSearchParams(location.search).get("find") || "");
  const dirty = text !== saved || (isNew && initial !== null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const pageDir = dirOf(path);

  const toast = useCallback((t: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs, { id, text: t, error }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), error ? 6000 : 3500);
  }, []);

  // ---------- navigation & loading ----------
  const openFile = useCallback((p: string, find = "") => {
    if (p === path && !find) return;
    if (dirtyRef.current && !confirm("You have unsaved changes in this page. Leave without saving?")) return;
    const url = `?path=${encodeURIComponent(p)}${find ? "&find=" + encodeURIComponent(find) : ""}`;
    history.pushState(null, "", url);
    findOnLoad.current = find;
    if (p === path) { selectFind(); return; }
    setPath(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const onPop = () => { findOnLoad.current = new URLSearchParams(location.search).get("find") || ""; setPath(pathFromURL()); };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus({ text: "Loading…" });
    (async () => {
      try {
        const f = await api.loadFile(path);
        if (cancelled) return;
        const t = f.isNew ? pageSkeleton(new URLSearchParams(location.search).get("title") || path.split("/").pop()!.replace(/\.md$/i, "").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()), path.endsWith("_index.md")) : f.text;
        mtime.current = f.mtime;
        setIsNew(f.isNew);
        setInitial(t);
        setText(t);
        setSaved(f.isNew ? "" : t);
        setLoadKey((k) => k + 1);
        setStatus(f.isNew ? { text: "New file, not saved yet", kind: "dirty" } : { text: "Saved" });
        setHead(await api.gitShow(path));
        document.title = `${path} · fpn editor`;
      } catch (e) { setStatus({ text: "Couldn't open file", kind: "error" }); toast((e as Error).message, true); }
    })();
    return () => { cancelled = true; };
  }, [path, toast]);

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
    if (initial === null) return;
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
  }, [text, path, initial, head, diffBase, saved]);

  // ---------- save ----------
  const save = useCallback(async (force = false) => {
    if (!dirtyRef.current && !force) return;
    const body = editor.current?.getValue() ?? text;
    setStatus({ text: "Saving…", kind: "busy" });
    try {
      const wasNew = isNew;
      mtime.current = await api.saveFile(path, body, force ? "" : mtime.current);
      setSaved(body); setText(body); setIsNew(false);
      setStatus({ text: "Saved ✓" });
      setTimeout(() => (wasNew ? treeRef.current?.reload() : treeRef.current?.refreshStatus()), 300);
      setTimeout(refreshProblems, 1500);
    } catch (e) {
      if (e instanceof api.ConflictError) {
        setStatus({ text: "Conflict", kind: "error" });
        if (confirm("This file changed on disk since you opened it (another editor, or git).\n\nOverwrite it with your version?")) return save(true);
        return;
      }
      setStatus({ text: "Save failed", kind: "error" });
      toast("Save failed: " + (e as Error).message, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, text, isNew, toast]);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (dirty) setStatus((s) => (s.kind === "busy" ? s : { text: isNew ? "New file, not saved yet" : "Unsaved", kind: "dirty" }));
  }, [dirty, isNew]);

  // ---------- problems ----------
  const refreshProblems = useCallback(async () => { try { setProblems(await api.problems()); } catch { /* server restarting */ } }, []);
  useEffect(() => { refreshProblems(); const t = setInterval(refreshProblems, 3000); return () => clearInterval(t); }, [refreshProblems]);
  const jump = (p: Problem) => {
    if (!p.path) return;
    if (p.path === path) { findOnLoad.current = p.find || ""; selectFind(); } else openFile(p.path, p.find || "");
  };

  // ---------- keyboard & unload ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveRef.current(); }
      else if (mod && e.key.toLowerCase() === "p" && !e.shiftKey) { e.preventDefault(); setQuick(true); }
      else if (mod && e.key === "j") { e.preventDefault(); setPanel((p) => (p ? null : "problems")); }
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
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
  const setTab = (t: "preview" | "diff") => { setLeftTab(t); ls.set("fpn-left-tab", t); };

  const problemCount = problems.length;
  const here = problems.filter((p) => p.path === path).length;

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
        {!treeHidden && <FileTree ref={treeRef} current={path} isDirty={() => dirtyRef.current} onOpen={(p) => openFile(p)} toast={toast} />}
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
                {leftTab === "preview" ? (
                  <PreviewPane ref={previewRef} html={html} onScrollLine={onPreviewScrollLine}
                    onLoad={() => editor.current && previewRef.current?.syncToLine(editor.current.topLine(), editor.current.lineCount(), true)} />
                ) : (
                  <DiffPane base={diffBase} onBase={(b) => { setDiffBase(b); ls.set("fpn-diff-base", b); }} sideBySide={sideBySide}
                    onSideBySide={(v) => { setSideBySide(v); ls.set("fpn-diff-sbs", v ? "1" : "0"); }}
                    original={diffBase === "head" ? head : saved} modified={text} stats={stats} />
                )}
              </div>
            </section>
            <div className="sash" role="separator" aria-orientation="vertical" title="Drag to resize" onPointerDown={startDrag} />
            <section className="right" aria-label="Markdown editor"
              onDragOverCapture={onEditorDragOver} onDropCapture={onEditorDrop} onPasteCapture={onEditorPaste}
              onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropHint(""); }}>
              <div className="tabbar"><div className="tab active file-tab"><span className="codicon codicon-markdown" /> {path.split("/").pop()}{dirty && <span className="dot">●</span>}</div></div>
              <div className="monaco-host">
                {initial !== null && (
                  <MarkdownEditor key={loadKey} ref={editor} initialValue={initial} onChange={setText} onSave={() => saveRef.current()}
                    onScroll={onEditorScroll} onCursor={(line, col) => setCursor({ line, col })} />
                )}
                {dropHint && <div className="dropzone">{dropHint}</div>}
              </div>
              {warnings.length > 0 && (
                <ul className="warnings">{warnings.map((w, i) => <li key={i}><span className="codicon codicon-warning" /> {w}</li>)}</ul>
              )}
            </section>
          </div>
          {panel && <BottomPanel tab={panel} onTab={setPanel} onClose={() => setPanel(null)} problems={problems} current={path} onJump={jump} dirty={dirty} save={() => save()} />}
        </div>
      </div>

      <footer className="statusbar">
        <span className={"sb-item sb-status " + (status.kind || "")}>
          <span className={"codicon " + (status.kind === "error" ? "codicon-error" : status.kind === "busy" ? "codicon-sync codicon-modifier-spin" : dirty ? "codicon-circle-filled" : "codicon-check")} /> {status.text}
        </span>
        <button className={"sb-item sb-btn" + (problemCount ? " has" : "")} title="Problems on the whole site (⌘J)" onClick={() => setPanel(panel === "problems" ? null : "problems")}>
          <span className="codicon codicon-warning" /> {problemCount}{here ? ` (${here} here)` : ""}
        </button>
        <span className="spacer" />
        <span className="sb-item">Ln {cursor.line}, Col {cursor.col}</span>
        <span className="sb-item">Spaces: 2</span>
        <span className="sb-item">Markdown</span>
      </footer>

      {caption && <CaptionDialog req={caption} />}
      {quick && <QuickOpen onClose={() => setQuick(false)} onOpen={(p) => { setQuick(false); openFile(p); }} />}
      <Toasts items={toasts} />
    </div>
  );
}
