/**
 * Axis-aligned collision world with a uniform grid broadphase.
 *
 * The map registers every solid volume as an AABB. Actors (player + enemies)
 * are treated as axis-aligned boxes (a cheap stand-in for a capsule) and are
 * resolved one axis at a time, which gives clean wall-sliding, plus a step-up
 * pass so stairs and low ledges are walkable.
 *
 * No allocations happen inside moveAndCollide().
 */

const EPS = 1e-4;

export class CollisionWorld {
  constructor(cellSize = 8) {
    this.cellSize = cellSize;
    this.boxes = [];
    this.grid = new Map();
    this.floorY = 0;
    this._stamps = null;
    this._stamp = 0;
    this._result = [];
    this._built = false;
    this._rayHit = { distance: 0, nx: 0, ny: 0, nz: 0 };
  }

  /**
   * @param {{minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number}} b
   */
  addRaw(b) {
    this.boxes.push(b);
    this._built = false;
    return b;
  }

  /** Add from center + half-extents. */
  addBox(cx, cy, cz, hx, hy, hz) {
    return this.addRaw({
      minX: cx - hx, minY: cy - hy, minZ: cz - hz,
      maxX: cx + hx, maxY: cy + hy, maxZ: cz + hz
    });
  }

  /** Add from a THREE.Box3 (already in world space). */
  addBox3(box3, inflate = 0) {
    return this.addRaw({
      minX: box3.min.x - inflate, minY: box3.min.y - inflate, minZ: box3.min.z - inflate,
      maxX: box3.max.x + inflate, maxY: box3.max.y + inflate, maxZ: box3.max.z + inflate
    });
  }

  clear() {
    this.boxes.length = 0;
    this.grid.clear();
    this._built = false;
  }

  build() {
    this.grid.clear();
    const cs = this.cellSize;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      const x0 = Math.floor(b.minX / cs), x1 = Math.floor(b.maxX / cs);
      const z0 = Math.floor(b.minZ / cs), z1 = Math.floor(b.maxZ / cs);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = x * 73856093 ^ z * 19349663;
          let cell = this.grid.get(key);
          if (!cell) { cell = []; this.grid.set(key, cell); }
          cell.push(i);
        }
      }
    }
    this._stamps = new Int32Array(this.boxes.length);
    this._stamp = 0;
    this._built = true;
    return this;
  }

  /**
   * Collect boxes whose cells overlap the XZ rectangle. Returns an internal
   * array that is reused between calls — copy it if you need to keep it.
   */
  query(minX, minZ, maxX, maxZ) {
    if (!this._built) this.build();
    const out = this._result;
    out.length = 0;
    const cs = this.cellSize;
    const stamp = ++this._stamp;
    const stamps = this._stamps;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const cell = this.grid.get(x * 73856093 ^ z * 19349663);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const idx = cell[i];
          if (stamps[idx] === stamp) continue;
          stamps[idx] = stamp;
          out.push(this.boxes[idx]);
        }
      }
    }
    return out;
  }

  /** True if an actor-sized box at this position would intersect anything. */
  isBlocked(x, y, z, radius, height) {
    const list = this.query(x - radius, z - radius, x + radius, z + radius);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (x + radius > b.minX && x - radius < b.maxX &&
          z + radius > b.minZ && z - radius < b.maxZ &&
          y + height > b.minY + EPS && y < b.maxY - EPS) {
        return true;
      }
    }
    return false;
  }

  /**
   * Ray vs. the collider set (slab test over the broadphase). This is an order
   * of magnitude cheaper than mesh raycasting — an InstancedMesh raycast has to
   * transform every instance — so all line-of-sight and AI occlusion queries
   * go through here. Boxes flagged `opaque === false` (railings, chain-link)
   * are skipped: they block movement but not sight or bullets.
   *
   * @returns {{distance:number, nx:number, ny:number, nz:number}|null}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, opaqueOnly = true) {
    const ex = ox + dx * maxDist;
    const ez = oz + dz * maxDist;
    const list = this.query(
      Math.min(ox, ex) - 0.02, Math.min(oz, ez) - 0.02,
      Math.max(ox, ex) + 0.02, Math.max(oz, ez) + 0.02
    );

    let best = maxDist;
    let bnx = 0, bny = 0, bnz = 0;
    let found = false;

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (opaqueOnly && b.opaque === false) continue;
      // ignore boxes we are already inside, otherwise a clipped actor is blind
      if (ox > b.minX && ox < b.maxX && oy > b.minY && oy < b.maxY && oz > b.minZ && oz < b.maxZ) continue;

      let tmin = 0;
      let tmax = best;
      let axis = -1;
      let sign = 0;

      // X slab
      if (dx > -1e-9 && dx < 1e-9) {
        if (ox < b.minX || ox > b.maxX) continue;
      } else {
        const inv = 1 / dx;
        let t1 = (b.minX - ox) * inv;
        let t2 = (b.maxX - ox) * inv;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Y slab
      if (dy > -1e-9 && dy < 1e-9) {
        if (oy < b.minY || oy > b.maxY) continue;
      } else {
        const inv = 1 / dy;
        let t1 = (b.minY - oy) * inv;
        let t2 = (b.maxY - oy) * inv;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Z slab
      if (dz > -1e-9 && dz < 1e-9) {
        if (oz < b.minZ || oz > b.maxZ) continue;
      } else {
        const inv = 1 / dz;
        let t1 = (b.minZ - oz) * inv;
        let t2 = (b.maxZ - oz) * inv;
        let s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }

      if (tmin >= 0 && tmin < best) {
        best = tmin;
        found = true;
        bnx = axis === 0 ? sign : 0;
        bny = axis === 1 ? sign : 0;
        bnz = axis === 2 ? sign : 0;
        if (axis === -1) { bny = 1; }
      }
    }

    if (!found) return null;
    const out = this._rayHit;
    out.distance = best;
    out.nx = bnx; out.ny = bny; out.nz = bnz;
    return out;
  }

  /** Unobstructed sight line between two points? */
  losClear(fromX, fromY, fromZ, toX, toY, toZ) {
    const dx = toX - fromX, dy = toY - fromY, dz = toZ - fromZ;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return true;
    const inv = 1 / len;
    return this.raycast(fromX, fromY, fromZ, dx * inv, dy * inv, dz * inv, len - 0.06) === null;
  }

  /**
   * Can a body of `radius` walk the straight line between two ground points?
   * Tests the left and right edges of the body at shin and chest height, so a
   * thin sight line through a gap the actor cannot fit through is rejected.
   * Ignores non-opaque colliders, so add a separate check if fences matter.
   */
  pathClear(fromX, fromY, fromZ, toX, toY, toZ, radius = 0.5) {
    const dx = toX - fromX, dz = toZ - fromZ;
    const flat = Math.sqrt(dx * dx + dz * dz);
    if (flat < 1e-4) return true;
    // perpendicular offset in XZ
    const px = (-dz / flat) * radius;
    const pz = (dx / flat) * radius;
    for (let s = -1; s <= 1; s++) {
      const ox = px * s, oz = pz * s;
      for (let h = 0; h < 2; h++) {
        const y = h === 0 ? 0.35 : 1.4;
        if (!this.losClear(fromX + ox, fromY + y, fromZ + oz, toX + ox, toY + y, toZ + oz)) return false;
      }
    }
    return true;
  }

  /** Does an arbitrary box (center + half-extents) intersect anything solid? */
  overlapsBox(cx, cy, cz, hx, hy, hz, margin = 0) {
    const list = this.query(cx - hx - margin, cz - hz - margin, cx + hx + margin, cz + hz + margin);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.ground) continue; // props stand ON the deck, they don't clash with it
      if (cx + hx + margin > b.minX && cx - hx - margin < b.maxX &&
          cz + hz + margin > b.minZ && cz - hz - margin < b.maxZ &&
          cy + hy + margin > b.minY && cy - hy - margin < b.maxY) {
        return true;
      }
    }
    return false;
  }

  /** Highest solid surface at or below `fromY` for a footprint of `radius`. */
  groundHeightAt(x, z, fromY = 200, radius = 0.3) {
    const list = this.query(x - radius, z - radius, x + radius, z + radius);
    let best = this.floorY;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.noGround) continue; // e.g. the invisible arena ceiling
      if (x + radius > b.minX && x - radius < b.maxX &&
          z + radius > b.minZ && z - radius < b.maxZ &&
          b.maxY <= fromY + 0.02 && b.maxY > best) {
        best = b.maxY;
      }
    }
    return best;
  }
}

/**
 * Integrate an actor's velocity with collision response.
 *
 * @param {CollisionWorld} world
 * @param {{position:{x,y,z}, velocity:{x,y,z}, radius:number, height:number, stepHeight?:number}} actor
 * @param {number} dt
 * @param {{grounded:boolean,hitWall:boolean,hitCeiling:boolean,landed:boolean,groundY:number}} out
 */
export function moveAndCollide(world, actor, dt, out) {
  const pos = actor.position;
  const vel = actor.velocity;
  const r = actor.radius;
  const h = actor.height;
  const step = actor.stepHeight || 0;

  out.grounded = false;
  out.hitWall = false;
  out.hitCeiling = false;
  out.landed = false;
  out.groundY = world.floorY;

  const dx = vel.x * dt;
  const dy = vel.y * dt;
  const dz = vel.z * dt;

  // One broadphase query covering the whole swept region for this frame.
  const pad = r + step + 0.75;
  const qMinX = Math.min(pos.x, pos.x + dx) - pad;
  const qMaxX = Math.max(pos.x, pos.x + dx) + pad;
  const qMinZ = Math.min(pos.z, pos.z + dz) - pad;
  const qMaxZ = Math.max(pos.z, pos.z + dz) + pad;
  const list = world.query(qMinX, qMinZ, qMaxX, qMaxZ);
  const n = list.length;

  // ---------------------------------------------------------------- vertical
  const prevFeet = pos.y;
  let newFeet = prevFeet + dy;

  if (dy <= 0) {
    let best = world.floorY;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      if (pos.x + r <= b.minX || pos.x - r >= b.maxX ||
          pos.z + r <= b.minZ || pos.z - r >= b.maxZ) continue;
      const top = b.maxY;
      if (top <= prevFeet + 0.08 && top >= newFeet - EPS && top > best) best = top;
    }
    if (newFeet <= best + EPS) {
      newFeet = best;
      out.grounded = true;
      out.groundY = best;
      if (vel.y < -1.5) out.landed = true;
      vel.y = 0;
    }
  } else {
    let ceil = Infinity;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      if (pos.x + r <= b.minX || pos.x - r >= b.maxX ||
          pos.z + r <= b.minZ || pos.z - r >= b.maxZ) continue;
      if (b.minY >= prevFeet + h - 0.05 && b.minY < ceil) ceil = b.minY;
    }
    if (newFeet + h > ceil) {
      newFeet = ceil - h - EPS;
      vel.y = 0;
      out.hitCeiling = true;
    }
  }
  pos.y = newFeet;

  // -------------------------------------------------------------- horizontal
  if (dx !== 0) resolveAxis(list, n, pos, vel, r, h, step, 'x', dx, out);
  if (dz !== 0) resolveAxis(list, n, pos, vel, r, h, step, 'z', dz, out);

  return out;
}

function overlaps(b, x, y, z, r, h) {
  return x + r > b.minX + EPS && x - r < b.maxX - EPS &&
         z + r > b.minZ + EPS && z - r < b.maxZ - EPS &&
         y + h > b.minY + EPS && y < b.maxY - EPS;
}

function resolveAxis(list, n, pos, vel, r, h, step, axis, delta, out) {
  const old = pos[axis];
  pos[axis] = old + delta;

  let blocked = false;
  let stepTop = -Infinity;

  for (let i = 0; i < n; i++) {
    const b = list[i];
    if (!overlaps(b, pos.x, pos.y, pos.z, r, h)) continue;
    if (b.maxY - pos.y <= step) {
      if (b.maxY > stepTop) stepTop = b.maxY;
      continue;
    }
    blocked = true;
    break;
  }

  if (blocked) {
    pos[axis] = old;
    vel[axis] = 0;
    out.hitWall = true;
    return;
  }

  if (stepTop > pos.y) {
    // Try lifting the actor onto the ledge; abort the whole move if the
    // raised position is itself obstructed (low ceiling / wedged corner).
    const oldY = pos.y;
    pos.y = stepTop + EPS;
    for (let i = 0; i < n; i++) {
      if (overlaps(list[i], pos.x, pos.y, pos.z, r, h)) {
        pos.y = oldY;
        pos[axis] = old;
        vel[axis] = 0;
        out.hitWall = true;
        return;
      }
    }
    out.grounded = true;
    out.groundY = stepTop;
    if (vel.y < 0) vel.y = 0;
  }
}
