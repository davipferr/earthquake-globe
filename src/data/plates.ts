/** Plate boundaries, pre-built by scripts/build-plates.mjs from the PB2002 model. */

export interface PlateBoundary {
  name: string;
  subduction: boolean;
  /** Flat [lon, lat, lon, lat, …] in degrees. */
  coords: number[];
}

export async function loadPlates(): Promise<PlateBoundary[]> {
  const res = await fetch('data/plates.json');
  if (!res.ok) throw new Error(`plates.json: HTTP ${res.status}`);
  return ((await res.json()) as { lines: PlateBoundary[] }).lines;
}
