# Isobar Weather

A weather app in a single page: gradient "pigment" cards and clear glass panels, dot-matrix numerals, and animations that react to the weather itself (frost below zero, heat haze, rain, snow, hail, lightning, fog, wind gusts, condensation, smog).

## Run it

Open `index.html` in a browser, or serve the folder so location access works more reliably:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then visit http://localhost:5577.

## Data

- Forecast: [Open-Meteo](https://open-meteo.com/), "best match" model by default (the sharpest local model, handing over to ECMWF). Other models can be picked in settings.
- Air quality and pollen: Copernicus CAMS via Open-Meteo.
- Radar: [RainViewer](https://www.rainviewer.com/), recoloured to the app palette, on [Esri](https://www.esri.com/) map tiles (Esri, HERE, Garmin, © OpenStreetMap).
- Place search: Open-Meteo geocoding. Reverse geocoding: BigDataCloud.
- Moon phase, moonrise and twilight: calculated in the browser (after SunCalc by Vladimir Agafonkin).
- Moon surface: [NASA Scientific Visualization Studio, CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (LRO imagery, public domain), embedded in `assets/moon-map.js`.

## Files

- `index.html`: the app
- `palette.js`: every colour family and the temperature scale
- `assets/moon-map.js`: NASA's lunar surface map, projected onto the moon card
- `color-study.html`: how the palette was derived from the reference boards
- `serve.ps1`: tiny local server for Windows
