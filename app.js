/* Isobar Weather: the app. Loaded after Leaflet, palette.js and the moon map (see index.html). */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const R = v => (v == null || isNaN(v)) ? "–" : Math.round(v);
const nz = v => v == null || isNaN(v) ? null : v;
const { FAM, weatherPal, paint } = window.Palette;

/* The dock's refraction uses an SVG filter inside backdrop-filter, which only Chromium renders. */
if (navigator.userAgentData && navigator.userAgentData.brands.some(b => /Chromium/.test(b.brand))) document.documentElement.classList.add("lq");

/* ---------------- app shell ---------------- */
// Opened from the home screen: switch on the native-app behaviour in CSS (no bounce, no selection, status bar scrim)
if (navigator.standalone || matchMedia("(display-mode: standalone)").matches) document.documentElement.classList.add("standalone");
document.addEventListener("touchstart", () => {}, { passive: true }); // iOS only shows :active press states when the page listens for touches
// Safari ignores user-scalable=no, so block its pinch gestures directly; the radar map handles its own pinch zoom
for (const ev of ["gesturestart", "gesturechange"]) document.addEventListener(ev, e => { if (!e.target.closest || !e.target.closest(".leaflet-container")) e.preventDefault(); }, { passive: false });
// Offline support and instant launch (see sw.js)
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});

/* ---------------- storage ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("isobar:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("isobar:" + k, JSON.stringify(v)); } catch {} }
};
const hour12 = (() => { try { return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12; } catch { return false; } })();
const S = Object.assign({ temp: "c", wind: "kmh", precip: "mm", clock: hour12 ? "12" : "24", mode: "auto", model: "best_match" }, store.get("settings", {}));
let place = store.get("place", null);
let saved = store.get("saved", []);
let D = null, AQ = null, U = null, TZ = "UTC", OFF = 0, fetchedAt = 0; // U: how sure the forecast is, per day

const MODELS = [
  ["best_match", "Best match", "Picks the sharpest local model for your spot (KNMI HARMONIE, DWD ICON-D2, Météo-France AROME, UKMO, HRRR…) and hands over to ECMWF for later days."],
  ["ecmwf_ifs", "ECMWF IFS · 9 km", "The European Centre's flagship global model, consistently ranked the most skilful worldwide."],
  ["ecmwf_aifs025_single", "ECMWF AIFS", "ECMWF's machine-learning global forecast."],
  ["icon_seamless", "DWD ICON", "German Weather Service. 2 km over central Europe."],
  ["knmi_seamless", "KNMI HARMONIE", "Dutch Met Office. 2 km over the Benelux."],
  ["meteofrance_seamless", "Météo-France AROME", "1.3 km over France and its neighbours."],
  ["metno_seamless", "MET Norway", "1 km over the Nordics."],
  ["ukmo_seamless", "UK Met Office", "2 km over the British Isles."],
  ["gfs_seamless", "NOAA GFS + HRRR", "US global model, 3 km HRRR over North America."]
];

/* ---------------- time ---------------- */
function T(str) {
  const [d, t = "00:00"] = str.split("T");
  const [Y, M, Dd] = d.split("-").map(Number);
  const [h, m] = t.split(":").map(Number);
  return new Date(Date.UTC(Y, M - 1, Dd, h, m) - OFF * 1000);
}
const loc = () => S.clock === "12" ? "en-US" : "en-GB";
const fmtT = d => (!d || isNaN(d)) ? "–" : new Intl.DateTimeFormat(loc(), { hour: S.clock === "12" ? "numeric" : "2-digit", minute: "2-digit", hour12: S.clock === "12", timeZone: TZ }).format(d);
const fmtH = d => S.clock === "12"
  ? new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: true, timeZone: TZ }).format(d).replace(" ", "").toLowerCase()
  : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ }).format(d);
const dayOf = key => { const [Y, M, Dd] = key.split("-").map(Number); return new Date(Date.UTC(Y, M - 1, Dd, 12)); };
const wd = key => dayOf(key).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const dm_ = key => dayOf(key).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dur = s => { if (s == null) return "–"; const t = Math.round(s / 60), h = Math.floor(t / 60), m = t % 60; return `${h}h ${String(m).padStart(2, "0")}m`; };
const inMins = m => m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60) ? Math.round(m % 60) + " min" : ""}`.trim();
const localDateLabel = d => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).format(d);

/* ---------------- units ---------------- */
const toC = t => S.temp === "f" ? (t - 32) * 5 / 9 : t;
const WU = { kmh: "km/h", ms: "m/s", mph: "mph", kn: "kn" };
const PU = () => S.precip === "inch" ? "in" : "mm";
const toMs = v => ({ kmh: v / 3.6, ms: v, mph: v * 0.44704, kn: v * 0.514444 })[S.wind];
const toMm = v => S.precip === "inch" ? v * 25.4 : v;
const fmtP = v => v == null ? "–" : (S.precip === "inch" ? v.toFixed(2) : (v < 10 ? v.toFixed(1) : Math.round(v)));
const BFT = [[0.5, "Calm"], [1.6, "Light air"], [3.4, "Light breeze"], [5.5, "Gentle breeze"], [8, "Moderate breeze"], [10.8, "Fresh breeze"], [13.9, "Strong breeze"], [17.2, "Near gale"], [20.8, "Gale"], [24.5, "Strong gale"], [28.5, "Storm"], [32.7, "Violent storm"], [1e9, "Hurricane force"]];
const beaufort = ms => { const i = BFT.findIndex(b => ms < b[0]); return [i, BFT[i][1]]; };
const PTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const PTS8 = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const pt16 = d => PTS[Math.round(d / 22.5) % 16];
const pt8 = d => PTS8[Math.round(d / 45) % 8];

/* ---------------- weather codes ---------------- */
const WMO = {0:["Clear","clear"],1:["Mostly clear","clear"],2:["Partly cloudy","partly"],3:["Overcast","cloudy"],45:["Fog","fog"],48:["Freezing fog","fog"],
  51:["Light drizzle","drizzle"],53:["Drizzle","drizzle"],55:["Heavy drizzle","drizzle"],56:["Freezing drizzle","sleet"],57:["Freezing drizzle","sleet"],
  61:["Light rain","rain"],63:["Rain","rain"],65:["Heavy rain","rain"],66:["Freezing rain","sleet"],67:["Freezing rain","sleet"],
  71:["Light snow","snow"],73:["Snow","snow"],75:["Heavy snow","snow"],77:["Snow grains","snow"],80:["Light showers","rain"],81:["Showers","rain"],82:["Violent showers","rain"],
  85:["Snow showers","snow"],86:["Heavy snow showers","snow"],95:["Thunderstorm","thunder"],96:["Thunder and hail","thunder"],99:["Thunder and hail","thunder"]};
const wmo = c => WMO[c] || ["–", "cloudy"];
function icon(kind, day = true) {
  const id = { clear: day ? "i-sun" : "i-moon", partly: day ? "i-pcd" : "i-pcn", cloudy: "i-cloud", fog: "i-fog", drizzle: "i-drizzle", rain: "i-rain", snow: "i-snow", sleet: "i-sleet", thunder: "i-thunder" }[kind] || "i-cloud";
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
}

/* ---------------- dot-matrix numerals ---------------- */
const GL = {
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  "-": ["...", "...", "...", "###", "...", "...", "..."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  ":": [".", ".", "#", ".", "#", ".", "."],
  "–": ["...", "...", "...", "###", "...", "...", "..."]
};
/* Where the dot-matrix numerals go (the app's number rule): the main temperature, the clock, and numbers that sit
   inside an instrument, such as the wind compass, the UV gauge, the pressure dial and the air-quality scale. Plain
   readings (feels like, humidity, visibility, rain, clouds, the moon, pollen) use the thin numeral font. */
function dm(str, { deg = false, ghost = true } = {}) {
  let x = 0; const on = [], off = [];
  for (const ch of String(str)) {
    const g = GL[ch]; if (!g) continue;
    g.forEach((row, y) => [...row].forEach((v, cx) => (v === "#" ? on : off).push([x + cx, y])));
    x += g[0].length + 1;
  }
  if (deg) { [".#.", "#.#", ".#."].forEach((row, y) => [...row].forEach((v, cx) => { if (v === "#") on.push([x + cx, y, 1]); })); x += 3; }
  else x -= 1;
  let s = `<svg class="dm" viewBox="-0.5 -0.5 ${x} 7" aria-hidden="true">`;
  if (ghost) for (const [a, b] of off) s += `<circle class="g" cx="${a}" cy="${b}" r=".33"/>`;
  for (const [a, b, small] of on) s += `<circle class="o" cx="${a}" cy="${b}" r="${small ? .3 : .4}" style="--d:${(((a * 7 + b * 13) % 17) / 17 * .55).toFixed(2)}s"/>`;
  return s + "</svg>";
}

/* ---------------- astronomy (after V. Agafonkin's SunCalc) ---------------- */
const PI = Math.PI, sin = Math.sin, cos = Math.cos, tan = Math.tan, asin = Math.asin, atan2 = Math.atan2, acos = Math.acos, rad = PI / 180;
const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, OBL = rad * 23.4397;
const toDays = d => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
const fromJ = j => new Date((j + 0.5 - J1970) * dayMs);
const RA = (l, b) => atan2(sin(l) * cos(OBL) - tan(b) * sin(OBL), cos(l));
const DEC = (l, b) => asin(sin(b) * cos(OBL) + cos(b) * sin(OBL) * sin(l));
const ALT = (H, phi, dec) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const refr = h => { if (h < 0) h = 0; return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)); };
const solarM = d => rad * (357.5291 + 0.98560028 * d);
const eclL = M => M + rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)) + rad * 102.9372 + PI;
const sunCoords = d => { const L = eclL(solarM(d)); return { dec: DEC(L, 0), ra: RA(L, 0) }; };
function sunTimes(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date), n = Math.round(d - J0 - lw / (2 * PI));
  const ds = J0 + lw / (2 * PI) + n, M = solarM(ds), L = eclL(M), dec = DEC(L, 0);
  const Jnoon = J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
  const out = { noon: fromJ(Jnoon) };
  for (const [h, a, b] of [[-0.833, "rise", "set"], [-6, "dawn", "dusk"], [6, "goldenEnd", "golden"]]) {
    const w = acos((sin(h * rad) - sin(phi) * sin(dec)) / (cos(phi) * cos(dec)));
    const Jset = J2000 + J0 + (w + lw) / (2 * PI) + n + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
    out[a] = fromJ(Jnoon - (Jset - Jnoon)); out[b] = fromJ(Jset);
  }
  return out;
}
const sunAlt = (date, lat, lng) => { const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = sunCoords(d); return ALT(sidereal(d, lw) - c.ra, phi, c.dec); };
const moonCoords = d => {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * sin(M), b = rad * 5.128 * sin(F);
  return { ra: RA(l, b), dec: DEC(l, b), dist: 385001 - 20905 * cos(M) };
};
const moonAlt = (date, lat, lng) => { const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = moonCoords(d); const h = ALT(sidereal(d, lw) - c.ra, phi, c.dec); return h + refr(h); };
function moonIllum(date) {
  const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sd = 149598000;
  const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
  const inc = atan2(sd * sin(phi), m.dist - sd * cos(phi));
  const ang = atan2(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
  return { fraction: (1 + cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / PI };
}
function moonTimes(t0, lat, lng) {
  const hl = h => new Date(t0.valueOf() + h * 36e5), hc = 0.133 * rad;
  let h0 = moonAlt(t0, lat, lng) - hc, rise, set;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonAlt(hl(i), lat, lng) - hc, h2 = moonAlt(hl(i + 1), lat, lng) - hc;
    const a = (h0 + h2) / 2 - h1, b = (h2 - h0) / 2, xe = -b / (2 * a), ye = (a * xe + b) * xe + h1, dd = b * b - 4 * a * h1;
    let roots = 0, x1 = 0, x2 = 0;
    if (dd >= 0) { const dx = Math.sqrt(dd) / (Math.abs(a) * 2); x1 = xe - dx; x2 = xe + dx; if (Math.abs(x1) <= 1) roots++; if (Math.abs(x2) <= 1) roots++; if (x1 < -1) x1 = x2; }
    if (roots === 1) { if (h0 < 0) rise = i + x1; else set = i + x1; }
    else if (roots === 2) { rise = i + (ye < 0 ? x2 : x1); set = i + (ye < 0 ? x1 : x2); }
    if (rise != null && set != null) break;
    h0 = h2;
  }
  return { rise: rise != null ? hl(rise) : null, set: set != null ? hl(set) : null };
}
const phaseName = p => p < .034 || p > .966 ? "New moon" : p < .216 ? "Waxing crescent" : p < .284 ? "First quarter" : p < .466 ? "Waxing gibbous" : p < .534 ? "Full moon" : p < .716 ? "Waning gibbous" : p < .784 ? "Last quarter" : "Waning crescent";

/* The lit part of the moon as a path: the bright limb plus the terminator ellipse. */
function moonLitPath(ctx, cx, cy, r, phase) {
  const k = cos(2 * PI * phase);
  ctx.beginPath();
  if (phase < .5) { ctx.arc(cx, cy, r, -PI / 2, PI / 2, false); ctx.ellipse(cx, cy, r * Math.abs(k), r, 0, PI / 2, -PI / 2, k > 0); }
  else { ctx.arc(cx, cy, r, PI / 2, 3 * PI / 2, false); ctx.ellipse(cx, cy, r * Math.abs(k), r, 0, -PI / 2, PI / 2, k > 0); }
  ctx.closePath();
}
function moonShape(ctx, cx, cy, r, phase, mirror, lit, dark) {
  ctx.save();
  if (mirror) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI * 2); ctx.fillStyle = dark; ctx.fill();
  moonLitPath(ctx, cx, cy, r, phase); ctx.fillStyle = lit; ctx.fill();
  ctx.restore();
}
function sizeCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
/* The real near side, on a unit disc with north up as seen from the northern hemisphere (Crisium on the right).
   Seas: [x, y, rx, ry, rotation, darkness]; large seas are built from a few overlapping pieces for an irregular outline. */
const MARIA = [
  [-.66, .05, .26, .38, .2, .7], [-.55, -.25, .2, .2, 0, .65], [-.62, .3, .18, .16, 0, .6], // Oceanus Procellarum
  [-.34, -.38, .27, .22, -.3, .95],  // Mare Imbrium
  [.17, -.38, .16, .15, 0, .95],     // Mare Serenitatis
  [.33, -.1, .2, .17, .3, .9], [.42, .02, .1, .1, 0, .8], // Mare Tranquillitatis
  [.68, -.3, .11, .13, 0, 1],        // Mare Crisium
  [.55, .16, .12, .16, .4, .75],     // Mare Fecunditatis
  [.34, .3, .09, .09, 0, .75],       // Mare Nectaris
  [-.17, .38, .17, .13, .2, .75],    // Mare Nubium
  [-.48, .38, .1, .09, 0, .85],      // Mare Humorum
  [.02, -.72, .42, .07, 0, .65],     // Mare Frigoris
  [.04, -.2, .07, .06, 0, .75]       // Mare Vaporum
];
/* Young, bright rayed craters: [x, y, radius, brightness]. Tycho (first) also gets its ray system. */
const BRIGHT = [[-.12, .72, .035, 1], [-.32, -.12, .03, .8], [-.55, -.1, .02, .6], [-.7, -.36, .02, 1]];

/* Smooth value noise (fBm) for irregular sea edges and the grain of the highlands. */
const nhash = (x, y) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = nhash(xi, yi), b = nhash(xi + 1, yi), c = nhash(xi, yi + 1), d = nhash(xi + 1, yi + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
const fbm = (x, y) => { let v = 0, a = .5, f = 1; for (let o = 0; o < 4; o++) { v += a * vnoise(x * f, y * f); f *= 2; a *= .5; } return v; };
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* The full-moon surface, painted once per size and reused for every phase: soft seas with noise-warped edges,
   mottled highlands, ~160 small soft craters (mostly in the southern highlands), the bright rayed craters,
   and a gentle darkening toward the rim. */
let moonTex = null, moonMap = null;
/* NASA's lunar surface map (assets/moon-map.js), read once into pixel data. */
function loadMoonMap() {
  return new Promise(res => {
    if (!window.MOON_MAP) return res(null);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      try { moonMap = { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data }; } catch { moonMap = null; }
      res(moonMap);
    };
    img.onerror = () => res(null);
    img.src = window.MOON_MAP;
  });
}
/* The real near side: the map projected onto the disc as seen from Earth (orthographic, longitude 0 facing us),
   turned to soft grey with a faint cool tint and a touch of darkening toward the rim. */
function moonTextureReal(size) {
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const c = cv.getContext("2d"), img = c.createImageData(size, size), p = img.data, { w, h, d } = moonMap;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + .5) / size * 2 - 1, v = (py + .5) / size * 2 - 1, r2 = u * u + v * v, i = (py * size + px) * 4;
    if (r2 > 1) { p[i + 3] = 0; continue; }
    const lat = Math.asin(-v), cl = Math.cos(lat), lon = cl > 1e-6 ? Math.asin(clamp(u / cl, -1, 1)) : 0;
    const tx = Math.min(w - 1, Math.floor((lon / (2 * PI) + .5) * w)), ty = Math.min(h - 1, Math.floor((.5 - lat / PI) * h)), j = (ty * w + tx) * 4;
    const lum = (d[j] * .3 + d[j + 1] * .59 + d[j + 2] * .11) / 255;
    const shade = clamp(lum * 1.3 + .15, 0, 1) * (.86 + .14 * Math.sqrt(1 - r2)); // slightly softened contrast keeps it calm
    p[i] = 248 * shade; p[i + 1] = 247 * shade; p[i + 2] = Math.min(255, 258 * shade);
    p[i + 3] = 255 * clamp((1 - Math.sqrt(r2)) * size / 2, 0, 1);
  }
  c.putImageData(img, 0, 0);
  return cv;
}
function moonTexture(size) {
  if (moonTex && moonTex.size === size) return moonTex.cv;
  if (moonMap) { moonTex = { size, cv: moonTextureReal(size) }; return moonTex.cv; }
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const c = cv.getContext("2d"), img = c.createImageData(size, size), p = img.data, rnd = fxRand(77), craters = [];
  while (craters.length < 160) {
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1;
    if (x * x + y * y > .92 || (y < .1 && rnd() < .55)) continue; // denser in the southern highlands
    craters.push([x, y, .008 + Math.pow(rnd(), 3) * .04, .03 + rnd() * .06]);
  }
  const rot = MARIA.map(([, , , , r]) => [cos(r), sin(r)]);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + .5) / size * 2 - 1, v = (py + .5) / size * 2 - 1, r2 = u * u + v * v, i = (py * size + px) * 4;
    if (r2 > 1) { p[i + 3] = 0; continue; }
    const warp = (fbm(u * 2.4 + 11, v * 2.4 + 7) - .47) * 1.3 + (fbm(u * 7, v * 7 + 5) - .47) * .35;
    let mare = 0;
    MARIA.forEach(([x, y, rx, ry, , a], k) => {
      const [cs, sn] = rot[k], dx = u - x, dy = v - y, ex = (dx * cs + dy * sn) / rx, ey = (-dx * sn + dy * cs) / ry;
      mare = 1 - (1 - mare) * (1 - a * (1 - smoothstep(.35, 1.4, Math.sqrt(ex * ex + ey * ey) + warp))); // soft union: neighbouring seas flow together
    });
    mare *= .8 + (fbm(u * 5 + 2, v * 5 + 9) - .47) * .6; // patchy darkness within a sea
    let alb = .91 - mare * .27 + (fbm(u * 9, v * 9) - .47) * .07 + (fbm(u * 28 + 3, v * 28) - .47) * .05;
    for (const [x, y, cr, k] of craters) { const d2 = ((u - x) ** 2 + (v - y) ** 2) / (cr * cr); if (d2 < 6) alb -= k * Math.exp(-d2 * 1.4) * (1 - mare * .6); }
    BRIGHT.forEach(([x, y, cr, k], j) => {
      const dx = u - x, dy = v - y, d = Math.sqrt(dx * dx + dy * dy);
      alb += .12 * k * Math.exp(-(d * d) / (cr * cr) * 1.6);
      if (j === 0) alb += Math.pow(Math.abs(cos(Math.atan2(dy, dx) * 4.5 + .4)), 26) * Math.exp(-d * 2.4) * .06 * (d > cr ? 1 : 0);
    });
    const shade = clamp(alb, 0, 1) * (.8 + .2 * Math.sqrt(1 - r2));
    p[i] = 250 * shade; p[i + 1] = 249 * shade; p[i + 2] = Math.min(255, 262 * shade);
    p[i + 3] = 255 * clamp((1 - Math.sqrt(r2)) * size / 2, 0, 1);
  }
  c.putImageData(img, 0, 0);
  moonTex = { size, cv };
  return cv;
}
/* Matte moon: the painted surface shown only where the sun lights it, with a faint trace on the dark side (earthshine).
   South of the equator the moon appears upside down, so the whole face turns 180°. */
function drawBigMoon(cv, phase, south) {
  const s = sizeCanvas(cv); if (!s) return;
  const { ctx, w } = s, cx = w / 2, cy = w / 2, r = w * .4, tex = moonTexture(Math.round(r * 2 * (cv.width / w)));
  ctx.save();
  if (south) { ctx.translate(cx, cy); ctx.rotate(PI); ctx.translate(-cx, -cy); } // the 180° turn also flips the lit side
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI * 2); ctx.fillStyle = "rgba(190,195,255,.08)"; ctx.fill();
  ctx.globalAlpha = .07; ctx.drawImage(tex, cx - r, cy - r, r * 2, r * 2); ctx.globalAlpha = 1;
  ctx.save(); moonLitPath(ctx, cx, cy, r, phase); ctx.clip(); ctx.drawImage(tex, cx - r, cy - r, r * 2, r * 2); ctx.restore();
  ctx.restore();
}
/* A ruler of daily moons that scrolls under a fixed centre marker. `off` is the selected day relative to today (can be fractional). */
const stripStep = w => clamp(w / 23, 16, 26);
function drawStrip(cv, off, base, mirror) {
  const s = sizeCanvas(cv); if (!s) return;
  const { ctx, w, h } = s, step = stripStep(w), r = Math.min(step * .36, 8), mid = w / 2, cy = 16;
  const phaseOn = d => moonIllum(new Date(base.valueOf() + d * dayMs)).phase;
  ctx.font = "500 9px 'Geist Mono', ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const d0 = Math.floor(off - mid / step) - 1, d1 = Math.ceil(off + mid / step) + 1;
  let prev = phaseOn(d0 - 1);
  for (let d = d0; d <= d1; d++) {
    const p = phaseOn(d), x = mid + (d - off) * step, a = clamp(1 - Math.pow(Math.abs(x - mid) / mid, 2) * .85, 0, 1);
    moonShape(ctx, x, cy, r, p, mirror, `rgba(255,255,255,${(.94 * a).toFixed(3)})`, `rgba(255,255,255,${(.14 * a).toFixed(3)})`);
    const tag = d === 0 ? "Today" : prev < .5 && p >= .5 ? "Full" : prev > .8 && p < .2 ? "New" : "";
    if (tag) { ctx.fillStyle = `rgba(255,255,255,${(.75 * a).toFixed(3)})`; ctx.fillText(tag, x, h - 4); }
    prev = p;
  }
  ctx.fillStyle = Palette.SIGNAL; ctx.beginPath(); ctx.moveTo(mid - 5, cy + r + 10); ctx.lineTo(mid + 5, cy + r + 10); ctx.lineTo(mid, cy + r + 4); ctx.fill();
}

/* ---------------- data ---------------- */
async function getJSON(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new Error((j && j.reason) || `Request failed (${r.status})`);
  return j;
}
const qs = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
/* How sure the forecast is, per day: four independent models (European, American, Canadian, German) forecast the same
   days, and the more they disagree, the less certain the day. "high" when their highs lie within 2° and they agree on
   rain, "low" from 5° apart (or when some bring rain and others none), "medium" in between. Distance counts too: the
   further ahead the less anyone can know, even when the models happen to agree, so from 6 days out a day is never
   "high", and its softness (fz) grows with distance. Returns { "2026-10-14": { deg, fz, lead, conf } } with deg the
   models' spread in °C, or null. */
const SPREAD_MODELS = ["ecmwf_ifs025", "gfs_seamless", "gem_seamless", "icon_seamless"];
function confidence(u) {
  if (!u || !u.daily || !u.daily.time) return null;
  const out = {}, d = u.daily;
  d.time.forEach((day, i) => {
    const hi = SPREAD_MODELS.map(m => (d[`temperature_2m_max_${m}`] || [])[i]).filter(v => v != null);
    const mm = SPREAD_MODELS.map(m => (d[`precipitation_sum_${m}`] || [])[i]).filter(v => v != null);
    if (hi.length < 2) return;
    const deg = Math.max(...hi) - Math.min(...hi), split = mm.some(v => v >= 1) && mm.some(v => v < .2);
    let level = deg <= 2 ? 0 : deg <= 4.5 ? 1 : 2;
    if (split) level = Math.min(2, level + 1);
    if (i >= 6) level = Math.max(1, level);
    out[day] = { deg, fz: Math.max(deg, i * .45), lead: i, conf: ["high", "medium", "low"][level] };
  });
  return out;
}
async function fetchAll(p) {
  const w = getJSON("https://api.open-meteo.com/v1/forecast?" + qs({
    latitude: p.lat, longitude: p.lon, timezone: "auto", forecast_days: 14, past_days: 1,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index,dew_point_2m",
    minutely_15: "precipitation", forecast_minutely_15: 24, past_minutely_15: 0,
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day,pressure_msl,visibility,cloud_cover,relative_humidity_2m,dew_point_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,daylight_duration,sunshine_duration,uv_index_max,precipitation_sum,precipitation_probability_max,precipitation_hours,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant",
    temperature_unit: S.temp === "f" ? "fahrenheit" : "celsius", wind_speed_unit: S.wind, precipitation_unit: S.precip, models: S.model
  }));
  const a = getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?" + qs({
    latitude: p.lat, longitude: p.lon, timezone: "auto", forecast_days: 2,
    current: "european_aqi,us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,sulphur_dioxide,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen",
    hourly: "european_aqi"
  })).catch(() => null);
  // the same days from four independent models, to see how much they agree (see confidence())
  const u = getJSON("https://api.open-meteo.com/v1/forecast?" + qs({
    latitude: p.lat, longitude: p.lon, timezone: "auto", forecast_days: 14, daily: "temperature_2m_max,precipitation_sum", models: SPREAD_MODELS.join(",")
  })).catch(() => null);
  return [await w, await a, await u];
}
async function geocode(q) {
  const j = await getJSON("https://geocoding-api.open-meteo.com/v1/search?" + qs({ name: q, count: 8, language: "en", format: "json" }));
  return (j.results || []).map(r => ({ name: r.name, sub: [r.admin1, r.country].filter(Boolean).join(", "), lat: +r.latitude.toFixed(4), lon: +r.longitude.toFixed(4) }));
}
async function reverse(lat, lon) {
  let name = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, sub = "";
  try {
    const r = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    name = r.city || r.locality || name; sub = [r.principalSubdivision, r.countryName].filter(Boolean).join(", ");
  } catch {}
  return { name, sub, lat: +lat.toFixed(4), lon: +lon.toFixed(4), gps: true };
}
function geolocate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("This browser can't share its location. Search for a place instead."));
    navigator.geolocation.getCurrentPosition(p => res(p.coords),
      e => rej(new Error(e.code === 1 ? "Location access is blocked. Allow it in your browser, or search for a place." : "Couldn't get your location. Search for a place instead.")),
      { timeout: 12000, maximumAge: 600000 });
  });
}
async function guessPlace() {
  try { const c = await geolocate(); return await reverse(c.latitude, c.longitude); } catch {}
  try {
    const city = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").split("/").pop().replace(/_/g, " ");
    if (city) { const r = await geocode(city); if (r[0]) return r[0]; }
  } catch {}
  return { name: "Brussels", sub: "Brussels Capital, Belgium", lat: 50.8505, lon: 4.3488 };
}

/* ---------------- render helpers ---------------- */
const head = (t, s) => `<header class="ch"><h3>${esc(t)}</h3><p>${esc(s)}</p></header>`;
const tile = (k, v) => `<div class="tile"><span class="mono">${k}</span><b>${v}</b></div>`;
const card = id => document.getElementById(id);
let X = {};
/* A forecast kept from earlier (offline, or the app reopened later) still describes "now" as it was back then.
   Move "now" up to the present hour, taken from the hourly forecast. */
function rollForward() {
  const c = D.current, H = D.hourly;
  const key = new Date(Date.now() + OFF * 1000).toISOString().slice(0, 13) + ":00";
  if (!c || c.time >= key) return;
  const h = H.time.indexOf(key); if (h < 0) return;
  const next = { ...c, time: key };
  for (const k of ["temperature_2m", "apparent_temperature", "weather_code", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "uv_index", "is_day", "pressure_msl", "visibility", "cloud_cover", "precipitation", "relative_humidity_2m", "dew_point_2m"])
    if (H[k] && H[k][h] != null) next[k] = H[k][h];
  D.current = next;
}
function derive() {
  rollForward();
  const c = D.current, H = D.hourly, Dy = D.daily;
  let hi = H.time.indexOf(c.time.slice(0, 13) + ":00"); if (hi < 0) hi = 0;
  let di = Dy.time.indexOf(c.time.slice(0, 10)); if (di < 0) di = 0;
  X = { c, H, Dy, hi, di, lat: D.latitude, lon: D.longitude, todayKey: Dy.time[di], kind: wmo(c.weather_code)[1], isDay: !!c.is_day };
}

/* ---------------- one-glance summary ---------------- */
/* One or two plain sentences: what the next 12 hours do, then the one thing most worth knowing after that. */
function renderSummary() {
  const { H, hi, Dy, di, c } = X, end = Math.min(H.time.length, hi + 12);
  const kindAt = k => wmo(H.weather_code[k])[1];
  const PRECIP = ["rain", "drizzle", "snow", "sleet", "thunder"];
  const mmh = k => toMm(H.precipitation[k] ?? 0);
  const wet = k => mmh(k) >= .2 || ((H.precipitation_probability[k] ?? 0) >= 60 && PRECIP.includes(kindAt(k)));
  const at = k => fmtT(T(H.time[k]));
  // what falls during a wet spell, named after its wettest hour
  const what = (a, b) => {
    let peak = a; for (let k = a; k < b; k++) if (mmh(k) > mmh(peak)) peak = k;
    const kind = kindAt(peak), r = mmh(peak), any = [];
    for (let k = a; k < b; k++) any.push(kindAt(k));
    if (any.includes("thunder")) return "thunderstorms";
    const base = kind === "snow" || any.includes("snow") ? "snow" : kind === "sleet" ? "sleet" : kind === "drizzle" && r < 1 ? "drizzle" : "rain";
    return base === "drizzle" || base === "sleet" ? base : (r < .6 ? "light " : r >= 4 ? "heavy " : "") + base;
  };
  const cap = s => s[0].toUpperCase() + s.slice(1);
  let first;
  const wetNow = wet(hi) || (c.precipitation ?? 0) > 0;
  if (wetNow) {
    let stop = hi; while (stop < end && wet(stop)) stop++;
    first = stop < end ? `${cap(what(hi, stop))} until ${at(stop)}, then dry.` : `${cap(what(hi, end))} on and off for the next 12 hours.`;
  } else {
    let start = hi; while (start < end && !wet(start)) start++;
    if (start < end) {
      let stop = start; while (stop < end && wet(stop)) stop++;
      first = stop - start <= 2 ? `Dry, with ${what(start, stop).replace(/^(light |heavy )?rain$/, m => m.startsWith("heavy") ? "a heavy shower" : m.startsWith("light") ? "a light shower" : "a shower")} around ${at(start)}.`
        : `Dry until ${at(start)}, then ${what(start, stop)}.`;
    } else {
      // no rain: describe the sky, or the fog if it hangs around
      let fog = 0, cc = 0, day = 0, n = 0;
      for (let k = hi; k < end; k++) { if (kindAt(k) === "fog") fog++; cc += H.cloud_cover[k] ?? 50; day += H.is_day[k] ? 1 : 0; n++; }
      cc /= n || 1;
      if (fog >= 3 && kindAt(hi) === "fog") { let f = hi; while (f < end && kindAt(f) === "fog") f++; first = f < end ? `Foggy until ${at(f)}, then dry.` : "Foggy and dry."; }
      else if (day >= n / 2) first = cc < 30 ? "Dry and sunny." : cc < 70 ? "Dry, with some sun." : "Dry but cloudy.";
      else first = cc < 30 ? "Clear and dry tonight." : "Dry, with a cloudy night.";
    }
  }
  // the second sentence: the most useful thing after that
  const tc = v => toC(v), wu = WU[S.wind];
  let gust = 0, gk = hi; for (let k = hi; k < end; k++) if ((H.wind_gusts_10m[k] ?? 0) > gust) { gust = H.wind_gusts_10m[k]; gk = k; }
  const tonightMin = Dy.temperature_2m_min[di + 1] ?? Dy.temperature_2m_min[di];
  const dTomorrow = Dy.temperature_2m_max[di + 1] != null ? tc(Dy.temperature_2m_max[di + 1]) - tc(Dy.temperature_2m_max[di]) : 0;
  const localHour = +new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date());
  let second = "";
  if (toMs(gust) * 3.6 >= 60) second = `Gusts up to ${R(gust)} ${wu} around ${at(gk)}.`;
  else if (tc(tonightMin) <= 0 && tc(c.temperature_2m) > 0 && localHour >= 12) second = `Frost tonight, down to ${R(tonightMin)}°.`;
  else if (Math.abs(dTomorrow) >= 3) second = `${dTomorrow > 0 ? "Warmer" : "Colder"} tomorrow, up to ${R(Dy.temperature_2m_max[di + 1])}°.`;
  else if (localHour < 14 && tc(Dy.temperature_2m_max[di]) - tc(c.temperature_2m) >= 2) second = `Up to ${R(Dy.temperature_2m_max[di])}° this afternoon.`;
  else if (Dy.temperature_2m_max[di + 1] != null) second = (Dy.precipitation_probability_max[di + 1] ?? 0) >= 60 && !wetNow ? "Rain likely tomorrow." : `Similar tomorrow, around ${R(Dy.temperature_2m_max[di + 1])}°.`;
  $("#summary").textContent = `${first} ${second}`.trim();
}

/* ---------------- weather-reactive effects ---------------- */
const calmMotion = matchMedia("(prefers-reduced-motion: reduce)");
const fxRand = seed => () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

/* Falling rain or snow streaks, shared by the day cards and the main card. */
function fallDrops(seedN, kind, count, strength) {
  const rnd = fxRand(seedN * 7919 + 17);
  const [t0, tv] = { snow: [5, 5], hail: [.5, .25], drizzle: [1.1, .6] }[kind] || [.75, .5]; // seconds to fall: snow drifts, hail drops hard
  let drops = "";
  for (let k = 0; k < count; k++) {
    const t = t0 + rnd() * tv;
    drops += `<i style="--x:${(rnd() * 110).toFixed(1)}%;--y:${Math.round(rnd() * 90)}%;--l:${Math.round(10 + rnd() * 12)}px;--t:${t.toFixed(2)}s;--w:${(-rnd() * t).toFixed(2)}s;--o:${((.3 + rnd() * .5) * strength).toFixed(2)}"></i>`;
  }
  return `<span class="fx${{ snow: " snow", hail: " hail", drizzle: " drizzle", thunder: " storm" }[kind] || ""}" aria-hidden="true">${drops}</span>`;
}

/* Wind lines: a few long, soft lines that ripple across the card and curl at the end, like the classic wind symbol.
   They always travel across the card, never straight down (that reads as rain): left to right or right to left by the
   wind's east-west lean, tilted a little by its north-south part. The compass marker gives the exact direction.
   `n` lines, each crossing in about `dur` seconds at opacity `o`. */
function windLines(dir, n, dur, o, seed) {
  if (n <= 0) return "";
  const rnd = fxRand(seed), toEast = sin(dir * rad) < 0, tilt = clamp(cos(dir * rad) * 9, -9, 9) * (toEast ? 1 : -1);
  let out = "";
  for (let i = 0; i < n; i++) {
    const y = 14 + (i + rnd() * .8) * (172 / n), a = 4 + rnd() * 5, end = 140 + rnd() * 45, t = dur * (.8 + rnd() * .45);
    const curl = rnd() < .5 ? `q12 -1 11 -10 q-1 -7 -9 -5` : `q12 1 11 10 q-1 7 -9 5`;
    out += `<path pathLength="400" d="M-70 ${y.toFixed(1)} C-20 ${(y - a).toFixed(1)} 20 ${(y + a).toFixed(1)} ${(end - 90).toFixed(0)} ${y.toFixed(1)} S${(end - 20).toFixed(0)} ${(y - a * .6).toFixed(1)} ${end.toFixed(0)} ${y.toFixed(1)} ${curl}" style="--t:${t.toFixed(2)}s;--w:${(-rnd() * t).toFixed(2)}s;--o:${(o * (.7 + rnd() * .3)).toFixed(2)}"/>`;
  }
  return `<svg class="wlines" viewBox="0 0 200 200" preserveAspectRatio="none" aria-hidden="true"><g transform="rotate(${tilt.toFixed(1)} 100 100)${toEast ? "" : " translate(200 0) scale(-1 1)"}">${out}</g></svg>`;
}

/* The wind card: calm air stays still; a breeze gets two slow, faint lines; stronger wind brings more, faster and
   brighter ones. When gusts run well above the average wind, two quick extra lines blow through. */
function windFlow(dir, kmh, gustKmh) {
  if (kmh < 2) return "";
  // seconds per crossing: a lazy drift in a light breeze (about 6 s at 5 km/h), brisk in a gale (about 1 s at 60 km/h)
  const n = Math.round(clamp(2 + kmh / 9, 2, 7)), dur = clamp(9 / (1 + kmh / 8), .7, 7), o = clamp(.35 + kmh / 60, .35, .9);
  return windLines(dir, n, dur, o, Math.round(dir) + 7) + (gustKmh - kmh >= 15 ? windLines(dir, 2, dur * .55, .5, Math.round(dir) + 11) : "");
}

/* The main card in a wind storm (gusts from `from` km/h): more and faster lines the stronger the gusts. */
function gustStreaks(dir, gKmh, from) {
  if (gKmh < from) return "";
  return windLines(dir, Math.round(clamp(4 + (gKmh - from) / 8, 4, 9)), clamp(9 / (1 + gKmh / 8), .6, 2), .6, Math.round(dir) + 3);
}

/* Soft fog banks lying low and wide across the main card. */
function mistLayer(seed, type) {
  const rnd = fxRand(seed), P = {
    fog: { n: 5, w: [90, 60], h: [14, 10], y: [28, 66], o: [.32, .16], b: 22, t: [20, 14] }
  }[type];
  let out = "";
  for (let i = 0; i < P.n; i++) {
    const r = k => P[k][0] + rnd() * P[k][1];
    out += `<i style="--x:${(rnd() * 70 - 15).toFixed(0)}%;--y:${r("y").toFixed(0)}%;--w:${r("w").toFixed(0)}%;--h:${r("h").toFixed(0)}%;--o:${r("o").toFixed(2)};--b:${P.b}px;--t:${r("t").toFixed(0)}s;--dl:${(-rnd() * 20).toFixed(0)}s"></i>`;
  }
  return `<span class="mist" aria-hidden="true">${out}</span>`;
}

/* Puffy clouds for the main card. The count follows cloud cover (a mostly clear sky gets one or two), they drift
   faster in stronger wind, sit greyer in rain, dimmer at night, and overcast skies add a dull grey wash on top. */
function cloudLayer(seed, cover, { night = false, wet = false, windKmh = 10 } = {}) {
  if (cover < 12) return "";
  const rnd = fxRand(seed), n = clamp(Math.round(cover / 17), 1, 6);
  const cc = wet ? "#c9cbe2" : night ? "#c7cdf0" : "#ffffff", base = night ? .2 : wet ? .42 : .48;
  const puffs = [[4, 46, 92, 46], [14, 22, 40, 70], [38, 6, 42, 82], [62, 26, 34, 62], [76, 44, 22, 44]];
  let out = cover >= 85 ? `<span class="overcast-sky"></span>` : "";
  for (let i = 0; i < n; i++) {
    const t = (130 - clamp(windKmh, 0, 70)) * (.8 + rnd() * .5);
    const shape = puffs.map(([l, tp, w, h]) => `<i style="left:${l + (rnd() - .5) * 6}%;top:${tp + (rnd() - .5) * 8}%;width:${w * (.85 + rnd() * .3)}%;height:${h}%"></i>`).join("");
    out += `<span class="cloud" style="--w:${(32 + rnd() * 30).toFixed(0)}%;--y:${(-4 + rnd() * 44).toFixed(0)}%;--o:${(base * (.7 + rnd() * .5)).toFixed(2)};--b:${(4 + rnd() * 4).toFixed(1)}px;--t:${t.toFixed(0)}s;--d:${(-rnd() * t).toFixed(0)}s;--cc:${cc}">${shape}</span>`;
  }
  return `<span class="clouds" aria-hidden="true">${out}</span>`;
}

/* Three jagged lightning bolts that take turns lighting up with the storm flash. */
function bolts(seed) {
  const rnd = fxRand(seed); let out = "";
  for (let i = 0; i < 3; i++) {
    let x = 32, y = 0, d = `M${x} 0`, fork = "";
    while (y < 100) {
      y = Math.min(100, y + 7 + rnd() * 9); x = clamp(x + (rnd() - .5) * 20, 6, 58); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      if (!fork && y > 35 && rnd() < .35) fork = `M${x.toFixed(1)} ${y.toFixed(1)} l${((rnd() - .5) * 26).toFixed(1)} ${(10 + rnd() * 14).toFixed(1)} l${((rnd() - .5) * 10).toFixed(1)} ${(6 + rnd() * 8).toFixed(1)}`;
    }
    out += `<svg class="bolt" viewBox="0 0 64 100" preserveAspectRatio="none" aria-hidden="true" style="left:${(8 + rnd() * 70).toFixed(0)}%;--d:${i * 9}s"><path d="${d}" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${fork ? `<path d="${fork}" fill="none" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"/>` : ""}</svg>`;
  }
  return out;
}

/* A sparse, fixed sky of tiny twinkling dots; `avoid(x, y)` keeps them off things like the moon or a big number. */
function starField(seed, count, avoid) {
  const rnd = fxRand(seed); let out = "", n = 0;
  for (let tries = 0; tries < count * 4 && n < count; tries++) {
    const x = rnd() * 100, y = rnd() * 100;
    if (avoid && avoid(x, y)) continue;
    const s = rnd() < .2 ? 2 : rnd() < .6 ? 1.5 : 1; n++;
    out += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--s:${s}px;--o:${(.35 + rnd() * .45).toFixed(2)};--t:${(3 + rnd() * 5).toFixed(1)}s;--w:${(-rnd() * 8).toFixed(1)}s"></i>`;
  }
  return `<span class="stars" aria-hidden="true">${out}</span>`;
}

/* Heat haze. One shimmer per card (UV, main card), sharing a single animation loop. Strength 0 switches a card off. */
const HAZE = { uv: 0, hero: 0 };
let hazeRAF = 0;
function setHaze(which, scale) {
  const el = card(which === "uv" ? "c-uv" : "c-hero"), on = scale > 0 && !calmMotion.matches;
  HAZE[which] = on ? scale : 0;
  el.classList.toggle("hot", on);
  if (on) document.getElementById(`hazeMap-${which}`).setAttribute("scale", scale);
  cancelAnimationFrame(hazeRAF);
  if (!HAZE.uv && !HAZE.hero) return;
  const t0 = performance.now(), noise = { uv: document.getElementById("hazeNoise-uv"), hero: document.getElementById("hazeNoise-hero") };
  const tick = now => {
    const k = (now - t0) / 1000;
    for (const [id, ph] of [["uv", 0], ["hero", 2.1]]) if (HAZE[id] && !offscreen(id === "uv" ? "c-uv" : "c-hero"))
      noise[id].setAttribute("baseFrequency", `${(.006 + .002 * sin(k * .6 + 1 + ph)).toFixed(4)} ${(.05 + .012 * sin(k * .9 + ph)).toFixed(4)}`);
    hazeRAF = requestAnimationFrame(tick);
  };
  hazeRAF = requestAnimationFrame(tick);
}

/* A well-mixed random generator (mulberry32) for the fine-grained textures. The simple one above is fine for placing
   a few dozen things, but its consecutive values are correlated, so thousands of grains line up into a woven lattice. */
const prng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
/* Smooth value noise (0–1) on a `cell`-pixel grid, for uneven, natural-looking patches. */
function patchNoise(rnd, cell) {
  const g = new Map(), v = (i, j) => { const k = i + "," + j; if (!g.has(k)) g.set(k, rnd()); return g.get(k); }, s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = Math.floor(x / cell), j = Math.floor(y / cell), u = s(x / cell - i), q = s(y / cell - j);
    const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * q + (a - b - c + d) * u * q;
  };
}
/* Frosted rim: frost creeping in from the card's edges in uneven patches. A soft matte haze gives the frosted-glass
   look; over it, fine ice needles and grains catch the light, densest at the rim and thinning toward the middle.
   Drawn once; a few glints twinkle on top in CSS. */
let frostRAF = 0;
function frostRim(cv, seed = 17, creep = false) {
  cancelAnimationFrame(frostRAF);
  const s = sizeCanvas(cv); if (!s) return;
  const { ctx, w, h } = s, dpr = cv.width / w, rnd = prng(seed), patch = patchNoise(prng(seed + 7), 54), reach = Math.min(w, h) * .34;
  const edge = (side, u, d) => side === 0 ? [u * w, d] : side === 1 ? [w - d, u * h] : side === 2 ? [u * w, h - d] : [d, u * h];
  // how far the frost creeps in varies along the edge (big, slow swells plus finer wobble), so its inner edge is
  // ragged and uneven rather than a neat shape
  const big = patchNoise(prng(seed + 3), 80), fine = patchNoise(prng(seed + 5), 24);
  const reachAt = (x, y) => reach * (.7 + .95 * big(x, y) + .3 * fine(x, y));
  const frostAt = (x, y) => clamp(1 - Math.min(x, y, w - x, h - y) / reachAt(x, y), 0, 1);
  // matte frost, worked out on a coarse grid and scaled up smoothly (soft and cheap); K holds how deep in the frost each cell is
  const sc = 4, lw = Math.ceil(w / sc) + 1, lh = Math.ceil(h / sc) + 1, low = document.createElement("canvas");
  low.width = lw; low.height = lh;
  const lc = low.getContext("2d"), im = lc.createImageData(lw, lh), K = new Float32Array(lw * lh);
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    const n = j * lw + i; K[n] = frostAt(i * sc, j * sc);
    im.data[n * 4] = 232; im.data[n * 4 + 1] = 243; im.data[n * 4 + 2] = 255;
  }
  // crystals: short needles at random angles and fine grains, densest where the frost is thickest; sorted from the rim
  // inward so they can appear in the order the frost reaches them
  const xs = [];
  for (let i = 0; i < (w + h) * 16; i++) {
    const d = Math.pow(rnd(), 1.5) * reach * 1.9, [x, y] = edge(Math.floor(rnd() * 4), rnd(), d), f = frostAt(x, y);
    const k = f * (.4 + .6 * patch(x, y));
    if (rnd() > k) continue;
    const a = ((.1 + .4 * rnd()) * k).toFixed(3);
    xs.push(rnd() < .6 ? { f, x, y, a, ang: rnd() * PI, len: .7 + rnd() * 2.4, lw: .45 + rnd() * .45 } : { f, x, y, a, r: .3 + rnd() * .5 });
  }
  xs.sort((p, q) => q.f - p.f);
  const cr = document.createElement("canvas"); cr.width = cv.width; cr.height = cv.height;
  const cc = cr.getContext("2d"); cc.setTransform(dpr, 0, 0, dpr, 0, 0); cc.lineCap = "round";
  let drawn = 0;
  // paints the frost at stage p (0 = clear glass, 1 = fully frosted): the frozen front moves in from the rim, following
  // the same ragged contour, with a soft leading edge; crystals appear just behind it
  const paint = p => {
    const front = 1 - p * 1.25;
    for (let n = 0; n < K.length; n++) im.data[n * 4 + 3] = Math.round(Math.pow(K[n], 1.5) * .7 * clamp((K[n] - front) / .2, 0, 1) * 255);
    lc.putImageData(im, 0, 0);
    for (; drawn < xs.length && xs[drawn].f > front + .1; drawn++) {
      const c = xs[drawn];
      if (c.r) { cc.fillStyle = `rgba(238,247,255,${c.a})`; cc.beginPath(); cc.arc(c.x, c.y, c.r, 0, PI * 2); cc.fill(); }
      else { const dx = cos(c.ang) * c.len, dy = sin(c.ang) * c.len; cc.strokeStyle = `rgba(238,247,255,${c.a})`; cc.lineWidth = c.lw; cc.beginPath(); cc.moveTo(c.x - dx, c.y - dy); cc.lineTo(c.x + dx, c.y + dy); cc.stroke(); }
    }
    ctx.clearRect(0, 0, w, h); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(low, 0, 0, lw * sc, lh * sc); ctx.drawImage(cr, 0, 0, w, h);
  };
  if (!creep || calmMotion.matches) { paint(1); return; }
  // the first time the card turns cold, it freezes over before your eyes
  const t0 = performance.now(), dur = 12000; // slow and nearly even, so you watch it creep
  const step = now => { const k = Math.min(1, (now - t0) / dur); paint(1 - Math.pow(1 - k, 1.15)); if (k < 1) frostRAF = requestAnimationFrame(step); };
  paint(0); frostRAF = requestAnimationFrame(step);
}
function frostGlints(seed, n) {
  const rnd = fxRand(seed); let out = "";
  for (let i = 0; i < n; i++) {
    const side = i % 4, u = 6 + rnd() * 88, d = 2 + Math.pow(rnd(), 1.4) * 18, s = Math.round(5 + rnd() * 6);
    const [l, t] = side === 0 ? [u, d] : side === 1 ? [100 - d, u] : side === 2 ? [u, 100 - d] : [d, u];
    out += `<i class="glint" style="left:${l.toFixed(1)}%;top:${t.toFixed(1)}%;--s:${s}px;--t:${(2.6 + rnd() * 3).toFixed(1)}s;--w:${(-rnd() * 6).toFixed(1)}s"></i>`;
  }
  return out;
}


/* Condensation: a fine mist of micro-droplets with larger beads. Each bead works like a tiny lens: darker at the top,
   light gathered at the bottom, a sharp highlight and a soft contact shadow. Now and then a heavy bead runs down,
   swallowing the beads in its way and wiping a clear trail through the mist. */
let condStop = () => {};
function drawBead(c, x, y, r) {
  const ry = r * 1.08;
  c.fillStyle = "rgba(0,22,30,.15)"; c.beginPath(); c.ellipse(x + r * .1, y + ry * .3, r * .9, ry * .85, 0, 0, PI * 2); c.fill();
  const g = c.createLinearGradient(x, y - ry, x, y + ry);
  g.addColorStop(0, "rgba(0,26,32,.24)"); g.addColorStop(.55, "rgba(255,255,255,.05)"); g.addColorStop(1, "rgba(255,255,255,.42)");
  c.fillStyle = g; c.beginPath(); c.ellipse(x, y, r, ry, 0, 0, PI * 2); c.fill();
  c.lineWidth = Math.max(.45, r * .12);
  c.strokeStyle = "rgba(255,255,255,.32)"; c.beginPath(); c.ellipse(x, y, r * .93, ry * .93, 0, PI * .12, PI * .88); c.stroke();
  c.strokeStyle = "rgba(0,30,36,.22)"; c.beginPath(); c.ellipse(x, y, r * .96, ry * .96, 0, PI * 1.1, PI * 1.9); c.stroke();
  c.fillStyle = "rgba(255,255,255,.92)"; c.beginPath(); c.ellipse(x - r * .34, y - ry * .42, r * .2, r * .12, -.5, 0, PI * 2); c.fill();
  if (r > 3) { c.fillStyle = "rgba(255,255,255,.4)"; c.beginPath(); c.arc(x + r * .3, y + ry * .46, r * .08, 0, PI * 2); c.fill(); }
}
function startCondensation(cv) {
  condStop();
  const s = sizeCanvas(cv); if (!s) return;
  const { ctx, w, h } = s, dpr = cv.width / w, rnd = prng(31);
  const layer = () => { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, x]; };
  const [mist, m] = layer(), [beadC, bc] = layer();
  // fogged glass: a faint haze made of dense, barely-visible micro-droplets, each a tiny lens (dark above, light below)
  m.fillStyle = "rgba(225,235,255,.05)"; m.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 10; i++) {
    const x = rnd() * w, y = rnd() * h, r = .3 + rnd() * .5;
    m.fillStyle = `rgba(0,18,40,${(.05 + rnd() * .07).toFixed(3)})`; m.beginPath(); m.arc(x, y - r * .25, r, 0, PI * 2); m.fill();
    m.fillStyle = `rgba(255,255,255,${(.06 + rnd() * .1).toFixed(3)})`; m.beginPath(); m.arc(x + r * .2, y + r * .3, r * .5, 0, PI * 2); m.fill();
  }
  const beads = [];
  for (let tries = 0; tries < 900 && beads.length < w * h / 950; tries++) {
    const r = 1.2 + Math.pow(rnd(), 2.4) * 5.6, x = rnd() * w, y = rnd() * h;
    if (beads.some(b => Math.hypot(b.x - x, b.y - y) < b.r + r + 1.5)) continue;
    beads.push({ x, y, r });
  }
  m.globalCompositeOperation = "destination-out";
  for (const b of beads) { m.beginPath(); m.arc(b.x, b.y, b.r * 1.6, 0, PI * 2); m.fill(); } // beads gather the mist around them
  const paintBeads = () => { bc.clearRect(0, 0, w, h); for (const b of beads) drawBead(bc, b.x, b.y, b.r); };
  paintBeads();
  const frame = run => { ctx.clearRect(0, 0, w, h); ctx.drawImage(mist, 0, 0, w, h); ctx.drawImage(beadC, 0, 0, w, h); if (run) drawBead(ctx, run.x, run.y, run.r); };
  frame();
  if (calmMotion.matches) return;
  let raf = 0, timer = 0, run = null, stopped = false;
  const next = () => { timer = setTimeout(startRun, 3500 + rnd() * 5000); };
  const startRun = () => {
    if (offscreen("c-humid")) return next(); // nobody is looking: try again later
    const big = beads.filter(b => b.r > 3.4 && b.y < h * .6);
    if (!big.length) return;
    const b = big[Math.floor(rnd() * big.length)];
    beads.splice(beads.indexOf(b), 1); paintBeads();
    run = { x: b.x, y: b.y, r: b.r, v: .15, x0: b.x, lastBead: b.y };
    raf = requestAnimationFrame(slide);
  };
  const slide = () => {
    if (stopped) return;
    run.v = Math.min(run.v + .025, 1.9); run.y += run.v; run.x = run.x0 + sin(run.y / 18) * 1.2;
    m.beginPath(); m.ellipse(run.x, run.y - run.r * .4, run.r * .55, run.r * .9, 0, 0, PI * 2); m.fill(); // wipe the trail
    let ate = false;
    for (let i = beads.length - 1; i >= 0; i--) {
      const b = beads[i];
      if (Math.hypot(b.x - run.x, b.y - run.y) < b.r + run.r * .9) { run.r = Math.min(Math.hypot(run.r, b.r), 8); beads.splice(i, 1); ate = true; }
    }
    if (run.y - run.lastBead > 22 + rnd() * 20) { beads.push({ x: run.x + (rnd() - .5) * 2, y: run.y - run.r * 2, r: .9 + rnd() * .6 }); run.lastBead = run.y; ate = true; }
    if (ate) paintBeads();
    if (run.y - run.r > h) { run = null; frame(); next(); return; }
    frame(run); raf = requestAnimationFrame(slide);
  };
  next();
  condStop = () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); };
}

/* ---------------- hero ---------------- */
function renderHero() {
  const { c, Dy, di, kind, isDay } = X, el = card("c-hero");
  const tC = toC(c.temperature_2m), pal = weatherPal(tC, kind, isDay);
  paint(el, pal);
  const au = $("#aurora"); paint(au, pal);
  au.style.setProperty("--x", (tC < 13 ? FAM.coral : FAM.cobalt).mid);
  const rise = Dy.sunrise[di] ? T(Dy.sunrise[di]) : null, set = Dy.sunset[di] ? T(Dy.sunset[di]) : null;
  const st = sunTimes(dayOf(X.todayKey), X.lat, X.lon);
  const now = Date.now();
  let f = 0, mid = "";
  if (rise && set && !isNaN(rise)) {
    f = clamp((now - rise) / (set - rise), 0, 1);
    if (now < rise) mid = `Sunrise in ${inMins((rise - now) / 6e4)}`;
    else if (now > set) { const nr = Dy.sunrise[di + 1] ? T(Dy.sunrise[di + 1]) : null; mid = nr ? `Sunrise in ${inMins((nr - now) / 6e4)}` : "After sunset"; }
    else mid = `Solar noon ${fmtT(st.noon)}`;
  } else mid = sunAlt(new Date(), X.lat, X.lon) > 0 ? "Midnight sun" : "Polar night";
  arcDay = rise && set && !isNaN(rise) ? { rise, set, peak: Math.max(0, sunAlt(st.noon, X.lat, X.lon)) } : null; // peak: the sun's highest point today
  const [px, py] = arcPoint(f).map(v => v.toFixed(1));
  const up = rise && set && now >= rise && now <= set;
  const scrub = !!(rise && set && !isNaN(rise));
  X.sun = scrub ? { rise, set, f, cur: f } : null;
  const arc = `<svg viewBox="0 0 300 108" aria-hidden="true">
    <line x1="0" y1="95" x2="300" y2="95" stroke="rgba(255,255,255,.45)" stroke-width="1.6" stroke-dasharray="0 6" stroke-linecap="round"/>
    <path id="arcDone" d="${arcPath(0, f)}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
    <path id="arcLeft" d="${arcPath(f, 1)}" fill="none" stroke="rgba(255,255,255,.38)" stroke-width="1.2" stroke-dasharray="2 4"/>
    <line id="arcDrop" x1="${px}" y1="${py}" x2="${px}" y2="95" stroke="rgba(255,255,255,.55)" stroke-width="1" stroke-dasharray="1 3"/>
    <circle cx="30" cy="95" r="2.6" fill="#fff"/><circle cx="150" cy="95" r="2.6" fill="#fff"/><circle cx="270" cy="95" r="2.6" fill="#fff"/>
    <g id="sunDot" class="sun-dot" transform="translate(${px} ${py})" opacity="${up ? 1 : .5}"><circle r="9" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1"/><circle r="4" fill="#fff"/></g>
  </svg>`;
  const [label] = wmo(c.weather_code);
  // The sky behind the card, painted back to front so combined weather stacks naturally:
  // sun glow or stars, then clouds and fog, then whatever is falling, then wind on top.
  const code = c.weather_code, mm = toMm(c.precipitation ?? 0), gK = toMs(c.wind_gusts_10m ?? 0) * 3.6, fair = kind === "clear" || kind === "partly";
  const falling = ["snow", "sleet", "thunder", "drizzle", "rain"].includes(kind) || mm > 0;
  const cover = c.cloud_cover ?? (kind === "cloudy" ? 95 : kind === "partly" ? 50 : falling ? 90 : 5);
  const L = [];
  if (fair && isDay) L.push(`<span class="sunglow" aria-hidden="true"><i></i></span>`);
  // stars every night: a full sky when it's clear, a few peeking through cloud or fog, none while rain or snow falls
  if (!isDay && !falling) L.push(starField(907, fair ? 26 : 9, (x, y) => x > 16 && x < 84 && y > 20 && y < 66));
  L.push(cloudLayer(33, kind === "fog" ? Math.min(cover, 40) : cover, { night: !isDay, wet: falling, windKmh: toMs(c.wind_speed_10m ?? 0) * 3.6 }));
  if (kind === "fog") L.push(mistLayer(21, "fog"));
  if (kind === "snow") L.push(fallDrops(99, "snow", code === 75 || code === 86 ? 62 : code === 71 ? 26 : 40, .9));                // snow, heavier codes more flakes
  else if (kind === "sleet") L.push(fallDrops(99, "rain", 22, .8), fallDrops(98, "snow", 20, .9));                                   // freezing rain and drizzle
  else if (code === 96 || code === 99) L.push(fallDrops(99, "thunder", 34, .85), fallDrops(97, "hail", code === 99 ? 34 : 22, 1), bolts(5)); // thunder with hail
  else if (kind === "thunder") L.push(fallDrops(99, "thunder", mm < 2 ? 34 : 48, .85), bolts(5));
  else if (kind === "drizzle") L.push(fallDrops(99, "drizzle", code === 55 ? 40 : 28, .7));
  else if (kind === "rain" || mm > 0) L.push(fallDrops(99, "rain", code === 65 || code === 82 || mm >= 4 ? 52 : code === 61 || code === 80 ? 26 : 38, .85));
  L.push(gustStreaks(c.wind_direction_10m ?? 0, gK, 50));                                                                            // wind storm from 50 km/h gusts
  const sky = L.join("");
  const cold = tC < 0;
  el.innerHTML = `${sky}${cold ? `<canvas class="frost" id="heroFrost"></canvas>${frostGlints(41, 14)}` : ""}
    <header class="ch"><h3 id="heroWhen">Now</h3><p id="heroSub">${esc(label)}</p></header>
    <span class="hero-upd mono" id="heroUpd"${Date.now() - fetchedAt < 30 * 6e4 ? " hidden" : ""}>Updated ${updLabel(fetchedAt)}</span>
    <button class="hero-now" id="heroNow" hidden>Back to now</button>
    <div class="hero-temp" id="heroTemp" data-v="${R(c.temperature_2m)}" role="img" aria-label="${R(c.temperature_2m)} degrees">${dm(String(R(c.temperature_2m)), { deg: true })}</div>
    <div class="hero-meta"><span id="heroFeels">Feels like ${R(c.apparent_temperature)}°</span><span>High ${R(Dy.temperature_2m_max[di])}° · Low ${R(Dy.temperature_2m_min[di])}°</span></div>
    <div class="arc"><div class="arc-in" id="arcIn"${scrub ? ` role="slider" tabindex="0" aria-label="Time of day. Drag the sun or use the arrow keys to see the temperature at that hour." aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}" aria-valuetext="Now"` : ""}>${arc}</div></div>
    <div class="hero-foot">
      <div><b>${fmtT(rise)}</b><span>Sunrise</span></div>
      <div class="mid"><span id="heroMid">${esc(mid)}</span></div>
      <div class="r"><b>${fmtT(set)}</b><span>Sunset</span></div>
    </div>`;
  $("#tbIc").innerHTML = icon(kind, isDay);
  $("#tbTemp").textContent = `${R(c.temperature_2m)}°`;
  if (scrub) bindSunScrub();
  // below 0° the card frosts over at the rim (fades in the first time only); from 28° it shimmers
  if (cold) frostRim($("#heroFrost"), 17, !heroFrostGrown);
  heroFrostGrown = cold;
  setHaze("hero", tC >= 28 ? clamp(4 + (tC - 28) * 1.5, 4, 14) : 0);
}
let heroFrostGrown = false;

/* ---------------- dragging the sun: scrub through today's daylight ---------------- */
/* Runs `fn` with the latest event at most once per screen refresh. Touch screens report moves faster than the screen
   redraws, so updating on every event queues work up and the indicator trails the finger. */
function perFrame(fn) { let last = null, id = 0; return e => { last = e; if (!id) id = requestAnimationFrame(() => { id = 0; fn(last); }); }; }
/* Where the sun sits on the main card's arc: a smooth half-ellipse from sunrise to sunset, as tall as the sun really
   climbs that day (90° would reach the top). So the arc is low and flat in a northern winter, tall in summer, and
   almost a full half-circle near the equator; the dot moves along it with the time of day. */
let arcDay = null;
const arcPoint = f => {
  const h = arcDay ? clamp(arcDay.peak / (PI / 2), .12, 1) * 82 : 78; // midnight sun or polar night: a plain arc
  const th = PI * (1 - f);
  return [150 + 120 * cos(th), 95 - h * sin(th)];
};
const arcPath = (f0, f1) => {
  const n = Math.max(2, Math.ceil(Math.abs(f1 - f0) * 48)); let d = "";
  for (let i = 0; i <= n; i++) { const [x, y] = arcPoint(f0 + (f1 - f0) * i / n); d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }
  return d;
};
/* Hourly values at any instant, interpolated between the two nearest hours. */
function hourAt(t) {
  const H = X.H; let k = H.time.findIndex(s => T(s) > t) - 1;
  if (k < 0) k = H.time.length - 1;
  const k2 = Math.min(k + 1, H.time.length - 1), u = clamp((t - T(H.time[k])) / 36e5, 0, 1), near = u < .5 ? k : k2;
  const L = a => a[k] == null ? a[k2] : a[k2] == null ? a[k] : a[k] + (a[k2] - a[k]) * u;
  return { temp: L(H.temperature_2m), feels: L(H.apparent_temperature), code: H.weather_code[near] };
}
/* Redraws only what changed; the dot-matrix number is rebuilt when the whole degree changes, which replays its dot animation. */
function scrubSun(f) {
  const s = X.sun; if (!s) return;
  f = clamp(f, 0, 1); s.cur = f;
  const t = new Date(s.rise.valueOf() + f * (s.set - s.rise));
  const [px, py] = arcPoint(f).map(v => v.toFixed(1));
  $("#arcDone").setAttribute("d", arcPath(0, f));
  $("#arcLeft").setAttribute("d", arcPath(f, 1));
  const drop = $("#arcDrop"); drop.setAttribute("x1", px); drop.setAttribute("x2", px); drop.setAttribute("y1", py);
  const dot = $("#sunDot"); dot.setAttribute("transform", `translate(${px} ${py})`); dot.setAttribute("opacity", "1");
  const h = hourAt(t), [label, kind] = wmo(h.code), v = R(h.temp), box = $("#heroTemp");
  if (box.dataset.v !== String(v)) { box.dataset.v = v; box.innerHTML = dm(String(v), { deg: true }); box.setAttribute("aria-label", `${v} degrees`); }
  $("#heroWhen").textContent = fmtT(t);
  $("#heroSub").textContent = label;
  $("#heroFeels").textContent = `Feels like ${R(h.feels)}°`;
  $("#heroMid").textContent = `Sun ${Math.max(0, Math.round(sunAlt(t, X.lat, X.lon) / rad))}° above the horizon`;
  paint(card("c-hero"), weatherPal(Math.round(toC(h.temp) * 2) / 2, kind, true));
  $("#heroUpd").hidden = true; $("#heroNow").hidden = false;
  const box2 = $("#arcIn"); box2.setAttribute("aria-valuenow", Math.round(f * 100)); box2.setAttribute("aria-valuetext", `${fmtT(t)}, ${v} degrees, ${label}`);
}
function bindSunScrub() {
  const box = $("#arcIn");
  const fAt = e => { const r = box.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 300; return 1 - acos(clamp((x - 150) / 120, -1, 1)) / PI; };
  // track the drag on the window so it keeps working when the pointer leaves the arc
  const move = perFrame(e => scrubSun(fAt(e)));
  const end = e => { if (e.type === "pointerup") scrubSun(fAt(e)); box.classList.remove("grab"); removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
  box.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    box.classList.add("grab"); scrubSun(fAt(e));
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  });
  box.addEventListener("keydown", e => {
    const s = X.sun, hour = 36e5 / (s.set - s.rise);
    const f = { ArrowRight: s.cur + hour, ArrowUp: s.cur + hour, ArrowLeft: s.cur - hour, ArrowDown: s.cur - hour, Home: 0, End: 1 }[e.key];
    if (f == null) return; e.preventDefault(); scrubSun(f);
  });
  $("#heroNow").onclick = () => { renderHero(); $("#arcIn").focus({ preventScroll: true }); };
}

/* ---------------- rain in the next hours (glass) ---------------- */
function renderNow() {
  const el = card("c-now"), M = D.minutely_15;
  let times = [], vals = [];
  // skip quarter-hours that already passed (a kept forecast can be hours old); with too few left the hourly takes over
  if (M && M.precipitation && M.precipitation.some(v => v != null)) M.time.forEach((s, i) => { const t = T(s); if (t >= Date.now() - 9e5) { times.push(t); vals.push(M.precipitation[i] ?? 0); } });
  if (times.length < 8) { times = []; vals = []; for (let i = 0; i < 6; i++) { const t = X.H.time[X.hi + i]; if (!t) break; for (let q = 0; q < 4; q++) { times.push(new Date(T(t).valueOf() + q * 9e5)); vals.push((X.H.precipitation[X.hi + i] ?? 0) / 4); } } }
  const rate = vals.map(v => toMm(v) * 4);
  const thr = 0.1, first = rate.findIndex(v => v >= thr), peak = Math.max(0, ...rate);
  const inten = r => r < 2.5 ? "Light" : r < 7.6 ? "Moderate" : r < 50 ? "Heavy" : "Violent";
  let say, sub;
  if (first < 0) { say = `No rain expected in the next ${Math.round(rate.length / 4)} hours`; sub = "Dry"; }
  else if (first === 0) {
    const stop = rate.findIndex(v => v < thr);
    say = stop < 0 ? `Rain continues for the next ${Math.round(rate.length / 4)} hours` : `Rain easing off around ${fmtT(times[stop])}`;
    sub = `${inten(peak)} now`;
  } else { say = `Rain likely from about ${fmtT(times[first])}`; sub = `${inten(peak)} · in ${inMins((times[first] - Date.now()) / 6e4)}`; }
  const total = vals.reduce((a, b) => a + b, 0);
  const n = rate.length, rows = 8, sp = 10;
  // LED rain gauge. Wet columns fill cell by cell from the bottom; afterwards a drip steps down the empty
  // cells of the grid one at a time with a fading trail, and the top of the stack pulses as it lands.
  // Heavier rain drips more often; every column keeps its own rhythm.
  let grid = "", wet = "";
  rate.forEach((r, i) => {
    const lit = r <= 0 ? 0 : Math.min(rows, Math.max(1, Math.ceil(Math.log2(1 + r * 4) * 1.6)));
    const cx = i * sp + 5, cyOf = k => (rows - 1 - k) * sp + 5;
    const period = (5.6 - Math.min(lit, 8) * .3).toFixed(2), stepT = period * .024;
    const start = 2.4 + ((i * 7919) % 97) / 97 * period;
    for (let k = 0; k < rows; k++) {
      if (k >= lit) { grid += `<circle cx="${cx}" cy="${cyOf(k)}" r="2.1" fill="currentColor" opacity=".13"/>`; continue; }
      const tone = (.95 - (k / Math.max(lit - 1, 1)) * .4 * (lit / rows)).toFixed(2);
      const fill = `--d:${(.25 + i * .035 + k * .09).toFixed(2)}s`;
      const top = k === lit - 1 && lit < rows;
      wet += `<circle class="wet${top ? " top" : ""}" cx="${cx}" cy="${cyOf(k)}" r="2.5" fill="var(--rain)" fill-opacity="${tone}" style="${fill}${top ? `;--p:${period}s;--w2:${(start + (rows - lit) * stepT).toFixed(2)}s` : ""}"/>`;
    }
    for (let j = 0, n = rows - lit; lit && j < n; j++)
      wet += `<circle class="drip" cx="${cx}" cy="${cyOf(rows - 1 - j)}" r="2.5" fill="var(--rain)" style="--p:${period}s;--w:${(start + j * stepT).toFixed(2)}s"/>`;
  });
  const dots = `${grid}<g filter="url(#bloom)">${wet}</g>`;
  const axis = Array.from({ length: 6 }, (_, k) => times[k * 4] ? `<span class="mono">${k ? fmtT(times[k * 4]) : "Now"}</span>` : "<span></span>").join("");
  el.innerHTML = `<div class="ch-row">${head("Precipitation", sub)}${total > 0 ? `<span class="mono">${fmtP(total)} ${PU()} total</span>` : ""}</div>
    <div class="now-say">${esc(say)}</div>
    <div class="now-chart"><svg viewBox="0 0 ${n * sp} ${rows * sp}" role="img" aria-label="Precipitation per 15 minutes"><defs><filter id="bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.3" result="b"/><feComponentTransfer in="b" result="s"><feFuncA type="linear" slope=".55"/></feComponentTransfer><feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${dots}</svg></div>
    <div class="now-axis">${axis}</div>`;
}

/* ---------------- wind ---------------- */
function renderWind() {
  const { c } = X, el = card("c-wind");
  const sp = c.wind_speed_10m, dir = c.wind_direction_10m ?? 0, gust = c.wind_gusts_10m;
  const [b, bname] = beaufort(toMs(sp ?? 0));
  let ticks = "";
  for (let i = 0; i < 72; i++) {
    const a = i * 5 * rad, major = i % 18 === 0, mid = i % 9 === 0;
    const r1 = 92, r2 = major ? 80 : mid ? 84 : 87;
    ticks += `<line x1="${100 + r1 * sin(a)}" y1="${100 - r1 * cos(a)}" x2="${100 + r2 * sin(a)}" y2="${100 - r2 * cos(a)}" stroke="currentColor" stroke-opacity="${major ? .95 : mid ? .6 : .32}" stroke-width="${major ? 1.8 : 1}" stroke-linecap="round"/>`;
  }
  const lab = ["N", "E", "S", "W"].map((t, i) => { const a = i * 90 * rad; return `<text x="${100 + 68 * sin(a)}" y="${100 - 68 * cos(a) + 3.5}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="14" fill="currentColor" fill-opacity=".75">${t}</text>`; }).join("");
  const a = dir * rad, tip = 78, base = 97, w = 6 * rad;
  const tri = `<path d="M${100 + tip * sin(a)} ${100 - tip * cos(a)} L${100 + base * sin(a - w)} ${100 - base * cos(a - w)} L${100 + base * sin(a + w)} ${100 - base * cos(a + w)}Z" fill="var(--signal)"/>`;

  const spTxt = sp == null ? "–" : String(Math.round(sp)).padStart(2, "0");
  // streaks flow across the card from the side the wind comes from, scaled to its strength
  const kmh = toMs(sp ?? 0) * 3.6, gusts = windFlow(dir, kmh, toMs(gust ?? 0) * 3.6);
  el.innerHTML = `${gusts}${head("Wind", sp == null ? "–" : `From the ${pt8(dir)}`)}
    <div class="compass"><svg viewBox="0 0 200 200" role="img" aria-label="Wind from ${pt16(dir)}">${ticks}${lab}${tri}</svg>
      <div class="compass-c">${dm(spTxt)}<span class="mono">${WU[S.wind]}</span></div></div>
    <div class="foot"><span>Gusts <b>${R(gust)}</b></span><span>Bft <b>${b}</b> · ${esc(bname)}</span></div>`;
}

/* ---------------- feels like ---------------- */
function renderFeels() {
  const { c } = X, el = card("c-feels");
  const t = c.temperature_2m, f = c.apparent_temperature;
  const diff = f - t, dC = toC(f) - toC(t), ms = toMs(c.wind_speed_10m ?? 0);
  let why, sub;
  if (Math.abs(dC) < 1.5) { sub = "Close to the air"; why = "It feels about as warm as the thermometer says."; }
  else if (dC < 0) { sub = "Colder"; why = ms > 3 ? `Wind makes it feel ${Math.abs(Math.round(diff))}° colder than the air.` : `Damp air makes it feel ${Math.abs(Math.round(diff))}° colder.`; }
  else { sub = "Warmer"; why = (c.relative_humidity_2m ?? 0) > 55 ? `Humidity makes it feel ${Math.round(diff)}° warmer.` : `Sunshine and still air make it feel ${Math.round(diff)}° warmer.`; }
  const lo = Math.min(t, f) - 6, hi = Math.max(t, f) + 6, P = v => ((v - lo) / (hi - lo) * 100).toFixed(1);
  // when it feels the same as the thermometer (to the degree), the marker sits right on it with no gap to fill
  const same = R(f) === R(t), fp = same ? t : f;
  el.innerHTML = `${head("Feels like", sub)}
    <div class="num big">${R(f)}°</div>
    <div class="ftrack" aria-hidden="true"><div class="line"></div>
      ${same ? "" : `<div class="seg" style="left:${P(Math.min(t, f))}%;width:${(Math.abs(t - f) / (hi - lo) * 100).toFixed(1)}%"></div>`}
      <div class="tick" style="left:${P(t)}%"></div><div class="tri" style="left:${P(fp)}%"></div>
      <span class="lab" style="left:${P(t)}%">Measured: ${R(t)}°</span></div>
    <p class="feels-why">${esc(why)}</p>`;
}

/* ---------------- hourly (glass) ---------------- */
function renderHourly() {
  const { H, hi } = X, el = card("c-hourly");
  const n = Math.min(48, H.time.length - hi), colW = 58, temps = [], cols = [];
  for (let i = 0; i < n; i++) {
    const k = hi + i, t = T(H.time[k]), day = !!H.is_day[k], pop = nz(H.precipitation_probability[k]);
    const [, kind] = wmo(H.weather_code[k]);
    temps.push(H.temperature_2m[k]);
    const isMid = H.time[k].endsWith("T00:00");
    const tl = i === 0 ? `<span class="htime now">Now</span>` : isMid ? `<span class="htime mid">${wd(H.time[k].slice(0, 10))}</span>` : `<span class="htime">${fmtH(t)}</span>`;
    const lit = pop == null ? 0 : Math.round(pop / 20);
    let pd = ""; for (let q = 0; q < 5; q++) pd += `<circle cx="4" cy="${26 - q * 5.5}" r="${q < lit ? 2.2 : 1.5}" fill="${q < lit ? "var(--rain)" : "currentColor"}" opacity="${q < lit ? 1 : .18}"/>`;
    cols.push(`<div class="hcol">${tl}${icon(kind, day)}<span></span>
      <div class="hpop"><svg viewBox="0 0 8 30" aria-hidden="true">${pd}</svg><span>${pop != null && pop >= 10 ? pop + "%" : "&nbsp;"}</span></div><div class="hruler"></div></div>`);
  }
  const valid = temps.filter(v => v != null), mn = Math.min(...valid), mx = Math.max(...valid), span = (mx - mn) || 1;
  const pts = temps.map((v, i) => [i * colW + colW / 2, 24 + (1 - ((v ?? mn) - mn) / span) * 44]);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
  }
  const W = n * colW;
  const svg = `<svg class="hcurve" width="${W}" height="78" viewBox="0 0 ${W} 78" aria-hidden="true">
    <path d="${d}" fill="none" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1.4"/>
    ${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 0 ? 4.5 : 2.6}" fill="${i === 0 ? "var(--signal)" : "var(--ink)"}"/><text x="${x}" y="${y - 10}">${R(temps[i])}°</text>`).join("")}
  </svg>`;
  // Sun and moon track above the hours: sunlight, a violet twilight around each sunset and sunrise, then night.
  // Each turn is marked with a small horizon glyph (arrow down for sunset, up for sunrise) and the time.
  const t0 = T(H.time[hi]).valueOf(), xAt = t => (t - t0) / 36e5 * colW + colW / 2;
  const evs = [];
  X.Dy.time.forEach((_, j) => {
    for (const [key, up] of [["sunrise", true], ["sunset", false]]) {
      const s = X.Dy[key][j]; if (!s) continue;
      const t = T(s).valueOf(), x = xAt(t);
      if (x > 0 && x < W) evs.push({ x, t, up });
    }
  });
  evs.sort((a, b) => a.x - b.x);
  const SUN = "var(--day-track)", TWI = "var(--twilight-track)", MOON = "var(--night-track)";
  const stops = [`${H.is_day[hi] ? SUN : MOON} 0px`];
  for (const e of evs) stops.push(...(e.up
    ? [`${MOON} ${e.x - colW}px`, `${TWI} ${e.x - colW * .3}px`, `${SUN} ${e.x + colW * .4}px`]
    : [`${SUN} ${e.x - colW * .4}px`, `${TWI} ${e.x + colW * .3}px`, `${MOON} ${e.x + colW}px`]));
  stops.push(`${evs.length ? (evs.at(-1).up ? SUN : MOON) : H.is_day[hi] ? SUN : MOON} ${W}px`);
  const glyph = up => `<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M1.5 11h13M4.5 11a3.5 3.5 0 0 1 7 0"/><path d="${up ? "M8 5.4V1M6.4 2.6L8 1l1.6 1.6" : "M8 1v4.4M6.4 3.8L8 5.4l1.6-1.6"}"/></svg>`;
  const track = `<span class="htrack" aria-hidden="true" style="width:${W}px;background:linear-gradient(90deg,${stops.join(",")})"></span>`
    + evs.map(e => `<span class="hev" style="left:${e.x.toFixed(1)}px" aria-label="${e.up ? "Sunrise" : "Sunset"} ${fmtT(new Date(e.t))}">${glyph(e.up)}${fmtT(new Date(e.t))}</span>`).join("");
  const view = store.get("hview", "h");
  el.dataset.view = view;
  el.innerHTML = `<div class="ch-row"><header class="ch"><h3 id="hTitle">${view === "d" ? "Next 14 days" : "Next 48 hours"}</h3>
      <p class="hv-h">${R(mn)}° to ${R(mx)}°</p>
      <button class="hall hv-d" id="hAll">Full forecast<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg></button></header>
      <div class="hseg" role="tablist" aria-label="Forecast range"><button role="tab" data-v="h" aria-selected="${view === "h"}">48 h</button><button role="tab" data-v="d" aria-selected="${view === "d"}">14 days</button></div></div>
    <div class="hscroll hv-h" tabindex="0" aria-label="Hourly forecast, scroll sideways"><div class="hin" style="grid-template-columns:repeat(${n},${colW}px);width:${W}px">${track}${cols.join("")}${svg}</div></div>
    <div class="hscroll hv-d" tabindex="0" aria-label="Daily forecast, scroll sideways">${dayStrip()}</div>`;
}
/* The next 14 days as columns: each day's low-to-high range as a bar on one shared scale, coloured by temperature,
   with the chance of rain in dots. Tapping a day opens the full forecast with that day unfolded. */
function dayStrip() {
  const { Dy, di, c } = X;
  const idx = []; for (let i = di; i < Dy.time.length && idx.length < 14; i++) idx.push(i);
  const lo = Math.min(...idx.map(i => Dy.temperature_2m_min[i]).filter(v => v != null));
  const hi = Math.max(...idx.map(i => Dy.temperature_2m_max[i]).filter(v => v != null));
  const P = v => ((v - lo) / ((hi - lo) || 1) * 100).toFixed(1);
  const tc = v => window.Palette.tempFam(toC(v)).mid;
  const cols = idx.map((i, n) => {
    const key = Dy.time[i], [label, kind] = wmo(Dy.weather_code[i]);
    const mn = Dy.temperature_2m_min[i], mx = Dy.temperature_2m_max[i], pop = nz(Dy.precipitation_probability_max[i]);
    const lit = pop == null ? 0 : Math.round(pop / 20);
    let pd = ""; for (let q = 0; q < 5; q++) pd += `<circle cx="4" cy="${26 - q * 5.5}" r="${q < lit ? 2.2 : 1.5}" fill="${q < lit ? "var(--rain)" : "currentColor"}" opacity="${q < lit ? 1 : .18}"/>`;
    const now = n === 0 && c.temperature_2m != null ? `<span class="nd" style="bottom:${P(clamp(c.temperature_2m, lo, hi))}%"></span>` : "";
    // an uncertain day: the bar reaches out by how much the models disagree, fading at both ends, so it reads as
    // "somewhere around here" rather than an exact range
    const uc = U && U[key], fuzz = uc && uc.conf !== "high" ? (uc.fz ?? uc.deg) * (S.temp === "f" ? 1.8 : 1) / 2 : 0;
    const top = clamp(+P(mx + fuzz), 0, 100), bot = clamp(+P(mn - fuzz), 0, 100), fz = fuzz ? clamp((top - +P(mx) + +P(mn) - bot) / 2 / Math.max(top - bot, 1) * 100 + 8, 8, 45) : 0;
    return `<button class="dcol${uc && uc.conf === "low" ? " unsure" : ""}" data-n="${n}" aria-label="${n === 0 ? "Today" : wd(key) + " " + dm_(key)}: ${esc(label)}, ${R(mn)} to ${R(mx)} degrees${pop != null ? `, ${pop}% chance of rain` : ""}${uc && uc.conf !== "high" ? `, ${uc.conf} confidence` : ""}. Open details.">
      <span class="htime${n === 0 ? " now" : ""}">${n === 0 ? "Today" : wd(key)}</span>${icon(kind, true)}
      <em class="dhi hiT" style="--tc:${tc(mx)}">${R(mx)}°</em>
      <span class="dbar"><span class="dfill${fuzz ? " fuzzy" : ""}" style="top:${(100 - top).toFixed(1)}%;bottom:${bot.toFixed(1)}%;--lo:${tc(mn)};--hi:${tc(mx)};--fz:${fz.toFixed(0)}%"></span>${now}</span>
      <em class="dlo">${R(mn)}°</em>
      <div class="hpop"><svg viewBox="0 0 8 30" aria-hidden="true">${pd}</svg><span>${pop != null && pop >= 10 ? pop + "%" : "&nbsp;"}</span></div></button>`;
  });
  return `<div class="dstrip" style="grid-template-columns:repeat(${cols.length},minmax(58px,1fr));min-width:${cols.length * 58}px">${cols.join("")}</div>`;
}
$("#c-hourly").addEventListener("click", e => {
  const tab = e.target.closest(".hseg button");
  if (tab) {
    const v = tab.dataset.v, el = card("c-hourly"); store.set("hview", v); el.dataset.view = v;
    el.querySelectorAll(".hseg button").forEach(b => b.setAttribute("aria-selected", String(b === tab)));
    $("#hTitle").textContent = v === "d" ? "Next 14 days" : "Next 48 hours";
    return;
  }
  const col = e.target.closest(".dcol"); if (col) return openDays(+col.dataset.n);
  if (e.target.closest("#hAll")) openDays(null);
});
/* Pops the full 14-day stack out in a sheet; with a day number, that day comes up unfolded. */
function openDays(n) {
  if (n != null) store.set("openDay", n);
  renderDays();
  $("#dlgDays").showModal();
  const sheet = $("#dlgDays .sheet");
  sheet.scrollTop = 0;
  if (n != null && n > 0) requestAnimationFrame(() => { const d = $("#deck .day.open"); if (d) sheet.scrollTop = d.offsetTop - 70; });
}

/* ---------------- 14 days ---------------- */
/* Rain (or snow) falls in a day card once rain is likely (40%+) or measurable (0.5 mm+).
   More rain means more drops; a likelier forecast draws them brighter. */
function weatherFx(n, kind, pop, sumMm) {
  if (!((pop ?? 0) >= 40 || sumMm >= 0.5)) return "";
  const snow = kind === "snow";
  const count = sumMm < 1 ? 16 : sumMm < 5 ? 26 : sumMm < 15 ? 36 : 48;
  const strength = clamp(((pop ?? 60) - 20) / 60, .45, 1);
  return fallDrops(n, snow ? "snow" : kind, count, strength);
}
function renderDays() {
  const { Dy, di, c } = X, el = card("c-days");
  const idx = []; for (let i = di; i < Dy.time.length && idx.length < 14; i++) idx.push(i);
  const lo = Math.min(...idx.map(i => Dy.temperature_2m_min[i]).filter(v => v != null));
  const hi = Math.max(...idx.map(i => Dy.temperature_2m_max[i]).filter(v => v != null));
  const P = v => ((v - lo) / ((hi - lo) || 1) * 100).toFixed(1);
  const open = store.get("openDay", 0);
  const items = idx.map((i, n) => {
    const key = Dy.time[i], [label, kind] = wmo(Dy.weather_code[i]);
    const mn = Dy.temperature_2m_min[i], mx = Dy.temperature_2m_max[i], pop = nz(Dy.precipitation_probability_max[i]);
    const tc = v => window.Palette.tempFam(toC(v)).mid; // colour of a temperature on the shared scale
    const rise = Dy.sunrise[i] ? T(Dy.sunrise[i]) : null, set = Dy.sunset[i] ? T(Dy.sunset[i]) : null;
    const wdir = Dy.wind_direction_10m_dominant[i];
    return `<article class="day${n === open ? " open" : ""}" style="z-index:${n + 1}">
      ${weatherFx(n, kind, pop, toMm(Dy.precipitation_sum[i] ?? 0))}
      <button class="day-h" aria-expanded="${n === open}" data-n="${n}">
        <span class="dn"><b>${n === 0 ? "Today" : wd(key)}</b><i>${n === 0 ? wd(key) + " " : ""}${dm_(key)}</i></span>
        ${icon(kind, true)}
        <span class="dp">${pop != null && pop >= 10 ? pop + "%" : ""}</span>
        <span class="dr"><em>${R(mn)}°</em><span class="bar"><span class="fill" style="left:${P(mn)}%;right:${(100 - P(mx)).toFixed(1)}%;--lo:${tc(mn)};--hi:${tc(mx)}"></span>${n === 0 && c.temperature_2m != null ? `<span class="nd" style="left:${P(clamp(c.temperature_2m, lo, hi))}%"></span>` : ""}</span><em class="hiT" style="--tc:${tc(mx)}">${R(mx)}°</em></span>
      </button>
      <div class="day-b"><div class="day-bi"><div class="day-grid">
        <div class="say">${esc(label)}${pop != null ? `, ${pop}% chance of rain` : ""}.</div>
        ${tile("Feels like", `${R(Dy.apparent_temperature_min[i])}° / ${R(Dy.apparent_temperature_max[i])}°`)}
        ${tile("Rain", `${fmtP(Dy.precipitation_sum[i])} ${PU()}`)}
        ${tile("Rain hours", `${R(Dy.precipitation_hours[i])} h`)}
        ${tile("Wind", `${R(Dy.wind_speed_10m_max[i])} ${WU[S.wind]}${wdir != null ? " " + pt16(wdir) : ""}`)}
        ${tile("Gusts", `${R(Dy.wind_gusts_10m_max[i])} ${WU[S.wind]}`)}
        ${tile("UV max", Dy.uv_index_max[i] != null ? Dy.uv_index_max[i].toFixed(1) : "–")}
        ${tile("Sunrise", fmtT(rise))}
        ${tile("Sunset", fmtT(set))}
        ${tile("Sunshine", Dy.sunshine_duration[i] != null ? (Dy.sunshine_duration[i] / 3600).toFixed(1) + " h" : "–")}
        ${U && U[key] ? tile("Confidence", `${cap1(U[key].conf)} · ${U[key].deg < 1 ? "models agree" : `models differ by up to ${Math.max(1, Math.round(U[key].deg * (S.temp === "f" ? 1.8 : 1)))}°`}${U[key].lead >= 6 ? " · far ahead" : ""}`) : ""}
      </div></div></div>
    </article>`;
  }).join("");
  el.innerHTML = `<div class="deck" id="deck">${items}</div>`;
  $("#daysRange").textContent = `${R(lo)}° – ${R(hi)}°`;
}

/* ---------------- UV ---------------- */
/* Heat haze from UV 6 up: the card's background, grain and gauge ripple like air over hot asphalt. */
const UVL =[[3, "Low", "mint"], [6, "Moderate", "amber"], [8, "High", "vermilion"], [11, "Very high", "crimson"], [1e9, "Extreme", "violet"]];
function renderUV() {
  const { c, H, hi, Dy, di } = X, el = card("c-uv");
  const uv = Math.max(0, c.uv_index ?? H.uv_index[hi] ?? 0);
  const L = UVL.find(l => uv < l[0]);
  paint(el, FAM[L[2]]);
  setHaze("uv", uv >= 6 ? clamp(4 + (uv - 6) * 2, 4, 14) : 0);
  let peak = 0, peakT = null, from = null, to = null;
  for (let k = hi; k < H.time.length && H.time[k].startsWith(X.todayKey); k++) {
    const v = H.uv_index[k] ?? 0; if (v > peak) { peak = v; peakT = T(H.time[k]); }
    if (v >= 3) { if (!from) from = T(H.time[k]); to = T(H.time[k]); }
  }
  let ticks = "";
  for (let v = 0; v <= 12; v++) { const th = PI * (1 - v / 12); ticks += `<line x1="${100 + 86 * cos(th)}" y1="${100 - 86 * sin(th)}" x2="${100 + (v % 3 ? 90 : 94) * cos(th)}" y2="${100 - (v % 3 ? 90 : 94) * sin(th)}" stroke="currentColor" stroke-opacity="${v % 3 ? .38 : .75}" stroke-linecap="round"/>`; }
  const th = PI * (1 - clamp(uv, 0, 12) / 12), mx_ = 100 + 80 * cos(th), my_ = 100 - 80 * sin(th);
  const tri = `<path d="M${100 + 76 * cos(th)} ${100 - 76 * sin(th)} L${100 + 90 * cos(th + .07)} ${100 - 90 * sin(th + .07)} L${100 + 90 * cos(th - .07)} ${100 - 90 * sin(th - .07)}Z" fill="var(--signal)"/>`;
  const sub = uv < 3 && peak >= 3 && from ? `Protection ${fmtT(from)}–${fmtT(new Date(to.valueOf() + 36e5))}` : peak > uv ? `Peak ${peak.toFixed(0)} at ${fmtT(peakT)}` : `Today's max ${R(Dy.uv_index_max[di])}`;
  el.innerHTML = `${head("UV index", L[1])}
    <div class="gauge"><svg viewBox="0 0 200 108" aria-hidden="true">${ticks}
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="2"/>
      <path d="M20 100 A80 80 0 0 1 ${mx_.toFixed(1)} ${my_.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      ${tri}</svg>
      <div class="gauge-v" role="img" aria-label="UV index ${uv < 10 ? uv.toFixed(1) : Math.round(uv)}">${dm(uv < 10 ? uv.toFixed(1) : String(Math.round(uv)))}</div></div>
    <div class="foot" style="margin-top:12px"><span>${esc(sub)}</span></div>`;
}

/* ---------------- humidity ---------------- */
function renderHumid() {
  const { c } = X, el = card("c-humid");
  const h = c.relative_humidity_2m, dp = c.dew_point_2m, dpC = toC(dp);
  // muggy air is described by its dew point (how much water it really holds); otherwise by how full the air is,
  // so cool air at 82% reads as damp rather than "dry"
  const lab = dpC == null || h == null ? "–" : dpC >= 21 ? "Oppressive" : dpC >= 18 ? "Humid" : dpC >= 16 ? "A little humid"
    : h >= 90 ? "Very damp" : h >= 75 ? "Damp" : h >= 45 ? "Comfortable" : h >= 25 ? "Dry" : "Very dry";
  // the surface: two periods of a gentle swell in 400 units, so sliding it by half its width loops without a seam
  const wave = cls => `<svg class="${cls}" viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 6 Q50 1 100 6 T200 6 T300 6 T400 6 V12 H0Z" fill="rgba(175,200,255,.24)"/><path d="M0 6 Q50 1 100 6 T200 6 T300 6 T400 6" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
  const wet = (h ?? 0) >= 85; // condensation beads up on the card on very humid days
  el.innerHTML = `<span class="water" style="--h:${clamp(h ?? 0, 0, 100)}%">${wave("w1")}<span class="body"></span></span>
    <span class="sat" aria-hidden="true"><span>100%</span></span>
    ${wet ? `<canvas class="condense" id="humidCv" aria-hidden="true"></canvas>` : ""}${head("Humidity", lab)}
    <div class="num big">${R(h)}<small>%</small></div>
    <div class="foot"><span>Dew point <b>${R(dp)}°</b></span><button class="info-i" id="humidInfo" aria-label="How humidity, dew and fog work"><svg viewBox="0 0 12 12"><path d="M6 5.4v3.6"/><path d="M6 3h.01"/></svg></button></div>`;
  $("#humidInfo").onclick = () => openLearn(c.temperature_2m, dp, h);
  if (wet) startCondensation($("#humidCv")); else condStop();
}

/* A plain-language explainer of humidity, dew point, dew, frost and fog, starting from today's numbers. */
function openLearn(t, dp, h) {
  const gap = t != null && dp != null ? R(t) - R(dp) : null, F = S.temp === "f", mi = F || S.precip === "inch";
  const frz = F ? 32 : 0, dry = F ? 50 : 10, sticky = F ? 64 : 18;
  const now = gap == null ? "" : gap <= 1
    ? `Right now the air is ${R(t)}° and the dew point ${R(dp)}°. They're almost the same, so the air is close to full: dew, mist or fog are likely.`
    : `Right now the air is ${R(t)}° and the dew point ${R(dp)}°. A surface has to cool ${gap}° below the air before dew forms on it${R(dp) <= frz ? ", and since that's below freezing it would be frost" : ""}.`;
  $("#learnBody").innerHTML = `${now ? `<p class="now">${esc(now)}</p>` : ""}
    <h3>Humidity</h3><p>Air always carries some water as invisible vapour. Warm air can hold much more than cold air. Humidity (${R(h)}% now) says how full the air is compared with the most it can hold at its current temperature.</p>
    <h3>Dew point</h3><p>The temperature the air would have to cool to before it's completely full (100%). It tells you how much water is really in the air: the higher it is, the muggier it feels. Under ${dry}° feels dry, above ${sticky}° sticky.</p>
    <h3>Dew</h3><p>On clear, calm nights, grass, leaves and car roofs lose heat to the open sky and get colder than the air around them. Once a surface is colder than the dew point, water condenses on it, just like drops on a cold glass of water. If the surface is below ${frz}°, it becomes frost instead.</p>
    <h3>Mist and fog</h3><p>When the air itself cools down to its dew point, the water condenses into tiny floating droplets. You call it mist if you can still see over ${mi ? "half a mile" : "1 km"}, and fog below that. It mostly forms on still, clear nights, or when damp air moves over cold ground or water.</p>
    <h3>Why humidity peaks at night</h3><p>The amount of water in the air hardly changes over a day, but cooler night air can hold less of it. So humidity climbs towards 100% at night and drops again as the sun warms the air.</p>`;
  $("#dlgLearn").showModal();
}

/* ---------------- air ---------------- */
const EAQ = [[20, "Good", "mint"], [40, "Fair", "azure"], [60, "Moderate", "amber"], [80, "Poor", "coral"], [100, "Very poor", "crimson"], [1e9, "Extremely poor", "violet"]];
function renderAir() {
  const el = card("c-air"), a = AQ && AQ.current;
  if (!a || a.european_aqi == null) {
    paint(el, FAM.night);
    el.innerHTML = `${head("Air quality", "Unavailable")}<p class="empty">Air quality data from CAMS isn't available for this spot right now.</p>`; return;
  }
  const v = a.european_aqi, li = EAQ.findIndex(l => v < l[0]), L = EAQ[li];
  paint(el, FAM[L[2]]);
  let peak = v, peakT = null; const HA = AQ.hourly;
  if (HA) { const start = HA.time.findIndex(t => T(t) >= new Date(Date.now() - 36e5)); for (let k = Math.max(0, start); k < Math.min(HA.time.length, start + 24); k++) if ((HA.european_aqi[k] ?? 0) > peak) { peak = HA.european_aqi[k]; peakT = T(HA.time[k]); } }
  const rows = [["PM2.5", a.pm2_5, 15], ["PM10", a.pm10, 45], ["O₃", a.ozone, 100], ["NO₂", a.nitrogen_dioxide, 25], ["SO₂", a.sulphur_dioxide, 40]].filter(r => r[1] != null);
  const scale = EAQ.map((_, i) => `<i class="${i <= li ? "on" : ""}"></i>`).join("");
  el.innerHTML = `${v >= 60 ? `<span class="smog" aria-hidden="true"></span>` : ""}<div class="air"><div class="air-l">${head("Air quality", L[1])}
      ${dm(String(Math.round(v)))}
      <span class="mono">European AQI${a.us_aqi != null ? ` · US AQI ${Math.round(a.us_aqi)}` : ""}</span>
      <div class="scale" aria-hidden="true">${scale}<span class="tri" style="left:${clamp(v / 120 * 100, 2, 98)}%"></span></div>
      <span class="mono" style="margin-top:8px">${peakT ? `Peaks at ${Math.round(peak)} around ${fmtT(peakT)}` : "Steady over the next 24 h"}</span></div>
    <div class="pol tile">${rows.map(([n, val, lim]) => `<div class="pol-r"><span class="mono">${n}</span><div class="mbar"><div class="fill" style="width:${clamp(val / (lim * 2) * 100, 2, 100)}%"></div><span class="lim" style="left:50%"></span></div><span class="v">${val < 10 ? val.toFixed(1) : Math.round(val)}<small>µg/m³</small></span></div>`).join("")}
      <span class="mono lim-key"><i aria-hidden="true"></i>WHO daily guideline</span></div></div>`;
}

/* ---------------- moon ---------------- */
const MOON_RANGE = 120; // days either side of today
const dlab = d => d ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).format(d) : "–";
function renderMoon() {
  const el = card("c-moon");
  // stars kept clear of the moon itself, so none show through its dark side
  el.innerHTML = `${starField(4111, 20, (x, y) => x < 44 && y > 14 && y < 82)}
    <header class="ch"><h3 id="moonWhen">Moon</h3><p id="moonPhase"></p></header>
    <button class="hero-now" id="moonNow" hidden>Back to today</button>
    <div class="moon"><canvas id="moonCv" role="img"></canvas>
      <div class="moon-stats">
        <div><span class="num big" id="moonLit"></span></div>
        <div class="kv" id="moonKv"></div>
      </div></div>
    <div class="strip" id="moonStripBox" role="slider" tabindex="0" aria-label="Moon phase by date. Drag, scroll or use the arrow keys to move through the days." aria-valuemin="${-MOON_RANGE}" aria-valuemax="${MOON_RANGE}"><canvas id="moonStrip" aria-hidden="true"></canvas></div>`;
  X.moonOff = 0; X.moonDay = null;
  updateMoon(0);
  bindMoonScrub();
}
/* Moves the moon card to a day offset from today; fractional offsets let the phase change smoothly while dragging. */
function updateMoon(off) {
  off = clamp(off, -MOON_RANGE, MOON_RANGE); X.moonOff = off;
  const { lat, lon } = X, base = T(X.todayKey + "T12:00"), day = Math.round(off);
  const at = Math.abs(off) < 1e-3 ? new Date() : new Date(base.valueOf() + off * dayMs);
  const mi = moonIllum(at);
  X.moon = { phase: mi.phase, south: lat < 0, base };
  $("#moonPhase").textContent = phaseName(mi.phase);
  $("#moonLit").innerHTML = `${Math.round(mi.fraction * 100)}<small>% lit</small>`;
  $("#moonWhen").textContent = day === 0 ? "Moon" : dlab(new Date(base.valueOf() + day * dayMs));
  $("#moonNow").hidden = Math.abs(off) < .5;
  if (X.moonDay !== day) {
    // rise, set and the next full and new moon only change per day, so work them out once per day
    X.moonDay = day;
    const t0 = new Date(T(X.todayKey + "T00:00").valueOf() + day * dayMs);
    const mt = moonTimes(t0, lat, lon), from = day === 0 ? new Date() : t0;
    let nextFull = null, nextNew = null, prev = moonIllum(from).phase;
    for (let h = 3; h < 24 * 32 && !(nextFull && nextNew); h += 3) {
      const t = new Date(from.valueOf() + h * 36e5), p = moonIllum(t).phase;
      if (!nextFull && prev < .5 && p >= .5) nextFull = t;
      if (!nextNew && prev > .8 && p < .2) nextNew = t;
      prev = p;
    }
    const none = day === 0 ? "None today" : "None";
    $("#moonKv").innerHTML = tile("Moonrise", mt.rise ? fmtT(mt.rise) : none) + tile("Moonset", mt.set ? fmtT(mt.set) : none) + tile("Next full", dlab(nextFull)) + tile("Next new", dlab(nextNew));
  }
  const box = $("#moonStripBox");
  box.setAttribute("aria-valuenow", day);
  box.setAttribute("aria-valuetext", `${day === 0 ? "Today" : dlab(new Date(base.valueOf() + day * dayMs))}, ${phaseName(mi.phase)}, ${Math.round(mi.fraction * 100)} percent lit`);
  // a soft halo that grows with the lit fraction: barely there at a crescent, gentle at full moon
  const g = Math.pow(mi.fraction, 1.6), cv = $("#moonCv");
  cv.style.filter = `drop-shadow(0 0 ${(6 + 22 * g).toFixed(1)}px rgba(214,220,255,${(.04 + .3 * g).toFixed(3)}))`;
  cv.setAttribute("aria-label", `${phaseName(mi.phase)}, ${Math.round(mi.fraction * 100)} percent lit`);
  drawMoons();
}
function drawMoons() {
  if (!X.moon || !D) return;
  const cv = $("#moonCv"), st = $("#moonStrip"); if (!cv || !st) return;
  drawBigMoon(cv, X.moon.phase, X.moon.south);
  drawStrip(st, X.moonOff || 0, X.moon.base, X.moon.south);
}
let moonAnim = 0, moonSnapT;
function moonGlide(to) {
  cancelAnimationFrame(moonAnim);
  X.moonTarget = to;
  const from = X.moonOff, t0 = performance.now(), dur = Math.min(900, 250 + Math.abs(to - from) * 12);
  const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); updateMoon(from + (to - from) * e); if (k < 1) moonAnim = requestAnimationFrame(step); else X.moonTarget = null; };
  moonAnim = requestAnimationFrame(step);
}
function bindMoonScrub() {
  const box = $("#moonStripBox"), cv = $("#moonCv");
  let x0 = 0, o0 = 0, px = 1;
  const move = perFrame(e => updateMoon(o0 - (e.clientX - x0) / px));
  const end = () => { box.classList.remove("grab"); cv.classList.remove("grab"); removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); moonGlide(Math.round(X.moonOff)); };
  const down = e => {
    if (e.button !== 0) return;
    cancelAnimationFrame(moonAnim); X.moonTarget = null;
    // dragging the strip moves one day per moon; dragging the big moon is slower and finer
    px = e.currentTarget === box ? stripStep(box.clientWidth) : 8;
    x0 = e.clientX; o0 = X.moonOff; e.currentTarget.classList.add("grab");
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  };
  box.addEventListener("pointerdown", down); cv.addEventListener("pointerdown", down);
  box.addEventListener("wheel", e => {
    e.preventDefault(); cancelAnimationFrame(moonAnim); X.moonTarget = null;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    updateMoon(X.moonOff + d / 40);
    clearTimeout(moonSnapT); moonSnapT = setTimeout(() => moonGlide(Math.round(X.moonOff)), 160);
  }, { passive: false });
  box.addEventListener("keydown", e => {
    const cur = X.moonTarget ?? Math.round(X.moonOff); // keep counting from where a running glide is heading
    const to = { ArrowRight: cur + 1, ArrowUp: cur + 1, ArrowLeft: cur - 1, ArrowDown: cur - 1, PageUp: cur + 7, PageDown: cur - 7, Home: 0 }[e.key];
    if (to == null) return; e.preventDefault(); moonGlide(clamp(to, -MOON_RANGE, MOON_RANGE));
  });
  $("#moonNow").onclick = () => moonGlide(0);
}

/* ---------------- sun ---------------- */
function renderSun() {
  const { Dy, di, lat, lon } = X, el = card("c-sun");
  const st = sunTimes(dayOf(X.todayKey), lat, lon);
  const mid0 = T(X.todayKey + "T00:00").valueOf();
  const fr = d => d && !isNaN(d) ? clamp((d - mid0) / dayMs, 0, 1) : null;
  const dl = Dy.daylight_duration[di], dly = di > 0 ? Dy.daylight_duration[di - 1] : null;
  const ch = dl != null && dly != null ? dl - dly : null;
  const chTxt = ch == null ? "" : `${ch >= 0 ? "+" : "−"}${Math.floor(Math.abs(ch) / 60)}m ${String(Math.round(Math.abs(ch) % 60)).padStart(2, "0")}s vs yesterday`;
  const night = "#120a3a", tw = "#6a3fe0", gold = "#ff8a3c", day = "#ffe6b0";
  const stops = [];
  const add = (f, col) => { if (f != null) stops.push([f, col]); };
  if (fr(st.dawn) == null && fr(st.rise) == null) { const up = sunAlt(st.noon, lat, lon) > 0; add(0, up ? day : night); add(1, up ? day : night); }
  else { add(0, night); add(fr(st.dawn), night); add(fr(st.rise), tw); add(fr(st.goldenEnd), gold); add(fr(st.noon), day); add(fr(st.golden), gold); add(fr(st.set), tw); add(fr(st.dusk), night); add(1, night); }
  const grad = stops.sort((a, b) => a[0] - b[0]).map(([f, c]) => `<stop offset="${(f * 100).toFixed(2)}%" stop-color="${c}"/>`).join("");
  const sunsh = Dy.sunshine_duration[di];
  X.sunCard = { mid0, daylight: `${dur(dl)} of daylight`, t: null };
  el.innerHTML = `<div class="ch-row"><header class="ch"><h3 id="sunWhen">Sun</h3><p id="sunSub">${esc(X.sunCard.daylight)}</p></header><span class="mono" id="sunChange" style="text-align:right">${esc(chTxt)}</span></div>
    <button class="hero-now" id="sunNow" hidden>Back to now</button>
    <div class="band" id="sunBand" role="slider" tabindex="0" aria-label="Time of day. Drag, scroll or use the arrow keys to see the sun at another hour." aria-valuemin="0" aria-valuemax="1440"><svg viewBox="0 0 1000 30" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sb">${grad}</linearGradient></defs><rect width="1000" height="30" fill="url(#sb)"/></svg><span class="tri" id="sunTri"></span>
      <div class="band-axis mono"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>
    <div class="kv5">
      <div><span class="mono">First light</span><b>${fmtT(st.dawn)}</b></div>
      <div><span class="mono">Sunrise</span><b>${fmtT(Dy.sunrise[di] ? T(Dy.sunrise[di]) : null)}</b></div>
      <div><span class="mono">Golden hour</span><b>${fmtT(st.golden)}</b></div>
      <div><span class="mono">Sunset</span><b>${fmtT(Dy.sunset[di] ? T(Dy.sunset[di]) : null)}</b></div>
      <div><span class="mono">Last light</span><b>${fmtT(st.dusk)}</b></div>
    </div>
    <div class="foot" style="margin-top:14px"><span>Sunshine expected <b>${sunsh != null ? (sunsh / 3600).toFixed(1) + " h" : "–"}</b></span><span>Solar noon <b>${fmtT(st.noon)}</b></span></div>`;
  updateSun(null);
  bindSunCard();
}
/* Moves the sun card to a time today (null = now). The card colour follows the sun's height at that moment. */
function updateSun(t) {
  const s = X.sunCard; if (!s) return;
  const live = t == null, at = live ? new Date() : new Date(clamp(t, s.mid0, s.mid0 + dayMs - 6e4));
  s.t = live ? null : at.valueOf();
  const alt = sunAlt(at, X.lat, X.lon) / rad, f = clamp((at - s.mid0) / dayMs, 0, 1);
  paint(card("c-sun"), window.Palette.skyPal(Math.round(alt * 2) / 2)); // half-degree steps: smooth to the eye, far fewer repaints
  $("#sunTri").style.left = `${(f * 100).toFixed(2)}%`;
  const state = alt > 6 ? `Sun ${Math.round(alt)}° high` : alt > -.8 ? "Golden hour" : alt > -6 ? "Twilight" : "Night";
  $("#sunWhen").textContent = live ? "Sun" : fmtT(at);
  $("#sunSub").textContent = live ? s.daylight : state;
  $("#sunChange").hidden = !live; $("#sunNow").hidden = live;
  const band = $("#sunBand");
  band.setAttribute("aria-valuenow", Math.round(f * 1440));
  band.setAttribute("aria-valuetext", `${fmtT(at)}, ${state}`);
}
function bindSunCard() {
  const band = $("#sunBand"), s = X.sunCard;
  const tAt = e => { const r = band.getBoundingClientRect(); return s.mid0 + clamp((e.clientX - r.left) / r.width, 0, 1) * dayMs; };
  const cur = () => s.t ?? Date.now();
  const move = perFrame(e => updateSun(tAt(e)));
  const end = () => { band.classList.remove("grab"); removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
  band.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    band.classList.add("grab"); updateSun(tAt(e));
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  });
  band.addEventListener("wheel", e => { e.preventDefault(); const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; updateSun(cur() + d * 6e4 * 1.5); }, { passive: false });
  band.addEventListener("keydown", e => {
    const step = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15, PageUp: 60, PageDown: -60 }[e.key];
    if (e.key === "Home") { e.preventDefault(); updateSun(null); return; }
    if (step == null) return; e.preventDefault(); updateSun(cur() + step * 6e4);
  });
  $("#sunNow").onclick = () => updateSun(null);
}

/* ---------------- daylight through the year (glass) ---------------- */
/* Every day of this year as a thin column: down is the clock (0 at the top, 24 at the bottom), coloured as on the sun
   card: night, twilight, golden hour and daylight. Times are on the place's own clock, so the jumps where it switches
   between winter and summer time show as a step. Drag across it (or use the arrow keys) to read any day. */
const YEAR_COL = { night: "#120a3a", tw: "#6a3fe0", gold: "#ff8a3c", day: "#ffe6b0" };
function yearData() {
  const year = +new Date(Date.now() + OFF * 1000).toISOString().slice(0, 4), fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const offH = d => { const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value])); return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - d.valueOf()) / 36e5; };
  const days = [], n = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 864e5;
  for (let i = 0; i < n; i++) {
    const noonUTC = new Date(Date.UTC(year, 0, 1 + i, 12) - OFF * 1000), off = offH(noonUTC), st = sunTimes(noonUTC, X.lat, X.lon);
    const h = t => t && !isNaN(t) ? (((t.valueOf() / 36e5 + off) % 24) + 24) % 24 : null; // a moment as hours on the local clock
    const up = sunAlt(st.noon, X.lat, X.lon) > 0;
    days.push({ key: new Date(Date.UTC(year, 0, 1 + i)).toISOString().slice(0, 10), off, up,
      dawn: h(st.dawn), rise: h(st.rise), ge: h(st.goldenEnd), noon: h(st.noon), gold: h(st.golden), set: h(st.set), dusk: h(st.dusk),
      rise_t: st.rise, set_t: st.set, len: !isNaN(st.rise) && !isNaN(st.set) ? (st.set - st.rise) / 6e4 : up ? 1440 : 0 });
  }
  const minOff = Math.min(...days.map(d => d.off));
  days.forEach(d => { d.summer = d.off > minOff; });
  const today = days.findIndex(d => d.key === X.todayKey);
  return { year, days, today: today < 0 ? 0 : today };
}
function renderYear() {
  const el = card("c-year"), Y = (X.year = yearData());
  el.innerHTML = `${head("Daylight", `Through ${Y.year}`)}
    <button class="hero-now" id="yrNow" hidden>Today</button>
    <div class="yr-read"><b id="yrDate"></b><span class="num" id="yrLen"></span><span class="mono" id="yrDst"></span></div>
    <p class="yr-sub" id="yrSub"></p>
    <div class="yr-chart" id="yrChart" role="slider" tabindex="0" aria-label="Day of the year. Drag or use the arrow keys to see the daylight on another day." aria-valuemin="1" aria-valuemax="${Y.days.length}">
      <canvas id="yrCv" aria-hidden="true"></canvas>
      <span class="yr-h mono" style="top:25%">06</span><span class="yr-h mono" style="top:50%">12</span><span class="yr-h mono" style="top:75%">18</span>
      <span class="yr-today" style="left:${((Y.today + .5) / Y.days.length * 100).toFixed(2)}%"></span><span class="yr-sel" id="yrSel"></span></div>
    <div class="yr-axis mono">${["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map(m => `<span>${m}</span>`).join("")}</div>`;
  drawYear();
  updateYear(Y.today);
  bindYear();
}
function drawYear() {
  const Y = X.year, cv = $("#yrCv"); if (!Y || !cv) return;
  const s = sizeCanvas(cv); if (!s) return;
  const { ctx, w, h } = s, n = Y.days.length, cw = w / n;
  Y.days.forEach((d, i) => {
    const g = ctx.createLinearGradient(0, 0, 0, h), add = (hr, col) => { if (hr != null) g.addColorStop(clamp(hr / 24, 0, 1), col); };
    if (d.rise == null || d.set == null) { add(0, d.up ? YEAR_COL.day : YEAR_COL.night); add(24, d.up ? YEAR_COL.day : YEAR_COL.night); }
    else { add(0, YEAR_COL.night); add(d.dawn ?? d.rise, YEAR_COL.night); add(d.rise, YEAR_COL.tw); add(d.ge ?? d.rise, YEAR_COL.gold); add(d.noon, YEAR_COL.day); add(d.gold ?? d.set, YEAR_COL.gold); add(d.set, YEAR_COL.tw); add(d.dusk ?? d.set, YEAR_COL.night); add(24, YEAR_COL.night); }
    ctx.fillStyle = g; ctx.fillRect(Math.floor(i * cw), 0, Math.ceil(cw) + 1, h);
  });
}
const hm = mins => `${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, "0")}m`;
function updateYear(i) {
  const Y = X.year; if (!Y) return;
  i = clamp(Math.round(i), 0, Y.days.length - 1); Y.cur = i;
  const d = Y.days[i], prev = Y.days[i - 1] || d, today = Y.days[Y.today], isToday = i === Y.today;
  const step = d.len - prev.len, longest = Y.days.reduce((a, b) => b.len > a.len ? b : a), shortest = Y.days.reduce((a, b) => b.len < a.len ? b : a);
  $("#yrSel").style.left = `${((i + .5) / Y.days.length * 100).toFixed(2)}%`;
  $("#yrDate").textContent = isToday ? "Today" : `${wd(d.key)} ${dm_(d.key)}`;
  $("#yrLen").textContent = hm(d.len);
  const note = d === longest ? "the longest day" : d === shortest ? "the shortest day"
    : Math.abs(step) < .5 ? "about as long as the day before" : `${Math.abs(step) < 1 ? Math.round(Math.abs(step) * 60) + " s" : Math.round(Math.abs(step)) + " min"} ${step > 0 ? "longer" : "shorter"} than the day before`;
  const vs = isToday ? "" : ` · ${d.len >= today.len ? "+" : "−"}${hm(Math.abs(d.len - today.len))} vs today`;
  $("#yrSub").textContent = d.rise_t && !isNaN(d.rise_t) ? `Sunrise ${fmtT(d.rise_t)} · Sunset ${fmtT(d.set_t)} · ${note}${vs}` : d.up ? "The sun doesn't set" : "The sun doesn't rise";
  $("#yrDst").textContent = Y.days.some(x => x.summer) ? (d.summer ? "Summer time" : "Winter time") : "";
  $("#yrNow").hidden = isToday;
  const box = $("#yrChart"); box.setAttribute("aria-valuenow", i + 1); box.setAttribute("aria-valuetext", `${$("#yrDate").textContent}, ${hm(d.len)} of daylight`);
}
function bindYear() {
  const box = $("#yrChart"), at = e => { const r = box.getBoundingClientRect(); return (e.clientX - r.left) / r.width * X.year.days.length - .5; };
  const move = perFrame(e => updateYear(at(e)));
  const end = () => { box.classList.remove("grab"); removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
  box.addEventListener("pointerdown", e => { if (e.button !== 0) return; box.classList.add("grab"); updateYear(at(e)); addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end); });
  box.addEventListener("wheel", e => { const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0; if (!d) return; e.preventDefault(); updateYear(X.year.cur + d / 12); }, { passive: false });
  box.addEventListener("keydown", e => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 1, ArrowDown: -1, PageUp: 30, PageDown: -30 }[e.key];
    if (e.key === "Home") { e.preventDefault(); updateYear(X.year.today); return; }
    if (step == null) return; e.preventDefault(); updateYear(X.year.cur + step);
  });
  $("#yrNow").onclick = () => updateYear(X.year.today);
}

/* ---------------- pressure (glass) ---------------- */
function renderPress() {
  const { c, H, hi } = X, el = card("c-press");
  const p = c.pressure_msl, p3 = H.pressure_msl[hi - 3];
  const dp = p != null && p3 != null ? p - p3 : null;
  // a change of 2 hPa or more in 3 hours is fast; the needle trembles, as on an old barometer before a storm
  const fast = dp != null && Math.abs(dp) >= 2;
  const trend = dp == null ? "Steady" : dp > 1 ? (fast ? "Rising fast" : "Rising") : dp < -1 ? (fast ? "Falling fast" : "Falling") : "Steady";
  const inHg = S.precip === "inch";
  const val = p == null ? "–" : inHg ? (p * 0.02953).toFixed(2) : Math.round(p);
  const A = v => (135 + (clamp(v, 960, 1060) - 960) / 100 * 270) * rad;
  const pt = (a, r) => [100 + r * cos(a), 100 + r * sin(a)];
  let ticks = "";
  for (let v = 960; v <= 1060; v += 5) { const a = A(v), big = v % 20 === 0, [x1, y1] = pt(a, 86), [x2, y2] = pt(a, big ? 74 : 80); ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-opacity="${big ? .8 : .32}" stroke-width="${big ? 1.6 : 1}" stroke-linecap="round"/>`; }
  const a = A(p ?? 1013), [tx, ty] = pt(a, 70), [b1x, b1y] = pt(a - .08, 88), [b2x, b2y] = pt(a + .08, 88);
  const [s1x, s1y] = pt(A(960), 94), [s2x, s2y] = pt(A(1060), 94);
  el.innerHTML = `${head("Pressure", trend)}
    <div class="dial"><svg viewBox="0 0 200 188" aria-hidden="true">${ticks}
      <path d="M${s1x} ${s1y} A94 94 0 1 1 ${s2x} ${s2y}" fill="none" stroke="currentColor" stroke-opacity=".16" stroke-width="1"/>
      <path${fast ? ` class="tremble"` : ""} d="M${tx} ${ty} L${b1x} ${b1y} L${b2x} ${b2y}Z" fill="var(--signal)" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>
      <circle cx="${pt(A(1013.25), 94)[0].toFixed(1)}" cy="${pt(A(1013.25), 94)[1].toFixed(1)}" r="2.6" fill="currentColor"><title>Standard pressure, 1013 hPa</title></circle></svg>
      <div class="dial-v" role="img" aria-label="${val} ${inHg ? "inches of mercury" : "hectopascals"}">${dm(String(val))}<span class="mono">${inHg ? "inHg" : "hPa"}</span></div></div>
    <div class="foot"><span>Last 3 hours</span><b>${dp == null ? "–" : `${dp >= 0 ? "+" : "−"}${Math.abs(inHg ? dp * 0.02953 : dp).toFixed(inHg ? 2 : 1)}`}</b></div>`;
}

/* ---------------- visibility (glass) ---------------- */
function renderVis() {
  const { c, H, hi } = X, el = card("c-vis");
  const raw = c.visibility ?? H.visibility[hi];
  const unitFt = (D.current_units && D.current_units.visibility) === "ft";
  const km = raw == null ? null : unitFt ? raw * 0.0003048 : raw / 1000;
  const imperial = S.precip === "inch" || S.temp === "f";
  const show = km == null ? "–" : imperial ? (km / 1.609).toFixed(km / 1.609 < 10 ? 1 : 0) : (km < 10 ? km.toFixed(1) : Math.round(km));
  const lab = km == null ? "–" : km < 1 ? "Fog" : km < 4 ? "Mist or haze" : km < 10 ? "Moderate" : km < 20 ? "Good" : "Very clear";
  // Fading ridges: five hill lines at 1, 3, 8, 20 and 50 km, nearest at the bottom. Ridges within sight are
  // drawn with normal atmospheric depth; the one at the edge of visibility is half-lost, the rest vanish into haze.
  const RIDGES = [1, 3, 8, 20, 50], W = 240, Hh = 92;
  const lg = d => Math.log10(Math.max(d, .1));
  let paths = "", edge = null;
  for (let i = RIDGES.length - 1; i >= 0; i--) {
    const d = RIDGES[i], prev = i ? RIDGES[i - 1] : .3;
    const v = km == null ? 0 : clamp((lg(km) - lg(prev)) / (lg(d) - lg(prev)), 0, 1); // 1 = fully in sight
    if (v >= 1 && edge == null) edge = i; // farthest ridge that is fully clear
    const base = 80 - i * 13, amp = 6 - i * .8, ph = i * 1.7; // one or two gentle swells per ridge, a slight ripple on top
    // The ridge shape repeats every 240 units (the card width), so it can drift sideways forever without a seam.
    // Nearer ridges flow faster than distant ones (parallax), and each bobs gently on its own slow rhythm.
    let p = `M0 ${Hh}`;
    for (let x = 0; x <= W * 2; x += 8) p += ` L${x} ${(base - amp * (.8 * sin(x / W * 2 * PI * (1 + (i % 2)) + ph) + .2 * sin(x / W * 6 * PI + ph * 2))).toFixed(1)}`;
    // colour by distance (dark near, blue-grey far), then washed into the haze by how far out of sight it is
    const col = `color-mix(in oklab,color-mix(in oklab,var(--v-near),var(--v-far) ${Math.round(i / (RIDGES.length - 1) * 100)}%) ${Math.round(v * 100)}%,var(--v-haze))`;
    paths += `<path d="${p} L${W * 2} ${Hh}Z" style="fill:${col};--t:${(38 + i * 22)}s;--b:${(5 + i * 1.7).toFixed(1)}s;--dl:${(-i * 7.3).toFixed(1)}s"/>`;
  }
  // clarity 0 (thick fog, under 0.5 km) to 1 (30 km and more): how blue the sky is and how much haze hangs over it all
  const clear = km == null ? .5 : clamp((lg(km) - lg(.5)) / (lg(30) - lg(.5)), 0, 1);
  const fmtD = d => imperial ? `${Math.round(d / 1.609 * 10) / 10} mi` : `${d} km`;
  const say = km == null ? "" : edge == null ? "Even nearby hills are lost in fog" : edge === RIDGES.length - 1 ? `Hills ${fmtD(50)} away are in view` : `Clear out to hills ${fmtD(RIDGES[edge])} away, hazy beyond`;
  el.innerHTML = `<span class="vis-sky" aria-hidden="true" style="--clear:${Math.round(clear * 100)}%;--skyA:${(.35 + .4 * clear).toFixed(2)}"></span>
    <span class="vis-fog" aria-hidden="true" style="--fogA:${((1 - clear) * .75).toFixed(2)}"></span>
    ${head("Visibility", lab)}
    <div class="num big">${show}<small>${imperial ? "mi" : "km"}</small></div>
    <p class="vis-say">${esc(say)}</p>
    <div class="vis"><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="You can see about ${show} ${imperial ? "miles" : "kilometres"}">${paths}</svg></div>`;
}

/* ---------------- rain totals ---------------- */
function renderRain() {
  const { Dy, di, H, hi } = X, el = card("c-rain");
  const today = Dy.precipitation_sum[di], pop = nz(Dy.precipitation_probability_max[di]);
  const next = []; for (let k = hi; k < hi + 24 && k < H.time.length; k++) next.push(H.precipitation[k] ?? 0);
  const sum24 = next.reduce((a, b) => a + b, 0), mx = Math.max(...next.map(toMm), 1);
  const bars = next.map((v, i) => { const h = toMm(v) / mx * 36; return `<rect x="${i * 10 + 2}" y="${40 - Math.max(h, 1.5)}" width="6" height="${Math.max(h, 1.5)}" rx="3" fill="currentColor" opacity="${v > 0 ? 1 : .24}"/>`; }).join("");
  el.innerHTML = `${head("Rain", "Today")}
    <div class="num big">${fmtP(today)}<small>${PU()}</small></div>
    <div class="spark"><svg viewBox="0 0 240 42" preserveAspectRatio="none" aria-hidden="true">${bars}</svg></div>
    <div class="foot"><span>Next 24 h <b>${fmtP(sum24)} ${PU()}</b></span><span>${pop != null ? `<b>${pop}%</b> chance` : ""}</span></div>`;
}

/* ---------------- clouds ---------------- */
function renderClouds() {
  const { c } = X, el = card("c-clouds");
  const cc = c.cloud_cover ?? 0;
  const lab = cc <= 12 ? "Clear" : cc <= 37 ? "Few clouds" : cc <= 62 ? "Scattered" : cc <= 87 ? "Broken" : "Overcast";
  const cols = 14, rows = 6, total = cols * rows, lit = Math.round(cc / 100 * total);
  // seeded order that clusters lit dots into soft cloud banks
  const order = Array.from({ length: total }, (_, i) => { const x = i % cols, y = Math.floor(i / cols); return [i, Math.sin(x * .7 + y * 1.3) * Math.cos(x * .35 - y * .9) + ((i * 9301 + 49297) % 233280) / 233280 * .5]; }).sort((a, b) => b[1] - a[1]).map(a => a[0]);
  const on = new Set(order.slice(0, lit));
  let dots = ""; for (let i = 0; i < total; i++) { const x = i % cols, y = Math.floor(i / cols); dots += `<circle cx="${x * 17 + 8}" cy="${y * 13 + 7}" r="${on.has(i) ? 4.6 : 2}" fill="currentColor" opacity="${on.has(i) ? .95 : .24}"/>`; }
  el.innerHTML = `${head("Cloud cover", lab)}
    <div class="num big">${R(cc)}<small>%</small></div>
    <div class="field"><svg viewBox="0 0 238 78" aria-hidden="true">${dots}</svg></div>`;
}

/* ---------------- pollen ---------------- */
const POLLEN = [["grass_pollen", "Grass", [5, 30, 100]], ["birch_pollen", "Birch", [10, 100, 500]], ["alder_pollen", "Alder", [10, 50, 200]], ["mugwort_pollen", "Mugwort", [5, 20, 50]], ["ragweed_pollen", "Ragweed", [5, 20, 50]], ["olive_pollen", "Olive", [20, 100, 400]]];
function renderPollen() {
  const el = card("c-pollen"), a = AQ && AQ.current;
  const avail = a && POLLEN.some(([k]) => a[k] != null);
  if (!avail) { el.innerHTML = `${head("Pollen", "Not forecast here")}<p class="empty">Pollen counts come from the CAMS European model, so they're only available for locations in Europe.</p>`; return; }
  const lvl = (v, t) => v < 1 ? [0, "None"] : v < t[0] ? [1, "Low"] : v < t[1] ? [2, "Moderate"] : v < t[2] ? [3, "High"] : [4, "Very high"];
  const items = POLLEN.filter(([k]) => a[k] != null).map(([k, n, t]) => { const v = a[k], [l, ln] = lvl(v, t); return { n, v, l, ln }; });
  const top = items.reduce((m, i) => i.l > m.l ? i : m, items[0]);
  el.innerHTML = `<div class="ch-row">${head("Pollen", top.l === 0 ? "Nothing in the air" : `${top.n} is ${top.ln.toLowerCase()}`)}<span class="mono">grains/m³</span></div>
    <div class="pgrid">${items.map(i => `<div class="tile"><span class="mono">${i.n}</span><b>${i.v < 10 ? i.v.toFixed(1) : Math.round(i.v)}</b><span class="dots" role="img" aria-label="${i.ln}">${[1, 2, 3, 4].map(q => `<i class="${q <= i.l ? "on" : ""}"></i>`).join("")}</span></div>`).join("")}</div>`;
}

/* ---------------- source ---------------- */
function renderSrc() {
  const m = MODELS.find(x => x[0] === S.model) || MODELS[0];
  $("#infoBody").innerHTML = `<p><b>Forecast</b> Open-Meteo, ${esc(m[1])} model. ${esc(m[2])}</p>
    <p><b>Air and pollen</b> Copernicus CAMS.</p>
    <p><b>Rain radar</b> RainViewer, on Esri map tiles (Esri, HERE, Garmin, © OpenStreetMap).</p>
    <p><b>Weather warnings</b> MeteoAlarm (EUMETNET) and the national weather services, such as KMI. Region outlines © EuroGeographics.</p>
    <p><b>Moon</b> NASA LRO imagery. Phases, sunrise and twilight are calculated on this device.</p>`;
  // where the forecast is for: coordinates, height above sea level and time zone
  const ll = (v, p, n) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? p : n}`;
  const elev = D.elevation ?? 0, elevTxt = S.precip === "inch" ? `${Math.round(elev * 3.281)} ft` : `${Math.round(elev)} m`;
  $("#locLine").textContent = `${ll(D.latitude, "N", "S")}, ${ll(D.longitude, "E", "W")} · ${elevTxt} above sea level · ${D.timezone.replace(/_/g, " ")}`;
  $("#modelChip").innerHTML = `Model <b>${esc(m[1].split(" ·")[0])}</b>`;
}

/* ---------------- radar ---------------- */
let map, base, marker, cityLayer, frames = [], layers = [], fi = 0, timer = null, radarHost = "", radarLoaded = 0;
const esri = kind => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${document.documentElement.dataset.mode === "day" ? "Light" : "Dark"}_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`;
/* Our own map labels instead of the provider's: only larger cities, in the app's type. [name, lat, lon, population in millions] */
const CITIES = [
  ["London",51.507,-0.128,9],["Paris",48.857,2.352,11],["Brussels",50.850,4.352,1.2],["Antwerp",51.219,4.402,.53],["Ghent",51.054,3.717,.26],["Liège",50.633,5.567,.2],
  ["Charleroi",50.411,4.444,.2],["Bruges",51.209,3.225,.12],["Leuven",50.880,4.700,.1],["Namur",50.467,4.872,.11],["Amsterdam",52.370,4.895,.9],["Rotterdam",51.924,4.478,.65],
  ["The Hague",52.070,4.300,.55],["Utrecht",52.091,5.122,.36],["Eindhoven",51.441,5.470,.24],["Breda",51.589,4.776,.18],["Maastricht",50.851,5.691,.12],["Groningen",53.219,6.567,.23],
  ["Lille",50.629,3.057,1],["Luxembourg",49.612,6.130,.13],["Cologne",50.938,6.960,1.1],["Düsseldorf",51.227,6.774,.62],["Dortmund",51.514,7.468,.59],["Essen",51.456,7.012,.58],
  ["Aachen",50.776,6.084,.25],["Frankfurt",50.110,8.682,.76],["Berlin",52.520,13.405,3.6],["Hamburg",53.551,9.993,1.8],["Munich",48.137,11.576,1.5],["Stuttgart",48.776,9.183,.63],
  ["Bremen",53.079,8.802,.57],["Hanover",52.375,9.732,.54],["Leipzig",51.340,12.375,.6],["Dresden",51.050,13.738,.56],["Nuremberg",49.452,11.077,.52],["Zurich",47.377,8.541,.42],
  ["Basel",47.560,7.588,.17],["Geneva",46.204,6.143,.2],["Lyon",45.764,4.836,1.4],["Marseille",43.296,5.370,.87],["Bordeaux",44.838,-.579,.26],["Toulouse",43.605,1.444,.5],
  ["Nantes",47.218,-1.554,.32],["Strasbourg",48.573,7.752,.29],["Reims",49.258,4.032,.18],["Rouen",49.443,1.099,.11],["Madrid",40.417,-3.704,3.3],["Barcelona",41.385,2.173,1.6],
  ["Lisbon",38.722,-9.139,.55],["Porto",41.158,-8.629,.23],["Seville",37.389,-5.984,.69],["Valencia",39.470,-.377,.79],["Rome",41.903,12.496,2.8],["Milan",45.464,9.190,1.4],
  ["Naples",40.852,14.268,.96],["Turin",45.070,7.687,.87],["Venice",45.441,12.316,.26],["Florence",43.770,11.256,.38],["Vienna",48.208,16.373,1.9],["Prague",50.075,14.438,1.3],
  ["Warsaw",52.230,21.012,1.8],["Kraków",50.065,19.945,.78],["Budapest",47.498,19.040,1.7],["Copenhagen",55.676,12.568,.64],["Stockholm",59.329,18.069,.98],["Oslo",59.914,10.752,.7],
  ["Helsinki",60.170,24.938,.66],["Dublin",53.350,-6.260,.59],["Manchester",53.481,-2.243,.55],["Birmingham",52.486,-1.890,1.1],["Leeds",53.801,-1.549,.79],["Bristol",51.455,-2.588,.47],
  ["Glasgow",55.864,-4.252,.63],["Edinburgh",55.953,-3.188,.52],["Athens",37.984,23.728,3],["Istanbul",41.008,28.978,15],["Bucharest",44.427,26.103,1.8],["Sofia",42.698,23.322,1.2],
  ["Belgrade",44.787,20.457,1.2],["Zagreb",45.815,15.982,.8],["Kyiv",50.450,30.523,2.9],["Moscow",55.756,37.617,12.5],["St Petersburg",59.934,30.336,5.4],["Riga",56.950,24.105,.63],
  ["Vilnius",54.687,25.280,.58],["Tallinn",59.437,24.754,.44],["New York",40.713,-74.006,8.3],["Los Angeles",34.052,-118.244,3.9],["Chicago",41.878,-87.630,2.7],["Houston",29.760,-95.370,2.3],
  ["Phoenix",33.448,-112.074,1.6],["Philadelphia",39.953,-75.165,1.6],["Dallas",32.777,-96.797,1.3],["San Diego",32.716,-117.161,1.4],["San Francisco",37.775,-122.419,.87],["Seattle",47.606,-122.332,.74],
  ["Denver",39.739,-104.990,.71],["Boston",42.360,-71.059,.68],["Washington",38.907,-77.037,.69],["Atlanta",33.749,-84.388,.5],["Miami",25.762,-80.192,.45],["Toronto",43.653,-79.383,2.8],
  ["Montreal",45.502,-73.567,1.8],["Vancouver",49.283,-123.121,.68],["Mexico City",19.433,-99.133,9.2],["São Paulo",-23.550,-46.633,12.3],["Rio de Janeiro",-22.907,-43.173,6.7],["Buenos Aires",-34.604,-58.382,3.1],
  ["Lima",-12.046,-77.043,9.7],["Bogotá",4.711,-74.072,7.4],["Santiago",-33.449,-70.669,6.2],["Tokyo",35.676,139.650,14],["Osaka",34.694,135.502,2.7],["Seoul",37.566,126.978,9.7],
  ["Beijing",39.904,116.407,21],["Shanghai",31.230,121.474,24],["Hong Kong",22.319,114.169,7.4],["Singapore",1.352,103.820,5.6],["Bangkok",13.756,100.502,10.5],["Jakarta",-6.208,106.846,10.6],
  ["Delhi",28.704,77.102,30],["Mumbai",19.076,72.878,20],["Dubai",25.205,55.271,3.3],["Cairo",30.044,31.236,10],["Lagos",6.524,3.379,15],["Nairobi",-1.292,36.822,4.4],
  ["Johannesburg",-26.204,28.047,5.6],["Cape Town",-33.925,18.424,4.6],["Sydney",-33.869,151.209,5.3],["Melbourne",-37.814,144.963,5],["Brisbane",-27.470,153.026,2.5],["Perth",-31.951,115.861,2.1],["Auckland",-36.849,174.763,1.7]
];
const mlab = (name, here) => L.marker([0, 0], { interactive: false, keyboard: false, icon: L.divIcon({ className: `mlab${here ? " here" : ""}`, iconSize: [0, 0], html: `<i></i><span>${esc(name)}</span>` }) });
/* Picks the biggest cities in view, skipping any that would crowd an existing label or your own location. */
function placeCities() {
  if (!map) return;
  cityLayer.clearLayers();
  const b = map.getBounds().pad(-.08), here = map.latLngToContainerPoint(marker.getLatLng());
  const taken = [[here.x, here.y]], max = map.getSize().x > 420 ? 6 : 4;
  const hereName = (place && place.name || "").toLowerCase();
  if (place) cityLayer.addLayer(mlab(place.name, true).setLatLng(marker.getLatLng()));
  for (const [n, la, lo] of CITIES.filter(c => b.contains([c[1], c[2]])).sort((a, b) => b[3] - a[3])) {
    if (taken.length > max || n.toLowerCase() === hereName) continue;
    const p = map.latLngToContainerPoint([la, lo]);
    if (taken.some(([x, y]) => Math.abs(x - p.x) < 96 && Math.abs(y - p.y) < 30)) continue;
    taken.push([p.x, p.y]); cityLayer.addLayer(mlab(n).setLatLng([la, lo]));
  }
}
/* Radar tiles, redrawn in the app's palette. RainViewer's free tiles only exist up to zoom 7 and in one colour scheme,
   so each tile is read pixel by pixel: rain intensity is recovered from the original colours and repainted on our ramp.
   Past zoom 7 the parent tile is upscaled smoothly (with a little blur scaled to the zoom) instead of as blocky pixels. */
const RAIN_RAMP = [[0, [143, 168, 255, .38]], [.22, [143, 168, 255, .5]], [.4, [75, 78, 242, .66]], [.56, [122, 63, 240, .76]], [.7, [232, 48, 127, .86]], [.85, [239, 47, 43, .9]], [1, [255, 207, 92, .95]]];
const RAIN_LUT = Array.from({ length: 101 }, (_, i) => {
  const v = i / 100, j = RAIN_RAMP.findIndex(s => s[0] >= v), b = RAIN_RAMP[Math.max(j, 1)], a = RAIN_RAMP[Math.max(j, 1) - 1], t = (v - a[0]) / ((b[0] - a[0]) || 1);
  return a[1].map((x, k) => x + (b[1][k] - x) * clamp(t, 0, 1));
});
/* Intensity (0–1) from a pixel in RainViewer's "Universal Blue" scheme: pale to deep blue for light to steady rain,
   then yellow, orange, red, and magenta or white for the most intense cells. */
function rainLevel(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510, d = mx - mn;
  if (d < 24) return l > .78 ? 1 : .2;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 165 && h <= 262) return clamp(.06 + (1 - l) * .6, .06, .5);
  if (h > 262 && h < 335) return .97;
  if (h >= 42 && h < 165) return .58;
  if (h >= 22) return .72;
  return .87;
}
/* Softens radar pixels before they're recoloured, so the rain has smooth edges instead of blocky steps. Done by hand
   because Safari has no canvas blur filter: two box-blur passes each way (close to a Gaussian), on premultiplied colour
   so the edges of a shower don't go dark. */
const radarScratch = document.createElement("canvas");
function softBlur(p, w, h) {
  const n = w * h, a = new Float32Array(n * 4), b = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i += 4) { const al = p[i + 3] / 255; a[i] = p[i] * al; a[i + 1] = p[i + 1] * al; a[i + 2] = p[i + 2] * al; a[i + 3] = p[i + 3]; }
  const pass = (src, dst, horiz) => { // radius-1 box blur along rows or columns, edges clamped
    const len = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 4 : w * 4;
    for (let l = 0; l < lines; l++) {
      const base = horiz ? l * w * 4 : l * 4;
      for (let x = 0; x < len; x++) {
        const o = base + x * step, lo = base + Math.max(0, x - 1) * step, hi = base + Math.min(len - 1, x + 1) * step;
        for (let c = 0; c < 4; c++) dst[o + c] = (src[lo + c] + src[o + c] + src[hi + c]) / 3;
      }
    }
  };
  pass(a, b, true); pass(b, a, false); pass(a, b, true); pass(b, a, false);
  for (let i = 0; i < n * 4; i += 4) {
    const al = a[i + 3]; p[i + 3] = al;
    if (al > 0) { const m = 255 / al; p[i] = a[i] * m; p[i + 1] = a[i + 1] * m; p[i + 2] = a[i + 2] * m; }
  }
}
const RadarLayer = window.L ? L.GridLayer.extend({
  // few spare tiles and no redraws mid-zoom: every tile is a recoloured canvas, and iOS has a hard cap on canvas memory
  options: { keepBuffer: 1, updateWhenZooming: false },
  onAdd(map) {
    L.GridLayer.prototype.onAdd.call(this, map);
    // give a dropped tile's pixels back right away instead of waiting for the garbage collector
    this.on("tileunload", e => { e.tile.width = e.tile.height = 0; });
  },
  createTile(coords, done) {
    const tile = document.createElement("canvas"); tile.width = tile.height = 256;
    const z = Math.min(coords.z, 7), k = 2 ** (coords.z - z), img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!tile.width) return; // dropped while its image was loading
      // the part of the source tile this tile shows, plus a few pixels around it so the softening has neighbours
      const sw = 256 / k, pad = 3, sx = (coords.x % k) * sw, sy = (coords.y % k) * sw;
      const x0 = Math.max(0, sx - pad), y0 = Math.max(0, sy - pad), x1 = Math.min(256, sx + sw + pad), y1 = Math.min(256, sy + sw + pad);
      const w = x1 - x0, h = y1 - y0;
      radarScratch.width = w; radarScratch.height = h;
      const s = radarScratch.getContext("2d", { willReadFrequently: true });
      s.drawImage(img, x0, y0, w, h, 0, 0, w, h);
      const im = s.getImageData(0, 0, w, h), p = im.data;
      softBlur(p, w, h);
      for (let i = 0; i < p.length; i += 4) {
        const a = p[i + 3]; if (a < 10) { p[i + 3] = 0; continue; }
        const col = RAIN_LUT[Math.round(rainLevel(p[i], p[i + 1], p[i + 2]) * 100)];
        p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; p[i + 3] = Math.round(col[3] * a);
      }
      s.putImageData(im, 0, 0);
      // recoloured at the source's own size, then scaled up smoothly
      const c = tile.getContext("2d");
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
      c.drawImage(radarScratch, sx - x0, sy - y0, sw, sw, 0, 0, 256, 256);
      done(null, tile);
    };
    img.onerror = () => done(null, tile);
    img.src = this.options.url.replace("{z}", z).replace("{x}", Math.floor(coords.x / k)).replace("{y}", Math.floor(coords.y / k));
    return tile;
  }
}) : null;
async function initRadar() {
  const box = $("#radarMap");
  if (!window.L) { box.innerHTML = `<p class="empty" style="padding:60px 20px">The map library didn't load. Check your connection and refresh.</p>`; return; }
  const ll = [D.latitude, D.longitude];
  if (!map) {
    map = L.map(box, { zoomControl: false, scrollWheelZoom: false, attributionControl: false }).setView(ll, 7);
    base = L.tileLayer(esri("Base"), { maxZoom: 12, maxNativeZoom: 16 }).addTo(map);
    // an HTML dot rather than a vector circle: vector shapes stretch with the map during a zoom and then snap back
    marker = L.marker(ll, { icon: L.divIcon({ className: "here-pin", iconSize: [14, 14] }), interactive: false, keyboard: false }).addTo(map);
    cityLayer = L.layerGroup().addTo(map);
    map.on("moveend zoomend resize", placeCities);
    $("#zIn").onclick = () => map.zoomIn(); $("#zOut").onclick = () => map.zoomOut();
    $("#rPlay").onclick = () => timer ? stopLoop() : startLoop();
    // drag along the timeline to move through the frames, like scrubbing a video
    const rt = $("#rTicks");
    const frameAt = x => { const r = rt.getBoundingClientRect(); return clamp(Math.floor((x - r.left) / r.width * frames.length), 0, frames.length - 1); };
    const scrubTo = i => { if (i !== fi) show(i); };
    rt.addEventListener("pointerdown", e => { if (!frames.length || e.button !== 0) return; stopLoop(); rt.setPointerCapture(e.pointerId); rt.classList.add("grab"); scrubTo(frameAt(e.clientX)); });
    const rMove = perFrame(e => scrubTo(frameAt(e.clientX)));
    rt.addEventListener("pointermove", e => { if (rt.hasPointerCapture(e.pointerId)) rMove(e); });
    for (const ev of ["pointerup", "pointercancel"]) rt.addEventListener(ev, () => rt.classList.remove("grab"));
    rt.addEventListener("keydown", e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d && frames.length) { e.preventDefault(); stopLoop(); show(fi + d); rt.children[fi].focus(); } });
  } else { map.setView(ll, map.getZoom()); marker.setLatLng(ll); base.setUrl(esri("Base")); }
  placeCities();
  setTimeout(() => map.invalidateSize(), 50);
  if (Date.now() - radarLoaded < 5 * 6e4 && layers.length) return;
  try {
    const j = await getJSON("https://api.rainviewer.com/public/weather-maps.json");
    radarHost = j.host; radarLoaded = Date.now();
    layers.forEach(l => map.removeLayer(l)); stopLoop();
    const past = (j.radar && j.radar.past) || [], fut = (j.radar && j.radar.nowcast) || [];
    frames = [...past.map(f => ({ ...f, fut: false })), ...fut.map(f => ({ ...f, fut: true }))];
    layers = frames.map(f => new RadarLayer({ url: `${radarHost}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, opacity: 0, maxZoom: 12, zIndex: 10 })); // show() puts the ones it needs on the map
    $("#rTicks").innerHTML = frames.map((f, i) => `<button class="${f.fut ? "fut" : ""}" data-i="${i}" aria-label="Frame ${i + 1}"></button>`).join("");
    $("#rTicks").onclick = e => { const b = e.target.closest("button"); if (b) { stopLoop(); show(+b.dataset.i); } };
    $("#radarSub").textContent = fut.length ? "Last 2 hours and next 30 min" : "Last 2 hours";
    show(past.length - 1);
  } catch { $("#radarSub").textContent = navigator.onLine ? "Radar is unavailable right now" : "Offline"; }
}
function show(i) {
  if (!frames.length) return;
  fi = (i + frames.length) % frames.length;
  // only the shown frame and two either side are loaded (enough to play smoothly); the rest are dropped to save memory
  const n = frames.length, near = k => { const d = Math.abs(k - fi); return Math.min(d, n - d) <= 2; };
  layers.forEach((l, k) => {
    if (!near(k)) { if (map.hasLayer(l)) map.removeLayer(l); return; }
    if (!map.hasLayer(l)) l.addTo(map);
    l.setOpacity(k === fi ? .8 : 0);
  });
  [...$("#rTicks").children].forEach((b, k) => b.classList.toggle("cur", k === fi));
  const t = new Date(frames[fi].time * 1000), mins = Math.round((t - Date.now()) / 6e4);
  $("#rTime").textContent = `${fmtT(t)} ${Math.abs(mins) < 6 ? "now" : (mins > 0 ? "+" : "") + mins + "m"}`;
}
function startLoop() { if (!frames.length) return; timer = setInterval(() => { if (!offscreen("c-radar")) show(fi + 1); }, 650); $("#rPlayIc").innerHTML = '<path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z"/>'; $("#rPlay").setAttribute("aria-label", "Pause radar loop"); }
function stopLoop() { clearInterval(timer); timer = null; $("#rPlayIc").innerHTML = '<path d="M8 5.5v13l10.5-6.5z"/>'; $("#rPlay").setAttribute("aria-label", "Play radar loop"); }

/* ---------------- orchestration ---------------- */
function applyMode() {
  const m = S.mode === "auto" ? (D && !D.current.is_day ? "night" : D ? "day" : "night") : S.mode;
  document.documentElement.dataset.mode = m;
  $('meta[name="theme-color"]').content = m === "day" ? "#e8e7ef" : "#08080b";
  if (base) base.setUrl(esri("Base"));
}
function renderClock() {
  if (!D) return;
  const parts = new Intl.DateTimeFormat(S.clock === "12" ? "en-US" : "en-GB", { hour: S.clock === "12" ? "numeric" : "2-digit", minute: "2-digit", hour12: S.clock === "12", timeZone: TZ }).formatToParts(new Date());
  const get = t => (parts.find(p => p.type === t) || {}).value || "";
  const hh = get("hour"), mm = get("minute"), ap = get("dayPeriod").toLowerCase(), chars = [...`${hh}:${mm}`], el = $("#clock");
  if (+el.dataset.len !== chars.length) { el.innerHTML = chars.map(() => `<span class="ck"></span>`).join("") + `<span class="mono ck-ap"></span>`; el.dataset.len = chars.length; }
  el.querySelectorAll(".ck").forEach((slot, i) => { if (slot.dataset.c !== chars[i]) { slot.dataset.c = chars[i]; slot.innerHTML = dm(chars[i]); } });
  el.querySelector(".ck-ap").textContent = ap;
  el.setAttribute("aria-label", `Local time ${hh}:${mm}${ap ? " " + ap : ""}`);
}
function renderPlace() {
  $("#placeName").textContent = place ? place.name : "Isobar";
  $("#tbName").textContent = place ? place.name : "";
  const t = D ? localDateLabel(new Date()) : ""; // the time itself lives in the dot-matrix clock pill
  $("#placeSub").textContent = place ? [place.sub, t].filter(Boolean).join(" · ") : "Finding your location";
  renderDots();
}
function renderAll() {
  derive(); applyMode(); renderPlace(); renderClock();
  const parts = [renderSummary, renderHero, renderNow, renderWind, renderFeels, renderHourly, renderDays, renderUV, renderHumid, renderAir, renderMoon, renderSun, renderYear, renderPress, renderVis, renderRain, renderClouds, renderPollen, renderSrc];
  for (const f of parts) { try { f(); } catch (e) { console.error(f.name, e); } }
  initRadar();
}
function showError(msg) {
  const el = card("c-hero");
  paint(el, FAM.crimson);
  el.innerHTML = `${head("No forecast", "Something went wrong")}<div class="err"><p>${esc(msg)}</p><button class="btn" id="retry">Try again</button></div>`;
  $("#retry").onclick = () => load(place);
}
let loading = false, dataKey = "";
async function load(p, { quiet = false } = {}) {
  if (!p || loading) return;
  const prev = place, key = cacheKey(p);
  loading = true; $("#refreshBtn").classList.add("spin"); $("#netPill").classList.add("busy");
  place = p; store.set("place", p);
  if (!saved.some(s => samePlace(s, p))) { roamer = p; store.set("roamer", p); } // an unsaved place leads the swipe order
  renderPlace();
  // a place seen before opens straight from its last forecast while the fresh one loads
  if (dataKey !== key) { const hit = forecasts.get(key); if (hit) { adopt(hit, key); try { renderAll(); } catch (e) { console.error(e); } } }
  try {
    const [w, a, u] = await fetchAll(p);
    adopt({ D: w, AQ: a, U: confidence(u), at: Date.now() }, key);
    forecasts.put(key, { D, AQ, U, at: fetchedAt });
    netFail = false; loadWarnings(p);
    renderAll();
  } catch (e) {
    netFail = true;
    if (dataKey === key) { if (!quiet && navigator.onLine) toast("Couldn't reach the forecast. Showing the last one."); }
    else if (!D) showError(navigator.onLine ? `Couldn't load the forecast: ${e.message}. Try again in a moment.` : "You're offline. Connect to the internet to load the forecast.");
    else { // nothing kept for this place: stay on the one that is showing
      place = prev; store.set("place", prev); renderPlace();
      toast(navigator.onLine ? `Couldn't load ${p.name}. Try again in a moment.` : `${p.name} loads once you're back online.`);
    }
  } finally { loading = false; $("#refreshBtn").classList.remove("spin"); $("#netPill").classList.remove("busy"); renderNet(); }
}
function adopt(f, key) { D = f.D; AQ = f.AQ; U = f.U || null; TZ = D.timezone; OFF = D.utc_offset_seconds; fetchedAt = f.at; dataKey = key; }
const cacheKey = p => [p.lat, p.lon, S.temp, S.wind, S.precip, S.model].join("|");
/* The last forecast of the six most recent places and settings, so they open offline too. */
const forecasts = {
  all() {
    const c = store.get("forecasts", null); if (c) return c;
    const old = store.get("cache", null); // the single-place cache of earlier versions
    return old && old.key ? { [old.key]: { D: old.D, AQ: old.AQ, at: old.at } } : {};
  },
  get(key) { return this.all()[key] || null; },
  put(key, f) {
    const c = this.all(); c[key] = f;
    const keys = Object.keys(c).sort((a, b) => c[b].at - c[a].at);
    // a full storage keeps fewer places rather than none
    for (let n = Math.min(6, keys.length); n > 0; n--) {
      try { localStorage.setItem("isobar:forecasts", JSON.stringify(Object.fromEntries(keys.slice(0, n).map(k => [k, c[k]])))); break; } catch {}
    }
    try { localStorage.removeItem("isobar:cache"); } catch {}
  }
};

/* ---------------- official weather warnings ---------------- */
/* MeteoAlarm's warnings (KMI, KNMI, DWD...), prepared every half hour by .github/workflows/warnings.yml and stored
   in 5° tiles on the "warnings" branch. The app fetches its own tile and keeps the warnings whose area it is in. */
const WARN_URL = "https://raw.githubusercontent.com/victorvansande/isobar/warnings/w/";
const WLEVEL = { 2: ["Yellow", "#ffd23f"], 3: ["Orange", "#ff8a1f"], 4: ["Red", "#ff3b30"] };
let warnings = [];
// is the point inside the warning's outline? (even-odd rule, so holes in a region count as outside)
function inWarning(w, x, y) {
  const [x0, y0, x1, y1] = w.bbox; if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  return w.polys.some(rings => {
    let inside = false;
    for (const r of rings) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
async function loadWarnings(p) {
  try {
    const r = await fetch(`${WARN_URL}${Math.floor(p.lat / 5)}_${Math.floor(p.lon / 5)}.json`, { cache: "no-cache" });
    if (r.status === 404) warnings = []; // no warnings anywhere in this tile
    else if (r.ok) {
      const soon = Date.now() + 36 * 36e5; // what's on now, and what starts within the next day and a half
      warnings = (await r.json()).warnings.filter(w => Date.parse(w.expires) > Date.now() && Date.parse(w.onset) < soon && inWarning(w, p.lon, p.lat))
        .sort((a, b) => b.level - a.level || Date.parse(a.onset) - Date.parse(b.onset));
    } // other failures (offline, a hiccup): keep what was shown
  } catch {}
  if (place === p) renderWarnings();
}
// "14:00", "tomorrow 06:00" or "Tue 09:00", in the place's own time
function whenAt(d) {
  const key = x => new Date(x.valueOf() + OFF * 1000).toISOString().slice(0, 10), today = key(new Date()), k = key(d);
  return k === today ? fmtT(d) : k === key(new Date(Date.now() + 864e5)) ? `tomorrow ${fmtT(d)}` : `${wd(k)} ${fmtT(d)}`;
}
function renderWarnings() {
  const b = $("#warn"); b.hidden = !warnings.length; if (!warnings.length) return;
  const w = warnings[0], [name, col] = WLEVEL[w.level] || WLEVEL[2], now = Date.now() >= Date.parse(w.onset);
  b.style.setProperty("--wc", col);
  $("#warnT").textContent = `${name} warning · ${w.type}`;
  $("#warnS").textContent = [now ? `Until ${whenAt(new Date(w.expires))}` : `From ${whenAt(new Date(w.onset))}`, warnings.length > 1 ? `+${warnings.length - 1} more` : (w.areas[0] || "")].filter(Boolean).join(" · ");
  b.setAttribute("aria-label", `${name} weather warning for ${w.type}. ${$("#warnS").textContent}. Show details.`);
}
$("#warn").onclick = () => {
  const link = u => /^https?:\/\//.test(u) ? ` · <a href="${esc(u)}" target="_blank" rel="noopener">More details</a>` : "";
  $("#warnBody").innerHTML = warnings.map(w => {
    const [name, col] = WLEVEL[w.level] || WLEVEL[2];
    return `<div class="wx" style="--wc:${col}"><h3><i></i>${esc(name)} warning · ${esc(w.type)}</h3>
      <p class="when">${esc(whenAt(new Date(w.onset)))} – ${esc(whenAt(new Date(w.expires)))}${w.areas.length ? " · " + esc(w.areas.slice(0, 3).join(", ")) : ""}</p>
      ${w.description ? `<p>${esc(w.description)}</p>` : w.headline ? `<p>${esc(w.headline)}</p>` : ""}
      ${w.instruction && !/^be (vigilant|aware)\.?$/i.test(w.instruction.trim()) ? `<p>${esc(w.instruction)}</p>` : ""}
      <p>${esc(w.sender || "MeteoAlarm")}${link(w.web)}</p></div>`;
  }).join("");
  $("#dlgWarn").showModal();
};

/* ---------------- connection ---------------- */
// like a native app: without a connection the last forecast stays up, with a pill saying how old it is
let netFail = false;
const ago = t => {
  const m = (Date.now() - t) / 6e4;
  return m < 1 ? "just now" : m < 60 ? `${Math.floor(m)} min ago` : m < 24 * 60 ? `${Math.floor(m / 60)} h ago` : updLabel(t);
};
const updLabel = t => (Date.now() - t > 20 * 36e5 ? wd(new Date(t + OFF * 1000).toISOString().slice(0, 10)) + " " : "") + fmtT(new Date(t));
function renderNet() {
  const offline = !navigator.onLine, on = (offline || netFail) && !!D, pill = $("#netPill");
  pill.classList.toggle("on", on); pill.setAttribute("aria-hidden", String(!on)); pill.tabIndex = on ? 0 : -1;
  document.body.classList.toggle("net-off", on);
  if (on) {
    $("#netT").textContent = offline ? "Offline" : "Can't reach the forecast";
    $("#netS").textContent = `Updated ${ago(fetchedAt)}`;
    pill.setAttribute("aria-label", `${offline ? "Offline" : "Can't reach the forecast"}. Updated ${ago(fetchedAt)}. Tap to try again.`);
  }
  $("#c-radar").classList.toggle("offline", offline);
}
$("#netPill").onclick = () => load(place);
addEventListener("online", () => { netFail = false; renderNet(); if (place) load(place, { quiet: true }); });
addEventListener("offline", renderNet);

let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3600); }

/* ---------------- deck ---------------- */
$("#c-days").addEventListener("click", e => {
  const b = e.target.closest(".day-h"); if (!b) return;
  const art = b.parentElement, was = art.classList.contains("open");
  document.querySelectorAll(".day.open").forEach(d => { d.classList.remove("open"); d.querySelector(".day-h").setAttribute("aria-expanded", "false"); });
  if (!was) { art.classList.add("open"); b.setAttribute("aria-expanded", "true"); store.set("openDay", +b.dataset.n); } else store.set("openDay", -1);
});

/* ---------------- places ---------------- */
const dlgP = $("#dlgPlaces"), dlgS = $("#dlgSet");
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
[dlgP, dlgS, $("#dlgDays"), $("#dlgInfo"), $("#dlgLearn"), $("#dlgWarn")].forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));
const placeRow = (p, i, kind) => `<div class="row" role="button" tabindex="0" data-kind="${kind}" data-i="${i}"><span><b>${esc(p.name)}</b><span>${esc(p.sub || `${p.lat}, ${p.lon}`)}</span></span>${kind === "saved" ? `<button class="x" data-del="${i}" aria-label="Remove ${esc(p.name)}">✕</button>` : ""}</div>`;
let results = [];
function renderSaved() {
  $("#savedList").innerHTML = saved.length ? saved.map((p, i) => placeRow(p, i, "saved")).join("") : `<p class="muted" style="margin:4px 14px;font-size:13px">No saved places yet.</p>`;
  const isSaved = place && saved.some(s => s.lat === place.lat && s.lon === place.lon);
  $("#saveCur").hidden = !place || isSaved;
  if (place) $("#saveCurT").textContent = `Save ${place.name}`;
  renderDots();
}
function openPlaces() { renderSaved(); $("#results").innerHTML = ""; $("#q").value = ""; results = []; dlgP.showModal(); }

/* ---------------- swipe between places ---------------- */
// You swipe through your saved places, led by the last place you opened that isn't saved (such as the spot your
// location found). Small dots under "Places" in the dock show how many there are and where you are.
const samePlace = (a, b) => !!a && !!b && a.lat === b.lat && a.lon === b.lon;
let roamer = store.get("roamer", null);
function placeRing() { const r = saved.slice(); if (roamer && !r.some(s => samePlace(s, roamer))) r.unshift(roamer); return r; }
function renderDots() {
  const r = placeRing(), i = r.findIndex(s => samePlace(s, place));
  $("#pdots").innerHTML = r.length > 1 ? r.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("") : "";
  $("#searchBtn").setAttribute("aria-label", r.length > 1 && i >= 0 ? `Places, ${i + 1} of ${r.length}` : "Places");
}
// Lets go of the page after a swipe (`dir` 1 = next place, -1 = previous, 0 = stay): it slides out, the new place
// loads (instantly when its forecast was kept), and slides in from the other side. With nowhere to go it springs back.
let swiping = false;
async function release(dir) {
  const app = $(".app"), from = app.style.transform || "translateX(0px)", op = app.style.opacity || "1";
  app.style.transform = ""; app.style.opacity = "";
  const r = placeRing(), next = dir ? r[r.findIndex(s => samePlace(s, place)) + dir] : null;
  if (!next || swiping) { app.animate([{ transform: from, opacity: op }, { transform: "translateX(0)", opacity: 1 }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" }); return; }
  swiping = true;
  const out = app.animate([{ transform: from, opacity: op }, { transform: `translateX(${-dir * 32}%)`, opacity: 0 }], { duration: 170, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
  await out.finished;
  scrollTo(0, 0); load(next);
  app.animate([{ transform: `translateX(${dir * 32}%)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
  out.cancel(); swiping = false;
}
{
  const app = $(".app");
  // controls that move sideways themselves keep their own gesture
  const own = t => t.closest(".hscroll,.leaflet-container,[role=slider],.band,#arcIn,#moonCv,.rticks,.zoomer,.rbar,input");
  let x0 = 0, y0 = 0, dx = 0, mode = "no";
  app.addEventListener("touchstart", e => {
    mode = e.touches.length === 1 && !own(e.target) && placeRing().length > 1 && !swiping ? "maybe" : "no";
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0;
  }, { passive: true });
  app.addEventListener("touchmove", e => {
    if (mode === "no") return;
    const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
    if (mode === "maybe") { if (Math.hypot(mx, my) < 10) return; mode = Math.abs(mx) > Math.abs(my) * 1.3 ? "swipe" : "no"; if (mode === "no") return; }
    e.preventDefault(); dx = mx; // a sideways swipe: the page follows the finger instead of scrolling
    const r = placeRing(), i = r.findIndex(s => samePlace(s, place)), there = r[i + (dx < 0 ? 1 : -1)];
    const shift = there ? dx * .55 : dx * .18; // with nothing that way it only gives a little
    app.style.transform = `translateX(${shift.toFixed(1)}px)`; app.style.opacity = (1 - Math.min(Math.abs(shift) / 700, .3)).toFixed(3);
  }, { passive: false });
  const end = () => { if (mode !== "swipe") return; mode = "no"; release(Math.abs(dx) > 70 ? (dx < 0 ? 1 : -1) : 0); };
  app.addEventListener("touchend", end); app.addEventListener("touchcancel", end);
  // on a computer: the arrow keys
  document.addEventListener("keydown", e => {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]") || (e.target.closest && e.target.closest("input,[role=slider],.hscroll,.leaflet-container,.band,.rticks"))) return;
    if (placeRing().length > 1) release(e.key === "ArrowRight" ? 1 : -1);
  });
}
let qT;
$("#q").addEventListener("input", e => {
  clearTimeout(qT); const q = e.target.value.trim();
  if (q.length < 2) { $("#results").innerHTML = ""; results = []; return; }
  qT = setTimeout(async () => {
    try { results = await geocode(q); $("#results").innerHTML = results.length ? results.map((p, i) => placeRow(p, i, "res")).join("") : `<p class="muted" style="margin:4px 14px;font-size:13px">No places match “${esc(q)}”.</p>`; }
    catch { $("#results").innerHTML = `<p class="muted" style="margin:4px 14px;font-size:13px">Search isn't reachable right now.</p>`; }
  }, 260);
});
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (results[0]) { dlgP.close(); load(results[0]); } } });
dlgP.addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); saved.splice(+del.dataset.del, 1); store.set("saved", saved); renderSaved(); return; }
  const row = e.target.closest(".row[data-kind]"); if (!row) return;
  const p = row.dataset.kind === "saved" ? saved[+row.dataset.i] : results[+row.dataset.i];
  dlgP.close(); load(p);
});
dlgP.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches(".row[data-kind]")) { e.preventDefault(); e.target.click(); } });
$("#saveCur").onclick = () => { if (!place) return; saved.push({ name: place.name, sub: place.sub, lat: place.lat, lon: place.lon }); store.set("saved", saved); renderSaved(); toast(`Saved ${place.name}`); };
$("#placeBtn").onclick = openPlaces; $("#searchBtn").onclick = openPlaces;
$("#locBtn").onclick = async () => {
  $("#locBtn").classList.add("spin");
  try { const c = await geolocate(); await load(await reverse(c.latitude, c.longitude)); }
  catch (e) { toast(e.message); }
  finally { $("#locBtn").classList.remove("spin"); }
};
$("#refreshBtn").onclick = () => load(place);
$("#topbar").onclick = () => scrollTo({ top: 0, behavior: "smooth" });

/* ---------------- settings ---------------- */
function renderSettings() {
  document.querySelectorAll(".seg").forEach(seg => [...seg.children].forEach(b => b.setAttribute("aria-pressed", String(S[seg.dataset.k] === b.dataset.v))));
  $("#models").innerHTML = MODELS.map(([id, n, d]) => `<button data-m="${id}" aria-pressed="${S.model === id}"><b>${esc(n)}</b><span>${esc(d)}</span></button>`).join("");
}
function setSetting(k, v) {
  if (S[k] === v) return;
  const old = S[k], refetch = ["temp", "wind", "precip", "model"].includes(k);
  S[k] = v;
  // units and models come from the server: offline that only works if this combination was kept before
  if (refetch && !navigator.onLine && place && !forecasts.get(cacheKey(place))) { S[k] = old; renderSettings(); return toast("That needs a connection. Try again once you're online."); }
  store.set("settings", S); renderSettings();
  if (refetch) load(place);
  else if (D) renderAll(); else applyMode();
}
dlgS.addEventListener("click", e => {
  const b = e.target.closest(".seg button"); if (b) return setSetting(b.parentElement.dataset.k, b.dataset.v);
  const m = e.target.closest("[data-m]"); if (m) setSetting("model", m.dataset.m);
});
// the dock button opens all settings; the model chip opens just the forecast models
const openSettings = modelOnly => { dlgS.classList.toggle("model-only", modelOnly); $("#setTitle").textContent = modelOnly ? "Forecast model" : "Settings"; renderSettings(); dlgS.showModal(); };
$("#setBtn").onclick = () => openSettings(false);
$("#modelChip").onclick = () => openSettings(true);
$("#infoBtn").onclick = () => $("#dlgInfo").showModal();

/* ---------------- Android ---------------- */
// The back button (or gesture) closes an open sheet instead of leaving the app. Each sheet adds a step to the
// history while it's open; closing it any other way (✕, a tap outside, Escape) takes that step back out again.
{
  let skipPop = 0;
  document.querySelectorAll("dialog").forEach(d => {
    new MutationObserver(() => { if (d.open && !d.hist) { d.hist = true; history.pushState({ sheet: d.id }, ""); } }).observe(d, { attributes: true, attributeFilter: ["open"] });
    d.addEventListener("close", () => { if (!d.hist) return; d.hist = false; if (history.state && history.state.sheet === d.id) { skipPop++; history.back(); } });
  });
  addEventListener("popstate", () => {
    if (skipPop) { skipPop--; return; }
    const d = document.querySelector("dialog[open]"); if (d) { d.hist = false; d.close(); }
  });
}
// Chrome offers to install the app: show "Install Isobar as an app" in Settings while that offer stands
// (iPhones never make this offer; there it's Share → Add to Home Screen).
let installOffer = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installOffer = e; $("#installBtn").hidden = false; });
addEventListener("appinstalled", () => { installOffer = null; $("#installBtn").hidden = true; });
$("#installBtn").onclick = async () => { if (!installOffer) return; installOffer.prompt(); await installOffer.userChoice.catch(() => {}); installOffer = null; $("#installBtn").hidden = true; };
// shortcuts from a long press on the app icon: ?open=places, radar or days
function openFromLink() {
  const what = new URLSearchParams(location.search).get("open"); if (!what) return;
  history.replaceState(history.state, "", location.pathname); // so a refresh doesn't open it again
  if (what === "places") openPlaces();
  else if (what === "radar") card("c-radar").scrollIntoView({ block: "center" });
  else if (what === "days" && D) openDays(null);
}

/* ---------------- only animate what can be seen ---------------- */
// Each card pauses its CSS animations, and the JS loops tied to it (radar playback, heat shimmer, running
// condensation beads), while it's scrolled out of view. The margin is generous, so everything is already running
// again by the time it scrolls in, exactly as it was left: nothing changes on screen, the phone just does less work.
const offscreen = id => { const el = card(id); return !!el && el.classList.contains("offscreen"); };
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(es => { for (const e of es) e.target.classList.toggle("offscreen", !e.isIntersecting); }, { rootMargin: "300px 0px" });
  document.querySelectorAll("#board > .card").forEach(el => io.observe(el));
}

/* ---------------- lifecycle ---------------- */
document.querySelectorAll("[data-fam]").forEach(el => paint(el, FAM[el.dataset.fam]));
// stagger the slow inflow so the cards don't pulse in unison
document.querySelectorAll(".pig").forEach((el, i) => el.style.setProperty("--delay", `${(-(i * 7.3) % 34).toFixed(1)}s`));
let rT;
// Phones fire "resize" whenever the address bar slides in or out while scrolling; only a real change of width (turning
// the phone, resizing a window) needs the canvases redrawn, and redrawing clears them for a moment.
let lastW = innerWidth;
window.addEventListener("resize", () => {
  clearTimeout(rT);
  rT = setTimeout(() => {
    if (innerWidth === lastW) { if (map) map.invalidateSize(); return; }
    lastW = innerWidth;
    drawMoons(); drawYear(); if (map) map.invalidateSize();
    // canvas effects are drawn at a fixed pixel size, so redraw them (instantly) at the new size
    const hf = $("#heroFrost"); if (hf) frostRim(hf);
    const hc = $("#humidCv"); if (hc) startCondensation(hc);
  }, 150);
});
const tb = $("#topbar");
window.addEventListener("scroll", () => { const on = scrollY > 160 && !!D; tb.classList.toggle("show", on); tb.setAttribute("aria-hidden", String(!on)); }, { passive: true });
document.addEventListener("visibilitychange", () => { if (!document.hidden && place && Date.now() - fetchedAt > 10 * 6e4) { load(place, { quiet: true }); followMe(); } });

/* A place found by location follows you: on launch and on coming back to the app, if location is already allowed,
   check where you are now and move along when you're more than 3 km away. Never asks for permission by itself. */
async function followMe() {
  if (!place || !place.gps || !navigator.onLine || !navigator.permissions) return;
  try { if ((await navigator.permissions.query({ name: "geolocation" })).state !== "granted") return; } catch { return; }
  try {
    const c = await geolocate();
    const km = Math.hypot((c.latitude - place.lat) * 111, (c.longitude - place.lon) * 111 * cos(c.latitude * rad));
    if (km < 3) return;
    while (loading) await new Promise(r => setTimeout(r, 200));
    load(await reverse(c.latitude, c.longitude), { quiet: true });
  } catch {}
}

/* Pull to refresh in the home-screen app (Safari has its own). */
if (document.documentElement.classList.contains("standalone")) {
  const el = $("#ptr"), arc = $("#ptrArc"), need = 110;
  let y0 = null, pull = 0;
  // the ring fills as you pull; full means letting go will refresh
  const set = p => { el.style.transform = `translateY(${-50 + Math.min(p, 170) * .45}px)`; el.style.opacity = Math.min(1, p / 60); arc.style.strokeDasharray = `${Math.min(100, p / need * 100).toFixed(1)} 100`; };
  const reset = () => { el.classList.add("snap"); el.style.transform = ""; el.style.opacity = ""; setTimeout(() => { el.classList.remove("snap", "go"); arc.style.strokeDasharray = ""; }, 320); };
  addEventListener("touchstart", e => {
    pull = 0;
    y0 = scrollY <= 0 && e.touches.length === 1 && !el.classList.contains("go") && !e.target.closest(".leaflet-container,dialog,#arcIn,[role=slider]") ? e.touches[0].clientY : null;
  }, { passive: true });
  addEventListener("touchmove", e => {
    if (y0 == null) return;
    if (scrollY > 0) { y0 = null; pull = 0; return reset(); }
    pull = Math.max(0, e.touches[0].clientY - y0); set(pull);
  }, { passive: true });
  addEventListener("touchend", async () => {
    if (y0 == null) return; y0 = null;
    if (pull < need || !place) return reset();
    el.classList.add("snap", "go"); el.style.transform = "translateY(6px)";
    await load(place); reset();
  });
}
setInterval(() => { if (place && !document.hidden) load(place, { quiet: true }); }, 10 * 6e4);
setInterval(() => { if (D) { renderPlace(); renderNet(); } }, 30e3);
setInterval(renderClock, 1000);

(async function boot() {
  applyMode();
  // once the real lunar map is read, redraw the moon from it (until then the painted fallback shows)
  loadMoonMap().then(m => { if (m) { moonTex = null; drawMoons(); } });
  const hit = place && forecasts.get(cacheKey(place));
  if (hit) { adopt(hit, cacheKey(place)); try { renderAll(); } catch (e) { console.error(e); } }
  renderNet();
  if (!place) { renderPlace(); place = await guessPlace(); }
  const first = load(place, { quiet: !!D });
  if (D) openFromLink(); else first.then(openFromLink);
  followMe();
})();
})();
