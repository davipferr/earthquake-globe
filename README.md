# Earthquake Globe

Live earthquakes from the **USGS** on a 3D globe, with **TypeScript + Vite + Three.js** and no other
runtime dependencies. Quakes appear at their epicentre or, in X-ray mode, at their real depth inside
a translucent Earth. Each one sends out a shockwave when the timeline plays past it.

```bash
npm install
npm run textures   # downloads NASA Blue Marble + Black Marble into public/textures/
npm run dev
```

`npm test` runs the unit tests. `npm run build` type-checks and builds to `dist/`.

## Features

- **Live data.** The selected USGS feed is fetched on load and every 60 s. New quakes get a ring and a toast.
- **Timeline.** A histogram of quakes per time bin, with a dot for every M5+, coloured by depth. Drag
  it to scrub. **Replay period** plays the whole window in about 30 s. **Live** returns to now.
  Space pauses.
- **X-ray mode.** The crust becomes translucent, the outer core appears, and markers ease down to
  their hypocentres. Depth can be exaggerated up to ×5. The selected quake gets a plumb line from
  its epicentre.
- **Plate boundaries** from the PB2002 model, with subduction zones highlighted. Most deep (purple
  and blue) quakes sit just behind them.
- **Day/night terminator**, which follows the playback time.

## How it works

| Piece | File | Notes |
|---|---|---|
| USGS feed | [src/data/usgs.ts](src/data/usgs.ts) | Parses GeoJSON, drops events with no magnitude or location, and sorts by time. |
| Catalog | [src/quake/catalog.ts](src/quake/catalog.ts) | Time-sorted arrays, so "what has happened by time t" is a binary search. Also builds the ellipsoid epicentres and normals, histogram, and largest list. |
| Quake markers | [src/scene/quakes.ts](src/scene/quakes.ts) | One `THREE.Points` draw call. Visibility, fading, depth blend and size are all computed in the vertex shader from uniforms, so playback costs no per-quake CPU work. Times are stored as seconds since the window start, because Float32 can't hold Unix ms. |
| Shockwaves | [src/scene/shockwaves.ts](src/scene/shockwaves.ts) | A pool of 256 instanced quads, recycled round-robin. The vertex shader wraps each quad onto the sphere, and the fragment shader draws an eased wavefront, an echo and a flash. |
| Globe | [src/scene/earth.ts](src/scene/earth.ts) | From the satellite tracker, plus X-ray mode: a fresnel-alpha crust that stops writing depth, a core-mantle boundary shell, and an atmosphere that discards fragments behind the planet. |
| Plates | [src/scene/plates.ts](src/scene/plates.ts), [scripts/build-plates.mjs](scripts/build-plates.mjs) | PB2002 boundaries, pre-converted to a 90 KB JSON file. Long segments are split along great circles so they don't cut through the globe. |
| Timeline | [src/ui/timeline.ts](src/ui/timeline.ts) | Canvas histogram, cached offscreen and redrawn only when the data or size changes. |
| Picking | [src/quake/pick.ts](src/quake/pick.ts) | Screen-space nearest marker, with occlusion by the globe except in X-ray mode. |
| Coordinates, Sun | [src/coords/](src/coords/) | Shared with the satellite tracker (WGS-84, GMST, solar position). |

Two pairs of functions must stay in sync, and the comments in each point to the other:

- `QuakeCatalog.position()` and the vertex shader in `scene/quakes.ts`
- `markerPixels()` and the same shader's point size

## Data

- **Earthquakes:** [USGS real-time GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php),
  e.g. `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson`. No key is needed,
  they send `Access-Control-Allow-Origin: *`, and they regenerate every minute. "All, past 30 days" is
  about 7 MB; everything else is under 1.5 MB.
- **Plate boundaries:** Bird, P. (2003), *An updated digital model of plate boundaries*, G³ 4(3),
  via [fraxen/tectonicplates](https://github.com/fraxen/tectonicplates) (ODC-BY 1.0).
- **Imagery:** NASA Blue Marble Next Generation and Black Marble 2016 (public domain).

## Deploying to GitHub Pages

[.github/workflows/ci.yml](.github/workflows/ci.yml) tests, builds and deploys on every push to
`main`. In the repo settings, set **Pages → Source** to **GitHub Actions**.
