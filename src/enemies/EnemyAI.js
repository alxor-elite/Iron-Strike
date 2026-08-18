/**
 * EnemyAI — a per-enemy finite state machine.
 *
 * IDLE → PATROL → (detect) → CHASE → ATTACK ⇄ TAKE_COVER
 *                                 ↘ (lost contact) → SEARCH → PATROL
 *                                                        DEAD
 *
 * Perception combines distance, field of view and a line-of-sight raycast, and
 * builds up over time so enemies do not snap onto the player the instant a
 * pixel of them is exposed. Shooting is deliberately imperfect: every enemy has
 * its own reaction delay, aim-convergence time, accuracy and burst rhythm, and
 * fires along a jittered ray that is tested against the world before the
 * player, so bullets can be stopped by cover and plenty of them miss.
 *
 * Navigation uses the waypoint graph with A*, with straight-line shortcuts when
 * the path is clear.
 */

import * as THREE from 'three';
import { clamp, damp, randRange, randInt } from '../utils/MathUtils.js';
import { rayVsVerticalCylinder, pointRayDistance } from '../utils/RaycastUtils.js';

export const AIState = {
  IDLE: 'IDLE',
  PATROL: 'PATROL',
  SEARCH: 'SEARCH',
  CHASE: 'CHASE',
  ATTACK: 'ATTACK',
  TAKE_COVER: 'TAKE_COVER',
  DEAD: 'DEAD'
};

const PERCEPTION_INTERVAL = 0.13;
const MEMORY_TIME = 6.5;
const MAG_SIZE = 30;
const RELOAD_TIME = 2.6;

export class EnemyAI {
  constructor(enemy) {
    this.enemy = enemy;
    this.game = enemy.game;
    this.state = AIState.IDLE;
    this.stateTime = 0;

    // scratch vectors (no per-frame allocation)
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._goal = new THREE.Vector3();
    this._sep = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._normal = new THREE.Vector3();

    this.lastKnownPos = new THREE.Vector3();
    this._lastPos = new THREE.Vector3();
    this.path = [];
    this.pathIndex = 0;

    this.rollTraits();
    this.reset();
  }

  rollTraits() {
    this.reactionTime = randRange(0.22, 0.62);
    this.aimTime = randRange(0.34, 0.85);
    this.accuracy = randRange(0.46, 0.84);
    this.burstMin = randInt(3, 5);
    this.burstMax = randInt(5, 7);
    this.burstPause = randRange(0.42, 1.25);
    this.viewRange = randRange(40, 52);
    this.fireRange = randRange(34, 44);
    this.fovCos = Math.cos(randRange(1.05, 1.32));  // ~120°–150° total
    this.aggression = randRange(0.25, 0.9);
    this.preferredRange = randRange(9, 22);
    this.coverBias = randRange(0.25, 0.8);
    this.fireInterval = randRange(0.1, 0.13);
  }

  reset() {
    this.rollTraits();
    this.state = AIState.IDLE;
    this.stateTime = randRange(0, 0.6);
    this.awareness = 0;
    this.alerted = false;
    this.canSee = false;
    this.hasTarget = false;
    this.lastSeen = -100;
    this.lastKnownPos.set(0, 0, 0);
    this.path.length = 0;
    this.pathIndex = 0;
    this._perceptTimer = Math.random() * PERCEPTION_INTERVAL;
    this._repathTimer = 0;
    this._reactionTimer = 0;
    this._aimConverge = 0;
    this._fireTimer = 0;
    this._burstLeft = 0;
    this._burstCooldown = 0;
    this.ammo = MAG_SIZE;
    this._reloadTimer = 0;
    this._strafeDir = Math.random() < 0.5 ? -1 : 1;
    this._strafeTimer = randRange(0.8, 2.2);
    this._stuckTimer = 0;
    this._avoidTimer = 0;
    this._avoidDir = 1;
    this._lastPos.copy(this.enemy.position);
    this._searchTimer = 0;
    this._coverPoint = null;
    this._peekTimer = 0;
    this._lookYaw = 0;
    this.enemy.crouching = false;
  }

  get player() { return this.game.player; }

  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
    if (next === AIState.TAKE_COVER) this._coverPoint = null;
    if (next !== AIState.TAKE_COVER) this.enemy.crouching = false;
    if (next === AIState.SEARCH) this._searchTimer = randRange(5, 9);
  }

  /* ============================================================ perception */

  _updatePerception(dt) {
    const enemy = this.enemy;
    const player = this.player;
    const now = this.game.time;

    this._perceptTimer -= dt;
    if (this._perceptTimer > 0) return;
    this._perceptTimer = PERCEPTION_INTERVAL;

    this.canSee = false;
    if (!player.alive) {
      this.awareness = Math.max(0, this.awareness - 0.5);
      this.hasTarget = false;
      return;
    }

    const dx = player.position.x - enemy.position.x;
    const dz = player.position.z - enemy.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > this.viewRange * this.viewRange) {
      this.awareness = Math.max(0, this.awareness - PERCEPTION_INTERVAL * 0.4);
      this._checkMemory(now);
      return;
    }
    const dist = Math.sqrt(distSq);

    // field of view (widened once alerted — they know roughly where you are)
    const fwdX = -Math.sin(enemy.root.rotation.y);
    const fwdZ = -Math.cos(enemy.root.rotation.y);
    const dot = (dx * fwdX + dz * fwdZ) / Math.max(0.001, dist);
    const fovCos = this.alerted ? -0.35 : this.fovCos;
    if (dot < fovCos && dist > 3.5) {
      this.awareness = Math.max(0, this.awareness - PERCEPTION_INTERVAL * 0.3);
      this._checkMemory(now);
      return;
    }

    // line of sight to chest and, failing that, head
    const col = this.game.map.collision;
    const e = enemy.eye;
    let visible = col.losClear(
      e.x, e.y, e.z,
      player.position.x, player.position.y + player.height * 0.6, player.position.z
    );
    if (!visible) {
      visible = col.losClear(
        e.x, e.y, e.z,
        player.position.x, player.position.y + player.height - 0.18, player.position.z
      );
    }

    if (visible) {
      this.canSee = true;
      this.lastSeen = now;
      this.lastKnownPos.copy(player.position);

      // build up awareness: closer, faster, noisier players are spotted sooner
      let rate = 2.1 * clamp(1.25 - dist / this.viewRange, 0.32, 1.25);
      if (player.sprinting) rate *= 1.5;
      if (player.crouching) rate *= 0.65;
      if (this.game.time - this.game.lastPlayerShotTime < 1.2) rate *= 2.0;
      this.awareness = Math.min(1.6, this.awareness + rate * PERCEPTION_INTERVAL);
      if (this.awareness >= 1) {
        if (!this.alerted) {
          this.alerted = true;
          this._reactionTimer = this.reactionTime;
          this._aimConverge = 0;
        }
        this.hasTarget = true;
      }
    } else {
      this.awareness = Math.max(0, this.awareness - PERCEPTION_INTERVAL * 0.55);
      this._checkMemory(now);
    }
  }

  _checkMemory(now) {
    if (this.alerted && now - this.lastSeen > MEMORY_TIME) {
      this.alerted = false;
      this.hasTarget = false;
      this.awareness = 0;
    }
  }

  /** Someone fired nearby — investigate even without line of sight. */
  onGunshot(position, shooter) {
    if (!this.enemy.alive) return;
    if (shooter === this.enemy) return;
    const dx = position.x - this.enemy.position.x;
    const dz = position.z - this.enemy.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 55 * 55) return;
    const boost = clamp(1 - Math.sqrt(d2) / 55, 0.1, 1) * 0.75;
    this.awareness = Math.min(1.4, this.awareness + boost);
    if (!this.hasTarget) {
      this.lastKnownPos.copy(position);
      if (this.state === AIState.IDLE || this.state === AIState.PATROL) {
        this.setState(AIState.SEARCH);
        this._searchTimer = randRange(4, 7);
        this._repath(this.lastKnownPos);
      }
    }
  }

  onDamaged(attacker, point) {
    if (!this.enemy.alive) return;
    this.alerted = true;
    this.awareness = 1.3;
    this.hasTarget = true;
    this.lastSeen = this.game.time;
    if (attacker && attacker.position) this.lastKnownPos.copy(attacker.position);
    else if (point) this.lastKnownPos.copy(point);
    // flinch: shorten the reaction so being shot at provokes a response
    if (this._reactionTimer > 0.18) this._reactionTimer = 0.18;

    const hurt = this.enemy.health / this.enemy.maxHealth;
    if (hurt < 0.45 && Math.random() < this.coverBias && this.state !== AIState.TAKE_COVER) {
      this.setState(AIState.TAKE_COVER);
    } else if (this.state === AIState.IDLE || this.state === AIState.PATROL) {
      this.setState(AIState.CHASE);
    }
  }

  /* ================================================================ update */

  update(dt) {
    const enemy = this.enemy;
    if (!enemy.alive) return;

    this.stateTime += dt;
    this._updatePerception(dt);

    if (this._reactionTimer > 0) this._reactionTimer -= dt;
    if (this._reloadTimer > 0) {
      this._reloadTimer -= dt;
      if (this._reloadTimer <= 0) this.ammo = MAG_SIZE;
    }
    this._fireTimer -= dt;
    this._burstCooldown -= dt;
    this._strafeTimer -= dt;
    if (this._strafeTimer <= 0) {
      this._strafeTimer = randRange(1.0, 2.6);
      this._strafeDir *= -1;
    }

    // aim convergence: 0 right after acquiring, 1 once settled on target
    if (this.hasTarget && this.canSee) {
      this._aimConverge = Math.min(1, this._aimConverge + dt / this.aimTime);
    } else {
      this._aimConverge = Math.max(0, this._aimConverge - dt * 0.7);
    }

    switch (this.state) {
      case AIState.IDLE: this._idle(dt); break;
      case AIState.PATROL: this._patrol(dt); break;
      case AIState.SEARCH: this._search(dt); break;
      case AIState.CHASE: this._chase(dt); break;
      case AIState.ATTACK: this._attack(dt); break;
      case AIState.TAKE_COVER: this._takeCover(dt); break;
      default: break;
    }
  }

  /* ================================================================ states */

  _idle(dt) {
    this._stop(dt);
    this._lookAround(dt);
    if (this.hasTarget) { this.setState(AIState.CHASE); return; }
    if (this.stateTime > randRange(0.8, 2.2)) this.setState(AIState.PATROL);
  }

  _patrol(dt) {
    if (this.hasTarget) { this.setState(AIState.CHASE); return; }
    if (this.awareness > 0.45) { this.setState(AIState.SEARCH); return; }

    if (this.path.length === 0 || this.pathIndex >= this.path.length) {
      const nav = this.game.map.navGraph;
      // bias part of the time toward the player's area so fights keep happening
      let node;
      if (Math.random() < 0.45 && this.player.alive) {
        node = nav.nearestNode(this._randomNear(this.player.position, 22));
      }
      if (!node) node = nav.randomNodeFar(this.enemy.position, 20);
      if (node) this._repath(node.pos);
      else { this.setState(AIState.IDLE); return; }
    }

    const arrived = this._followPath(dt, 3.1);
    if (arrived) this.setState(AIState.IDLE);
  }

  _search(dt) {
    if (this.hasTarget) { this.setState(AIState.CHASE); return; }
    this._searchTimer -= dt;
    if (this._searchTimer <= 0) { this.setState(AIState.PATROL); return; }

    if (this.path.length === 0 || this.pathIndex >= this.path.length) {
      // sweep around the last known position
      const target = this._randomNear(this.lastKnownPos, 9);
      const node = this.game.map.navGraph.nearestNode(target);
      if (node) this._repath(node.pos);
      else { this.setState(AIState.PATROL); return; }
    }
    const arrived = this._followPath(dt, 4.4);
    if (arrived) {
      this._stop(dt);
      this._lookAround(dt);
    }
  }

  _chase(dt) {
    if (!this.hasTarget && this.game.time - this.lastSeen > MEMORY_TIME * 0.5) {
      this.setState(AIState.SEARCH);
      this._repath(this.lastKnownPos);
      return;
    }

    const dist = this._distToPlayer();
    if (this.canSee && dist < this.fireRange && this._reactionTimer <= 0) {
      this.setState(AIState.ATTACK);
      return;
    }

    // repath toward the target regularly while pursuing
    this._repathTimer -= dt;
    if (this._repathTimer <= 0 || this.path.length === 0 || this.pathIndex >= this.path.length) {
      this._repathTimer = randRange(0.55, 1.0);
      this._repath(this.hasTarget ? this.player.position : this.lastKnownPos);
    }

    this._followPath(dt, dist > 26 ? 5.5 : 4.6);
    if (this.canSee) this._facePlayer(dt);
  }

  _attack(dt) {
    const enemy = this.enemy;
    const player = this.player;

    if (!player.alive) { this.setState(AIState.SEARCH); return; }
    if (!this.canSee) {
      // lost the shot — push up or search
      if (this.game.time - this.lastSeen > 1.4) {
        this.setState(this.hasTarget ? AIState.CHASE : AIState.SEARCH);
        this._repath(this.lastKnownPos);
      } else {
        this._facePlayer(dt);
        this._stop(dt);
      }
      return;
    }

    const dist = this._distToPlayer();
    if (dist > this.fireRange * 1.12) { this.setState(AIState.CHASE); return; }

    this._facePlayer(dt);

    // reload out of sight if possible, otherwise duck into cover
    if (this.ammo <= 0 && this._reloadTimer <= 0) {
      this._reloadTimer = RELOAD_TIME;
      if (Math.random() < this.coverBias) { this.setState(AIState.TAKE_COVER); return; }
    }

    // occasionally break to cover to avoid standing in the open forever
    if (this.stateTime > randRange(3.5, 7) && Math.random() < 0.02 + this.coverBias * 0.03) {
      this.setState(AIState.TAKE_COVER);
      return;
    }

    // --- positioning: hold a preferred range and strafe ---
    const near = this.preferredRange * 0.62;
    const far = this.preferredRange * 1.45;
    this._dir.set(player.position.x - enemy.position.x, 0, player.position.z - enemy.position.z);
    const len = this._dir.length() || 1;
    this._dir.multiplyScalar(1 / len);

    let moveX = 0, moveZ = 0;
    let speed = 0;
    if (dist < near) {
      moveX = -this._dir.x; moveZ = -this._dir.z;
      speed = 3.2;
    } else if (dist > far) {
      moveX = this._dir.x; moveZ = this._dir.z;
      speed = 4.2 * (0.6 + this.aggression * 0.6);
    } else {
      // strafe for a moving target profile
      moveX = -this._dir.z * this._strafeDir;
      moveZ = this._dir.x * this._strafeDir;
      speed = 2.5;
    }

    // don't strafe off a ledge or into a wall: probe ahead
    this._goal.set(
      enemy.position.x + moveX * 1.4,
      enemy.position.y,
      enemy.position.z + moveZ * 1.4
    );
    const col = this.game.map.collision;
    const groundAhead = col.groundHeightAt(this._goal.x, this._goal.z, enemy.position.y + 1.0, 0.4);
    if (Math.abs(groundAhead - enemy.position.y) > 0.7 ||
        col.isBlocked(this._goal.x, groundAhead + 0.05, this._goal.z, enemy.radius, enemy.height)) {
      this._strafeDir *= -1;
      moveX = 0; moveZ = 0; speed = 0;
    }

    this._steer(dt, moveX, moveZ, speed);
    this._tryShoot(dt);
  }

  _takeCover(dt) {
    const enemy = this.enemy;

    if (!this._coverPoint) {
      const threat = this.hasTarget ? this.player.position : this.lastKnownPos;
      const cp = this.game.map.navGraph.findCover(enemy.position, threat, 22);
      if (cp) {
        this._coverPoint = cp;
        this._repath(cp.pos);
        this._peekTimer = randRange(1.6, 3.4);
      } else {
        // nowhere to hide: keep fighting
        this.setState(this.canSee ? AIState.ATTACK : AIState.CHASE);
        return;
      }
    }

    const arrived = this._followPath(dt, 5.0);
    const dx = enemy.position.x - this._coverPoint.pos.x;
    const dz = enemy.position.z - this._coverPoint.pos.z;
    const atCover = arrived || dx * dx + dz * dz < 1.4;

    if (atCover) {
      this._stop(dt);
      enemy.crouching = this._coverPoint.coverHeight < 1.5;
      this._facePlayer(dt);
      this._peekTimer -= dt;
      if (this._reloadTimer <= 0 && this.ammo <= 0) this.ammo = MAG_SIZE;
      if (this._peekTimer <= 0) {
        enemy.crouching = false;
        if (this.canSee) this._tryShoot(dt);
        if (this._peekTimer < -randRange(1.2, 2.6)) {
          this.setState(this.hasTarget ? AIState.ATTACK : AIState.SEARCH);
        }
      }
    }

    if (this.stateTime > 9) this.setState(this.hasTarget ? AIState.ATTACK : AIState.SEARCH);
  }

  /* ============================================================== shooting */

  _tryShoot(dt) {
    void dt;
    if (this._reloadTimer > 0 || this._reactionTimer > 0) return;
    if (this.ammo <= 0) return;
    if (this._burstLeft <= 0) {
      if (this._burstCooldown > 0) return;
      this._burstLeft = randInt(this.burstMin, this.burstMax);
    }
    if (this._fireTimer > 0) return;

    this._fireTimer = this.fireInterval;
    this._burstLeft--;
    if (this._burstLeft <= 0) {
      this._burstCooldown = this.burstPause * randRange(0.8, 1.3);
    }
    this._fireShot();
  }

  _fireShot() {
    const enemy = this.enemy;
    const player = this.player;
    const game = this.game;

    this.ammo--;
    enemy.onFireVisuals();
    enemy.getMuzzleWorld(this._muzzle);
    game.audio.play('enemyFire', {
      position: enemy.position, volume: 0.5, rate: 0.94 + Math.random() * 0.12, refDistance: 10
    });

    // aim at the player's centre of mass, then add error
    this._aim.set(player.position.x, player.position.y + player.height * 0.58, player.position.z);

    // total angular error: accuracy, aim convergence, movement of both parties,
    // and a falloff so long-range fire is suppressive rather than lethal
    const distance = this._muzzle.distanceTo(this._aim);
    let spread = (1 - this.accuracy) * 0.075 + 0.008;
    spread += (1 - this._aimConverge) * 0.075;
    spread += clamp((distance - 16) / 34, 0, 1) * 0.022;
    if (enemy.moving) spread += 0.022;
    spread += clamp(player.horizontalSpeed / 8.4, 0, 1) * 0.02;
    if (player.crouching) spread += 0.006;
    if (enemy.crouching) spread *= 0.8;
    // convert the angle to a lateral offset at the target distance
    const off = spread * distance;
    this._aim.x += randRange(-off, off);
    this._aim.y += randRange(-off * 0.75, off * 0.85);
    this._aim.z += randRange(-off, off);

    this._dir.subVectors(this._aim, this._muzzle);
    const len = this._dir.length();
    if (len < 0.01) return;
    this._dir.multiplyScalar(1 / len);

    // world occlusion first — cover actually protects the player
    const maxRange = 90;
    const hit = game.map.collision.raycast(
      this._muzzle.x, this._muzzle.y, this._muzzle.z,
      this._dir.x, this._dir.y, this._dir.z, maxRange
    );
    const solidDist = hit ? hit.distance : maxRange;

    // analytic player capsule test
    const t = rayVsVerticalCylinder(
      this._muzzle.x, this._muzzle.y, this._muzzle.z,
      this._dir.x, this._dir.y, this._dir.z,
      player.position.x, player.position.z,
      player.position.y + 0.05, player.position.y + player.height,
      player.radius * 0.82
    );

    if (t >= 0 && t < solidDist && player.alive) {
      const hitY = this._muzzle.y + this._dir.y * t;
      const headY = player.position.y + player.height - 0.28;
      const damage = hitY > headY ? 22 : 10;
      this._end.copy(this._muzzle).addScaledVector(this._dir, t);
      game.effects.spawnTracer(this._muzzle, this._end, 0.8);
      player.takeDamage(damage, enemy.position, enemy);
    } else {
      this._end.copy(this._muzzle).addScaledVector(this._dir, solidDist);
      game.effects.spawnTracer(this._muzzle, this._end, 0.8);
      if (hit) {
        this._normal.set(hit.nx, hit.ny, hit.nz);
        if (this._normal.lengthSq() < 0.01) this._normal.copy(this._dir).negate();
        game.effects.spawnImpact(this._end, this._normal, 'concrete');
      }
      // near miss cue
      const pr = pointRayDistance(
        player.position.x, player.position.y + player.height * 0.7, player.position.z,
        this._muzzle.x, this._muzzle.y, this._muzzle.z,
        this._dir.x, this._dir.y, this._dir.z
      );
      if (pr.distance < 1.5 && pr.t > 0 && pr.t < solidDist + 2) {
        game.audio.play('whizz', { volume: 0.5 * (1 - pr.distance / 1.5) });
      }
    }
  }

  /* ============================================================== movement */

  _repath(targetPos) {
    if (!targetPos) return;
    const nav = this.game.map.navGraph;
    const col = this.game.map.collision;
    const p = this.enemy.position;
    const dx = targetPos.x - p.x, dz = targetPos.z - p.z;

    // straight shot on roughly one level? skip the graph entirely
    if (dx * dx + dz * dz < 484 && Math.abs(targetPos.y - p.y) < 0.6 &&
        col.pathClear(p.x, p.y, p.z, targetPos.x, targetPos.y, targetPos.z, this.enemy.radius + 0.06)) {
      this.path.length = 0;
      this.path.push(new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z));
      this.pathIndex = 0;
      return;
    }

    const path = nav.findPath(this.enemy.position, targetPos);
    this.path = path;
    this.pathIndex = 0;
    if (path.length === 0) {
      // unreachable: fall back to a straight nudge so we never freeze
      this.path = [new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z)];
    }
  }

  /** @returns {boolean} true when the path is exhausted */
  _followPath(dt, speed) {
    if (this.pathIndex >= this.path.length) { this._stop(dt); return true; }
    const enemy = this.enemy;
    const wp = this.path[this.pathIndex];

    const dx = wp.x - enemy.position.x;
    const dz = wp.z - enemy.position.z;
    const d2 = dx * dx + dz * dz;
    const reach = this.pathIndex === this.path.length - 1 ? 1.1 : 1.5;
    if (d2 < reach * reach) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) { this._stop(dt); return true; }
      return false;
    }

    const inv = 1 / Math.sqrt(d2);
    let dirX = dx * inv;
    let dirZ = dz * inv;

    // While recovering from being wedged, bias the heading sideways so the
    // body slides along whatever it is caught on instead of pressing into it.
    if (this._avoidTimer > 0) {
      this._avoidTimer -= dt;
      const s = this._avoidDir * 1.2;             // ~50° of lateral bias
      const nx = dirX - dirZ * s;
      const nz = dirZ + dirX * s;
      const l = Math.hypot(nx, nz) || 1;
      dirX = nx / l;
      dirZ = nz / l;
    }

    this._steer(dt, dirX, dirZ, speed);

    if (!this.canSee || this.state === AIState.PATROL || this.state === AIState.SEARCH) {
      this.enemy.facing = Math.atan2(-dx, -dz);
    }

    this._checkStuck(dt, speed);
    return false;
  }

  /**
   * Real displacement, not intended velocity: collision response zeroes the
   * velocity of a wedged actor *after* steering, so the only reliable signal is
   * how far the body actually moved.
   */
  _checkStuck(dt, speed) {
    const enemy = this.enemy;
    const moved = Math.hypot(
      enemy.position.x - this._lastPos.x,
      enemy.position.z - this._lastPos.z
    ) / Math.max(dt, 1e-4);
    this._lastPos.copy(enemy.position);

    if (speed > 0.5 && moved < speed * 0.35) {
      this._stuckTimer += dt;
    } else {
      this._stuckTimer = Math.max(0, this._stuckTimer - dt * 2);
      return;
    }

    if (this._stuckTimer > 0.4 && this._avoidTimer <= 0) {
      // first response: slide sideways, and hop in case it is a low ledge
      this._avoidTimer = randRange(0.6, 1.2);
      this._avoidDir = Math.random() < 0.5 ? -1 : 1;
      if (enemy.grounded) enemy.velocity.y = 6.2;
    }
    if (this._stuckTimer > 1.3) {
      // second response: give up on this waypoint and re-route
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        const node = this.game.map.navGraph.randomNodeFar(enemy.position, 8);
        if (node) this._repath(node.pos);
      }
      this._stuckTimer = 0.6;
    }
    if (this._stuckTimer > 2.6) {
      // last resort: nothing is working, so pop back onto the waypoint graph
      this._unstick();
      this._stuckTimer = 0;
    }
  }

  /** Snap to the nearest navigation node, but never in the player's view. */
  _unstick() {
    const enemy = this.enemy;
    const col = this.game.map.collision;
    const player = this.player;
    if (col.losClear(
      enemy.eye.x, enemy.eye.y, enemy.eye.z,
      player.position.x, player.position.y + 1.4, player.position.z
    )) return; // visible — a teleport would be obvious, keep struggling

    const node = this.game.map.navGraph.nearestNode(enemy.position, 14);
    if (!node) return;
    if (col.isBlocked(node.x, node.y + 0.05, node.z, enemy.radius, enemy.height)) return;
    enemy.position.set(node.x, node.y + 0.02, node.z);
    enemy.velocity.set(0, 0, 0);
    this._lastPos.copy(enemy.position);
    this.path.length = 0;
    this.pathIndex = 0;
  }

  /** Accelerate toward a horizontal direction, with separation from allies. */
  _steer(dt, dirX, dirZ, speed) {
    const enemy = this.enemy;
    if (speed <= 0) { this._stop(dt); return; }

    // separation so they don't stack on top of each other
    this._sep.set(0, 0, 0);
    const others = this.game.enemyManager.enemies;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === enemy || !o.alive) continue;
      const ox = enemy.position.x - o.position.x;
      const oz = enemy.position.z - o.position.z;
      const d2 = ox * ox + oz * oz;
      if (d2 > 6.25 || d2 < 0.0001) continue;
      const f = (1 - Math.sqrt(d2) / 2.5) / Math.sqrt(d2);
      this._sep.x += ox * f;
      this._sep.z += oz * f;
    }

    let tx = dirX + this._sep.x * 0.9;
    let tz = dirZ + this._sep.z * 0.9;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;

    enemy.velocity.x = damp(enemy.velocity.x, tx * speed, 11, dt);
    enemy.velocity.z = damp(enemy.velocity.z, tz * speed, 11, dt);
  }

  _stop(dt) {
    const v = this.enemy.velocity;
    v.x = damp(v.x, 0, 12, dt);
    v.z = damp(v.z, 0, 12, dt);
  }

  _facePlayer(dt) {
    void dt;
    const enemy = this.enemy;
    const p = this.hasTarget ? this.player.position : this.lastKnownPos;
    enemy.facing = Math.atan2(-(p.x - enemy.position.x), -(p.z - enemy.position.z));
    const dy = (p.y + this.player.height * 0.6) - enemy.eye.y;
    const flat = Math.hypot(p.x - enemy.position.x, p.z - enemy.position.z);
    enemy.aimPitch = clamp(Math.atan2(dy, Math.max(0.5, flat)), -0.7, 0.7);
  }

  _lookAround(dt) {
    this._lookYaw += dt * 0.9;
    const sweep = Math.sin(this._lookYaw) * 1.1;
    const base = this.hasTarget || this.awareness > 0.3
      ? Math.atan2(-(this.lastKnownPos.x - this.enemy.position.x), -(this.lastKnownPos.z - this.enemy.position.z))
      : this.enemy.facing;
    this.enemy.facing = base + sweep * 0.35;
    this.enemy.aimPitch = damp(this.enemy.aimPitch, 0, 4, dt);
  }

  _distToPlayer() {
    const dx = this.player.position.x - this.enemy.position.x;
    const dz = this.player.position.z - this.enemy.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  _randomNear(pos, radius) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.35 + Math.random() * 0.65);
    this._goal.set(pos.x + Math.cos(a) * r, pos.y, pos.z + Math.sin(a) * r);
    return this._goal;
  }

  /** Debug label for the HUD/scoreboard. */
  get stateLabel() {
    return this.state;
  }
}
