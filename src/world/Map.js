/**
 * GameMap — FOUNDRY-7.
 *
 * Owns the scene graph for the level: `solids` (bullet + line-of-sight
 * blockers, also the raycast target list), `decor` (visual only), the
 * collision world, the navigation graph and the team spawn points.
 */

import * as THREE from 'three';
import { CollisionWorld } from '../utils/Collision.js';
import { boxGeom } from './Geo.js';
import {
  createMaterials, disposeMaterials, buildLighting, buildSky,
  buildEnvironment, applyShadowQuality, LAYOUT
} from './Environment.js';
import { buildProps } from './Props.js';
import { NavGraph } from './NavGraph.js';

export class GameMap {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    // authored as shadow casters; the quality gate is applied after the build
    this.shadows = true;

    this.root = new THREE.Group();
    this.root.name = 'map';
    this.solids = new THREE.Group();
    this.solids.name = 'solids';
    this.decor = new THREE.Group();
    this.decor.name = 'decor';
    this.root.add(this.solids, this.decor);
    scene.add(this.root);

    this.collision = new CollisionWorld(9);
    this.mats = createMaterials(quality);
    this.navGraph = new NavGraph();
    this.aoDecals = [];
    this.coverSpots = [];
    this.beacons = [];
    this.lights = null;
    this.sky = null;

    /** Raycast target list for bullets and line-of-sight. */
    this.hitTargets = [this.solids];

    this.spawnPoints = { A: [], B: [] };
    this.baseSpawns = { A: [], B: [] };
    this._t = 0;
  }

  /**
   * Structural geometry helper: adds a box to `solids` and registers a matching
   * AABB collider. `cy` is the box centre.
   */
  box(w, h, d, cx, cy, cz, material, opts = {}) {
    const uv = opts.uvScale != null ? opts.uvScale : 0.4;
    const mesh = new THREE.Mesh(boxGeom(w, h, d, uv), material);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = opts.castShadow !== false && this.shadows;
    mesh.receiveShadow = opts.receiveShadow !== false;
    if (opts.name) mesh.name = opts.name;
    (opts.decor ? this.decor : this.solids).add(mesh);
    if (opts.collide !== false) {
      this.collision.addBox(cx, cy, cz, w / 2, h / 2, d / 2);
    }
    return mesh;
  }

  /**
   * The build is split into discrete steps so the caller can yield a frame
   * between them and keep the loading bar moving.
   * @returns {{label:string, run:Function}[]}
   */
  getBuildSteps() {
    return [
      {
        label: 'Raising structures…',
        run: () => {
          this.sky = buildSky(this);
          buildEnvironment(this);
        }
      },
      { label: 'Placing props and cover…', run: () => buildProps(this) },
      { label: 'Setting up lighting…', run: () => { this.lights = buildLighting(this, this.quality); } },
      {
        label: 'Baking navigation graph…',
        run: () => {
          this.collision.build();
          this.navGraph.build(this);
          this._buildSpawns();
          this._snapshotShadows();
          this.setQuality(this.quality);
        }
      }
    ];
  }

  /** Synchronous convenience build (used by tests / fallback). */
  build(onProgress) {
    for (const step of this.getBuildSteps()) {
      if (onProgress) onProgress(step.label);
      step.run();
    }
    return this;
  }

  _buildSpawns() {
    const A = LAYOUT.baseA, B = LAYOUT.baseB;
    const pattern = [
      [0, 0], [0, -6], [0, 6], [4, -10], [4, 10], [-3, 0], [4, 0], [0, -12], [0, 12]
    ];
    const forwardA = [[-38, -12], [-38, 12], [-40, 0], [-33, -18], [-33, 18]];
    const forwardB = [[38, -12], [38, 12], [40, 0], [33, -18], [33, 18]];

    const add = (team, x, z, isBase) => {
      const y = this.collision.groundHeightAt(x, z, 1.8, 0.45);
      if (y > 0.45) return;   // spawn on the deck, never on top of a crate
      if (this.collision.isBlocked(x, y + 0.06, z, 0.5, 1.85)) return;
      const v = new THREE.Vector3(x, y, z);
      this.spawnPoints[team].push(v);
      if (isBase) this.baseSpawns[team].push(v);
    };

    for (const [ox, oz] of pattern) {
      add('A', A.x - ox, A.z + oz, true);
      add('B', B.x + ox, B.z + oz, true);
    }
    for (const [x, z] of forwardA) add('A', x, z, false);
    for (const [x, z] of forwardB) add('B', x, z, false);

    // guarantee at least one spawn each side
    for (const team of ['A', 'B']) {
      const base = team === 'A' ? A : B;
      if (this.spawnPoints[team].length === 0) {
        this.spawnPoints[team].push(new THREE.Vector3(base.x, 0, base.z));
      }
      if (this.baseSpawns[team].length === 0) {
        this.baseSpawns[team] = this.spawnPoints[team].slice();
      }
    }
  }

  /**
   * Pick a spawn for a team, preferring points far from `avoid` (whoever the
   * spawner should not appear next to).
   * @param {boolean} [baseOnly] restrict to the team's own base area
   */
  getSpawn(team, avoid, minDist = 24, baseOnly = false) {
    const list = baseOnly ? this.baseSpawns[team] : this.spawnPoints[team];
    const min2 = minDist * minDist;
    let best = null, bestD = -1;
    // shuffle-ish scan so repeat spawns vary
    const start = (Math.random() * list.length) | 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[(start + i) % list.length];
      if (!avoid) return p;
      const dx = p.x - avoid.x, dz = p.z - avoid.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min2) return p;
      if (d2 > bestD) { bestD = d2; best = p; }
    }
    return best || list[0];
  }

  /** Remember which meshes were authored as shadow casters. */
  _snapshotShadows() {
    this._shadowSnapshot = [];
    this.root.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && o.castShadow) this._shadowSnapshot.push(o);
    });
  }

  setQuality(quality) {
    this.quality = quality;
    this.shadows = quality !== 'low';
    if (this.lights) {
      applyShadowQuality(this.lights, quality);
      const maxLights = quality === 'high' ? 5 : quality === 'medium' ? 3 : 0;
      this.lights.dynamic.forEach((l, i) => { l.visible = i < maxLights; });
    }
    if (!this._shadowSnapshot) this._snapshotShadows();
    for (const o of this._shadowSnapshot) o.castShadow = this.shadows;
  }

  /**
   * Keep the sun's shadow frustum centred on the player. Snapped to a grid so
   * the shadow edges don't shimmer as the camera moves.
   */
  updateSunShadow(playerPos) {
    const sun = this.lights && this.lights.sun;
    if (!sun || !sun.castShadow) return;
    const snap = 1.5;
    const cx = Math.round(playerPos.x / snap) * snap;
    const cz = Math.round(playerPos.z / snap) * snap;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + 44, 96, cz + 26);
    sun.target.updateMatrixWorld();
  }

  update(dt, playerPos) {
    this._t += dt;
    const pulse = 0.45 + Math.sin(this._t * 2.6) * 0.22;
    for (const b of this.beacons) b.material.opacity = pulse;
    if (playerPos) {
      this.updateSunShadow(playerPos);
      // keep the sky dome centred on the player, otherwise its equator cuts a
      // visible arc across the sky from anywhere but the middle of the map
      if (this.sky) this.sky.position.set(playerPos.x, 0, playerPos.z);
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    disposeMaterials(this.mats);
    this.scene.remove(this.root);
    if (this.sky) {
      this.sky.geometry.dispose();
      this.sky.material.dispose();
      this.scene.remove(this.sky);
    }
    if (this.lights) {
      const { sun, hemi, ambient, fill, dynamic } = this.lights;
      [sun, hemi, ambient, fill, ...dynamic].forEach((l) => { if (l) this.scene.remove(l); });
      if (sun) this.scene.remove(sun.target);
    }
    this.scene.fog = null;
    this.collision.clear();
  }
}

export { LAYOUT };
