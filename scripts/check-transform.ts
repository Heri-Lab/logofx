import { TEMPLATES, gridPathOf, type GridTransform, IDENTITY } from "../src/lib/templates";
import { segsForPath } from "../src/lib/project";
import { Arrangement } from "../src/geometry/arrangement";
import { HitIndex } from "../src/geometry/hit";

const cases: Partial<GridTransform>[] = [
  { rotate: 30 }, { rotate: 45, scale: 0.6 }, { rotate: -17, scale: 1.7, x: 23, y: -41 }, { flipX: true, rotate: 90 }, { scale: 0.5, x: 120, y: 120 }, { rotate: 180, flipY: true, scale: 2.4 },
  { tiltX: 35 }, { tiltY: -40, rotate: 15 }, { tiltX: 50, tiltY: 30, scale: 0.6 }, { tiltX: -60, scale: 1.4, x: 30 },
];
let bad = 0, worst = 0;
for (const tpl of TEMPLATES) {
  for (const c of cases) {
    const t = { ...IDENTITY, ...c };
    const t0 = performance.now();
    try {
      const segs = segsForPath(gridPathOf(tpl.id, 16, t), t);
      const a = new Arrangement(segs, 240);
      const ms = performance.now() - t0;
      worst = Math.max(worst, ms);
      const hit = new HitIndex(a.faces, 240);
      let miss = 0;
      for (let y = 0.37; y < 240; y += 3.1) for (let x = 0.53; x < 240; x += 3.1) if (hit.find(x, y) < 0) miss++;
      if (miss) { bad++; console.log(`${tpl.name} ${JSON.stringify(c)}: ${miss} misses`); }
      if (ms > 120) console.log(`${tpl.name} ${JSON.stringify(c)}: slow ${ms.toFixed(0)}ms, ${a.faces.length} faces`);
    } catch (e) {
      bad++;
      console.log(`${tpl.name} ${JSON.stringify(c)}: FAILED ${(e as Error).message}`);
    }
  }
}
console.log(`${TEMPLATES.length * cases.length} transformed grids, ${bad} failures, worst build ${worst.toFixed(0)}ms`);
process.exit(bad ? 1 : 0);
