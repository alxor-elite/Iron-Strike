/**
 * Procedural canvas textures. Everything the map uses is generated at runtime
 * so the game ships with zero image assets. Textures are cached by key and
 * shared between materials.
 */

import * as THREE from 'three';

const cache = new Map();

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d') };
}

function toTexture(c, repeat = 1, anisotropy = 4) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = anisotropy;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Value-noise speckle pass. */
function speckle(ctx, size, count, minA, maxA, light) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.5 + Math.random() * 2.2;
    const a = minA + Math.random() * (maxA - minA);
    ctx.fillStyle = light
      ? `rgba(255,255,255,${a})`
      : `rgba(0,0,0,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function blotches(ctx, size, count, colors, rMin, rMax, alpha) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = rMin + Math.random() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = colors[(Math.random() * colors.length) | 0];
    g.addColorStop(0, `rgba(${col},${alpha})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function get(key, builder) {
  let t = cache.get(key);
  if (!t) { t = builder(); cache.set(key, t); }
  return t;
}

/* ------------------------------------------------------------------ concrete */

export function concreteTexture(repeat = 4, tint = '#6a6d70') {
  return get(`concrete-${repeat}-${tint}`, () => {
    const size = 256;
    const { c, ctx } = canvas(size);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, 26, ['40,42,44', '90,92,94', '58,54,50'], 12, 52, 0.35);
    speckle(ctx, size, 2200, 0.02, 0.16, false);
    speckle(ctx, size, 900, 0.02, 0.1, true);
    // hairline cracks
    ctx.strokeStyle = 'rgba(20,20,22,0.35)';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      let x = Math.random() * size, y = Math.random() * size;
      ctx.moveTo(x, y);
      ctx.lineWidth = 0.6 + Math.random();
      for (let s = 0; s < 8; s++) {
        x += (Math.random() - 0.5) * 40;
        y += (Math.random() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return toTexture(c, repeat);
  });
}

/** Big warehouse floor: panel seams + oil staining + faded lane markings. */
export function floorTexture(repeat = 26) {
  return get(`floor-${repeat}`, () => {
    const size = 512;
    const { c, ctx } = canvas(size);
    ctx.fillStyle = '#55585b';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, 40, ['38,40,42', '72,74,76', '48,44,40'], 30, 110, 0.4);
    speckle(ctx, size, 5000, 0.02, 0.14, false);
    speckle(ctx, size, 1600, 0.02, 0.09, true);

    // expansion joints around the tile edge
    ctx.strokeStyle = 'rgba(22,23,25,0.75)';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(28,29,31,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
    ctx.stroke();

    // oil patches
    blotches(ctx, size, 8, ['12,12,14'], 20, 70, 0.5);
    return toTexture(c, repeat, 8);
  });
}

/* -------------------------------------------------------- corrugated / metal */

export function corrugatedTexture(repeat = 1, base = '#4a5257', ribs = 26) {
  return get(`corr-${repeat}-${base}-${ribs}`, () => {
    const size = 256;
    const { c, ctx } = canvas(size);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const step = size / ribs;
    for (let i = 0; i < ribs; i++) {
      const x = i * step;
      const g = ctx.createLinearGradient(x, 0, x + step, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.42)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.12)');
      g.addColorStop(0.62, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, step, size);
    }
    // rust runs
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const h = 20 + Math.random() * 90;
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, 'rgba(122,64,28,0.4)');
      g.addColorStop(1, 'rgba(122,64,28,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 2 + Math.random() * 6, h);
    }
    speckle(ctx, size, 1200, 0.02, 0.12, false);
    return toTexture(c, repeat);
  });
}

export function metalTexture(repeat = 2, base = '#3e444a') {
  return get(`metal-${repeat}-${base}`, () => {
    const size = 256;
    const { c, ctx } = canvas(size);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    // brushed streaks
    for (let i = 0; i < 700; i++) {
      const y = Math.random() * size;
      ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.07})`;
      ctx.lineWidth = 0.5 + Math.random();
      ctx.beginPath();
      ctx.moveTo(Math.random() * size, y);
      ctx.lineTo(Math.random() * size, y + (Math.random() - 0.5) * 3);
      ctx.stroke();
    }
    blotches(ctx, size, 14, ['110,58,24', '78,42,20'], 8, 40, 0.3);
    speckle(ctx, size, 800, 0.03, 0.15, false);
    return toTexture(c, repeat);
  });
}

export function rustTexture(repeat = 2) {
  return get(`rust-${repeat}`, () => {
    const size = 256;
    const { c, ctx } = canvas(size);
    ctx.fillStyle = '#6d4526';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, 40, ['122,64,26', '52,32,18', '150,88,40'], 10, 55, 0.55);
    speckle(ctx, size, 3000, 0.03, 0.2, false);
    speckle(ctx, size, 1200, 0.02, 0.12, true);
    return toTexture(c, repeat);
  });
}

/* --------------------------------------------------------------------- wood */

export function woodTexture(repeat = 1) {
  return get(`wood-${repeat}`, () => {
    const size = 256;
    const { c, ctx } = canvas(size);
    ctx.fillStyle = '#8b6534';
    ctx.fillRect(0, 0, size, size);
    const planks = 5;
    const ph = size / planks;
    for (let p = 0; p < planks; p++) {
      const y = p * ph;
      const shade = 0.86 + Math.random() * 0.28;
      ctx.fillStyle = `rgba(${Math.floor(139 * shade)},${Math.floor(101 * shade)},${Math.floor(52 * shade)},1)`;
      ctx.fillRect(0, y, size, ph - 1);
      // grain
      for (let i = 0; i < 26; i++) {
        ctx.strokeStyle = `rgba(60,38,16,${0.05 + Math.random() * 0.16})`;
        ctx.lineWidth = 0.6 + Math.random() * 1.4;
        ctx.beginPath();
        const gy = y + Math.random() * ph;
        ctx.moveTo(0, gy);
        for (let x = 0; x <= size; x += 32) ctx.lineTo(x, gy + (Math.random() - 0.5) * 4);
        ctx.stroke();
      }
      // seam
      ctx.fillStyle = 'rgba(30,18,8,0.75)';
      ctx.fillRect(0, y + ph - 2, size, 2);
    }
    speckle(ctx, size, 900, 0.02, 0.1, false);
    return toTexture(c, repeat);
  });
}

/* ------------------------------------------------------------- alpha sheets */

/** Chain-link fence sheet (transparent between the wires). */
export function chainlinkTexture(repeat = 6) {
  return get(`chain-${repeat}`, () => {
    const size = 128;
    const { c, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(168,176,182,0.95)';
    ctx.lineWidth = 3;
    const step = 32;
    for (let i = -size; i < size * 2; i += step) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i + size, 0); ctx.lineTo(i, size); ctx.stroke();
    }
    const t = toTexture(c, repeat);
    t.premultiplyAlpha = false;
    return t;
  });
}

/** Catwalk / stair grating (transparent holes). */
export function gratingTexture(repeat = 4) {
  return get(`grate-${repeat}`, () => {
    const size = 128;
    const { c, ctx } = canvas(size);
    ctx.fillStyle = 'rgba(96,104,110,1)';
    ctx.fillRect(0, 0, size, size);
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(104,112,118,1)';
    ctx.lineWidth = 7;
    for (let i = 0; i <= size; i += 21) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(130,138,144,1)';
    for (let i = 0; i <= size; i += 42) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
    }
    return toTexture(c, repeat);
  });
}

/** Diagonal hazard stripes. */
export function hazardTexture(repeat = 1) {
  return get(`hazard-${repeat}`, () => {
    const size = 128;
    const { c, ctx } = canvas(size);
    ctx.fillStyle = '#d8a12a';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#1d1d1f';
    ctx.save();
    ctx.rotate(-0.6);
    for (let i = -size; i < size * 2; i += 36) ctx.fillRect(i, -size, 18, size * 3);
    ctx.restore();
    speckle(ctx, size, 900, 0.04, 0.22, false);
    return toTexture(c, repeat);
  });
}

/** Soft round shadow blob used for cheap fake ambient occlusion decals. */
export function aoBlobTexture() {
  return get('aoblob', () => {
    const size = 128;
    const { c, ctx } = canvas(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.62)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Radial glow sprite: muzzle flash, impact sparks, lamp bloom. */
export function glowTexture() {
  return get('glow', () => {
    const size = 128;
    const { c, ctx } = canvas(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,228,160,0.85)');
    g.addColorStop(0.6, 'rgba(255,150,40,0.28)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Small soft puff for smoke / dust particles. */
export function puffTexture() {
  return get('puff', () => {
    const size = 64;
    const { c, ctx } = canvas(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(220,220,220,0.55)');
    g.addColorStop(0.5, 'rgba(190,190,190,0.24)');
    g.addColorStop(1, 'rgba(160,160,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Bullet hole decal (dark centre, cracked rim). */
export function bulletHoleTexture() {
  return get('hole', () => {
    const size = 64;
    const { c, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(6,6,8,0.95)');
    g.addColorStop(0.38, 'rgba(20,18,16,0.8)');
    g.addColorStop(0.62, 'rgba(90,84,76,0.35)');
    g.addColorStop(1, 'rgba(120,114,106,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,10,12,0.5)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = 8 + Math.random() * 6;
      const r1 = r0 + 4 + Math.random() * 12;
      ctx.beginPath();
      ctx.moveTo(size / 2 + Math.cos(a) * r0, size / 2 + Math.sin(a) * r0);
      ctx.lineTo(size / 2 + Math.cos(a) * r1, size / 2 + Math.sin(a) * r1);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function disposeTextures() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
