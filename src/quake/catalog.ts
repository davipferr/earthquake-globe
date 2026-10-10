/**
 * A loaded feed laid out for the GPU and for fast time queries.
 *
 * Quakes are sorted by time, so "everything that has happened by time t" is a prefix
 * of the arrays and one binary search finds it. That drives both the timeline and the
 * shockwave triggers.
 */

import type { Feed, Quake } from '../data/usgs';
import { geodeticToEcef, ecefToScene, WGS84_A } from '../coords/transforms';
import { depthColor } from './color';

const DEG = Math.PI / 180;
/** Lift surface markers just above the globe so they don't z-fight with it. */
export const SURFACE_LIFT = 0.0015;

export class QuakeCatalog {
  readonly quakes: Quake[];
  readonly size: number;
  readonly start: number;
  readonly generated: number;
  /** Origin times, Unix ms, ascending. */
  readonly times: Float64Array;
  /** Epicentre on the WGS-84 ellipsoid, scene units. */
  readonly surface: Float32Array;
  /** Outward ellipsoid normal at the epicentre ("down" is its negative). */
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  private readonly index = new Map<string, number>();

  constructor(feed: Feed) {
    this.quakes = feed.quakes;
    this.size = feed.quakes.length;
    this.start = feed.start;
    this.generated = feed.generated;
    const n = this.size;
    this.times = new Float64Array(n);
    this.surface = new Float32Array(n * 3);
    this.normals = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      const q = this.quakes[i];
      this.index.set(q.id, i);
      this.times[i] = q.time;
      const lat = q.lat * DEG;
      const lon = q.lon * DEG;
      const s = ecefToScene(geodeticToEcef({ lat, lon, alt: 0 }));
      this.surface.set([s.x, s.y, s.z], i * 3);
      // Geodetic normal in ECEF is (cos φ cos λ, cos φ sin λ, sin φ); scene = (x, z, −y).
      this.normals.set([Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)], i * 3);
      this.colors.set(depthColor(q.depth), i * 3);
    }
  }

  indexOf(id: string): number {
    return this.index.get(id) ?? -1;
  }

  /** Number of quakes with time ≤ t, i.e. quakes[0 … result-1] have happened. */
  countAt(t: number): number {
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.times[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Scene position of quake i. `depthMix` blends the epicentre (0) into the hypocentre (1);
   * `exaggeration` stretches depth so a 700 km quake is easier to see under a 6378 km radius.
   * Must match the vertex shader in scene/quakes.ts.
   */
  position(i: number, depthMix: number, exaggeration: number, out: Float32Array, offset = 0): void {
    const depth = Math.max(this.quakes[i].depth, 0) / WGS84_A;
    const along = (1 - depthMix) * SURFACE_LIFT - depthMix * depth * exaggeration;
    for (let k = 0; k < 3; k++) {
      out[offset + k] = this.surface[i * 3 + k] + this.normals[i * 3 + k] * along;
    }
  }

  /** Counts and the largest magnitude per bin, for the timeline histogram. */
  histogram(from: number, to: number, bins: number): { counts: Uint32Array; maxMag: Float32Array } {
    const counts = new Uint32Array(bins);
    const maxMag = new Float32Array(bins).fill(-Infinity);
    const span = to - from;
    if (span <= 0) return { counts, maxMag };
    for (let i = 0; i < this.size; i++) {
      const b = Math.floor(((this.times[i] - from) / span) * bins);
      if (b < 0 || b >= bins) continue;
      counts[b]++;
      if (this.quakes[i].mag > maxMag[b]) maxMag[b] = this.quakes[i].mag;
    }
    return { counts, maxMag };
  }

  /** Indices of the k largest quakes, biggest first (ties: most recent first). */
  largest(k: number): number[] {
    return Array.from({ length: this.size }, (_, i) => i)
      .sort((a, b) => this.quakes[b].mag - this.quakes[a].mag || this.times[b] - this.times[a])
      .slice(0, k);
  }
}
