// A 3D port of Ben Eater's boids (https://eater.net/boids,
// https://github.com/beneater/boids). Each rule matches the original line for
// line and adds a z axis: every boid has z/dz, distance is measured in 3D, and
// keepWithinBounds also steers on z. The constants are the original ones.
//
// One addition the original doesn't have: momentum (params.momentum). Each
// boid beats its wings, and with momentum on, the beats push it forward,
// climbing costs speed, diving gains it, and drag slows a gliding bird. With
// momentum off the flight is exactly eater.net's. The wingbeat is tracked
// either way so the renderer can animate it.
//
// This module has no three.js dependency. It only updates plain objects.

export const MARGIN = 200; // distance from a wall where boids start turning
export const TURN_FACTOR = 1;
export const SPEED_LIMIT = 15;
export const HISTORY_LENGTH = 50;

// Live-tunable values, using eater.net's slider defaults.
export const DEFAULT_PARAMS = Object.freeze({
  visualRange: 75,
  centeringFactor: 0.005, // "Coherence"
  minDistance: 20,
  avoidFactor: 0.05, // "Separation"
  matchingFactor: 0.05, // "Alignment"
  momentum: true, // not in the original; false = eater.net's exact behavior
});

// Momentum model. Swallows "flap-glide": flap until they're fast, glide until
// they've slowed, then flap again. Units are per simulation step (60 Hz).
export const FLIGHT = Object.freeze({
  flapHz: 3.2, // average wingbeats per second
  flapHzSpread: 0.6, // each boid gets flapHz ± this
  thrust: 1.6, // peak forward push during a downstroke
  gravity: 0.45, // speed lost per step climbing straight up (gained diving)
  drag: 0.0017, // speed lost per step = drag * speed²
  glideAbove: 14, // a flapping bird starts gliding above this speed...
  flapBelow: 9, // ...and a gliding bird starts flapping below this one
  climbToFlap: 0.45, // climbing steeper than this (sin of the angle) always needs flapping
  minSpeed: 4, // birds can't hover
  maxSpeed: 22, // replaces the original 15 cap, so dives can run fast
  effortEase: 0.06, // how quickly wingbeats ramp up or die away (per step)
});

// Wing rig, following the fixes at the end of reports/Bird wing motion in
// flight.md. Angles in radians; rates per second unless noted.
const deg = (d) => (d * Math.PI) / 180;
export const WING = Object.freeze({
  downstroke: 0.38, // share of each beat spent on the (fast) downstroke; house martin 0.32-0.41
  upstrokeSpan: 0.35, // span at mid-upstroke, when the wing is most folded; house martin 0.31-0.41
  strokeMid: deg(10), // the flap arc is centred a little above horizontal
  strokeCruise: deg(90), // flap arc in cruise (Nudds et al. 2004 fit for a swallow-sized span)
  strokeMax: deg(130), // ...widening to this when accelerating or climbing hard
  accelMax: 0.5, // forward pull from the flock (units/step²) that counts as "hard" acceleration
  demandEase: 0.08, // smoothing for how hard a bird is working (per step)
  hzAccel: 0.35, // wingbeats up to 35% faster when accelerating hard (pigeon takeoff)
  hzClimb: 0.08, // ...about 8% faster when climbing
  hzCrowd: 0.03, // ...and a little faster among close neighbours (Usherwood et al. 2011)
  stallSpeed: 6, // V_min for the glide-span rule below
  minGlideSpan: 0.33, // the glide rule bottoms out here
  maxSweep: 0.35, // how far fast-gliding wingtips sweep back (fraction of sprite size)
  pauseAbove: 11, // above this speed, swallows sometimes pause mid-upstroke...
  pauseChance: 0.35, // ...on this share of beats...
  pauseSteps: [4, 9], // ...for this many steps (67-150 ms), wings flexed
  bankMax: deg(70), // hard turns bank 60-70°
  rollIn: 10, // roll toward a steeper bank quickly...
  rollOut: 4, // ...and level out more slowly, with no overshoot
});
// Mid-upstroke in clock time: where the wing is most folded, where flap and
// glide hand over (Wu & Popović's blend point), and where pauses happen.
const CLOCK_MID_UPSTROKE = 0.5 + 0.5 * WING.downstroke;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function distance(boid1, boid2) {
  return Math.sqrt(
    (boid1.x - boid2.x) * (boid1.x - boid2.x) +
      (boid1.y - boid2.y) * (boid1.y - boid2.y) +
      (boid1.z - boid2.z) * (boid1.z - boid2.z),
  );
}

export function randomize(boid, bounds) {
  boid.x = Math.random() * bounds.width;
  boid.y = Math.random() * bounds.height;
  boid.z = Math.random() * bounds.depth;
  boid.dx = Math.random() * 10 - 5;
  boid.dy = Math.random() * 10 - 5;
  boid.dz = Math.random() * 10 - 5;
  boid.history = [];
  boid.wingClock = Math.random(); // position in the current beat, 0..1 (0 = top of the stroke)
  boid.wingHz = FLIGHT.flapHz + (Math.random() * 2 - 1) * FLIGHT.flapHzSpread;
  boid.stroke = 0; // the clock warped so the downstroke is shorter, 0..2π (π = bottom)
  boid.effort = 0; // 0 = gliding with wings spread, 1 = flapping
  boid.demand = 0; // how hard it's working: below cruise speed, pulled forward, or climbing
  boid.flapping = false; // flapping right now (changes only at mid-upstroke)
  boid.wantFlap = false; // whether it would like to be
  boid.pause = 0; // steps left in a mid-upstroke pause
  boid.neighbors = 1;
  boid.wingSpan = 1; // visible wingspan seen from below, 0..1
  boid.sweep = 0; // how far the wingtips are swept back
  boid.bank = 0; // roll angle, positive = right wing down
  return boid;
}

export function createBoids(count, bounds) {
  const boids = [];
  for (let i = 0; i < count; i += 1) {
    boids.push(randomize({}, bounds));
  }
  return boids;
}

// Keep a boid inside the box. Within MARGIN of a wall, nudge its velocity
// back toward the middle. This is a soft limit, so boids can overshoot a bit.
function keepWithinBounds(boid, bounds) {
  if (boid.x < MARGIN) boid.dx += TURN_FACTOR;
  if (boid.x > bounds.width - MARGIN) boid.dx -= TURN_FACTOR;
  if (boid.y < MARGIN) boid.dy += TURN_FACTOR;
  if (boid.y > bounds.height - MARGIN) boid.dy -= TURN_FACTOR;
  if (boid.z < MARGIN) boid.dz += TURN_FACTOR;
  if (boid.z > bounds.depth - MARGIN) boid.dz -= TURN_FACTOR;
}

// Cohesion: find the center of mass of nearby boids and steer a little
// toward it. The boid itself is counted, as in the original.
function flyTowardsCenter(boid, boids, params) {
  let centerX = 0;
  let centerY = 0;
  let centerZ = 0;
  let numNeighbors = 0;

  for (const otherBoid of boids) {
    if (distance(boid, otherBoid) < params.visualRange) {
      centerX += otherBoid.x;
      centerY += otherBoid.y;
      centerZ += otherBoid.z;
      numNeighbors += 1;
    }
  }

  boid.neighbors = numNeighbors; // (includes itself) used for crowding in fly()

  if (numNeighbors) {
    centerX = centerX / numNeighbors;
    centerY = centerY / numNeighbors;
    centerZ = centerZ / numNeighbors;

    boid.dx += (centerX - boid.x) * params.centeringFactor;
    boid.dy += (centerY - boid.y) * params.centeringFactor;
    boid.dz += (centerZ - boid.z) * params.centeringFactor;
  }
}

// Separation: move away from boids that are too close.
function avoidOthers(boid, boids, params) {
  let moveX = 0;
  let moveY = 0;
  let moveZ = 0;

  for (const otherBoid of boids) {
    if (otherBoid !== boid) {
      if (distance(boid, otherBoid) < params.minDistance) {
        moveX += boid.x - otherBoid.x;
        moveY += boid.y - otherBoid.y;
        moveZ += boid.z - otherBoid.z;
      }
    }
  }

  boid.dx += moveX * params.avoidFactor;
  boid.dy += moveY * params.avoidFactor;
  boid.dz += moveZ * params.avoidFactor;
}

// Alignment: steer a little toward the average velocity of nearby boids.
function matchVelocity(boid, boids, params) {
  let avgDX = 0;
  let avgDY = 0;
  let avgDZ = 0;
  let numNeighbors = 0;

  for (const otherBoid of boids) {
    if (distance(boid, otherBoid) < params.visualRange) {
      avgDX += otherBoid.dx;
      avgDY += otherBoid.dy;
      avgDZ += otherBoid.dz;
      numNeighbors += 1;
    }
  }

  if (numNeighbors) {
    avgDX = avgDX / numNeighbors;
    avgDY = avgDY / numNeighbors;
    avgDZ = avgDZ / numNeighbors;

    boid.dx += (avgDX - boid.dx) * params.matchingFactor;
    boid.dy += (avgDY - boid.dy) * params.matchingFactor;
    boid.dz += (avgDZ - boid.dz) * params.matchingFactor;
  }
}

// Speed varies with flocking, but cap it, since real animals can't go
// arbitrarily fast.
function limitSpeed(boid) {
  const speed = Math.sqrt(
    boid.dx * boid.dx + boid.dy * boid.dy + boid.dz * boid.dz,
  );
  if (speed > SPEED_LIMIT) {
    boid.dx = (boid.dx / speed) * SPEED_LIMIT;
    boid.dy = (boid.dy / speed) * SPEED_LIMIT;
    boid.dz = (boid.dz / speed) * SPEED_LIMIT;
  }
}

// Wingbeats, and with momentum on, the forces they make. (rx, ry, rz) is how
// much the three flocking rules changed the velocity this step: the flock's
// pull, which the bird answers by working harder.
function fly(boid, momentum, rx, ry, rz) {
  const speed =
    Math.sqrt(boid.dx * boid.dx + boid.dy * boid.dy + boid.dz * boid.dz) || 1e-6;
  const climb = boid.dy / speed; // sine of the climb angle (y is up)

  // Demand: below cruise speed, pulled forward by the flock, or climbing.
  const pull = (rx * boid.dx + ry * boid.dy + rz * boid.dz) / speed;
  const deficit = clamp((FLIGHT.glideAbove - speed) / (FLIGHT.glideAbove - FLIGHT.minSpeed), 0, 1);
  const accelDemand = clamp(0.5 * deficit + Math.max(0, pull) / WING.accelMax, 0, 1);
  const demand = clamp(accelDemand + 0.8 * Math.max(0, climb), 0, 1);
  boid.demand += (demand - boid.demand) * WING.demandEase;

  // Flap-glide wish, with a gap between the two speeds so it doesn't chatter.
  if (boid.wantFlap) {
    if (speed > FLIGHT.glideAbove && climb < FLIGHT.climbToFlap) boid.wantFlap = false;
  } else if (speed < FLIGHT.flapBelow || climb > FLIGHT.climbToFlap) {
    boid.wantFlap = true;
  }

  // Wing clock. A gliding bird's clock rests at mid-upstroke; switching
  // between flapping and gliding only happens there.
  if (!boid.flapping) {
    boid.wingClock = CLOCK_MID_UPSTROKE;
    if (boid.wantFlap) boid.flapping = true;
  } else if (boid.pause > 0) {
    boid.pause -= 1;
  } else {
    // Tempo holds steady in cruise; it rises with acceleration, climbing and crowding.
    const crowd = clamp((boid.neighbors - 1) / 10, 0, 1);
    const hz =
      boid.wingHz *
      (1 + WING.hzAccel * accelDemand + WING.hzClimb * Math.max(0, climb) + WING.hzCrowd * crowd);
    const before = boid.wingClock;
    let after = before + hz / 60;
    if (before < CLOCK_MID_UPSTROKE && after >= CLOCK_MID_UPSTROKE) {
      if (!boid.wantFlap) {
        boid.flapping = false; // finish the beat at mid-upstroke, then glide
        after = CLOCK_MID_UPSTROKE;
      } else if (speed > WING.pauseAbove && Math.random() < WING.pauseChance) {
        const [lo, hi] = WING.pauseSteps; // swallow-style pause, wings flexed
        boid.pause = lo + Math.floor(Math.random() * (hi - lo + 1));
        after = CLOCK_MID_UPSTROKE;
      }
    }
    boid.wingClock = after % 1;
  }
  boid.effort += ((boid.flapping ? 1 : 0) - boid.effort) * FLIGHT.effortEase;

  // Warp the clock so the downstroke takes WING.downstroke of the beat:
  // stroke 0 = top, π = bottom, 2π = top again.
  const c = boid.wingClock;
  const tau = WING.downstroke;
  const stroke = 2 * Math.PI * (c < tau ? (0.5 * c) / tau : 0.5 + (0.5 * (c - tau)) / (1 - tau));
  boid.stroke = stroke;

  // Wing pose. The flap arc widens with demand; the upstroke folds the wing
  // (a pulse that peaks mid-upstroke); a gliding wing shrinks and sweeps back
  // as speed rises (Rosén & Hedenström's rule, span = 5/4 - V / 4V_min).
  const arc = WING.strokeCruise + (WING.strokeMax - WING.strokeCruise) * boid.demand;
  const elevation = boid.effort * (WING.strokeMid + 0.5 * arc * Math.cos(stroke));
  const fold = stroke < Math.PI ? 0 : 0.5 * (1 - Math.cos(2 * stroke));
  const flexed = 1 - boid.effort * fold * (1 - WING.upstrokeSpan);
  const glideRule = clamp(1.25 - speed / (4 * WING.stallSpeed), WING.minGlideSpan, 1);
  const glideSpan = 1 - (1 - glideRule) * (1 - boid.effort);
  boid.wingSpan = Math.cos(elevation) * flexed * glideSpan;
  boid.sweep = (WING.maxSweep * (1 - glideSpan)) / (1 - WING.minGlideSpan);
  if (!momentum) return;

  // Thrust comes on the downstroke, scaled so each beat delivers the same push
  // whatever the downstroke's share, and harder when the bird needs it.
  const downstroke = stroke < Math.PI ? Math.sin(stroke) : 0;
  const thrust =
    FLIGHT.thrust * boid.effort * (0.6 + 0.4 * boid.demand) * downstroke * (0.5 / tau);
  const accel = thrust - FLIGHT.gravity * climb - FLIGHT.drag * speed * speed;
  const next = Math.min(FLIGHT.maxSpeed, Math.max(FLIGHT.minSpeed, speed + accel));
  const k = next / speed;
  boid.dx *= k;
  boid.dy *= k;
  boid.dz *= k;
}

// Roll into turns: bank toward the sideways part of this step's acceleration,
// as in a coordinated turn (atan of lateral acceleration over gravity).
function bankInto(boid, ax, ay, az) {
  const speed = Math.sqrt(boid.dx * boid.dx + boid.dy * boid.dy + boid.dz * boid.dz) || 1e-6;
  const fx = boid.dx / speed;
  const fz = boid.dz / speed;
  // The bird's right: forward × up. Undefined flying straight up or down.
  const len = Math.hypot(fx, fz);
  if (len < 0.2) return;
  const sideways = (ax * -fz + az * fx) / len;
  const target = clamp(Math.atan2(sideways, FLIGHT.gravity), -WING.bankMax, WING.bankMax);
  const rate = Math.abs(target) > Math.abs(boid.bank) ? WING.rollIn : WING.rollOut;
  boid.bank += (target - boid.bank) * (1 - Math.exp(-rate / 60));
}

// Advance one frame. The rule order matches the original, and updates are in
// place, so later boids see the new state of earlier ones in the same frame.
// With momentum on, fly() takes the place of the original speed cap.
export function step(boids, params, bounds) {
  for (const boid of boids) {
    const vx = boid.dx;
    const vy = boid.dy;
    const vz = boid.dz;
    flyTowardsCenter(boid, boids, params);
    avoidOthers(boid, boids, params);
    matchVelocity(boid, boids, params);
    const rx = boid.dx - vx;
    const ry = boid.dy - vy;
    const rz = boid.dz - vz;
    if (params.momentum) {
      fly(boid, true, rx, ry, rz);
    } else {
      limitSpeed(boid);
      fly(boid, false, rx, ry, rz); // wingbeat only; doesn't touch velocity
    }
    keepWithinBounds(boid, bounds);
    bankInto(boid, boid.dx - vx, boid.dy - vy, boid.dz - vz);

    boid.x += boid.dx;
    boid.y += boid.dy;
    boid.z += boid.dz;
    boid.history.push([boid.x, boid.y, boid.z]);
    boid.history = boid.history.slice(-HISTORY_LENGTH);
  }
}
