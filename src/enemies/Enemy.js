/**
 * Enemy: an original low-poly humanoid operator with procedural animation
 * (idle / walk / run / aim / fire / death), per-part hit zones for the damage
 * model, physics-driven movement against the collision world, and a damage
 * health bar that only appears once it has been hit.
 *
 * All decision making lives in EnemyAI; this class is the body.
 */

import * as THREE from 'three';
import { moveAndCollide } from '../utils/Collision.js';
import { clamp, damp, lerp, angleDamp } from '../utils/MathUtils.js';
import { boxGeom, cylGeom, mergeParts } from '../world/Geo.js';
import { EnemyAI, AIState } from './EnemyAI.js';

const RADIUS = 0.42;
const STAND_HEIGHT = 1.78;
const CROUCH_HEIGHT = 1.22;
const GRAVITY = 24;
const MAX_HEALTH = 100;

const _v = new THREE.Vector3();

export class Enemy {
  constructor(manager, index, materials) {
    this.manager = manager;
    this.game = manager.game;
    this.index = index;
    this.mats = materials;
    this.name = `VULTURE ${String(index + 1).padStart(2, '0')}`;
    this.team = 'B';

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.radius = RADIUS;
    this.height = STAND_HEIGHT;
    this.stepHeight = 0.48;

    this.health = MAX_HEALTH;
    this.maxHealth = MAX_HEALTH;
    this.alive = false;
    this.active = false;

    this.facing = 0;          // body yaw
    this.aimPitch = 0;
    this.crouching = false;
    this.moving = false;
    this.running = false;
    this.firing = false;

    this._collisionOut = { grounded: false, hitWall: false, hitCeiling: false, landed: false, groundY: 0 };
    this.grounded = false;
    this._animPhase = Math.random() * 6.28;
    this._breathe = Math.random() * 6.28;
    this._muzzleTimer = 0;
    this._deathTimer = 0;
    this._deathDir = 1;
    this._healthBarTimer = 0;
    this._recoil = 0;
    this._aimBlend = 0;

    this.root = new THREE.Group();
    this.root.name = this.name;
    this._buildModel();
    this.root.visible = false;

    this.ai = new EnemyAI(this);
    this.eye = new THREE.Vector3();
    this.muzzleWorld = new THREE.Vector3();
  }

  /* ================================================================ model = */

  _buildModel() {
    const M = this.mats;
    const variant = this.index % 3;
    const fatigue = [M.fatigueA, M.fatigueB, M.fatigueC][variant];

    // ---------- torso ----------
    const torso = new THREE.Group();
    const torsoParts = [
      { geom: boxGeom(0.46, 0.44, 0.26, 3), pos: [0, 0.06, 0] },            // chest
      { geom: boxGeom(0.4, 0.2, 0.24, 3), pos: [0, -0.22, 0] },             // abdomen
      { geom: boxGeom(0.2, 0.14, 0.24, 3), pos: [0, 0.3, 0], scale: [1, 1, 1] } // neck base
    ];
    const torsoMesh = new THREE.Mesh(mergeParts(torsoParts), fatigue);
    torsoMesh.userData.hitZone = 'body';
    torsoMesh.userData.enemy = this;
    torso.add(torsoMesh);

    // plate carrier + pouches (armour reads as a separate silhouette)
    const vestParts = [
      { geom: boxGeom(0.5, 0.38, 0.3, 3), pos: [0, 0.05, 0] },
      { geom: boxGeom(0.16, 0.1, 0.08, 4), pos: [-0.12, -0.13, 0.17] },
      { geom: boxGeom(0.16, 0.1, 0.08, 4), pos: [0.12, -0.13, 0.17] },
      { geom: boxGeom(0.1, 0.12, 0.07, 4), pos: [0, -0.12, -0.18] },
      { geom: boxGeom(0.42, 0.06, 0.32, 4), pos: [0, 0.26, 0] }              // collar
    ];
    const vest = new THREE.Mesh(mergeParts(vestParts), M.vest);
    vest.userData.hitZone = 'body';
    vest.userData.enemy = this;
    torso.add(vest);
    torso.position.y = 1.18;

    // ---------- head ----------
    const headPivot = new THREE.Group();
    headPivot.position.y = 0.4;
    const headParts = [
      { geom: boxGeom(0.22, 0.24, 0.22, 4), pos: [0, 0.12, 0] },
      { geom: boxGeom(0.1, 0.08, 0.06, 4), pos: [0, 0.06, -0.13] }   // jaw/mask front
    ];
    const head = new THREE.Mesh(mergeParts(headParts), M.skin);
    head.userData.hitZone = 'head';
    head.userData.enemy = this;
    headPivot.add(head);

    const helmetParts = [
      { geom: boxGeom(0.27, 0.14, 0.28, 4), pos: [0, 0.22, 0.01] },
      { geom: boxGeom(0.29, 0.05, 0.3, 4), pos: [0, 0.14, 0.01] },
      { geom: boxGeom(0.05, 0.06, 0.05, 4), pos: [0.15, 0.2, 0.02] },   // side rail
      { geom: boxGeom(0.05, 0.06, 0.05, 4), pos: [-0.15, 0.2, 0.02] },
      { geom: boxGeom(0.07, 0.06, 0.09, 4), pos: [0, 0.28, 0.06] }      // NVG mount
    ];
    const helmet = new THREE.Mesh(mergeParts(helmetParts), M.helmet);
    helmet.userData.hitZone = 'head';
    helmet.userData.enemy = this;
    headPivot.add(helmet);

    const visor = new THREE.Mesh(boxGeom(0.19, 0.07, 0.03, 4), M.visor);
    visor.position.set(0, 0.15, -0.11);
    visor.userData.hitZone = 'head';
    visor.userData.enemy = this;
    headPivot.add(visor);
    torso.add(headPivot);

    // ---------- arms ----------
    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.28, 0.18, 0);
      const upper = new THREE.Mesh(boxGeom(0.13, 0.3, 0.14, 4), fatigue);
      upper.position.y = -0.15;
      upper.userData.hitZone = 'limb';
      upper.userData.enemy = this;
      shoulder.add(upper);
      const pad = new THREE.Mesh(boxGeom(0.15, 0.12, 0.16, 4), M.vest);
      pad.position.y = -0.03;
      pad.userData.hitZone = 'limb';
      pad.userData.enemy = this;
      shoulder.add(pad);

      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      const lower = new THREE.Mesh(boxGeom(0.115, 0.28, 0.125, 4), M.gloves);
      lower.position.y = -0.14;
      lower.userData.hitZone = 'limb';
      lower.userData.enemy = this;
      elbow.add(lower);
      shoulder.add(elbow);
      return { shoulder, elbow };
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);
    torso.add(armL.shoulder, armR.shoulder);

    // ---------- legs ----------
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, 0, 0);
      const thigh = new THREE.Mesh(boxGeom(0.17, 0.42, 0.18, 3), fatigue);
      thigh.position.y = -0.21;
      thigh.userData.hitZone = 'limb';
      thigh.userData.enemy = this;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      const shin = new THREE.Mesh(boxGeom(0.15, 0.4, 0.16, 3), fatigue);
      shin.position.y = -0.2;
      shin.userData.hitZone = 'limb';
      shin.userData.enemy = this;
      knee.add(shin);
      const boot = new THREE.Mesh(boxGeom(0.17, 0.12, 0.26, 4), M.boots);
      boot.position.set(0, -0.44, -0.04);
      boot.userData.hitZone = 'limb';
      boot.userData.enemy = this;
      knee.add(boot);
      hip.add(knee);
      return { hip, knee };
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);

    const hips = new THREE.Group();
    hips.position.y = 0.96;
    const hipMesh = new THREE.Mesh(boxGeom(0.38, 0.2, 0.24, 3), M.vest);
    hipMesh.userData.hitZone = 'body';
    hipMesh.userData.enemy = this;
    hips.add(hipMesh);
    hips.add(legL.hip, legR.hip);

    // ---------- weapon ----------
    const wParts = [
      { geom: boxGeom(0.05, 0.09, 0.34, 3), pos: [0, 0, -0.04] },
      { geom: boxGeom(0.04, 0.05, 0.2, 3), pos: [0, 0.02, -0.28] },
      { geom: cylGeom(0.012, 0.012, 0.2, 6), pos: [0, 0.03, -0.44], rot: [Math.PI / 2, 0, 0] },
      { geom: cylGeom(0.022, 0.02, 0.06, 6), pos: [0, 0.03, -0.56], rot: [Math.PI / 2, 0, 0] },
      { geom: boxGeom(0.04, 0.1, 0.06, 3), pos: [0, -0.09, -0.02], rot: [0.3, 0, 0] },  // mag
      { geom: boxGeom(0.045, 0.07, 0.14, 3), pos: [0, -0.01, 0.19] },                    // stock
      { geom: boxGeom(0.03, 0.02, 0.22, 4), pos: [0, 0.06, -0.06] }                      // rail
    ];
    const weapon = new THREE.Mesh(mergeParts(wParts), this.mats.gun);
    weapon.raycast = () => {}; // the gun must not soak bullets
    weapon.position.set(0, -0.26, -0.12);
    weapon.rotation.set(0, 0, 0);
    armR.elbow.add(weapon);

    // muzzle flash billboard for enemy fire
    const flash = new THREE.Sprite(this.mats.flash.clone());
    flash.scale.set(0.7, 0.7, 1);
    flash.position.set(0, 0.03, -0.6);
    flash.visible = false;
    // Raycaster ignores visibility and Sprite.raycast needs a camera, so this
    // must be opted out explicitly: enemies are a bullet raycast target.
    flash.raycast = () => {};
    weapon.add(flash);
    const muzzlePoint = new THREE.Object3D();
    muzzlePoint.position.set(0, 0.03, -0.6);
    weapon.add(muzzlePoint);

    // ---------- health bar ----------
    const barGroup = new THREE.Group();
    barGroup.position.y = 2.06;
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x120a0a, transparent: true, opacity: 0.8, depthTest: false })
    );
    barBg.renderOrder = 20;
    barBg.raycast = () => {};
    const barFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.055),
      new THREE.MeshBasicMaterial({ color: 0xff4a3a, depthTest: false })
    );
    barFill.position.z = 0.001;
    barFill.renderOrder = 21;
    barFill.raycast = () => {};
    barGroup.add(barBg, barFill);
    barGroup.visible = false;

    // ---------- assemble ----------
    const body = new THREE.Group();   // lean / bob container
    body.add(torso, hips, barGroup);
    this.root.add(body);

    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = this.game.map ? this.game.map.shadows : true;
        o.receiveShadow = false;
        o.userData.enemyPart = true;
      }
    });

    this.parts = {
      body, torso, hips, headPivot, head, helmet, visor,
      armL, armR, legL, legR, weapon, flash, muzzlePoint,
      barGroup, barFill
    };
  }

  /* ============================================================= lifecycle */

  spawn(position) {
    this.position.copy(position);
    this.position.y += 0.02;
    this.velocity.set(0, 0, 0);
    this.health = MAX_HEALTH;
    this.alive = true;
    this.active = true;
    this.height = STAND_HEIGHT;
    this.crouching = false;
    this.firing = false;
    this._deathTimer = 0;
    this._healthBarTimer = 0;
    this._recoil = 0;
    this._aimBlend = 0;
    this.facing = Math.atan2(-position.x, -position.z);
    this.root.visible = true;
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.facing, 0);
    this.parts.body.rotation.set(0, 0, 0);
    this.parts.body.position.set(0, 0, 0);
    this.parts.barGroup.visible = false;
    this.parts.flash.visible = false;
    this.ai.reset();
    this._updateEye();
  }

  deactivate() {
    this.active = false;
    this.alive = false;
    this.root.visible = false;
  }

  _updateEye() {
    this.eye.set(this.position.x, this.position.y + this.height - 0.22, this.position.z);
  }

  get eyePosition() { return this.eye; }

  /* ================================================================ damage */

  /** @returns {boolean} true when this shot killed the enemy */
  takeDamage(amount, zone, point, attacker) {
    if (!this.alive) return false;
    this.health -= amount;
    this._healthBarTimer = 3.4;
    this.parts.barGroup.visible = true;
    this.ai.onDamaged(attacker, point);

    if (this.health <= 0) {
      this.health = 0;
      this.die(attacker, zone);
      return true;
    }
    return false;
  }

  die(attacker, zone) {
    if (!this.alive) return;
    this.alive = false;
    this.firing = false;
    this.velocity.set(0, 0, 0);
    this._deathTimer = 0;
    this._deathDir = Math.random() < 0.5 ? -1 : 1;
    this.parts.barGroup.visible = false;
    this.parts.flash.visible = false;
    this.ai.state = AIState.DEAD;
    this.game.audio.play('enemyDeath', { position: this.position, volume: 0.8 });
    this.game.effects.spawnDeathPuff(this.position);
    this.manager.onEnemyKilled(this, attacker, zone);
  }

  /* ================================================================ update */

  update(dt) {
    if (!this.active) return;

    if (!this.alive) {
      this._updateDeath(dt);
      return;
    }

    this.ai.update(dt);

    // ---------------------------------------------------------- crouching --
    const targetHeight = this.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
    if (targetHeight > this.height) {
      if (!this.game.map.collision.isBlocked(this.position.x, this.position.y, this.position.z, this.radius, targetHeight)) {
        this.height = Math.min(targetHeight, this.height + dt * 3.4);
      }
    } else {
      this.height = Math.max(targetHeight, this.height - dt * 4.2);
    }

    // ------------------------------------------------------------ physics --
    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -45) this.velocity.y = -45;
    moveAndCollide(this.game.map.collision, this, dt, this._collisionOut);
    this.grounded = this._collisionOut.grounded;

    if (this.position.y < -4) {
      this.manager.respawn(this, 0.1);
      return;
    }

    this.root.position.copy(this.position);
    this._updateEye();

    // -------------------------------------------------------------- facing -
    this.root.rotation.y = angleDamp(this.root.rotation.y, this.facing, 9, dt);

    // ---------------------------------------------------------- animation --
    this._animate(dt);

    // ------------------------------------------------------- health bar ----
    if (this._healthBarTimer > 0) {
      this._healthBarTimer -= dt;
      const bar = this.parts.barGroup;
      if (this._healthBarTimer <= 0) {
        bar.visible = false;
      } else {
        const ratio = clamp(this.health / this.maxHealth, 0, 1);
        this.parts.barFill.scale.x = Math.max(0.001, ratio);
        this.parts.barFill.position.x = -0.34 * (1 - ratio);
        bar.position.y = this.height + 0.3;
        // billboard toward the camera
        _v.copy(this.game.camera.position);
        bar.rotation.y = Math.atan2(_v.x - this.position.x, _v.z - this.position.z) - this.root.rotation.y;
      }
    }

    if (this._muzzleTimer > 0) {
      this._muzzleTimer -= dt;
      if (this._muzzleTimer <= 0) this.parts.flash.visible = false;
    }
  }

  _updateDeath(dt) {
    this._deathTimer += dt;
    const t = Math.min(1, this._deathTimer / 0.75);
    const ease = 1 - (1 - t) * (1 - t);
    const body = this.parts.body;
    body.rotation.z = this._deathDir * ease * 1.45;
    body.rotation.x = ease * 0.35;
    body.position.y = -ease * 0.55;
    // limbs go slack
    this.parts.armL.shoulder.rotation.x = lerp(this.parts.armL.shoulder.rotation.x, 0.5, dt * 5);
    this.parts.armR.shoulder.rotation.x = lerp(this.parts.armR.shoulder.rotation.x, 0.3, dt * 5);
    this.parts.armR.elbow.rotation.x = lerp(this.parts.armR.elbow.rotation.x, -0.2, dt * 5);
    this.parts.legL.hip.rotation.x = lerp(this.parts.legL.hip.rotation.x, 0.25, dt * 5);
    this.parts.legR.hip.rotation.x = lerp(this.parts.legR.hip.rotation.x, -0.15, dt * 5);
    this.parts.headPivot.rotation.x = lerp(this.parts.headPivot.rotation.x, 0.3, dt * 5);

    if (this._deathTimer > 0.28 && !this._fallSoundPlayed) {
      this._fallSoundPlayed = true;
      this.game.audio.play('bodyFall', { position: this.position, volume: 0.6 });
    }

    // fade the corpse out just before it is recycled
    if (this._deathTimer > 2.4) {
      const k = clamp(1 - (this._deathTimer - 2.4) / 0.6, 0, 1);
      this.root.scale.setScalar(0.0001 + k);
    }
  }

  _animate(dt) {
    const p = this.parts;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moveRatio = clamp(speed / 5.6, 0, 1);
    this.moving = speed > 0.35;
    this.running = speed > 4.2;

    // aim blend: 0 = relaxed carry, 1 = shouldered
    const wantAim = this.ai.state === AIState.ATTACK || this.ai.state === AIState.TAKE_COVER;
    this._aimBlend = damp(this._aimBlend, wantAim ? 1 : 0, 7, dt);
    const aim = this._aimBlend;

    // stride
    const stride = this.running ? 11.5 : 8.2;
    if (this.moving) this._animPhase += dt * stride * (0.5 + moveRatio * 0.8);
    else this._animPhase = damp(this._animPhase % 6.283, 0, 5, dt);
    this._breathe += dt * 1.7;

    const swing = Math.sin(this._animPhase) * moveRatio;
    const swing2 = Math.sin(this._animPhase * 2);

    // legs
    p.legL.hip.rotation.x = swing * 0.72 - (this.crouching ? 0.5 : 0);
    p.legR.hip.rotation.x = -swing * 0.72 - (this.crouching ? 0.5 : 0);
    p.legL.knee.rotation.x = Math.max(0, -swing * 0.5) + 0.06 + (this.crouching ? 0.85 : 0);
    p.legR.knee.rotation.x = Math.max(0, swing * 0.5) + 0.06 + (this.crouching ? 0.85 : 0);

    // body bob + lean
    const bob = Math.abs(swing2) * 0.035 * moveRatio;
    p.body.position.y = -bob - (this.crouching ? 0.3 : 0);
    p.body.rotation.z = swing * 0.045;
    p.torso.rotation.y = swing * -0.12 * (1 - aim * 0.6);
    p.torso.rotation.x = moveRatio * 0.14 * (this.running ? 1.6 : 1) + Math.sin(this._breathe) * 0.012;

    // arms: relaxed swing blended toward a shouldered aim pose
    const relaxedL = swing * 0.5;
    const relaxedR = -swing * 0.5;
    const aimPitch = this.aimPitch;

    p.armR.shoulder.rotation.x = lerp(relaxedR - 0.15, -1.32 + aimPitch, aim);
    p.armR.shoulder.rotation.z = lerp(0.08, -0.16, aim);
    p.armR.shoulder.rotation.y = lerp(0, 0.1, aim);
    p.armR.elbow.rotation.x = lerp(-0.35, -0.62, aim);

    p.armL.shoulder.rotation.x = lerp(relaxedL - 0.15, -1.15 + aimPitch, aim);
    p.armL.shoulder.rotation.z = lerp(-0.08, 0.5, aim);
    p.armL.shoulder.rotation.y = lerp(0, -0.28, aim);
    p.armL.elbow.rotation.x = lerp(-0.35, -1.05, aim);

    // recoil kick pushes the shoulder back
    this._recoil = damp(this._recoil, 0, 16, dt);
    p.armR.shoulder.rotation.x += this._recoil * 0.5;
    p.torso.rotation.x -= this._recoil * 0.2;

    // head tracks the aim direction a little
    p.headPivot.rotation.x = damp(p.headPivot.rotation.x, aim * aimPitch * 0.8, 8, dt);
    p.headPivot.rotation.y = damp(p.headPivot.rotation.y, -p.torso.rotation.y * 0.5, 8, dt);
  }

  /** Visual + audio for one AI shot. */
  onFireVisuals() {
    this.parts.flash.visible = true;
    this.parts.flash.material.rotation = Math.random() * 6.28;
    this._muzzleTimer = 0.05;
    this._recoil = 0.28;
    this.parts.muzzlePoint.getWorldPosition(this.muzzleWorld);
    this.game.effects.muzzleLight(this.muzzleWorld, 3.2);
  }

  getMuzzleWorld(out) {
    this.parts.muzzlePoint.getWorldPosition(out);
    // if the arm animation has not settled, fall back to the eye
    if (!Number.isFinite(out.x)) out.copy(this.eye);
    return out;
  }

  /** Random point on the body used as an AI aim target. */
  getAimPoint(out) {
    out.set(this.position.x, this.position.y + this.height * 0.62, this.position.z);
    return out;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.root.parent?.remove(this.root);
  }
}

export { MAX_HEALTH as ENEMY_MAX_HEALTH, STAND_HEIGHT as ENEMY_HEIGHT };
