# Working on Kwick Weather

Kwick Weather (short name Kwick, formerly Isobar) is Victor's weather app: a vanilla JS PWA, no build step. This file
carries the way of working from session to session and machine to machine; read it, and `RULES.md`, before changing
anything. **Keep this file up to date: whenever you push, first update it with anything new that a next session must
know (decisions, preferences, open choices), and push it along.**

## Where things are

- Live: https://victorvansande.github.io/kwick/ (GitHub Pages, deployed from `main`, root). Repo: victorvansande/kwick
  (renamed from `isobar` on 2026-10-14; the old /isobar/ address no longer exists).
- Files: `app.js` (one IIFE, `renderAll` draws every card), `styles.css`, `index.html`, `palette.js` (every colour),
  `sw.js` (offline; network-first), `manifest.webmanifest`, `assets/` (icons, launch screens, moon map).
- `RULES.md`: the look and feel and the rules (data, words, layout, type, colour, rendering). A reference, not a law
  book: breaking a rule is fine when clearly better, and then the rule is updated. `tests/lint.mjs` checks the
  checkable ones; `tests/smoke.mjs` runs the app in Chromium and WebKit on every push (`.github/workflows/publish.yml`).
- Local preview on Windows: `powershell -ExecutionPolicy Bypass -File serve.ps1`, then http://localhost:5577.
- Internal names that keep "isobar" on purpose: the `isobar:` localStorage keys (renaming them would wipe everyone's
  saved places and settings), the service-worker cache key, the font name "Isobar Digits".

## How Victor likes to work

- **Language:** reply in Dutch, unless Victor writes in English; then English.
- **Design choices as pictures:** for any choice with several directions (a card, chart, icon, animation, layout),
  show 2–4 small visual mockups in the chat to pick from, with one recommendation, before building.
- **Commit after every change; push only when Victor says so** (to save tokens). In each reply, say what is still
  unpushed. A push to `main` goes live after the checks pass.
- **Check every change in the preview** (keep it open and scroll to the changed card), at phone width too (393 px and
  320 px), by day and at night, including the sheets that show the same thing.
- **Correct and scientific:** one source per quantity, cards never contradict each other, only measured data or
  published formulas, and say plainly when something isn't known or isn't forecast.
- **Calm and clean:** subtle, slow animations caused by data; no glow, no clutter; nothing cut off or broken mid-
  phrase; one line per title and subtitle.
- Be honest about what was and wasn't verified, especially on a phone (the preview runs Chrome, not Safari).

## State and open choices (2026-10-14)

- Radar: in and around the Benelux, Buienradar for the whole timeline (2 h measured + 2 h forecast, one source so
  nothing jumps at "now"); elsewhere RainViewer, past 2 h. RainViewer can show night-time ghost echoes; ignoring its
  weakest echoes outside the Benelux was offered, not decided.
- The summary line adds at most one short heads-up (slippery roads, fog, heat, strong sun, deep cold, poor air).
- Sun and moon cards: a calm sky wash (no dark core, no glowing corners), still the two that stand out. Sun times in
  day order on three columns, AM/PM and units small after the number, six times in the grid (fills one row on desktop); one line at the bottom: "Sunshine 8 h 55 min" left,
  "Day −3 min 48 s" (change in day length vs yesterday) right. Moon: the percentage on the tiles' left edge; dates on one line ("Full · Mon" / "26 Oct").
- Day bars (14 days, day look): soft wide translucent capsules, highs in plain ink.
- Larger screens (rule 10a): from 601 px each card scales its readings and pictures by its own width over a phone
  card's 180 px (--k, 1 to 1.35); three columns between 761 and 1000 px. Phones must stay exactly as they are.
- Tall cards: the rain chart sits on its foot, the feels-like scale and UV gauge sit centred between reading and foot.
- Wall view: measures after layout and grows taller (scaling smaller) until no card's content is cut off.
- Scrolling down never gets caught in a card (rule 12a): vertical wheel always scrolls the page; on touch the map
  moves with two fingers.
- Open, not decided: refreshing the 48-hour card (options: day/night band, temperature-coloured curve, rain bars only
  when it rains, or all three; Victor said "leave it for now"); the night arc drawn below the horizon (audit point);
  hourly wind in the 48-hour strip; morning golden hour on the sun card; METAR-based correction of "now" cloud cover;
  hiding olive pollen north of the Alps.
- Places sheet: a "Current location" row under the search field does the same as the dock's location button
  (closes the sheet, then locates).
- Gauges: the UV numerals' bottom lines up with the gauge's bottom (keep it so); the pressure numerals sit a little
  below the dial's centre and shrink on narrow dials.
- Top bar: hidden fully above the screen (with visibility hidden), so nothing peeks out under iOS's status bar.
- Pushing from a cloud session: commits are backed up to the non-live branch `cloud`; `main` only on Victor's word.
- Open: cards sometimes show up empty on the web (Chrome); suspected GPU-memory pressure from every coloured card's
  large blurred, animated layer. Proposed: drop the layer's animation off-screen; not yet confirmed or built.
- Loading: the cards draw as soon as the forecast is in; air quality (air and pollen cards keep their skeleton
  meanwhile) and the four-model spread fill in after. Still open: a first-ever visit waits for the location prompt
  (up to 12 s) before it fetches anything.
- Follow me: on launch and after 10+ min away the app checks your location (only once location was allowed; never
  asks by itself) and moves there when >3 km from the place on screen, to a saved place within 3 km if there is one.
  Not verified on an iPhone: iOS may keep asking for location in the home-screen app.
- "Looks AI-made" (a colleague, 2026-10-14): proposed one calm card colour (colour only on main/sun/moon), dot-matrix
  numerals only on the main card and top bar, raspberry only for "now"/warnings, fewer dot motifs, a warmer font
  last. Mockups shown; Victor: not now. Don't redo unasked.
- Feels-like card: its corner accent shows which way it feels (blue-violet colder, deep red warmer, none when the same),
  clear from 1° and growing to 4° (this card's accent counts for more via `--acc-k`; warmer leans further since the
  card is coral). The other cards' accents are still decorative.
- 48-hour strip: in hours with ≥0.1 mm forecast, drops fall through the empty chance-dots onto the stack (same
  rule as the precipitation card, but a drop every 2–3.2 s and lit a little longer, `hdrip`); hours with only a
  chance stay still. The 14-day strip does the same for days with ≥0.2 mm (rhythm from the
  day's amount over its hours of rain). Days without a chance
  (only mm): rings show the amount (one per 0.5, 1, 2, 5, 10 mm), never read as a chance; chosen option C.
- Hours/days card: an (i) at the end of the scroll dots opens "Chance and amount" (the shared learn sheet, retitled):
  what the chance means (≥0.1 mm, ensemble share, not area or time), the amount (1 mm = 1 l/m²), why both, dots/rings.
- Moon: soft terminator (light fades over the last few degrees of sun height), not a hard clip.
- Saved for later, don't build unasked: a Vestaboard-style split-flap text effect (letters cycling until they land).
