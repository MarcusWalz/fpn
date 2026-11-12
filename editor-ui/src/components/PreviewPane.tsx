import { forwardRef, useImperativeHandle, useRef } from "react";

// The preview is the real page HTML in an iframe (srcdoc). Blocks carry
// data-src-line, so editor and preview can scroll in sync both ways.

export interface PreviewHandle {
  /** Scroll the preview to match an editor line. */
  syncToLine(line: number, totalLines: number, force?: boolean): void;
}

interface Props {
  html: string;
  /** Called with a (fractional) source line when the user scrolls the preview. */
  onScrollLine(line: number): void;
  onLoad(): void;
}

const HEADER = 80; // the site's sticky header inside the preview

const PreviewPane = forwardRef<PreviewHandle, Props>(function PreviewPane({ html, onScrollLine, onLoad }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const lock = useRef({ side: "", until: 0 });
  const locked = (side: string) => lock.current.side !== side && performance.now() < lock.current.until;
  const setLock = (side: string) => { lock.current = { side, until: performance.now() + 160 }; };

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
      if (!win || (!force && locked("editor"))) return;
      const as = anchors();
      let y = 0;
      if (as.length && line > as[0].line) {
        let i = as.length - 1;
        while (i > 0 && as[i].line > line) i--;
        const a = as[i], b = as[i + 1] || { line: totalLines + 1, y: win.document.documentElement.scrollHeight };
        y = a.y + (b.y - a.y) * ((line - a.line) / Math.max(1, b.line - a.line)) - HEADER;
      }
      setLock("preview");
      win.scrollTo(0, Math.max(0, y));
    },
  }));

  function handleLoad() {
    const win = frame.current?.contentWindow;
    if (win) {
      let raf = 0;
      win.addEventListener("scroll", () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          if (locked("preview")) return;
          const as = anchors();
          if (!as.length) return;
          if (win.scrollY <= 2) { setLock("editor"); onScrollLine(1); return; }
          const y = win.scrollY + HEADER;
          let i = as.length - 1;
          while (i > 0 && as[i].y > y) i--;
          const a = as[i], b = as[i + 1];
          const line = b && b.y > a.y ? a.line + (b.line - a.line) * Math.min(1, (y - a.y) / (b.y - a.y)) : a.line;
          setLock("editor");
          onScrollLine(line);
        });
      }, { passive: true });
    }
    onLoad();
  }

  return <iframe ref={frame} className="preview" title="Page preview" srcDoc={html} onLoad={handleLoad} />;
});

export default PreviewPane;
