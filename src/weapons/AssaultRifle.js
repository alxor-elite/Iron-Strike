/**
 * KV-9 "WIDOWMAKER" — an original low-poly 5.8 mm assault rifle.
 *
 * Built entirely from Three.js primitives and merged per material, so the whole
 * viewmodel (receiver, handguard, barrel, brake, optic, folding sights, stock,
 * grip, magazine, charging handle, gloved hands) costs ~8 draw calls.
 *
 * Coordinates are view space: the muzzle points down -Z.
 */

import * as THREE from 'three';
import { Weapon } from './Weapon.js';
import { boxGeom, cylGeom, mergeParts } from '../world/Geo.js';
import { glowTexture } from '../world/Textures.js';
import { MuzzleFlash } from '../effects/MuzzleFlash.js';

/** Shared by any rifle that uses these stats, including imported models. */
export const RIFLE_CONFIG = {
  name: 'KV-9 “WIDOWMAKER”',
  magSize: 30,
  reserveMax: 120,
  rpm: 600,
  reloadTime: 2.0,
  damage: { head: 100, body: 30, limb: 20 },
  range: 145,
  spreadHip: 0.0215,
  spreadAds: 0.0032,
  spreadMove: 0.021,
  spreadAir: 0.028,
  spreadBloom: 0.0017,
  recoilPitch: 0.0082,
  recoilYaw: 0.0058,
  shake: 0.011
};

export class AssaultRifle extends Weapon {
  constructor(game) {
    super(game, RIFLE_CONFIG);
  }

  buildModel() {
    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x33383d, metalness: 0.72, roughness: 0.44 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x1c1f22, metalness: 0.06, roughness: 0.86 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x4a5257, metalness: 0.55, roughness: 0.55 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2f2a24, metalness: 0.05, roughness: 0.95 });
    const gloveDark = new THREE.MeshStandardMaterial({ color: 0x201d19, metalness: 0.05, roughness: 0.95 });

    const group = new THREE.Group();
    group.name = 'viewmodel';

    /* ---------------------------------------------------------- receiver -- */
    const metalParts = [];
    const polyParts = [];
    const accentParts = [];

    // lower receiver
    polyParts.push({ geom: boxGeom(0.062, 0.072, 0.30, 6), pos: [0, -0.005, 0.02] });
    // magwell
    polyParts.push({ geom: boxGeom(0.058, 0.062, 0.075, 6), pos: [0, -0.055, -0.055] });
    // upper receiver
    metalParts.push({ geom: boxGeom(0.056, 0.062, 0.34, 6), pos: [0, 0.048, -0.03] });
    // top rail + slots
    metalParts.push({ geom: boxGeom(0.036, 0.012, 0.36, 8), pos: [0, 0.083, -0.05] });
    for (let i = 0; i < 11; i++) {
      metalParts.push({ geom: boxGeom(0.042, 0.008, 0.011, 8), pos: [0, 0.086, -0.21 + i * 0.031] });
    }
    // ejection port surround
    metalParts.push({ geom: boxGeom(0.008, 0.03, 0.075, 8), pos: [0.031, 0.05, -0.03] });
    // brass deflector
    metalParts.push({ geom: boxGeom(0.014, 0.028, 0.03, 8), pos: [0.033, 0.062, 0.02], rot: [0, 0, -0.4] });

    /* --------------------------------------------------------- handguard -- */
    polyParts.push({ geom: boxGeom(0.052, 0.052, 0.235, 6), pos: [0, 0.028, -0.29] });
    // cooling vents
    for (let i = 0; i < 5; i++) {
      accentParts.push({ geom: boxGeom(0.056, 0.014, 0.022, 8), pos: [0, 0.042, -0.2 - i * 0.04] });
      accentParts.push({ geom: boxGeom(0.056, 0.014, 0.022, 8), pos: [0, 0.012, -0.2 - i * 0.04] });
    }
    // bottom rail / hand stop
    polyParts.push({ geom: boxGeom(0.03, 0.016, 0.16, 8), pos: [0, -0.002, -0.3] });
    polyParts.push({ geom: boxGeom(0.034, 0.03, 0.026, 8), pos: [0, -0.012, -0.238] });

    /* ------------------------------------------------------------ barrel -- */
    metalParts.push({ geom: cylGeom(0.0125, 0.0125, 0.30, 10), pos: [0, 0.032, -0.5], rot: [Math.PI / 2, 0, 0] });
    // gas block
    metalParts.push({ geom: boxGeom(0.03, 0.036, 0.05, 8), pos: [0, 0.04, -0.42] });
    metalParts.push({ geom: cylGeom(0.007, 0.007, 0.1, 6), pos: [0, 0.052, -0.47], rot: [Math.PI / 2, 0, 0] });
    // muzzle brake with ports
    metalParts.push({ geom: cylGeom(0.023, 0.021, 0.075, 10), pos: [0, 0.032, -0.68], rot: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 3; i++) {
      accentParts.push({ geom: boxGeom(0.05, 0.008, 0.012, 8), pos: [0, 0.032, -0.665 + i * 0.022] });
    }
    metalParts.push({ geom: cylGeom(0.026, 0.026, 0.012, 10), pos: [0, 0.032, -0.715], rot: [Math.PI / 2, 0, 0] });

    /* ------------------------------------------------------------- stock -- */
    metalParts.push({ geom: cylGeom(0.019, 0.019, 0.13, 8), pos: [0, 0.03, 0.22], rot: [Math.PI / 2, 0, 0] });
    polyParts.push({ geom: boxGeom(0.05, 0.058, 0.1, 6), pos: [0, 0.022, 0.25] });
    polyParts.push({ geom: boxGeom(0.048, 0.028, 0.06, 6), pos: [0, 0.055, 0.235] }); // cheek riser
    polyParts.push({ geom: boxGeom(0.052, 0.078, 0.022, 6), pos: [0, 0.012, 0.3] });  // butt pad
    accentParts.push({ geom: boxGeom(0.056, 0.02, 0.024, 8), pos: [0, -0.02, 0.298] });

    /* -------------------------------------------------------------- grip -- */
    polyParts.push({ geom: boxGeom(0.048, 0.115, 0.062, 6), pos: [0, -0.085, 0.115], rot: [-0.28, 0, 0] });
    polyParts.push({ geom: boxGeom(0.052, 0.022, 0.05, 8), pos: [0, -0.145, 0.135] });
    // trigger guard + trigger
    accentParts.push({ geom: boxGeom(0.03, 0.01, 0.06, 8), pos: [0, -0.055, 0.055] });
    accentParts.push({ geom: boxGeom(0.03, 0.03, 0.009, 8), pos: [0, -0.04, 0.026] });
    accentParts.push({ geom: boxGeom(0.008, 0.026, 0.009, 8), pos: [0, -0.032, 0.048], rot: [0.25, 0, 0] });
    // fire selector
    accentParts.push({ geom: cylGeom(0.009, 0.009, 0.05, 6), pos: [0, -0.008, 0.09], rot: [0, 0, Math.PI / 2] });

    /* ---------------------------------------------------- folding sights -- */
    metalParts.push({ geom: boxGeom(0.008, 0.03, 0.008, 8), pos: [0, 0.106, -0.4] });      // front post
    metalParts.push({ geom: boxGeom(0.026, 0.008, 0.01, 8), pos: [0, 0.121, -0.4] });      // hood
    metalParts.push({ geom: boxGeom(0.03, 0.026, 0.008, 8), pos: [0, 0.104, 0.06] });      // rear leaf
    accentParts.push({ geom: boxGeom(0.009, 0.009, 0.01, 8), pos: [0, 0.107, 0.058] });

    /* -------------------------------------------------------------- optic - */
    metalParts.push({ geom: boxGeom(0.032, 0.026, 0.075, 8), pos: [0, 0.1, -0.11] });
    metalParts.push({ geom: cylGeom(0.019, 0.019, 0.062, 10, true), pos: [0, 0.125, -0.12], rot: [Math.PI / 2, 0, 0] });
    metalParts.push({ geom: boxGeom(0.03, 0.012, 0.02, 8), pos: [0, 0.104, -0.075] });

    const metalMesh = new THREE.Mesh(mergeParts(metalParts), gunmetal);
    const polyMesh = new THREE.Mesh(mergeParts(polyParts), polymer);
    const accentMesh = new THREE.Mesh(mergeParts(accentParts), accent);
    group.add(metalMesh, polyMesh, accentMesh);

    // optic lens + reticle (separate meshes: unlit materials)
    const lens = new THREE.Mesh(
      cylGeom(0.0175, 0.0175, 0.004, 12),
      new THREE.MeshBasicMaterial({ color: 0x14212c, transparent: true, opacity: 0.55 })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.125, -0.09);
    group.add(lens);
    // reticle: sits just in front of the lens so it reads at ADS distance
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.0075, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff5140 })
    );
    dot.position.set(0, 0.125, -0.0955);
    dot.renderOrder = 3;
    group.add(dot);
    const dotGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff5a3c, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75
    }));
    dotGlow.scale.set(0.05, 0.05, 1);
    dotGlow.position.copy(dot.position);
    group.add(dotGlow);

    /* ---------------------------------------------------------- magazine -- */
    const magParts = [
      { geom: boxGeom(0.05, 0.11, 0.062, 6), pos: [0, -0.055, 0] },
      { geom: boxGeom(0.048, 0.075, 0.058, 6), pos: [0, -0.128, 0.022], rot: [0.26, 0, 0] },
      { geom: boxGeom(0.054, 0.014, 0.066, 8), pos: [0, -0.005, 0] },
      { geom: boxGeom(0.052, 0.01, 0.02, 8), pos: [0, -0.09, -0.026] }
    ];
    const magazine = new THREE.Mesh(mergeParts(magParts), polymer);
    magazine.position.set(0, -0.06, -0.055);
    group.add(magazine);
    const magHome = magazine.position.clone();

    /* --------------------------------------------------- charging handle -- */
    const boltParts = [
      { geom: boxGeom(0.05, 0.016, 0.016, 8), pos: [0.03, 0, 0] },
      { geom: boxGeom(0.012, 0.028, 0.05, 8), pos: [0.052, 0, 0.014] }
    ];
    const bolt = new THREE.Mesh(mergeParts(boltParts), accent);
    bolt.position.set(0, 0.072, 0.075);
    group.add(bolt);
    const boltHome = bolt.position.z;

    /* ------------------------------------------------------------- hands -- */
    // right hand on the grip
    const rightHand = new THREE.Group();
    const rhParts = [
      { geom: boxGeom(0.055, 0.085, 0.07, 6), pos: [0, 0, 0] },
      { geom: boxGeom(0.06, 0.022, 0.04, 8), pos: [0.005, 0.036, -0.03], rot: [0.4, 0, 0] },   // knuckles
      { geom: boxGeom(0.03, 0.05, 0.03, 8), pos: [-0.02, 0.03, -0.035], rot: [0.6, 0.2, 0] }   // thumb
    ];
    rightHand.add(new THREE.Mesh(mergeParts(rhParts), glove));
    const forearmR = new THREE.Mesh(cylGeom(0.042, 0.05, 0.3, 8), gloveDark);
    forearmR.rotation.set(Math.PI / 2 - 0.5, 0, 0.12);
    forearmR.position.set(0.02, -0.06, 0.16);
    rightHand.add(forearmR);
    rightHand.position.set(0.008, -0.085, 0.115);
    rightHand.rotation.set(-0.28, 0, 0);
    group.add(rightHand);

    // left hand on the handguard
    const leftHand = new THREE.Group();
    const lhParts = [
      { geom: boxGeom(0.062, 0.07, 0.09, 6), pos: [0, 0, 0] },
      { geom: boxGeom(0.068, 0.024, 0.075, 8), pos: [0, 0.034, 0.004] },
      { geom: boxGeom(0.026, 0.05, 0.035, 8), pos: [-0.03, -0.01, -0.04], rot: [0.5, 0, 0.3] }
    ];
    leftHand.add(new THREE.Mesh(mergeParts(lhParts), glove));
    const forearmL = new THREE.Mesh(cylGeom(0.044, 0.052, 0.34, 8), gloveDark);
    forearmL.rotation.set(Math.PI / 2 - 0.85, 0, -0.35);
    forearmL.position.set(-0.075, -0.11, 0.02);
    leftHand.add(forearmL);
    leftHand.position.set(0, -0.012, -0.29);
    group.add(leftHand);

    /* ------------------------------------------------------ muzzle + fx -- */
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.032, -0.74);
    group.add(muzzle);

    const muzzleFlash = new MuzzleFlash(muzzle);

    // The rifle is modelled at true scale (~1 m); viewmodels read better a
    // little smaller so the receiver doesn't swallow the lower screen.
    group.scale.setScalar(0.66);

    // shadowless viewmodel
    group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
        o.userData.ownMaterial = true;
      }
    });

    return {
      group, muzzle, magazine, magHome, bolt, boltHome, muzzleFlash,
      leftHand, rightHand,
      ejectOffset: new THREE.Vector3(0.06, 0.05, 0.0)
    };
  }
}
