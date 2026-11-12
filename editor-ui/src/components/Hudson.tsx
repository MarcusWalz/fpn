// Hudson: the editor's assistant, in the tradition of a certain paperclip.
// He watches your unsaved/uncommitted changes and throws shade. He is not helpful. The hens are worse.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChickenSprite, DOG_W, HEN_W, HENS, HudsonSprite, type Eyes } from "./Pixels";
import { IDLE, POKED, SAVED, changedLines, findShade } from "../lib/shade";
import * as api from "../api";

const GREET = ["Oh. You're back.", "Hi. I've already seen what you did last time.", "Look who decided to show up.", "The chickens and I were just talking about you."];
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const SCALE = 3;
const SPEED = [75, 38]; // px/s: Hudson, hens
interface Actor { x: number; dur: number; left: boolean; walking: boolean; peck: boolean }
const AUTO_GAP = 60_000; // at most one unprompted remark a minute (each Claude-written one costs a little usage)

interface Props { path: string; text: string; base: string; dirty: boolean; problemsHere: number; savedTick: number; onHide: () => void }

export default function Hudson({ path, text, base, dirty, problemsHere, savedTick, onHide }: Props) {
  const [bubble, setBubble] = useState<string | null>(null);
  const [eyes, setEyes] = useState<Eyes>("side");
  const [speaking, setSpeaking] = useState(false);
  // Actor 0 is Hudson, 1–4 are the hens. Each wanders the bottom of the window on its own.
  const [crew, setCrew] = useState<Actor[]>(() => [DOG_W, ...HENS.map(() => HEN_W)].map((w, i) => ({
    x: Math.random() * Math.max(0, innerWidth - w * SCALE), dur: 0, left: Math.random() < 0.5, walking: false, peck: false,
  })));
  const crewRef = useRef(crew);
  crewRef.current = crew;
  const bubbleRef = useRef(false);
  bubbleRef.current = bubble !== null;
  const used = useRef(new Set<string>());
  const lastAt = useRef(0);
  const lastText = useRef(text);
  const dirtySince = useRef(0);
  const pokes = useRef<number[]>([]);
  const hide = useRef<number | undefined>(undefined);
  const live = useRef({ path, text, base, problemsHere });
  live.current = { path, text, base, problemsHere };
  const ai = useRef<"yes" | "no">("yes"); // "no" once we learn Claude Code isn't installed
  const recent = useRef<string[]>([]);
  const asking = useRef(false);

  if (dirty && !dirtySince.current) dirtySince.current = Date.now();
  if (!dirty) dirtySince.current = 0;

  const say = useCallback((msg: string) => {
    lastAt.current = Date.now();
    lastText.current = live.current.text;
    setBubble(msg);
    setSpeaking(true);
    setEyes("roll");
    setTimeout(() => setEyes("glare"), 700);
    setTimeout(() => { setEyes("side"); setSpeaking(false); }, 1800);
    setCrew((c) => c.map((a, i) => (i && !a.walking ? { ...a, peck: true } : a))); // backup singers
    setTimeout(() => setCrew((c) => c.map((a) => ({ ...a, peck: false }))), 400);
    clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setBubble(null), 8000 + msg.length * 40);
    recent.current = [...recent.current.slice(-5), msg];
  }, []);

  const nextShade = useCallback(() => {
    const { text, base, problemsHere } = live.current;
    const q = findShade({ text, base, problemsHere, dirtyMs: dirtySince.current ? Date.now() - dirtySince.current : 0, now: new Date() })
      .find((x) => !used.current.has(x.key));
    if (q) used.current.add(q.key);
    return q?.text;
  }, []);

  /** A remark written by Claude from the actual changes; falls back to the built-in ones. */
  const remark = useCallback(async (event: "change" | "poke" | "save" | "open", fallback: () => string | undefined) => {
    if (asking.current) return;
    if (ai.current === "no") { const f = fallback(); if (f) say(f); return; }
    asking.current = true;
    lastAt.current = Date.now(); // hold off other remarks while he thinks
    if (event === "poke") { setBubble("sniff… sniff…"); setEyes("glare"); }
    const { path, text, base, problemsHere } = live.current;
    const { added, removedLines } = changedLines(base, text);
    const keep = (ls: string[]) => ls.filter((l) => l.trim()).slice(0, 80);
    try {
      say(await api.hudson({
        path, title: text.match(/^title:\s*(.+)$/m)?.[1] ?? path, added: keep(added), removed: keep(removedLines),
        problems: problemsHere, unsavedMinutes: dirtySince.current ? Math.floor((Date.now() - dirtySince.current) / 60000) : 0,
        event, recent: recent.current,
      }));
    } catch (e) {
      if (e instanceof api.NoClaudeError) ai.current = "no";
      const f = fallback();
      if (f) say(f); else if (event === "poke") setBubble(null);
    } finally { asking.current = false; }
  }, [say]);

  // Greeting.
  // On open: if the page already has changes, his first remark is about them; otherwise a greeting.
  useEffect(() => {
    const t = setTimeout(() => {
      if (live.current.text && live.current.text !== live.current.base) remark("open", () => nextShade() || pick(GREET));
      else say(pick(GREET));
    }, 2500);
    return () => clearTimeout(t);
  }, [say, remark, nextShade]);

  // After you stop typing for a bit, he has thoughts.
  useEffect(() => {
    const t = setTimeout(() => {
      if (Date.now() - lastAt.current < AUTO_GAP || live.current.text === lastText.current) return;
      if (live.current.text === live.current.base) return; // nothing to judge
      remark("change", nextShade);
    }, 4500);
    return () => clearTimeout(t);
  }, [text, remark, nextShade]);

  // Slow clock: unsaved-for-ages and almost-bedtime remarks.
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - lastAt.current < AUTO_GAP * 2) return;
      const s = nextShade();
      if (s && /minutes/.test(s)) say(s);
    }, 60_000);
    return () => clearInterval(t);
  }, [say, nextShade]);

  // Saving earns a remark too (sometimes).
  const firstSave = useRef(savedTick);
  useEffect(() => {
    if (savedTick === firstSave.current) return;
    if (Date.now() - lastAt.current > 20_000 && Math.random() < 0.5) remark("save", () => pick(SAVED));
  }, [savedTick, remark]);

  // Blinking.
  useEffect(() => {
    let alive = true;
    const blink = () => {
      if (!alive) return;
      setEyes((e) => (e === "side" ? "closed" : e));
      setTimeout(() => setEyes((e) => (e === "closed" ? "side" : e)), 160);
      setTimeout(blink, 3500 + Math.random() * 4000);
    };
    const b = setTimeout(blink, 3000);
    return () => { alive = false; clearTimeout(b); };
  }, []);

  // Everyone wanders: rest a random while, then walk to a random spot anywhere along the bottom.
  useEffect(() => {
    const timers: number[] = [];
    const set = (i: number, patch: Partial<Actor>) => setCrew((c) => c.map((a, k) => (k === i ? { ...a, ...patch } : a)));
    const pos = crewRef;
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
    const rest = (i: number) => {
      set(i, { walking: false });
      const ms = i === 0 ? 2000 + Math.random() * 9000 : 800 + Math.random() * 6000;
      if (i > 0) for (let t = 300; t < ms - 300; t += 500 + Math.random() * 900) { later(() => set(i, { peck: true }), t); later(() => set(i, { peck: false }), t + 220); }
      later(() => walk(i), ms);
    };
    const walk = (i: number) => {
      if (i === 0 && bubbleRef.current) return later(() => walk(i), 1500); // he stays put while he talks
      const w = (i === 0 ? DOG_W : HEN_W) * SCALE;
      const max = Math.max(0, innerWidth - w - 4);
      const from = pos.current[i].x;
      const to = Math.random() < 0.3 ? Math.min(max, Math.max(0, from + (Math.random() - 0.5) * 160)) : Math.random() * max;
      const dur = Math.abs(to - from) / SPEED[i === 0 ? 0 : 1];
      // Hudson's sprite faces right, the hens face left.
      set(i, { x: to, dur, walking: true, peck: false, left: to < from });
      later(() => rest(i), dur * 1000 + 50);
    };
    crewRef.current.forEach((_, i) => later(() => rest(i), Math.random() * 1500));
    const onResize = () => setCrew((c) => c.map((a, i) => ({ ...a, dur: 0, x: Math.min(a.x, Math.max(0, innerWidth - (i ? HEN_W : DOG_W) * SCALE - 4)) })));
    addEventListener("resize", onResize);
    return () => { timers.forEach(clearTimeout); removeEventListener("resize", onResize); };
  }, []);

  const poke = () => {
    const now = Date.now();
    pokes.current = pokes.current.filter((t) => now - t < 10_000).concat(now);
    if (pokes.current.length >= 4) return say(pick(POKED));
    remark("poke", () => nextShade() || pick(IDLE));
  };

  const dog = crew[0];
  const actorStyle = (a: Actor) => ({ transform: `translateX(${a.x}px)`, transitionDuration: `${a.dur}s` });
  return (
    <div className="crew" aria-live="polite">
      {HENS.map((h, k) => {
        const a = crew[k + 1];
        return (
          <div key={h.name} className={"actor hen" + (a.walking ? " walking" : "") + (a.peck ? " peck" : "")} title={h.name} style={actorStyle(a)}>
            <div className={"face" + (a.left ? "" : " flip")}><ChickenSprite body={h.body} wing={h.wing} scale={SCALE} /></div>
          </div>
        );
      })}
      <div className={"actor dog" + (dog.walking ? " walking" : "") + (speaking ? " speaking" : "")} style={actorStyle(dog)}>
        {bubble && (
          <div className={"hudson-bubble" + (dog.x > innerWidth / 2 ? " to-left" : "")} role="status">
            <button className="hudson-x codicon codicon-close" title="Ignore Hudson (he'll be back)" onClick={() => setBubble(null)} />
            <b>Hudson</b>
            <span>{bubble}</span>
          </div>
        )}
        <button className={"face hudson-dog" + (dog.left ? " flip" : "")} title="Hudson. Click for feedback (not helpful). Right-click to send him outside." onClick={poke}
          onContextMenu={(e) => { e.preventDefault(); onHide(); }}>
          <HudsonSprite eyes={eyes} scale={SCALE} />
        </button>
      </div>
    </div>
  );
}
