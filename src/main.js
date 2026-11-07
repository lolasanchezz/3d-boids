import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoids, randomize, step, DEFAULT_PARAMS, HISTORY_LENGTH } from './boids.js';
import { FlockTracker, ANALYZE_EVERY } from './flocks.js';
import { FlockSynth, SCALES, noteCount, noteMidi, midiName, scaleTitle, loadSampleVoice } from './music.js';
import mihiUrl from '../mihiScale.m4a?url';
import { SwallowSprites } from './swallows.js';
import { BoxResizer } from './boxResizer.js';
import './style.css';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const BOUNDS = { width: 1000, height: 1000, depth: 1000 }; // resizable by dragging the box's sides
const MAX_BOIDS = 1000;
const START_BOIDS = 300;

// The original takes one step per animation frame and assumes 60 Hz. Use a
// fixed 60 Hz step so a 120 Hz display doesn't run the flock at double speed.
const STEP_MS = 1000 / 60;
const STEP_TOLERANCE_MS = 2; // absorbs rAF jitter, so 60 Hz screens get exactly 1 step/frame
const MAX_STEPS_PER_FRAME = 4;
const MAX_NOTES_PER_TICK = 6;

const BOID_SCALE = 1.6; // draw size only, doesn't affect the simulation
const PIXEL_SIZE = 3; // in pixel mode, CSS pixels per art pixel
const PIXEL_BIRD_SCALE = 1.5; // and birds are drawn this much bigger
// Two looks: eater.net's blue boids on dark gray, or black birds on a white
// sky like the photos the swallow sprites came from. Singing flocks flash.
const THEMES = {
  // quiet: birds that aren't singing (not in a flock) while note colors are on
  // accent: the box's resize handles
  dark: { background: '#282c34', bird: '#558cf4', flash: '#eef3ff', quiet: '#9aa3b5', box: '#8b93a7', boxOpacity: 0.22, accent: '#558cf4' },
  light: { background: '#ffffff', bird: '#111111', flash: '#558cf4', quiet: '#5c6370', box: '#4a5060', boxOpacity: 0.16, accent: '#2f6fe0' },
};
// These two are updated in place by applyTheme().
const BOID_COLOR = new THREE.Color(THEMES.dark.bird);
const FLASH_COLOR = new THREE.Color(THEMES.dark.flash);
const QUIET_COLOR = new THREE.Color(THEMES.dark.quiet);
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

// A unit cube's edges, scaled to the box's current size.
const boxOutline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: '#8b93a7', transparent: true, opacity: 0.22 }),
);
world.add(boxOutline);

const hintEl = document.getElementById('hint');
const HINT = hintEl.textContent;

// After the box changes size: redraw it, and stretch the fog and zoom range
// with it so a big box doesn't vanish into the fog.
function onBoxChange(dragging) {
  const { width: W, height: H, depth: D } = BOUNDS;
  boxOutline.scale.set(W, H, D);
  boxOutline.position.set(W / 2, H / 2, D / 2);
  const k = Math.max(1, (0.5 * Math.hypot(W, H, D)) / 866); // 866 = the default box's half-diagonal
  scene.fog.near = 1800 * k;
  scene.fog.far = 4200 * k;
  controls.maxDistance = 6000 * k;
  hintEl.textContent = dragging ? `box ${Math.round(W)} × ${Math.round(H)} × ${Math.round(D)}` : HINT;
  hintEl.classList.toggle('live', dragging);
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const boxResizer = new BoxResizer({
  bounds: BOUNDS,
  world,
  camera,
  domElement: renderer.domElement,
  controls,
  // A near side moved, so the simulation's origin moved: shift every bird
  // (and its trail) the other way so nothing jumps on screen.
  onShift(key, amount) {
    const index = AXIS_INDEX[key];
    for (const b of boids) {
      b[key] += amount;
      for (const point of b.history) point[index] += amount;
    }
  },
  onChange: onBoxChange,
});
boxResizer.setColor(THEMES.dark.accent);
onBoxChange(false);

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
    dummy.scale.setScalar(pixelMode ? PIXEL_BIRD_SCALE : 1);
    heading.set(b.dx, b.dy, b.dz);
    const speed = heading.length();
    if (speed > 1e-6) dummy.quaternion.setFromUnitVectors(UP, heading.divideScalar(speed));
    dummy.updateMatrix();
    boidMesh.setMatrixAt(i, dummy.matrix);
  }
  boidMesh.count = boids.length;
  boidMesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Bird colors. Every boid eases toward a target color: with "Note colors" on,
// that's the color of the note its flock sings; otherwise (or when it isn't
// in a flock) the theme's bird color. Flashes mix in on top. The final colors
// in birdRGB (linear RGB) feed the swallows, the cones and the trails.
// ---------------------------------------------------------------------------
const COLOR_EASE_S = 0.35;
const NOTE_FLASH = 0.6; // with note colors on, flash less so the color still shows
let pixelMode = false; // see "Pixels" below
const targetRGB = new Float32Array(MAX_BOIDS * 3);
const easedRGB = new Float32Array(MAX_BOIDS * 3);
const birdRGB = new Float32Array(MAX_BOIDS * 3);
const flashTarget = new THREE.Color();
let themeName = 'dark';
let noteColors = true;

// Note colors are a gradient between two colors you pick: the lowest note of
// the scale gets the "low" color, the highest the "high" color, and every
// note in between its own step along the way. Each theme keeps its own pair.
const GRADIENTS = {
  dark: { low: '#4c6ef5', high: '#f783ac' }, // blue to pink
  light: { low: '#1b2a5e', high: '#d6336c' }, // navy to crimson
};

// The gradient is blended in OKLab (Björn Ottosson's perceptual color space),
// so its middle stays vivid instead of going gray or muddy.
function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const gradientLab = { low: [0, 0, 0], high: [0, 0, 0] };
function setGradient(low, high) {
  for (const [key, hex] of [['low', low], ['high', high]]) {
    const c = new THREE.Color(hex); // stored as linear RGB
    gradientLab[key] = linearToOklab(c.r, c.g, c.b);
  }
}
setGradient(GRADIENTS.dark.low, GRADIENTS.dark.high);

function noteColor(midi, out) {
  const lowest = noteMidi(0, scale) + shift;
  const highest = noteMidi(noteCount(scale) - 1, scale) + shift;
  const t = THREE.MathUtils.clamp((midi - lowest) / (highest - lowest), 0, 1);
  const [L, a, b] = gradientLab.low.map((v, i) => v + (gradientLab.high[i] - v) * t);
  const [r, g, bl] = oklabToLinear(L, a, b).map((v) => THREE.MathUtils.clamp(v, 0, 1));
  return out.setRGB(r, g, bl);
}

function setTarget(i, color) {
  targetRGB[i * 3] = color.r;
  targetRGB[i * 3 + 1] = color.g;
  targetRGB[i * 3 + 2] = color.b;
}

// Snap boids from `from` onward straight to their target (new or reset boids).
function snapColors(from = 0) {
  easedRGB.set(targetRGB.subarray(from * 3, MAX_BOIDS * 3), from * 3);
}

function updateColors(dt) {
  const ease = 1 - Math.exp(-dt / COLOR_EASE_S);
  const keep = Math.exp(-dt / FLASH_DECAY_S);
  // A singing flock flashes toward the theme's flash color, or with note
  // colors on, toward white (dark theme) or black (light theme).
  if (noteColors) flashTarget.set(themeName === 'light' ? '#000000' : '#ffffff');
  else flashTarget.copy(FLASH_COLOR);
  const flashRGB = [flashTarget.r, flashTarget.g, flashTarget.b];
  const strength = noteColors ? NOTE_FLASH : 1;
  for (let i = 0; i < boids.length; i += 1) {
    flash[i] *= keep;
    for (let c = 0; c < 3; c += 1) {
      const k = i * 3 + c;
      easedRGB[k] += (targetRGB[k] - easedRGB[k]) * ease;
      birdRGB[k] = easedRGB[k] + (flashRGB[c] - easedRGB[k]) * flash[i] * strength;
    }
  }
}

function applyConeColors() {
  for (let i = 0; i < boids.length; i += 1) {
    tmpColor.setRGB(birdRGB[i * 3], birdRGB[i * 3 + 1], birdRGB[i * 3 + 2]);
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
const swallows = new SwallowSprites(MAX_BOIDS, { size: SPRITE_SIZE });
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
const trailColors = new Float32Array(trailPositions.length);
const trailColorAttr = new THREE.BufferAttribute(trailColors, 3).setUsage(THREE.DynamicDrawUsage);
const trailGeometry = new THREE.BufferGeometry();
trailGeometry.setAttribute('position', trailAttr);
trailGeometry.setAttribute('color', trailColorAttr);
const trails = new THREE.LineSegments(
  trailGeometry,
  new THREE.LineBasicMaterial({
    vertexColors: true, // each trail takes its bird's color
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
  for (let j = 0; j < boids.length; j += 1) {
    const h = boids[j].history;
    const r = birdRGB[j * 3];
    const g = birdRGB[j * 3 + 1];
    const bl = birdRGB[j * 3 + 2];
    for (let i = 1; i < h.length; i += 1) {
      for (const p of [h[i - 1], h[i]]) {
        trailPositions[v] = p[0];
        trailPositions[v + 1] = p[1];
        trailPositions[v + 2] = p[2];
        trailColors[v] = r;
        trailColors[v + 1] = g;
        trailColors[v + 2] = bl;
        v += 3;
      }
    }
  }
  trailGeometry.setDrawRange(0, v / 3);
  for (const attr of [trailAttr, trailColorAttr]) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, v);
    attr.needsUpdate = true;
  }
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
    chip.style.setProperty('--note', noteColor(noteMidi(n, scale) + shift, tmpColor).getStyle());
    chipsEl.appendChild(chip);
    chips.push(chip);
  }
  scaleDescEl.textContent = scaleTitle(scale, shift);
  refreshColorTargets();
}

// Each boid's target color, from the flocks found on the last tick.
function refreshColorTargets() {
  const base = noteColors ? QUIET_COLOR : BOID_COLOR;
  for (let i = 0; i < boids.length; i += 1) setTarget(i, base);
  if (!noteColors) return;
  tracker.flocks.forEach((flock, k) => {
    const state = tracker.prevStates[k];
    if (state.playedStep === null) return; // hasn't sung yet
    const note = noteCount(scale) - 1 - state.playedStep;
    noteColor(noteMidi(note, scale) + shift, tmpColor);
    for (const i of flock.members) setTarget(i, tmpColor);
  });
}
buildChips();
snapColors();

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

    const chipFlash = noteColors ? chips[note].style.getPropertyValue('--note') : '#558cf4';
    chips[note].animate([{ offset: 0, backgroundColor: chipFlash, color: '#ffffff' }], {
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
  refreshColorTargets();
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
  refreshColorTargets();
  snapColors();
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
  const before = boids.length;
  if (n > before) {
    boids.push(...createBoids(n - before, BOUNDS));
  } else {
    boids.length = n;
  }
  flash.fill(0, Math.min(n, before));
  refreshColorTargets();
  snapColors(before); // new boids start at their color instead of fading in from black
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
  QUIET_COLOR.set(theme.quiet);
  boxOutline.material.color.set(theme.box);
  boxOutline.material.opacity = theme.boxOpacity;
  boxResizer.setColor(theme.accent);
  themeName = name;
  showGradient(); // each theme has its own gradient
  buildChips(); // note colors depend on the theme
  snapColors();
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
  boxResizer.setVisible(!hidden); // the resize handles are part of the menu
}
const menuIsHidden = () => document.body.classList.contains('menu-hidden');
menuToggle.addEventListener('click', () => setMenuHidden(!menuIsHidden()));
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    setMenuHidden(!menuIsHidden());
  }
});

// The two gradient colors.
const colorLowInput = document.getElementById('color-low');
const colorHighInput = document.getElementById('color-high');
const gradientEl = document.querySelector('.gradient');
function showGradient() {
  const { low, high } = GRADIENTS[themeName];
  colorLowInput.value = low;
  colorHighInput.value = high;
  gradientEl.style.setProperty('--grad-low', low);
  gradientEl.style.setProperty('--grad-high', high);
  setGradient(low, high);
}
for (const [input, key] of [[colorLowInput, 'low'], [colorHighInput, 'high']]) {
  input.addEventListener('input', () => {
    GRADIENTS[themeName][key] = input.value;
    showGradient();
    buildChips(); // recolors the chips and every flock's target color
  });
}
showGradient();

const noteColorsInput = document.getElementById('note-colors');
noteColorsInput.checked = noteColors;
noteColorsInput.addEventListener('change', () => {
  noteColors = noteColorsInput.checked;
  document.getElementById('notes').classList.toggle('notes-colored', noteColors);
  refreshColorTargets();
});
document.getElementById('notes').classList.toggle('notes-colored', noteColors);

// Pixels: draw the scene into a small render target, then stretch it over the
// canvas with nearest-neighbor filtering, so everything turns into chunky
// pixels. Sprites switch to hard edges so each pixel is solid.
const pixelTarget = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  generateMipmaps: false,
  type: THREE.HalfFloatType, // linear color needs more than 8 bits to avoid banding
});
const blitScene = new THREE.Scene();
const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
blitScene.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: pixelTarget.texture, depthTest: false, depthWrite: false }),
  ),
);

function sizeViewport() {
  pixelTarget.setSize(
    Math.max(1, Math.round(window.innerWidth / PIXEL_SIZE)),
    Math.max(1, Math.round(window.innerHeight / PIXEL_SIZE)),
  );
  const height = pixelMode ? pixelTarget.height : renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  swallows.setViewport(height, camera);
  boxResizer.setViewportHeight(window.innerHeight);
}

function setPixelMode(on) {
  pixelMode = on;
  swallows.setHardEdges(on);
  // Draw birds bigger so each one is enough pixels across to read as a bird.
  swallows.setSize(SPRITE_SIZE * (on ? PIXEL_BIRD_SCALE : 1));
  if (!useSwallows) updateBoidMeshes();
  sizeViewport();
}
document.getElementById('pixels').addEventListener('change', (e) => setPixelMode(e.target.checked));
setPixelMode(document.getElementById('pixels').checked);

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
  sizeViewport();
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
  updateColors(elapsed / 1000);
  controls.update(elapsed / 1000);
  if (useSwallows) {
    // Sprites face the way each boid moves on screen, so they update every
    // frame (the camera may be orbiting even when the flock hasn't stepped).
    camera.updateMatrixWorld();
    swallows.update(boids, camera, world.position, birdRGB, elapsed / 1000);
  } else {
    applyConeColors();
  }
  if (pixelMode) {
    renderer.setRenderTarget(pixelTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(blitScene, blitCamera);
  } else {
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

updateBoidMeshes();
updateSoundHint();
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  window.boidsDebug = { boids, params, tracker, synth, camera, controls, swallows, boxResizer, BOUNDS, world };
}
