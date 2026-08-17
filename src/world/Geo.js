/**
 * Geometry helpers for the procedurally built map.
 *
 * Box UVs are rescaled by world size so one shared (repeat = 1) texture tiles
 * consistently across a 1 m crate and a 40 m wall. Geometries are cached by
 * their parameters so repeated shapes share GPU buffers.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const boxCache = new Map();
const cylCache = new Map();

/** BoxGeometry UV order: +X, -X, +Y, -Y, +Z, -Z (4 verts each). */
export function scaleBoxUVs(geometry, w, h, d, scale) {
  const uv = geometry.attributes.uv;
  const arr = uv.array;
  const pairs = [
    [d * scale, h * scale], // +X
    [d * scale, h * scale], // -X
    [w * scale, d * scale], // +Y
    [w * scale, d * scale], // -Y
    [w * scale, h * scale], // +Z
    [w * scale, h * scale]  // -Z
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = pairs[f];
    for (let v = 0; v < 4; v++) {
      const i = (f * 4 + v) * 2;
      arr[i] *= su;
      arr[i + 1] *= sv;
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Cached BoxGeometry with world-scaled UVs. `uvScale` = texture tiles per metre. */
export function boxGeom(w, h, d, uvScale = 0.5) {
  const key = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}_${uvScale}`;
  let g = boxCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    if (uvScale > 0) scaleBoxUVs(g, w, h, d, uvScale);
    boxCache.set(key, g);
  }
  return g;
}

export function cylGeom(rTop, rBottom, height, segments = 10, openEnded = false) {
  const key = `${rTop}_${rBottom}_${height}_${segments}_${openEnded}`;
  let g = cylCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rTop, rBottom, height, segments, 1, openEnded);
    cylCache.set(key, g);
  }
  return g;
}

/** A ground plane with UVs scaled to world size. */
export function planeGeom(w, d, uvScale = 0.25) {
  const g = new THREE.PlaneGeometry(w, d, 1, 1);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * w * uvScale, uv.getY(i) * d * uvScale);
  }
  uv.needsUpdate = true;
  g.rotateX(-Math.PI / 2);
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/**
 * Merge a list of `{ geom, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z] }` parts
 * into a single BufferGeometry (used for prop templates that get instanced).
 */
const MERGE_ATTRS = ['position', 'normal', 'uv'];

export function mergeParts(parts) {
  const list = [];
  for (const part of parts) {
    // mergeGeometries() demands a uniform attribute set and uniform indexing,
    // so every part is normalised to non-indexed {position, normal, uv}.
    const g = part.geom.index ? part.geom.toNonIndexed() : part.geom.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!MERGE_ATTRS.includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    g.morphAttributes = {};

    _p.set(part.pos ? part.pos[0] : 0, part.pos ? part.pos[1] : 0, part.pos ? part.pos[2] : 0);
    _e.set(part.rot ? part.rot[0] : 0, part.rot ? part.rot[1] : 0, part.rot ? part.rot[2] : 0);
    _q.setFromEuler(_e);
    _s.set(
      part.scale ? part.scale[0] : 1,
      part.scale ? part.scale[1] : 1,
      part.scale ? part.scale[2] : 1
    );
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m); // transforms positions and normals

    list.push(g);
  }
  const merged = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  if (!merged) throw new Error('mergeParts: incompatible geometries');
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Low-poly trapezoid prism (jersey barrier / sandbag-ish silhouette) built from
 * raw BufferGeometry so the map isn't only boxes.
 */
export function trapezoidPrism(bottomWidth, topWidth, height, depth) {
  const bw = bottomWidth / 2, tw = topWidth / 2, hd = depth / 2;
  // 8 corners: bottom (0-3), top (4-7)
  const v = [
    [-bw, 0, hd], [bw, 0, hd], [bw, 0, -hd], [-bw, 0, -hd],
    [-tw, height, hd], [tw, height, hd], [tw, height, -hd], [-tw, height, -hd]
  ];
  const faces = [
    [0, 1, 5, 4], // front
    [1, 2, 6, 5], // right
    [2, 3, 7, 6], // back
    [3, 0, 4, 7], // left
    [4, 5, 6, 7], // top
    [3, 2, 1, 0]  // bottom
  ];
  const pos = [];
  const uvs = [];
  for (const f of faces) {
    const [a, b, c, d] = f;
    const quad = [a, b, c, a, c, d];
    const quv = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 6; i++) {
      pos.push(v[quad[i]][0], v[quad[i]][1], v[quad[i]][2]);
      uvs.push(quv[i][0], quv[i][1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** Irregular low-poly rock/rubble chunk from a jittered icosahedron. */
export function rubbleGeom(radius = 0.4, detail = 0) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) * (0.7 + Math.random() * 0.6),
      pos.getY(i) * (0.5 + Math.random() * 0.5),
      pos.getZ(i) * (0.7 + Math.random() * 0.6)
    );
  }
  g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  }
  return g;
}

export function disposeGeoCaches() {
  boxCache.forEach((g) => g.dispose());
  cylCache.forEach((g) => g.dispose());
  boxCache.clear();
  cylCache.clear();
}
