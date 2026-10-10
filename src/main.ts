import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { createEarth } from './scene/earth';
import { createStars } from './scene/stars';
import { QuakeLayer } from './scene/quakes';
import { Shockwaves } from './scene/shockwaves';
import { createPlateLines } from './scene/plates';
import { SelectionMarker } from './scene/selection';
import { QuakeCatalog } from './quake/catalog';
import { depthColor, depthGradientCss, markerPixels } from './quake/color';
import { markerZoom, pickQuake } from './quake/pick';
import { fetchFeed, type FeedMagnitude, type FeedPeriod } from './data/usgs';
import { loadPlates } from './data/plates';
import { gmst, julianDate } from './coords/time';
import { ecefToScene, temeToEcef } from './coords/transforms';
import { sunDirectionEci } from './coords/sun';
import { Timeline } from './ui/timeline';
import { createToast } from './ui/toast';
import { ago, depthClass, escapeHtml, latLon, local, utc } from './ui/format';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const REFRESH_MS = 60_000;
/** Max rings started in one frame, e.g. when 1 d/s sweeps over an aftershock swarm. */
const MAX_RINGS_PER_FRAME = 40;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const canvas = $<HTMLCanvasElement>('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 2000);
// Start over the Pacific Ring of Fire.
camera.position.set(-2.3, 0.9, 2.4);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.2;
controls.maxDistance = 12;
controls.rotateSpeed = 0.5;

const earth = createEarth(renderer);
const quakes = new QuakeLayer();
const rings = new Shockwaves();
const marker = new SelectionMarker();
scene.add(earth.group, createStars(), quakes.points, rings.mesh, marker.group);

let plates: THREE.LineSegments | null = null;
loadPlates()
  .then((lines) => {
    plates = createPlateLines(lines);
    plates.visible = $<HTMLInputElement>('plates').checked;
    scene.add(plates);
  })
  .catch(() => toast.show('warning', "Couldn't load plate boundaries.", 6000));

earth.texturesLoaded.then((ok) => {
  $('texture-note').hidden = ok;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function pxPerUnit(): number {
  return (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / window.innerHeight;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const toast = createToast($('toast'));
const clock = { simMs: Date.now(), speed: 1, lastReal: performance.now(), prevSimMs: Date.now() };

let catalog: QuakeCatalog | null = null;
/** Scene position of each quake as currently drawn (catalog order), for picking and the marker. */
let positions = new Float32Array(0);
let positionsKey = '';

const view = { xray: false, depthMix: 0, exaggeration: 2, daylight: 0 };
let selected = -1;
let loading = false;
let loadToken = 0;
let lastFetch = 0;

function windowStart(): number {
  return catalog?.start ?? Date.now() - 86_400_000;
}
/** The window always ends at the real "now": live data keeps arriving. */
function windowEnd(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const magSelect = $<HTMLSelectElement>('mag');
const periodSelect = $<HTMLSelectElement>('period');

function saved(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — fine */
  }
}

magSelect.value = saved('mag', '2.5');
periodSelect.value = saved('period', 'week');
if (!magSelect.value) magSelect.value = '2.5';
if (!periodSelect.value) periodSelect.value = 'week';

/**
 * @param background a periodic refresh: keep the clock and view as they are, and
 *   announce any quakes that weren't in the previous download.
 */
async function load(background = false) {
  if (loading) return;
  const token = ++loadToken;
  const mag = magSelect.value as FeedMagnitude;
  const period = periodSelect.value as FeedPeriod;
  const label = `${magSelect.selectedOptions[0].text}, ${periodSelect.selectedOptions[0].text.toLowerCase()}`;
  loading = true;
  if (!background) {
    magSelect.disabled = periodSelect.disabled = true;
    toast.show('loading', `Loading ${label} from USGS…`);
  }

  try {
    const feed = await fetchFeed(mag, period);
    if (token !== loadToken) return;
    lastFetch = Date.now();
    const previous = catalog;
    const selectedId = selected >= 0 && previous ? previous.quakes[selected].id : null;

    catalog = new QuakeCatalog(feed);
    quakes.setCatalog(catalog);
    positionsKey = '';
    timeline.setData(catalog, windowStart(), windowEnd());
    renderLargest();

    if (background && previous) {
      announceNew(previous);
    } else {
      rings.clear();
      goLive();
      toast.hide();
    }
    select(selectedId ? catalog.indexOf(selectedId) : -1);
    save('mag', mag);
    save('period', period);
  } catch (err) {
    if (token !== loadToken) return;
    if (!background || !catalog) toast.show('error', (err as Error).message);
  } finally {
    if (token === loadToken) {
      loading = false;
      magSelect.disabled = periodSelect.disabled = false;
      updateStatus();
    }
  }
}

/** Ring and toast for quakes that appeared since the last download. */
function announceNew(previous: QuakeCatalog) {
  if (!catalog) return;
  const fresh: number[] = [];
  for (let i = 0; i < catalog.size; i++) {
    if (previous.indexOf(catalog.quakes[i].id) < 0) fresh.push(i);
  }
  if (!fresh.length) return;
  const now = performance.now() / 1000;
  for (const i of fresh) if (catalog.times[i] <= clock.simMs) spawnRing(i, now);
  const top = fresh.reduce((a, b) => (catalog!.quakes[b].mag > catalog!.quakes[a].mag ? b : a));
  const q = catalog.quakes[top];
  const what = fresh.length === 1 ? 'New quake' : `${fresh.length} new quakes, largest`;
  toast.show('warning', `${what}: M ${q.mag.toFixed(1)}, ${q.place}`, 8000);
}

magSelect.addEventListener('change', () => load());
periodSelect.addEventListener('change', () => load());

setInterval(() => {
  if (document.visibilityState === 'visible' && Date.now() - lastFetch >= REFRESH_MS) load(true);
}, 5_000);

// ---------------------------------------------------------------------------
// Largest-quakes list
// ---------------------------------------------------------------------------

const largestEl = $<HTMLOListElement>('largest');

function magColor(depth: number): string {
  const [r, g, b] = depthColor(depth);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

function renderLargest() {
  largestEl.innerHTML = '';
  if (!catalog) return;
  for (const i of catalog.largest(8)) {
    const q = catalog.quakes[i];
    const li = document.createElement('li');
    li.dataset.id = q.id;
    li.innerHTML = `<span class="mag" style="--c:${magColor(q.depth)}">${q.mag.toFixed(1)}</span>
      <span class="where">${escapeHtml(q.place)}<small>${utc(q.time)} · ${Math.round(q.depth)} km</small></span>`;
    li.addEventListener('click', () => {
      if (!catalog) return;
      const idx = catalog.indexOf(q.id);
      // If playback hasn't reached it yet, jump there so it's actually on the globe.
      if (catalog.times[idx] > clock.simMs) jumpTo(idx);
      select(idx);
      flyTo(idx);
    });
    largestEl.append(li);
  }
}

function refreshLargestState() {
  if (!catalog) return;
  for (const li of largestEl.children as HTMLCollectionOf<HTMLElement>) {
    const i = catalog.indexOf(li.dataset.id!);
    li.classList.toggle('on', i === selected);
    li.classList.toggle('future', i >= 0 && catalog.times[i] > clock.simMs);
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const infoPanel = $('info');
const fieldsEl = $('q-fields');

function select(index: number) {
  selected = index;
  refreshLargestState();
  if (!catalog || index < 0) {
    infoPanel.hidden = true;
    marker.hide();
    return;
  }
  const q = catalog.quakes[index];
  infoPanel.hidden = false;
  $('q-title').textContent = q.title;

  const badges: string[] = [];
  if (q.alert) badges.push(`<span class="badge ${q.alert}">PAGER ${q.alert}</span>`);
  if (q.tsunami) badges.push(`<span class="badge tsunami">Tsunami info issued</span>`);
  if (q.type !== 'earthquake') badges.push(`<span class="badge">${escapeHtml(q.type)}</span>`);
  badges.push(`<span class="badge">${q.status === 'reviewed' ? 'Reviewed' : 'Automatic'}</span>`);
  $('q-badges').innerHTML = badges.join('');

  const rows: [string, string][] = [
    ['Magnitude', `${q.mag.toFixed(1)} ${q.magType}`],
    ['Depth', `${q.depth.toFixed(1)} km (${depthClass(q.depth)})`],
    ['Local time', local(q.time)],
    ['UTC', utc(q.time, true)],
    ['', ago(q.time, Date.now())],
    ['Location', latLon(q.lat, q.lon)],
    ['Felt reports', q.felt === null ? '—' : q.felt.toLocaleString()],
    ['Significance', String(q.sig)],
  ];
  fieldsEl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  const link = $<HTMLAnchorElement>('q-link');
  link.href = q.url;
  link.hidden = !q.url;
}

$('close-info').addEventListener('click', () => select(-1));
$('q-jump').addEventListener('click', () => {
  if (selected >= 0) jumpTo(selected, 5_000);
});

/** Put the clock just before quake i and pause there, so its shockwave plays. */
function jumpTo(i: number, leadMs = 0) {
  if (!catalog) return;
  clock.simMs = clock.prevSimMs = catalog.times[i] - leadMs;
  setSpeed(leadMs ? 1 : 0);
  if (!leadMs) spawnRing(i, performance.now() / 1000);
}

// ---------------------------------------------------------------------------
// Camera fly-to
// ---------------------------------------------------------------------------

let flight: { from: THREE.Vector3; turn: THREE.Quaternion; d0: number; d1: number; start: number } | null = null;

function flyTo(i: number) {
  if (!catalog) return;
  const target = new THREE.Vector3().fromArray(catalog.surface, i * 3).normalize();
  const from = camera.position.clone().normalize();
  const d0 = camera.position.length();
  flight = {
    from,
    turn: new THREE.Quaternion().setFromUnitVectors(from, target),
    d0,
    d1: Math.min(Math.max(d0, 1.8), 2.6),
    start: performance.now(),
  };
}

function updateFlight(now: number) {
  if (!flight) return;
  const f = Math.min((now - flight.start) / 1400, 1);
  const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2; // easeInOutCubic
  const q = new THREE.Quaternion().slerp(flight.turn, e);
  camera.position.copy(flight.from).applyQuaternion(q).multiplyScalar(flight.d0 + (flight.d1 - flight.d0) * e);
  if (f >= 1) flight = null;
}

// ---------------------------------------------------------------------------
// Picking & hover
// ---------------------------------------------------------------------------

const tooltip = $('tooltip');
let downAt: { x: number; y: number } | null = null;

function pickAt(x: number, y: number): number {
  if (!catalog) return -1;
  return pickQuake(
    catalog,
    positions,
    catalog.countAt(clock.simMs),
    camera,
    x,
    y,
    { width: window.innerWidth, height: window.innerHeight },
    view.depthMix < 0.5,
  );
}

canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  flight = null;
});
canvas.addEventListener('pointerup', (e) => {
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) select(pickAt(e.clientX, e.clientY));
  downAt = null;
});
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  const i = pickAt(e.clientX, e.clientY);
  canvas.classList.toggle('pointer', i >= 0);
  if (i >= 0 && catalog) {
    const q = catalog.quakes[i];
    tooltip.hidden = false;
    tooltip.innerHTML = `<b>M ${q.mag.toFixed(1)}</b> ${escapeHtml(q.place)}<br><small>${ago(q.time, Date.now())} · ${q.depth.toFixed(0)} km deep</small>`;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
  } else {
    tooltip.hidden = true;
  }
});
canvas.addEventListener('pointerleave', () => (tooltip.hidden = true));

// ---------------------------------------------------------------------------
// View options
// ---------------------------------------------------------------------------

const exagInput = $<HTMLInputElement>('exag');
function syncExag() {
  view.exaggeration = Number(exagInput.value);
  $('exag-out').textContent = `×${view.exaggeration}`;
  $('exag-row').classList.toggle('disabled', !view.xray);
}
exagInput.addEventListener('input', syncExag);

$<HTMLInputElement>('xray').addEventListener('change', (e) => {
  view.xray = (e.target as HTMLInputElement).checked;
  syncExag();
});
$<HTMLInputElement>('plates').addEventListener('change', (e) => {
  if (plates) plates.visible = (e.target as HTMLInputElement).checked;
});
$<HTMLInputElement>('daynight').addEventListener('change', (e) => {
  view.daylight = (e.target as HTMLInputElement).checked ? 0 : 1;
  earth.setDaylight(view.daylight);
});
syncExag();

// Panels above the time bar need its height, which changes when its buttons wrap.
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--timebar-h', `${Math.ceil(entry.borderBoxSize[0].blockSize)}px`);
}).observe($('timebar'));

// On phones the controls panel covers the globe; start with only the essentials open.
if (window.matchMedia('(max-width: 760px)').matches) {
  document.querySelectorAll('#controls details').forEach((d, i) => i > 0 && d.removeAttribute('open'));
}

$('depth-bar').style.background = depthGradientCss();
$('size-legend').innerHTML = [3, 4, 5, 6, 7, 8]
  .map((m) => {
    const px = markerPixels(m);
    return `<div><i style="width:${px}px;height:${px}px"></i>M${m}</div>`;
  })
  .join('');

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const speedsEl = $('speeds');
const liveBtn = $('live');
let speedBeforePause = 1;

function setSpeed(speed: number) {
  if (speed === 0 && clock.speed !== 0) speedBeforePause = clock.speed;
  clock.speed = speed;
  speedsEl
    .querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
}

function goLive() {
  clock.simMs = clock.prevSimMs = Date.now();
  setSpeed(1);
}

function isLive(): boolean {
  return clock.speed === 1 && Date.now() - clock.simMs < 5_000;
}

speedsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (btn) setSpeed(Number(btn.dataset.speed));
});
liveBtn.addEventListener('click', goLive);

/** Replay the whole window in about half a minute. */
$('replay').addEventListener('click', () => {
  const span = windowEnd() - windowStart();
  const speeds = [3600, 21600, 86400, 259200];
  const speed = speeds.find((s) => span / s <= 45_000) ?? speeds[speeds.length - 1];
  rings.clear();
  clock.simMs = clock.prevSimMs = windowStart();
  setSpeed(speed);
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, select, button, a')) return;
  e.preventDefault();
  setSpeed(clock.speed === 0 ? speedBeforePause : 0);
});

const timeline = new Timeline($<HTMLCanvasElement>('timeline'), {
  onScrub(t, done) {
    clock.simMs = clock.prevSimMs = Math.min(t, Date.now());
    if (!done) setSpeed(0);
  },
});

function spawnRing(i: number, nowSeconds: number) {
  if (!catalog) return;
  const s = catalog.surface;
  rings.spawn(s[i * 3], s[i * 3 + 1], s[i * 3 + 2], catalog.colors.subarray(i * 3, i * 3 + 3), catalog.quakes[i].mag, nowSeconds);
}

/** Start a ring for every quake the clock passed over since last frame (when playing forward). */
function triggerRings(from: number, to: number, nowSeconds: number) {
  if (!catalog || to <= from || timeline.isDragging) return;
  const a = catalog.countAt(from);
  const b = catalog.countAt(to);
  if (b <= a) return;
  let idx = Array.from({ length: b - a }, (_, k) => a + k);
  if (idx.length > MAX_RINGS_PER_FRAME) {
    idx = idx.sort((x, y) => catalog!.quakes[y].mag - catalog!.quakes[x].mag).slice(0, MAX_RINGS_PER_FRAME);
  }
  for (const i of idx) spawnRing(i, nowSeconds);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const statusEl = $('status');
const clockEl = $('clock');
const shownEl = $('shown');

function updateStatus() {
  if (!catalog || loading) return;
  const n = catalog.size;
  const age = ago(catalog.generated, Date.now());
  statusEl.textContent = `${n.toLocaleString()} ${n === 1 ? 'event' : 'events'} · USGS feed updated ${age}`;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const sunVec = new THREE.Vector3();
const markerPos = new THREE.Vector3();
const surfacePos = new THREE.Vector3();
let lastUi = -Infinity;
let lastTimelineRange = 0;

function frame(now: number) {
  const dt = now - clock.lastReal;
  clock.lastReal = now;
  const nowSeconds = now / 1000;

  // Advance the clock; never past the real now. A fast replay that reaches it turns live.
  clock.simMs += dt * clock.speed;
  if (clock.simMs >= Date.now()) {
    clock.simMs = Date.now();
    if (clock.speed > 1) setSpeed(1);
  }
  triggerRings(clock.prevSimMs, clock.simMs, nowSeconds);
  clock.prevSimMs = clock.simMs;

  const t = clock.simMs;
  const jd = julianDate(t);
  earth.setSunDirection(sunVec.copy(ecefToScene(temeToEcef(sunDirectionEci(jd), gmst(jd)))));

  // Ease between surface and depth view over ~0.6 s.
  const target = view.xray ? 1 : 0;
  view.depthMix += (target - view.depthMix) * Math.min(1, dt / 120);
  if (Math.abs(target - view.depthMix) < 0.002) view.depthMix = target;
  earth.setXray(view.depthMix);

  updateFlight(now);
  controls.update();

  if (catalog) {
    const key = `${view.depthMix}|${view.exaggeration}`;
    if (key !== positionsKey || positions.length !== catalog.size * 3) {
      if (positions.length !== catalog.size * 3) positions = new Float32Array(catalog.size * 3);
      for (let i = 0; i < catalog.size; i++) catalog.position(i, view.depthMix, view.exaggeration, positions, i * 3);
      positionsKey = key;
    }
    const span = windowEnd() - windowStart();
    const zoom = markerZoom(camera.position.length());
    quakes.update(t, span * 0.2, view.depthMix, view.exaggeration, renderer.getPixelRatio() * zoom);

    if (selected >= 0 && catalog.times[selected] <= t) {
      markerPos.fromArray(positions, selected * 3);
      surfacePos.fromArray(catalog.surface, selected * 3);
      const diameter = markerPixels(catalog.quakes[selected].mag) * zoom;
      marker.show(markerPos, surfacePos, view.depthMix, camera, pxPerUnit(), diameter, nowSeconds);
    } else {
      marker.hide();
    }
  }
  rings.update(nowSeconds);
  renderer.render(scene, camera);

  // The window's right edge is "now"; slide it once a minute.
  if (catalog && now - lastTimelineRange > 60_000) {
    lastTimelineRange = now;
    timeline.setData(catalog, windowStart(), windowEnd());
  }
  timeline.draw(t);

  if (now - lastUi > 200) {
    lastUi = now;
    clockEl.textContent = utc(t, true);
    liveBtn.classList.toggle('on', isLive());
    if (catalog) {
      const shown = catalog.countAt(t);
      shownEl.textContent = `${shown.toLocaleString()} of ${catalog.size.toLocaleString()} shown`;
    }
    refreshLargestState();
    updateStatus();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
load();
