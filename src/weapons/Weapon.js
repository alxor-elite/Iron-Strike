/**
 * Weapon base class.
 *
 * Handles the shared behaviour of every firearm: fire timing, magazine and
 * reserve ammo, the reload state machine, viewmodel pose (hip / ADS / sprint),
 * sway + bob, recoil impulses, hitscan resolution with damage zones, and the
 * effect + audio hooks.
 *
 * The viewmodel lives in `game.viewScene` and is rendered by a second pass with
 * its own camera, so it can never clip into walls.
 */

import * as THREE from 'three';
import { clamp, damp, lerp, gaussian } from '../utils/MathUtils.js';
import { raycastFirst } from '../utils/RaycastUtils.js';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzleWorld = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/**
 * Viewmodel poses in camera space. The rifle model spans roughly z +0.21
 * (butt pad) to -0.50 (muzzle) at its display scale, so every pose keeps the
 * butt comfortably in front of the near plane — otherwise the stock fills the
 * screen. The ADS pose puts the optic lens exactly on the -Z axis, so the sight
 * picture agrees with where bullets actually go.
 */
export const POSE = {
  hip: { pos: new THREE.Vector3(0.2, -0.185, -0.5), rot: new THREE.Euler(0.02, -0.1, 0.02) },
  ads: { pos: new THREE.Vector3(0.0, -0.0825, -0.62), rot: new THREE.Euler(0, 0, 0) },
  sprint: { pos: new THREE.Vector3(0.26, -0.28, -0.46), rot: new THREE.Euler(0.18, -0.52, -0.24) },
  reload: { pos: new THREE.Vector3(0.23, -0.27, -0.46), rot: new THREE.Euler(0.44, -0.36, 0.1) }
};

export class Weapon {
  constructor(game, config) {
    this.game = game;
    this.config = config;

    this.name = config.name;
    this.magSize = config.magSize;
    this.ammo = config.magSize;
    this.reserve = config.reserveMax;
    this.reserveMax = config.reserveMax;
    this.fireInterval = 60 / config.rpm;
    this.reloadTime = config.reloadTime;
    this.damage = config.damage;
    this.range = config.range;

    this.adsAmount = 0;
    this.reloading = false;
    this.reloadT = 0;
    this._fireTimer = 0;
    this._burstCount = 0;
    this._burstDecay = 0;
    this._boltT = 0;
    this._kick = 0;
    this._kickRot = 0;
    this._swayX = 0;
    this._swayY = 0;
    this._bobT = 0;
    this._lastShotTime = -10;
    this._reloadOffset = new THREE.Vector3();
    this._reloadRot = new THREE.Euler();
    this._magDropped = false;
    this._magSeated = false;
    this._boltCycled = false;

    this.model = this.buildModel();
    this.group = this.model.group;
    this.group.position.copy(POSE.hip.pos);
    this.group.rotation.copy(POSE.hip.rot);
    game.viewScene.add(this.group);

    this._pos = this.group.position.clone();
    this._rot = new THREE.Euler().copy(this.group.rotation);
    this._targetPos = this._pos.clone();
    this._targetRot = new THREE.Euler().copy(this._rot);
  }

  /** @abstract @returns {{group:THREE.Group, muzzle:THREE.Object3D, magazine:THREE.Object3D, bolt:THREE.Object3D, ejector:THREE.Object3D}} */
  buildModel() {
    throw new Error('buildModel() must be implemented');
  }

  get isReloading() { return this.reloading; }
  get canFire() {
    return !this.reloading && this.ammo > 0 && this._fireTimer <= 0 && this.game.player.alive;
  }

  reset() {
    this.ammo = this.magSize;
    this.reserve = this.reserveMax;
    this.reloading = false;
    this.reloadT = 0;
    this._fireTimer = 0;
    this._burstCount = 0;
    this.adsAmount = 0;
    this.model.magazine.position.copy(this.model.magHome);
    this.model.magazine.rotation.set(0, 0, 0);
    this.model.magazine.visible = true;
  }

  startReload() {
    if (this.reloading || this.ammo >= this.magSize || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadT = 0;
    this._magDropped = false;
    this._magSeated = false;
    this._boltCycled = false;
    this.game.audio.play('reloadStart', { volume: 0.8 });
    return true;
  }

  _finishReload() {
    const need = this.magSize - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take;
    this.reserve -= take;
  }

  /** Current cone half-angle in radians, from stance and recent fire. */
  getSpread() {
    const p = this.game.player;
    let s = lerp(this.config.spreadHip, this.config.spreadAds, this.adsAmount);
    const speedFactor = clamp(p.horizontalSpeed / 8.4, 0, 1);
    s += speedFactor * this.config.spreadMove;
    if (!p.grounded) s += this.config.spreadAir;
    if (p.crouching) s *= 0.68;
    s += Math.min(this._burstCount, 12) * this.config.spreadBloom;
    return s;
  }

  update(dt, input) {
    const player = this.game.player;
    const cam = this.game.playerCamera;

    // ------------------------------------------------------------- timers --
    this._fireTimer = Math.max(0, this._fireTimer - dt);
    this._boltT = Math.max(0, this._boltT - dt);
    this._burstDecay -= dt;
    if (this._burstDecay <= 0 && this._burstCount > 0) {
      this._burstCount = Math.max(0, this._burstCount - 1);
      this._burstDecay = 0.09;
    }

    // ---------------------------------------------------------------- ADS --
    const wantAds = input.ads && !player.sprinting && player.alive && !this.reloading;
    this.adsAmount = damp(this.adsAmount, wantAds ? 1 : 0, 13, dt);
    if (this.adsAmount < 0.001) this.adsAmount = 0;
    cam.setAds(this.adsAmount);
    const vFov = lerp(58, 42, this.adsAmount);
    if (Math.abs(this.game.viewCamera.fov - vFov) > 0.02) {
      this.game.viewCamera.fov = vFov;
      this.game.viewCamera.updateProjectionMatrix();
    }

    // ------------------------------------------------------------ reload --
    if (input.reloadQueued) this.startReload();
    if (this.reloading) {
      this.reloadT += dt;
      this._animateReload(this.reloadT / this.reloadTime);
      if (this.reloadT >= this.reloadTime) {
        this.reloading = false;
        this.model.magazine.position.copy(this.model.magHome);
        this.model.magazine.rotation.set(0, 0, 0);
        this.model.magazine.visible = true;
      }
    }

    // -------------------------------------------------------------- fire --
    if (player.alive && input.firing && !player.sprinting) {
      if (this.canFire) {
        this.fire();
      } else if (this.ammo <= 0 && !this.reloading && input.firePressed) {
        this.game.audio.play('dryFire', { volume: 0.5 });
        this.startReload();
      }
    }
    // auto-reload on empty
    if (this.ammo <= 0 && !this.reloading && this.reserve > 0) this.startReload();

    // -------------------------------------------------------------- pose --
    let pose = POSE.hip;
    if (this.reloading) pose = POSE.reload;
    else if (player.sprinting && player.horizontalSpeed > 5) pose = POSE.sprint;
    else if (this.adsAmount > 0.02) pose = null; // blended below

    if (pose) {
      this._targetPos.copy(pose.pos);
      this._targetRot.set(pose.rot.x, pose.rot.y, pose.rot.z);
    } else {
      this._targetPos.copy(POSE.hip.pos).lerp(POSE.ads.pos, this.adsAmount);
      this._targetRot.set(
        lerp(POSE.hip.rot.x, POSE.ads.rot.x, this.adsAmount),
        lerp(POSE.hip.rot.y, POSE.ads.rot.y, this.adsAmount),
        lerp(POSE.hip.rot.z, POSE.ads.rot.z, this.adsAmount)
      );
    }

    // sway from look input + walk bob
    const swayScale = lerp(1, 0.28, this.adsAmount);
    this._swayX = damp(this._swayX, clamp(-cam.lastDx * 0.0016, -0.05, 0.05) * swayScale, 9, dt);
    this._swayY = damp(this._swayY, clamp(-cam.lastDy * 0.0014, -0.05, 0.05) * swayScale, 9, dt);

    const speedRatio = clamp(player.horizontalSpeed / 8.4, 0, 1);
    if (player.grounded) this._bobT += dt * (6.5 + speedRatio * 6);
    const bobAmp = speedRatio * 0.02 * swayScale;
    const bobX = Math.cos(this._bobT) * bobAmp;
    const bobY = Math.abs(Math.sin(this._bobT)) * -bobAmp * 0.8;

    // recoil kick decay
    this._kick = damp(this._kick, 0, 15, dt);
    this._kickRot = damp(this._kickRot, 0, 13, dt);

    const poseSpeed = this.reloading ? 12 : 15;
    this._pos.x = damp(this._pos.x, this._targetPos.x + this._swayX + bobX, poseSpeed, dt);
    this._pos.y = damp(this._pos.y, this._targetPos.y + this._swayY + bobY - (player.grounded ? 0 : 0.012), poseSpeed, dt);
    this._pos.z = damp(this._pos.z, this._targetPos.z + this._kick, poseSpeed, dt);
    this._rot.x = damp(this._rot.x, this._targetRot.x - this._kickRot, poseSpeed, dt);
    this._rot.y = damp(this._rot.y, this._targetRot.y + this._swayX * 1.6, poseSpeed, dt);
    this._rot.z = damp(this._rot.z, this._targetRot.z + this._swayX * 2.2, poseSpeed, dt);

    this.group.position.copy(this._pos);
    if (this.reloading) {
      this.group.position.add(this._reloadOffset);
      this.group.rotation.set(
        this._rot.x + this._reloadRot.x,
        this._rot.y + this._reloadRot.y,
        this._rot.z + this._reloadRot.z
      );
    } else {
      this.group.rotation.copy(this._rot);
    }

    // bolt / charging handle reciprocation
    const boltPhase = this._boltT / 0.05;
    this.model.bolt.position.z = this.model.boltHome + boltPhase * 0.055;

    this.model.muzzleFlash.update(dt);
  }

  fire() {
    const game = this.game;
    const player = game.player;
    const cam = game.playerCamera;

    this.ammo--;
    this._fireTimer = this.fireInterval;
    this._burstCount = Math.min(this._burstCount + 1, 16);
    this._burstDecay = 0.16;
    this._boltT = 0.05;
    this._kick = 0.055 + Math.random() * 0.015;
    this._kickRot = 0.075 + Math.random() * 0.02;
    player.stats.shotsFired++;

    // --- aim ray with spread ---
    _origin.copy(cam.camera.position);
    cam.getAimDirection(_dir);
    _right.set(1, 0, 0).applyQuaternion(cam.camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.camera.quaternion);
    const spread = this.getSpread();
    if (spread > 0) {
      _dir.addScaledVector(_right, gaussian() * spread);
      _dir.addScaledVector(_up, gaussian() * spread);
      _dir.normalize();
    }

    // --- muzzle position (view space -> world) ---
    this.model.muzzle.getWorldPosition(_muzzleWorld);
    _muzzleWorld.applyMatrix4(cam.camera.matrixWorld);

    // --- effects ---
    this.model.muzzleFlash.trigger();
    game.effects.muzzleLight(_muzzleWorld);
    game.effects.spawnCasing(_muzzleWorld, cam.camera.quaternion, this.model.ejectOffset);
    game.audio.play('rifleFire', { volume: 0.85, rate: 0.97 + Math.random() * 0.06 });

    // --- camera recoil ---
    const recoilScale = lerp(1, 0.62, this.adsAmount) * (player.crouching ? 0.8 : 1);
    cam.addRecoil(this.config.recoilPitch * recoilScale, (Math.random() - 0.5) * this.config.recoilYaw * recoilScale);
    cam.addShake(this.config.shake * recoilScale);

    // --- hitscan ---
    const hit = raycastFirst(_origin, _dir, this.range, game.raycastTargets);
    let tracerEnd;
    if (hit) {
      _hitPoint.copy(hit.point);
      tracerEnd = _hitPoint;
      this._resolveHit(hit, _dir);
    } else {
      _tmp.copy(_origin).addScaledVector(_dir, this.range);
      tracerEnd = _tmp;
    }
    game.effects.spawnTracer(_muzzleWorld, tracerEnd);
    game.lastPlayerShotTime = game.time;
    game.enemyManager.onGunshot(player.position, player);
  }

  _resolveHit(hit, dir) {
    const game = this.game;
    const obj = hit.object;
    const ud = obj.userData || {};

    if (ud.enemy && ud.enemy.alive) {
      const zone = ud.hitZone || 'body';
      const dmg = this.damage[zone] != null ? this.damage[zone] : this.damage.body;
      game.player.stats.hits++;
      game.player.stats.damageDealt += Math.min(dmg, ud.enemy.health);
      if (zone === 'head') game.player.stats.headshots++;

      const killed = ud.enemy.takeDamage(dmg, zone, hit.point, game.player);
      game.effects.spawnFleshHit(hit.point, hit.face ? hit.face.normal : null, zone === 'head');
      game.hud.showHitMarker(zone === 'head', killed);
      game.audio.play(zone === 'head' ? 'hitmarkerHead' : 'hitmarker', { volume: 0.55 });
      return;
    }

    // environment
    const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    if (obj.isInstancedMesh || obj.parent) {
      normal.transformDirection(obj.matrixWorld);
    }
    game.effects.spawnImpact(hit.point, normal, ud.surface || 'concrete');
    game.audio.play('impact', { position: hit.point, volume: 0.35 });
    void dir;
  }

  /** Keyframed reload: mag out, mag in, charge, settle. */
  _animateReload(t) {
    const mag = this.model.magazine;
    const home = this.model.magHome;
    const off = this._reloadOffset;
    const rot = this._reloadRot;

    if (t < 0.16) {
      // tilt in toward the body
      const k = t / 0.16;
      off.set(0, -0.02 * k, 0.02 * k);
      rot.set(0.1 * k, 0, 0);
      mag.position.copy(home);
    } else if (t < 0.34) {
      // magazine drops away
      const k = (t - 0.16) / 0.18;
      off.set(0, -0.02, 0.02);
      rot.set(0.1, 0, 0);
      mag.position.set(home.x, home.y - k * 0.42, home.z - k * 0.05);
      mag.rotation.set(k * 0.5, 0, k * 0.25);
      if (!this._magDropped && k > 0.5) {
        this._magDropped = true;
        this.game.audio.play('magOut', { volume: 0.6 });
      }
    } else if (t < 0.62) {
      // fresh magazine rises into place
      const k = (t - 0.34) / 0.28;
      off.set(0, -0.02 - 0.01 * Math.sin(k * Math.PI), 0.02);
      rot.set(0.1, 0, 0);
      mag.visible = true;
      mag.position.set(home.x, home.y - (1 - k) * 0.5, home.z);
      mag.rotation.set((1 - k) * 0.4, 0, 0);
    } else if (t < 0.72) {
      // seat it
      const k = (t - 0.62) / 0.1;
      mag.position.copy(home);
      mag.rotation.set(0, 0, 0);
      off.set(0, -0.02 + 0.012 * Math.sin(k * Math.PI), 0.02);
      rot.set(0.1 - 0.04 * Math.sin(k * Math.PI), 0, 0);
      if (!this._magSeated) {
        this._magSeated = true;
        this.game.audio.play('magIn', { volume: 0.75 });
        this._finishReload();
      }
    } else if (t < 0.9) {
      // charging handle
      const k = (t - 0.72) / 0.18;
      const pull = Math.sin(k * Math.PI);
      this.model.bolt.position.z = this.model.boltHome + pull * 0.09;
      off.set(-0.01 * pull, -0.02, 0.02 - 0.01 * pull);
      rot.set(0.1, -0.06 * pull, 0.05 * pull);
      if (!this._boltCycled && k > 0.45) {
        this._boltCycled = true;
        this.game.audio.play('boltRelease', { volume: 0.7 });
      }
    } else {
      const k = (t - 0.9) / 0.1;
      off.set(0, -0.02 * (1 - k), 0.02 * (1 - k));
      rot.set(0.1 * (1 - k), 0, 0);
      this.model.bolt.position.z = this.model.boltHome;
    }
  }

  dispose() {
    this.game.viewScene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.dispose && o.userData.ownMaterial) o.material.dispose();
    });
  }
}
