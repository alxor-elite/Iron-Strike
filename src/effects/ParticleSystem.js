/**
 * Pooled particle engine.
 *
 * Two GPU point clouds (additive for sparks/flash, normal-blended for
 * dust/smoke) each drawn in a single call, plus object pools for bullet
 * tracers, ejected shell casings and impact decals. Nothing is allocated
 * during gameplay and dead particles cost one array write.
 */

import * as THREE from 'three';
import { glowTexture, puffTexture, bulletHoleTexture } from '../world/Textures.js';

const VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (260.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    if (vAlpha <= 0.001) discard;
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, 1.0) * tex * vAlpha;
  }
`;

class ParticlePool {
  constructor(scene, capacity, texture, additive) {
    this.capacity = capacity;
    this.count = 0;

    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this._cursor = 0;
    this._free = [];
    this._dirty = false;
    for (let i = capacity - 1; i >= 0; i--) this._free.push(i);

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setDrawRange(0, capacity);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geometry = geo;
    this.material = mat;
  }

  spawn(x, y, z, vx, vy, vz, life, size0, size1, r, g, b, gravity, drag) {
    // O(1) free list; when saturated we recycle round-robin
    let idx;
    if (this._free.length > 0) {
      idx = this._free.pop();
    } else {
      idx = this._cursor;
      this._cursor = (this._cursor + 1) % this.capacity;
    }

    this.px[idx] = x; this.py[idx] = y; this.pz[idx] = z;
    this.vx[idx] = vx; this.vy[idx] = vy; this.vz[idx] = vz;
    this.life[idx] = life; this.maxLife[idx] = life;
    this.size0[idx] = size0; this.size1[idx] = size1;
    this.gravity[idx] = gravity; this.drag[idx] = drag;
    this.alive[idx] = 1;
    const c3 = idx * 3;
    this.colors[c3] = r; this.colors[c3 + 1] = g; this.colors[c3 + 2] = b;
    return idx;
  }

  update(dt) {
    // nothing alive and nothing to clean up: skip the whole pass
    if (this._free.length === this.capacity && !this._dirty) {
      this.points.visible = false;
      return;
    }
    let anyAlive = false;
    for (let i = 0; i < this.capacity; i++) {
      const i3 = i * 3;
      if (!this.alive[i]) {
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      const l = this.life[i] - dt;
      if (l <= 0) {
        this.alive[i] = 0;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        this._free.push(i);
        continue;
      }
      this.life[i] = l;
      anyAlive = true;

      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d - this.gravity[i] * dt;

      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;

      // cheap floor bounce so sparks skitter along the ground
      if (this.py[i] < 0.02 && this.vy[i] < 0) {
        this.py[i] = 0.02;
        this.vy[i] *= -0.32;
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
      }

      const t = 1 - l / this.maxLife[i];
      this.positions[i3] = this.px[i];
      this.positions[i3 + 1] = this.py[i];
      this.positions[i3 + 2] = this.pz[i];
      this.sizes[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alphas[i] = 1 - t * t;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.points.visible = anyAlive;
    // one extra pass after the last particle dies flushes the zeroed buffers
    this._dirty = anyAlive;
  }

  clear() {
    this.alive.fill(0);
    this.alphas.fill(0);
    this.sizes.fill(0);
    this._dirty = true;
    this._free.length = 0;
    for (let i = this.capacity - 1; i >= 0; i--) this._free.push(i);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.points.parent?.remove(this.points);
  }
}

/* ============================================================ tracers ==== */

class TracerPool {
  constructor(scene, capacity = 28) {
    const geo = new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true);
    geo.rotateX(Math.PI / 2); // align with +Z
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);

    this.capacity = capacity;
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this._cursor = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this._zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.geometry = geo;
    this.material = mat;
  }

  spawn(from, to, thickness = 1) {
    const idx = this._cursor;
    this._cursor = (this._cursor + 1) % this.capacity;
    this._dir.subVectors(to, from);
    const len = this._dir.length();
    if (len < 0.05) return;
    this._dir.multiplyScalar(1 / len);
    this._p.copy(from).addScaledVector(this._dir, len * 0.5);
    this._q.setFromUnitVectors(FORWARD, this._dir);
    this._s.set(thickness, thickness, len);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(idx, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.life[idx] = 0.055;
    this.maxLife[idx] = 0.055;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      any = true;
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, this._zero);
        this.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.mesh.visible = any;
  }

  clear() {
    for (let i = 0; i < this.capacity; i++) {
      this.life[i] = 0;
      this.mesh.setMatrixAt(i, this._zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

const FORWARD = new THREE.Vector3(0, 0, 1);

/* ============================================================ casings ==== */

class CasingPool {
  constructor(scene, capacity = 18) {
    const geo = new THREE.CylinderGeometry(0.0075, 0.0068, 0.031, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.85, roughness: 0.35 });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.spin = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.grounded = new Uint8Array(capacity);
    this._cursor = 0;
    this._m = new THREE.Matrix4();
    this._e = new THREE.Euler();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this._zero);
    this.geometry = geo;
    this.material = mat;
  }

  spawn(x, y, z, vx, vy, vz) {
    const i = this._cursor;
    this._cursor = (this._cursor + 1) % this.capacity;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.rot[i3] = Math.random() * 6.28;
    this.rot[i3 + 1] = Math.random() * 6.28;
    this.rot[i3 + 2] = Math.random() * 6.28;
    this.spin[i3] = (Math.random() - 0.5) * 26;
    this.spin[i3 + 1] = (Math.random() - 0.5) * 26;
    this.spin[i3 + 2] = (Math.random() - 0.5) * 26;
    this.life[i] = 3.2;
    this.grounded[i] = 0;
  }

  update(dt, floorAt) {
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, this._zero);
        continue;
      }
      if (!this.grounded[i]) {
        this.vel[i3 + 1] -= 22 * dt;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        const floor = floorAt ? floorAt(this.pos[i3], this.pos[i3 + 2]) : 0;
        if (this.pos[i3 + 1] <= floor + 0.01) {
          this.pos[i3 + 1] = floor + 0.01;
          if (Math.abs(this.vel[i3 + 1]) > 1.1) {
            this.vel[i3 + 1] *= -0.34;
            this.vel[i3] *= 0.55;
            this.vel[i3 + 2] *= 0.55;
            for (let k = 0; k < 3; k++) this.spin[i3 + k] *= 0.5;
          } else {
            this.grounded[i] = 1;
            this.rot[i3] = Math.PI / 2;
            this.rot[i3 + 2] = 0;
          }
        }
        for (let k = 0; k < 3; k++) this.rot[i3 + k] += this.spin[i3 + k] * dt;
      }
      this._e.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]);
      this._q.setFromEuler(this._e);
      this._p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      this._m.compose(this._p, this._q, this._one);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = any;
    this.mesh.visible = any;
  }

  clear() {
    for (let i = 0; i < this.capacity; i++) {
      this.life[i] = 0;
      this.mesh.setMatrixAt(i, this._zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

/* ============================================================= decals ==== */

class DecalPool {
  constructor(scene, capacity = 48) {
    this.capacity = capacity;
    this.items = [];
    const geo = new THREE.PlaneGeometry(0.22, 0.22);
    const mat = new THREE.MeshBasicMaterial({
      map: bulletHoleTexture(), transparent: true, depthWrite: false,
      opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    });
    this.geometry = geo;
    this.material = mat;
    for (let i = 0; i < capacity; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 2;
      m.frustumCulled = true;
      scene.add(m);
      this.items.push({ mesh: m, life: 0 });
    }
    this._cursor = 0;
    this._normalTarget = new THREE.Vector3();
  }

  spawn(point, normal, scale = 1) {
    const it = this.items[this._cursor];
    this._cursor = (this._cursor + 1) % this.capacity;
    it.mesh.position.copy(point).addScaledVector(normal, 0.012);
    this._normalTarget.copy(point).add(normal);
    it.mesh.lookAt(this._normalTarget);
    it.mesh.rotateZ(Math.random() * Math.PI * 2);
    const s = scale * (0.75 + Math.random() * 0.5);
    it.mesh.scale.set(s, s, s);
    it.mesh.visible = true;
    it.life = 14;
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) it.mesh.visible = false;
    }
  }

  clear() {
    for (const it of this.items) { it.life = 0; it.mesh.visible = false; }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    for (const it of this.items) it.mesh.parent?.remove(it.mesh);
  }
}

/* ====================================================== ParticleSystem ==== */

export class ParticleSystem {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    const scale = quality === 'low' ? 0.45 : quality === 'medium' ? 0.72 : 1;
    this.scale = scale;

    this.spark = new ParticlePool(scene, Math.round(420 * scale), glowTexture(), true);
    this.smoke = new ParticlePool(scene, Math.round(220 * scale), puffTexture(), false);
    this.tracers = new TracerPool(scene, 28);
    this.casings = new CasingPool(scene, quality === 'low' ? 10 : 18);
    this.decals = new DecalPool(scene, quality === 'low' ? 20 : 48);
    this.floorAt = null;
  }

  setQuality(quality) { this.quality = quality; }

  emitSpark(x, y, z, vx, vy, vz, life, s0, s1, color, gravity = 9, drag = 2.4) {
    this.spark.spawn(x, y, z, vx, vy, vz, life, s0, s1,
      (color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255, gravity, drag);
  }

  emitSmoke(x, y, z, vx, vy, vz, life, s0, s1, color, gravity = -0.4, drag = 1.6) {
    this.smoke.spawn(x, y, z, vx, vy, vz, life, s0, s1,
      (color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255, gravity, drag);
  }

  update(dt) {
    this.spark.update(dt);
    this.smoke.update(dt);
    this.tracers.update(dt);
    this.casings.update(dt, this.floorAt);
    this.decals.update(dt);
  }

  clear() {
    this.spark.clear();
    this.smoke.clear();
    this.tracers.clear();
    this.casings.clear();
    this.decals.clear();
  }

  dispose() {
    this.spark.dispose();
    this.smoke.dispose();
    this.tracers.dispose();
    this.casings.dispose();
    this.decals.dispose();
  }
}
