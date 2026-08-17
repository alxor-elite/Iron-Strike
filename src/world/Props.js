/**
 * Props: every repeated object in the map. Templates are merged low-poly
 * geometries drawn with InstancedMesh, so ~250 objects cost a handful of draw
 * calls. Placements are validated against the colliders that already exist
 * (structures are built first), so nothing ever intersects a wall.
 */

import * as THREE from 'three';
import { boxGeom, cylGeom, mergeParts, trapezoidPrism, rubbleGeom } from './Geo.js';
import { aoBlobTexture } from './Textures.js';

/* --------------------------------------------------------------- helpers -- */

/** Deterministic PRNG so the map looks identical every load. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

function makeInstanced(map, geom, material, placements, opts = {}) {
  if (placements.length === 0) return null;
  const im = new THREE.InstancedMesh(geom, material, placements.length);
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    _pos.set(p.x, p.y, p.z);
    _quat.setFromAxisAngle(_up, p.rotY || 0);
    if (p.tilt) {
      const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), p.tilt);
      _quat.multiply(q2);
    }
    _scl.set(p.s || 1, p.sy || p.s || 1, p.s || 1);
    _mat4.compose(_pos, _quat, _scl);
    im.setMatrixAt(i, _mat4);
  }
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = opts.castShadow !== false && map.shadows;
  im.receiveShadow = opts.receiveShadow !== false;
  im.frustumCulled = false; // instanced groups are spread across the map
  im.name = opts.name || 'props';
  (opts.decor ? map.decor : map.solids).add(im);
  return im;
}

/* ------------------------------------------------------------- templates -- */

function containerTemplate() {
  const L = 6.1, H = 2.62, W = 2.44;
  const parts = [{ geom: boxGeom(L, H, W, 0.5) }];
  // corner castings
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({ geom: boxGeom(0.2, H + 0.06, 0.2, 1.2), pos: [sx * (L / 2 - 0.1), 0, sz * (W / 2 - 0.1)] });
    }
  }
  // top & bottom rails
  for (const sy of [-1, 1]) {
    parts.push({ geom: boxGeom(L, 0.16, 0.16, 0.8), pos: [0, sy * (H / 2 - 0.02), W / 2 - 0.08] });
    parts.push({ geom: boxGeom(L, 0.16, 0.16, 0.8), pos: [0, sy * (H / 2 - 0.02), -(W / 2 - 0.08)] });
  }
  // door end: two leaves with locking bars
  parts.push({ geom: boxGeom(0.1, H - 0.3, W - 0.28, 1), pos: [L / 2 + 0.04, 0, 0] });
  for (const bz of [-0.75, -0.25, 0.25, 0.75]) {
    parts.push({ geom: cylGeom(0.05, 0.05, H - 0.4, 6), pos: [L / 2 + 0.12, 0, bz] });
  }
  return mergeParts(parts);
}

function crateTemplate(size) {
  const s = size, h = size * 0.92;
  const parts = [{ geom: boxGeom(s, h, s, 1.1) }];
  const t = size * 0.09;
  // corner battens
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({ geom: boxGeom(t, h + 0.01, t, 2), pos: [sx * (s / 2 - t / 2), 0, sz * (s / 2 - t / 2)] });
    }
  }
  // top/bottom frame
  for (const sy of [-1, 1]) {
    parts.push({ geom: boxGeom(s + 0.01, t, t, 2), pos: [0, sy * (h / 2 - t / 2), s / 2 - t / 2] });
    parts.push({ geom: boxGeom(s + 0.01, t, t, 2), pos: [0, sy * (h / 2 - t / 2), -(s / 2 - t / 2)] });
    parts.push({ geom: boxGeom(t, t, s + 0.01, 2), pos: [s / 2 - t / 2, sy * (h / 2 - t / 2), 0] });
    parts.push({ geom: boxGeom(t, t, s + 0.01, 2), pos: [-(s / 2 - t / 2), sy * (h / 2 - t / 2), 0] });
  }
  // diagonal brace on two faces
  for (const sz of [-1, 1]) {
    parts.push({
      geom: boxGeom(s * 1.32, t, t * 0.8, 2),
      pos: [0, 0, sz * (s / 2 - t * 0.4)], rot: [0, 0, 0.62 * sz]
    });
  }
  return mergeParts(parts);
}

function barrelTemplate() {
  const r = 0.42, h = 1.16;
  const parts = [
    { geom: cylGeom(r, r, h, 12) },
    { geom: cylGeom(r + 0.04, r + 0.04, 0.1, 12), pos: [0, h * 0.24, 0] },
    { geom: cylGeom(r + 0.04, r + 0.04, 0.1, 12), pos: [0, -h * 0.24, 0] },
    { geom: cylGeom(r * 0.82, r * 0.82, 0.06, 12), pos: [0, h / 2 + 0.02, 0] },
    { geom: cylGeom(0.08, 0.08, 0.08, 6), pos: [r * 0.45, h / 2 + 0.06, 0] }
  ];
  return mergeParts(parts);
}

function sandbagTemplate() {
  const bag = new THREE.SphereGeometry(0.3, 7, 5);
  const parts = [];
  const rows = 3, per = 5;
  for (let r = 0; r < rows; r++) {
    const y = 0.17 + r * 0.3;
    const off = r % 2 ? 0.18 : 0;
    for (let i = 0; i < per - (r % 2 ? 1 : 0); i++) {
      parts.push({
        geom: bag,
        pos: [-0.72 + off + i * 0.36, y, (i % 2 ? 0.03 : -0.03)],
        rot: [0, (i * 1.3) % 1.5, 0.06 * (i % 2 ? 1 : -1)],
        scale: [1.18, 0.62, 0.9]
      });
    }
  }
  const g = mergeParts(parts);
  bag.dispose();
  return g;
}

function jerseyTemplate() {
  const body = trapezoidPrism(0.92, 0.42, 1.02, 2.6);
  const parts = [
    { geom: body },
    { geom: boxGeom(0.5, 0.1, 2.6, 1), pos: [0, 1.05, 0] },
    { geom: boxGeom(0.12, 0.34, 0.12, 1), pos: [0, 1.2, -1.1] },
    { geom: boxGeom(0.12, 0.34, 0.12, 1), pos: [0, 1.2, 1.1] }
  ];
  const g = mergeParts(parts);
  body.dispose();
  return g;
}

function metalBarrierTemplate() {
  const parts = [];
  for (const sx of [-1.05, 1.05]) {
    parts.push({ geom: cylGeom(0.05, 0.05, 1.05, 6), pos: [sx, 0.52, 0] });
    parts.push({ geom: boxGeom(0.14, 0.06, 0.5, 1), pos: [sx, 0.03, 0] });
  }
  for (const y of [0.28, 0.62, 0.98]) {
    parts.push({ geom: boxGeom(2.2, 0.055, 0.055, 1), pos: [0, y, 0] });
  }
  for (const sx of [-0.35, 0.35]) {
    parts.push({ geom: cylGeom(0.035, 0.035, 0.72, 6), pos: [sx, 0.63, 0] });
  }
  return mergeParts(parts);
}

function palletTemplate() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    parts.push({ geom: boxGeom(1.2, 0.08, 0.14, 2), pos: [0, 0.04, -0.43 + i * 0.43] });
  }
  for (let i = 0; i < 6; i++) {
    parts.push({ geom: boxGeom(0.14, 0.05, 1.0, 2), pos: [-0.53 + i * 0.212, 0.105, 0] });
  }
  return mergeParts(parts);
}

function pipeTemplate(length) {
  const parts = [
    { geom: cylGeom(0.16, 0.16, length, 10), rot: [0, 0, Math.PI / 2] },
    { geom: cylGeom(0.2, 0.2, 0.16, 10), pos: [-length / 2 + 0.1, 0, 0], rot: [0, 0, Math.PI / 2] },
    { geom: cylGeom(0.2, 0.2, 0.16, 10), pos: [length / 2 - 0.1, 0, 0], rot: [0, 0, Math.PI / 2] }
  ];
  return mergeParts(parts);
}

/* ------------------------------------------------------------ placement --- */

const KEEPOUT = [
  // warehouse doorway approaches
  [-7, 7, -20, -12], [-22, -16, -20, -12], [16, 22, -20, -12],
  [0, 12, 12, 20], [-20, -14, 12, 20],
  [-28, -20, -12, -6], [-28, -20, 5, 11], [20, 28, -10, -4], [20, 28, 6, 12],
  // internal stairs and catwalk landings
  [-25, -18, -16, -5], [18, 25, 5, 16],
  // annex doors + stairs
  [-37, -29, -28, -22], [-47, -39, -22, -15], [29, 37, 22, 28], [39, 47, 15, 22],
  [-52, -46, -32, -18], [46, 52, 18, 32],
  // corridor openings
  [-15, -9, -37, -27], [9, 15, -37, -27], [-19, -13, -32, -27], [-3, 3, -32, -27], [13, 19, -32, -27],
  // spawn cores (furnished by hand)
  [-58, -44, -9, 9], [44, 58, -9, 9],
  // dock stairs
  [-16, -6, -24, -20], [4, 12, -24, -20]
];

function inKeepout(x, z) {
  for (let i = 0; i < KEEPOUT.length; i++) {
    const k = KEEPOUT[i];
    if (x > k[0] && x < k[1] && z > k[2] && z < k[3]) return true;
  }
  return false;
}

/**
 * Try to register a prop. Returns the placement object or null when the spot
 * is occupied / inside a keepout.
 */
function tryPlace(map, out, opts) {
  const { x, z, hx, hy, hz } = opts;
  const y = opts.y != null ? opts.y : 0;
  const cy = y + hy;
  if (opts.checkKeepout !== false && inKeepout(x, z)) return null;
  if (map.collision.overlapsBox(x, cy, z, hx, hy, hz, opts.margin != null ? opts.margin : 0.12)) return null;
  if (Math.abs(x) > 58 || Math.abs(z) > 43) return null;

  const p = { x, y: y + (opts.originAtBase ? 0 : hy), z, rotY: opts.rotY || 0, s: opts.s };
  out.push(p);
  if (opts.collide !== false) map.collision.addBox(x, cy, z, hx, hy, hz);
  if (opts.ao !== false) map.aoDecals.push({ x, z, r: Math.max(hx, hz) * 2.6, y: y + 0.025 });
  if (opts.cover) map.coverSpots.push({ x, z, height: y + hy * 2 });
  return p;
}

/* ============================================================ build ======= */

export function buildProps(map) {
  const M = map.mats;
  const rand = mulberry32(20260817);
  map.aoDecals = [];
  map.coverSpots = [];

  /* ------------------------------------------------------- containers ---- */
  const contGeom = containerTemplate();
  const CH = 2.62, CL = 6.1, CW = 2.44;
  const contLists = { A: [], B: [], C: [], D: [] };
  const containerPlacements = [
    // inside the warehouse
    [-8, -11.5, 0, 'A', 0], [-8, -11.5, 0, 'B', 1],
    [4.5, -11.5, 0, 'C', 0],
    [-17.5, 5, 90, 'B', 0],
    [16.5, 4.5, 90, 'A', 0], [16.5, 4.5, 90, 'D', 1],
    [6, 11.5, 0, 'D', 0],
    [-4, 7.5, 0, 'A', 0],
    // west yard
    [-31, 8, 90, 'C', 0], [-31, 8, 90, 'A', 1],
    [-31, -8, 90, 'B', 0],
    [-46, -12, 90, 'D', 0],
    [-52, -22, 0, 'A', 0],
    [-40, 34, 0, 'C', 0], [-30, 40, 0, 'D', 0],
    // east yard
    [31, 8, 90, 'D', 0], [31, 8, 90, 'A', 1],
    [31, -10, 90, 'C', 0],
    [46, -20, 0, 'A', 0],
    [28, -28, 90, 'B', 0],
    [44, 36, 0, 'B', 0], [50, 30, 90, 'C', 0], [52, 20, 0, 'D', 0],
    // south container alley
    [-14, 26, 0, 'D', 0], [-14, 26, 0, 'B', 1],
    [-5, 28, 0, 'A', 0],
    [3, 26, 90, 'B', 0],
    [11, 28.5, 0, 'C', 0],
    [18, -26, 0, 'B', 0]
  ];
  for (const [x, z, deg, color, level] of containerPlacements) {
    const rot = (deg * Math.PI) / 180;
    const alongX = deg === 0;
    const hx = (alongX ? CL : CW) / 2;
    const hz = (alongX ? CW : CL) / 2;
    tryPlace(map, contLists[color], {
      x, z, hx, hy: CH / 2, hz, y: level * (CH + 0.04), rotY: rot,
      cover: true, ao: level === 0, checkKeepout: false, margin: 0.06
    });
  }
  makeInstanced(map, contGeom, M.containerA, contLists.A, { name: 'containerA' });
  makeInstanced(map, contGeom, M.containerB, contLists.B, { name: 'containerB' });
  makeInstanced(map, contGeom, M.containerC, contLists.C, { name: 'containerC' });
  makeInstanced(map, contGeom, M.containerD, contLists.D, { name: 'containerD' });

  /* ----------------------------------------------------------- crates ---- */
  const bigCrate = crateTemplate(1.25);
  const smallCrate = crateTemplate(0.82);
  const bigList = [], smallList = [];
  const crateZones = [
    [-19, 19, -14, 14, 16],   // warehouse floor
    [-11, 9, -21, -17, 5],    // dock
    [-40, -26, -14, 14, 6],   // west yard
    [26, 40, -14, 14, 6],     // east yard
    [-20, 20, -33, -31, 4],   // corridor
    [-45, -34, -29, -21, 4],  // annex A interior
    [34, 45, 21, 29, 4],      // annex B interior
    [-20, 20, 20, 34, 8],     // south open ground
    [-20, 20, -28, -22, 5]
  ];
  for (const [x0, x1, z0, z1, count] of crateZones) {
    for (let i = 0; i < count * 3; i++) {
      if (bigList.length + smallList.length > 78) break;
      const x = x0 + rand() * (x1 - x0);
      const z = z0 + rand() * (z1 - z0);
      const big = rand() < 0.55;
      const s = big ? 1.25 : 0.82;
      const baseY = map.collision.groundHeightAt(x, z, 1.6, s / 2);
      const p = tryPlace(map, big ? bigList : smallList, {
        x, z, hx: s / 2, hy: s * 0.46, hz: s / 2, y: baseY,
        rotY: rand() * Math.PI * 2, cover: big
      });
      // occasional stack
      if (p && big && rand() < 0.32) {
        tryPlace(map, smallList, {
          x: x + (rand() - 0.5) * 0.2, z: z + (rand() - 0.5) * 0.2,
          hx: 0.41, hy: 0.38, hz: 0.41, y: baseY + s * 0.92,
          rotY: rand() * Math.PI * 2, ao: false
        });
      }
    }
  }
  makeInstanced(map, bigCrate, M.wood, bigList, { name: 'crateBig' });
  makeInstanced(map, smallCrate, M.wood, smallList, { name: 'crateSmall' });

  /* ---------------------------------------------------------- barrels ---- */
  const barrelGeom = barrelTemplate();
  const rustBarrels = [], blueBarrels = [];
  const barrelZones = [
    [-19, 19, -14, 14, 10], [-40, -26, -18, 18, 8], [26, 40, -18, 18, 8],
    [-11, 9, -21, -17, 4], [-20, 20, -33, -31, 4], [-20, 20, 20, 34, 8],
    [-45, -34, -29, -21, 3], [34, 45, 21, 29, 3]
  ];
  for (const [x0, x1, z0, z1, count] of barrelZones) {
    for (let i = 0; i < count * 2; i++) {
      const x = x0 + rand() * (x1 - x0);
      const z = z0 + rand() * (z1 - z0);
      const baseY = map.collision.groundHeightAt(x, z, 1.6, 0.42);
      const list = rand() < 0.6 ? rustBarrels : blueBarrels;
      tryPlace(map, list, {
        x, z, hx: 0.44, hy: 0.58, hz: 0.44, y: baseY,
        rotY: rand() * Math.PI * 2
      });
    }
  }
  makeInstanced(map, barrelGeom, M.rust, rustBarrels, { name: 'barrelRust' });
  makeInstanced(map, barrelGeom, M.metal, blueBarrels, { name: 'barrelMetal' });

  /* --------------------------------------------------------- sandbags ---- */
  const sandGeom = sandbagTemplate();
  const sandList = [];
  const sandSpots = [
    [-47, 3, 0], [-47, -3, 0], [-44, 7, 30], [-44, -7, -30],
    [47, 3, 0], [47, -3, 0], [44, 7, -30], [44, -7, 30],
    [-2, -18.5, 0], [7, -18.5, 0], [-9, -18.5, 0],
    [-21, 22, 90], [21, -22, 90], [0, 33, 0], [-16, -31, 0], [16, -31, 0],
    [-13, 0, 90], [13, 0, 90], [0, 13, 0], [0, -13, 0]
  ];
  for (const [x, z, deg] of sandSpots) {
    const baseY = map.collision.groundHeightAt(x, z, 2.0, 0.9);
    tryPlace(map, sandList, {
      x, z, hx: deg === 0 ? 1.0 : 0.4, hy: 0.48, hz: deg === 0 ? 0.4 : 1.0,
      y: baseY, rotY: (deg * Math.PI) / 180, originAtBase: true,
      cover: true, checkKeepout: false, margin: 0.05
    });
  }
  makeInstanced(map, sandGeom, M.sandbag, sandList, { name: 'sandbags' });

  /* -------------------------------------------------- concrete barriers -- */
  const jersey = jerseyTemplate();
  const jerseyList = [];
  const jerseySpots = [
    [-36, 22, 0], [-33, 24.5, 0], [-30, 27, 0],
    [36, -22, 0], [33, -24.5, 0], [30, -27, 0],
    [-20, -20, 90], [-24, -22, 90], [20, 20, 90], [24, 22, 90],
    [-8, 34, 0], [-4, 35.5, 0], [0, 37, 0],
    [-42, 12, 90], [-42, 16, 90], [42, -12, 90], [42, -16, 90],
    [8, -34, 0], [4, -35.5, 0], [12, -32.5, 0],
    [-55, 14, 0], [55, -14, 0], [-55, -14, 0], [55, 14, 0]
  ];
  for (const [x, z, deg] of jerseySpots) {
    const alongZ = deg === 90;
    tryPlace(map, jerseyList, {
      x, z, hx: alongZ ? 1.3 : 0.5, hy: 0.55, hz: alongZ ? 0.5 : 1.3,
      rotY: alongZ ? Math.PI / 2 : 0, originAtBase: true, cover: true, checkKeepout: false
    });
  }
  makeInstanced(map, jersey, M.concrete, jerseyList, { name: 'jersey' });

  /* ---------------------------------------------------- metal barriers -- */
  const mb = metalBarrierTemplate();
  const mbList = [];
  const mbSpots = [
    [-16, 18, 0], [-12, 19, 0], [12, -18, 0], [16, -19, 0],
    [-26, -18, 90], [26, 18, 90], [-2, 20, 0], [2, -20, 0],
    [-38, 20, 0], [38, -20, 0], [-19, -35.5, 0], [19, -35.5, 0]
  ];
  for (const [x, z, deg] of mbSpots) {
    const alongZ = deg === 90;
    tryPlace(map, mbList, {
      x, z, hx: alongZ ? 0.3 : 1.15, hy: 0.53, hz: alongZ ? 1.15 : 0.3,
      rotY: alongZ ? Math.PI / 2 : 0, originAtBase: true, ao: false, checkKeepout: false
    });
  }
  makeInstanced(map, mb, M.metal, mbList, { name: 'metalBarrier' });

  /* ---------------------------------------------------------- pallets ---- */
  const pallet = palletTemplate();
  const palletList = [];
  for (let i = 0; i < 42; i++) {
    const x = -46 + rand() * 92;
    const z = -40 + rand() * 80;
    if (inKeepout(x, z)) continue;
    const baseY = map.collision.groundHeightAt(x, z, 1.4, 0.6);
    if (baseY > 1.5) continue;
    if (map.collision.overlapsBox(x, baseY + 0.1, z, 0.65, 0.1, 0.55, 0.1)) continue;
    palletList.push({ x, y: baseY, z, rotY: rand() * Math.PI * 2 });
  }
  makeInstanced(map, pallet, M.wood, palletList, { name: 'pallets', decor: true });

  /* ----------------------------------------------------------- rubble ---- */
  const rubble = rubbleGeom(0.34, 0);
  const rubbleList = [];
  for (let i = 0; i < 90; i++) {
    const x = -57 + rand() * 114;
    const z = -42 + rand() * 84;
    const baseY = map.collision.groundHeightAt(x, z, 1.2, 0.3);
    if (baseY > 0.1) continue;
    rubbleList.push({ x, y: baseY + 0.06, z, rotY: rand() * 6.283, s: 0.5 + rand() * 0.9 });
  }
  makeInstanced(map, rubble, M.concreteDark, rubbleList, { name: 'rubble', decor: true, castShadow: false });

  /* ------------------------------------------------------------ pipes ---- */
  const pipe = pipeTemplate(14);
  const pipeList = [
    { x: 0, y: 8.2, z: -15.2, rotY: 0 }, { x: 14, y: 8.2, z: -15.2, rotY: 0 },
    { x: -14, y: 8.2, z: -15.2, rotY: 0 },
    { x: 0, y: 7.6, z: 15.2, rotY: 0 }, { x: -14, y: 7.6, z: 15.2, rotY: 0 },
    { x: -23.2, y: 7.4, z: 0, rotY: Math.PI / 2 }, { x: 23.2, y: 7.4, z: 0, rotY: Math.PI / 2 },
    { x: -23.2, y: 7.4, z: -14, rotY: Math.PI / 2 }, { x: 23.2, y: 7.4, z: 14, rotY: Math.PI / 2 }
  ];
  makeInstanced(map, pipe, M.rust, pipeList, { name: 'pipes', decor: true, castShadow: false });

  /* ------------------------------------------------------------ fences --- */
  buildFences(map);

  /* ------------------------------------------------------ street lights -- */
  buildStreetLights(map);

  /* ------------------------------------------------------- team bases ---- */
  buildBase(map, -51, 0, 'A');
  buildBase(map, 51, 0, 'B');

  /* -------------------------------------------------------- AO decals ---- */
  buildAODecals(map);

  return map;
}

/* --------------------------------------------------------------- fences --- */

function buildFences(map) {
  const panelH = 2.4;
  const panelW = 3.0;
  const runs = [
    { axis: 'x', at: -40, from: -20, to: -2 },
    { axis: 'x', at: 40, from: 2, to: 20 },
    { axis: 'z', at: -20, from: 30, to: 42 },
    { axis: 'z', at: 20, from: -42, to: -30 },
    { axis: 'x', at: 12, from: 34, to: 52 },
    { axis: 'x', at: -12, from: -52, to: -34 }
  ];
  const panels = [];
  const posts = [];
  for (const r of runs) {
    const len = r.to - r.from;
    const n = Math.max(1, Math.round(len / panelW));
    for (let i = 0; i < n; i++) {
      const c = r.from + (len * (i + 0.5)) / n;
      const x = r.axis === 'x' ? c : r.at;
      const z = r.axis === 'x' ? r.at : c;
      if (map.collision.overlapsBox(x, panelH / 2, z, r.axis === 'x' ? len / n / 2 : 0.1, panelH / 2, r.axis === 'x' ? 0.1 : len / n / 2, 0.1)) continue;
      panels.push({ x, y: panelH / 2, z, rotY: r.axis === 'x' ? 0 : Math.PI / 2, s: 1, w: len / n });
      // chain-link stops movement but you can see and shoot straight through it
      map.collision.addBox(
        x, panelH / 2, z,
        r.axis === 'x' ? len / n / 2 : 0.12, panelH / 2, r.axis === 'x' ? 0.12 : len / n / 2
      ).opaque = false;
    }
    for (let i = 0; i <= n; i++) {
      const c = r.from + (len * i) / n;
      posts.push({
        x: r.axis === 'x' ? c : r.at,
        y: panelH / 2 + 0.15,
        z: r.axis === 'x' ? r.at : c
      });
    }
  }
  // one plane geometry, scaled per instance via the width baked into s
  const geo = new THREE.PlaneGeometry(panelW, panelH);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.2, uv.getY(i) * 1.8);
  const im = new THREE.InstancedMesh(geo, map.mats.fence, panels.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  panels.forEach((p, i) => {
    q.setFromAxisAngle(up, p.rotY);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.w / panelW, 1, 1));
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  map.decor.add(im);

  const postGeo = cylGeom(0.06, 0.07, panelH + 0.3, 6);
  const pim = new THREE.InstancedMesh(postGeo, map.mats.metal, posts.length);
  posts.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    pim.setMatrixAt(i, m);
  });
  pim.instanceMatrix.needsUpdate = true;
  pim.frustumCulled = false;
  pim.castShadow = map.shadows;
  map.decor.add(pim);
}

/* -------------------------------------------------------- street lights --- */

function buildStreetLights(map) {
  const spots = [
    [-44, 22], [-44, -22], [44, 22], [44, -22],
    [-16, 38], [16, -38], [0, 22], [0, -25], [-30, 0], [30, 0]
  ];
  const poleGeo = cylGeom(0.15, 0.2, 6.6, 8);
  const armGeo = boxGeom(1.5, 0.14, 0.14, 1);
  const headGeo = boxGeom(0.9, 0.22, 0.5, 1);
  const lensGeo = boxGeom(0.76, 0.06, 0.4, 1);
  for (const [x, z] of spots) {
    if (map.collision.overlapsBox(x, 3.3, z, 0.3, 3.3, 0.3, 0.2)) continue;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, map.mats.metalDark);
    pole.position.y = 3.3;
    pole.castShadow = map.shadows;
    g.add(pole);
    const dir = x > 0 ? -1 : 1;
    const arm = new THREE.Mesh(armGeo, map.mats.metalDark);
    arm.position.set(dir * 0.75, 6.5, 0);
    g.add(arm);
    const head = new THREE.Mesh(headGeo, map.mats.metalDark);
    head.position.set(dir * 1.4, 6.35, 0);
    g.add(head);
    const lens = new THREE.Mesh(lensGeo, map.mats.lampGlass);
    lens.position.set(dir * 1.4, 6.22, 0);
    g.add(lens);
    const sprite = new THREE.Sprite(map.mats.glow);
    sprite.scale.set(3.2, 3.2, 1);
    sprite.position.set(dir * 1.4, 6.1, 0);
    g.add(sprite);
    g.position.set(x, 0, z);
    map.decor.add(g);
    map.collision.addBox(x, 3.3, z, 0.22, 3.3, 0.22);
  }
}

/* ----------------------------------------------------------- team bases --- */

function buildBase(map, bx, bz, team) {
  const M = map.mats;
  const color = team === 'A' ? 0x2f7fa8 : 0xa8402f;
  const g = new THREE.Group();

  // painted deployment pad
  const pad = new THREE.Mesh(
    new THREE.RingGeometry(5.7, 6.05, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(bx, 0.04, bz);
  map.decor.add(pad);

  // canopy: 4 posts + sloped roof
  const dirIn = bx < 0 ? 1 : -1;
  for (const [ox, oz] of [[-2.6, -3.2], [-2.6, 3.2], [2.6, -3.2], [2.6, 3.2]]) {
    const post = new THREE.Mesh(cylGeom(0.11, 0.13, 3.2, 6), M.metal);
    post.position.set(bx + ox, 1.6, bz + oz);
    g.add(post);
    map.collision.addBox(bx + ox, 1.6, bz + oz, 0.14, 1.6, 0.14);
  }
  const roof = new THREE.Mesh(boxGeom(6.4, 0.16, 7.4, 0.5), M.panelWarm);
  roof.position.set(bx, 3.3, bz);
  roof.rotation.z = dirIn * 0.06;
  roof.castShadow = map.shadows;
  g.add(roof);
  map.collision.addBox(bx, 3.3, bz, 3.2, 0.16, 3.7);

  // supply crates + ammo boxes under the canopy
  for (let i = 0; i < 3; i++) {
    const cx = bx + dirIn * (1.4 - i * 0.1);
    const cz = bz - 2.2 + i * 2.2;
    const crate = new THREE.Mesh(boxGeom(1.1, 0.8, 0.9, 1.1), M.wood);
    crate.position.set(cx, 0.4, cz);
    crate.castShadow = map.shadows;
    crate.rotation.y = i * 0.4;
    g.add(crate);
    map.collision.addBox(cx, 0.4, cz, 0.6, 0.4, 0.5);
  }

  // team beacon (decor: thin, and sprites must never block bullets)
  const mast = new THREE.Mesh(cylGeom(0.07, 0.09, 4.6, 6), M.metalDark);
  mast.position.set(bx - dirIn * 4.4, 2.3, bz + 4.6);
  map.decor.add(mast);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 8, 6),
    new THREE.MeshBasicMaterial({ color })
  );
  beacon.position.set(bx - dirIn * 4.4, 4.7, bz + 4.6);
  beacon.name = 'beacon';
  map.decor.add(beacon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: map.mats.glow.map, color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6
  }));
  halo.scale.set(2.4, 2.4, 1);
  halo.position.copy(beacon.position);
  map.decor.add(halo);
  map.beacons = map.beacons || [];
  map.beacons.push(halo);

  map.solids.add(g);
}

/* -------------------------------------------------------- fake AO decals -- */

function buildAODecals(map) {
  const list = map.aoDecals;
  if (!list || list.length === 0) return;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: aoBlobTexture(), transparent: true, depthWrite: false,
    blending: THREE.NormalBlending, opacity: 0.85
  });
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  list.forEach((d, i) => {
    m.compose(new THREE.Vector3(d.x, d.y, d.z), q, new THREE.Vector3(d.r, 1, d.r));
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  im.renderOrder = -1;
  map.decor.add(im);
}
