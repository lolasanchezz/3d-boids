// Swallow sprites: draws each boid as one of the birds cut from src/boids.jpg
// (see scripts/extract-sprites.mjs), flapping as it flies.
//
// Every boid is one point in a single THREE.Points draw call. Each frame, per boid:
//   - work out which way it's moving on screen;
//   - if it's flying mostly toward or away from the camera, use a head-on
//     ("front") sprite, kept upright; otherwise use a "plan" sprite (seen from
//     below) turned so the bird's head points the way it's moving;
//   - draw its wingbeat. The simulation (boids.js) tracks each boid's wing
//     phase and effort, the same beat that pushes it forward when momentum is
//     on. Seen from below, a wing raised or lowered by angle e looks cos(e) as
//     long, so the shader squeezes the sprite across the bird's body (along
//     the wings) by that factor.

import * as THREE from 'three';
import atlasUrl from './sprites/swallows.png';
import atlas from './sprites/swallows.json';

const FRONT_ENTER = 0.9; // |cos| between velocity and line of sight to switch to a head-on sprite
const FRONT_EXIT = 0.8; // ...and to switch back (hysteresis, so it doesn't flicker)

const WING_UP = THREE.MathUtils.degToRad(75); // top of the upstroke
const WING_DOWN = THREE.MathUtils.degToRad(55); // bottom of the downstroke
const MIN_SPAN = 0.2; // never squeeze a sprite thinner than this

// A boid keeps its pose (which photo it's drawn from) for a while, and only
// swaps while its wings are spread, so the change is hard to spot.
const POSE_MIN_S = 4;
const POSE_MAX_S = 12;

const vertexShader = /* glsl */ `
  attribute float aSprite;
  attribute float aAngle;
  attribute float aHeading;
  attribute float aSpan;
  attribute float aFlash;
  uniform float uSize;
  uniform float uScale;
  varying float vSprite;
  varying float vAngle;
  varying float vHeading;
  varying float vSpan;
  varying float vFlash;
  #include <fog_pars_vertex>

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * uScale / -mvPosition.z; // perspective size
    vSprite = aSprite;
    vAngle = aAngle;
    vHeading = aHeading;
    vSpan = aSpan;
    vFlash = aFlash;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uGrid; // atlas columns, rows
  uniform vec3 uColor;
  uniform vec3 uFlashColor;
  varying float vSprite;
  varying float vAngle;   // screen bearing the boid is moving in (clockwise from up)
  varying float vHeading; // bearing the bird faces in its sprite
  varying float vSpan;    // visible wingspan, 0..1
  varying float vFlash;
  #include <fog_pars_fragment>

  void main() {
    // gl_PointCoord is y-down, and so are all the rotations here.
    vec2 p = gl_PointCoord - 0.5;

    // Screen -> "bird frame", where the boid flies straight up the screen.
    float cs = cos(vAngle);
    float ss = sin(vAngle);
    vec2 b = vec2(cs * p.x + ss * p.y, -ss * p.x + cs * p.y);

    // Wingbeat: the wings lie along x in this frame, so squeeze x.
    b.x /= vSpan;

    // Bird frame -> the sprite's own frame, where the bird faces vHeading.
    float ch = cos(vHeading);
    float sh = sin(vHeading);
    vec2 q = vec2(ch * b.x - sh * b.y, sh * b.x + ch * b.y) + 0.5;
    if (any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)))) discard;

    vec2 cell = vec2(mod(vSprite, uGrid.x), floor(vSprite / uGrid.x));
    float alpha = texture2D(uMap, (cell + q) / uGrid).a;
    if (alpha < 0.03) discard;

    // The birds are silhouettes, so draw them in the boid color using only
    // the sprite's alpha.
    gl_FragColor = vec4(mix(uColor, uFlashColor, vFlash), alpha);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class SwallowSprites {
  constructor(maxBoids, { color, flashColor, size }) {
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
    this.flashes = new Float32Array(maxBoids);

    const geometry = new THREE.BufferGeometry();
    const dynamic = (array, itemSize) =>
      new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', dynamic(this.positions, 3));
    geometry.setAttribute('aSprite', dynamic(this.sprites, 1));
    geometry.setAttribute('aAngle', dynamic(this.angles, 1));
    geometry.setAttribute('aHeading', dynamic(this.headings, 1));
    geometry.setAttribute('aSpan', dynamic(this.spans, 1));
    geometry.setAttribute('aFlash', dynamic(this.flashes, 1));
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
          uColor: { value: new THREE.Color(color) },
          uFlashColor: { value: new THREE.Color(flashColor) },
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

  setColors(bird, flash) {
    this.material.uniforms.uColor.value.copy(bird);
    this.material.uniforms.uFlashColor.value.copy(flash);
  }

  #newPose(i) {
    this.planPose[i] = this.plan[Math.floor(Math.random() * this.plan.length)].index;
    this.frontPose[i] = this.front[Math.floor(Math.random() * this.front.length)].index;
    this.poseTimer[i] = POSE_MIN_S + Math.random() * (POSE_MAX_S - POSE_MIN_S);
  }

  // Pixels per world unit at distance 1, so sprites shrink with distance like
  // the 3D cones do. Call on resize.
  setViewport(renderer, camera) {
    const height = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.material.uniforms.uScale.value =
      height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  // boids are in simulation coordinates; `offset` is the world group's position.
  update(boids, camera, offset, flash, dt) {
    const e = camera.matrixWorldInverse.elements;
    const n = boids.length;

    for (let i = 0; i < n; i += 1) {
      const b = boids[i];
      this.positions[i * 3] = b.x;
      this.positions[i * 3 + 1] = b.y;
      this.positions[i * 3 + 2] = b.z;
      this.flashes[i] = flash[i];

      // Wing elevation swings between +WING_UP and -WING_DOWN, scaled by how
      // hard the boid is flapping (0 while it glides with wings spread).
      const swing = Math.sin(b.wingPhase);
      const elevation = b.effort * (swing > 0 ? WING_UP * swing : WING_DOWN * swing);
      const span = Math.max(MIN_SPAN, Math.cos(elevation));
      this.spans[i] = span;

      this.poseTimer[i] -= dt;
      if (this.poseTimer[i] <= 0 && span > 0.97) this.#newPose(i);

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

      // How directly it's flying along the line of sight.
      const dist = Math.hypot(px, py, pz) || 1;
      const speed = Math.hypot(vx, vy, vz) || 1;
      const along = Math.abs(px * vx + py * vy + pz * vz) / (dist * speed);
      if (this.headOn[i]) {
        if (along < FRONT_EXIT) this.headOn[i] = 0;
      } else if (along > FRONT_ENTER) {
        this.headOn[i] = 1;
      }

      if (this.headOn[i]) {
        this.sprites[i] = this.frontPose[i];
        this.angles[i] = 0; // upright
        this.headings[i] = 0;
      } else {
        // Direction of motion on screen: derivative of (x/w, y/w), with w = -z.
        const w = -pz;
        const du = vx * w + px * vz;
        const dv = vy * w + py * vz;
        const sprite = this.planPose[i];
        this.sprites[i] = sprite;
        this.angles[i] = Math.atan2(du, dv); // clockwise from screen-up
        this.headings[i] = this.spriteHeading[sprite];
      }
    }

    for (const name of ['position', 'aSprite', 'aAngle', 'aHeading', 'aSpan', 'aFlash']) {
      const attr = this.geometry.getAttribute(name);
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, n);
  }
}
