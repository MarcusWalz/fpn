import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { CritiqueResult, Problem } from "../types";

interface Props {
  tab: "problems" | "critique";
  onTab(t: "problems" | "critique"): void;
  onClose(): void;
  problems: Problem[];
  current: string;
  onJump(p: Problem): void;
  dirty: boolean;
  save(): Promise<void>;
}

export default function BottomPanel({ tab, onTab, onClose, problems, current, onJump, dirty, save }: Props) {
  return (
    <section className="panel" aria-label="Panel">
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "problems"} className={"ptab" + (tab === "problems" ? " active" : "")} onClick={() => onTab("problems")}>
          Problems {problems.length > 0 && <vscode-badge variant="counter">{problems.length}</vscode-badge>}
        </button>
        <button role="tab" aria-selected={tab === "critique"} className={"ptab" + (tab === "critique" ? " active" : "")} onClick={() => onTab("critique")}>
          Study critique
        </button>
        <span className="spacer" />
        <button className="icon-btn codicon codicon-close" title="Close panel" onClick={onClose} />
      </div>
      <div className="panel-body">
        {tab === "problems" ? <Problems problems={problems} current={current} onJump={onJump} /> : <Critique path={current} dirty={dirty} save={save} />}
      </div>
    </section>
  );
}

function Problems({ problems, current, onJump }: { problems: Problem[]; current: string; onJump(p: Problem): void }) {
  if (!problems.length) return <p className="empty"><span className="codicon codicon-pass" /> No problems have been detected on the site.</p>;
  const groups = new Map<string, Problem[]>();
  for (const p of problems) groups.set(p.path, [...(groups.get(p.path) || []), p]);
  return (
    <div className="problems">
      {[...groups].map(([file, items]) => (
        <div key={file || "site"} className="pgroup">
          <div className={"pfile" + (file === current ? " current" : "")}>
            <span className="codicon codicon-markdown" /> {file ? file.split("/").pop() : "Site"} <span className="pdir">{file}</span>
            <vscode-badge variant="counter">{items.length}</vscode-badge>
          </div>
          {items.map((p, i) => {
            const [msg, note] = p.message.split(" — your note: ");
            return (
              <button key={i} className="pitem" disabled={!file} onClick={() => onJump(p)}>
                <span className="codicon codicon-warning" />
                <span>{msg}{note && <> — <span className="pnote">your note: {note}</span></>}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Critique({ path, dirty, save }: { path: string; dirty: boolean; save(): Promise<void> }) {
  const [res, setRes] = useState<CritiqueResult>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRes({}); setErr("");
    api.getCritique(path).then(setRes).catch((e) => setErr((e as Error).message));
  }, [path]);

  async function run() {
    if (dirty && confirm("You have unsaved changes. The critique reads the saved file.\n\nSave first?")) await save();
    setBusy(true); setErr("");
    try { setRes(await api.runCritique(path)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="critique">
      <div className="critique-bar">
        <vscode-button icon={res.html ? "refresh" : "play"} disabled={busy || undefined} onClick={run}>{res.html ? "Run again" : "Run critique"}</vscode-button>
        {busy && <><vscode-progress-ring /> <span className="muted">Your study partner is reading the saved page… (about 30 seconds)</span></>}
        {!busy && res.when && <span className="muted">{res.cached ? `From ${res.when}, page unchanged since` : `Done at ${res.when}`}</span>}
        {!busy && !res.html && !err && <span className="muted">Gaps, things to double-check, and test-yourself questions. It never gives the answers. Uses a little Claude usage.</span>}
      </div>
      {err && <p className="error"><span className="codicon codicon-error" /> {err}</p>}
      {res.html && <div ref={body} className="critique-body" dangerouslySetInnerHTML={{ __html: res.html }} />}
    </div>
  );
}
