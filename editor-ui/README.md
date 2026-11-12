# fpn editor (React)

The dev-only editor served by `fpn serve` at `/__editor/`. It's a VS Code-style workbench built with React 19, TypeScript, Vite, **Monaco** (the VS Code editor, Markdown only) and **VS Code Elements** (`@vscode-elements/elements`).

The build output lives in `../web/editor/` and **is committed**: it's embedded in the Go binary, so contributors who don't touch the editor never need Node.

```sh
npm install
npm run dev        # http://localhost:5173/__editor/ — proxies API + site to a running `fpn serve` on :1313
npm run typecheck
npm run build      # writes ../web/editor (commit it)
```

- `src/App.tsx`: the workbench (loading/saving, preview, diff, problems, drops, layout)
- `src/components/`: Explorer (file tree), MarkdownEditor (Monaco), PreviewPane (scroll sync), DiffPane (Monaco diff), BottomPanel (Problems, Study critique), CaptionDialog (image sources), QuickOpen (⌘P), Toast
- `src/api.ts`: the `fpn serve` editor API (`internal/site/editor*.go`)
- `src/monaco-slim.js`: a generated Monaco entry with the editor features and Markdown only. Regenerate it from `node_modules/monaco-editor/esm/vs/index.js` after a Monaco upgrade: keep the `./editor/`, `./base/` and `./features/` imports plus the final `export {…} from './editor/editor.api.js'`, and rewrite `./` to `monaco-esm/`.

Shortcuts: ⌘S save · ⌘P go to page · ⌘J toggle Problems · Tab / Shift-Tab indent lists.
