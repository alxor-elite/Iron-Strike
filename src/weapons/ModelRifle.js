/**
 * Weapons whose body comes from imported meshes instead of Three.js primitives.
 *
 * The engine animates named sub-parts of a weapon (magazine drop on reload,
 * charging handle reciprocation, muzzle point), but an imported gun is one
 * welded model split by material, with none of that structure. So `buildWeaponBody`
 * rebuilds it: the parts are re-oriented and rescaled into viewmodel space, the
 * magazine is carved out of the geometry into its own group, and everything the
 * model cannot provide — optic, arms, muzzle point — is added around it.
 *
 * The same builder serves the knife (see MeleeWeapon.js), which simply asks for
 * no optic and has no magazine to carve.
 *
 * Viewmodel space: muzzle down -Z, up +Y, sight line at y = SIGHT_HEIGHT.
 */

import * as THREE from 'three';
import { Weapon } from './Weapon.js';
import { glowTexture } from '../world/Textures.js';
import { MuzzleFlash } from '../effects/MuzzleFlash.js';
import { handMaterials, buildLeftHand, buildRightHand } from './Hands.js';
import { buildArms } from './Arms.js';
import { collectParts, anchorGunParts, prepareGunMaterial, splitMagazine } from './GunGeometry.js';

/**
 * Where the sight line sits above the group origin. The ADS pose lowers the
 * whole viewmodel by this much (times the display scale), which is what puts
 * the reticle on the screen centre — see POSE.ads in Weapon.js.
 */
export const SIGHT_HEIGHT = 0.125;
/** Default muzzle tip position along -Z, matching the procedural rifle's reach. */
export const MUZZLE_Z = -0.74;
/** Default length an imported gun is normalised to, in metres. */
export const GUN_LENGTH = 1.04;
/** Viewmodel display scale (weapons are modelled at true scale). */
export const DISPLAY_SCALE = 0.66;

/**
 * Build a viewmodel from an imported model.
 *
 * @param {Weapon} weapon the weapon being built (for its game reference)
 * @param {THREE.Object3D} sourceModel root node of the loaded glTF
 * @param {object} descriptor loadout entry: `transform` and `arms`
 * @param {THREE.Object3D} [armsModel] first-person arms, if available
 * @param {{firearm?: boolean}} [opts] `firearm: false` omits the optic, bolt and muzzle
 * @returns {{model: object, arms: object|null}}
 */
export function buildWeaponBody(weapon, sourceModel, descriptor, armsModel, opts = {}) {
  const t = descriptor.transform || {};
  const group = new THREE.Group();
  group.name = 'viewmodel';

  /* --------------------------------------------------- geometry transform */
  const parts = collectParts(sourceModel);
  anchorGunParts(parts, {
    basis: t.basis,
    length: t.length != null ? t.length : GUN_LENGTH,
    muzzleZ: t.muzzleZ != null ? t.muzzleZ : MUZZLE_Z,
    topY: t.barrelY != null ? null : (t.topY != null ? t.topY : SIGHT_HEIGHT),
    barrelY: t.barrelY
  });
  for (const part of parts) {
    part.material = prepareGunMaterial(part.material, t.material);
  }

  // carve the magazine out so the reload animation has something to drop
  const { body, mag } = splitMagazine(parts, t.magBox);
  for (const part of body) group.add(new THREE.Mesh(part.geometry, part.material));

  let magazine = null;
  let magHome = null;
  if (t.magBox) {
    magazine = new THREE.Group();
    for (const part of mag) magazine.add(new THREE.Mesh(part.geometry, part.material));
    group.add(magazine);
    magHome = magazine.position.clone();
  }

  const isFirearm = opts.firearm !== false;

  /* --------------------------------------------------------------- optic */
  // An imported gun's own sights are decorative; this is the one the ADS pose
  // is calibrated against, so the sight picture matches where bullets go.
  if (isFirearm) {
    const sightY = t.sightY != null ? t.sightY : SIGHT_HEIGHT;
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0175, 0.0175, 0.004, 12),
      new THREE.MeshBasicMaterial({ color: 0x14212c, transparent: true, opacity: 0.55 })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, sightY, -0.09);
    group.add(lens);

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.0075, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff5140 })
    );
    dot.position.set(0, sightY, -0.0955);
    dot.renderOrder = 3;
    group.add(dot);

    const dotGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff5a3c, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75
    }));
    dotGlow.scale.set(0.05, 0.05, 1);
    dotGlow.position.copy(dot.position);
    group.add(dotGlow);
  }

  /* ------------------------------------------ charging handle stand-in --- */
  // No imported model has a separate bolt, so this is an invisible anchor: the
  // reciprocation still runs, it just has nothing to show.
  let bolt = null;
  let boltHome = 0;
  if (isFirearm) {
    bolt = new THREE.Object3D();
    bolt.position.set(0, 0.072, 0.075);
    group.add(bolt);
    boltHome = bolt.position.z;
  }

  /* ----------------------------------------------------------- arms/hands */
  let arms = null;
  let leftHand, rightHand;
  if (armsModel && descriptor.arms) {
    arms = buildArms(armsModel, descriptor.arms);
  }
  if (arms) {
    leftHand = arms.left;
    rightHand = arms.right;
    if (descriptor.arms.hideLeft) leftHand.visible = false;
    group.add(rightHand, leftHand);
  } else {
    const mats = handMaterials();
    rightHand = buildRightHand(mats);
    rightHand.position.set(0.008, -0.105, 0.045);
    rightHand.rotation.set(-0.28, 0, 0);
    leftHand = buildLeftHand(mats);
    leftHand.position.set(0, -0.02, -0.30);
    group.add(rightHand, leftHand);
  }

  /* ------------------------------------------------------- muzzle + flash */
  let muzzle = null;
  let muzzleFlash = null;
  if (isFirearm) {
    muzzle = new THREE.Object3D();
    muzzle.position.set(0, t.muzzleY != null ? t.muzzleY : 0.032,
      t.muzzleZ != null ? t.muzzleZ : MUZZLE_Z);
    group.add(muzzle);
    muzzleFlash = new MuzzleFlash(muzzle);
  }

  group.scale.setScalar(t.scale != null ? t.scale : DISPLAY_SCALE);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;
      o.userData.ownMaterial = true;
    }
  });

  return {
    arms,
    model: {
      group, muzzle, magazine, magHome, bolt, boltHome, muzzleFlash,
      leftHand, rightHand,
      ejectOffset: new THREE.Vector3(0.06, 0.05, 0.0)
    }
  };
}

/** A firearm built from an imported model. */
export class ModelRifle extends Weapon {
  /**
   * @param {object} game
   * @param {object} config weapon stats
   * @param {THREE.Object3D} sourceModel the gun's root node from the loaded glTF
   * @param {object} descriptor the loadout entry
   * @param {THREE.Object3D} [armsModel]
   */
  constructor(game, config, sourceModel, descriptor, armsModel = null) {
    // stashed on the game because buildModel() runs inside super()
    game._pendingWeapon = { sourceModel, descriptor, armsModel };
    super(game, config);
    game._pendingWeapon = null;
  }

  buildModel() {
    const { sourceModel, descriptor, armsModel } = this.game._pendingWeapon;
    const built = buildWeaponBody(this, sourceModel, descriptor, armsModel);
    this.arms = built.arms;
    return built.model;
  }

  dispose() {
    super.dispose();
    if (this.arms) this.arms.dispose();
  }
}
