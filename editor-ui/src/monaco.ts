// Bundle Monaco locally (no CDN) and define fpn's green themes.
import * as monaco from "./monaco-slim.js";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
loader.config({ monaco });

monaco.editor.defineTheme("fpn-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword.md", foreground: "bbf7d0", fontStyle: "bold" }, // headings
    { token: "keyword", foreground: "bbf7d0", fontStyle: "bold" },
    { token: "string.link.md", foreground: "fde68a" },
    { token: "string.link", foreground: "fde68a" },
    { token: "variable.md", foreground: "4ade80" },
    { token: "variable", foreground: "4ade80" },
    { token: "variable.source.md", foreground: "fcd34d" },
    { token: "string.md", foreground: "a7f3d0" },
    { token: "strong.md", fontStyle: "bold" },
    { token: "emphasis.md", fontStyle: "italic" },
    { token: "comment.md", foreground: "94bba3", fontStyle: "italic" },
    { token: "comment", foreground: "94bba3", fontStyle: "italic" },
    { token: "meta.separator.md", foreground: "86efac" },
  ],
  colors: {
    "editor.background": "#0d1f15",
    "editor.foreground": "#dcf5e4",
    "editorLineNumber.foreground": "#4f7a5f",
    "editorLineNumber.activeForeground": "#bbf7d0",
    "editor.lineHighlightBackground": "#12301f",
    "editor.selectionBackground": "#365314",
    "editorCursor.foreground": "#22c55e",
    "editorIndentGuide.background1": "#173a26",
    "diffEditor.insertedTextBackground": "#22c55e33",
    "diffEditor.removedTextBackground": "#ef444433",
  },
});

monaco.editor.defineTheme("fpn-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "keyword.md", foreground: "14532d", fontStyle: "bold" },
    { token: "keyword", foreground: "14532d", fontStyle: "bold" },
    { token: "string.link.md", foreground: "92400e" },
    { token: "string.link", foreground: "92400e" },
    { token: "variable.md", foreground: "15803d" },
    { token: "variable", foreground: "15803d" },
    { token: "variable.source.md", foreground: "9a3412" },
    { token: "string.md", foreground: "3f6212" },
    { token: "strong.md", fontStyle: "bold" },
    { token: "emphasis.md", fontStyle: "italic" },
    { token: "comment.md", foreground: "476352", fontStyle: "italic" },
    { token: "comment", foreground: "476352", fontStyle: "italic" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editor.lineHighlightBackground": "#ecfdf5",
    "editor.selectionBackground": "#d9f99d",
    "editorCursor.foreground": "#15803d",
  },
});

export const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
export const fpnTheme = () => (prefersDark() ? "fpn-dark" : "fpn-light");
export { monaco };
