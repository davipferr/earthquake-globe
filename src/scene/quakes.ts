/**
 * Every quake in one draw call: a THREE.Points cloud with a custom shader.
 *
 * Nothing per-quake changes on the CPU while time plays. Each vertex carries its
 * epicentre, normal, depth, magnitude and origin time; the shader decides from a
 * handful of uniforms whether the quake has happened yet, how faded it is, and how
 * far below the surface to draw it.
 */

import * as THREE from 'three';
import { WGS84_A } from '../coords/transforms';
import { SURFACE_LIFT, type QuakeCatalog } from '../quake/catalog';

const vertex = /* glsl */ `
  attribute vec3 aNormal;
  attribute vec3 aColor;
  attribute float aDepth;   // km
  attribute float aMag;
  attribute float aTime;    // seconds since catalog start

  uniform float uTime;      // seconds since catalog start
  uniform float uFade;      // seconds over which old quakes dim
  uniform float uDepthMix;  // 0 = epicentres on the surface, 1 = hypocentres at depth
  uniform float uExag;      // depth exaggeration
  uniform float uSizeScale; // device pixels per CSS pixel, times a zoom factor

  varying vec3 vColor;
  varying float vBright;

  const float EARTH_RADIUS_KM = ${WGS84_A.toFixed(3)};
  const float SURFACE_LIFT = ${SURFACE_LIFT.toFixed(6)};

  void main() {
    if (aTime > uTime) {
      // Not happened yet: park it outside the clip volume.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    // Keep in sync with QuakeCatalog.position().
    float down = uDepthMix * max(aDepth, 0.0) / EARTH_RADIUS_KM * uExag;
    vec3 p = position + aNormal * ((1.0 - uDepthMix) * SURFACE_LIFT - down);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

    float age = uTime - aTime;
    vBright = 1.0 - 0.6 * smoothstep(0.0, uFade, age);
    vColor = aColor;
    // Keep in sync with markerPixels() in quake/color.ts.
    gl_PointSize = (2.0 + 0.9 * pow(1.55, max(aMag, 0.0))) * uSizeScale;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vBright;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    // Dark outline so overlapping markers stay distinguishable.
    float edge = smoothstep(0.72, 0.9, d);
    vec3 c = mix(vColor * vBright, vec3(0.03), edge * 0.85);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

export class QuakeLayer {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private origin = 0;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 1 },
        uDepthMix: { value: 0 },
        uExag: { value: 1 },
        uSizeScale: { value: 1 },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    // Positions move in the shader, so the CPU-side bounding sphere would be wrong.
    this.points.frustumCulled = false;
  }

  setCatalog(cat: QuakeCatalog) {
    const n = cat.size;
    this.origin = cat.start;

    // Draw the biggest first: with depth testing, small quakes land on top of the
    // large discs around them instead of vanishing underneath.
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => cat.quakes[b].mag - cat.quakes[a].mag);
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const depth = new Float32Array(n);
    const mag = new Float32Array(n);
    // Float32 can't hold Unix ms precisely (~2 min steps); seconds since start can (< 0.5 s).
    const time = new Float32Array(n);
    order.forEach((src, dst) => {
      for (let k = 0; k < 3; k++) {
        position[dst * 3 + k] = cat.surface[src * 3 + k];
        normal[dst * 3 + k] = cat.normals[src * 3 + k];
        color[dst * 3 + k] = cat.colors[src * 3 + k];
      }
      depth[dst] = cat.quakes[src].depth;
      mag[dst] = cat.quakes[src].mag;
      time[dst] = (cat.times[src] - this.origin) / 1000;
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aNormal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aTime', new THREE.BufferAttribute(time, 1));
    this.points.geometry.dispose();
    this.points.geometry = g;
  }

  /**
   * @param timeMs current simulation time
   * @param fadeMs how long after a quake it takes to dim to its "old" brightness
   * @param sizeScale device-pixel multiplier for marker sizes
   */
  update(timeMs: number, fadeMs: number, depthMix: number, exaggeration: number, sizeScale: number) {
    const u = this.material.uniforms;
    u.uTime.value = (timeMs - this.origin) / 1000;
    u.uFade.value = Math.max(fadeMs / 1000, 1);
    u.uDepthMix.value = depthMix;
    u.uExag.value = exaggeration;
    u.uSizeScale.value = sizeScale;
  }
}
