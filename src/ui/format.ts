const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "12 min ago", "5 h ago", "3 days ago" — relative to `now`. */
export function ago(t: number, now: number): string {
  const d = now - t;
  if (d < 0) return 'in the future';
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < 2 * DAY) return `${Math.floor(d / HOUR)} h ago`;
  return `${Math.floor(d / DAY)} days ago`;
}

export function utc(t: number, seconds = false): string {
  return new Date(t).toISOString().replace('T', ' ').slice(0, seconds ? 19 : 16) + ' UTC';
}

export function local(t: number): string {
  return new Date(t).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function latLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
}

/** The seismological depth classes. */
export function depthClass(km: number): string {
  if (km < 70) return 'shallow';
  if (km < 300) return 'intermediate';
  return 'deep';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
