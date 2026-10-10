/**
 * Depth colour scale. Seismologists split quakes into shallow (< 70 km), intermediate
 * (70–300 km) and deep (300–700 km); the stops put a visible hue change at each boundary.
 */

type Rgb = readonly [number, number, number];

export const DEPTH_STOPS: readonly (readonly [depthKm: number, rgb: Rgb])[] = [
  [0, [255, 230, 90]],
  [35, [255, 150, 50]],
  [70, [255, 70, 70]],
  [150, [230, 70, 170]],
  [300, [150, 90, 255]],
  [700, [70, 140, 255]],
];

const unit = (c: Rgb): [number, number, number] => [c[0] / 255, c[1] / 255, c[2] / 255];

/** Linear interpolation between stops, clamped. Returns rgb in 0–1. */
export function depthColor(depthKm: number): [number, number, number] {
  const s = DEPTH_STOPS;
  if (depthKm <= s[0][0]) return unit(s[0][1]);
  for (let i = 1; i < s.length; i++) {
    const [d1, c1] = s[i];
    if (depthKm <= d1) {
      const [d0, c0] = s[i - 1];
      const t = (depthKm - d0) / (d1 - d0);
      return unit([c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]);
    }
  }
  return unit(s[s.length - 1][1]);
}

/** CSS gradient for the legend, with stops placed on the same 0–700 km axis. */
export function depthGradientCss(): string {
  const max = DEPTH_STOPS[DEPTH_STOPS.length - 1][0];
  const stops = DEPTH_STOPS.map(([d, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${((d / max) * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * Marker diameter in CSS pixels. Each magnitude step is ~32× more energy; drawing that
 * literally would make an M7 a continent, so area grows ~2.4× per step instead.
 * Must match the vertex shader in scene/quakes.ts.
 */
export function markerPixels(mag: number): number {
  return 2 + 0.9 * Math.pow(1.55, Math.max(mag, 0));
}
