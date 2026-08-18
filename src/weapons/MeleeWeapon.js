/**
 * A melee weapon — the knife.
 *
 * Shares the viewmodel rig with the firearms (poses, sway, bob, the arms) but
 * replaces the hitscan with a swing: the attack takes a moment to land, and on
 * the impact frame anything inside a short arc in front of the player is cut.
 * That arc, rather than a single ray, is what makes a knife feel like a knife —
 * you do not have to be precisely on target, but you do have to be close.
 */

import * as THREE from 'three';
import { Weapon } from './Weapon.js';
import { raycastFirst } from '../utils/RaycastUtils.js';
import { buildWeaponBody } from './ModelRifle.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();

export class MeleeWeapon extends Weapon {
  /**
   * @param {object} game
   * @param {object} config stats, with `melee: true`
   * @param {THREE.Object3D} sourceModel the knife's root node
   * @param {object} descriptor the loadout entry (transform + arms fit)
   * @param {THREE.Object3D} [armsModel]
   */
  constructor(game, config, sourceModel, descriptor, armsModel = null) {
    game._pendingWeapon = { sourceModel, descriptor, armsModel };
    super(game, { ...config, melee: true, magSize: 0, reserveMax: 0 });
    game._pendingWeapon = null;

    this.ammo = 0;
    this.reserve = 0;
    this._swingT = -1;
    this._swingHit = false;
  }

  buildModel() {
    const { sourceModel, descriptor, armsModel } = this.game._pendingWeapon;
    const built = buildWeaponBody(this, sourceModel, descriptor, armsModel, { firearm: false });
    this.arms = built.arms;
    return built.model;
  }

  /** No magazine, so the only gate is the swing cooldown. */
  get canFire() {
    return this._fireTimer <= 0 && this._swingT < 0 && this.game.player.alive;
  }

  fire() {
    this._fireTimer = this.fireInterval;
    this._swingT = 0;
    this._swingHit = false;
    this._kick = 0.05;
    this._kickRot = 0.14;
    this.game.audio.play('whizz', { volume: 0.5, rate: 1.3 });
  }

  update(dt, input) {
    super.update(dt, input);

    if (this._swingT >= 0) {
      this._swingT += dt;
      // the cut lands part-way through the swing, not on the button press
      if (!this._swingHit && this._swingT >= this.config.hitDelay) {
        this._swingHit = true;
        this._resolveSwing();
      }
      if (this._swingT >= this.config.swingTime) this._swingT = -1;
      this._animateSwing();
    }
  }

  /** Arc through the viewmodel, driven off the swing's progress. */
  _animateSwing() {
    const k = Math.min(1, Math.max(0, this._swingT / this.config.swingTime));
    // out and across, then back: a sine hump for the reach, a cosine for the arc
    const reach = Math.sin(k * Math.PI);
    const across = Math.sin(k * Math.PI * 1.0) * (1 - k);
    this.group.position.z -= reach * 0.16;
    this.group.position.x -= across * 0.12;
    this.group.rotation.z += across * 0.9;
    this.group.rotation.y -= reach * 0.5;
  }

  /**
   * Cut everything alive inside the arc. Enemies are tested by angle and
   * distance rather than by a ray, then confirmed with a line-of-sight check so
   * a knife cannot reach through a wall.
   */
  _resolveSwing() {
    const game = this.game;
    const cam = game.playerCamera;
    _origin.copy(cam.camera.position);
    cam.getAimDirection(_dir);

    const range = this.config.range;
    const cosArc = Math.cos(this.config.arc * 0.5);
    let hitSomething = false;

    for (const enemy of game.enemyManager.enemies) {
      if (!enemy.alive) continue;
      enemy.getAimPoint(_aimPoint);
      _toTarget.copy(_aimPoint).sub(_origin);
      const dist = _toTarget.length();
      if (dist > range) continue;
      _toTarget.divideScalar(dist);
      if (_toTarget.dot(_dir) < cosArc) continue;

      // no cutting through walls
      const blocker = raycastFirst(_origin, _toTarget, dist, game.raycastTargets);
      if (blocker && !blocker.object.userData.enemy) continue;

      const zone = blocker && blocker.object.userData.hitZone === 'head' ? 'head' : 'body';
      const dmg = this.damage[zone] != null ? this.damage[zone] : this.damage.body;
      const point = blocker ? blocker.point : _aimPoint;

      game.player.stats.hits++;
      game.player.stats.damageDealt += Math.min(dmg, enemy.health);
      if (zone === 'head') game.player.stats.headshots++;
      const killed = enemy.takeDamage(dmg, zone, point, game.player);
      game.effects.spawnFleshHit(point, null, zone === 'head');
      game.hud.showHitMarker(zone === 'head', killed);
      game.audio.play(zone === 'head' ? 'hitmarkerHead' : 'hitmarker', { volume: 0.6 });
      hitSomething = true;
    }

    if (!hitSomething) {
      // a miss can still scrape the wall in front of you
      const hit = raycastFirst(_origin, _dir, range, game.raycastTargets);
      if (hit && !hit.object.userData.enemy) {
        game.effects.spawnImpact(hit.point, hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0),
          hit.object.userData.surface || 'concrete');
        game.audio.play('impact', { position: hit.point, volume: 0.3 });
      }
    }

    game.player.stats.shotsFired++;
    game.lastPlayerShotTime = game.time;
  }

  /** A knife has no sight picture, so the crosshair stays tight. */
  getSpread() {
    return 0;
  }

  dispose() {
    super.dispose();
    if (this.arms) this.arms.dispose();
  }
}
