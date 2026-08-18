/**
 * Turning imported meshes into something the game can rig.
 *
 * Models in an asset pack arrive in whatever orientation, scale and origin the
 * artist used, and are usually split by material rather than by moving part.
 * These helpers rotate a model onto the engine's convention (muzzle down -Z,
 * up +Y), normalise its length, anchor it where the rig expects, and — since
 * imported guns have no separate magazine — carve one back out of the
 * geometry so the reload animation has a part to move.
 */

import * as THREE from 'three';

/**
 * Collect a model's meshes as geometry in the root's own local space.
 *
 * Deliberately relative to `root` rather than to the world: an exported glTF
 * usually carries a Z-up conversion and a unit-scale factor on its wrapper
 * nodes, and both are irrelevant once the geometry is renormalised below. The
 * transforms *between* parts still matter, so those are baked in.
 *
 * @returns {{geometry: THREE.BufferGeometry, material: THREE.Material}[]}
 */
export function collectParts(root) {
  root.updateWorldMatrix(true, true);
  const toLocal = root.matrixWorld.clone().invert();
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone();
    geometry.applyMatrix4(toLocal.clone().multiply(o.matrixWorld));
    parts.push({ geometry, material: o.material });
  });
  return parts;
}

/** Bounding box over a set of parts. */
export function partsBounds(parts) {
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox);
  }
  return box;
}

/**
 * Rotate, scale and anchor every part of a gun by one shared transform.
 *
 * @param {{geometry: THREE.BufferGeometry}[]} parts
 * @param {object} opts
 * @param {THREE.Vector3[]} [opts.basis] where the model's X/Y/Z axes should end up
 * @param {number} opts.length metres, along Z once oriented
 * @param {number} opts.muzzleZ where the muzzle end is anchored
 * @param {number} [opts.topY] put the top of the gun (the sight line) here
 * @param {number} [opts.barrelY] …or put the barrel axis here instead
 * @returns {THREE.Matrix4} the transform that was applied
 */
export function anchorGunParts(parts, opts) {
  const applied = new THREE.Matrix4();

  if (opts.basis) {
    const [x, y, z] = opts.basis;
    const rot = new THREE.Matrix4().makeBasis(x, y, z);
    for (const p of parts) p.geometry.applyMatrix4(rot);
    applied.premultiply(rot);
  }

  const scale = opts.length / partsBounds(parts).getSize(new THREE.Vector3()).z;
  const scaleM = new THREE.Matrix4().makeScale(scale, scale, scale);
  for (const p of parts) p.geometry.applyMatrix4(scaleM);
  applied.premultiply(scaleM);

  const box = partsBounds(parts);
  const dy = opts.barrelY != null
    ? opts.barrelY - barrelAxisY(parts, box.min.z)
    : (opts.topY != null ? opts.topY : 0) - box.max.y;
  const move = new THREE.Matrix4().makeTranslation(
    -(box.min.x + box.max.x) / 2, dy, opts.muzzleZ - box.min.z
  );
  for (const p of parts) {
    p.geometry.applyMatrix4(move);
    p.geometry.computeBoundingBox();
    p.geometry.computeVertexNormals();
  }
  applied.premultiply(move);
  return applied;
}

/** Mid-height of the vertices in the first few cm of the barrel. */
function barrelAxisY(parts, minZ) {
  let lo = Infinity, hi = -Infinity;
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > minZ + 0.04) continue;
      const y = pos.getY(i);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return Number.isFinite(lo) ? (lo + hi) / 2 : 0;
}

/**
 * Imported materials often need taming: Sketchfab's FBX pipeline wires the base
 * colour map into the emissive slot at full strength (rendering the model flat
 * and self-lit), and hand-authored blacks are frequently so dark they read as a
 * silhouette under any lighting.
 *
 * @param {THREE.Material} source
 * @param {{minLuma?: number, metalness?: number, roughness?: number}} [opts]
 */
export function prepareGunMaterial(source, opts = {}) {
  const mat = source.clone();
  mat.emissive = new THREE.Color(0x000000);
  mat.emissiveMap = null;
  mat.emissiveIntensity = 0;
  mat.side = THREE.FrontSide;
  if (mat.metalness != null) mat.metalness = opts.metalness != null ? opts.metalness : 0.25;
  if (mat.roughness != null) mat.roughness = opts.roughness != null ? opts.roughness : 0.62;

  // lift near-black base colours to something that still shows form in shade
  const minLuma = opts.minLuma != null ? opts.minLuma : 0;
  if (minLuma > 0 && mat.color) {
    const hsl = { h: 0, s: 0, l: 0 };
    mat.color.getHSL(hsl);
    if (hsl.l < minLuma) mat.color.setHSL(hsl.h, hsl.s, minLuma);
  }

  mat.needsUpdate = true;
  return mat;
}

/**
 * Split every triangle whose centroid falls inside `magBox` out of each part,
 * so the magazine can be animated independently of the receiver. Parts that
 * contribute nothing to the magazine are returned as body-only.
 *
 * @param {{geometry: THREE.BufferGeometry, material: THREE.Material}[]} parts
 * @param {{min:number[], max:number[]}} magBox in the anchored gun's own space
 * @returns {{body: object[], mag: object[]}}
 */
export function splitMagazine(parts, magBox) {
  if (!magBox) return { body: parts, mag: [] };

  const box = new THREE.Box3(
    new THREE.Vector3(...magBox.min),
    new THREE.Vector3(...magBox.max)
  );
  const body = [];
  const mag = [];

  for (const part of parts) {
    const inside = selectTriangles(part.geometry, (centroid) => box.containsPoint(centroid));
    if (inside.selected.length < 24 || inside.rest.length < 24) {
      // this part is all-or-nothing rather than genuinely divided
      (inside.rest.length < 24 && inside.selected.length >= 24 ? mag : body).push(part);
      continue;
    }
    body.push({ geometry: rebuild(part.geometry, inside.rest), material: part.material });
    mag.push({ geometry: rebuild(part.geometry, inside.selected), material: part.material });
  }

  return { body, mag };
}

/**
 * Partition a geometry's triangles by a predicate on their centroid.
 * @returns {{selected: number[], rest: number[]}} index arrays
 */
export function selectTriangles(geom, predicate) {
  const pos = geom.getAttribute('position');
  const index = geom.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const at = (i) => (index ? index.getX(i) : i);

  const selected = [];
  const rest = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = at(t * 3), i1 = at(t * 3 + 1), i2 = at(t * 3 + 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    a.add(b).add(c).multiplyScalar(1 / 3);
    (predicate(a) ? selected : rest).push(i0, i1, i2);
  }
  return { selected, rest };
}

/** A geometry sharing `geom`'s vertex buffer but only the given triangles. */
export function rebuild(geom, indices) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'uv', 'normal']) {
    const attr = geom.getAttribute(name);
    if (attr) g.setAttribute(name, attr.clone());
  }
  g.setIndex(indices);
  g.computeBoundingBox();
  return g;
}
