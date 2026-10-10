/**
 * Marker for the selected quake: a pulsing ring that stays a constant size on screen,
 * and — in X-ray mode — a plumb line from the epicentre down to the hypocentre, which
 * makes the depth readable at a glance.
 */

import * as THREE from 'three';

function ringTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

export class SelectionMarker {
  readonly group = new THREE.Group();
  private readonly sprite: THREE.Sprite;
  private readonly line: THREE.Line;

  constructor() {
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color: 0xffffff, depthTest: false, transparent: true }),
    );
    this.sprite.renderOrder = 10;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(
      g,
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.006, gapSize: 0.004, depthTest: false, transparent: true }),
    );
    this.line.renderOrder = 10;
    this.line.frustumCulled = false;

    this.group.add(this.line, this.sprite);
    this.group.visible = false;
  }

  hide() {
    this.group.visible = false;
  }

  /**
   * @param marker where the quake is drawn right now (surface or depth)
   * @param surface the epicentre
   * @param diameterPx size of the quake's own marker, so the ring sits just outside it
   */
  show(marker: THREE.Vector3, surface: THREE.Vector3, depthMix: number, camera: THREE.PerspectiveCamera, pxPerUnit: number, diameterPx: number, nowSeconds: number) {
    this.group.visible = true;
    const pulse = 1 + 0.18 * Math.sin(nowSeconds * 5);
    this.sprite.position.copy(marker);
    this.sprite.scale.setScalar(marker.distanceTo(camera.position) * pxPerUnit * (diameterPx + 14) * pulse);

    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, surface.x, surface.y, surface.z);
    pos.setXYZ(1, marker.x, marker.y, marker.z);
    pos.needsUpdate = true;
    this.line.computeLineDistances();
    this.line.visible = depthMix > 0.05;
    (this.line.material as THREE.LineDashedMaterial).opacity = depthMix;
  }
}
