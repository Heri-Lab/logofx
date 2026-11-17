import { generatePath, randomLayers, newLayer, LAYER_INFO, type Layer, type LayerKind } from "../src/lib/generator";
import { parsePath } from "../src/geometry/parse";
import { Arrangement } from "../src/geometry/arrangement";
import { HitIndex } from "../src/geometry/hit";
import { segsForPath } from "../src/lib/project";
import { IDENTITY } from "../src/lib/templates";

let fail = 0, worst = 0, n = 0;
const check = (layers: Layer[], label: string, t = IDENTITY) => {
  n++;
  const t0 = performance.now();
  try {
    const path = generatePath(layers, [-120, 360]);
    const a = new Arrangement(segsForPath(path, t), 240);
    const ms = performance.now() - t0;
    worst = Math.max(worst, ms);
    const hit = new HitIndex(a.faces, 240);
    let miss = 0;
    for (let y = 0.41; y < 240; y += 4.1) for (let x = 0.57; x < 240; x += 4.1) if (hit.find(x, y) < 0) miss++;
    if (miss) { fail++; console.log(`MISS ${miss} ${label}`, JSON.stringify(layers)); }
  } catch (e) {
    fail++;
    console.log(`FAIL ${label}: ${(e as Error).message}`, JSON.stringify(layers));
  }
};
// Every layer kind alone, with defaults.
for (const k of Object.keys(LAYER_INFO) as LayerKind[]) check([newLayer(k)], k);
// Random recipes, plain and transformed.
for (let i = 0; i < 300; i++) check(randomLayers(), `random#${i}`, i % 3 === 0 ? { ...IDENTITY, rotate: 17 * i % 180, scale: 0.8 } : i % 3 === 1 ? { ...IDENTITY, tiltX: 25 } : IDENTITY);
// Fuzz: arbitrary slider values for 1–4 random layers.
const R = (a: number, b: number, step = 1) => a + Math.round((Math.random() * (b - a)) / step) * step;
const fuzzLayer = (): Layer => {
  const k = (Object.keys(LAYER_INFO) as LayerKind[])[Math.floor(Math.random() * 6)];
  const l = newLayer(k);
  switch (l.kind) {
    case "lines": return { ...l, angle: R(0, 179), spacing: R(8, 120), offset: R(0, 60) };
    case "lattice": return { ...l, spacing: R(16, 120), radius: R(4, 120), stagger: Math.random() < 0.5 };
    case "rings": return { ...l, count: R(1, 12), inner: R(0, 100), outer: R(20, 170) };
    case "spokes": return { ...l, count: R(2, 48), rotation: R(0, 90) };
    case "polygon": return { ...l, sides: R(3, 12), radius: R(20, 170), rotation: R(0, 120), nested: R(1, 6) };
    case "hexagons": return { ...l, size: R(8, 80) };
  }
};
for (let i = 0; i < 400; i++) check(Array.from({ length: R(1, 4) }, fuzzLayer), `fuzz#${i}`);
console.log(`${n} generated grids, ${fail} failures, worst ${worst.toFixed(0)}ms`);
process.exit(fail ? 1 : 0);
