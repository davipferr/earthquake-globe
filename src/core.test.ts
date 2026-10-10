import { describe, expect, it } from 'vitest';
import { parseFeed, PERIOD_MS } from './data/usgs';
import { QuakeCatalog, SURFACE_LIFT } from './quake/catalog';
import { depthColor, markerPixels } from './quake/color';
import { WGS84_A, WGS84_B } from './coords/transforms';
import { ago, depthClass } from './ui/format';

const HOUR = 3_600_000;
const GENERATED = Date.UTC(2026, 9, 10, 12);

function feature(id: string, mag: number | null, lon: number, lat: number, depth: number, time: number) {
  return {
    type: 'Feature',
    id,
    properties: { mag, place: `place ${id}`, time, updated: time, url: `https://x/${id}`, tsunami: 0, status: 'reviewed', type: 'earthquake', magType: 'mww', sig: 10, felt: null, alert: null, title: `M ${mag} - place ${id}` },
    geometry: { type: 'Point', coordinates: [lon, lat, depth] },
  };
}

const raw = {
  metadata: { generated: GENERATED },
  features: [
    // USGS lists newest first; the parser must sort.
    feature('c', 6.1, 142.0, 38.0, 30, GENERATED - 1 * HOUR),
    feature('b', 2.5, 0, 90, 600, GENERATED - 5 * HOUR),
    feature('a', 4.0, 0, 0, 10, GENERATED - 10 * HOUR),
    feature('nomag', null, 10, 10, 10, GENERATED - 2 * HOUR),
    { type: 'Feature', id: 'nogeom', properties: { mag: 3, time: GENERATED }, geometry: null },
  ],
};

describe('USGS feed parsing', () => {
  const feed = parseFeed(raw, 'day');

  it('drops events without magnitude or location and sorts oldest first', () => {
    expect(feed.quakes.map((q) => q.id)).toEqual(['a', 'b', 'c']);
  });

  it('reads GeoJSON coordinates as lon, lat, depth', () => {
    const c = feed.quakes[2];
    expect([c.lon, c.lat, c.depth]).toEqual([142, 38, 30]);
    expect(c.tsunami).toBe(false);
    expect(c.felt).toBeNull();
  });

  it('covers the whole period before generation time', () => {
    expect(feed.start).toBe(GENERATED - PERIOD_MS.day);
  });

  it('rejects things that are not feeds', () => {
    expect(() => parseFeed({ hello: 1 }, 'day')).toThrow();
  });
});

describe('QuakeCatalog', () => {
  const cat = new QuakeCatalog(parseFeed(raw, 'day'));

  it('counts quakes that have happened by time t (binary search)', () => {
    expect(cat.countAt(GENERATED - 24 * HOUR)).toBe(0);
    expect(cat.countAt(GENERATED - 10 * HOUR)).toBe(1); // inclusive
    expect(cat.countAt(GENERATED - 3 * HOUR)).toBe(2);
    expect(cat.countAt(GENERATED)).toBe(3);
  });

  it('places epicentres on the ellipsoid', () => {
    const out = new Float32Array(3);
    // (0°, 0°) → scene +x at the equatorial radius, plus the surface lift.
    cat.position(0, 0, 1, out);
    expect(out[0]).toBeCloseTo(1 + SURFACE_LIFT, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    // North pole → scene +y at the polar radius.
    cat.position(1, 0, 1, out);
    expect(out[1]).toBeCloseTo(WGS84_B / WGS84_A + SURFACE_LIFT, 6);
  });

  it('pushes hypocentres down along the normal by depth × exaggeration', () => {
    const out = new Float32Array(3);
    cat.position(1, 1, 1, out); // 600 km under the North Pole
    expect(out[1]).toBeCloseTo((WGS84_B - 600) / WGS84_A, 5);
    cat.position(1, 1, 2, out);
    expect(out[1]).toBeCloseTo((WGS84_B - 1200) / WGS84_A, 5);
  });

  it('bins the histogram over a time range', () => {
    const { counts, maxMag } = cat.histogram(GENERATED - 12 * HOUR, GENERATED, 4); // 3 h bins
    expect(Array.from(counts)).toEqual([1, 0, 1, 1]);
    expect(maxMag[3]).toBeCloseTo(6.1);
  });

  it('lists the largest first', () => {
    expect(cat.largest(2).map((i) => cat.quakes[i].id)).toEqual(['c', 'a']);
  });

  it('finds quakes by id', () => {
    expect(cat.indexOf('b')).toBe(1);
    expect(cat.indexOf('zzz')).toBe(-1);
  });
});

describe('presentation helpers', () => {
  it('colours depth by the shallow / intermediate / deep classes', () => {
    expect(depthColor(-3)).toEqual(depthColor(0));
    expect(depthColor(5000)).toEqual(depthColor(700));
    // Midway between two stops is the average of their colours.
    const mid = depthColor(52.5);
    const [a, b] = [depthColor(35), depthColor(70)];
    mid.forEach((c, k) => expect(c).toBeCloseTo((a[k] + b[k]) / 2, 6));
    expect([depthClass(10), depthClass(150), depthClass(550)]).toEqual(['shallow', 'intermediate', 'deep']);
  });

  it('grows markers with magnitude', () => {
    expect(markerPixels(7)).toBeGreaterThan(markerPixels(5));
    expect(markerPixels(-1)).toBe(markerPixels(0));
  });

  it('formats relative times', () => {
    const now = GENERATED;
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * HOUR, now)).toBe('3 h ago');
    expect(ago(now - 72 * HOUR, now)).toBe('3 days ago');
  });
});
