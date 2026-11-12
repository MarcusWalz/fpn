import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { RefEntry } from "../types";
import { mdLink } from "../lib/paths";

// Every image inserted from the editor gets a caption with a "Source:" line.
// Skipping leaves "Source needed" (flagged in Problems) plus an optional
// private note that never reaches the site.

export interface CaptionRequest {
  target: string; // relative image path for the Markdown
  alt: string;
  thumb: string;
  resolve(block: string): void;
}

type Kind = "own" | "zotero" | "web";
const TIPS: Record<Kind, string> = {
  own: "Use for photos, screenshots or diagrams you made yourself. If you redrew or changed someone else's figure, pick Zotero or Website for the original and tick “adapted”.",
  zotero: "Type the item's Citation Key from Zotero (Info pane). The full reference is added to this page's References automatically. A page or figure number goes into that reference, not the caption.",
  web: "Give the organization or author, the page title, the year it was published, the date you looked at it, and the full web address. Check the site's terms or license allow reuse.",
};
const clean = (s: string) => s.trim().replace(/[.\s]+$/, "");

let refCache: Promise<RefEntry[]> | null = null;

export default function CaptionDialog({ req }: { req: CaptionRequest }) {
  const [caption, setCaption] = useState("");
  const [kind, setKind] = useState<Kind>("own");
  const [key, setKey] = useState("");
  const [loc, setLoc] = useState("");
  const [org, setOrg] = useState("");
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [accessed, setAccessed] = useState(new Date().toISOString().slice(0, 10));
  const [url, setUrl] = useState("");
  const [license, setLicense] = useState("");
  const [adapted, setAdapted] = useState(false);
  const [note, setNote] = useState("");
  const [refs, setRefs] = useState<RefEntry[]>([]);
  const first = useRef<HTMLInputElement>(null);
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dlg.current?.showModal();
    first.current?.focus();
    (refCache ??= api.refs().catch(() => [])).then(setRefs);
  }, []);

  const built = useMemo(() => {
    const pre = adapted ? "Adapted from " : "";
    let src = "";
    if (kind === "own") src = adapted ? "Own work, adapted" : "Own work";
    else if (kind === "zotero") src = key.trim() ? `${pre}[@${key.trim().replace(/^@/, "")}${loc.trim() ? ", " + loc.trim() : ""}]` : "";
    else {
      const when = accessed && `Accessed ${new Date(accessed + "T12:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
      const bits = [clean(org), clean(title), year.trim() && `Published ${year.trim()}`, when, url.trim()].filter(Boolean);
      src = bits.length ? pre + bits.join(". ") : "";
    }
    const cap = clean(caption) || "Describe the image";
    const lic = clean(license);
    return src
      ? { text: `*Figure: ${cap}. Source: ${clean(src)}.${lic ? " " + lic + "." : ""}*`, complete: true }
      : { text: `*Figure: ${cap}. Source needed.*`, complete: false };
  }, [caption, kind, key, loc, org, title, year, accessed, url, license, adapted]);

  function finish(skip: boolean) {
    const c = skip ? { text: `*Figure: ${clean(caption) || "Describe the image"}. Source needed.*`, complete: false } : built;
    const n = note.replace(/-->/g, "").replace(/\s+/g, " ").trim();
    const noteLine = !c.complete && n ? `\n<!-- source note: ${n} -->` : "";
    dlg.current?.close();
    req.resolve(`${mdLink(req.target, clean(caption) || req.alt, true)}\n\n${c.text}${noteLine}`);
  }

  const field = (label: string, value: string, set: (v: string) => void, opts: { hint?: string; placeholder?: string; type?: string; list?: string; inputRef?: React.Ref<HTMLInputElement> } = {}) => (
    <label className="field">
      <span>{label} {opts.hint && <em>{opts.hint}</em>}</span>
      <input ref={opts.inputRef} type={opts.type || "text"} value={value} placeholder={opts.placeholder} list={opts.list} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <dialog ref={dlg} className="caption-dialog" onCancel={(e) => { e.preventDefault(); finish(true); }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); finish(false); }}>
        <h2><span className="codicon codicon-file-media" /> Image source</h2>
        <div className="cap-top">
          {req.thumb && <img src={req.thumb} alt="" />}
          {field("Caption", caption, setCaption, { hint: "what the image shows", placeholder: "e.g. Correct cuff placement on the upper arm", inputRef: first })}
        </div>
        <label className="field">
          <span>Source type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="own">Own work</option>
            <option value="zotero">Zotero (article, book…)</option>
            <option value="web">Website</option>
          </select>
        </label>
        <p className="tip"><span className="codicon codicon-lightbulb" /> {TIPS[kind]}{kind === "zotero" && !refs.length && " (No Zotero library found in references/ yet; see docs/zotero.md. You can still type a key.)"}</p>
        {kind === "zotero" && <>
          {field("Citation key", key, setKey, { hint: "Zotero → item → Info → Citation Key", placeholder: "e.g. whelton2018", list: "cap-refs" })}
          <datalist id="cap-refs">{refs.map((r) => <option key={r.key} value={r.key} label={r.label} />)}</datalist>
          {field("Page or figure", loc, setLoc, { hint: "optional · listed in References", placeholder: "e.g. p. 312 or fig. 2" })}
        </>}
        {kind === "web" && <>
          {field("Organization or author", org, setOrg, { placeholder: "e.g. American Heart Association" })}
          {field("Page title", title, setTitle, { placeholder: "e.g. Understanding Blood Pressure Readings" })}
          <div className="row2">
            {field("Year published", year, setYear, { placeholder: "e.g. 2024" })}
            {field("Date accessed", accessed, setAccessed, { type: "date" })}
          </div>
          {field("Web address (URL)", url, setUrl, { type: "url", placeholder: "https://…" })}
        </>}
        <div className="row2">
          {field("License / permission", license, setLicense, { hint: "optional", placeholder: "e.g. Used under CC BY 4.0", list: "cap-licenses" })}
          <label className="check"><input type="checkbox" checked={adapted} onChange={(e) => setAdapted(e.target.checked)} /> I changed / adapted it</label>
        </div>
        <datalist id="cap-licenses"><option value="Used with permission" /><option value="Used under CC BY 4.0" /><option value="Used under CC BY-SA 4.0" /><option value="Public domain" /></datalist>
        <label className="field note-field">
          <span>Note for later <em>only if you skip · never shown on the site, only in Problems</em></span>
          <input value={note} placeholder="e.g. from Dr. Lee's lecture slides, week 3" onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="muted small">Caption that will be added:</p>
        <pre className={"cap-preview" + (built.complete ? "" : " incomplete")}>{built.text}</pre>
        <div className="actions">
          <vscode-button secondary onClick={() => finish(true)}>Skip for now</vscode-button>
          <vscode-button onClick={() => finish(false)}>Insert</vscode-button>
        </div>
      </form>
    </dialog>
  );
}
