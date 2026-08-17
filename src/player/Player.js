/**
 * Player: movement with acceleration/deceleration, gravity, jumping, crouching,
 * sprinting, AABB collision against the map, plus health, damage feedback and
 * respawning.
 *
 * The camera rig reads `eye` and the bob/dip values written here.
 */

import * as THREE from 'three';
import { moveAndCollide } from '../utils/Collision.js';
import { clamp, damp, lerp } from '../utils/MathUtils.js';

const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.15;
const RADIUS = 0.42;
const EYE_DROP = 0.2;

const SPEED_WALK = 5.4;
const SPEED_SPRINT = 8.4;
const SPEED_CROUCH = 2.7;
const SPEED_ADS = 3.5;
const SPEED_BACK = 0.78;      // multiplier when moving backwards

const ACCEL_GROUND = 14;
const DECEL_GROUND = 12;
const ACCEL_AIR = 2.6;
const GRAVITY = 24;
const JUMP_SPEED = 8.1;

const MAX_HEALTH = 100;
const REGEN_DELAY = 5.5;
const REGEN_RATE = 14;

export class Player {
  constructor(game) {
    this.game = game;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.radius = RADIUS;
    this.height = STAND_HEIGHT;
    this.stepHeight = 0.46;

    this.eye = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();

    this.health = MAX_HEALTH;
    this.maxHealth = MAX_HEALTH;
    this.alive = true;
    this.team = 'A';
    this.name = 'YOU';

    this.grounded = false;
    this.crouching = false;
    this.sprinting = false;
    this.wantsCrouch = false;
    this.speed = 0;
    this.horizontalSpeed = 0;

    this._collisionOut = { grounded: false, hitWall: false, hitCeiling: false, landed: false, groundY: 0 };
    this._wish = new THREE.Vector3();
    this._flat = new THREE.Vector3();
    this._coyote = 0;
    this._bobPhase = 0;
    this._stepDistance = 0;
    this._damageTimer = 0;
    this._jumpCooldown = 0;

    this.stats = { shotsFired: 0, hits: 0, headshots: 0, damageDealt: 0, deaths: 0, kills: 0 };
  }

  spawn(position, yaw = 0) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.health = MAX_HEALTH;
    this.alive = true;
    this.height = STAND_HEIGHT;
    this.crouching = false;
    this.grounded = true;
    this._damageTimer = 0;
    this._bobPhase = 0;
    this._stepDistance = 0;
    this.game.playerCamera.reset(yaw, 0);
    this._updateEye();
  }

  get eyeHeight() {
    return this.height - EYE_DROP;
  }

  _updateEye() {
    this.eye.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  update(dt, input) {
    const cam = this.game.playerCamera;

    if (!this.alive) {
      // simple death slump so the camera doesn't float
      this.velocity.x = damp(this.velocity.x, 0, 8, dt);
      this.velocity.z = damp(this.velocity.z, 0, 8, dt);
      this.velocity.y -= GRAVITY * dt;
      this.height = damp(this.height, 0.75, 6, dt);
      moveAndCollide(this.game.map.collision, this, dt, this._collisionOut);
      this.grounded = this._collisionOut.grounded;
      this._updateEye();
      return;
    }

    const map = this.game.map;
    const yaw = cam.yaw;

    // ---------------------------------------------------------- crouching --
    this.wantsCrouch = input.crouch;
    const targetHeight = this.wantsCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
    if (targetHeight > this.height) {
      // only stand up if there is room
      const room = !map.collision.isBlocked(this.position.x, this.position.y, this.position.z, this.radius, targetHeight);
      if (room) this.height = Math.min(targetHeight, this.height + dt * 5.2);
    } else if (targetHeight < this.height) {
      this.height = Math.max(targetHeight, this.height - dt * 7.0);
    }
    this.crouching = this.height < STAND_HEIGHT - 0.12;

    // ------------------------------------------------------------ desired --
    const ads = this.game.weapon ? this.game.weapon.adsAmount : 0;
    const wantSprint = input.sprint && input.forward > 0 && !this.crouching && ads < 0.25;
    this.sprinting = wantSprint && this.grounded;

    let maxSpeed = SPEED_WALK;
    if (this.crouching) maxSpeed = SPEED_CROUCH;
    else if (this.sprinting) maxSpeed = SPEED_SPRINT;
    else maxSpeed = lerp(SPEED_WALK, SPEED_ADS, ads);

    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    // forward = -Z rotated by yaw
    this.forward.set(-sinY, 0, -cosY);
    this.right.set(cosY, 0, -sinY);

    let fx = input.forward;
    const sx = input.strafe;
    if (fx < 0) fx *= SPEED_BACK;

    this._wish.set(
      this.forward.x * fx + this.right.x * sx,
      0,
      this.forward.z * fx + this.right.z * sx
    );
    const wishLen = Math.hypot(this._wish.x, this._wish.z);
    if (wishLen > 1) this._wish.multiplyScalar(1 / wishLen);

    const targetVX = this._wish.x * maxSpeed;
    const targetVZ = this._wish.z * maxSpeed;

    const moving = wishLen > 0.01;
    let accel;
    if (this.grounded) accel = moving ? ACCEL_GROUND : DECEL_GROUND;
    else accel = moving ? ACCEL_AIR : 0.4;

    this.velocity.x = damp(this.velocity.x, targetVX, accel, dt);
    this.velocity.z = damp(this.velocity.z, targetVZ, accel, dt);

    // ------------------------------------------------------------- jump ----
    this._jumpCooldown = Math.max(0, this._jumpCooldown - dt);
    if (this.grounded) this._coyote = 0.12;
    else this._coyote = Math.max(0, this._coyote - dt);

    if (input.jumpQueued && this._coyote > 0 && this._jumpCooldown <= 0) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
      this._coyote = 0;
      this._jumpCooldown = 0.22;
      this.game.audio.play('jump', { position: this.position });
    }

    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -55) this.velocity.y = -55;

    // ------------------------------------------------------------ collide --
    const out = this._collisionOut;
    const fallSpeed = -this.velocity.y;
    moveAndCollide(map.collision, this, dt, out);
    this.grounded = out.grounded;

    if (out.landed) {
      const strength = clamp((fallSpeed - 4) / 16, 0, 1);
      this.game.playerCamera.dip = 0.35 + strength * 0.9;
      this.game.audio.play('land', { position: this.position, volume: 0.4 + strength * 0.6 });
      if (strength > 0.05) this.game.playerCamera.addShake(strength * 0.06);
    }

    // safety net: never let the player leak out of the arena
    this.position.x = clamp(this.position.x, -58.4, 58.4);
    this.position.z = clamp(this.position.z, -43.4, 43.4);
    if (this.position.y < -4) {
      const spawn = map.getSpawn('A', null, 0);
      this.position.copy(spawn);
      this.velocity.set(0, 0, 0);
    }

    // -------------------------------------------------------- bob / steps --
    this.horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed = this.horizontalSpeed;
    const speedRatio = clamp(this.horizontalSpeed / SPEED_SPRINT, 0, 1);

    if (this.grounded && this.horizontalSpeed > 0.6) {
      this._bobPhase += dt * (7.4 + speedRatio * 5.6);
      this._stepDistance += this.horizontalSpeed * dt;
      const stride = this.sprinting ? 2.05 : this.crouching ? 1.5 : 2.35;
      if (this._stepDistance >= stride) {
        this._stepDistance = 0;
        this.game.audio.play('footstep', {
          position: this.position,
          volume: this.crouching ? 0.28 : this.sprinting ? 0.75 : 0.5,
          rate: 0.92 + Math.random() * 0.16
        });
      }
    } else {
      this._stepDistance = Math.min(this._stepDistance, 1.2);
    }

    const bobAmp = (this.crouching ? 0.018 : 0.032) * speedRatio * (1 - (this.game.weapon ? this.game.weapon.adsAmount : 0) * 0.7);
    const targetBobX = Math.cos(this._bobPhase) * bobAmp;
    const targetBobY = Math.abs(Math.sin(this._bobPhase * 1.0)) * -bobAmp * 1.15;
    cam.bob.x = damp(cam.bob.x, this.grounded ? targetBobX : 0, 12, dt);
    cam.bob.y = damp(cam.bob.y, this.grounded ? targetBobY : 0, 12, dt);

    // ------------------------------------------------------------- regen ----
    this._damageTimer += dt;
    if (this._damageTimer > REGEN_DELAY && this.health < MAX_HEALTH) {
      this.health = Math.min(MAX_HEALTH, this.health + REGEN_RATE * dt);
    }

    this._updateEye();
  }

  /**
   * @param {number} amount
   * @param {THREE.Vector3} fromPos attacker position (for the hit indicator)
   * @param {object} attacker enemy instance
   */
  takeDamage(amount, fromPos, attacker) {
    if (!this.alive) return;
    this.health -= amount;
    this._damageTimer = 0;

    const cam = this.game.playerCamera;
    cam.addShake(0.045 + Math.min(0.1, amount * 0.004));

    if (fromPos) {
      // Bearing of the shooter relative to where we are looking.
      // Forward is (-sin yaw, -cos yaw), so a direction d has yaw atan2(-dx,-dz).
      const dx = fromPos.x - this.position.x;
      const dz = fromPos.z - this.position.z;
      const bearing = Math.atan2(-dx, -dz);
      const rel = bearing - cam.yaw;   // 0 = dead ahead, ±π = behind
      cam.addPunch(-Math.sin(rel) * 0.02, -0.014);
      this.game.hud.showHitDirection(rel);
    }
    this.game.hud.flashDamage(amount);
    this.game.audio.play('playerHurt', { volume: 0.7 });

    if (this.health <= 0) {
      this.health = 0;
      this.die(attacker);
    }
  }

  die(attacker) {
    if (!this.alive) return;
    this.alive = false;
    this.stats.deaths++;
    this.velocity.x *= 0.3;
    this.velocity.z *= 0.3;
    this.game.onPlayerKilled(attacker);
  }
}
