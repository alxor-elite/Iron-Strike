/**
 * The viewmodel's gloved hands.
 *
 * Shared by every firearm so a weapon built from an imported mesh gets the same
 * hands as the procedural one — only their placement on the grip and handguard
 * changes from gun to gun.
 */

import * as THREE from 'three';
import { boxGeom, cylGeom, mergeParts } from '../world/Geo.js';

export function handMaterials() {
  return {
    glove: new THREE.MeshStandardMaterial({ color: 0x2f2a24, metalness: 0.05, roughness: 0.95 }),
    gloveDark: new THREE.MeshStandardMaterial({ color: 0x201d19, metalness: 0.05, roughness: 0.95 })
  };
}

/** Trigger hand: fist wrapped around a pistol grip, forearm trailing back. */
export function buildRightHand(mats) {
  const hand = new THREE.Group();
  const parts = [
    { geom: boxGeom(0.055, 0.085, 0.07, 6), pos: [0, 0, 0] },
    { geom: boxGeom(0.06, 0.022, 0.04, 8), pos: [0.005, 0.036, -0.03], rot: [0.4, 0, 0] },   // knuckles
    { geom: boxGeom(0.03, 0.05, 0.03, 8), pos: [-0.02, 0.03, -0.035], rot: [0.6, 0.2, 0] }   // thumb
  ];
  hand.add(new THREE.Mesh(mergeParts(parts), mats.glove));
  const forearm = new THREE.Mesh(cylGeom(0.042, 0.05, 0.3, 8), mats.gloveDark);
  forearm.rotation.set(Math.PI / 2 - 0.5, 0, 0.12);
  forearm.position.set(0.02, -0.06, 0.16);
  hand.add(forearm);
  return hand;
}

/** Support hand: flatter grip over the handguard. */
export function buildLeftHand(mats) {
  const hand = new THREE.Group();
  const parts = [
    { geom: boxGeom(0.062, 0.07, 0.09, 6), pos: [0, 0, 0] },
    { geom: boxGeom(0.068, 0.024, 0.075, 8), pos: [0, 0.034, 0.004] },
    { geom: boxGeom(0.026, 0.05, 0.035, 8), pos: [-0.03, -0.01, -0.04], rot: [0.5, 0, 0.3] }
  ];
  hand.add(new THREE.Mesh(mergeParts(parts), mats.glove));
  const forearm = new THREE.Mesh(cylGeom(0.044, 0.052, 0.34, 8), mats.gloveDark);
  forearm.rotation.set(Math.PI / 2 - 0.85, 0, -0.35);
  forearm.position.set(-0.075, -0.11, 0.02);
  hand.add(forearm);
  return hand;
}
