// Exports Hudson and the hens from src/components/Pixels.tsx as standalone,
// self-animating SVGs for the static site's /hudson/ page (web/static/hudson/).
// One source of truth: redraw a sprite in Pixels.tsx, run `npm run build`, and both update.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../src/components/Pixels.tsx"), "utf8");
const out = join(here, "../../web/static/hudson");
mkdirSync(out, { recursive: true });

// The grids are plain array/object literals; evaluate just those.
const lit = (name, open) => {
  const m = src.match(new RegExp(`const ${name}[^=]*= (\\${open}[\\s\\S]*?\\${open === "[" ? "]" : "}"});`));
  if (!m) throw new Error(`export-sprites: can't find ${name} in Pixels.tsx`);
  return Function(`return (${m[1]})`)();
};
const DOG = lit("DOG", "["), LEGS = lit("LEGS", "{"), TAIL_WAG = lit("TAIL_WAG", "["), TONGUE = lit("TONGUE", "[");
const DOG_PAL = lit("DOG_PAL", "{"), EYE_PAL = lit("EYE_PAL", "{"), EYES = lit("EYES", "{");
const CHICKEN = lit("CHICKEN", "["), HEN_LEGS = lit("HEN_LEGS", "{"), HENS = lit("HENS", "[");

const rects = (grid, pal, dx = 0, dy = 0) => grid.map((row, y) => {
  let s = "", x = 0;
  while (x < row.length) {
    const ch = row[x]; let e = x + 1;
    while (e < row.length && row[e] === ch) e++;
    if (pal[ch]) s += `<rect x="${x + dx}" y="${y + dy}" width="${e - x}" height="1" fill="${pal[ch]}"/>`;
    x = e;
  }
  return s;
}).join("");

const svg = (w, h, style, body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 4}" height="${h * 4}" shape-rendering="crispEdges" role="img" aria-label="${label}">` +
  `<style>${style}</style>${body}</svg>\n`;

// Two-frame cycle shared by both sprites: .a shows on even beats, .b on odd.
const beat = (sel, secs) => `${sel} .a{animation:on ${secs}s steps(1) infinite}${sel} .b{animation:off ${secs}s steps(1) infinite}` +
  "@keyframes on{0%{opacity:1}50%{opacity:0}}@keyframes off{0%{opacity:0}50%{opacity:1}}" +
  "@media (prefers-reduced-motion:reduce){*{animation:none!important}.a{opacity:0}}";

function dog({ eyes = "side", walking = true, tongue = true } = {}) {
  const [brow, eye] = EYES[eyes];
  const body = DOG.map((r, i) => (i >= 9 && i <= 11 ? "     " + r.slice(5) : r));
  const tailUp = DOG.slice(9, 12).map((r) => r.slice(0, 5));
  const h = DOG.length + LEGS.a.length;
  return svg(30, h, beat("", walking ? 0.36 : 0.5),
    `<g class="a">${rects(tailUp, DOG_PAL, 0, 9)}${walking ? rects(LEGS.a, DOG_PAL, 0, DOG.length) : rects(LEGS.b, DOG_PAL, 0, DOG.length)}</g>` +
    `<g class="b">${rects(TAIL_WAG, DOG_PAL, 0, 9)}${rects(LEGS.b, DOG_PAL, 0, DOG.length)}</g>` +
    rects(body, DOG_PAL) +
    rects(["", "", " ".repeat(22) + brow, " ".repeat(22) + eye], EYE_PAL) +
    (tongue ? rects(TONGUE, DOG_PAL, 0, 7) : ""),
    "Hudson, a black dog, in pixel art");
}

function hen({ name, body, wing }) {
  const pal = { H: body, W: wing, R: "#d63a2e", r: "#d63a2e", B: "#e9b53c", E: "#111", L: "#d9a13a" };
  return svg(11, CHICKEN.length + 2, beat("", 0.5) + ".peck{transform-origin:3px 9px;animation:peck 2.6s steps(1) infinite}@keyframes peck{0%,70%{transform:none}75%,85%{transform:rotate(-28deg) translateY(1px)}}",
    `<g class="peck">${rects(CHICKEN, pal)}</g><g class="a">${rects(HEN_LEGS.a, pal, 0, CHICKEN.length)}</g><g class="b">${rects(HEN_LEGS.b, pal, 0, CHICKEN.length)}</g>`,
    `${name} the hen, in pixel art`);
}

writeFileSync(join(out, "hudson.svg"), dog());
writeFileSync(join(out, "hudson-wag.svg"), dog({ walking: false, eyes: "glare" }));
for (const h of HENS) writeFileSync(join(out, `hen-${h.name.toLowerCase()}.svg`), hen(h));
console.log(`sprites → web/static/hudson (${HENS.length + 2} files)`);
