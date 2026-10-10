import * as THREE from 'three';
import type { QuakeCatalog } from './catalog';
import { markerPixels } from './color';

/**
 * Screen-space picking: the quake whose marker is under the cursor. When markers
 * overlap, the one whose centre is closest wins; markers count as hit within their own
 * radius plus a few pixels of slack.
 *
 * @param positions scene xyz per quake, as currently drawn
 * @param visibleCount only quakes[0 … visibleCount-1] have happened
 * @param occlude hide quakes behind the globe (off in X-ray mode)
 */
export function pickQuake(
  catalog: QuakeCatalog,
  positions: Float32Array,
  visibleCount: number,
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  viewport: { width: number; height: number },
  occlude: boolean,
): number {
  const v = new THREE.Vector3();
  const cam = camera.position;
  const ndcX = (clientX / viewport.width) * 2 - 1;
  const ndcY = -(clientY / viewport.height) * 2 + 1;
  // Zoom-dependent marker scale, same as the shader's.
  const zoom = markerZoom(cam.length());
  let best = -1;
  let bestScore = Infinity;

  for (let i = 0; i < visibleCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    v.set(x, y, z).project(camera);
    if (v.z > 1) continue;
    const dx = ((v.x - ndcX) * viewport.width) / 2;
    const dy = ((v.y - ndcY) * viewport.height) / 2;
    const d = Math.hypot(dx, dy);
    const reach = (markerPixels(catalog.quakes[i].mag) * zoom) / 2 + 4;
    if (d > reach || d >= bestScore) continue;
    if (occlude && occludedByEarth(cam, x, y, z)) continue;
    best = i;
    bestScore = d;
  }
  return best;
}

/** Markers grow a little as you zoom in, so dense regions open up. */
export function markerZoom(cameraDistance: number): number {
  return THREE.MathUtils.clamp(2.6 / (cameraDistance - 0.6), 0.75, 2.2);
}

/** Does the segment camera→point pass through the globe (radius ~1)? */
function occludedByEarth(c: THREE.Vector3, px: number, py: number, pz: number): boolean {
  const dx = px - c.x, dy = py - c.y, dz = pz - c.z;
  const len = Math.hypot(dx, dy, dz);
  const ux = dx / len, uy = dy / len, uz = dz / len;
  // Closest approach of the ray to the origin.
  const t = -(c.x * ux + c.y * uy + c.z * uz);
  if (t < 0 || t > len) return false;
  const cx = c.x + ux * t, cy = c.y + uy * t, cz = c.z + uz * t;
  return cx * cx + cy * cy + cz * cz < 0.995;
}
