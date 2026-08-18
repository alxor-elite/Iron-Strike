/**
 * EnemyManager: owns the enemy squad, the shared material set, spawning and
 * respawning, and broadcasts gunshot events so the AI can react to noise.
 *
 * Enemies are pooled — killing one hides the body, then reuses the same object
 * for the next spawn, so no geometry is ever rebuilt mid-match.
 */

import * as THREE from 'three';
import { Enemy } from './Enemy.js';
import { AIState } from './EnemyAI.js';
import { glowTexture } from '../world/Textures.js';
import { randRange } from '../utils/MathUtils.js';
import { RIFLE_MODEL, ENEMY_RIFLE } from '../weapons/Loadout.js';
import { collectParts, anchorGunParts, prepareGunMaterial } from '../weapons/GunGeometry.js';

const CORPSE_TIME = 3.0;
const RESPAWN_TIME = 3.0;
const SAFE_SPAWN_DIST = 26;

export class EnemyManager {
  constructor(game, count = 6) {
    this.game = game;
    this.count = count;

    this.group = new THREE.Group();
    this.group.name = 'enemies';
    game.scene.add(this.group);

    this.materials = createEnemyMaterials();
    // the squad carries the same rifle the player does, when it is available
    this.gunAsset = createEnemyGun(game.loadout && game.loadout.rifle);
    this.enemies = [];
    this._respawnQueue = [];

    for (let i = 0; i < count; i++) {
      const e = new Enemy(this, i, this.materials, this.gunAsset);
      this.group.add(e.root);
      this.enemies.push(e);
    }
  }

  /** Spawn (or respawn) the whole squad, staggered so they trickle in. */
  spawnAll() {
    this._respawnQueue.length = 0;
    this.enemies.forEach((e, i) => {
      e.deactivate();
      this._respawnQueue.push({ enemy: e, time: 0.25 + i * 0.45 });
    });
  }

  reset() {
    this.enemies.forEach((e) => {
      e.deactivate();
      e.root.scale.setScalar(1);
      e._fallSoundPlayed = false;
    });
    this.spawnAll();
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  _spawn(enemy) {
    const map = this.game.map;
    const player = this.game.player;
    const spawn = map.getSpawn('B', player.position, SAFE_SPAWN_DIST);
    enemy.root.scale.setScalar(1);
    enemy._fallSoundPlayed = false;
    // nudge so several enemies spawning together don't overlap
    const jitterX = randRange(-1.6, 1.6);
    const jitterZ = randRange(-1.6, 1.6);
    const pos = spawn.clone();
    if (!map.collision.isBlocked(pos.x + jitterX, pos.y + 0.1, pos.z + jitterZ, 0.45, 1.8)) {
      pos.x += jitterX;
      pos.z += jitterZ;
    }
    enemy.spawn(pos);
    this.game.audio.play('spawn', { position: pos, volume: 0.25 });
  }

  respawn(enemy, delay = RESPAWN_TIME) {
    enemy.deactivate();
    this._respawnQueue.push({ enemy, time: delay });
  }

  onEnemyKilled(enemy, attacker, zone) {
    const byPlayer = attacker === this.game.player;
    this.game.match.registerKill(byPlayer ? 'A' : 'B', {
      killer: byPlayer ? this.game.player.name : 'FRIENDLY FIRE',
      victim: enemy.name,
      headshot: zone === 'head',
      byPlayer
    });
    if (byPlayer) {
      this.game.player.stats.kills++;
      this.game.hud.showKillPopup(enemy.name, zone === 'head');
      // scavenged magazines: 150 rounds would never cover a 30-kill match
      for (const w of this.game.weapons) {
        if (!w.melee) w.reserve = Math.min(w.reserveMax, w.reserve + 25);
      }
    }
    // schedule the corpse for cleanup, then a respawn
    this._respawnQueue.push({ enemy, time: CORPSE_TIME + RESPAWN_TIME, corpse: true });
  }

  /** Broadcast: someone fired at `position`. */
  onGunshot(position, shooter) {
    for (const e of this.enemies) {
      if (e.alive) e.ai.onGunshot(position, shooter);
    }
  }

  update(dt) {
    // respawn timers
    for (let i = this._respawnQueue.length - 1; i >= 0; i--) {
      const item = this._respawnQueue[i];
      item.time -= dt;
      if (item.corpse && item.time <= RESPAWN_TIME && item.enemy.active) {
        item.enemy.deactivate();
      }
      if (item.time <= 0) {
        this._respawnQueue.splice(i, 1);
        if (this.game.match.running) this._spawn(item.enemy);
      }
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.active) e.update(dt);
    }
  }

  /** Nearest living enemy in the crosshair-ish direction (for the HUD tint). */
  getEnemyUnderCrosshair(origin, direction, maxDist = 90) {
    let best = null;
    let bestDot = 0.9986; // ~3° cone
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.position.x - origin.x;
      const dy = (e.position.y + e.height * 0.6) - origin.y;
      const dz = e.position.z - origin.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > maxDist) continue;
      const dot = (dx * direction.x + dy * direction.y + dz * direction.z) / len;
      if (dot > bestDot) { bestDot = dot; best = e; }
    }
    return best;
  }

  /** Snapshot for the scoreboard. */
  getRoster() {
    return this.enemies.map((e) => ({
      name: e.name,
      alive: e.alive,
      state: e.ai ? e.ai.state : AIState.IDLE,
      health: Math.round(e.health)
    }));
  }

  dispose() {
    this.enemies.forEach((e) => e.dispose());
    Object.values(this.materials).forEach((m) => m && m.dispose && m.dispose());
    if (this.gunAsset) {
      this.gunAsset.forEach((p) => { p.geometry.dispose(); p.material.dispose(); });
    }
    this.game.scene.remove(this.group);
  }
}

/**
 * One shared rifle geometry for the whole squad, anchored in the hand space the
 * enemy rig expects. Returns null when no model pack is loaded, in which case
 * the enemies fall back to their procedural gun.
 */
function createEnemyGun(model) {
  if (!model) return null;
  const parts = collectParts(model);
  anchorGunParts(parts, {
    basis: RIFLE_MODEL.transform.basis,
    length: ENEMY_RIFLE.length,
    muzzleZ: ENEMY_RIFLE.muzzleZ,
    barrelY: ENEMY_RIFLE.barrelY
  });
  return parts.map((p) => ({
    geometry: p.geometry,
    material: prepareGunMaterial(p.material, RIFLE_MODEL.transform.material)
  }));
}

function createEnemyMaterials() {
  // Every part carries a little self-illumination keyed off its own colour, so
  // an operator standing in a building's shadow still reads as a figure rather
  // than a black cut-out — the price of a bright midday sun is deep shade.
  const std = (color, roughness = 0.85, metalness = 0.08) => new THREE.MeshStandardMaterial({
    color, roughness, metalness,
    emissive: new THREE.Color(color).multiplyScalar(0.55),
    emissiveIntensity: 0.5
  });
  return {
    fatigueA: std(0x5c6350),
    fatigueB: std(0x4e545a),
    fatigueC: std(0x685c4a),
    vest: std(0x3a3936, 0.78, 0.12),
    helmet: std(0x373b3d, 0.7, 0.2),
    visor: new THREE.MeshBasicMaterial({ color: 0xff5334 }),
    skin: std(0x8a6b55, 0.9, 0.02),
    gloves: std(0x2e2b27, 0.95, 0.02),
    boots: std(0x252321, 0.9, 0.05),
    gun: std(0x3b4045, 0.5, 0.6),
    flash: new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffd27a, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }),
    // Threat halo. Sits at the operator's centre of mass and is occluded by the
    // body itself, so what reads on screen is a glow around the silhouette —
    // enough to pick a hostile out of cover without seeing through walls.
    // Cloned per enemy (opacity is animated individually); fog is off so the
    // glow survives at long range.
    halo: new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff4a22, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    })
  };
}
