// Thin wrappers over the `fpn serve` editor API (internal/site/editor*.go).
import type { CritiqueResult, FileEntry, PreviewResult, Problem, RefEntry, TreeEntry } from "./types";

const H = { "X-FPN-Editor": "1" };
const q = (p: string) => encodeURIComponent(p);

async function check(r: Response): Promise<Response> {
  if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
  return r;
}

export interface LoadedFile {
  text: string;
  mtime: string;
  isNew: boolean;
}

export async function loadFile(path: string): Promise<LoadedFile> {
  const r = await fetch(`/__api/file?path=${q(path)}`);
  if (r.status === 404) return { text: "", mtime: "", isNew: true };
  await check(r);
  return { text: await r.text(), mtime: r.headers.get("X-FPN-Mtime") || "", isNew: false };
}

export class ConflictError extends Error {}

export async function saveFile(path: string, text: string, mtime: string): Promise<string> {
  const headers: Record<string, string> = { ...H };
  if (mtime) headers["X-FPN-Mtime"] = mtime;
  const r = await fetch(`/__api/file?path=${q(path)}`, { method: "PUT", headers, body: text });
  if (r.status === 409) throw new ConflictError(await r.text());
  await check(r);
  return r.headers.get("X-FPN-Mtime") || "";
}

export async function preview(path: string, text: string): Promise<PreviewResult> {
  const r = await check(await fetch(`/__api/preview?path=${q(path)}`, { method: "POST", headers: H, body: text }));
  return r.json();
}

export const tree = async (): Promise<TreeEntry> => (await check(await fetch("/__api/tree"))).json();
export const files = async (): Promise<FileEntry[]> => (await check(await fetch("/__api/files"))).json();
export const problems = async (): Promise<Problem[]> => (await check(await fetch("/__api/problems"))).json();
export const linkSuggestions = async (): Promise<Problem[]> => (await check(await fetch("/__api/link-suggestions"))).json();
export const refs = async (): Promise<RefEntry[]> => (await check(await fetch("/__api/refs"))).json();

export async function gitStatus(): Promise<Record<string, string>> {
  const r = await fetch("/__api/git/status");
  if (!r.ok) return {};
  return (await r.json()).files || {};
}

/** File contents at the last commit, or null if it isn't committed. */
export async function gitShow(path: string): Promise<string | null> {
  const r = await fetch(`/__api/git/show?path=${q(path)}`);
  return r.ok ? r.text() : null;
}

const post = async (url: string, body?: BodyInit) =>
  check(await fetch(url, { method: "POST", headers: H, body }));

export const mkdir = async (path: string, title: string): Promise<{ path: string; index: string }> =>
  (await post(`/__api/mkdir?path=${q(path)}&title=${q(title)}`)).json();
export const move = async (from: string, to: string) => post(`/__api/move?from=${q(from)}&to=${q(to)}`);
export const remove = async (path: string) => post(`/__api/delete?path=${q(path)}`);

export async function upload(dir: string, file: File, name = file.name, mkdirFirst = false): Promise<{ path: string; name: string }> {
  const r = await post(`/__api/upload?dir=${q(dir)}&name=${q(name)}${mkdirFirst ? "&mkdir=1" : ""}`, file);
  return r.json();
}

export async function getCritique(path: string): Promise<CritiqueResult> {
  const r = await check(await fetch(`/__api/critique?path=${q(path)}`));
  return r.json();
}
export const runCritique = async (path: string): Promise<CritiqueResult> => (await post(`/__api/critique?path=${q(path)}`)).json();

export const rawURL = (path: string) => `/__api/raw?path=${q(path)}`;

export class NoClaudeError extends Error {}
export interface HudsonReq { path: string; title: string; added: string[]; removed: string[]; problems: number; unsavedMinutes: number; event: "change" | "poke" | "save" | "open"; recent: string[] }
/** One remark from Hudson, written by Claude from the actual changes. */
export async function hudson(req: HudsonReq): Promise<string> {
  const r = await fetch("/__api/hudson", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(req) });
  if (r.status === 501) throw new NoClaudeError();
  await check(r);
  return (await r.json()).text;
}
