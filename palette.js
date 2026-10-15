/* Kwick palette — every colour in the app comes from here.
   Families were sampled from the reference boards (see color-study.html).
   Each family has four roles:
     core  the deep centre of a card (keeps white type readable)
     mid   the saturated body colour
     hi    the bright rim / corner glow
     acc   a neighbouring hue that blooms in from the opposite corner */
(function () {
  "use strict";
  const FAM = {
    ice:       { core: "#04213f", mid: "#0b7fd6", hi: "#9eeaff", acc: "#3d5bff" },
    cobalt:    { core: "#060f4a", mid: "#2350f5", hi: "#7fc0ff", acc: "#00b2ff" },
    indigo:    { core: "#0d0b45", mid: "#4b4ef2", hi: "#aab4ff", acc: "#7a3ff0" },
    violet:    { core: "#1b0a4d", mid: "#7a3ff0", hi: "#c9b0ff", acc: "#ff4fb8" },
    orchid:    { core: "#350a4e", mid: "#b04de0", hi: "#f6b4fb", acc: "#ff7a8a" },
    coral:     { core: "#4f0f2a", mid: "#ff6a4a", hi: "#ffb48c", acc: "#c45ad8" },
    vermilion: { core: "#4a0410", mid: "#ef2f2b", hi: "#ff9255", acc: "#ff2d87" },
    crimson:   { core: "#3a0222", mid: "#d80d4a", hi: "#ff5f6e", acc: "#ff6a12" },
    raspberry: { core: "#47052f", mid: "#e8307f", hi: "#ffa3c8", acc: "#ff8a4a" },
    amber:     { core: "#4a1702", mid: "#ff8412", hi: "#ffcf5c", acc: "#ff3d6e" },
    mint:      { core: "#032f2c", mid: "#0fb38c", hi: "#8ff7d4", acc: "#2a7bff" },
    azure:     { core: "#03264c", mid: "#0a8fd8", hi: "#8fe9f2", acc: "#4b4ef2" },
    lime:      { core: "#032618", mid: "#239a3e", hi: "#c8ff3a", acc: "#0fb38c" },
    lilac:     { core: "#22134a", mid: "#8b78f0", hi: "#e6d8ff", acc: "#ff8ad8" },
    night:     { core: "#04041a", mid: "#22268a", hi: "#8a96ff", acc: "#7a3ff0" },
    sunset:    { core: "#3a0626", mid: "#f0402c", hi: "#ffb35a", acc: "#b04de0" },
    twilight:  { core: "#140b3e", mid: "#5a3fd8", hi: "#ff8fd0", acc: "#2a55f0" },
    daylight:  { core: "#4a1d06", mid: "#ff9419", hi: "#ffe08a", acc: "#ff5a5f" }
  };
  /* The sun card follows the sun's height: night, twilight, golden hour, full day. */
  const SKY = [[-12, "night"], [-4, "twilight"], [3, "sunset"], [16, "daylight"]];
  /* The temperature scale walks the colour wheel cold→hot through violet,
     never across it, so neighbouring stops can't blend into khaki or mud. */
  const TEMP = [[-15, "ice"], [-4, "cobalt"], [4, "indigo"], [10, "violet"], [15, "orchid"], [20, "coral"], [26, "vermilion"], [33, "crimson"]];
  const ROLES = ["core", "mid", "hi", "acc"];
  const SIGNAL = "#e80049";

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const h2r = h => [0, 2, 4].map(i => parseInt(h.slice(1 + i, 3 + i), 16));
  const r2h = a => "#" + a.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const A = h2r(a), B = h2r(b); return r2h(A.map((v, i) => v + (B[i] - v) * t)); };
  const blend = (a, b, t) => Object.fromEntries(ROLES.map(k => [k, mix(a[k], b[k], t)]));
  const shift = (p, map) => Object.fromEntries(ROLES.map(k => [k, map[k] ? mix(p[k], map[k][0], map[k][1]) : p[k]]));

  function tempFam(c) {
    if (c == null || isNaN(c)) return { ...FAM.night };
    if (c <= TEMP[0][0]) return { ...FAM[TEMP[0][1]] };
    for (let i = 1; i < TEMP.length; i++) if (c <= TEMP[i][0]) {
      const t = (c - TEMP[i - 1][0]) / (TEMP[i][0] - TEMP[i - 1][0]);
      return blend(FAM[TEMP[i - 1][1]], FAM[TEMP[i][1]], t);
    }
    return { ...FAM[TEMP.at(-1)[1]] };
  }
  /* The main card is the sky outside: its colour follows the sun's height (deep night blue, violet twilight, a golden
     low sun, soft morning blue, clear noon blue), the weather greys or darkens it, and the temperature tints it:
     the glows warm towards orange on a hot day and cool towards ice on a cold one. */
  const HSKY = {
    night:  { core: "#070a21", mid: "#1d255b", hi: "#616bc1", acc: "#3a2c86" }, // about a fifth less saturated than the other skies: a calm night blue
    dusk:   { core: "#170b40", mid: "#5338c8", hi: "#ff8fc8", acc: "#2a55f0" },
    rose:   { core: "#3a0f45", mid: "#c94a7c", hi: "#ffa070", acc: "#6a3fd8" },
    golden: { core: "#5a2410", mid: "#ee7d2e", hi: "#ffd66e", acc: "#e8508a" },
    soft:   { core: "#2a4a8f", mid: "#6f97e2", hi: "#ffe1b8", acc: "#f0a28a" },
    noon:   { core: "#0a3a8a", mid: "#2f7fe6", hi: "#bfe8ff", acc: "#ffb36a" }
  };
  // golden hour holds while the sun is low (up to 7°), with a rose glow just around sunrise and sunset
  const HSTOPS = [[-12, "night"], [-6, "dusk"], [-1, "rose"], [3, "golden"], [7, "golden"], [16, "soft"], [30, "noon"]];
  // the weather pulls the sky towards plain greys (or white, for snow and fog); the share is how strongly
  const HCOND = {
    partly:  { mid: ["#8a94a8", .2], hi: ["#ffffff", .15] },
    cloudy:  { core: ["#2a2f38", .7], mid: ["#7b828f", .84], hi: ["#cfd3da", .7], acc: ["#8b93a0", .7] },
    fog:     { core: ["#8d939e", .7], mid: ["#c3c8d0", .8], hi: ["#f4f5f7", .75], acc: ["#d4d8de", .65] },
    drizzle: { core: ["#252a33", .68], mid: ["#6b7380", .8], hi: ["#b3b9c3", .62], acc: ["#7a8597", .62] },
    rain:    { core: ["#1c2027", .78], mid: ["#545b67", .88], hi: ["#9aa1ac", .7], acc: ["#646d7c", .7] },
    snow:    { core: ["#b9c6da", .75], mid: ["#e9eef6", .86], hi: ["#ffffff", .86], acc: ["#d6e6ff", .7] },
    sleet:   { core: ["#4a5670", .6], mid: ["#a9b4c6", .72], hi: ["#eef2f8", .7], acc: ["#b9d2ee", .6] },
    // thunder: a dark storm violet with a muted plum corner (not the signal raspberry, which is for "now" and warnings);
    // the flash and the bolts are what say thunder
    thunder: { core: ["#0e0228", .62], mid: ["#2e2a45", .6], hi: ["#9a86d8", .3], acc: ["#4a3570", .75] }
  };
  // how much the temperature may colour each kind of sky: fully on a clear one, barely on a grey or white one
  const HTINT = { clear: 1, partly: .8, cloudy: .35, drizzle: .35, rain: .3, thunder: .25, sleet: .25, fog: .15, snow: .15 };
  function heroPal(altDeg, kind, tC) {
    let p;
    if (altDeg <= HSTOPS[0][0]) p = { ...HSKY.night };
    else if (altDeg >= HSTOPS.at(-1)[0]) p = { ...HSKY.noon };
    else for (let i = 1; i < HSTOPS.length; i++) if (altDeg <= HSTOPS[i][0]) {
      p = blend(HSKY[HSTOPS[i - 1][1]], HSKY[HSTOPS[i][1]], (altDeg - HSTOPS[i - 1][0]) / (HSTOPS[i][0] - HSTOPS[i - 1][0])); break;
    }
    if (HCOND[kind]) {
      p = shift(p, HCOND[kind]);
      // a grey or white sky still darkens as the light goes: dim it towards the night blue after sunset
      if (kind !== "partly") p = blend(p, HSKY.night, clamp((2 - altDeg) / 14, 0, 1) * .62);
    }
    const k = HTINT[kind] ?? 1;
    if (tC != null && !isNaN(tC) && k) { // the temperature's own colour bleeds into the glows, a little into the body
      const t = tempFam(tC);
      p = shift(p, { mid: [t.mid, .12 * k], hi: [t.hi, .22 * k], acc: [t.mid, .42 * k] });
      // real heat from 22° (deep turquoise sky, a blinding sun, an orange glow); real cold below 0° (icy and pale)
      const hot = clamp((tC - 22) / 10, 0, 1) * k, cold = clamp(-tC / 12, 0, 1) * k;
      const lit = clamp((altDeg + 4) / 14, 0, 1); // after dark only the warm glow stays
      if (hot) p = shift(p, { core: ["#06507a", .4 * hot * lit], mid: ["#1f9fd0", .35 * hot * lit], hi: ["#fff0b0", .5 * hot * lit], acc: ["#ff6a1a", .65 * hot] });
      if (cold) p = shift(p, { core: ["#2a4a7a", .3 * cold], mid: ["#9fc9ef", .35 * cold * (.3 + .7 * lit)], hi: ["#ffffff", .4 * cold], acc: ["#bfe8ff", .5 * cold] });
    }
    return p;
  }
  /* Relative brightness (0–1) of a colour: a pale sky (snow, fog) needs dark text on it. */
  const lum = h => { const [r, g, b] = h2r(h).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  function skyPal(altDeg) {
    if (altDeg <= SKY[0][0]) return { ...FAM[SKY[0][1]] };
    for (let i = 1; i < SKY.length; i++) if (altDeg <= SKY[i][0])
      return blend(FAM[SKY[i - 1][1]], FAM[SKY[i][1]], (altDeg - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0]));
    return { ...FAM[SKY.at(-1)[1]] };
  }
  // skips the work when the colours are unchanged (scrubbers call this on every frame; a repaint of a blurred card is costly)
  function paint(el, p) { const key = ROLES.map(k => p[k]).join(); if (el._pal === key) return; el._pal = key; for (const k of ROLES) el.style.setProperty("--" + k, p[k]); }

  window.Palette = { FAM, TEMP, ROLES, SIGNAL, mix, tempFam, skyPal, heroPal, lum, paint };
})();
