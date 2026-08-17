/**
 * First-person camera rig: mouse look, recoil springs, weapon-sway-driven
 * roll, landing dip, hit shake and ADS field-of-view blending.
 *
 * The camera's world position is written every frame from the player's eye
 * point plus additive offsets, so nothing else needs to touch it.
 */

import * as THREE from 'three';
import { clamp, damp, lerp } from '../utils/MathUtils.js';

const PITCH_LIMIT = 1.53;
const LOOK_SCALE = 0.0021;

export class PlayerCamera {
  constructor(camera, settings) {
    this.camera = camera;
    this.settings = settings;

    this.yaw = 0;
    this.pitch = 0;

    // pending mouse movement, drained with a little carry-over for smoothing
    this._dx = 0;
    this._dy = 0;
    this.lastDx = 0;
    this.lastDy = 0;

    // additive aim offsets
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this._recoilVelP = 0;
    this._recoilVelY = 0;

    this.shake = 0;
    this.shakeTime = 0;
    this.roll = 0;
    this.dip = 0;
    this.bob = new THREE.Vector3();
    this.punch = new THREE.Vector3();

    this.fovBase = settings.get('fov');
    this.fovTarget = this.fovBase;
    this.fovCurrent = this.fovBase;
    this.adsAmount = 0;

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._offset = new THREE.Vector3();
  }

  reset(yaw = 0, pitch = 0) {
    this.yaw = yaw;
    this.pitch = pitch;
    this._dx = this._dy = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this._recoilVelP = this._recoilVelY = 0;
    this.shake = 0;
    this.roll = 0;
    this.dip = 0;
    this.bob.set(0, 0, 0);
    this.punch.set(0, 0, 0);
  }

  /** Raw pointer-lock deltas. */
  addMouse(dx, dy) {
    this._dx += dx;
    this._dy += dy;
  }

  /** Weapon recoil: an impulse on the aim springs (radians). */
  addRecoil(pitchKick, yawKick) {
    this._recoilVelP += pitchKick;
    this._recoilVelY += yawKick;
  }

  /** Screen shake from taking damage / nearby impacts. */
  addShake(amount) {
    if (!this.settings.get('cameraShake')) return;
    this.shake = Math.min(0.6, this.shake + amount);
  }

  /** Directional view punch when hit. */
  addPunch(x, y) {
    if (!this.settings.get('cameraShake')) return;
    this.punch.x += x;
    this.punch.y += y;
  }

  setAds(amount) {
    this.adsAmount = amount;
  }

  onFovSettingChanged(fov) {
    this.fovBase = fov;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} eye world eye position
   * @param {{strafe:number, sprint:number, grounded:boolean}} motion
   */
  update(dt, eye, motion) {
    const sens = this.settings.get('sensitivity');
    const invert = this.settings.get('invertY') ? -1 : 1;

    // drain 88% of the pending delta, carry the rest — a touch of smoothing
    // without adding perceptible latency
    const useX = this._dx * 0.88;
    const useY = this._dy * 0.88;
    this._dx -= useX;
    this._dy -= useY;
    // published for the weapon's sway (which updates after the camera)
    this.lastDx = useX;
    this.lastDy = useY;

    // aiming down sights slows the look speed like a real optic
    const adsScale = lerp(1, 0.62, this.adsAmount);
    this.yaw -= useX * LOOK_SCALE * sens * adsScale;
    this.pitch -= useY * LOOK_SCALE * sens * adsScale * invert;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    // --- recoil spring: impulse -> offset -> decay back to zero ---
    this.recoilPitch += this._recoilVelP * dt * 60;
    this.recoilYaw += this._recoilVelY * dt * 60;
    this._recoilVelP = damp(this._recoilVelP, 0, 26, dt);
    this._recoilVelY = damp(this._recoilVelY, 0, 26, dt);
    this.recoilPitch = damp(this.recoilPitch, 0, 7.5, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 7.5, dt);

    // --- shake ---
    this.shakeTime += dt;
    this.shake = damp(this.shake, 0, 6.5, dt);
    const sh = this.shake;
    const shakeX = Math.sin(this.shakeTime * 47.3) * sh * 0.55;
    const shakeY = Math.sin(this.shakeTime * 38.1 + 1.7) * sh * 0.55;

    this.punch.x = damp(this.punch.x, 0, 9, dt);
    this.punch.y = damp(this.punch.y, 0, 9, dt);

    // --- strafe roll + landing dip ---
    const targetRoll = -motion.strafe * 0.022 * (1 - this.adsAmount * 0.7);
    this.roll = damp(this.roll, targetRoll, 8, dt);
    this.dip = damp(this.dip, 0, 9, dt);

    // --- fov ---
    const sprintAdd = motion.sprint * 4.5 * (1 - this.adsAmount);
    this.fovTarget = this.fovBase * lerp(1, 0.6, this.adsAmount) + sprintAdd;
    this.fovCurrent = damp(this.fovCurrent, this.fovTarget, 13, dt);
    if (Math.abs(this.camera.fov - this.fovCurrent) > 0.01) {
      this.camera.fov = this.fovCurrent;
      this.camera.updateProjectionMatrix();
    }

    // --- compose ---
    this._euler.set(
      this.pitch + this.recoilPitch + shakeY + this.punch.y - this.dip * 0.08,
      this.yaw + this.recoilYaw + shakeX + this.punch.x,
      this.roll + shakeX * 0.4,
      'YXZ'
    );
    this.camera.quaternion.setFromEuler(this._euler);

    this._offset.copy(this.bob);
    this._offset.y -= this.dip * 0.16;
    this.camera.position.copy(eye).add(this._offset);
  }

  /** Forward direction including recoil offsets (what the crosshair points at). */
  getAimDirection(target) {
    return target.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }
}
