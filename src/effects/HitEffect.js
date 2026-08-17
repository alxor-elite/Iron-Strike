/**
 * HitEffects — the facade the rest of the game talks to for anything visual and
 * transient: bullet impacts by surface, flesh hits, headshot bursts, tracers,
 * shell casings, dust kicks, muzzle light in the world and death puffs.
 *
 * Everything routes into the pooled ParticleSystem; nothing allocates.
 */

import * as THREE from 'three';
import { ParticleSystem } from './ParticleSystem.js';
import { randRange } from '../utils/MathUtils.js';

const SURFACES = {
  concrete: { spark: 0xffd9a0, dust: 0xa8a29a, sparks: 5, dustCount: 5, decal: true },
  metal: { spark: 0xfff0c0, dust: 0x9aa0a6, sparks: 11, dustCount: 2, decal: true },
  wood: { spark: 0xd8a05a, dust: 0x8a6a40, sparks: 4, dustCount: 5, decal: true },
  dirt: { spark: 0x9a7a52, dust: 0x7a6a52, sparks: 2, dustCount: 8, decal: false }
};

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class HitEffects {
  constructor(scene, quality = 'high') {
    this.particles = new ParticleSystem(scene, quality);
    this.quality = quality;

    // one shared world-space muzzle light, moved to whoever fired last
    this.muzzleLightObj = new THREE.PointLight(0xffb060, 0, 9, 2);
    this.muzzleLightObj.visible = false;
    scene.add(this.muzzleLightObj);
    this._muzzleLife = 0;
    this._lightsEnabled = quality !== 'low';
  }

  setQuality(q) {
    this.quality = q;
    this.particles.setQuality(q);
    this._lightsEnabled = q !== 'low';
    if (!this._lightsEnabled) {
      this.muzzleLightObj.visible = false;
      this.muzzleLightObj.intensity = 0;
    }
  }

  /** Feed the casing pool a floor-height function so brass lands on surfaces. */
  setFloorSampler(fn) {
    this.particles.floorAt = fn;
  }

  /* --------------------------------------------------------------- impacts */

  spawnImpact(point, normal, surface = 'concrete') {
    const cfg = SURFACES[surface] || SURFACES.concrete;
    const p = this.particles;
    _n.copy(normal).normalize();
    const mul = this.quality === 'low' ? 0.5 : this.quality === 'medium' ? 0.75 : 1;

    // sparks along the reflected cone
    const sparks = Math.max(1, Math.round(cfg.sparks * mul));
    for (let i = 0; i < sparks; i++) {
      _v.copy(_n).multiplyScalar(randRange(1.6, 5.2));
      _v.x += randRange(-2.6, 2.6);
      _v.y += randRange(-0.4, 3.0);
      _v.z += randRange(-2.6, 2.6);
      p.emitSpark(
        point.x, point.y, point.z, _v.x, _v.y, _v.z,
        randRange(0.14, 0.4), randRange(0.035, 0.07), 0.004, cfg.spark, 14, 2.2
      );
    }
    // dust puff
    const dust = Math.max(1, Math.round(cfg.dustCount * mul));
    for (let i = 0; i < dust; i++) {
      _v.copy(_n).multiplyScalar(randRange(0.3, 1.1));
      _v.x += randRange(-0.5, 0.5);
      _v.y += randRange(0, 0.8);
      _v.z += randRange(-0.5, 0.5);
      p.emitSmoke(
        point.x + _n.x * 0.04, point.y + _n.y * 0.04, point.z + _n.z * 0.04,
        _v.x, _v.y, _v.z, randRange(0.35, 0.8), randRange(0.09, 0.16), randRange(0.3, 0.5),
        cfg.dust, -0.25, 2.1
      );
    }
    if (cfg.decal && this.quality !== 'low') {
      this.particles.decals.spawn(point, _n, 1);
    }
  }

  /** Minimal, non-gory hit feedback on a body. */
  spawnFleshHit(point, normal, headshot) {
    const p = this.particles;
    const count = headshot ? 12 : 7;
    for (let i = 0; i < count; i++) {
      _v.set(randRange(-1.6, 1.6), randRange(0.2, 2.2), randRange(-1.6, 1.6));
      if (normal) _v.addScaledVector(normal, randRange(0.6, 2.0));
      p.emitSpark(
        point.x, point.y, point.z, _v.x, _v.y, _v.z,
        randRange(0.12, 0.28), randRange(0.05, 0.1), 0.01,
        headshot ? 0xff5a4a : 0xc4382c, 10, 2.6
      );
    }
    if (headshot) {
      p.emitSmoke(point.x, point.y, point.z, 0, 0.5, 0, 0.45, 0.16, 0.5, 0x7a1a14, -0.3, 2);
    }
  }

  /** Puff + dust when a body drops. */
  spawnDeathPuff(position) {
    const p = this.particles;
    for (let i = 0; i < 8; i++) {
      p.emitSmoke(
        position.x + randRange(-0.3, 0.3), position.y + 0.15, position.z + randRange(-0.3, 0.3),
        randRange(-0.5, 0.5), randRange(0.1, 0.5), randRange(-0.5, 0.5),
        randRange(0.6, 1.1), 0.18, 0.65, 0x8a8378, -0.2, 1.8
      );
    }
  }

  /** Dust kicked up by footfalls / landings. */
  spawnDust(position, amount = 4) {
    const p = this.particles;
    const n = this.quality === 'low' ? 1 : amount;
    for (let i = 0; i < n; i++) {
      p.emitSmoke(
        position.x + randRange(-0.25, 0.25), position.y + 0.06, position.z + randRange(-0.25, 0.25),
        randRange(-0.5, 0.5), randRange(0.2, 0.7), randRange(-0.5, 0.5),
        randRange(0.4, 0.8), 0.12, 0.42, 0x9a9184, -0.25, 2.2
      );
    }
  }

  /* ------------------------------------------------------- shots / brass */

  spawnTracer(from, to, thickness = 1) {
    this.particles.tracers.spawn(from, to, thickness);
  }

  /**
   * Eject a casing. `offset` is in view space and rotated by the shooter's
   * orientation so brass flies out of the right-hand port.
   */
  spawnCasing(muzzleWorld, quaternion, offset) {
    if (this.quality === 'low') return;
    _q.copy(quaternion);
    // ejection port sits behind and right of the muzzle, in view space
    _t1.set(offset ? offset.x : 0.09, offset ? offset.y : 0.02, 0.66).applyQuaternion(_q);
    _t2.set(randRange(1.8, 3.0), randRange(1.5, 2.6), randRange(0.2, 1.1)).applyQuaternion(_q);
    this.particles.casings.spawn(
      muzzleWorld.x + _t1.x, muzzleWorld.y + _t1.y, muzzleWorld.z + _t1.z,
      _t2.x, _t2.y, _t2.z
    );
  }

  /** Brief world light at a muzzle so gunfire lights the environment. */
  muzzleLight(position, intensity = 5.5) {
    if (!this._lightsEnabled) return;
    this.muzzleLightObj.position.copy(position);
    this.muzzleLightObj.intensity = intensity;
    this.muzzleLightObj.visible = true;
    this._muzzleLife = 0.05;
  }

  update(dt) {
    this.particles.update(dt);
    if (this._muzzleLife > 0) {
      this._muzzleLife -= dt;
      this.muzzleLightObj.intensity *= 0.72;
      if (this._muzzleLife <= 0) {
        this.muzzleLightObj.visible = false;
        this.muzzleLightObj.intensity = 0;
      }
    }
  }

  clear() {
    this.particles.clear();
    this.muzzleLightObj.visible = false;
    this.muzzleLightObj.intensity = 0;
    this._muzzleLife = 0;
  }

  dispose() {
    this.particles.dispose();
    this.muzzleLightObj.parent?.remove(this.muzzleLightObj);
  }
}
