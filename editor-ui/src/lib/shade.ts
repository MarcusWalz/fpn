// Hudson's feedback engine. He looks at what changed and throws shade.
// House rule: NON-constructive. He notices things; he never says how to fix them.

export interface ShadeCtx {
  text: string; // editor buffer
  base: string; // last commit (or saved file if not committed)
  dirtyMs: number; // how long there have been unsaved changes (0 = saved)
  problemsHere: number;
  now: Date;
}
export interface Quip { key: string; text: string }

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** Lines in `text` that aren't in `base` (multiset), and how many base lines disappeared. */
export function changedLines(base: string, text: string): { added: string[]; removed: number; removedLines: string[] } {
  const count = new Map<string, number>();
  for (const l of base.split("\n")) count.set(l, (count.get(l) || 0) + 1);
  const added: string[] = [];
  for (const l of text.split("\n")) {
    const n = count.get(l) || 0;
    if (n > 0) count.set(l, n - 1);
    else added.push(l);
  }
  const removedLines: string[] = [];
  for (const [l, n] of count) for (let i = 0; i < n; i++) removedLines.push(l);
  return { added, removed: removedLines.length, removedLines };
}

// Misspellings Hudson has opinions about (wrong → he just repeats it back at you).
const TYPOS = /\b(teh|heatlhy|recieve[ds]?|occured|seperate|definately|alot|untill|wich|becuase|thier|pateints?|symtoms?|medicaiton|perscri\w*|hypertention|diabeties|diarrea|diahrrea|reccomend\w*|managment|treatement|diagnosed with with|acheive\w*|begining|enviroment|neccessary|occassion\w*|refered|tommorow|truely|wierd|al my)\b/i;
const HEDGE = /\b(very|really|basically|just|super|kind of|sort of|literally)\b/i;
const SHOUT = /\b[A-Z]{4,}\b(?:\W+\b[A-Z]{4,}\b){2,}/;

export function findShade(c: ShadeCtx): Quip[] {
  const q: Quip[] = [];
  const { added, removed } = changedLines(c.base, c.text);
  const words = added.filter((l) => l.trim() && !/^---|^\s*[a-z_]+:\s/.test(l));
  const joined = words.join("\n");

  const typo = joined.match(TYPOS)?.[0];
  if (typo) q.push({ key: "typo:" + typo.toLowerCase(), text: pick([`"${typo}". Bold spelling choice.`, `"${typo}". The chickens can spell that, and they eat gravel.`, `"${typo}". I'm a dog and even I flinched.`]) });

  if (/\b(TODO|TBD|FIXME)\b|\?\?\?/.test(joined)) q.push({ key: "todo", text: pick(["A TODO. Love that for you. It'll live there forever.", "TODO. The universal sign for \"never\"."]) });

  if (removed >= 10) q.push({ key: "del" + Math.floor(removed / 10), text: pick([`${removed} lines, gone. They had families.`, `Deleted ${removed} lines. Was it something they said?`]) });

  if (SHOUT.test(joined)) q.push({ key: "shout", text: "I don't shout, and I'm a dog." });

  if (/!!/.test(joined)) q.push({ key: "bang", text: "Two exclamation marks. Thrilling. Truly." });

  const empty = [...c.text.matchAll(/^#{2,6} (.+)\n+(?=#{1,6} |\s*(?![\s\S]))/gm)].map((m) => m[1]).find((h) => joined.includes(h));
  if (empty) q.push({ key: "empty:" + empty, text: `"${empty}" is empty. Minimalism, I guess.` });

  const long = words.find((l) => l.length > 450 && !l.trim().startsWith("|"));
  if (long) q.push({ key: "wall" + long.length, text: pick(["That paragraph has the energy of a dog who won't stop barking. I would know.", "That's a lot of words in a row. Brave."]) });

  if (/(^|\s)https?:\/\/\S+/.test(joined.replace(/\]\(https?:[^)]*\)|<https?:[^>]*>/g, ""))) q.push({ key: "url", text: "A naked URL. Scandalous." });

  const hedge = joined.match(HEDGE)?.[0];
  if (hedge) q.push({ key: "hedge:" + hedge.toLowerCase(), text: `"${hedge}". Powerful word. ${hedge[0].toUpperCase() + hedge.slice(1).toLowerCase()} powerful.` });

  if (/(^|[\s(])I('m| am| think| would| want|\s)/.test(joined)) q.push({ key: "diary", text: pick(["Writing a diary? The chickens want royalties.", "\"I\". Very personal. Nobody asked, but very personal."]) });

  if (words.length >= 12 && !/\[@/.test(c.text)) q.push({ key: "cite" + Math.floor(words.length / 12), text: `${words.length} new lines and zero citations. Bold of you to just know things.` });

  if (c.problemsHere > 0) q.push({ key: "probs" + c.problemsHere, text: `${c.problemsHere} problem${c.problemsHere > 1 ? "s" : ""} on this page. I'm not saying anything. (I'm saying something.)` });

  const heading = added.map((l) => l.match(/^#{2,3} (.+)/)?.[1]).find(Boolean);
  if (heading) q.push({ key: "head:" + heading, text: pick([`New section: "${heading}". Ambitious.`, `"${heading}". Sure. Why not.`]) });

  const mins = Math.floor(c.dirtyMs / 60000);
  if (mins >= 5) q.push({ key: "dirty" + Math.floor(mins / 5), text: pick([`Unsaved for ${mins} minutes. Commitment issues?`, `${mins} minutes unsaved. Living on the edge, I see.`]) });

  const h = c.now.getHours(), m = c.now.getMinutes();
  if (h === 22 && m >= 15) q.push({ key: "late" + Math.floor(m / 15), text: `Bedtime in ${60 - m} minutes and this is what you're doing?` });

  if (words.length >= 4 && q.length === 0) q.push({ key: "meh" + Math.floor(words.length / 4), text: pick(["Wow. Words.", "I've read better notes on the side of the chicken coop.", "Huh. Okay.", "Interesting. Not good. Interesting.", "Hm. The chickens are unimpressed. So am I.", "Sure, Jan."]) });

  return q;
}

export const SAVED = ["Saved. Like that helps.", "Saved. Git will remember this. Unfortunately.", "Saved. Took a while.", "Saved. Committing to it, are we?"];
export const IDLE = [
  "Nothing changed. Impressive commitment to nothing.",
  "The chickens laid three eggs today. What have you produced?",
  "I'm not judging. (Side-eye.)",
  "I'd help, but I'm a dog. Also, no.",
  "Bark. That was my feedback.",
  "I've been staring at this page for a while. Mm.",
  "Buff says hi. Buff also has notes.",
];
export const POKED = ["Stop poking me.", "Do you poke your attending like this?", "I'm off the clock.", "Ask the chickens."];
