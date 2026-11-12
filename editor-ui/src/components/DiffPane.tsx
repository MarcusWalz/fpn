import { useRef } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { fpnTheme } from "../monaco";
import { useVsEvent } from "../lib/useVsEvent";

const HIDE = { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 };

interface Props {
  base: "head" | "saved";
  onBase(b: "head" | "saved"): void;
  sideBySide: boolean;
  onSideBySide(v: boolean): void;
  original: string | null; // null = not committed yet
  modified: string;
  stats: { add: number; del: number };
}

export default function DiffPane({ base, onBase, sideBySide, onSideBySide, original, modified, stats }: Props) {
  const sel = useRef<HTMLElement>(null);
  const chk = useRef<HTMLElement>(null);
  useVsEvent(sel, "change", (e) => onBase((e.target as HTMLSelectElement).value as "head" | "saved"));
  useVsEvent(chk, "change", (e) => onSideBySide((e.target as HTMLInputElement).checked));
  return (
    <div className="diff-pane">
      <div className="diff-bar">
        <label>Compare with</label>
        <vscode-single-select ref={sel} value={base}>
          <vscode-option value="head">last commit</vscode-option>
          <vscode-option value="saved">saved file</vscode-option>
        </vscode-single-select>
        <vscode-checkbox ref={chk} label="Side by side" checked={sideBySide || undefined} />
        <span className="diff-stats"><span className="add">+{stats.add}</span> <span className="del">−{stats.del}</span></span>
      </div>
      {base === "head" && original === null && <p className="note">New file: not in the last commit yet, so everything shows as added.</p>}
      <div className="diff-editor">
        <DiffEditor
          language="markdown"
          theme={fpnTheme()}
          original={original ?? ""}
          modified={modified}
          onMount={(d) => {
            (window as unknown as { __fpnDiff: unknown }).__fpnDiff = d;
            // Monaco ignores hideUnchangedRegions until it is toggled after the first diff.
            const once = d.onDidUpdateDiff(() => {
              once.dispose();
              d.updateOptions({ hideUnchangedRegions: { enabled: false } });
              d.updateOptions({ hideUnchangedRegions: { ...HIDE, enabled: true } });
            });
          }}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          options={{ readOnly: true, renderSideBySide: sideBySide, hideUnchangedRegions: HIDE, wordWrap: "on", minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, renderOverviewRuler: false }}
        />
      </div>
    </div>
  );
}
