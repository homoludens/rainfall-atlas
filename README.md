# Rainfall Atlas

A self-contained JavaScript web app that animates historical rainfall as 3D bars above administrative regions, with an optional 2D choropleth view. **Every animation frame represents exactly one calendar day's total, in millimetres.** Serbia is selected by default. Choose another country, date range and administrative level, then load its data.

## Run locally

Python 3 is enough to serve the app; there is no build step and no dependency installation.

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000 in a current browser. Use a local web server rather than opening `index.html` directly. The initial Serbia example (1–31 May 2024, 25 districts) includes real, prefetched Open-Meteo ERA5 data and boundaries. Other dates and countries load directly from the public APIs. No API key is needed for the free, non-commercial endpoint.

- **Country:** ISO 3166-1 country and territory list. Availability depends on geoBoundaries coverage.
- **Regions:** ADM1 (states/provinces/districts) or ADM2. These levels have different meanings in different countries.
- **Dates:** up to 366 consecutive days per request, from 1940 until seven days ago.
- **Measure:** liquid rainfall (`rain_sum`) or total precipitation including snow water equivalent (`precipitation_sum`).
- **3D rain bars (default):** one shaded vertical column per region. Height is directly proportional to daily rainfall in millimetres: a 20 mm column is twice as tall as a 10 mm column. The domain is chosen from the largest regional value over the whole selected date range, then stays fixed across all daily frames. A visible mm/day ruler uses the same height-to-pixel conversion as the bars. Zero rainfall is a flat ring; missing data is a crossed ring, with no fabricated height.
- **Camera:** drag to rotate/tilt, use the angle slider, scroll or pinch to zoom, or use the zoom/reset buttons. Focus the canvas and use arrow keys to rotate/tilt, `+`/`-` to zoom, or Home to reset. Orthographic projection ensures equal values have the same apparent vertical height at every map location. Column footprints are adjusted for region spacing; only height and colour encode rainfall. Click a region or column to inspect it.
- **2D map:** switch back to the choropleth view without changing the selected day or weather data.
- **Play / slider:** step through the days without interpolating between them. The last day stops playback; pressing Play restarts it.
- **Speed:** how many daily map frames to display each second. It does not change the daily accumulation period.
- **PNG:** download the current day at 1600×1200, preserving the current 3D/2D mode, camera and label settings.
- **CSV:** all regions and dates, including point counts, variable, model and timezone.
- **Video:** export the daily animation as WebM (or MP4 where supported) at 1600×1200. The browser must support Canvas captureStream and MediaRecorder. The current 3D/2D mode and camera are used for the entire video. Keep the tab in the foreground while exporting. Each distinct weather frame is one day; the encoder may repeat that image for its display duration.
- **Sample points / labels:** display the requested coordinates or region names.

To convert a downloaded WebM file to an MP4 with FFmpeg:

```sh
ffmpeg -i input.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart output.mp4
```

## Deploy on GitHub Pages

The 3D rendering uses Canvas 2D with a 3D orthographic camera and shaded, depth-sorted column geometry. It adds no external runtime dependencies, WebGL requirement, or server. The app is entirely static and works on both a user site and a project site such as `https://USERNAME.github.io/REPOSITORY/`. All application and data URLs are relative. API requests go directly from the visitor's browser to Open-Meteo and geoBoundaries; GitHub only serves the app files.

1. Extract the source ZIP and push the contents of its `rainfall-atlas/` directory to your repository's `main` branch, including `.github/workflows/pages.yml`.
2. In GitHub **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source.
3. Push to `main`, or run **Deploy to GitHub Pages** from the Actions tab.

The included workflow runs the tests, refreshes the downloadable source ZIP, and publishes `dist/`. No secrets, build service, server or API key are required. If your default branch has a different name, update `branches: [main]` in the workflow. The `.nojekyll` file is included for static publishing. External API availability and the free API's non-commercial terms still apply.

Alternatively, copy the **contents** of `dist/` to the root of a `gh-pages` branch and publish that branch's root from GitHub Pages settings. Do not publish only `index.html`; include the modules, assets and data directories.

## How values are calculated

1. Get simplified polygon boundaries from the **geoBoundaries gbOpen API**.
2. Place 1, 3 or 5 deterministic low-discrepancy point samples inside each region, outside polygon holes. Latitude sampling uses sine latitude to approximate uniform sampling by surface area.
3. Request the daily variable for those locations from **Open-Meteo's Historical Weather API**, explicitly choosing **ERA5** and **GMT (UTC)**.
4. Take the arithmetic mean of the sample values for each region and day. A missing value in any sample makes that region/day missing, rather than treating it as zero.
5. Draw all regions with the same fixed threshold colour scale: <0.1, 0.1–1, 1–3, 3–5, 5–10, 10–20, 20–35, 35–50, ≥50 mm/day.

The country summary is an area-weighted mean of the valid regional estimates. It uses spherical polygon areas and reports coverage. Boundaries follow the source data; the bundled Serbia ADM1 source contains 25 districts and does not include Kosovo polygons.

**These are sampled regional estimates, not exact area averages across every ERA5 grid cell.** ERA5 precipitation is approximately 0.25° (~25 km). Several sample locations may resolve to the same weather grid cell, and small regions may have identical values. Use a full area-weighted grid/polygon intersection method for research that requires exact regional aggregation. The sampler does not unwrap antimeridian-crossing polygons; use preprocessing or another boundary dataset for those geometries. The renderer rotates the map to the country centre, but far-flung territories can still make the map less compact.

To control request size, sample counts are automatically reduced for large region sets to target at most 250 locations; at least one location is retained per region. More than 500 regions are rejected, so use ADM1 for large countries. Requests are sequential batches of ten locations, with 429/5xx retries and exponential backoff. Multi-location and long-period requests count as multiple API calls under Open-Meteo's limits. Loaded datasets are cached in browser localStorage where space is available. API failures are shown in the interface; the current dataset remains visible until a replacement loads successfully.

All countries use daily UTC boundaries. These are not local civil days in countries outside UTC. There is no cumulative total between animation frames, no simulated rainfall, and no radar data.

## Files

| File | Purpose |
| --- | --- |
| `dist/index.html` | Interface and controls |
| `dist/style.css` | Responsive layout |
| `dist/app.mjs` | Canvas map, playback, data loading and exports |
| `dist/geometry3d.mjs` | Linear height scaling, orthographic camera and 3D column geometry |
| `dist/renderer3d.mjs` | Shaded 3D map, columns, height ruler and region picking |
| `dist/core.mjs` | Geometry sampling, API client, daily aggregation and CSV |
| `dist/assets/d3.min.js` | Vendored D3 7.9.2 map projections and colour scale |
| `dist/data/` | Country index, Serbia boundaries and real example data |
| `tools/prefetch.mjs` | Optional Node CLI for preparing a country/date dataset |
| `tests/core.test.mjs` | Daily alignment, missing data, geometry and aggregation checks |

## Prefetch data (optional, Node 20+)

Run from the project directory:

```sh
node tools/prefetch.mjs SRB 2024-05-01 2024-05-31 ADM1 3
node tools/prefetch.mjs DEU 2024-06-01 2024-06-30 ADM1 3
```

This saves a complete GeoJSON+rainfall dataset under `dist/data/`. The CLI always fetches liquid rainfall. To change the initial example, change the filename and default form settings in `dist/app.mjs` and `dist/index.html`.

The CLI shares exactly the same sampling and aggregation code as the browser. Proxy-based environments using Node 24 can run `node --use-env-proxy tools/prefetch.mjs ...`.

## Test

```sh
node --test tests/*.test.mjs
```

Checks include real Serbia district polygons, leap days, a year boundary, missing samples, mismatched dates/units, per-day aggregation, area weighting, CSV escaping, fixed scale across days, exact height ratios, zero/missing heights, camera fitting and orthographic height consistency.

## Data attribution and terms

- Open-Meteo Historical Weather API: https://open-meteo.com/en/docs/historical-weather-api
- Open-Meteo data: CC BY 4.0; https://open-meteo.com/en/licence
- Reanalysis: Copernicus Climate Change Service / ECMWF ERA5, provided through Open-Meteo.
- Free API terms: https://open-meteo.com/en/terms (non-commercial use; commercial use needs an appropriate subscription).
- geoBoundaries gbOpen: https://www.geoboundaries.org/api.html. Cite geoBoundaries and the underlying boundary source/licence returned in each country's metadata.
- Bundled Serbia source: OpenStreetMap / Wambacher, Open Database License 1.0; https://www.openstreetmap.org/copyright. Metadata, boundary ID and represented year are retained in the data files.
- D3: Mike Bostock, ISC licence in `dist/assets/D3-LICENSE.txt`.
- Country names/codes: Debian iso-codes ISO 3166-1 data; LGPL-2.1-or-later. See `dist/assets/ISO-CODES-LICENSE.txt`.

Original application code is MIT licensed. Data and vendored dependencies retain their own licences.
