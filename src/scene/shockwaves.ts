/**
 * Expanding rings on the surface when a quake "happens" during playback.
 *
 * A fixed pool of instances, reused round-robin. Spawning a ring writes four numbers
 * into one instance slot; from then on the shader animates it from a single
 * real-time uniform, so 200 live rings cost the CPU nothing.
 *
 * Each instance is a subdivided square. The vertex shader lays it out in the plane
 * tangent to the globe at the epicentre and then pushes every vertex back onto the
 * sphere, so even a large ring hugs the curvature instead of floating above it.
 */

import * as THREE from 'three';

const vertex = /* glsl */ `
  attribute vec3 iCenter;   // unit vector to the epicentre
  attribute vec3 iColor;
  attribute float iBirth;   // real seconds
  attribute float iMag;

  uniform float uNow;       // real seconds

  varying vec2 vUv;
  varying float vProgress;
  varying vec3 vColor;
  varying float vStrength;

  const float QUAD = 1.15; // quad half-size, relative to the ring's final radius

  void main() {
    float duration = 1.6 + 0.35 * iMag;
    float p = (uNow - iBirth) / duration;
    if (p < 0.0 || p > 1.0 || iBirth < 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vec3 n = normalize(iCenter);
    vec3 helper = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t1 = normalize(cross(helper, n));
    vec3 t2 = cross(n, t1);

    // Final ring radius in scene units (Earth radius = 1). An M2.5 reaches ~80 km,
    // an M7 ~700 km. Pure presentation — it is not a seismic wave model.
    float radius = min(0.012 * pow(1.55, iMag - 2.0), 0.3);
    vec3 offset = (position.x * t1 + position.y * t2) * radius * QUAD;
    vec3 world = normalize(n + offset) * 1.003;

    vUv = position.xy * QUAD;
    vProgress = p;
    vColor = iColor;
    vStrength = clamp(0.35 + 0.13 * iMag, 0.4, 1.3);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`;

const fragment = /* glsl */ `
  varying vec2 vUv;
  varying float vProgress;
  varying vec3 vColor;
  varying float vStrength;

  float band(float r, float at, float width) {
    return 1.0 - smoothstep(0.0, width, abs(r - at));
  }

  void main() {
    float r = length(vUv);
    float p = vProgress;
    float easeOut = 1.0 - pow(1.0 - p, 3.0);

    // A leading wavefront and a fainter echo behind it.
    float front = band(r, easeOut, 0.05 + 0.08 * p);
    float echoP = clamp((p - 0.18) / 0.82, 0.0, 1.0);
    float echo = band(r, (1.0 - pow(1.0 - echoP, 3.0)) * 0.75, 0.04 + 0.06 * echoP) * 0.5 * step(0.001, echoP);
    // Brief flash at the epicentre.
    float flash = (1.0 - smoothstep(0.0, 0.18, r)) * (1.0 - smoothstep(0.0, 0.2, p));

    float a = (front + echo) * pow(1.0 - p, 1.4) + flash;
    if (a < 0.003) discard;
    vec3 c = mix(vColor, vec3(1.0), 0.35) * a * vStrength;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Shockwaves {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly birth: THREE.InstancedBufferAttribute;
  private readonly mag: THREE.InstancedBufferAttribute;
  private next = 0;

  constructor(private readonly capacity = 256) {
    const plane = new THREE.PlaneGeometry(2, 2, 24, 24);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.instanceCount = capacity;

    this.center = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.birth = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(-1), 1);
    this.mag = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.center, this.color, this.birth, this.mag]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iCenter', this.center);
    g.setAttribute('iColor', this.color);
    g.setAttribute('iBirth', this.birth);
    g.setAttribute('iMag', this.mag);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uNow: { value: 0 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Start a ring now. When the pool is full the oldest ring is recycled. */
  spawn(x: number, y: number, z: number, rgb: ArrayLike<number>, magnitude: number, nowSeconds: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.center.setXYZ(i, x, y, z);
    this.color.setXYZ(i, rgb[0], rgb[1], rgb[2]);
    this.birth.setX(i, nowSeconds);
    this.mag.setX(i, magnitude);
    for (const a of [this.center, this.color, this.birth, this.mag]) a.needsUpdate = true;
  }

  clear() {
    (this.birth.array as Float32Array).fill(-1);
    this.birth.needsUpdate = true;
  }

  update(nowSeconds: number) {
    this.material.uniforms.uNow.value = nowSeconds;
  }
}
