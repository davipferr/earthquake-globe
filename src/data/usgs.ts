/**
 * USGS real-time earthquake feeds (GeoJSON summary format).
 * https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 *
 * The feeds are static files that USGS regenerates every minute. They send
 * `Access-Control-Allow-Origin: *`, need no key, and are cached for 60 s, so the
 * browser can fetch them directly from GitHub Pages.
 */

export type FeedMagnitude = 'significant' | '4.5' | '2.5' | '1.0' | 'all';
export type FeedPeriod = 'day' | 'week' | 'month';

export const PERIOD_MS: Record<FeedPeriod, number> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

export interface Quake {
  id: string;
  mag: number;
  magType: string;
  place: string;
  title: string;
  /** Origin time, Unix ms. */
  time: number;
  updated: number;
  lat: number;
  lon: number;
  /** Hypocentre depth in km, positive down. Can be slightly negative (above sea level). */
  depth: number;
  url: string;
  felt: number | null;
  tsunami: boolean;
  /** PAGER alert level: green / yellow / orange / red. */
  alert: string | null;
  status: string;
  sig: number;
  /** "earthquake", "quarry blast", "explosion", "ice quake", … */
  type: string;
}

export interface Feed {
  /** When USGS generated the file, Unix ms. */
  generated: number;
  /** Start of the period the feed covers. */
  start: number;
  /** Sorted by origin time, oldest first. */
  quakes: Quake[];
}

export function feedUrl(mag: FeedMagnitude, period: FeedPeriod): string {
  return `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${mag}_${period}.geojson`;
}

interface GeoJsonFeature {
  id: string;
  properties: Record<string, unknown> | null;
  geometry: { coordinates: number[] } | null;
}

/** Turn a raw feed into clean, time-sorted records. Drops events with no magnitude or location. */
export function parseFeed(json: unknown, period: FeedPeriod): Feed {
  const root = json as { metadata?: { generated?: number }; features?: GeoJsonFeature[] };
  if (!root || !Array.isArray(root.features)) throw new Error('USGS returned something that is not a feed.');
  const generated = Number(root.metadata?.generated) || Date.now();

  const quakes: Quake[] = [];
  for (const f of root.features) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    const mag = p.mag;
    if (typeof mag !== 'number' || !c || c.length < 3 || !c.slice(0, 3).every(Number.isFinite)) continue;
    quakes.push({
      id: String(f.id),
      mag,
      magType: String(p.magType ?? ''),
      place: String(p.place ?? 'Unknown location'),
      title: String(p.title ?? `M ${mag.toFixed(1)}`),
      time: Number(p.time),
      updated: Number(p.updated),
      lon: c[0],
      lat: c[1],
      depth: c[2],
      url: String(p.url ?? ''),
      felt: typeof p.felt === 'number' ? p.felt : null,
      tsunami: p.tsunami === 1,
      alert: typeof p.alert === 'string' ? p.alert : null,
      status: String(p.status ?? ''),
      sig: Number(p.sig) || 0,
      type: String(p.type ?? 'earthquake'),
    });
  }
  quakes.sort((a, b) => a.time - b.time);

  const start = Math.min(generated - PERIOD_MS[period], quakes[0]?.time ?? Infinity);
  return { generated, start, quakes };
}

export async function fetchFeed(mag: FeedMagnitude, period: FeedPeriod, signal?: AbortSignal): Promise<Feed> {
  let res: Response;
  try {
    res = await fetch(feedUrl(mag, period), { signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error("Couldn't reach USGS. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(`USGS answered HTTP ${res.status}.`);
  return parseFeed(await res.json(), period);
}
