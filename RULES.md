# Isobar rules

The rules every change follows, so the app stays one consistent piece of work. `tests/lint.mjs` checks the ones a
machine can check on every push; the rest are for whoever changes the app (Claude included) to keep.

## Data: one truth per quantity

1. **One source per quantity.** Wherever two cards show the same thing, they read the same value from the same
   place:
   - "now" (temperature, feels-like, sky, wind) is the current conditions `X.c`, everywhere: the main card, the top
     bar and the "Now" column of the hours card;
   - rain in the next six hours is `nowcast()`, everywhere: the precipitation card, the summary sentence, the
     main card's "Rain from / Dry from" and the rain on its arc;
   - sunrise and sunset are Open-Meteo's daily values; twilight, golden hour and solar noon are computed with the
     same sun formulas everywhere.
2. **What you see is what is compared.** Logic that compares or labels values (same/colder, the dots on a scale)
   works from the same rounded numbers the card shows, never from hidden decimals.
3. **Say which day.** A time from another day than today carries the day ("Sunrise tomorrow").
4. **Measured, not made up.** Only data from a named source or a published formula; no extrapolation or estimates
   of our own. Every source is credited in About.
5. **Times are the place's own time**, in the clock style chosen in settings.

## Words

6. English, sentence case, no full stop on labels.
7. A card never repeats what it already says: the line under a number adds something new.
8. A subtitle is one short line; the foot of a card is at most one line.
9. Units always follow the settings and are written small after the number.

## Layout

10. **One inset for every card**: `--pad-x` (20 px, 16 px on phones) left and right; the card's own padding top and
    bottom. A card whose content runs edge to edge (the hours strip) gives its header and foot that same inset.
11. **One gap between cards**: 14 px (10 px on phones).
12. **Controls line up with the text**: a switch or button in a card sits on the same inset as the title.
    The main card follows the same inset; corner controls (Back to now, the moon) line up on it.
13a. **Corners**: card 30 px (`--r-card`), surfaces inside cards 16 px, pills fully round; 1–3 px only for hairline
    marks and needles.
13b. **Gaps inside cards** follow a rhythm of 4: 2, 4, 8, 12, 16, 20 px.
13. Cards keep the order fixed in `index.html` and the grid areas in `styles.css`; a new card gets a place in both
    the wide and the phone layout, and in the wall view.

## Type

14. **Three faces, by role**, always through their variables:
    - `--f-display` (Geist): titles, sentences, buttons;
    - `--f-label` (Geist letters with Urbanist figures): small labels, units, times on axes;
    - `--f-num` (Urbanist, light): the big readings.
14a. **Type sizes**: 11, 12, 13, 15, 17, 20, 30 px. The big readings in `--f-num` keep their own sizes; text fields
    stay 16 px (iOS zooms in below that); text inside an SVG drawing scales with it.
15. **Weights**: Geist 400, 500, 600, 700; Urbanist 200–400. Nothing in between (Geist only comes in those steps).
16. Dot-matrix numerals only on the main card, the top bar and the instruments (wind, UV, pressure, air quality),
    and each has a spoken label (`aria-label`).

## Colour and look

17. Every colour of a card comes from `palette.js` or the `:root` tokens; no new hard-coded colours in components.
18. Raspberry (`--signal`) marks "now" and needles, and the one main action; nothing decorative.
19. Day and night are mirrors: day = light tints with dark ink, night = deep tints with light ink; no glow or shine
    on cards in either. Sky cards (main card, sun, moon) show the real sky colour.
20. Shapes follow nature: the sun's arc is a sine of time, the moon has its real phase, rain falls where it is
    forecast.

## Rendering and speed

21. No `mask`, `filter` or `backdrop-filter` on a very wide or scrolling element; put it on a card-sized wrapper.
    Cards contain their own painting.
22. Animations pause when their card is off screen or the tab is hidden, and respect "reduce motion".
23. Canvases are sized to the screen's pixels and redrawn only when something changed.
24. Heavy things (map, moon map, climate history) load only when they are about to be seen.

## Way of working

25. Every change is checked in the preview, then committed and pushed to `main`; the check workflow runs the lint
    and the browser test in Chromium and WebKit before publishing.
26. Design choices are shown as options first; the person who owns the app picks.
