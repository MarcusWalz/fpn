import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { FileEntry } from "../types";

// ⌘P / Ctrl+P: VS Code-style quick open over every page and section index.
export default function QuickOpen({ onOpen, onClose }: { onOpen(p: string): void; onClose(): void }) {
  const [all, setAll] = useState<FileEntry[]>([]);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); api.files().then(setAll).catch(() => {}); }, []);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = all
      .map((f) => ({ f, hay: (f.title + " " + f.path).toLowerCase() }))
      .filter(({ hay }) => terms.every((t) => hay.includes(t)))
      .map(({ f }) => ({ f, s: terms.length && f.title.toLowerCase().startsWith(terms[0]) ? 0 : 1 }));
    scored.sort((a, b) => a.s - b.s || a.f.title.length - b.f.title.length);
    return scored.slice(0, 50).map((x) => x.f);
  }, [all, q]);

  return (
    <div className="quick-backdrop" onMouseDown={onClose}>
      <div className="quick" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Search pages by title or path…"
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && results[active]) onOpen(results[active].path);
          }}
        />
        <div className="quick-list" role="listbox">
          {results.map((f, i) => (
            <div key={f.path} role="option" aria-selected={i === active} className={"quick-item" + (i === active ? " active" : "")} onMouseEnter={() => setActive(i)} onClick={() => onOpen(f.path)}>
              <span className={"codicon " + (f.path.endsWith("_index.md") ? "codicon-book" : "codicon-markdown")} />
              <span className="qt">{f.title}</span>
              <span className="qp">{f.path}</span>
            </div>
          ))}
          {!results.length && <div className="quick-empty">No matching pages</div>}
        </div>
      </div>
    </div>
  );
}
