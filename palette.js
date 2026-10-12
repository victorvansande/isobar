/* Isobar palette — every colour in the app comes from here.
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
  /* Weather keeps the temperature hue on the rim and changes the core. */
  const COND = {
    cloudy:  { core: ["#0e0c22", .45], mid: ["#5546b8", .24], hi: ["#d6d0f5", .25], acc: ["#5a5fb0", .25] },
    fog:     { core: ["#1d1828", .55], mid: ["#7d7398", .48], hi: ["#efe7f7", .5], acc: ["#a99cc4", .4] },
    rain:    { core: ["#06083a", .6], mid: ["#3a2cf0", .42], hi: ["#86a8ff", .4], acc: ["#00a8ff", .35] },
    drizzle: { core: ["#06083a", .5], mid: ["#3a2cf0", .32], hi: ["#86a8ff", .3], acc: ["#00a8ff", .3] },
    snow:    { core: ["#0a1650", .5], mid: ["#5d7cff", .35], hi: ["#ffffff", .6], acc: ["#9fe8ff", .4] },
    sleet:   { core: ["#0a1650", .5], mid: ["#4a5cf0", .4], hi: ["#dfe8ff", .5], acc: ["#9fe8ff", .4] },
    thunder: { core: ["#0e0228", .6], mid: ["#5b17d6", .5], hi: ["#ff5fd0", .35], acc: [SIGNAL, .85] },
    partly:  { hi: ["#ffffff", .12] }
  };
  const NIGHT = { core: ["#03030f", .55], mid: ["#191a66", .42], hi: ["#7a7fe0", .35], acc: ["#3b2a9a", .3] };
  function weatherPal(tC, kind, isDay = true) {
    let p = tempFam(tC);
    if (COND[kind]) p = shift(p, COND[kind]);
    if (!isDay) p = shift(p, NIGHT);
    return p;
  }
  /* The main card is the sky outside: its colour follows the sun's height (deep night blue, violet twilight, a golden
     low sun, soft morning blue, clear noon blue), the weather greys or darkens it, and the temperature tints it:
     the glows warm towards orange on a hot day and cool towards ice on a cold one. */
  const HSKY = {
    night:  { core: "#060a26", mid: "#1b2468", hi: "#5d6ad6", acc: "#3b2a9a" },
    dusk:   { core: "#170b40", mid: "#5338c8", hi: "#ff8fc8", acc: "#2a55f0" },
    golden: { core: "#2f0f45", mid: "#c2436a", hi: "#ffb35a", acc: "#6a3fd8" },
    soft:   { core: "#2a3d8a", mid: "#6f8fe0", hi: "#ffd1a8", acc: "#e98aa6" },
    noon:   { core: "#0a3a8a", mid: "#2f7fe6", hi: "#bfe8ff", acc: "#ffb36a" }
  };
  const HSTOPS = [[-12, "night"], [-5, "dusk"], [1, "golden"], [12, "soft"], [30, "noon"]];
  const HCOND = {
    partly:  { mid: ["#7c8aa8", .14], hi: ["#ffffff", .12] },
    cloudy:  { core: ["#1c2638", .5], mid: ["#6a7690", .58], hi: ["#c6cfdc", .5], acc: ["#7a8ab0", .45] },
    fog:     { core: ["#363c4c", .55], mid: ["#9aa3b5", .62], hi: ["#eef1f6", .6], acc: ["#b0b6c8", .5] },
    drizzle: { core: ["#18202f", .5], mid: ["#5e6c86", .55], hi: ["#b0bdd0", .45], acc: ["#7896d6", .45] },
    rain:    { core: ["#121a2a", .6], mid: ["#56657e", .66], hi: ["#a9b7cc", .5], acc: ["#6f8fd0", .5] },
    snow:    { core: ["#22325a", .45], mid: ["#8fa3c8", .55], hi: ["#ffffff", .6], acc: ["#bfe0ff", .5] },
    sleet:   { core: ["#1c2a4a", .5], mid: ["#7486a8", .58], hi: ["#e0e8f4", .55], acc: ["#9fc8f0", .45] },
    thunder: { core: ["#0e0228", .62], mid: ["#3b2f6e", .55], hi: ["#ff5fd0", .3], acc: [SIGNAL, .7] }
  };
  function heroPal(altDeg, kind, tC) {
    let p;
    if (altDeg <= HSTOPS[0][0]) p = { ...HSKY.night };
    else if (altDeg >= HSTOPS.at(-1)[0]) p = { ...HSKY.noon };
    else for (let i = 1; i < HSTOPS.length; i++) if (altDeg <= HSTOPS[i][0]) {
      p = blend(HSKY[HSTOPS[i - 1][1]], HSKY[HSTOPS[i][1]], (altDeg - HSTOPS[i - 1][0]) / (HSTOPS[i][0] - HSTOPS[i - 1][0])); break;
    }
    if (HCOND[kind]) p = shift(p, HCOND[kind]);
    if (tC != null && !isNaN(tC)) { // the temperature's own colour bleeds into the glows, a little into the body
      const t = tempFam(tC);
      p = shift(p, { mid: [t.mid, .12], hi: [t.hi, .22], acc: [t.mid, .42] });
    }
    return p;
  }
  function skyPal(altDeg) {
    if (altDeg <= SKY[0][0]) return { ...FAM[SKY[0][1]] };
    for (let i = 1; i < SKY.length; i++) if (altDeg <= SKY[i][0])
      return blend(FAM[SKY[i - 1][1]], FAM[SKY[i][1]], (altDeg - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0]));
    return { ...FAM[SKY.at(-1)[1]] };
  }
  // skips the work when the colours are unchanged (scrubbers call this on every frame; a repaint of a blurred card is costly)
  function paint(el, p) { const key = ROLES.map(k => p[k]).join(); if (el._pal === key) return; el._pal = key; for (const k of ROLES) el.style.setProperty("--" + k, p[k]); }

  window.Palette = { FAM, TEMP, ROLES, SIGNAL, mix, tempFam, weatherPal, skyPal, heroPal, paint };
})();
