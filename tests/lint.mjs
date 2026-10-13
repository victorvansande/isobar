/* Checks the rules in RULES.md that a machine can check, on every push (see .github/workflows/publish.yml).
   No dependencies: run with `node tests/lint.mjs` from the repository root. Exits with 1 when a rule is broken. */
import { readFileSync } from "node:fs";

const css = readFileSync("styles.css", "utf8"), js = readFileSync("app.js", "utf8"), html = readFileSync("index.html", "utf8");
const problems = [];
const fail = (rule, what) => problems.push(`${rule}: ${what}`);
// CSS without comments, @font-face blocks and url(...) values, so only real declarations and selectors remain
const plain = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@font-face\{[^}]*\}/g, "").replace(/url\([^)]*\)/g, "url()");

// Rule 14: faces only through their variables
const FACE = /var\(--f-(display|label|num)\)/;
for (const m of plain.matchAll(/(?<![-\w])font(-family)?\s*:\s*([^;}]+)/g)) {
  const v = m[2].trim();
  if (v === "inherit") continue;
  if (!FACE.test(v)) fail("faces (14)", `"${m[0].trim()}" doesn't use --f-display, --f-label or --f-num`);
}
for (const m of js.matchAll(/ctx\.font\s*=\s*"([^"]+)"|font-family="([^"]+)"/g)) {
  const v = m[1] || m[2];
  if (!/^(\d{3} \d+px )?('Isobar Digits', )?Geist, sans-serif$/.test(v)) fail("faces (14)", `app.js draws text in "${v}"`);
}

// Rule 15: weights the fonts actually come in
for (const m of plain.matchAll(/font-weight\s*:\s*(\d+)|(?<![-\w])font\s*:\s*(\d{3})\s/g)) {
  const w = +(m[1] || m[2]);
  if (![200, 300, 400, 500, 600, 700].includes(w)) fail("weights (15)", `font weight ${w}`);
}

// Rule 10: one inset for every card
if (!/\.card\{[^}]*--pad-x:20px/.test(css)) fail("inset (10)", ".card no longer sets --pad-x: 20px");
if (!/\.card\{[^}]*--pad-x:16px/.test(css)) fail("inset (10)", "the phone layout no longer sets --pad-x: 16px");
if (!/\.a-hourly \.ch-row\{padding:0 var\(--pad-x\)\}/.test(css)) fail("inset (10)", "the hours card header doesn't use --pad-x");

// Rule 11: one gap between cards
if (!/\.board\{display:grid;gap:14px/.test(css)) fail("gap (11)", "the board gap is no longer 14px");

// Rule 17: no new hard-coded colours outside the tokens (a ceiling that may only go down)
const HEX_CEILING = 44;
const hexes = new Set(plain.match(/#[0-9a-fA-F]{3,6}\b/g) || []);
if (hexes.size > HEX_CEILING) fail("colours (17)", `${hexes.size} different hard-coded colours in styles.css (at most ${HEX_CEILING}); use palette.js or a :root token`);

// Tidiness: no CSS for classes nothing uses
const MADE_IN_CODE = /^(leaflet|awx-)/; // built from parts in app.js, or Leaflet's own
const classes = new Set([...plain.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
for (const c of classes) if (!MADE_IN_CODE.test(c) && !new RegExp(`\\b${c}\\b`).test(js + html)) fail("tidy", `CSS for .${c}, which nothing uses`);

// Tidiness: no top-level functions or constants that nothing calls
for (const m of js.matchAll(/^(?:async )?function (\w+)|^const (\w+) = (?:\(|\w+ =>|async)/gm)) {
  const name = m[1] || m[2], uses = js.match(new RegExp(`\\b${name}\\b`, "g")).length;
  if (uses < 2) fail("tidy", `${name}() in app.js is never used`);
}

if (problems.length) { console.error(`${problems.length} rule(s) broken:\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log("All checkable rules hold.");
