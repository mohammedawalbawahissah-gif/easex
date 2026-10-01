/**
 * The EaseX app icon, described as plain data so web (react-dom SVG) and mobile (react-native-svg)
 * render the *same* artwork from one source of truth — see web/src/components/AppIcon.tsx and
 * mobile/src/components/AppIcon.tsx, each a thin renderer over {@link brandIconScene}.
 *
 * Design: a black "e" with a gold "x" set as its subscript, on a gift card (gold ribbon + bow) with a crypto coin
 * overlapping its corner, on an indigo tile. Colours are the app's existing palette (ink / gold / gold-deep /
 * indigo / paper). Letterforms are Sora Bold outlines baked in as paths, so the mark never depends on a font
 * being loaded. Coordinates are a 1024 x 1024 canvas.
 *
 * The exported PNG/SVG launcher assets (iOS / Android / favicon) are drawn from the same geometry, plus soft
 * shadows that this UI variant leaves out (SVG filters aren't reliable in react-native-svg).
 */

export const BRAND_ICON_VIEWBOX = 1024;
/** Corner radius of the rounded tile, in viewBox units (~22%). */
export const BRAND_ICON_RADIUS = 224;

export type BrandIconVariant = "full" | "small";

export interface BrandIconNode {
  tag: "g" | "rect" | "path" | "circle" | "clipPath" | "linearGradient" | "stop";
  props: Record<string, string | number>;
  children?: BrandIconNode[];
}

export interface BrandIconScene {
  defs: BrandIconNode[];
  body: BrandIconNode[];
}

const INK = "#15171F";
const GOLD = "#C98A2C";
const GOLD_DEEP = "#9C6A1E";
const INDIGO = "#1F3A5F";
const PAPER = "#FAF7F2";

/** Sora Bold (700) outlines, font units (1000/em, y-up), with their glyph bounds [xMin, yMin, xMax, yMax]. */
const GLYPHS = {
  e: { d: "M324 -19Q254 -19 200.5 5.0Q147 29 111.5 69.5Q76 110 57.5 160.5Q39 211 39 264V284Q39 339 57.5 389.5Q76 440 111.0 480.0Q146 520 198.5 543.5Q251 567 318 567Q406 567 466.5 527.5Q527 488 559.0 424.5Q591 361 591 286V232H191Q194 208 202 188Q216 151 246.0 131.0Q276 111 324 111Q368 111 396.0 128.0Q424 145 434 170H581Q569 115 534.0 72.0Q499 29 446.0 5.0Q393 -19 324 -19ZM192 323H439Q436 346 428 365Q414 400 386.5 418.5Q359 437 318 437Q276 437 247.0 418.0Q218 399 203 363Q196 345 192 323Z", bounds: [39, -19, 591, 567] },
  x: { d: "M12 0 173 278 18 548H191L290 362H306L399 548H562L417 282L593 0H419L301 199H285L174 0Z", bounds: [12, 0, 593, 548] },
  B: { d: "M82 -5V736H356Q482 736 549.5 683.0Q617 630 617 532V517Q617 449 583 408Q567 390 547 376Q587 358 613 327Q647 286 647 216V202Q647 137 617.0 90.5Q587 44 529.0 19.5Q471 -5 385 -5ZM242 306V123H393Q439 123 462.0 147.0Q485 171 485.0 215.0Q485 259 462.0 282.5Q439 306 393 306ZM242 608V430H366Q413 430 434.0 454.0Q455 478 455 518Q455 560 434.0 584.0Q413 608 366 608Z", bounds: [82, -5, 647, 736] },
} as const;

const r = (n: number) => Math.round(n * 100) / 100;

/** A glyph scaled by `s`, its left edge at `left` and its baseline at `baseline` (y-down canvas units). */
function glyph(ch: keyof typeof GLYPHS, left: number, baseline: number, s: number): BrandIconNode {
  const g = GLYPHS[ch];
  const tx = left - g.bounds[0] * s;
  return { tag: "path", props: { d: g.d, transform: `translate(${r(tx)} ${r(baseline)}) scale(${s} ${-s})` } };
}

const withFill = (n: BrandIconNode, fill: string): BrandIconNode => ({ ...n, props: { ...n.props, fill } });

/** The two vertical strokes that turn a B into a crypto "₿", sized to the B drawn at scale `bs` centred at (cx, cy). */
function coinGlyph(cx: number, cy: number, bs: number, barW: number, overhang: number): BrandIconNode[] {
  const [x0, y0, x1, y1] = GLYPHS.B.bounds;
  const bw = (x1 - x0) * bs;
  const bh = (y1 - y0) * bs;
  const left = cx - bw / 2;
  const base = cy + bh / 2;
  const bar = (frac: number): BrandIconNode => ({
    tag: "rect",
    props: {
      x: r(left + bw * frac - barW / 2),
      y: r(cy - bh / 2 - overhang),
      width: barW,
      height: r(bh + overhang * 2),
      rx: 3,
      fill: INK,
    },
  });
  return [withFill(glyph("B", left, base, bs), INK), bar(0.2), bar(0.43)];
}

/** A rounded-rect clip, defined in <defs> (the standard place for it, and the one react-native-svg expects). */
function clipDef(id: string, x: number, y: number, w: number, h: number, rx: number): BrandIconNode {
  return { tag: "clipPath", props: { id }, children: [{ tag: "rect", props: { x, y, width: w, height: h, rx } }] };
}

function stops(...s: [number, string][]): BrandIconNode[] {
  return s.map(([offset, stopColor]) => ({ tag: "stop", props: { offset, stopColor } }));
}

/**
 * Builds the icon. `uid` namespaces gradient/clip ids so several icons can share one page or screen
 * (it is stripped to alphanumerics). `full` is the complete composition for large sizes; `small` is a
 * simplified one (no bow, bigger lettering, bolder coin) that stays legible at ~16-32px.
 */
export function brandIconScene(variant: BrandIconVariant, uid: string): BrandIconScene {
  const id = uid.replace(/[^a-zA-Z0-9]/g, "");
  const ref = (name: string) => `url(#${name}-${id})`;
  const small = variant === "small";

  const defs: BrandIconNode[] = [
    { tag: "linearGradient", props: { id: `bg-${id}`, x1: 0, y1: 0, x2: 1, y2: 1 }, children: stops([0, "#27487A"], [1, "#162B47"]) },
    { tag: "linearGradient", props: { id: `card-${id}`, x1: 0, y1: 0, x2: 0, y2: 1 }, children: stops([0, "#FFFFFF"], [1, PAPER]) },
    { tag: "linearGradient", props: { id: `rib-${id}`, x1: 0, y1: 0, x2: 1, y2: 1 }, children: stops([0, "#E3AE55"], [1, GOLD]) },
    { tag: "linearGradient", props: { id: `coin-${id}`, x1: 0, y1: 0, x2: 1, y2: 1 }, children: stops([0, "#EFC06A"], [0.55, GOLD], [1, GOLD_DEEP]) },
    { tag: "linearGradient", props: { id: `face-${id}`, x1: 0, y1: 0, x2: 1, y2: 1 }, children: stops([0, "#E8B65C"], [1, "#CF9234"]) },
  ];

  const tile: BrandIconNode = {
    tag: "rect",
    props: { x: 0, y: 0, width: BRAND_ICON_VIEWBOX, height: BRAND_ICON_VIEWBOX, rx: BRAND_ICON_RADIUS, fill: ref("bg") },
  };

  if (small) {
    defs.push(clipDef(`clip-${id}`, -380, -250, 760, 500, 64));
    const card: BrandIconNode = {
      tag: "g",
      props: { transform: "translate(470 580) rotate(-8)" },
      children: [
        { tag: "rect", props: { x: -380, y: -250, width: 760, height: 500, rx: 64, fill: ref("card") } },
        { tag: "g", props: { clipPath: ref("clip") }, children: [{ tag: "rect", props: { x: -350, y: -260, width: 62, height: 520, fill: ref("rib") } }] },
        withFill(glyph("e", -270, 150, 0.65), INK),
        withFill(glyph("x", 78, 218, 0.34), GOLD),
      ],
    };
    const coin: BrandIconNode[] = [
      { tag: "circle", props: { cx: 805, cy: 290, r: 164, fill: INDIGO } },
      { tag: "circle", props: { cx: 805, cy: 290, r: 150, fill: ref("coin") } },
      { tag: "circle", props: { cx: 805, cy: 290, r: 130, fill: "none", stroke: GOLD_DEEP, strokeWidth: 9, opacity: 0.85 } },
      ...coinGlyph(805, 290, 0.2, 14, 22),
    ];
    return { defs, body: [tile, card, ...coin] };
  }

  const loopL = "M0 0 C-8 -34 -42 -92 -88 -88 C-126 -84 -118 -30 -84 -16 C-54 -4 -22 -2 0 0Z";
  const loopR = "M0 0 C8 -34 42 -92 88 -88 C126 -84 118 -30 84 -16 C54 -4 22 -2 0 0Z";
  const loop = (d: string): BrandIconNode => ({
    tag: "path",
    props: { d, fill: ref("rib"), stroke: GOLD_DEEP, strokeWidth: 5, strokeLinejoin: "round" },
  });
  const ribbonX = -318;
  defs.push(clipDef(`clip-${id}`, -350, -235, 700, 470, 56));
  const card: BrandIconNode = {
    tag: "g",
    props: { transform: "translate(490 575) rotate(-8)" },
    children: [
      { tag: "rect", props: { x: -350, y: -235, width: 700, height: 470, rx: 56, fill: ref("card") } },
      {
        tag: "g",
        props: { clipPath: ref("clip") },
        children: [
          { tag: "rect", props: { x: ribbonX, y: -240, width: 60, height: 480, fill: ref("rib") } },
          { tag: "rect", props: { x: ribbonX + 56, y: -240, width: 4, height: 480, fill: GOLD_DEEP, opacity: 0.35 } },
        ],
      },
      {
        tag: "g",
        props: { transform: `translate(${ribbonX + 30} -235)` },
        children: [
          loop(loopL),
          loop(loopR),
          { tag: "circle", props: { cx: 0, cy: -4, r: 20, fill: GOLD_DEEP } },
          { tag: "circle", props: { cx: -4, cy: -8, r: 8, fill: "#E3AE55", opacity: 0.75 } },
        ],
      },
      withFill(glyph("e", -215, 124, 0.58), INK),
      withFill(glyph("x", 105, 190, 0.3), GOLD),
    ],
  };
  const coin: BrandIconNode[] = [
    { tag: "circle", props: { cx: 800, cy: 305, r: 140, fill: ref("coin") } },
    { tag: "circle", props: { cx: 800, cy: 305, r: 122, fill: "none", stroke: GOLD_DEEP, strokeWidth: 7, opacity: 0.85 } },
    { tag: "circle", props: { cx: 800, cy: 305, r: 110, fill: ref("face") } },
    ...coinGlyph(800, 305, 0.205, 12, 20),
  ];
  return { defs, body: [tile, card, ...coin] };
}
