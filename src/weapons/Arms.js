/**
 * First-person arms built from an imported model.
 *
 * The source model is a mirrored pair of arms welded into one mesh per
 * material and carries no skeleton, so there are no joints to pose. What it
 * does have is a clean plane of symmetry: splitting its triangles by which
 * side of x = 0 they sit on yields two independent arms, and each can then be
 * placed on the weapon by itself — one hand on the grip, the other on the
 * handguard.
 *
 * Rather than hand-authoring a rotation for each arm, the fit is derived from
 * the geometry: the hand is the skin-coloured part, the shoulder is the point
 * furthest from it, and the arm is rotated so that hand→shoulder runs along a
 * given aim direction. That leaves one free parameter per arm — the roll about
 * that axis, which sets where the palm faces.
 *
 * Each arm is rigid. That is the normal arrangement for a viewmodel: the arms
 * are children of the weapon group, so every pose, recoil impulse and sway the
 * gun gets, the arms get too, and the shoulder ends run off the bottom of the
 * screen where the lack of an elbow joint cannot show.
 */

import * as THREE from 'three';
import { collectParts, selectTriangles, rebuild } from './GunGeometry.js';

/**
 * @param {THREE.Object3D} model the arms glTF scene
 * @param {object} fit see ARMS_MODEL.fit in Loadout.js
 * @returns {{left: THREE.Group, right: THREE.Group, dispose: Function}|null}
 */
export function buildArms(model, fit) {
  const root = (fit.node && model.getObjectByName(fit.node)) || model;
  const parts = collectParts(root);
  if (!parts.length) return null;

  // the lighter material is skin, i.e. the hands; the darker one is sleeve
  const skinPart = parts.reduce((a, b) => (luma(b.material) > luma(a.material) ? b : a));
  const materials = new Map();

  const arms = {};
  for (const side of ['left', 'right']) {
    const group = new THREE.Group();
    group.name = `arm-${side}`;
    const keepLeft = side === 'left';
    let handSum = null;
    let handCount = 0;

    for (const part of parts) {
      const { selected, rest } = selectTriangles(part.geometry, (c) => c.x < 0);
      const indices = keepLeft ? selected : rest;
      if (indices.length < 3) continue;
      const geometry = rebuild(part.geometry, indices);
      group.add(new THREE.Mesh(geometry, skinMaterial(part.material, materials)));
      if (part === skinPart) {
        handSum = centroid(geometry, indices);
        handCount = indices.length;
      }
    }
    if (!group.children.length || !handCount) return null;

    orientArm(group, handSum, fit, fit[side]);
    arms[side] = group;
  }

  return {
    left: arms.left,
    right: arms.right,
    dispose() {
      for (const g of [arms.left, arms.right]) {
        g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      }
      materials.forEach((m) => m.dispose());
    }
  };
}

/**
 * Move an arm's hand to the origin, scale it to a real arm's length and rotate
 * it so the limb runs away along `place.aim`, then position it on the weapon.
 */
function orientArm(group, hand, fit, place) {
  // shoulder: the vertex furthest from the hand — the far end of the limb
  const shoulder = furthestFrom(group, hand);
  const span = shoulder.distanceTo(hand);
  const scale = (fit.armLength || 0.6) / span;

  for (const mesh of group.children) {
    mesh.geometry.translate(-hand.x, -hand.y, -hand.z);
    mesh.geometry.scale(scale, scale, scale);
    mesh.geometry.computeBoundingBox();
  }

  // rotate the limb axis onto the aim direction, then roll about it
  const from = shoulder.clone().sub(hand).normalize();
  const to = new THREE.Vector3().fromArray(place.aim).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(from, to);
  if (place.roll) q.premultiply(new THREE.Quaternion().setFromAxisAngle(to, place.roll));

  group.quaternion.copy(q);
  group.position.fromArray(place.position);
  if (place.scale) group.scale.setScalar(place.scale);
}

function centroid(geometry, indices) {
  const pos = geometry.getAttribute('position');
  const seen = new Set();
  const sum = new THREE.Vector3();
  for (const i of indices) {
    if (seen.has(i)) continue;
    seen.add(i);
    sum.x += pos.getX(i); sum.y += pos.getY(i); sum.z += pos.getZ(i);
  }
  return sum.multiplyScalar(1 / seen.size);
}

/**
 * The vertex furthest from `point`, considering only vertices this arm's index
 * actually references — the split halves share one vertex buffer, so scanning
 * it whole would find a point on the opposite arm.
 */
function furthestFrom(group, point) {
  const best = new THREE.Vector3();
  let bestD = -1;
  const v = new THREE.Vector3();
  for (const mesh of group.children) {
    const pos = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    for (let k = 0; k < index.count; k++) {
      v.fromBufferAttribute(pos, index.getX(k));
      const d = v.distanceToSquared(point);
      if (d > bestD) { bestD = d; best.copy(v); }
    }
  }
  return best;
}

function luma(material) {
  if (!material || !material.color) return 0;
  const c = material.color;
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Imported arm materials, tamed the same way weapon materials are. */
function skinMaterial(source, cache) {
  if (cache.has(source)) return cache.get(source);
  const mat = source.clone();
  mat.emissive = new THREE.Color(0x000000);
  mat.emissiveMap = null;
  mat.emissiveIntensity = 0;
  mat.side = THREE.FrontSide;
  if (mat.metalness != null) mat.metalness = 0.02;
  if (mat.roughness != null) mat.roughness = 0.92;
  // sleeves this dark read as a hole in the screen; lift them to cloth black
  if (mat.color) {
    const hsl = { h: 0, s: 0, l: 0 };
    mat.color.getHSL(hsl);
    if (hsl.l < 0.1) mat.color.setHSL(hsl.h, hsl.s, 0.1);
  }
  mat.needsUpdate = true;
  cache.set(source, mat);
  return mat;
}
