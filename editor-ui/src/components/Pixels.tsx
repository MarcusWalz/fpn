// Tiny pixel-art renderer: a grid of characters + a palette → crisp SVG rects.
// "." is transparent. Horizontal runs are merged so each sprite is a few dozen rects.
import type { ReactNode } from "react";

export type Palette = Record<string, string>;

export function pixels(grid: string[], pal: Palette, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== "." && ch !== " " && pal[ch]) out.push(<rect key={`${key}${y}-${x}`} x={x} y={y} width={end - x} height={1} fill={pal[ch]} />);
      x = end;
    }
  });
  return out;
}

// ---------- Hudson: black lab / cane corso mix, side view facing right ----------
// K coat, D shadow side / ear, L rim light (what keeps a black dog from being a blob),
// N nose, C collar, c tag, T tongue. Eyes and legs are drawn separately so they can animate.
const DOG = [
  "..................LKKKL.......",
  ".................LKKKKKL......",
  "................LKKKKKKKL.....",
  "................KDDKKKKKKKKKL.",
  "...............KDDDKKKKKKKKKKN",
  "...............KDDDKKKKKKKKKK.",
  "...............KDDDKKKKKKKKK..",
  "................KDDKKKKKK.....",
  ".................CCcCKK.......",
  ".L.......LLLLLLLLLLKKKK.......",
  "..KKKLLLKKKKKKKKKKKKKKKD......",
  "...KKLKKKKKKKKKKKKKKKKKKD.....",
  ".....KKKKKKKKKKKKKKKKKKKD.....",
  ".....KKKKKKKKKKKKKKKKKKD......",
  "......KKKKDDDDDDDKKKKKD.......",
  "......KKK.........KKKK........",
];
const TAIL_WAG = [".....", "...LK", ".KKKK"]; // wag frame: tip down instead of up (rows 9–11, cols 0–4)
const LEGS: Record<"a" | "b", string[]> = {
  a: [
    "......KKK.KKK.....KKK.KKK.....",
    ".....KKK...KKK...KKK...KKK....",
    ".....KK.....KK...KK.....KK....",
    "....KK......KK..KK......KK....",
    "....KK.......KK.KK.......KK...",
    "...LKK.......LKKLKK......LKK..",
  ],
  b: [
    "......KKK.KKK.....KKK.KKK.....",
    "......KKK.KKK.....KKK.KKK.....",
    "......KK..KK......KK..KK......",
    "......KK..KK......KK..KK......",
    "......KK..KK......KK..KK......",
    ".....LKK.LKK.....LKK.LKK......",
  ],
};
const DOG_PAL: Palette = { K: "#131313", D: "#33353d", L: "#6b707c", N: "#020202", C: "#8a97a6", c: "#e2b84a", T: "#ee7d98" };
const TONGUE = ["........................TT", "........................TT", ".........................T"]; // from row 7

export type Eyes = "side" | "glare" | "closed" | "roll";
// Brow row 2, eye row 3, at x = 22–23.
const EYES: Record<Eyes, [string, string]> = {
  side: ["DD", "PW"], // heavy brow, pupil shoved back at you: the signature look
  glare: ["DD", "WP"],
  roll: ["PP", "WW"],
  closed: ["KK", "DD"],
};
const EYE_PAL: Palette = { W: "#dcd9cc", P: "#4a2f1a", D: "#33353d", K: "#131313" };

export const DOG_W = 30, DOG_H = DOG.length + LEGS.a.length;

/** Both leg frames are always drawn; CSS (.walking) alternates them. Standing shows frame b. */
export function HudsonSprite({ eyes = "side", tongue = true, scale = 3 }: { eyes?: Eyes; tongue?: boolean; scale?: number }) {
  const [brow, eye] = EYES[eyes];
  const eyeGrid = ["", "", " ".repeat(22) + brow, " ".repeat(22) + eye];
  return (
    <svg className="px dog" width={DOG_W * scale} height={DOG_H * scale} viewBox={`0 0 ${DOG_W} ${DOG_H}`} shapeRendering="crispEdges" aria-hidden="true">
      <g className="tail-a">{pixels(DOG.slice(9, 12).map((r) => r.slice(0, 5)), DOG_PAL, "ta")}</g>
      <g className="tail-b" transform="translate(0 9)">{pixels(TAIL_WAG, DOG_PAL, "tb")}</g>
      <g transform="translate(0 0)">{pixels(DOG.map((r, i) => (i >= 9 && i <= 11 ? "     " + r.slice(5) : r)), DOG_PAL, "d")}</g>
      {pixels(eyeGrid, EYE_PAL, "e")}
      {tongue && <g transform="translate(0 7)">{pixels(TONGUE, DOG_PAL, "t")}</g>}
      <g className="frame-a" transform={`translate(0 ${DOG.length})`}>{pixels(LEGS.a, DOG_PAL, "la")}</g>
      <g className="frame-b" transform={`translate(0 ${DOG.length})`}>{pixels(LEGS.b, DOG_PAL, "lb")}</g>
    </svg>
  );
}

// ---------- the chickens (from the yard): two buff, one blue-grey, one red. Facing left. ----------
const CHICKEN = [
  "..RR.......",
  ".RHHH......",
  "BHEHH......",
  ".rHHH......",
  "..HHH....HH",
  "..HHHHHHHH.",
  "..HHWWWHHH.",
  "...HWWWHH..",
  "....HHHH...",
];
const HEN_LEGS = { a: ["....L..L...", "...L....L.."], b: [".....LL....", ".....LL...."] };
export const HENS: { name: string; body: string; wing: string }[] = [
  { name: "Buff", body: "#d89a42", wing: "#b67926" },
  { name: "Blue", body: "#4d535c", wing: "#8d949e" },
  { name: "Ginger", body: "#e3ab55", wing: "#c3883a" },
  { name: "Red", body: "#73341a", wing: "#4f2110" },
];
export const HEN_W = 11, HEN_H = CHICKEN.length + 2;

export function ChickenSprite({ body, wing, scale = 3 }: { body: string; wing: string; scale?: number }) {
  const pal: Palette = { H: body, W: wing, R: "#d63a2e", r: "#d63a2e", B: "#e9b53c", E: "#111", L: "#d9a13a" };
  return (
    <svg className="px" width={HEN_W * scale} height={HEN_H * scale} viewBox={`0 0 ${HEN_W} ${HEN_H}`} shapeRendering="crispEdges" aria-hidden="true">
      <g className="hen-body">{pixels(CHICKEN, pal, "c")}</g>
      <g className="frame-a" transform={`translate(0 ${CHICKEN.length})`}>{pixels(HEN_LEGS.a, pal, "la")}</g>
      <g className="frame-b" transform={`translate(0 ${CHICKEN.length})`}>{pixels(HEN_LEGS.b, pal, "lb")}</g>
    </svg>
  );
}
