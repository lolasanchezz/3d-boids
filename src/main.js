import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoids, randomize, step, DEFAULT_PARAMS, HISTORY_LENGTH } from './boids.js';
import { FlockTracker, ANALYZE_EVERY } from './flocks.js';
import { FlockSynth, SCALES, noteCount, noteMidi, midiName, scaleTitle, loadSampleVoice } from './music.js';
import mihiUrl from '../mihiScale.m4a?url';
import { SwallowSprites } from './swallows.js';
import './style.css';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const BOUNDS = { width: 1000, height: 1000, depth: 1000 };
const MAX_BOIDS = 1000;
const START_BOIDS = 300;

// The original takes one step per animation frame and assumes 60 Hz. Use a
// fixed 60 Hz step so a 120 Hz display doesn't run the flock at double speed.
const STEP_MS = 1000 / 60;
const STEP_TOLERANCE_MS = 2; // absorbs rAF jitter, so 60 Hz screens get exactly 1 step/frame
const MAX_STEPS_PER_FRAME = 4;
const MAX_NOTES_PER_TICK = 6;

const BOID_SCALE = 1.6; // draw size only, doesn't affect the simulation
// Two looks: eater.net's blue boids on dark gray, or black birds on a white
// sky like the photos the swallow sprites came from. Singing flocks flash.
const THEMES = {
  dark: { background: '#282c34', bird: '#558cf4', flash: '#eef3ff', box: '#8b93a7', boxOpacity: 0.22 },
  light: { background: '#ffffff', bird: '#111111', flash: '#558cf4', box: '#4a5060', boxOpacity: 0.16 },
};
// These two are updated in place by applyTheme().
const BOID_COLOR = new THREE.Color(THEMES.dark.bird);
const FLASH_COLOR = new THREE.Color(THEMES.dark.flash);
const FLASH_PEAK = 0.8; // how close to FLASH_COLOR a singing flock gets
const FLASH_DECAY_S = 0.35;

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------
const params = { ...DEFAULT_PARAMS };
const boids = createBoids(START_BOIDS, BOUNDS);
let drawTrail = false;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(THEMES.dark.background);
scene.fog = new THREE.Fog(THEMES.dark.background, 1800, 4200); // far boids fade a little, as a depth cue

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 20000);
frameCamera();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;
controls.minDistance = 200;
controls.maxDistance = 6000;

scene.add(new THREE.HemisphereLight('#ffffff', '#2a2f3a', 2.2));
const sun = new THREE.DirectionalLight('#ffffff', 2.4);
sun.position.set(1, 2, 1.5);
scene.add(sun);

// The simulation runs in [0, width] x [0, height] x [0, depth]. Shift that
// space so the box is centered on the origin.
const world = new THREE.Group();
world.position.set(-BOUNDS.width / 2, -BOUNDS.height / 2, -BOUNDS.depth / 2);
scene.add(world);

const boxOutline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(BOUNDS.width, BOUNDS.height, BOUNDS.depth)),
  new THREE.LineBasicMaterial({ color: '#8b93a7', transparent: true, opacity: 0.22 }),
);
boxOutline.position.set(BOUNDS.width / 2, BOUNDS.height / 2, BOUNDS.depth / 2);
world.add(boxOutline);

// ---------------------------------------------------------------------------
// Boids: a 3D version of the original 15x10 triangle. The tip sits at the
// boid's position and the body trails behind it, as in drawBoid().
// ---------------------------------------------------------------------------
const boidGeometry = new THREE.ConeGeometry(5, 15, 6);
boidGeometry.translate(0, -7.5, 0);
boidGeometry.scale(BOID_SCALE, BOID_SCALE, BOID_SCALE);

const boidMesh = new THREE.InstancedMesh(
  boidGeometry,
  new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }),
  MAX_BOIDS,
);
boidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
boidMesh.frustumCulled = false; // instances move, so the precomputed bounds go stale
for (let i = 0; i < MAX_BOIDS; i += 1) boidMesh.setColorAt(i, BOID_COLOR);
world.add(boidMesh);

const flash = new Float32Array(MAX_BOIDS); // 1 when a boid's flock sings, then decays
const dummy = new THREE.Object3D();
const UP = new THREE.Vector3(0, 1, 0);
const heading = new THREE.Vector3();
const tmpColor = new THREE.Color();

function updateBoidMeshes() {
  for (let i = 0; i < boids.length; i += 1) {
    const b = boids[i];
    dummy.position.set(b.x, b.y, b.z);
    heading.set(b.dx, b.dy, b.dz);
    const speed = heading.length();
    if (speed > 1e-6) dummy.quaternion.setFromUnitVectors(UP, heading.divideScalar(speed));
    dummy.updateMatrix();
    boidMesh.setMatrixAt(i, dummy.matrix);
  }
  boidMesh.count = boids.length;
  boidMesh.instanceMatrix.needsUpdate = true;
}

function decayFlash(dt) {
  const keep = Math.exp(-dt / FLASH_DECAY_S);
  for (let i = 0; i < boids.length; i += 1) flash[i] *= keep;
}

function updateBoidColors() {
  for (let i = 0; i < boids.length; i += 1) {
    tmpColor.copy(BOID_COLOR).lerp(FLASH_COLOR, flash[i]);
    boidMesh.setColorAt(i, tmpColor);
  }
  boidMesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Swallows: the default look. Each boid is drawn as a bird cut from
// src/boids.jpg, turned to face the way it's flying (see swallows.js). The
// "Swallows" toggle switches back to the cones above.
// ---------------------------------------------------------------------------
const SPRITE_SIZE = 40; // world units across one sprite (the bird fills ~85% of it)
const swallows = new SwallowSprites(MAX_BOIDS, {
  color: BOID_COLOR,
  flashColor: FLASH_COLOR,
  size: SPRITE_SIZE,
});
swallows.setViewport(renderer, camera);
world.add(swallows.points);

let useSwallows = true;
function showSwallows(on) {
  useSwallows = on;
  swallows.points.visible = on;
  boidMesh.visible = !on;
  if (!on) updateBoidMeshes();
}
showSwallows(true);

// ---------------------------------------------------------------------------
// Trails ("Trace paths"): one line-segment buffer, sized for the most boids
// with full history.
// ---------------------------------------------------------------------------
const trailPositions = new Float32Array(MAX_BOIDS * (HISTORY_LENGTH - 1) * 2 * 3);
const trailAttr = new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage);
const trailGeometry = new THREE.BufferGeometry();
trailGeometry.setAttribute('position', trailAttr);
const trails = new THREE.LineSegments(
  trailGeometry,
  new THREE.LineBasicMaterial({
    color: BOID_COLOR,
    transparent: true,
    opacity: 0x66 / 255, // the original's #558cf466
    depthWrite: false,
  }),
);
trails.frustumCulled = false;
trails.visible = false;
world.add(trails);

function updateTrails() {
  let v = 0;
  for (const b of boids) {
    const h = b.history;
    for (let i = 1; i < h.length; i += 1) {
      const a = h[i - 1];
      const c = h[i];
      trailPositions[v++] = a[0];
      trailPositions[v++] = a[1];
      trailPositions[v++] = a[2];
      trailPositions[v++] = c[0];
      trailPositions[v++] = c[1];
      trailPositions[v++] = c[2];
    }
  }
  trailGeometry.setDrawRange(0, v / 3);
  trailAttr.clearUpdateRanges();
  trailAttr.addUpdateRange(0, v);
  trailAttr.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Flock music
// ---------------------------------------------------------------------------
const tracker = new FlockTracker();
const synth = new FlockSynth();
const projected = new THREE.Vector3();
let scale = SCALES.pentatonic;
let shift = 0; // semitones every note is moved up (+) or down (-)

const chipsEl = document.getElementById('note-chips');
const scaleDescEl = document.getElementById('scale-desc');
const flockCountEl = document.getElementById('flock-count');
const soundHintEl = document.getElementById('sound-hint');
let chips = [];

// One chip per note in the current scale, low to high.
function buildChips() {
  chips = [];
  chipsEl.replaceChildren();
  for (let n = 0; n < noteCount(scale); n += 1) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = midiName(noteMidi(n, scale) + shift);
    chipsEl.appendChild(chip);
    chips.push(chip);
  }
  scaleDescEl.textContent = scaleTitle(scale, shift);
}
buildChips();

// Shift slider. Moving by semitones changes the key but keeps the scale's
// shape, so everything stays in tune together.
const shiftInput = document.getElementById('shift');
const shiftOut = document.getElementById('shift-val');
function setShift(value) {
  shift = value;
  shiftInput.value = value;
  const steps = Math.abs(value);
  shiftOut.textContent =
    value === 0 ? 'original pitch' : `${value > 0 ? '+' : '−'}${steps} semitone${steps === 1 ? '' : 's'}`;
  buildChips();
}
shiftInput.addEventListener('input', () => setShift(Number(shiftInput.value)));
shiftInput.addEventListener('dblclick', () => setShift(0));
setShift(0);

for (const radio of document.querySelectorAll('input[name="scale"]')) {
  radio.checked = radio.value === scale.id;
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    scale = SCALES[radio.value];
    buildChips(); // the tracker sees the new scale on its next tick and re-sings every flock
  });
}

function onFlockTick() {
  const events = tracker
    .update(boids, params.visualRange, scale)
    .sort((a, b) => b.flock.size - a.flock.size)
    .slice(0, MAX_NOTES_PER_TICK);

  for (const { note, flock } of events) {
    for (const i of flock.members) flash[i] = FLASH_PEAK;

    // Pan each note toward where its flock is on screen.
    projected
      .set(flock.center.x, flock.center.y, flock.center.z)
      .add(world.position)
      .project(camera);
    synth.play(noteMidi(note, scale) + shift, { pan: projected.x * 0.8, size: flock.size });

    chips[note].animate([{ offset: 0, backgroundColor: '#558cf4', color: '#ffffff' }], {
      duration: 900,
      easing: 'ease-out',
    });
  }

  // Show which notes the current flocks hold, and how many flocks there are.
  const held = new Set();
  for (const state of tracker.prevStates) {
    if (state.playedStep !== null) held.add(noteCount(scale) - 1 - state.playedStep);
  }
  chips.forEach((chip, n) => chip.classList.toggle('held', held.has(n)));
  const { flocks } = tracker;
  const biggest = flocks.reduce((m, f) => Math.max(m, f.size), 0);
  flockCountEl.textContent =
    flocks.length === 0
      ? 'no flocks'
      : `${flocks.length} flock${flocks.length === 1 ? '' : 's'} · biggest ${biggest}`;
}

// Voice: the built-in synth, or mihiScale.m4a repitched to each note.
const mihiRadio = document.querySelector('input[name="voice"][value="mihi"]');
loadSampleVoice(mihiUrl)
  .then((sample) => synth.setSample(sample))
  .catch((err) => {
    console.warn('Could not load mihiScale.m4a:', err);
    mihiRadio.disabled = true;
    mihiRadio.closest('.seg').title = "mihiScale.m4a couldn't be loaded";
  });
for (const radio of document.querySelectorAll('input[name="voice"]')) {
  radio.addEventListener('change', () => {
    if (radio.checked) synth.voice = radio.value === 'mihi' ? 'sample' : 'synth';
  });
}

function updateSoundHint() {
  soundHintEl.hidden = synth.running || !synth.enabled;
}

// Browsers block audio until the user interacts with the page.
function unlockAudio() {
  synth.unlock().then(updateSoundHint);
}
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, unlockAudio, { capture: true });
}

// ---------------------------------------------------------------------------
// Controls bar
// ---------------------------------------------------------------------------
function bindSlider(id, key, digits) {
  const input = document.getElementById(id);
  const out = document.getElementById(`${id}-val`);
  input.value = params[key];
  const show = () => {
    out.textContent = Number(input.value).toFixed(digits);
  };
  show();
  input.addEventListener('input', () => {
    params[key] = Number(input.value);
    show();
  });
}
bindSlider('coherence', 'centeringFactor', 3);
bindSlider('separation', 'avoidFactor', 2);
bindSlider('alignment', 'matchingFactor', 2);
bindSlider('visual-range', 'visualRange', 0);

document.getElementById('reset').addEventListener('click', (e) => {
  e.currentTarget.blur();
  for (const b of boids) randomize(b, BOUNDS);
  flash.fill(0);
  tracker.reset();
});

document.getElementById('trace').addEventListener('change', (e) => {
  drawTrail = e.target.checked;
  trails.visible = drawTrail;
  for (const b of boids) b.history = []; // the original clears history on toggle too
});

const countInput = document.getElementById('count');
const countOut = document.getElementById('count-val');
countInput.value = boids.length;
countOut.textContent = boids.length;
countInput.addEventListener('input', () => {
  const n = Number(countInput.value);
  if (n > boids.length) {
    boids.push(...createBoids(n - boids.length, BOUNDS));
  } else {
    boids.length = n;
  }
  flash.fill(0, n);
  countOut.textContent = n;
  updateBoidMeshes();
});

document.getElementById('sound').addEventListener('change', (e) => {
  synth.setEnabled(e.target.checked);
  updateSoundHint();
});

document.getElementById('swallows').addEventListener('change', (e) => {
  showSwallows(e.target.checked);
});

const momentumInput = document.getElementById('momentum');
momentumInput.checked = params.momentum;
momentumInput.addEventListener('change', () => {
  params.momentum = momentumInput.checked;
});

function applyTheme(name) {
  const theme = THEMES[name];
  document.documentElement.dataset.theme = name;
  scene.background.set(theme.background);
  scene.fog.color.set(theme.background);
  BOID_COLOR.set(theme.bird);
  FLASH_COLOR.set(theme.flash);
  boxOutline.material.color.set(theme.box);
  boxOutline.material.opacity = theme.boxOpacity;
  trails.material.color.copy(BOID_COLOR);
  swallows.setColors(BOID_COLOR, FLASH_COLOR);
  if (!useSwallows) updateBoidColors();
}
document.getElementById('light').addEventListener('change', (e) => {
  applyTheme(e.target.checked ? 'light' : 'dark');
});

// Hide menu: the button in the top-right corner, or the H key.
const menuToggle = document.getElementById('menu-toggle');
function setMenuHidden(hidden) {
  document.body.classList.toggle('menu-hidden', hidden);
  menuToggle.textContent = hidden ? 'Show menu' : 'Hide menu';
  menuToggle.title = `${hidden ? 'Show' : 'Hide'} menu (H)`;
  menuToggle.setAttribute('aria-pressed', String(hidden));
}
const menuIsHidden = () => document.body.classList.contains('menu-hidden');
menuToggle.addEventListener('click', () => setMenuHidden(!menuIsHidden()));
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    setMenuHidden(!menuIsHidden());
  }
});

document.getElementById('rotate').addEventListener('change', (e) => {
  controls.autoRotate = e.target.checked;
});

// ---------------------------------------------------------------------------
// Camera framing and resize
// ---------------------------------------------------------------------------
function frameCamera() {
  const radius = 0.5 * Math.hypot(BOUNDS.width, BOUNDS.height, BOUNDS.depth);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 0.9;
  camera.position.set(0.62, 0.38, 0.69).normalize().multiplyScalar(distance);
  camera.lookAt(0, 0, 0);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  swallows.setViewport(renderer, camera);
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
let acc = 0;
let stepCount = 0;

function frame(now) {
  const elapsed = Math.min(now - last, 250);
  last = now;
  acc += elapsed;

  let steps = 0;
  while (acc >= STEP_MS - STEP_TOLERANCE_MS && steps < MAX_STEPS_PER_FRAME) {
    step(boids, params, BOUNDS);
    acc -= STEP_MS;
    steps += 1;
    stepCount += 1;
    if (stepCount % ANALYZE_EVERY === 0) onFlockTick();
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = Math.min(acc, STEP_MS); // drop backlog

  if (steps > 0) {
    if (!useSwallows) updateBoidMeshes();
    if (drawTrail) updateTrails();
  }
  decayFlash(elapsed / 1000);
  controls.update(elapsed / 1000);
  if (useSwallows) {
    // Sprites face the way each boid moves on screen, so they update every
    // frame (the camera may be orbiting even when the flock hasn't stepped).
    camera.updateMatrixWorld();
    swallows.update(boids, camera, world.position, flash, elapsed / 1000);
  } else {
    updateBoidColors();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

updateBoidMeshes();
updateSoundHint();
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  window.boidsDebug = { boids, params, tracker, synth, camera, controls, swallows };
}
