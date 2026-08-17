/**
 * Lightweight waypoint navigation graph.
 *
 * Nodes are hand-placed on every route (including stairs, catwalks and roofs).
 * Edges are generated at load time by testing line-of-sight at knee and chest
 * height plus sampling the walkable surface along the segment, so enemies
 * never path through a wall or step off a catwalk. A* runs over the graph and
 * paths are string-pulled so movement looks direct rather than node-to-node.
 */

import * as THREE from 'three';

// [x, z, expectedY]  expectedY is the surface the waypoint should sit on, so
// elevated nodes snap to the catwalk / roof / step instead of whatever happens
// to be the highest collider above that spot.
const NODES = [
  // ---- team A side ----
  [-51, 0, 0], [-51, -8, 0], [-51, 8, 0], [-46, -14, 0], [-46, 14, 0], [-44, 0, 0],
  [-38, -6, 0], [-38, 6, 0], [-38, -16, 0], [-38, 16, 0], [-34, 0, 0],
  [-30, -14, 0], [-30, 14, 0], [-28, 0, 0], [-42, -20, 0], [-42, 20, 0],
  // ---- warehouse west approach ----
  [-26, -9, 0], [-26, 8, 0], [-21, -9, 0], [-21, 8, 0],
  // ---- warehouse interior ----
  [-16, 0, 0], [-16, -12, 0], [-16, 12, 0],
  [-8, -6, 0], [-8, 6, 0], [-8, 0, 0], [-4, -13, 0],
  [0, -8, 0], [0, 0, 0], [0, 8, 0], [4, 13, 0],
  [8, -6, 0], [8, 6, 0], [8, 0, 0],
  [16, 0, 0], [16, -12, 0], [16, 12, 0], [11, -6, 0], [-11, 6, 0],
  // ---- warehouse doors ----
  [0, -18, 0], [-19, -18, 0], [19, -18, 0], [6, 18, 0], [-17, 18, 0],
  [26, -7, 0], [26, 9, 0], [21, -7, 0], [21, 9, 0],
  // ---- team B side ----
  [30, -14, 0], [30, 14, 0], [34, 0, 0], [28, 0, 0],
  [38, -6, 0], [38, 6, 0], [38, -16, 0], [38, 16, 0],
  [42, -20, 0], [42, 20, 0],
  [46, -14, 0], [46, 14, 0], [51, 0, 0], [51, -8, 0], [51, 8, 0], [44, 0, 0],
  // ---- north corridor + approaches ----
  [-20, -32, 0], [-12, -32, 0], [-4, -32, 0], [4, -32, 0], [12, -32, 0], [20, -32, 0],
  [-18, -27, 0], [-12, -27, 0], [0, -27, 0], [12, -27, 0], [18, -27, 0],
  [-12, -38, 0], [0, -38, 0], [12, -38, 0], [-26, -38, 0], [26, -38, 0],
  [-30, -26, 0], [26, -26, 0], [-46, -34, 0], [46, -34, 0], [-52, -30, 0], [52, -30, 0],
  // ---- annex A ----
  [-30, -25, 0], [-36, -25, 0], [-40, -25, 0], [-44, -25, 0], [-43, -21, 0], [-40, -16, 0],
  // ---- annex B ----
  [30, 25, 0], [36, 25, 0], [40, 25, 0], [44, 25, 0], [43, 21, 0], [40, 16, 0],
  // ---- south open ground ----
  [-24, 26, 0], [-16, 32, 0], [-8, 26, 0], [0, 32, 0], [8, 26, 0], [16, 32, 0], [24, 26, 0],
  [0, 40, 0], [-30, 34, 0], [30, 34, 0], [-40, 30, 0], [40, 30, 0],
  [-50, 32, 0], [50, 32, 0], [-24, -26, 0], [24, -22, 0], [-52, 24, 0], [52, 24, 0],
  // ---- loading dock: stairs then deck ----
  [8.4, -23.0, 0], [8.4, -22.4, 0.65], [8.4, -21.3, 1.3],
  [-10.4, -23.0, 0], [-10.4, -22.4, 0.65], [-10.4, -21.3, 1.3],
  [-8, -19, 1.3], [0, -19, 1.3], [6, -19, 1.3],
  // ---- west catwalk + stair (16 steps of 0.3 m) ----
  [-22, -13, 0.9], [-22, -11, 2.4], [-22, -9, 3.6], [-22, -7.4, 4.8],
  [-22, -4, 4.8], [-22, 2, 4.8], [-22, 8, 4.8], [-22, 13, 4.8],
  // ---- east catwalk + stair ----
  [22, 13, 0.9], [22, 11, 2.4], [22, 9, 3.6], [22, 7.4, 4.8],
  [22, 4, 4.8], [22, -2, 4.8], [22, -8, 4.8], [22, -13, 4.8],
  // ---- central bridge ----
  [-16, 0, 4.8], [-8, 0, 4.8], [0, 0, 4.8], [8, 0, 4.8], [16, 0, 4.8],
  // ---- annex A stair (18 steps of 0.29 m) + roof ----
  [-48.5, -29, 0.58], [-48.5, -27, 2.02], [-48.5, -25, 3.18], [-48.5, -23, 4.62],
  [-47.9, -20.7, 5.2],
  [-44, -22, 5.2], [-40, -22, 5.2], [-40, -27, 5.2], [-35, -25, 5.2],
  // ---- annex B stair + roof ----
  [48.5, 29, 0.58], [48.5, 27, 2.02], [48.5, 25, 3.18], [48.5, 23, 4.62],
  [47.9, 20.7, 5.2],
  [44, 22, 5.2], [40, 22, 5.2], [40, 27, 5.2], [35, 25, 5.2]
];

const MAX_EDGE = 15;
const ACTOR_RADIUS = 0.42;
const ACTOR_HEIGHT = 1.75;


export class NavGraph {
  constructor() {
    this.nodes = [];
    this.coverPoints = [];
    this._shortlist = [];
    this._open = [];
    this._cameFrom = null;
    this._gScore = null;
    this._fScore = null;
    this._closed = null;
    this._runId = 0;
  }

  build(map) {
    const col = map.collision;
    this.collision = col;
    this.nodes.length = 0;

    let rejected = 0;
    for (let i = 0; i < NODES.length; i++) {
      const [x, z, expectedY] = NODES[i];
      const want = expectedY || 0;
      const y = col.groundHeightAt(x, z, want + 0.9, ACTOR_RADIUS);
      // the surface must actually be where the table says it is
      if (Math.abs(y - want) > 1.1) { rejected++; continue; }
      if (col.isBlocked(x, y + 0.05, z, ACTOR_RADIUS, ACTOR_HEIGHT)) { rejected++; continue; }
      this.nodes.push({
        id: this.nodes.length,
        x, y, z,
        level: want > 0.6 ? 1 : 0,
        pos: new THREE.Vector3(x, y, z),
        edges: [],
        costs: []
      });
    }
    this.rejectedNodes = rejected;

    // --- edges ---
    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.nodes[j];
        const dx = a.x - b.x, dz = a.z - b.z, dy = a.y - b.y;
        const flat = Math.sqrt(dx * dx + dz * dz);
        if (flat > MAX_EDGE) continue;
        if (Math.abs(dy) > 3.2) continue;
        if (flat < 0.3 && Math.abs(dy) > 0.5) continue;
        if (!this._walkable(col, a, b)) continue;
        if (!this._clear(a, b, col)) continue;
        const cost = Math.sqrt(flat * flat + dy * dy * 2.2);
        a.edges.push(b.id); a.costs.push(cost);
        b.edges.push(a.id); b.costs.push(cost);
      }
    }

    // prune orphans so pathfinding can't target unreachable islands
    this.nodes = this.nodes.filter((nd) => nd.edges.length > 0);
    const remap = new Map();
    this.nodes.forEach((nd, idx) => remap.set(nd.id, idx));
    for (const nd of this.nodes) {
      const e = [], c = [];
      for (let k = 0; k < nd.edges.length; k++) {
        const t = remap.get(nd.edges[k]);
        if (t !== undefined) { e.push(t); c.push(nd.costs[k]); }
      }
      nd.edges = e; nd.costs = c;
    }
    this.nodes.forEach((nd, idx) => { nd.id = idx; });

    const count = this.nodes.length;
    this._cameFrom = new Int32Array(count);
    this._gScore = new Float32Array(count);
    this._fScore = new Float32Array(count);
    this._closed = new Uint8Array(count);
    this._visited = new Int32Array(count);

    this._buildCover(map);
    return this;
  }

  /**
   * The walkable surface along the segment must follow the straight
   * interpolation within one step height — otherwise an actor with a 0.48 m
   * step would be stopped by the ledge halfway along.
   */
  _walkable(col, a, b) {
    const steps = 8;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const expected = a.y + (b.y - a.y) * t;
      const g = col.groundHeightAt(x, z, expected + 1.0, ACTOR_RADIUS);
      if (Math.abs(g - expected) > 0.45) return false;
      // slightly fatter than the real body so paths always have clearance
      if (col.isBlocked(x, g + 0.06, z, ACTOR_RADIUS + 0.06, ACTOR_HEIGHT)) return false;
    }
    return true;
  }

  /** Body-width clearance, not just a thin sight line. */
  _clear(a, b, col) {
    return col.pathClear(a.x, a.y, a.z, b.x, b.y, b.z, ACTOR_RADIUS + 0.06);
  }

  /**
   * Cover points: standable spots hugging flagged props. Stored with the
   * height of the thing they hide behind so the AI can judge usefulness.
   */
  _buildCover(map) {
    const col = map.collision;
    this.coverPoints.length = 0;
    const seen = new Set();
    const spots = map.coverSpots || [];
    const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.75, 0.75], [-0.75, 0.75], [0.75, -0.75], [-0.75, -0.75]];
    for (const s of spots) {
      for (const [ox, oz] of offsets) {
        const d = 1.35;
        const x = s.x + ox * d;
        const z = s.z + oz * d;
        if (Math.abs(x) > 57 || Math.abs(z) > 42) continue;
        // de-duplicate: neighbouring props generate overlapping offsets
        const key = `${Math.round(x)}:${Math.round(z)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const y = col.groundHeightAt(x, z, 1.7, ACTOR_RADIUS);
        if (y > 1.6) continue;
        if (col.isBlocked(x, y + 0.06, z, ACTOR_RADIUS, ACTOR_HEIGHT)) continue;
        this.coverPoints.push({
          pos: new THREE.Vector3(x, y, z),
          coverHeight: s.height,
          anchor: new THREE.Vector3(s.x, y, s.z)
        });
      }
    }
  }

  nearestNode(pos, maxDist = 26) {
    let best = null, bestD = maxDist * maxDist;
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i];
      const dx = nd.x - pos.x, dy = nd.y - pos.y, dz = nd.z - pos.z;
      const d = dx * dx + dz * dz + dy * dy * 3;
      if (d < bestD) { bestD = d; best = nd; }
    }
    return best;
  }

  randomNode(level = -1) {
    const pool = level < 0 ? this.nodes : this.nodes.filter((n) => n.level === level);
    if (pool.length === 0) return null;
    return pool[(Math.random() * pool.length) | 0];
  }

  /** Random node at least `minDist` away from `pos`. */
  randomNodeFar(pos, minDist) {
    const min2 = minDist * minDist;
    for (let tries = 0; tries < 24; tries++) {
      const nd = this.nodes[(Math.random() * this.nodes.length) | 0];
      const dx = nd.x - pos.x, dz = nd.z - pos.z;
      if (dx * dx + dz * dz >= min2) return nd;
    }
    return this.nodes[(Math.random() * this.nodes.length) | 0];
  }

  /**
   * A* between two world positions.
   * @returns {THREE.Vector3[]} waypoints (may be empty when no route exists)
   */
  findPath(fromPos, toPos) {
    const start = this.nearestNode(fromPos);
    const goal = this.nearestNode(toPos);
    if (!start || !goal) return [];
    if (start === goal) return [new THREE.Vector3(toPos.x, toPos.y, toPos.z)];

    const nodes = this.nodes;
    const cameFrom = this._cameFrom;
    const g = this._gScore;
    const f = this._fScore;
    const closed = this._closed;
    const visited = this._visited;
    const run = ++this._runId;

    const open = this._open;
    open.length = 0;
    visited[start.id] = run;
    closed[start.id] = 0;
    g[start.id] = 0;
    f[start.id] = heuristic(start, goal);
    cameFrom[start.id] = -1;
    open.push(start.id);

    let found = false;
    let guard = 0;
    while (open.length > 0 && guard++ < 4000) {
      // linear scan is fine for a graph this size
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bestIdx]]) bestIdx = i;
      const current = open[bestIdx];
      if (current === goal.id) { found = true; break; }
      open.splice(bestIdx, 1);
      closed[current] = 1;

      const nd = nodes[current];
      for (let k = 0; k < nd.edges.length; k++) {
        const nb = nd.edges[k];
        if (visited[nb] === run && closed[nb]) continue;
        const tentative = g[current] + nd.costs[k];
        if (visited[nb] !== run) {
          visited[nb] = run;
          closed[nb] = 0;
          g[nb] = Infinity;
        }
        if (tentative < g[nb]) {
          cameFrom[nb] = current;
          g[nb] = tentative;
          f[nb] = tentative + heuristic(nodes[nb], goal);
          if (open.indexOf(nb) === -1) open.push(nb);
        }
      }
    }

    if (!found) return [];

    // reconstruct
    const rev = [];
    let cur = goal.id;
    let safety = 0;
    while (cur !== -1 && safety++ < 500) {
      rev.push(nodes[cur].pos);
      cur = cameFrom[cur];
    }
    rev.reverse();

    const path = [];
    for (let i = 0; i < rev.length; i++) path.push(rev[i].clone());
    path.push(new THREE.Vector3(toPos.x, toPos.y, toPos.z));

    return stringPull(path, this.collision);
  }

  /**
   * Best cover position: hides from `threat`, close to `from`, and not
   * ludicrously far from the fight.
   */
  findCover(from, threat, maxDist) {
    const col = this.collision;
    const max2 = maxDist * maxDist;
    const pts = this.coverPoints;

    // Cheap pass: score by distance only, keeping the best handful. Raycasts
    // are far too expensive to run against every cover point.
    const shortlist = this._shortlist;
    shortlist.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const cp = pts[i];
      const dx = cp.pos.x - from.x, dz = cp.pos.z - from.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > max2 || d2 < 2.0) continue;
      const tdx = cp.pos.x - threat.x, tdz = cp.pos.z - threat.z;
      const td2 = tdx * tdx + tdz * tdz;
      if (td2 < 64) continue; // too close to the threat to be safe
      const score = -d2 * 0.06 + cp.coverHeight * 1.6 + Math.random() * 4;
      shortlist.push({ cp, score });
    }
    if (shortlist.length === 0) return null;
    shortlist.sort((a, b) => b.score - a.score);

    // Expensive pass: verify only the top candidates actually break the sight
    // line from the threat.
    const checks = Math.min(shortlist.length, 10);
    for (let i = 0; i < checks; i++) {
      const cp = shortlist[i].cp;
      if (!col.losClear(cp.pos.x, cp.pos.y + 1.3, cp.pos.z, threat.x, threat.y + 1.4, threat.z)) return cp;
    }
    return null;
  }

  /** Debug helper: renders the graph as lines. */
  buildDebugMesh() {
    const pts = [];
    for (const nd of this.nodes) {
      for (const e of nd.edges) {
        if (e < nd.id) continue;
        const o = this.nodes[e];
        pts.push(nd.x, nd.y + 0.2, nd.z, o.x, o.y + 0.2, o.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x00ff88 }));
  }
}

function heuristic(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dz * dz) + Math.abs(dy) * 1.5;
}

/** Remove waypoints that can be skipped with a clear straight line. */
function stringPull(path, col) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    for (; j > i + 1; j--) {
      const a = path[i], b = path[j];
      if (Math.abs(a.y - b.y) < 0.5 &&
          col.pathClear(a.x, a.y, a.z, b.x, b.y, b.z, ACTOR_RADIUS + 0.06)) break;
    }
    out.push(path[j]);
    i = j;
  }
  return out;
}
