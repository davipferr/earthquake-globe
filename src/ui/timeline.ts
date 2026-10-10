/**
 * Timeline scrubber: a histogram of quakes per time bin, a mark for every M5+ quake,
 * and a draggable playhead.
 *
 * The histogram is rendered once into an offscreen canvas whenever the data or the
 * size changes; each frame only blits it and draws the playhead.
 */

import type { QuakeCatalog } from '../quake/catalog';
import { depthColor } from '../quake/color';

const DAY_MS = 86_400_000;
const BAR_PX = 3;
const PAD_TOP = 14;
const PAD_BOTTOM = 14;

export interface TimelineHandlers {
  /** Called while dragging. `done` is true on release. */
  onScrub(timeMs: number, done: boolean): void;
}

export class Timeline {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cache = document.createElement('canvas');
  private catalog: QuakeCatalog | null = null;
  private from = 0;
  private to = 1;
  private dirty = true;
  private dragging = false;
  private hoverX = -1;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: TimelineHandlers,
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => (this.dirty = true)).observe(canvas);

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.handlers.onScrub(this.timeAt(e.offsetX), false);
    });
    canvas.addEventListener('pointermove', (e) => {
      this.hoverX = e.offsetX;
      if (this.dragging) this.handlers.onScrub(this.timeAt(e.offsetX), false);
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.handlers.onScrub(this.timeAt(e.offsetX), true);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => (this.hoverX = -1));
  }

  get isDragging() {
    return this.dragging;
  }

  setData(catalog: QuakeCatalog | null, from: number, to: number) {
    this.catalog = catalog;
    this.from = from;
    this.to = to;
    this.dirty = true;
  }

  private timeAt(x: number): number {
    const f = Math.min(Math.max(x / this.cssWidth, 0), 1);
    return this.from + f * (this.to - this.from);
  }

  private xAt(t: number): number {
    return ((t - this.from) / (this.to - this.from)) * this.cssWidth;
  }

  private rebuild() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.cssWidth = Math.max(rect.width, 1);
    this.cssHeight = Math.max(rect.height, 1);
    for (const c of [this.canvas, this.cache]) {
      c.width = Math.round(this.cssWidth * this.dpr);
      c.height = Math.round(this.cssHeight * this.dpr);
    }
    const ctx = this.cache.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

    const w = this.cssWidth;
    const plotH = this.cssHeight - PAD_TOP - PAD_BOTTOM;
    const baseY = PAD_TOP + plotH;

    // Day ticks + labels (at UTC midnights).
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    const span = this.to - this.from;
    const labelEvery = span > 20 * DAY_MS ? 5 : span > 3 * DAY_MS ? 1 : 0;
    for (let d = Math.ceil(this.from / DAY_MS) * DAY_MS; d <= this.to; d += DAY_MS) {
      const x = Math.round(this.xAt(d)) + 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, PAD_TOP, 1, plotH);
      const day = new Date(d);
      if (labelEvery === 1 || (labelEvery > 1 && day.getUTCDate() % labelEvery === 0)) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(day.toISOString().slice(5, 10), x + 3, this.cssHeight - 1);
      }
    }
    if (span <= 3 * DAY_MS) {
      // Short windows: hour ticks every 3 h instead.
      for (let h = Math.ceil(this.from / 10_800_000) * 10_800_000; h <= this.to; h += 10_800_000) {
        const x = Math.round(this.xAt(h)) + 0.5;
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(new Date(h).toISOString().slice(11, 16), x + 3, this.cssHeight - 1);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x, PAD_TOP, 1, plotH);
      }
    }

    if (!this.catalog) return;

    // Bars: count per bin, square-root scale so one busy aftershock day doesn't flatten the rest.
    const bins = Math.max(1, Math.floor(w / BAR_PX));
    const { counts, maxMag } = this.catalog.histogram(this.from, this.to, bins);
    const peak = Math.max(1, ...counts);
    for (let b = 0; b < bins; b++) {
      if (!counts[b]) continue;
      const h = Math.max(1.5, Math.sqrt(counts[b] / peak) * plotH);
      const m = maxMag[b];
      ctx.fillStyle = m >= 6 ? 'rgba(255,120,90,0.9)' : m >= 5 ? 'rgba(255,190,110,0.75)' : 'rgba(160,185,220,0.55)';
      ctx.fillRect(b * BAR_PX, baseY - h, BAR_PX - 1, h);
    }

    // A dot above the bars for each M5+, sized by magnitude and coloured by depth.
    for (let i = 0; i < this.catalog.size; i++) {
      const q = this.catalog.quakes[i];
      if (q.mag < 5) continue;
      const x = this.xAt(q.time);
      const [r, g, b] = depthColor(q.depth);
      ctx.fillStyle = `rgb(${r * 255} ${g * 255} ${b * 255})`;
      ctx.beginPath();
      ctx.arc(x, PAD_TOP - 6, 1.2 + (q.mag - 5) * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw(currentMs: number) {
    if (this.dirty) {
      this.rebuild();
      this.dirty = false;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.cache, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const x = this.xAt(currentMs);
    // Dim the future.
    ctx.fillStyle = 'rgba(2,4,10,0.55)';
    ctx.fillRect(x, 0, this.cssWidth - x, this.cssHeight);

    if (this.hoverX >= 0 && !this.dragging) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(Math.round(this.hoverX), PAD_TOP, 1, this.cssHeight - PAD_TOP - PAD_BOTTOM);
    }

    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(Math.round(x) - 1, 0, 2, this.cssHeight - PAD_BOTTOM + 2);
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 6);
    ctx.fill();
  }
}
