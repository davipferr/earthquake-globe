/**
 * Plate boundaries as line segments just above the surface. Subduction zones, where
 * one plate dives under another (and where the deep quakes are), get a stronger colour.
 */

import * as THREE from 'three';
import type { PlateBoundary } from '../data/plates';

const DEG = Math.PI / 180;
const RADIUS = 1.0012;
/** Split segments longer than this, so straight chords don't cut through the globe. */
const MAX_STEP = 1.5 * DEG;

function toUnit(lonDeg: number, latDeg: number): THREE.Vector3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  // Same axis convention as ecefToScene: scene = (x, z, −y).
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

export function createPlateLines(boundaries: PlateBoundary[]): THREE.LineSegments {
  const positions: number[] = [];
  const colors: number[] = [];
  const ridge = new THREE.Color(0xffd34d).multiplyScalar(0.55);
  const trench = new THREE.Color(0xff7a3d).multiplyScalar(0.95);

  for (const b of boundaries) {
    const c = b.subduction ? trench : ridge;
    for (let i = 2; i < b.coords.length; i += 2) {
      const a = toUnit(b.coords[i - 2], b.coords[i - 1]);
      const z = toUnit(b.coords[i], b.coords[i + 1]);
      const steps = Math.max(1, Math.ceil(a.angleTo(z) / MAX_STEP));
      let prev = a;
      for (let s = 1; s <= steps; s++) {
        // Spherical interpolation along the great circle.
        const next = s === steps ? z : a.clone().lerp(z, s / steps).normalize();
        positions.push(prev.x * RADIUS, prev.y * RADIUS, prev.z * RADIUS, next.x * RADIUS, next.y * RADIUS, next.z * RADIUS);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
        prev = next;
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const lines = new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }),
  );
  // After the globe, which is in the transparent pass too.
  lines.renderOrder = 3;
  return lines;
}
