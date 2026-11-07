// Drag the sides of the box to resize it.
//
// Each of the six sides has a handle (a dot at its center). Hover one and its
// side lights up; drag it and that side moves in or out while the opposite
// side stays put. Only the handles are grabbable: the box itself covers most
// of the screen, and dragging anywhere else still orbits the camera.
//
// The simulation always runs in [0, width] x [0, height] x [0, depth], placed
// in the scene by the `world` group's position. Moving a far (+) side just
// changes the size. Moving a near (-) side also moves the origin, so the
// birds' coordinates are shifted by the same amount (via onShift) to keep them
// where they are on screen.

import * as THREE from 'three';

const AXES = [
  { key: 'x', size: 'width', dir: new THREE.Vector3(1, 0, 0) },
  { key: 'y', size: 'height', dir: new THREE.Vector3(0, 1, 0) },
  { key: 'z', size: 'depth', dir: new THREE.Vector3(0, 0, 1) },
];

// Below 400 the 200-unit turning zones of opposite walls overlap, and their
// pushes cancel out, so birds would drift out of the box.
export const MIN_SIZE = 450;
export const MAX_SIZE = 3000;
const HANDLE_PX = 14; // on-screen handle size, in CSS pixels
const HOVER_GROW = 1.5;

// A soft round dot, drawn once and tinted per handle.
function dotTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class BoxResizer {
  constructor({ bounds, world, camera, domElement, controls, onShift, onChange }) {
    Object.assign(this, { bounds, world, camera, domElement, controls, onShift, onChange });
    this.visible = true;
    this.hover = null; // face under the pointer
    this.drag = null; // { face, plane, offset } while dragging
    this.viewportHeight = window.innerHeight;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    const texture = dotTexture();
    this.faces = [];
    for (const axis of AXES) {
      for (const side of [-1, 1]) {
        const handle = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: texture,
            sizeAttenuation: false, // same size on screen at any distance
            depthTest: false, // grabbable even behind birds or the far sides
            depthWrite: false,
            transparent: true,
            opacity: 0.55,
            fog: false,
          }),
        );
        handle.renderOrder = 10;
        world.add(handle);
        this.faces.push({ axis, side, handle });
      }
    }

    // Translucent fill on the side being hovered or dragged.
    this.highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.highlight.visible = false;
    world.add(this.highlight);

    // Capture phase, so a grab is claimed before OrbitControls sees it.
    domElement.addEventListener('pointerdown', (e) => this.#onDown(e), { capture: true });
    domElement.addEventListener('pointermove', (e) => this.#onMove(e));
    domElement.addEventListener('pointerup', (e) => this.#onUp(e));
    domElement.addEventListener('pointercancel', (e) => this.#onUp(e));
    domElement.addEventListener('pointerleave', () => !this.drag && this.#setHover(null));

    this.layout();
  }

  setColor(color) {
    for (const { handle } of this.faces) handle.material.color.set(color);
    this.highlight.material.color.set(color);
  }

  setVisible(visible) {
    this.visible = visible;
    for (const { handle } of this.faces) handle.visible = visible;
    if (!visible) this.#setHover(null);
  }

  // Keep handles a fixed size on screen. With sizeAttenuation off, a sprite's
  // scale is a fraction of the viewport height (scaled by the projection).
  setViewportHeight(height) {
    this.viewportHeight = height;
    this.#scaleHandles();
  }

  // Put the handles at the centers of the sides, for the current size.
  layout() {
    const center = new THREE.Vector3(this.bounds.width / 2, this.bounds.height / 2, this.bounds.depth / 2);
    for (const { axis, side, handle } of this.faces) {
      handle.position.copy(center);
      handle.position[axis.key] = side > 0 ? this.bounds[axis.size] : 0;
    }
    this.#placeHighlight();
  }

  #scaleHandles() {
    const base = (HANDLE_PX * 2) / (this.camera.projectionMatrix.elements[5] * this.viewportHeight);
    const active = this.drag?.face ?? this.hover;
    for (const face of this.faces) {
      face.handle.scale.setScalar(base * (face === active ? HOVER_GROW : 1));
      face.handle.material.opacity = face === active ? 1 : 0.55;
    }
  }

  #placeHighlight() {
    const face = this.drag?.face ?? this.hover;
    this.highlight.visible = !!face && this.visible;
    if (!face) return;
    const { width: W, height: H, depth: D } = this.bounds;
    const { key } = face.axis;
    this.highlight.position.set(W / 2, H / 2, D / 2);
    this.highlight.position[key] = face.side > 0 ? this.bounds[face.axis.size] : 0;
    // PlaneGeometry lies in its own x-y plane; turn it to face along the axis.
    this.highlight.rotation.set(0, 0, 0);
    if (key === 'x') {
      this.highlight.rotation.y = Math.PI / 2;
      this.highlight.scale.set(D, H, 1);
    } else if (key === 'y') {
      this.highlight.rotation.x = Math.PI / 2;
      this.highlight.scale.set(W, D, 1);
    } else {
      this.highlight.scale.set(W, H, 1);
    }
  }

  #setHover(face) {
    if (face === this.hover) return;
    this.hover = face;
    this.domElement.style.cursor = face ? 'grab' : '';
    this.#scaleHandles();
    this.#placeHighlight();
  }

  #aim(event) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  #pick(event) {
    if (!this.visible) return null;
    this.#aim(event);
    const hits = this.raycaster.intersectObjects(this.faces.map((f) => f.handle), false);
    return hits.length ? this.faces.find((f) => f.handle === hits[0].object) : null;
  }

  // The side's position along its axis, in scene coordinates.
  #sideCoord(face) {
    const { key, size } = face.axis;
    return this.world.position[key] + (face.side > 0 ? this.bounds[size] : 0);
  }

  #onDown(event) {
    if (event.button !== 0) return;
    const face = this.#pick(event);
    if (!face) return;

    // Drag along the side's axis on a plane that contains the axis and faces
    // the camera as squarely as possible.
    const anchor = face.handle.getWorldPosition(new THREE.Vector3());
    const toCamera = this.camera.position.clone().sub(anchor);
    const normal = toCamera.sub(face.axis.dir.clone().multiplyScalar(toCamera.dot(face.axis.dir)));
    if (normal.lengthSq() < 1e-6) normal.copy(this.camera.up); // looking straight down the axis
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), anchor);
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;

    event.stopImmediatePropagation(); // don't start orbiting
    this.controls.enabled = false;
    this.domElement.setPointerCapture(event.pointerId);
    this.domElement.style.cursor = 'grabbing';
    this.drag = { face, plane, offset: this.#sideCoord(face) - hit[face.axis.key] };
    this.#scaleHandles();
    this.#placeHighlight();
    this.onChange(true);
  }

  #onMove(event) {
    if (!this.drag) {
      this.#setHover(this.#pick(event));
      return;
    }
    this.#aim(event);
    const hit = this.raycaster.ray.intersectPlane(this.drag.plane, new THREE.Vector3());
    if (!hit) return;
    const { face, offset } = this.drag;
    const { key, size } = face.axis;
    const target = hit[key] + offset; // where the side should be

    if (face.side > 0) {
      this.bounds[size] = THREE.MathUtils.clamp(target - this.world.position[key], MIN_SIZE, MAX_SIZE);
    } else {
      const far = this.world.position[key] + this.bounds[size];
      const newSize = THREE.MathUtils.clamp(far - target, MIN_SIZE, MAX_SIZE);
      const newOrigin = far - newSize;
      this.onShift(key, this.world.position[key] - newOrigin); // keep birds in place
      this.world.position[key] = newOrigin;
      this.bounds[size] = newSize;
    }
    this.layout();
    this.onChange(true);
  }

  #onUp(event) {
    if (!this.drag) return;
    this.drag = null;
    this.controls.enabled = true;
    if (this.domElement.hasPointerCapture(event.pointerId)) {
      this.domElement.releasePointerCapture(event.pointerId);
    }
    this.domElement.style.cursor = '';
    this.#setHover(this.#pick(event));
    this.#scaleHandles();
    this.#placeHighlight();
    this.onChange(false);
  }
}
