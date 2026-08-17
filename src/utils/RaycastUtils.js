/**
 * Raycasting helpers: shared Raycaster instances (zero per-frame allocation),
 * line-of-sight tests, and an analytic ray/vertical-capsule test used for AI
 * bullets against the player (the player has no mesh to hit).
 */

import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _hits = [];

_ray.firstHitOnly = true;

/**
 * Sprite.raycast() dereferences raycaster.camera, and the Raycaster ignores
 * object visibility, so providing a camera makes stray sprites harmless.
 */
export function setRaycastCamera(camera) {
  _ray.camera = camera;
}

/**
 * Closest intersection along a ray.
 * @returns {THREE.Intersection|null}
 */
export function raycastFirst(origin, direction, far, objects) {
  _ray.set(origin, direction);
  _ray.near = 0;
  _ray.far = far;
  _hits.length = 0;
  _ray.intersectObjects(objects, true, _hits);
  if (_hits.length === 0) return null;
  // intersectObjects sorts ascending by distance.
  return _hits[0];
}

/** All intersections along a ray (array is reused — consume immediately). */
export function raycastAll(origin, direction, far, objects) {
  _ray.set(origin, direction);
  _ray.near = 0;
  _ray.far = far;
  _hits.length = 0;
  _ray.intersectObjects(objects, true, _hits);
  return _hits;
}

/** Distance to the first solid along a ray, or `far` when nothing is hit. */
export function distanceToSolid(origin, direction, far, solids) {
  const hit = raycastFirst(origin, direction, far, solids);
  return hit ? hit.distance : far;
}

/**
 * Unobstructed line of sight between two points?
 * @param {THREE.Vector3} from
 * @param {THREE.Vector3} to
 * @param {THREE.Object3D[]} solids
 */
export function hasLineOfSight(from, to, solids) {
  _dir.subVectors(to, from);
  const len = _dir.length();
  if (len < 0.0001) return true;
  _dir.multiplyScalar(1 / len);
  const hit = raycastFirst(from, _dir, len - 0.05, solids);
  return hit === null;
}

/**
 * Ray vs. axis-aligned vertical capsule-ish volume (cylinder + flat caps).
 * @returns {number} distance along the ray, or -1 for a miss.
 */
export function rayVsVerticalCylinder(ox, oy, oz, dx, dy, dz, cx, cz, yMin, yMax, radius) {
  const ex = ox - cx;
  const ez = oz - cz;
  const a = dx * dx + dz * dz;
  const r2 = radius * radius;

  if (a < 1e-8) {
    // Perfectly vertical ray.
    if (ex * ex + ez * ez > r2) return -1;
    if (Math.abs(dy) < 1e-8) return -1;
    const t1 = (yMin - oy) / dy;
    const t2 = (yMax - oy) / dy;
    const t = Math.min(t1 < 0 ? Infinity : t1, t2 < 0 ? Infinity : t2);
    return Number.isFinite(t) ? t : -1;
  }

  const b = 2 * (dx * ex + dz * ez);
  const c = ex * ex + ez * ez - r2;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const inv = 0.5 / a;

  for (let i = 0; i < 2; i++) {
    const t = i === 0 ? (-b - sq) * inv : (-b + sq) * inv;
    if (t < 0) continue;
    const y = oy + dy * t;
    if (y >= yMin && y <= yMax) return t;
  }

  // Side surface missed within the height band — try the caps.
  if (Math.abs(dy) > 1e-8) {
    for (let i = 0; i < 2; i++) {
      const t = ((i === 0 ? yMin : yMax) - oy) / dy;
      if (t < 0) continue;
      const px = ex + dx * t;
      const pz = ez + dz * t;
      if (px * px + pz * pz <= r2) return t;
    }
  }
  return -1;
}

/**
 * Shortest distance from a point to a ray, plus the parametric position.
 * Used to decide whether a near-miss shot should play a whizz-by cue.
 */
export function pointRayDistance(px, py, pz, ox, oy, oz, dx, dy, dz) {
  const ex = px - ox, ey = py - oy, ez = pz - oz;
  const t = ex * dx + ey * dy + ez * dz;
  const cx = ex - dx * t, cy = ey - dy * t, cz = ez - dz * t;
  return { t, distance: Math.sqrt(cx * cx + cy * cy + cz * cz) };
}
