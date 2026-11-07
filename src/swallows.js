// Swallow sprites: draws each boid as one of the birds cut from src/boids.jpg
// (see scripts/extract-sprites.mjs), flapping as it flies.
//
// Every boid is one point in a single THREE.Points draw call. Each frame, per boid:
//   - work out which way it's moving on screen;
//   - if it's flying mostly toward or away from the camera, use a head-on
//     ("front") sprite, kept upright; otherwise use a "plan" sprite (seen from
//     below) turned so the bird's head points the way it's moving;
//   - draw its wings. The simulation (boids.js) runs the wing rig: a fast
//     downstroke and a slower, folding upstroke, glide span and sweep, and a
//     bank angle. Here that becomes how wide the bird looks across its body:
//     its span from below, times how face-on its banked wings are to the
//     camera. The shader squeezes the sprite across the body by that amount,
//     and sweeps the wingtips back for fast glides.
//     Head-on birds turn with their bank instead, so a flock rolling into a
//     turn shimmers the way murmurations do.

import * as THREE from 'three';
import atlasUrl from './sprites/swallows.png';
import atlas from './sprites/swallows.json';

const FRONT_ENTER = 0.9; // |cos| between velocity and line of sight to switch to a head-on sprite
const FRONT_EXIT = 0.8; // ...and to switch back (hysteresis, so it doesn't flicker)

const MIN_FACE_ON = 0.25; // banked or edge-on wings never look thinner than this...
const MIN_SPAN = 0.15; // ...and no sprite gets squeezed thinner than this overall

// A boid keeps its pose (which photo it's drawn from) for a while, and only
// swaps while its wings are spread, so the change is hard to spot.
const POSE_MIN_S = 4;
const POSE_MAX_S = 12;

const vertexShader = /* glsl */ `
  attribute float aSprite;
  attribute float aAngle;
  attribute float aHeading;
  attribute float aSpan;
  attribute float aSweep;
  attribute vec3 aColor;
  uniform float uSize;
  uniform float uScale;
  varying float vSprite;
  varying float vAngle;
  varying float vHeading;
  varying float vSpan;
  varying float vSweep;
  varying vec3 vColor;
  #include <fog_pars_vertex>

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * uScale / -mvPosition.z; // perspective size
    vSprite = aSprite;
    vAngle = aAngle;
    vHeading = aHeading;
    vSpan = aSpan;
    vSweep = aSweep;
    vColor = aColor;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uGrid; // atlas columns, rows
  uniform float uHardEdges; // 1 in pixel mode: solid pixels, no soft edges
  varying float vSprite;
  varying float vAngle;   // screen bearing the boid is moving in (clockwise from up)
  varying float vHeading; // bearing the bird faces in its sprite
  varying float vSpan;    // visible wingspan, 0..1
  varying float vSweep;   // how far the wingtips sweep back toward the tail
  varying vec3 vColor;    // linear RGB, chosen per boid in main.js
  #include <fog_pars_fragment>

  void main() {
    // gl_PointCoord is y-down, and so are all the rotations here.
    vec2 p = gl_PointCoord - 0.5;

    // Screen -> "bird frame", where the boid flies straight up the screen.
    float cs = cos(vAngle);
    float ss = sin(vAngle);
    vec2 b = vec2(cs * p.x + ss * p.y, -ss * p.x + cs * p.y);

    // Wings: they lie along x in this frame, so squeeze x for the span, and
    // push the tips toward the tail (+y here) for sweep.
    b.x /= vSpan;
    b.y -= vSweep * abs(b.x);

    // Bird frame -> the sprite's own frame, where the bird faces vHeading.
    float ch = cos(vHeading);
    float sh = sin(vHeading);
    vec2 q = vec2(ch * b.x - sh * b.y, sh * b.x + ch * b.y) + 0.5;
    if (any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)))) discard;

    vec2 cell = vec2(mod(vSprite, uGrid.x), floor(vSprite / uGrid.x));
    float alpha = texture2D(uMap, (cell + q) / uGrid).a;
    if (uHardEdges > 0.5) alpha = step(0.5, alpha);
    if (alpha < 0.03) discard;

    // The birds are silhouettes, so draw them in the boid's color using only
    // the sprite's alpha.
    gl_FragColor = vec4(vColor, alpha);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class SwallowSprites {
  constructor(maxBoids, { size }) {
    this.max = maxBoids;
    this.plan = atlas.sprites.filter((s) => s.view === 'plan');
    this.front = atlas.sprites.filter((s) => s.view === 'front');
    // Sprite headings in radians, indexed by atlas index (front sprites face up).
    this.spriteHeading = new Float32Array(atlas.sprites.length);
    for (const s of this.plan) this.spriteHeading[s.index] = THREE.MathUtils.degToRad(s.heading);

    // Per-boid state.
    this.planPose = new Uint16Array(maxBoids);
    this.frontPose = new Uint16Array(maxBoids);
    this.poseTimer = new Float32Array(maxBoids);
    this.headOn = new Uint8Array(maxBoids);
    for (let i = 0; i < maxBoids; i += 1) {
      this.#newPose(i);
      this.poseTimer[i] *= Math.random(); // stagger the first swaps
    }

    // Per-point attributes.
    this.positions = new Float32Array(maxBoids * 3);
    this.sprites = new Float32Array(maxBoids);
    this.angles = new Float32Array(maxBoids);
    this.headings = new Float32Array(maxBoids);
    this.spans = new Float32Array(maxBoids).fill(1);
    this.sweeps = new Float32Array(maxBoids);
    this.colors = new Float32Array(maxBoids * 3);

    const geometry = new THREE.BufferGeometry();
    const dynamic = (array, itemSize) =>
      new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', dynamic(this.positions, 3));
    geometry.setAttribute('aSprite', dynamic(this.sprites, 1));
    geometry.setAttribute('aAngle', dynamic(this.angles, 1));
    geometry.setAttribute('aHeading', dynamic(this.headings, 1));
    geometry.setAttribute('aSpan', dynamic(this.spans, 1));
    geometry.setAttribute('aSweep', dynamic(this.sweeps, 1));
    geometry.setAttribute('aColor', dynamic(this.colors, 3));
    this.geometry = geometry;

    const texture = new THREE.TextureLoader().load(atlasUrl);
    texture.flipY = false; // so row 0 of the atlas image is at v = 0, matching gl_PointCoord
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uMap: { value: null },
          uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
          uHardEdges: { value: 0 },
          uSize: { value: size },
          uScale: { value: 1 },
        },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.material.uniforms.uMap.value = texture; // set after merge, which would clone it

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false; // points move every frame
  }

  // World units across one sprite.
  setSize(size) {
    this.material.uniforms.uSize.value = size;
  }

  setHardEdges(on) {
    this.material.uniforms.uHardEdges.value = on ? 1 : 0;
  }

  #newPose(i) {
    this.planPose[i] = this.plan[Math.floor(Math.random() * this.plan.length)].index;
    this.frontPose[i] = this.front[Math.floor(Math.random() * this.front.length)].index;
    this.poseTimer[i] = POSE_MIN_S + Math.random() * (POSE_MAX_S - POSE_MIN_S);
  }

  // Pixels per world unit at distance 1, so sprites shrink with distance like
  // the 3D cones do. `height` is the height in pixels of whatever is being
  // rendered into (the canvas, or the small pixel-mode target). Call on resize.
  setViewport(height, camera) {
    this.material.uniforms.uScale.value =
      height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  // boids are in simulation coordinates; `offset` is the world group's position;
  // `colors` holds each boid's linear RGB.
  update(boids, camera, offset, colors, dt) {
    const e = camera.matrixWorldInverse.elements;
    const n = boids.length;

    for (let i = 0; i < n; i += 1) {
      const b = boids[i];
      this.positions[i * 3] = b.x;
      this.positions[i * 3 + 1] = b.y;
      this.positions[i * 3 + 2] = b.z;
      this.colors[i * 3] = colors[i * 3];
      this.colors[i * 3 + 1] = colors[i * 3 + 1];
      this.colors[i * 3 + 2] = colors[i * 3 + 2];

      // Swap poses only while the wings are spread (or still, gliding).
      this.poseTimer[i] -= dt;
      if (this.poseTimer[i] <= 0 && (b.wingSpan > 0.9 || b.effort < 0.05)) this.#newPose(i);

      // The bird's body axes in the scene: forward, right (forward × up) and
      // up, then rolled by its bank angle.
      const sp = Math.hypot(b.dx, b.dy, b.dz) || 1;
      const fx = b.dx / sp;
      const fy = b.dy / sp;
      const fz = b.dz / sp;
      let rx = -fz;
      let rz = fx;
      const rl = Math.hypot(rx, rz);
      if (rl < 1e-3) {
        rx = 1; // flying straight up or down: any horizontal right will do
        rz = 0;
      } else {
        rx /= rl;
        rz /= rl;
      }
      const ux = -rz * fy; // up = right × forward
      const uy = rz * fx - rx * fz;
      const uz = rx * fy;
      const cb = Math.cos(b.bank);
      const sb = Math.sin(b.bank);
      const wingX = rx * cb - ux * sb; // right wing, banked (positive bank = right wing down)
      const wingY = -uy * sb;
      const wingZ = rz * cb - uz * sb;
      const upX = ux * cb + rx * sb;
      const upY = uy * cb;
      const upZ = uz * cb + rz * sb;

      // Position and velocity in view space (camera looks down -z).
      const wx = b.x + offset.x;
      const wy = b.y + offset.y;
      const wz = b.z + offset.z;
      const px = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const py = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const pz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
      const vx = e[0] * b.dx + e[4] * b.dy + e[8] * b.dz;
      const vy = e[1] * b.dx + e[5] * b.dy + e[9] * b.dz;
      const vz = e[2] * b.dx + e[6] * b.dy + e[10] * b.dz;
      const rvx = e[0] * wingX + e[4] * wingY + e[8] * wingZ;
      const rvy = e[1] * wingX + e[5] * wingY + e[9] * wingZ;
      const rvz = e[2] * wingX + e[6] * wingY + e[10] * wingZ;

      // How directly it's flying along the line of sight.
      const dist = Math.hypot(px, py, pz) || 1;
      const speed = Math.hypot(vx, vy, vz) || 1;
      const along = Math.abs(px * vx + py * vy + pz * vz) / (dist * speed);
      if (this.headOn[i]) {
        if (along < FRONT_EXIT) this.headOn[i] = 0;
      } else if (along > FRONT_ENTER) {
        this.headOn[i] = 1;
      }

      // On-screen direction of a vector (dx, dy, dz) at this point: the
      // derivative of (x/w, y/w), with w = -z. Divided by w, a vector lying
      // flat in the screen plane keeps its length.
      const w = -pz;
      const wingSx = (rvx * w + px * rvz) / w;
      const wingSy = (rvy * w + py * rvz) / w;

      if (this.headOn[i]) {
        // Coming at (or going away from) the camera: keep the head-on sprite
        // upright relative to the bird's own up, so banking shows as a roll.
        const uvx = e[0] * upX + e[4] * upY + e[8] * upZ;
        const uvy = e[1] * upX + e[5] * upY + e[9] * upZ;
        const uvz = e[2] * upX + e[6] * upY + e[10] * upZ;
        this.sprites[i] = this.frontPose[i];
        this.angles[i] = Math.atan2(uvx * w + px * uvz, uvy * w + py * uvz);
        this.headings[i] = 0;
        const faceOn = Math.min(1, Math.max(MIN_FACE_ON, Math.hypot(wingSx, wingSy)));
        this.spans[i] = Math.max(MIN_SPAN, b.wingSpan * faceOn);
        this.sweeps[i] = 0;
      } else {
        // Direction of motion on screen.
        const du = vx * w + px * vz;
        const dv = vy * w + py * vz;
        const sprite = this.planPose[i];
        this.sprites[i] = sprite;
        this.angles[i] = Math.atan2(du, dv); // clockwise from screen-up
        this.headings[i] = this.spriteHeading[sprite];
        // How much of the (banked) wingspan lies across the bird on screen:
        // 1 seen from straight below, about cos(bank) when it rolls, and
        // nearly edge-on when it crosses the view at eye level.
        const hl = Math.hypot(du, dv) || 1;
        const across = Math.abs(wingSx * (dv / hl) - wingSy * (du / hl));
        const faceOn = Math.min(1, Math.max(MIN_FACE_ON, across));
        this.spans[i] = Math.max(MIN_SPAN, b.wingSpan * faceOn);
        this.sweeps[i] = b.sweep;
      }
    }

    for (const name of ['position', 'aSprite', 'aAngle', 'aHeading', 'aSpan', 'aSweep', 'aColor']) {
      const attr = this.geometry.getAttribute(name);
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, n);
  }
}
