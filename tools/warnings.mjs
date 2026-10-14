/* Builds Kwick's weather warnings from MeteoAlarm: the official warnings of the national weather services of
   38 European countries (KMI in Belgium, KNMI, DWD, Météo-France...), gathered by EUMETNET.

   MeteoAlarm doesn't let web pages read its feeds directly, and names the warned areas by region code rather than
   by outline. So a scheduled GitHub Action runs this script every half hour: it fetches every country's feed, keeps
   the yellow, orange and red warnings that haven't expired, gives each one the outline of its regions, and writes
   them as small tiles of 5° by 5° (w/<lat>_<lon>.json). The app fetches only the tile it is in and checks whether
   its location falls inside a warning.

   Region outlines: MeteoAlarm EMMA regions (geocodes.json from the MIT-licensed "meteoalarm" package by Niklas
   Jordan) and Eurostat NUTS regions (© EuroGeographics for the administrative boundaries); some services send
   polygons with the warning itself.

   Run: node tools/warnings.mjs <output folder>   (downloads go to .geo/, which the Action caches) */

export const FEEDS = ["austria", "belgium", "bosnia-herzegovina", "bulgaria", "croatia", "cyprus", "czechia", "denmark", "estonia",
  "finland", "france", "germany", "greece", "hungary", "iceland", "ireland", "israel", "italy", "latvia", "lithuania", "luxembourg",
  "malta", "moldova", "montenegro", "netherlands", "republic-of-north-macedonia", "norway", "poland", "portugal", "romania", "serbia",
  "slovakia", "slovenia", "spain", "sweden", "switzerland", "ukraine", "united-kingdom"];
const TYPES = { 1: "Wind", 2: "Snow and ice", 3: "Thunderstorms", 4: "Fog", 5: "Heat", 6: "Cold", 7: "Coastal event", 8: "Forest fire", 9: "Avalanches", 10: "Rain", 12: "Flooding", 13: "Rain and flooding" };
const CELL = 5; // degrees per tile

/* ---------- geometry ---------- */
// GeoJSON Polygon or MultiPolygon → [polygon: [ring: [lon, lat, lon, lat, ...]]], rounded and lightly simplified
function toPolys(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  return polys.map(rings => rings.map(simplify).filter(r => r.length >= 6)).filter(p => p.length);
}
// CAP polygon text "lat,lon lat,lon ..." → one polygon with one ring
function capPolygon(text) {
  const pts = String(text).trim().split(/\s+/).map(s => s.split(",").map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));
  return [simplify(pts.map(([la, lo]) => [lo, la]))];
}
// rounds to ~1 km and drops points that barely change the outline (Douglas-Peucker, ~2 km): plenty for a region
// warning, and it keeps each tile small
function simplify(ring, eps = .02) {
  const pts = ring.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (pts.length < 4) return pts.flat();
  const keep = new Uint8Array(pts.length), last = pts.length - 1; keep[0] = keep[last] = 1;
  // a closed ring starts and ends on the same point, so first split it at the point farthest from the start
  let mid = 1; for (let i = 1; i < last; i++) if (Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) > Math.hypot(pts[mid][0] - pts[0][0], pts[mid][1] - pts[0][1])) mid = i;
  keep[mid] = 1;
  const stack = [[0, mid], [mid, last]];
  while (stack.length) {
    const [a, b] = stack.pop(); let far = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len; if (d > far) { far = d; idx = i; } }
    if (far > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]).flat();
}
function bbox(polys) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const p of polys) for (const r of p) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
  return [x0, y0, x1, y1];
}

/* ---------- warnings ---------- */
/* feeds: { country: feed JSON }, shapes: Map(region code → GeoJSON geometry). Returns the active warnings and how
   many warned areas had no known outline (those are left out). */
export function buildWarnings(feeds, shapes, now = Date.now()) {
  const merged = new Map(); let unplaced = 0;
  for (const [country, data] of Object.entries(feeds)) {
    for (const w of (data && data.warnings) || []) {
      const infos = (w.alert && w.alert.info) || [];
      const info = infos.find(i => /^en/i.test(i.language || "")) || infos[0];
      if (!info) continue;
      const p = Object.fromEntries((info.parameter || []).map(x => [x.valueName, String(x.value)]));
      const level = parseInt(p.awareness_level), type = parseInt(p.awareness_type), expires = Date.parse(info.expires);
      if (!(level >= 2) || !(expires > now)) continue; // green means no warning; skip anything already over
      const onset = Date.parse(info.onset || info.effective) || now;
      const polys = [], names = [];
      for (const a of info.area || []) {
        let got = null;
        for (const g of a.geocode || []) { const s = shapes.get(g.value); if (s) { got = toPolys(s); break; } }
        if (!got && a.polygon) got = [].concat(a.polygon).map(capPolygon);
        if (got && got.length) { polys.push(...got); if (a.areaDesc) names.push(a.areaDesc); } else unplaced++;
      }
      if (!polys.length) continue;
      // services often send one alert per region: merge identical warnings into one with all their regions
      const key = [country, level, type, onset, expires, info.event].join("|");
      const m = merged.get(key);
      if (m) { m.polys.push(...polys); m.areas.push(...names); continue; }
      merged.set(key, {
        country, level, type: TYPES[type] || (p.awareness_type || "").replace(/^\d+;\s*/, "") || "Weather",
        event: info.event || "", headline: info.headline || "", description: (info.description || "").slice(0, 700),
        instruction: (info.instruction || "").slice(0, 400), sender: info.senderName || "", web: info.web || "",
        onset: new Date(onset).toISOString(), expires: new Date(expires).toISOString(), areas: names, polys
      });
    }
  }
  const warnings = [...merged.values()].map(w => ({ ...w, areas: [...new Set(w.areas)].slice(0, 12), bbox: bbox(w.polys) }));
  return { warnings, unplaced };
}
/* Sorts warnings into 5° tiles: { "10_0": [warnings], ... }. Each tile only carries the parts of an outline that
   reach into it, so a warning spread over many regions doesn't weigh down every tile it touches. */
export function tile(warnings) {
  const tiles = {};
  for (const w of warnings) {
    const parts = w.polys.map(p => ({ p, b: bbox([p]) }));
    const [x0, y0, x1, y1] = w.bbox;
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        const cx0 = cx * CELL, cy0 = cy * CELL, polys = parts.filter(({ b }) => b[0] <= cx0 + CELL && b[2] >= cx0 && b[1] <= cy0 + CELL && b[3] >= cy0).map(x => x.p);
        if (polys.length) (tiles[`${cy}_${cx}`] ||= []).push({ ...w, polys, bbox: bbox(polys) });
      }
  }
  return tiles;
}
/* Region code → outline, from the EMMA file and the NUTS files (newest NUTS version wins). */
export function shapeIndex(emma, nutsVersions) {
  const shapes = new Map();
  for (const n of nutsVersions) for (const f of n.features || []) shapes.set(f.properties.NUTS_ID, f.geometry);
  for (const f of emma.features || []) if (f.properties && f.properties.code) shapes.set(f.properties.code, f.geometry);
  return shapes;
}

/* ---------- command line (GitHub Action) ---------- */
async function main(outDir) {
  const fs = await import("node:fs/promises"), path = await import("node:path");
  const cache = ".geo"; await fs.mkdir(cache, { recursive: true });
  const cached = async (name, url) => {
    const file = path.join(cache, name);
    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch {}
    const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const text = await r.text(); await fs.writeFile(file, text); return JSON.parse(text);
  };
  const emma = await cached("emma.json", "https://raw.githubusercontent.com/niklasjordan/meteoalarm/main/src/meteoalarm/assets/geocodes.json");
  const nuts = [];
  for (const v of [2013, 2016, 2021, 2024]) nuts.push(await cached(`nuts${v}.json`, `https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_${v}_4326.geojson`));
  const shapes = shapeIndex(emma, nuts);
  const feeds = {};
  await Promise.all(FEEDS.map(async c => {
    try {
      const r = await fetch(`https://feeds.meteoalarm.org/api/v1/warnings/feeds-${c}`, { signal: AbortSignal.timeout(30000) });
      feeds[c] = r.ok ? await r.json() : null; if (!r.ok) console.warn(`${c}: ${r.status}`);
    } catch (e) { console.warn(`${c}: ${e.message}`); }
  }));
  const { warnings, unplaced } = buildWarnings(feeds, shapes);
  const tiles = tile(warnings), updated = new Date().toISOString();
  await fs.rm(outDir, { recursive: true, force: true }); await fs.mkdir(path.join(outDir, "w"), { recursive: true });
  for (const [k, ws] of Object.entries(tiles)) await fs.writeFile(path.join(outDir, "w", `${k}.json`), JSON.stringify({ updated, warnings: ws }));
  await fs.writeFile(path.join(outDir, "index.json"), JSON.stringify({ updated, warnings: warnings.length, tiles: Object.keys(tiles).length, unplaced, feeds: Object.keys(feeds).length }));
  await fs.writeFile(path.join(outDir, "README.md"), "Generated every half hour by .github/workflows/warnings.yml on main. Source: MeteoAlarm (EUMETNET).\n");
  console.log(`${warnings.length} warnings in ${Object.keys(tiles).length} tiles from ${Object.keys(feeds).length} feeds (${unplaced} areas without an outline)`);
}
if (globalThis.process && process.argv[1] && /warnings\.mjs$/.test(process.argv[1])) main(process.argv[2] || "out").catch(e => { console.error(e); process.exit(1); });
