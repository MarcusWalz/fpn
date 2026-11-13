import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Idiomorph } from "idiomorph";

// The preview is the real page HTML (rendered by Go) in an iframe. It loads
// once per page; after that each edit morphs the changed parts of <body> in
// place, so there's no reload flash and the scroll position stays put.
// Blocks carry data-src-line, so editor and preview can scroll in sync both ways.

export interface PreviewHandle {
  /** Scroll the preview to match an editor line. */
  syncToLine(line: number, totalLines: number, force?: boolean): void;
}

interface Props {
  html: string;
  /** Changing this (e.g. the file path) forces a full reload instead of a morph. */
  pageKey: string;
  /** A link was clicked: a site URL (same origin) or an external one. */
  onLink(url: URL, broken: boolean): void;
  /** Called with a (fractional) source line when the user scrolls the preview. */
  onScrollLine(line: number): void;
  onLoad(): void;
}

// Height of the site's sticky bars inside the preview (top bar, plus the
// "On this page" bar on narrow pages); app.js publishes it as --sticky-h.
const headerOf = (doc: Document | null | undefined) =>
  parseFloat(doc ? getComputedStyle(doc.documentElement).getPropertyValue("--sticky-h") : "") || 80;

const PreviewPane = forwardRef<PreviewHandle, Props>(function PreviewPane({ html, pageKey, onLink, onScrollLine, onLoad }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  // The page currently loaded in the frame, and the stylesheets it loaded with.
  // Until the frame's load event, edits wait in `pending` and replace each other.
  const shown = useRef<{ key: string; css: string } | null>(null);
  const loading = useRef(false);
  const pending = useRef<string | null>(null);
  const linkRef = useRef(onLink);
  linkRef.current = onLink;

  const cssOf = (d: Document) => [...d.querySelectorAll("link[rel=stylesheet]")].map((l) => l.getAttribute("href")).join("|");

  function show(next: string) {
    const f = frame.current;
    if (!f || !next) return;
    if (loading.current) { pending.current = next; return; }
    const doc = f.contentDocument;
    const parsed = new DOMParser().parseFromString(next, "text/html");
    if (doc && doc.body && shown.current && shown.current.key === pageKey && shown.current.css === cssOf(parsed)) {
      Idiomorph.morph(doc.body, parsed.body, { morphStyle: "innerHTML" });
      if (doc.title !== parsed.title) doc.title = parsed.title;
      return;
    }
    shown.current = { key: pageKey, css: cssOf(parsed) };
    loading.current = true;
    f.srcdoc = next;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => show(html), [html, pageKey]);
  // After we scroll the preview ourselves, ignore its scroll events briefly so
  // they don't echo back to the editor.
  const quietUntil = useRef(0);

  function anchors() {
    const doc = frame.current?.contentDocument, win = frame.current?.contentWindow;
    if (!doc || !win) return [];
    return [...doc.querySelectorAll<HTMLElement>("[data-src-line]")]
      .map((el) => ({ line: +el.dataset.srcLine!, y: el.getBoundingClientRect().top + win.scrollY }))
      .filter((a) => a.line > 0)
      .sort((a, b) => a.line - b.line || a.y - b.y);
  }

  useImperativeHandle(ref, () => ({
    syncToLine(line, totalLines, force) {
      const win = frame.current?.contentWindow;
      if (!win) return;
      void force;
      const as = anchors();
      let y = 0;
      if (as.length && line > as[0].line) {
        let i = as.length - 1;
        while (i > 0 && as[i].line > line) i--;
        const a = as[i], b = as[i + 1] || { line: totalLines + 1, y: win.document.documentElement.scrollHeight };
        y = a.y + (b.y - a.y) * ((line - a.line) / Math.max(1, b.line - a.line)) - headerOf(win.document);
      }
      quietUntil.current = performance.now() + 200;
      win.scrollTo(0, Math.max(0, y));
    },
  }));

  function handleLoad() {
    loading.current = false;
    const win = frame.current?.contentWindow;
    if (win) {
      // The preview only shows the page; it never navigates itself. Same-page
      // links (#ref-1) scroll; every other link goes to the editor (onLink),
      // which opens notebook pages there and anything else in a browser tab.
      const doc = win.document;
      doc.addEventListener("click", (e) => {
        const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute("href") || "";
        if (href.startsWith("#")) {
          const id = decodeURIComponent(href.slice(1));
          const el = id ? doc.getElementById(id) : null;
          if (el) win.scrollTo(0, el.getBoundingClientRect().top + win.scrollY - headerOf(doc));
          else if (!id) win.scrollTo(0, 0);
          return;
        }
        try { linkRef.current(new URL(a.href), a.classList.contains("broken-link")); } catch { /* not a URL */ }
      });
      doc.addEventListener("submit", (e) => e.preventDefault());
      let raf = 0;
      win.addEventListener("scroll", () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          if (performance.now() < quietUntil.current) return;
          const as = anchors();
          if (!as.length) return;
          if (win.scrollY <= 2) { onScrollLine(1); return; }
          const y = win.scrollY + headerOf(win.document);
          let i = as.length - 1;
          while (i > 0 && as[i].y > y) i--;
          const a = as[i], b = as[i + 1];
          const line = b && b.y > a.y ? a.line + (b.line - a.line) * Math.min(1, (y - a.y) / (b.y - a.y)) : a.line;
          onScrollLine(line);
        });
      }, { passive: true });
    }
    onLoad();
    // An edit that arrived while the page was loading.
    const p = pending.current;
    pending.current = null;
    if (p !== null) show(p);
  }

  return <iframe ref={frame} className="preview" title="Page preview" onLoad={handleLoad} />;
});

export default PreviewPane;
