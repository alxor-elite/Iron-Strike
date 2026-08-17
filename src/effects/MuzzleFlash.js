/**
 * View-space muzzle flash: a stubby additive cone, two crossed billboards and
 * a short-lived point light that pops the weapon and hands out of the dark.
 *
 * Lives as a child of the weapon's muzzle object, so it inherits the viewmodel
 * pose for free.
 */

import * as THREE from 'three';
import { glowTexture } from '../world/Textures.js';

export class MuzzleFlash {
  constructor(parent) {
    this.life = 0;
    this.duration = 0.055;

    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd28a, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      side: THREE.DoubleSide
    });
    this.material = flashMat;

    // forward cone
    const cone = new THREE.ConeGeometry(0.038, 0.16, 7, 1, true);
    cone.rotateX(-Math.PI / 2);
    cone.translate(0, 0, -0.07);
    this.cone = new THREE.Mesh(cone, flashMat);

    // star-shaped crossed quads
    const quad = new THREE.PlaneGeometry(0.2, 0.2);
    this.starA = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, opacity: 1
    }));
    this.starB = new THREE.Mesh(quad, this.starA.material);
    this.starB.rotation.z = Math.PI / 2;
    this.starA.position.z = -0.02;
    this.starB.position.z = -0.02;

    this.light = new THREE.PointLight(0xffc070, 0, 3.2, 2);
    this.light.position.set(0, 0, -0.08);

    this.group = new THREE.Group();
    this.group.add(this.cone, this.starA, this.starB, this.light);
    this.group.visible = false;
    this.group.renderOrder = 6;
    parent.add(this.group);
  }

  trigger() {
    this.life = this.duration;
    this.group.visible = true;
    const roll = Math.random() * Math.PI * 2;
    this.cone.rotation.z = roll;
    this.starA.rotation.z = roll * 0.5;
    this.starB.rotation.z = roll * 0.5 + Math.PI / 2;
    const s = 0.85 + Math.random() * 0.4;
    this.cone.scale.set(s, s, 0.85 + Math.random() * 0.55);
    this.starA.scale.setScalar(s);
    this.starB.scale.setScalar(s * 0.8);
  }

  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.group.visible = false;
      this.light.intensity = 0;
      return;
    }
    const t = this.life / this.duration;
    this.material.opacity = t;
    this.starA.material.opacity = t * 0.9;
    this.light.intensity = t * 7;
  }

  dispose() {
    this.cone.geometry.dispose();
    this.starA.geometry.dispose();
    this.material.dispose();
    this.starA.material.dispose();
  }
}
