// Builds public/data/plates.json from Peter Bird's PB2002 plate boundary model
// (Bird 2003, G³ 4(3), doi:10.1029/2001GC000252), via Hugo Ahlenius's GeoJSON conversion
// at github.com/fraxen/tectonicplates (ODC-BY 1.0).
//
// The output is committed, so this only needs re-running if you change the format.
// Coordinates are rounded to 0.01° (~1 km) and flattened, which shrinks 226 KB to ~90 KB.
import { writeFile, mkdir } from 'node:fs/promises';

const URL_PB2002 =
  'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json';

const res = await fetch(URL_PB2002);
if (!res.ok) throw new Error(`${URL_PB2002}: HTTP ${res.status}`);
const geo = await res.json();

const round = (v) => Math.round(v * 100) / 100;
const lines = geo.features.map((f) => ({
  name: f.properties.Name,
  subduction: f.properties.Type === 'subduction',
  // [lon, lat, lon, lat, ...]
  coords: f.geometry.coordinates.flatMap(([lon, lat]) => [round(lon), round(lat)]),
}));

const out = new URL('../public/data/plates.json', import.meta.url);
await mkdir(new URL('.', out), { recursive: true });
await writeFile(out, JSON.stringify({ source: 'PB2002 (Bird 2003)', lines }));
console.log(`✓ plates.json: ${lines.length} boundaries`);
