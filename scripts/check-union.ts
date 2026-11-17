import { TEMPLATES } from "../src/lib/templates";
import { parsePath } from "../src/geometry/parse";
import { Arrangement } from "../src/geometry/arrangement";
import { segArea } from "../src/geometry/seg";

let bad = 0;
for (const t of TEMPLATES) {
  const a = new Arrangement(parsePath(t.path(16)), 240);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = a.faces.map((_, i) => i).filter(() => rnd() < 0.45);
  const want = pick.reduce((s, i) => s + a.faces[i].area, 0);
  const d = a.union([pick])[0];
  // Area of the traced outline: subpaths are loops; signed areas sum to the union area.
  const got = parsePath(d).reduce((s, seg) => s + segArea(seg), 0);
  const ok = Math.abs(Math.abs(got) - want) < 1e-3 * Math.max(1, want);
  if (!ok) bad++;
  console.log(`${t.name.padEnd(22)} picked ${String(pick.length).padStart(3)}  want ${want.toFixed(3).padStart(10)}  got ${Math.abs(got).toFixed(3).padStart(10)}  ${ok ? "ok" : "MISMATCH"}  ${d.length}b`);
}
process.exit(bad ? 1 : 0);
