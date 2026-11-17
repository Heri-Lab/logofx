import { TEMPLATES } from "../src/lib/templates";
import { parsePath } from "../src/geometry/parse";
import { Arrangement } from "../src/geometry/arrangement";
import { HitIndex } from "../src/geometry/hit";

let failed = 0;
for (const t of TEMPLATES) {
  for (const n of t.usesDensity ? [8, 12, 16, 24] : [16]) {
    const t0 = performance.now();
    try {
      const a = new Arrangement(parsePath(t.path(n)), 240);
      const ms = performance.now() - t0;
      const total = a.faces.reduce((s, f) => s + f.area, 0);
      // Every sample point should land in exactly one face.
      const hit = new HitIndex(a.faces, 240);
      let miss = 0;
      for (let y = 0.37; y < 240; y += 2.3) for (let x = 0.53; x < 240; x += 2.3) if (hit.find(x, y) < 0) miss++;
      const u = a.union([a.faces.map((_, i) => i)]);
      console.log(`${(t.name + (t.usesDensity ? " " + n : "")).padEnd(22)} faces ${String(a.faces.length).padStart(4)}  area ${total.toFixed(3)}  miss ${miss}  union ${u[0].length}b  ${ms.toFixed(0)}ms`);
      if (miss > 0) failed++;
    } catch (e) {
      failed++;
      console.log(`${t.name.padEnd(22)} FAILED: ${(e as Error).message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
