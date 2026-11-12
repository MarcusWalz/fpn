// VS Code Elements' <vscode-icon> adopts the codicon stylesheet from a
// <link id="vscode-codicon-stylesheet">, so ship codicon.css + font as plain
// public files rather than bundling them.
import { copyFileSync, mkdirSync } from "node:fs";
const src = new URL("../node_modules/@vscode/codicons/dist/", import.meta.url);
const dst = new URL("../public/", import.meta.url);
mkdirSync(dst, { recursive: true });
for (const f of ["codicon.css", "codicon.ttf"]) copyFileSync(new URL(f, src), new URL(f, dst));
