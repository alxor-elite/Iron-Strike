/**
 * Environment: materials, lighting, sky, and the large static structures of
 * FOUNDRY-7 (ground, perimeter, central warehouse, annex buildings, catwalks,
 * corridor, loading dock, silhouette landmarks).
 *
 * Everything is generated from Three.js primitives + procedural textures.
 */

import * as THREE from 'three';
import { boxGeom, cylGeom, planeGeom } from './Geo.js';
import {
  concreteTexture, floorTexture, corrugatedTexture, metalTexture,
  rustTexture, woodTexture, gratingTexture, chainlinkTexture,
  hazardTexture, glowTexture
} from './Textures.js';

export const LAYOUT = {
  bounds: { x: 60, z: 45 },
  warehouse: { x0: -24, x1: 24, z0: -16, z1: 16, h: 11, t: 0.8 },
  catwalkY: 4.8,
  annexA: { x0: -47, x1: -33, z0: -31, z1: -19, h: 5.2 },
  annexB: { x0: 33, x1: 47, z0: 19, z1: 31, h: 5.2 },
  corridor: { x0: -22, x1: 22, zA: -34.5, zB: -29.5, h: 4.2 },
  dock: { x0: -12, x1: 10, z0: -21.5, z1: -16.4, y: 1.3 },
  baseA: { x: -51, z: 0 },
  baseB: { x: 51, z: 0 }
};

/* ============================================================ materials ==== */

export function createMaterials(quality) {
  const aniso = quality === 'high' ? 8 : quality === 'medium' ? 4 : 1;

  const tune = (t) => { if (t) t.anisotropy = aniso; return t; };

  const mats = {
    ground: new THREE.MeshLambertMaterial({
      map: tune(floorTexture(1)), color: 0x9a9da0
    }),
    slab: new THREE.MeshLambertMaterial({
      map: tune(concreteTexture(1, '#75787a')), color: 0xbdbfc1
    }),
    concrete: new THREE.MeshLambertMaterial({
      map: tune(concreteTexture(1)), color: 0xa8abae
    }),
    concreteDark: new THREE.MeshLambertMaterial({
      map: tune(concreteTexture(1)), color: 0x6e7275
    }),
    panel: new THREE.MeshPhongMaterial({
      map: tune(corrugatedTexture(1)), color: 0x8e979c, shininess: 12, specular: 0x1b1f22
    }),
    panelWarm: new THREE.MeshPhongMaterial({
      map: tune(corrugatedTexture(1)), color: 0x9a8a76, shininess: 10, specular: 0x1a1a18
    }),
    metal: new THREE.MeshPhongMaterial({
      map: tune(metalTexture(1)), color: 0x9aa2a8, shininess: 32, specular: 0x2b3236
    }),
    metalDark: new THREE.MeshPhongMaterial({
      color: 0x2f3438, shininess: 24, specular: 0x22282c
    }),
    steel: new THREE.MeshPhongMaterial({
      map: tune(metalTexture(1)), color: 0x767f86, shininess: 40, specular: 0x333b40
    }),
    rust: new THREE.MeshLambertMaterial({ map: tune(rustTexture(1)), color: 0xb4b0aa }),
    wood: new THREE.MeshLambertMaterial({ map: tune(woodTexture(1)), color: 0xc0bcb6 }),
    hazard: new THREE.MeshLambertMaterial({ map: tune(hazardTexture(1)) }),
    sandbag: new THREE.MeshLambertMaterial({ color: 0x7d7256 }),
    grating: new THREE.MeshPhongMaterial({
      map: tune(gratingTexture(1)), color: 0x9098a0, shininess: 20,
      transparent: true, alphaTest: 0.35, side: THREE.DoubleSide
    }),
    fence: new THREE.MeshLambertMaterial({
      map: tune(chainlinkTexture(1)), transparent: true, alphaTest: 0.4,
      side: THREE.DoubleSide, color: 0xb8c0c6
    }),
    lampGlass: new THREE.MeshBasicMaterial({ color: 0xffe2ac }),
    glow: new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffc978, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55
    }),
    // container liveries share one ribbed map, differing only by tint
    containerA: null, containerB: null, containerC: null, containerD: null
  };

  const corr = tune(corrugatedTexture(1));
  const mkContainer = (color) => new THREE.MeshPhongMaterial({
    map: corr, color, shininess: 14, specular: 0x1c2124
  });
  mats.containerA = mkContainer(0xa8412f); // oxide red
  mats.containerB = mkContainer(0x2f6d8a); // works blue
  mats.containerC = mkContainer(0x4d6b41); // olive
  mats.containerD = mkContainer(0x8a7134); // ochre

  return mats;
}

export function disposeMaterials(mats) {
  Object.values(mats).forEach((m) => { if (m && m.dispose) m.dispose(); });
}

/* ============================================================= lighting ==== */

export function buildLighting(map, quality) {
  const scene = map.scene;
  const lights = { dynamic: [], sun: null, hemi: null, ambient: null };

  // Midday: a bright sky dome plus a strong overhead sun. The ground term is
  // kept light too so shadowed sides of props (and the operators standing in
  // them) never fall below readable brightness.
  const hemi = new THREE.HemisphereLight(0xd6e8ff, 0x9d9481, 2.6);
  scene.add(hemi);
  lights.hemi = hemi;

  const ambient = new THREE.AmbientLight(0xc3d3e2, 1.15);
  scene.add(ambient);
  lights.ambient = ambient;

  const sun = new THREE.DirectionalLight(0xfff6e6, 3.5);
  sun.position.set(44, 96, 26);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);
  lights.sun = sun;

  // cool rim/fill from the opposite side, no shadow cost
  const fill = new THREE.DirectionalLight(0xbcd8f2, 1.5);
  fill.position.set(-50, 34, -46);
  scene.add(fill);
  lights.fill = fill;

  applyShadowQuality(lights, quality);

  // Interior sodium lamps. Point lights are the expensive part, so the count
  // is quality-gated; the emissive lamp housings stay regardless.
  const lampSpots = [
    [-13, 8.4, -9], [13, 8.4, -9], [-13, 8.4, 9], [13, 8.4, 9],
    [0, 6.2, 0], [-40, 4.4, -25], [40, 4.4, 25]
  ];
  const maxLights = quality === 'high' ? 5 : quality === 'medium' ? 3 : 1;
  lampSpots.forEach((p, i) => {
    // housing + glow sprite (always)
    const housing = new THREE.Mesh(cylGeom(0.34, 0.5, 0.3, 8), map.mats.metalDark);
    housing.position.set(p[0], p[1] + 0.2, p[2]);
    map.decor.add(housing);
    const bulb = new THREE.Mesh(cylGeom(0.3, 0.3, 0.1, 8), map.mats.lampGlass);
    bulb.position.set(p[0], p[1], p[2]);
    map.decor.add(bulb);
    const sprite = new THREE.Sprite(map.mats.glow);
    sprite.scale.set(3.4, 3.4, 1);
    sprite.position.set(p[0], p[1] - 0.1, p[2]);
    map.decor.add(sprite);
    // stem
    const stem = new THREE.Mesh(boxGeom(0.12, 1.2, 0.12, 1), map.mats.metalDark);
    stem.position.set(p[0], p[1] + 0.9, p[2]);
    map.decor.add(stem);

    if (i < maxLights) {
      // sodium lamps read as a warm accent in daylight, not the main source
      const pl = new THREE.PointLight(0xffc07a, 1.3, 24, 2);
      pl.position.set(p[0], p[1] - 0.1, p[2]);
      scene.add(pl);
      lights.dynamic.push(pl);
    }
  });

  return lights;
}

export function applyShadowQuality(lights, quality) {
  const sun = lights.sun;
  if (!sun) return;
  if (quality === 'low') {
    sun.castShadow = false;
    return;
  }
  const size = quality === 'high' ? 2048 : 1024;
  sun.castShadow = true;
  sun.shadow.mapSize.set(size, size);
  // The shadow frustum follows the player (see GameMap.updateSunShadow), so it
  // only needs to cover the visible neighbourhood — that keeps texel density
  // high and culls most of the map out of the shadow pass.
  const extent = quality === 'high' ? 46 : 38;
  const cam = sun.shadow.camera;
  cam.left = -extent; cam.right = extent;
  cam.top = extent; cam.bottom = -extent;
  cam.near = 1; cam.far = 240;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
}

/* ================================================================== sky ==== */

export function buildSky(map) {
  // comfortably inside the camera's 320 far plane — the dome is centred on the
  // player, so anything at 320 would be clipped away exactly at the horizon
  const geo = new THREE.SphereGeometry(260, 24, 14);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x3f83c8) },
      midColor: { value: new THREE.Color(0xa8cdea) },
      // close to midColor: the dome's equator is off-centre from the player, so
      // a strong horizon colour draws a visible arc across the sky
      botColor: { value: new THREE.Color(0xbdd7e9) }
    },
    vertexShader: /* glsl */`
      varying float vH;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vH = normalize(wp.xyz).y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 botColor;
      varying float vH;
      void main() {
        float h = clamp(vH, -1.0, 1.0);
        vec3 c = h > 0.0
          ? mix(midColor, topColor, pow(h, 0.62))
          : mix(midColor, botColor, pow(-h, 0.45));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  map.scene.add(sky);
  // thin daylight haze: starts late and ends past the far wall so distant
  // targets stay readable instead of dissolving into the backdrop
  map.scene.fog = new THREE.Fog(0xc2d8ea, 95, 320);
  return sky;
}

/* ========================================================== structures ==== */

/**
 * Build a straight wall along one axis with rectangular openings.
 * @param {object} map
 * @param {{axis:'x'|'z', at:number, from:number, to:number, thickness:number,
 *          height:number, base?:number, mat:THREE.Material,
 *          openings?:{center:number,width:number,height:number}[]}} spec
 */
export function buildWall(map, spec) {
  const { axis, at, from, to, thickness, height, mat } = spec;
  const base = spec.base || 0;
  const openings = (spec.openings || []).slice().sort((a, b) => a.center - b.center);
  const uv = spec.uvScale != null ? spec.uvScale : 0.28;

  let cursor = from;
  for (const op of openings) {
    const oStart = op.center - op.width / 2;
    const oEnd = op.center + op.width / 2;
    if (oStart > cursor) {
      segment(cursor, oStart, base, height);
    }
    // lintel above the opening
    const lintelH = height - op.height;
    if (lintelH > 0.05) segment(oStart, oEnd, base + op.height, lintelH);
    cursor = Math.max(cursor, oEnd);
  }
  if (cursor < to) segment(cursor, to, base, height);

  function segment(a, b, y0, h) {
    const len = b - a;
    if (len <= 0.02) return;
    const mid = (a + b) / 2;
    const w = axis === 'x' ? len : thickness;
    const d = axis === 'x' ? thickness : len;
    const cx = axis === 'x' ? mid : at;
    const cz = axis === 'x' ? at : mid;
    map.box(w, h, d, cx, y0 + h / 2, cz, mat, { uvScale: uv });
  }
}

/**
 * Staircase from a base point rising along an axis direction.
 * Steps are individual boxes so the actor step-up logic can climb them.
 */
export function buildStairs(map, opts) {
  const {
    axis = 'z', dir = 1, x, z, width = 2.4, base = 0,
    rise, steps = Math.round(rise / 0.3), run = 0.42, mat
  } = opts;
  const stepRise = rise / steps;
  for (let i = 0; i < steps; i++) {
    const h = stepRise * (i + 1);
    const offset = (i + 0.5) * run * dir;
    const cx = axis === 'x' ? x + offset : x;
    const cz = axis === 'z' ? z + offset : z;
    const w = axis === 'x' ? run : width;
    const d = axis === 'z' ? run : width;
    map.box(w, h, d, cx, base + h / 2, cz, mat, { uvScale: 0.6 });
  }
  // side stringers, tilted to follow the flight
  const total = steps * run;
  const midX = axis === 'x' ? x + (total / 2) * dir : x;
  const midZ = axis === 'z' ? z + (total / 2) * dir : z;
  const diag = Math.sqrt(total * total + rise * rise);
  const angle = Math.atan2(rise, total * dir);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(
      boxGeom(axis === 'x' ? diag : 0.14, 0.22, axis === 'z' ? diag : 0.14, 0.6),
      mat
    );
    m.position.set(
      midX + (axis === 'z' ? side * (width / 2 + 0.09) : 0),
      base + rise / 2 - 0.05,
      midZ + (axis === 'x' ? side * (width / 2 + 0.09) : 0)
    );
    if (axis === 'x') m.rotation.z = angle;
    else m.rotation.x = -angle;
    map.decor.add(m);
  }
  return {
    topX: axis === 'x' ? x + total * dir : x,
    topZ: axis === 'z' ? z + total * dir : z,
    topY: base + rise
  };
}

/** Railing along an axis: posts + two rails. Blocks movement, not bullets. */
export function buildRailing(map, opts) {
  const { axis = 'x', at, from, to, y, height = 1.1, mat } = opts;
  const len = to - from;
  if (len <= 0) return;
  const posts = Math.max(2, Math.round(len / 2.2));
  for (let i = 0; i <= posts; i++) {
    const p = from + (len * i) / posts;
    const px = axis === 'x' ? p : at;
    const pz = axis === 'x' ? at : p;
    const post = new THREE.Mesh(cylGeom(0.045, 0.05, height, 6), mat);
    post.position.set(px, y + height / 2, pz);
    map.decor.add(post);
  }
  for (const rh of [height, height * 0.55]) {
    const w = axis === 'x' ? len : 0.06;
    const d = axis === 'x' ? 0.06 : len;
    const rail = new THREE.Mesh(boxGeom(w, 0.07, d, 0.5), mat);
    rail.position.set(
      axis === 'x' ? from + len / 2 : at,
      y + rh,
      axis === 'x' ? at : from + len / 2
    );
    map.decor.add(rail);
  }
  // movement blocker (waist high) so actors can't stroll off the catwalk;
  // see-through, so it never blocks sight lines or bullets
  const hx = axis === 'x' ? len / 2 : 0.12;
  const hz = axis === 'x' ? 0.12 : len / 2;
  map.collision.addBox(
    axis === 'x' ? from + len / 2 : at,
    y + height / 2 + 0.1,
    axis === 'x' ? at : from + len / 2,
    hx, height / 2 + 0.1, hz
  ).opaque = false;
}

export function buildEnvironment(map) {
  const M = map.mats;
  const L = LAYOUT;

  /* ---------------------------------------------------------- ground ------ */
  const ground = new THREE.Mesh(planeGeom(L.bounds.x * 2 + 8, L.bounds.z * 2 + 8, 0.12), M.ground);
  ground.receiveShadow = true;
  ground.name = 'ground';
  map.solids.add(ground);
  // A floor slab in the collider set so ray queries (AI bullets, sight lines)
  // are stopped by the deck exactly like mesh raycasts are. Flagged as ground
  // so prop placement tests, which use a safety margin, ignore it.
  map.collision.addBox(0, -0.75, 0, L.bounds.x + 6, 0.75, L.bounds.z + 6).ground = true;

  // warehouse interior slab (visual variation, sits 2 cm above the ground)
  const slab = new THREE.Mesh(
    planeGeom(L.warehouse.x1 - L.warehouse.x0, L.warehouse.z1 - L.warehouse.z0, 0.2),
    M.slab
  );
  slab.position.set(0, 0.02, 0);
  slab.receiveShadow = true;
  map.decor.add(slab);

  // painted lane in front of the dock
  const lane = new THREE.Mesh(planeGeom(24, 3, 0.5), M.hazard);
  lane.position.set(-1, 0.03, -23.6);
  map.decor.add(lane);

  /* -------------------------------------------------------- perimeter ----- */
  const B = L.bounds;
  const pw = 1.2, ph = 9.5;
  buildWall(map, { axis: 'x', at: -B.z, from: -B.x, to: B.x, thickness: pw, height: ph, mat: M.concreteDark });
  buildWall(map, { axis: 'x', at: B.z, from: -B.x, to: B.x, thickness: pw, height: ph, mat: M.concreteDark });
  buildWall(map, { axis: 'z', at: -B.x, from: -B.z, to: B.z, thickness: pw, height: ph, mat: M.concreteDark });
  buildWall(map, { axis: 'z', at: B.x, from: -B.z, to: B.z, thickness: pw, height: ph, mat: M.concreteDark });
  // invisible ceiling so nothing can rocket-jump out of the arena; it must not
  // register as sight-blocking or as a walkable surface
  const lid = map.collision.addBox(0, ph + 14, 0, B.x, 0.5, B.z);
  lid.opaque = false;
  lid.noGround = true;

  /* -------------------------------------------------------- warehouse ---- */
  const W = L.warehouse;
  // south wall (main entrances)
  buildWall(map, {
    axis: 'x', at: W.z0, from: W.x0, to: W.x1, thickness: W.t, height: W.h, mat: M.panel,
    openings: [
      { center: 0, width: 9, height: 7 },
      { center: -19, width: 3, height: 3.4 },
      { center: 19, width: 3, height: 3.4 }
    ]
  });
  // north wall
  buildWall(map, {
    axis: 'x', at: W.z1, from: W.x0, to: W.x1, thickness: W.t, height: W.h, mat: M.panel,
    openings: [
      { center: 6, width: 8, height: 6.5 },
      { center: -17, width: 3, height: 3.4 }
    ]
  });
  // west wall
  buildWall(map, {
    axis: 'z', at: W.x0, from: W.z0, to: W.z1, thickness: W.t, height: W.h, mat: M.panel,
    openings: [
      { center: -9, width: 3.6, height: 3.6 },
      { center: 8, width: 3.6, height: 3.6 }
    ]
  });
  // east wall
  buildWall(map, {
    axis: 'z', at: W.x1, from: W.z0, to: W.z1, thickness: W.t, height: W.h, mat: M.panel,
    openings: [
      { center: -7, width: 3.6, height: 3.6 },
      { center: 9, width: 3.6, height: 3.6 }
    ]
  });

  // roof panels with two skylight gaps
  const roofSpans = [[W.x0, -9], [-6, 3], [7, W.x1]];
  for (const [a, b] of roofSpans) {
    map.box(b - a, 0.35, W.z1 - W.z0, (a + b) / 2, W.h + 0.175, 0, M.panel, { uvScale: 0.2 });
  }
  // roof trusses across the skylights (visual + shade)
  for (let z = W.z0 + 2; z < W.z1; z += 4) {
    const truss = new THREE.Mesh(boxGeom(W.x1 - W.x0, 0.22, 0.22, 0.5), M.steel);
    truss.position.set(0, W.h - 0.5, z);
    map.decor.add(truss);
  }

  // interior columns
  for (const cx of [-13, 13]) {
    for (const cz of [-9, 0, 9]) {
      const col = new THREE.Mesh(cylGeom(0.42, 0.5, W.h, 10), M.steel);
      col.position.set(cx, W.h / 2, cz);
      col.castShadow = map.shadows;
      map.solids.add(col);
      map.collision.addBox(cx, W.h / 2, cz, 0.45, W.h / 2, 0.45);
      // base plate
      const plate = new THREE.Mesh(boxGeom(1.3, 0.16, 1.3, 0.8), M.metalDark);
      plate.position.set(cx, 0.08, cz);
      map.decor.add(plate);
    }
  }

  /* ---------------------------------------------------------- catwalks --- */
  const cy = L.catwalkY;
  const cwT = 0.22;
  // west catwalk and its stair; the deck overlaps the top step so there is no
  // gap to fall through at the landing
  addPlatform(map, -23.4, -20.6, -7.2, 14, cy, M.grating, cwT);
  buildStairs(map, { axis: 'z', dir: 1, x: -22, z: -14.2, width: 2.6, rise: cy, steps: 16, run: 0.44, mat: M.metal });
  buildRailing(map, { axis: 'z', at: -20.5, from: -7.2, to: 14, y: cy, mat: M.metal });
  buildRailing(map, { axis: 'x', at: 14, from: -23.4, to: -20.6, y: cy, mat: M.metal });

  // east catwalk and its stair
  addPlatform(map, 20.6, 23.4, -14, 7.2, cy, M.grating, cwT);
  buildStairs(map, { axis: 'z', dir: -1, x: 22, z: 14.2, width: 2.6, rise: cy, steps: 16, run: 0.44, mat: M.metal });
  buildRailing(map, { axis: 'z', at: 20.5, from: -14, to: 7.2, y: cy, mat: M.metal });
  buildRailing(map, { axis: 'x', at: -14, from: 20.6, to: 23.4, y: cy, mat: M.metal });

  // central bridge
  addPlatform(map, -20.6, 20.6, -1.6, 1.6, cy, M.grating, cwT);
  buildRailing(map, { axis: 'x', at: -1.5, from: -20.6, to: 20.6, y: cy, mat: M.metal });
  buildRailing(map, { axis: 'x', at: 1.5, from: -20.6, to: 20.6, y: cy, mat: M.metal });
  // bridge support hangers
  for (let x = -16; x <= 16; x += 8) {
    const hanger = new THREE.Mesh(boxGeom(0.12, W.h - cy, 0.12, 1), M.steel);
    hanger.position.set(x, cy + (W.h - cy) / 2, 0);
    map.decor.add(hanger);
  }

  /* -------------------------------------------------------- annex A ------ */
  buildAnnex(map, L.annexA, {
    doorAt: -33, doorCenter: -25,       // door on the +X face
    sideDoorAt: -19, sideDoorCenter: -43, // door on the +Z face
    stairSide: 'west'
  });

  /* -------------------------------------------------------- annex B ------ */
  buildAnnex(map, L.annexB, {
    doorAt: 33, doorCenter: 25,
    sideDoorAt: 31, sideDoorCenter: 43,
    stairSide: 'east'
  });

  /* -------------------------------------------------------- corridor ----- */
  const C = L.corridor;
  buildWall(map, {
    axis: 'x', at: C.zA, from: C.x0, to: C.x1, thickness: 0.7, height: C.h, mat: M.concrete,
    openings: [{ center: -12, width: 3.2, height: 3 }, { center: 12, width: 3.2, height: 3 }]
  });
  buildWall(map, {
    axis: 'x', at: C.zB, from: C.x0, to: C.x1, thickness: 0.7, height: C.h, mat: M.concrete,
    openings: [
      { center: -16, width: 3.2, height: 3 },
      { center: 0, width: 4.5, height: 3 },
      { center: 16, width: 3.2, height: 3 }
    ]
  });
  // partial roof — a dark covered stretch at each end
  for (const [a, b] of [[C.x0, -7], [7, C.x1]]) {
    map.box(b - a, 0.3, C.zB - C.zA, (a + b) / 2, C.h + 0.15, (C.zA + C.zB) / 2, M.panel, { uvScale: 0.2 });
  }

  /* ------------------------------------------------------ loading dock --- */
  const D = L.dock;
  addPlatform(map, D.x0, D.x1, D.z0, D.z1, D.y, M.concrete, D.y, true);
  // hazard trim along the dock edge
  const trim = new THREE.Mesh(boxGeom(D.x1 - D.x0, 0.14, 0.4, 0.7), M.hazard);
  trim.position.set((D.x0 + D.x1) / 2, D.y - 0.07, D.z0 + 0.2);
  map.decor.add(trim);
  // steps climb toward the dock, finishing flush with its edge
  buildStairs(map, { axis: 'z', dir: 1, x: D.x1 - 1.6, z: D.z0 - 1.9, width: 2.2, rise: D.y, steps: 4, run: 0.4, mat: M.concrete });
  buildStairs(map, { axis: 'z', dir: 1, x: D.x0 + 1.6, z: D.z0 - 1.9, width: 2.2, rise: D.y, steps: 4, run: 0.4, mat: M.concrete });
  // dock canopy on posts
  for (const px of [D.x0 + 1, D.x1 - 1]) {
    const post = new THREE.Mesh(cylGeom(0.16, 0.18, 3.4, 8), M.metal);
    post.position.set(px, D.y + 1.7, D.z0 + 0.6);
    map.solids.add(post);
    map.collision.addBox(px, D.y + 1.7, D.z0 + 0.6, 0.18, 1.7, 0.18);
  }
  map.box(D.x1 - D.x0 + 1, 0.2, 5.6, (D.x0 + D.x1) / 2, D.y + 3.5, D.z0 + 2.4, M.rust, { uvScale: 0.3 });

  /* ------------------------------------------------ freestanding cover --- */
  // long concrete blast walls creating lanes between bases and the warehouse
  const walls = [
    { axis: 'z', at: -36, from: -14, to: -2, t: 0.9, h: 3.2 },
    { axis: 'z', at: -36, from: 4, to: 16, t: 0.9, h: 3.2 },
    { axis: 'z', at: 36, from: -16, to: -4, t: 0.9, h: 3.2 },
    { axis: 'z', at: 36, from: 2, to: 14, t: 0.9, h: 3.2 },
    { axis: 'x', at: 30, from: -18, to: -4, t: 0.9, h: 2.9 },
    { axis: 'x', at: -25, from: 4, to: 18, t: 0.9, h: 2.9 },
    { axis: 'x', at: 36, from: -34, to: -18, t: 0.9, h: 3.4 },
    { axis: 'x', at: -22, from: 22, to: 40, t: 0.9, h: 3.4 }
  ];
  for (const w of walls) {
    buildWall(map, {
      axis: w.axis, at: w.at, from: w.from, to: w.to,
      thickness: w.t, height: w.h, mat: M.concrete, uvScale: 0.3
    });
    // capping beam
    const len = w.to - w.from;
    const cap = new THREE.Mesh(
      boxGeom(w.axis === 'x' ? len : w.t + 0.3, 0.18, w.axis === 'x' ? w.t + 0.3 : len, 0.5),
      M.concreteDark
    );
    cap.position.set(
      w.axis === 'x' ? (w.from + w.to) / 2 : w.at,
      w.h + 0.09,
      w.axis === 'x' ? w.at : (w.from + w.to) / 2
    );
    map.decor.add(cap);
  }

  /* -------------------------------------------------------- landmarks ---- */
  buildWaterTower(map, -47, 16);
  buildSilo(map, 49, -33);
  buildSilo(map, 43, -37);

  return map;
}

/** Solid raised platform (catwalk / dock / roof). `thickness` is downward. */
function addPlatform(map, x0, x1, z0, z1, topY, mat, thickness = 0.24, castShadow = false) {
  const w = x1 - x0, d = z1 - z0;
  const mesh = map.box(w, thickness, d, (x0 + x1) / 2, topY - thickness / 2, (z0 + z1) / 2, mat, {
    uvScale: 0.35, castShadow
  });
  return mesh;
}

function buildAnnex(map, A, o) {
  const M = map.mats;
  const t = 0.6;
  const h = A.h;
  // walls
  buildWall(map, {
    axis: 'x', at: A.z0, from: A.x0, to: A.x1, thickness: t, height: h, mat: M.panelWarm,
    openings: o.sideDoorAt === A.z0 ? [{ center: o.sideDoorCenter, width: 3, height: 3.2 }] : []
  });
  buildWall(map, {
    axis: 'x', at: A.z1, from: A.x0, to: A.x1, thickness: t, height: h, mat: M.panelWarm,
    openings: o.sideDoorAt === A.z1 ? [{ center: o.sideDoorCenter, width: 3, height: 3.2 }] : []
  });
  buildWall(map, {
    axis: 'z', at: A.x0, from: A.z0, to: A.z1, thickness: t, height: h, mat: M.panelWarm,
    openings: o.doorAt === A.x0 ? [{ center: o.doorCenter, width: 3.6, height: 3.4 }] : []
  });
  buildWall(map, {
    axis: 'z', at: A.x1, from: A.z0, to: A.z1, thickness: t, height: h, mat: M.panelWarm,
    openings: o.doorAt === A.x1 ? [{ center: o.doorCenter, width: 3.6, height: 3.4 }] : []
  });
  // window slits for interior light
  for (let i = 0; i < 3; i++) {
    const zz = A.z0 + 3 + i * 3;
    const gap = new THREE.Mesh(boxGeom(0.1, 1.1, 1.6, 1), M.metalDark);
    gap.position.set(o.doorAt === A.x0 ? A.x1 : A.x0, 3.2, zz);
    map.decor.add(gap);
  }
  // roof = elevated platform with a parapet, reached by an external stair
  addPlatform(map, A.x0, A.x1, A.z0, A.z1, h, map.mats.concrete, 0.35, true);

  const west = o.stairSide === 'west';
  const stairX = west ? A.x0 - 1.5 : A.x1 + 1.5;
  const dir = west ? 1 : -1;                    // climb toward the near corner
  const startZ = west ? A.z0 + 1.4 : A.z1 - 1.4;
  const steps = 18, run = 0.42;
  buildStairs(map, { axis: 'z', dir, x: stairX, z: startZ, width: 2.4, rise: h, steps, run, mat: map.mats.metal });

  // landing bridging the top step to the roof deck
  const topZ = startZ + steps * run * dir;
  const landCz = topZ + dir * 1.3;
  map.box(3.4, 0.3, 2.6, west ? A.x0 - 0.9 : A.x1 + 0.9, h - 0.15, landCz, map.mats.concrete, { uvScale: 0.4 });

  const par = 0.95;
  const opening = [{ center: landCz, width: 3.0, height: par }];
  for (const spec of [
    { axis: 'x', at: A.z0 + 0.25, from: A.x0, to: A.x1, op: [] },
    { axis: 'x', at: A.z1 - 0.25, from: A.x0, to: A.x1, op: [] },
    { axis: 'z', at: A.x0 + 0.25, from: A.z0, to: A.z1, op: west ? opening : [] },
    { axis: 'z', at: A.x1 - 0.25, from: A.z0, to: A.z1, op: west ? [] : opening }
  ]) {
    buildWall(map, {
      axis: spec.axis, at: spec.at, from: spec.from, to: spec.to,
      thickness: 0.3, height: par, base: h, mat: map.mats.concreteDark,
      uvScale: 0.6, openings: spec.op
    });
  }
  // roof AC units for silhouette
  for (let i = 0; i < 2; i++) {
    const ux = A.x0 + 4 + i * 5.5;
    map.box(2.4, 1.1, 2, ux, h + 0.55, (A.z0 + A.z1) / 2 + (i ? 2 : -2), map.mats.metal, {
      uvScale: 0.5, castShadow: true
    });
  }
}

function buildWaterTower(map, x, z) {
  const M = map.mats;
  const legR = 0.18;
  for (const [dx, dz] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) {
    const leg = new THREE.Mesh(cylGeom(legR, legR * 1.4, 9.4, 7), M.rust);
    leg.position.set(x + dx, 4.7, z + dz);
    leg.rotation.z = -dx * 0.012;
    leg.rotation.x = dz * 0.012;
    map.solids.add(leg);
    map.collision.addBox(x + dx, 4.7, z + dz, 0.3, 4.7, 0.3);
  }
  // cross bracing
  for (const yy of [3.2, 6.4]) {
    for (const [ax, az, w, d] of [[0, -2.4, 4.8, 0.12], [0, 2.4, 4.8, 0.12], [-2.4, 0, 0.12, 4.8], [2.4, 0, 0.12, 4.8]]) {
      const br = new THREE.Mesh(boxGeom(w, 0.12, d, 0.8), M.rust);
      br.position.set(x + ax, yy, z + az);
      map.decor.add(br);
    }
  }
  const tank = new THREE.Mesh(cylGeom(3.3, 3.3, 4.4, 14), M.rust);
  tank.position.set(x, 11.8, z);
  tank.castShadow = map.shadows;
  map.solids.add(tank);
  map.collision.addBox(x, 11.8, z, 3.3, 2.2, 3.3);
  const cone = new THREE.Mesh(cylGeom(0.4, 3.4, 1.5, 14), M.rust);
  cone.position.set(x, 14.6, z);
  map.decor.add(cone);
}

function buildSilo(map, x, z) {
  const M = map.mats;
  const h = 15;
  const body = new THREE.Mesh(cylGeom(2.6, 2.8, h, 14), M.concreteDark);
  body.position.set(x, h / 2, z);
  body.castShadow = map.shadows;
  map.solids.add(body);
  map.collision.addBox(x, h / 2, z, 2.7, h / 2, 2.7);
  const cap = new THREE.Mesh(cylGeom(2.2, 2.7, 1.1, 14), M.metal);
  cap.position.set(x, h + 0.55, z);
  map.decor.add(cap);
  // exterior ladder
  for (let y = 1; y < h; y += 0.55) {
    const rung = new THREE.Mesh(boxGeom(0.5, 0.06, 0.06, 1), M.rust);
    rung.position.set(x, y, z + 2.9);
    map.decor.add(rung);
  }
}
