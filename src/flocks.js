// Flock detection and note triggering.
//
// A "flock" is a connected group of boids. Two boids are linked if they're
// within visual range of each other, and links chain: if A sees B and B sees
// C, then A, B and C are one flock even if A can't see C.
//
// FlockTracker runs a few times a second. It matches each flock to the flock
// it was on the previous tick and decides which flocks should sing.

import { MIN_FLOCK_SIZE, flockSizeToStep, noteCount } from './music.js';

// Analysis runs every ANALYZE_EVERY simulation steps (60 steps/sec).
export const ANALYZE_EVERY = 12; // 5 ticks per second
const SETTLE_TICKS = 2; // a new flock must hold together this long before it first sings
const MIN_TICKS_BETWEEN_NOTES = 3; // a flock never re-triggers faster than this
const REPEAT_TICKS = 15; // a stable flock re-sings its note this often (3 s)
const HYSTERESIS = 0.75; // in scale steps, so a boid at the edge doesn't cause flicker

// Union-find over every pair within `range`. Returns flocks of at least
// MIN_FLOCK_SIZE, plus a per-boid label (-1 = not in a flock).
export function findFlocks(boids, range) {
  const n = boids.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const range2 = range * range;
  for (let i = 0; i < n; i += 1) {
    const a = boids[i];
    for (let j = i + 1; j < n; j += 1) {
      const b = boids[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      if (dx * dx + dy * dy + dz * dz < range2) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(i);
  }

  const labels = new Int32Array(n).fill(-1);
  const flocks = [];
  for (const members of groups.values()) {
    if (members.length < MIN_FLOCK_SIZE) continue;
    const id = flocks.length;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const i of members) {
      labels[i] = id;
      cx += boids[i].x;
      cy += boids[i].y;
      cz += boids[i].z;
    }
    const size = members.length;
    flocks.push({ id, members, size, center: { x: cx / size, y: cy / size, z: cz / size } });
  }
  return { labels, flocks };
}

export class FlockTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.tick = 0;
    this.prevLabels = null;
    this.prevStates = [];
    this.flocks = [];
    this.scale = null;
  }

  // Returns the notes to play this tick: [{ note, flock }], where note is an
  // index into `scale` (0 = lowest).
  update(boids, range, scale) {
    this.tick += 1;
    if (scale !== this.scale) {
      // New scale: keep flock identities but forget their notes, so every
      // flock re-sings in the new scale right away.
      for (const state of this.prevStates) {
        state.step = null;
        state.playedStep = null;
      }
      this.scale = scale;
    }
    const count = noteCount(scale);
    const { labels, flocks } = findFlocks(boids, range);
    const states = [];
    const events = [];

    for (const flock of flocks) {
      const prev = this.#matchPrevious(flock);
      const exact = flockSizeToStep(flock.size, scale);

      // Hysteresis: keep the last note until the size has clearly moved away.
      let step = Math.round(exact);
      if (prev && prev.step !== null && Math.abs(exact - prev.step) <= HYSTERESIS) step = prev.step;
      step = Math.min(step, count - 1);

      const state = {
        step,
        age: prev ? prev.age + 1 : 1,
        playedStep: prev ? prev.playedStep : null,
        lastPlayed: prev ? prev.lastPlayed : -Infinity,
      };
      const since = this.tick - state.lastPlayed;
      const changed = state.playedStep !== step;
      const fresh = state.playedStep === null; // never sung, or the scale just changed
      const settled = state.age >= SETTLE_TICKS;
      if (settled && ((changed && (fresh || since >= MIN_TICKS_BETWEEN_NOTES)) || since >= REPEAT_TICKS)) {
        state.playedStep = step;
        state.lastPlayed = this.tick;
        // Steps count downward from the top of the scale: bigger flock = lower note.
        events.push({ note: count - 1 - step, flock });
      }
      states.push(state);
    }

    this.prevLabels = labels;
    this.prevStates = states;
    this.flocks = flocks;
    return events;
  }

  // The previous flock that most of this flock's members belonged to.
  #matchPrevious(flock) {
    if (!this.prevLabels) return null;
    const counts = new Map();
    let best = -1;
    let bestCount = 0;
    for (const i of flock.members) {
      const label = i < this.prevLabels.length ? this.prevLabels[i] : -1;
      if (label < 0) continue;
      const c = (counts.get(label) || 0) + 1;
      counts.set(label, c);
      if (c > bestCount) {
        bestCount = c;
        best = label;
      }
    }
    return best >= 0 ? this.prevStates[best] : null;
  }
}
