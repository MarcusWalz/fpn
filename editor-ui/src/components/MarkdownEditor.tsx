import { forwardRef, useImperativeHandle, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { fpnTheme, monaco } from "../monaco";

export interface MarkdownEditorHandle {
  getValue(): string;
  focus(): void;
  /** Document offset at screen coordinates (or the cursor). */
  offsetAt(x?: number, y?: number): number;
  /** Insert text at an offset (or the cursor). */
  insert(text: string, offset?: number): void;
  /** Insert a block on its own lines after the line containing offset; returns the offset after it. */
  insertBlock(text: string, offset: number): number;
  select(from: number, to: number): void;
  /** First visible line, fractional (1-based). */
  topLine(): number;
  scrollToLine(line: number): void;
  lineCount(): number;
}

interface Props {
  /** Initial text. The editor is uncontrolled; remount (key) to load another file. */
  initialValue: string;
  onChange(text: string): void;
  onSave(): void;
  onScroll(): void;
  onCursor(line: number, col: number): void;
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(props, ref) {
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const cb = useRef(props);
  cb.current = props;

  const model = () => ed.current!.getModel()!;
  const cursorOffset = () => model().getOffsetAt(ed.current!.getPosition()!);

  useImperativeHandle(ref, () => ({
    getValue: () => ed.current?.getValue() ?? "",
    focus: () => ed.current?.focus(),
    offsetAt(x, y) {
      if (x != null && y != null) {
        const t = ed.current!.getTargetAtClientPoint(x, y);
        if (t?.position) return model().getOffsetAt(t.position);
      }
      return cursorOffset();
    },
    insert(text, offset) {
      const pos = model().getPositionAt(offset ?? cursorOffset());
      const range = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
      ed.current!.executeEdits("fpn", [{ range, text, forceMoveMarkers: true }]);
      ed.current!.focus();
    },
    insertBlock(text, offset) {
      const m = model();
      const pos = m.getPositionAt(Math.min(offset, m.getValueLength()));
      let line = pos.lineNumber;
      // Never insert inside the front matter: move to just after its closing ---.
      if (m.getLineContent(1).trim() === "---") {
        for (let l = 2; l <= m.getLineCount(); l++) {
          if (m.getLineContent(l).trim() === "---") { if (line <= l) line = l; break; }
        }
      }
      const content = m.getLineContent(line);
      const endCol = m.getLineMaxColumn(line);
      const before = content.trim() ? "\n\n" : content.length ? "\n" : "";
      const insert = before + text + "\n";
      const at = m.getOffsetAt({ lineNumber: line, column: endCol });
      ed.current!.executeEdits("fpn", [{ range: new monaco.Range(line, endCol, line, endCol), text: insert, forceMoveMarkers: true }]);
      const end = at + before.length + text.length;
      const p = m.getPositionAt(end);
      ed.current!.setPosition(p);
      ed.current!.revealPositionInCenterIfOutsideViewport(p);
      ed.current!.focus();
      return end;
    },
    select(from, to) {
      const m = model();
      const a = m.getPositionAt(from), b = m.getPositionAt(to);
      const range = new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column);
      ed.current!.setSelection(range);
      ed.current!.revealRangeInCenter(range);
      ed.current!.focus();
    },
    topLine() {
      const e = ed.current!;
      const top = e.getScrollTop();
      const n = model().getLineCount();
      let lo = 1, hi = n;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (e.getTopForLineNumber(mid) <= top) lo = mid; else hi = mid - 1;
      }
      const t0 = e.getTopForLineNumber(lo), t1 = lo < n ? e.getTopForLineNumber(lo + 1) : t0 + 20;
      return lo + Math.max(0, Math.min(1, (top - t0) / Math.max(1, t1 - t0)));
    },
    scrollToLine(line) {
      const e = ed.current!;
      const n = model().getLineCount();
      const l = Math.max(1, Math.min(n, Math.floor(line)));
      const t0 = e.getTopForLineNumber(l), t1 = l < n ? e.getTopForLineNumber(l + 1) : t0 + 20;
      e.setScrollTop(t0 + (line % 1) * (t1 - t0));
    },
    lineCount: () => ed.current?.getModel()?.getLineCount() ?? 1,
  }));

  const onMount: OnMount = (editor) => {
    ed.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => cb.current.onSave());
    editor.onDidScrollChange((e) => { if (e.scrollTopChanged) cb.current.onScroll(); });
    editor.onDidChangeCursorPosition((e) => cb.current.onCursor(e.position.lineNumber, e.position.column));
    editor.focus();
    (window as unknown as { __fpnEditor: unknown }).__fpnEditor = editor; // handy for debugging and tests
  };

  return (
    <Editor
      language="markdown"
      theme={fpnTheme()}
      defaultValue={props.initialValue}
      onChange={(v) => props.onChange(v ?? "")}
      onMount={onMount}
      options={{
        wordWrap: "on",
        minimap: { enabled: false },
        tabSize: 2,
        insertSpaces: true,
        detectIndentation: false,
        fontSize: 14,
        lineHeight: 22,
        scrollBeyondLastLine: false,
        renderWhitespace: "boundary",
        unicodeHighlight: { ambiguousCharacters: false },
        dropIntoEditor: { enabled: false }, // we handle drops (uploads, links)
        quickSuggestions: false,
        wordBasedSuggestions: "off",
        automaticLayout: true,
        padding: { top: 10 },
      }}
    />
  );
});

export default MarkdownEditor;
