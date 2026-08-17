/**
 * Small math helpers used across the game.
 * Everything here is allocation-free so it is safe to call per-frame.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential approach. `speed` ~ how fast (units/sec). */
export function damp(current, target, speed, dt) {
  return lerp(current, target, 1 - Math.exp(-speed * dt));
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

export function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function randSign() {
  return Math.random() < 0.5 ? -1 : 1;
}

/** Approximate standard normal (Irwin–Hall). Great for weapon spread. */
export function gaussian() {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 0.8862;
}

export function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

/** Shortest signed difference between two angles (radians). */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function angleDamp(current, target, speed, dt) {
  return current + angleDelta(current, target) * (1 - Math.exp(-speed * dt));
}

/** Squared horizontal (XZ) distance between two Vector3-likes. */
export function dist2XZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function distXZ(a, b) {
  return Math.sqrt(dist2XZ(a, b));
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
