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
  thrust: 1.4, // peak forward push during a downstroke
  gravity: 0.45, // speed lost per step climbing straight up (gained diving)
  drag: 0.0017, // speed lost per step = drag * speed²
  glideAbove: 14, // a flapping bird starts gliding above this speed...
  flapBelow: 9, // ...and a gliding bird starts flapping below this one
  climbToFlap: 0.45, // climbing steeper than this (sin of the angle) always needs flapping
  minSpeed: 4, // birds can't hover
  maxSpeed: 22, // replaces the original 15 cap, so dives can run fast
  effortEase: 0.06, // how quickly wingbeats ramp up or die away (per step)
});

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
  boid.wingPhase = Math.random() * 2 * Math.PI;
  boid.wingHz = FLIGHT.flapHz + (Math.random() * 2 - 1) * FLIGHT.flapHzSpread;
  boid.effort = 0; // 0 = gliding with wings spread, 1 = flapping hard
  boid.flapping = false;
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

// Wingbeats, and with momentum on, the forces they make.
function fly(boid, momentum) {
  const speed =
    Math.sqrt(boid.dx * boid.dx + boid.dy * boid.dy + boid.dz * boid.dz) || 1e-6;
  const climb = boid.dy / speed; // sine of the climb angle (y is up)

  // Flap-glide, with a gap between the two speeds so it doesn't chatter.
  if (boid.flapping) {
    if (speed > FLIGHT.glideAbove && climb < FLIGHT.climbToFlap) boid.flapping = false;
  } else if (speed < FLIGHT.flapBelow || climb > FLIGHT.climbToFlap) {
    boid.flapping = true;
  }
  boid.effort += ((boid.flapping ? 1 : 0) - boid.effort) * FLIGHT.effortEase;
  boid.wingPhase = (boid.wingPhase + (2 * Math.PI * boid.wingHz) / 60) % (2 * Math.PI);
  if (!momentum) return;

  // The wing is going down while cos(phase) < 0, and that's when it pushes.
  const thrust = FLIGHT.thrust * boid.effort * Math.max(0, -Math.cos(boid.wingPhase));
  const accel = thrust - FLIGHT.gravity * climb - FLIGHT.drag * speed * speed;
  const next = Math.min(FLIGHT.maxSpeed, Math.max(FLIGHT.minSpeed, speed + accel));
  const k = next / speed;
  boid.dx *= k;
  boid.dy *= k;
  boid.dz *= k;
}

// Advance one frame. The rule order matches the original, and updates are in
// place, so later boids see the new state of earlier ones in the same frame.
// With momentum on, fly() takes the place of the original speed cap.
export function step(boids, params, bounds) {
  for (const boid of boids) {
    flyTowardsCenter(boid, boids, params);
    avoidOthers(boid, boids, params);
    matchVelocity(boid, boids, params);
    if (params.momentum) {
      fly(boid, true);
    } else {
      limitSpeed(boid);
      fly(boid, false); // wingbeat only; doesn't touch velocity
    }
    keepWithinBounds(boid, bounds);

    boid.x += boid.dx;
    boid.y += boid.dy;
    boid.z += boid.dz;
    boid.history.push([boid.x, boid.y, boid.z]);
    boid.history = boid.history.slice(-HISTORY_LENGTH);
  }
}
