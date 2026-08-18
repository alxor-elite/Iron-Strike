/**
 * The loadout: which imported models the game uses, how each is fitted to the
 * rig, and how each one shoots.
 *
 * Every entry is data — a URL, the stats, and the numbers that put the model
 * where the engine expects it. Adding a weapon means adding a descriptor, not
 * writing a class. Anything that fails to load falls back to the procedural
 * KV-9, so the game never depends on a binary asset being present.
 *
 * Model space conventions, for the numbers below:
 *   `transform` puts a model into viewmodel space — muzzle down -Z, up +Y —
 *   normalised to `length` metres with its muzzle at `muzzleZ`. `magBox` is in
 *   that same space, i.e. after anchoring, and is what gets carved out of the
 *   welded mesh so a reload has a magazine to drop. `arms` gives each hand's
 *   position on the weapon, the direction the limb runs away from it, and a
 *   roll that turns the palm onto the grip.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AssaultRifle, RIFLE_CONFIG } from './AssaultRifle.js';
import { ModelRifle } from './ModelRifle.js';
import { MeleeWeapon } from './MeleeWeapon.js';

export const ARMS_URL = 'assets/models/arms.glb';

/** The arms model's own root node, where x = 0 is the plane of symmetry. */
const ARMS_NODE = 'Arm1';

/**
 * The weapons the player carries, in slot order.
 *
 * The rifle and pistol are already modelled muzzle-down -Z with +Y up, so they
 * need no rotation. The knife runs along +Y with its blade up, so it gets a
 * basis that lays the blade forward and stands it edge-down.
 */
export const WEAPONS = [
  {
    id: 'rifle',
    url: 'assets/models/ak47.glb',
    name: 'AK-47',
    config: { ...RIFLE_CONFIG, name: 'AK-47' },
    transform: {
      basis: null,
      // the curved magazine sits well forward of the pistol grip on an AK
      magBox: { min: [-0.09, -0.40, -0.35], max: [0.09, -0.03, -0.12] },
      // near-black furniture disappears in shadow; keep a floor under it
      material: { minLuma: 0.07, metalness: 0.35, roughness: 0.55 }
    },
    arms: {
      node: ARMS_NODE,
      armLength: 0.62,
      right: { position: [0.035, -0.085, 0.045], aim: [0.4, -0.35, 1], roll: 0 },
      left: { position: [-0.02, -0.045, -0.42], aim: [-0.45, -0.4, 1], roll: 0 }
    }
  },
  {
    id: 'pistol',
    url: 'assets/models/pistol.glb',
    name: 'SIDEARM',
    config: {
      name: 'SIDEARM',
      magSize: 12,
      reserveMax: 60,
      rpm: 420,
      reloadTime: 1.45,
      damage: { head: 100, body: 26, limb: 17 },
      range: 90,
      spreadHip: 0.026,
      spreadAds: 0.004,
      spreadMove: 0.024,
      spreadAir: 0.032,
      spreadBloom: 0.0026,
      recoilPitch: 0.011,
      recoilYaw: 0.0065,
      shake: 0.012,
      // a pistol is a quarter of the rifle's length: closer, higher, further in
      poseOffset: [-0.05, 0.045, 0.1]
    },
    transform: {
      basis: null,
      length: 0.22,
      muzzleZ: -0.32,
      // the pistol is short, so its slide sits below the rifle's sight line
      topY: 0.06,
      sightY: 0.06,
      muzzleY: 0.022,
      magBox: { min: [-0.05, -0.20, -0.16], max: [0.05, -0.03, -0.04] },
      material: { minLuma: 0.09, metalness: 0.4, roughness: 0.5 }
    },
    arms: {
      node: ARMS_NODE,
      armLength: 0.58,
      // one-handed: a fixed-pose second hand only ever clutters a pistol
      hideLeft: true,
      right: { position: [0.012, -0.05, -0.125], aim: [0.4, -0.6, 1], roll: 0 },
      left: { position: [-0.05, -0.06, -0.10], aim: [-0.55, -0.55, 1], roll: 0 }
    }
  },
  {
    id: 'knife',
    url: 'assets/models/knife.glb',
    name: 'COMBAT KNIFE',
    config: {
      name: 'COMBAT KNIFE',
      melee: true,
      magSize: 0,
      reserveMax: 0,
      rpm: 85,               // swings per minute
      reloadTime: 0,
      damage: { head: 100, body: 55, limb: 40 },
      range: 2.4,            // metres
      arc: Math.PI * 0.55,   // how wide the cut reaches
      swingTime: 0.42,
      hitDelay: 0.13,        // the cut lands this far into the swing
      spreadHip: 0, spreadAds: 0, spreadMove: 0, spreadAir: 0, spreadBloom: 0,
      recoilPitch: 0, recoilYaw: 0, shake: 0,
      poseOffset: [-0.075, 0.045, 0.16],
      // angled across the view, otherwise a blade pointed at the horizon is
      // foreshortened into a sliver
      poseRotOffset: [0.22, -0.6, 0.18]
    },
    transform: {
      // model +Y is the blade; lay it forward along -Z and stand it edge-down
      basis: [
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(-1, 0, 0)
      ],
      length: 0.30,
      muzzleZ: -0.40,
      barrelY: 0.0,
      material: { minLuma: 0.12, metalness: 0.45, roughness: 0.45 }
    },
    arms: {
      node: ARMS_NODE,
      armLength: 0.62,
      hideLeft: true,
      right: { position: [0.01, -0.03, -0.14], aim: [0.4, -0.55, 1], roll: 0 },
      left: { position: [-0.2, -0.2, 0.2], aim: [-0.5, -0.6, 1], roll: 0 }
    }
  }
];

/**
 * The rifle the AI squad carries. Held in the right elbow's space with the
 * muzzle down -Z, so it is anchored on the barrel axis the muzzle flash fires
 * from rather than on the sight line.
 */
export const ENEMY_RIFLE = {
  length: 0.85,
  muzzleZ: -0.59,
  barrelY: 0.03
};

/** The descriptor the AI squad's rifle is built from. */
export const RIFLE_MODEL = WEAPONS[0];

/* ================================================================= loading */

const cache = new Map();

/**
 * Load a glTF once and hand back its scene. Resolves to null on any failure —
 * a missing model is not an error, it just means a fallback is used.
 */
export function loadModel(url) {
  if (!cache.has(url)) {
    cache.set(url, new GLTFLoader().loadAsync(url).then(
      (gltf) => gltf.scene,
      (err) => {
        console.warn(`[loadout] ${url} unavailable:`, err);
        return null;
      }
    ));
  }
  return cache.get(url);
}

/** Everything the loadout needs, loaded in parallel. */
export async function loadLoadout() {
  const urls = [ARMS_URL, ...WEAPONS.map((w) => w.url)];
  const scenes = await Promise.all(urls.map(loadModel));
  const models = new Map(urls.map((url, i) => [url, scenes[i]]));
  return {
    arms: models.get(ARMS_URL),
    models,
    get rifle() { return models.get(WEAPONS[0].url); }
  };
}

/* ================================================================ building */

/**
 * Build every weapon the player carries. Falls back to the single procedural
 * rifle if none of the models loaded.
 *
 * @returns {Weapon[]} in slot order
 */
export function createWeapons(game, loadout) {
  const built = [];
  for (const descriptor of WEAPONS) {
    const model = loadout && loadout.models && loadout.models.get(descriptor.url);
    if (!model) continue;
    const arms = loadout.arms;
    built.push(descriptor.config.melee
      ? new MeleeWeapon(game, descriptor.config, model, descriptor, arms)
      : new ModelRifle(game, descriptor.config, model, descriptor, arms));
  }
  if (!built.length) built.push(new AssaultRifle(game));
  return built;
}
