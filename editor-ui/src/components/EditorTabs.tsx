import { useEffect, useRef, useState } from "react";

// The open files, VS Code style. A temporary tab (italic) is replaced by the
// next file you open; editing it, or double-clicking it, keeps it.

interface Props {
  tabs: string[];
  active: string;
  transient: string | null;
  isDirty(path: string): boolean;
  onSelect(path: string): void;
  onClose(path: string): void;
  onPin(path: string): void;
  onReorder(tabs: string[]): void;
}

const TAB_TYPE = "application/x-fpn-tab";

/** "diabetes-mellitus.md", or "diabetes-mellitus/ index" for a chapter's _index.md. */
export function tabLabel(path: string) {
  const parts = path.split("/");
  const name = parts.pop()!;
  return name === "_index.md" ? `${parts.pop() || "content"}/ index` : name;
}

export default function EditorTabs({ tabs, active, transient, isDirty, onSelect, onClose, onPin, onReorder }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);

  useEffect(() => {
    bar.current?.querySelector<HTMLElement>(".file-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs]);

  // Names that appear twice show their folder too.
  const counts = new Map<string, number>();
  for (const t of tabs) counts.set(tabLabel(t), (counts.get(tabLabel(t)) || 0) + 1);

  const drop = (target: string, e: React.DragEvent) => {
    const from = e.dataTransfer.getData(TAB_TYPE);
    setDropAt(null);
    if (!from || from === target) return;
    e.preventDefault();
    const rest = tabs.filter((t) => t !== from);
    rest.splice(rest.indexOf(target), 0, from);
    onReorder(rest);
  };

  return (
    <div className="tabbar file-tabs" role="tablist" aria-label="Open files" ref={bar}
      onWheel={(e) => { if (bar.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) bar.current.scrollLeft += e.deltaY; }}>
      {tabs.map((t) => {
        const dirty = isDirty(t);
        const label = tabLabel(t);
        const dir = t.split("/").slice(-2, -1)[0];
        return (
          <div key={t} role="tab" aria-selected={t === active} tabIndex={t === active ? 0 : -1} title={t + (dirty ? " (unsaved)" : "")}
            className={"tab file-tab" + (t === active ? " active" : "") + (t === transient ? " transient" : "") + (dirty ? " dirty" : "") + (dropAt === t ? " drop-before" : "")}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData(TAB_TYPE, t); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_TYPE)) { e.preventDefault(); setDropAt(t); } }}
            onDragLeave={() => setDropAt((d) => (d === t ? null : d))}
            onDrop={(e) => drop(t, e)}
            onClick={() => onSelect(t)}
            onDoubleClick={() => onPin(t)}
            onAuxClick={(e) => { if (e.button === 1 && tabs.length > 1) { e.preventDefault(); onClose(t); } }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t); } }}>
            <span className="codicon codicon-markdown" />
            <span className="tab-name">{label}{(counts.get(label) || 0) > 1 && dir && label !== `${dir}/ index` && <span className="tab-dir"> · {dir}</span>}</span>
            {tabs.length > 1 ? (
              <button className="tab-close" title={dirty ? "Unsaved changes. Close" : "Close (⌥W)"} aria-label={`Close ${label}`}
                onClick={(e) => { e.stopPropagation(); onClose(t); }}>
                <span className="codicon codicon-close" /><span className="dot" aria-hidden="true">●</span>
              </button>
            ) : dirty && <span className="dot" aria-label="unsaved">●</span>}
          </div>
        );
      })}
    </div>
  );
}
