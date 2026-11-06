// Cuts src/boids.jpg (a 12x12 grid of swallow photos) into bird sprites.
//
//   node scripts/extract-sprites.mjs                 writes src/sprites/swallows.{png,json}
//   node scripts/extract-sprites.mjs --review <dir>  also writes labeled contact sheets to <dir>
//
// For each tile:
//   1. Estimate the sky behind the bird with a grayscale closing (a max filter
//      then a min filter), which erases anything dark and thinner than the
//      window: the bird.
//   2. Alpha = how much darker each pixel is than that sky, so edges stay soft.
//   3. Keep the biggest dark blob (the bird) and drop specks and cloud texture.
//   4. Un-mix the sky color from the semi-transparent edge pixels, so sprites
//      have no sky-colored halo.
//   5. Skip birds cut off by the tile edge or too small to use.
//   6. Scale each bird so its longest side is BIRD_PX and center it in a CELL_PX
//      square of the atlas.
//
// Facing direction and view come from scripts/sprite-labels.json, which was
// filled in by hand from the review sheets.

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src/boids.jpg');
const LABELS = join(ROOT, 'scripts/sprite-labels.json');
const OUT_DIR = join(ROOT, 'src/sprites');

const GRID = 12;
const TILE = 100; // grid pitch in px; the 1px dividing lines sit at the end of each tile
const INSET = 1; // skip the divider line
const INNER = TILE - 3; // usable tile interior

const CLOSE_RADIUS = 16; // larger than the thickest part of any bird
const BLUR_RADIUS = 6; // smooths the estimated sky
const MIN_DARKNESS = 0.04; // differences below this are cloud texture or JPEG noise
const SOLID_AT = 0.6; // fully opaque once 60% of the way from sky to the darkest pixel
const MIN_BIRD_PX = 18; // skip birds whose longest side is smaller than this
const CELL_PX = 64; // atlas cell size
const BIRD_PX = 54; // longest side of the bird inside its cell
const ATLAS_COLS = 12;

const args = process.argv.slice(2);
const reviewDir = args.includes('--review') ? args[args.indexOf('--review') + 1] : null;

// ---------------------------------------------------------------------------
// Image helpers (single-channel Float32Array images, size n x n)
// ---------------------------------------------------------------------------
function filter1d(src, n, radius, horizontal, pick) {
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      let v = pick === 'max' ? -Infinity : Infinity;
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = horizontal ? x + k : x;
        const yy = horizontal ? y : y + k;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const s = src[yy * n + xx];
        if (pick === 'max') v = Math.max(v, s);
        else if (pick === 'min') v = Math.min(v, s);
        else {
          sum += s;
          count += 1;
        }
      }
      out[y * n + x] = pick === 'mean' ? sum / count : v;
    }
  }
  return out;
}
const filter2d = (src, n, r, pick) =>
  filter1d(filter1d(src, n, r, true, pick), n, r, false, pick);

// Grayscale closing (max then min), then a box blur.
const estimateSky = (channel, n) =>
  filter2d(filter2d(filter2d(channel, n, CLOSE_RADIUS, 'max'), n, CLOSE_RADIUS, 'min'), n, BLUR_RADIUS, 'mean');

// 8-connected components of mask > 0. Returns labels and per-label weight.
function components(mask, weight, n) {
  const labels = new Int32Array(n * n).fill(-1);
  const sizes = [];
  const stack = [];
  for (let start = 0; start < n * n; start += 1) {
    if (!mask[start] || labels[start] >= 0) continue;
    const id = sizes.length;
    let total = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      total += weight[p];
      const px = p % n;
      const py = (p - px) / n;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const qx = px + dx;
          const qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= n || qy >= n) continue;
          const q = qy * n + qx;
          if (mask[q] && labels[q] < 0) {
            labels[q] = id;
            stack.push(q);
          }
        }
      }
    }
    sizes.push(total);
  }
  return { labels, sizes };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------
async function extractTile(source, width, row, col) {
  const n = INNER;
  const r = new Float32Array(n * n);
  const g = new Float32Array(n * n);
  const b = new Float32Array(n * n);
  const lum = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const sx = col * TILE + INSET + x;
      const sy = row * TILE + INSET + y;
      const i = (sy * width + sx) * 3;
      const p = y * n + x;
      r[p] = source[i] / 255;
      g[p] = source[i + 1] / 255;
      b[p] = source[i + 2] / 255;
      lum[p] = 0.2126 * r[p] + 0.7152 * g[p] + 0.0722 * b[p];
    }
  }

  const skyLum = estimateSky(lum, n);
  const skyR = estimateSky(r, n);
  const skyG = estimateSky(g, n);
  const skyB = estimateSky(b, n);

  // Darkness relative to the sky, and the darkest point (the bird's core).
  const dark = new Float32Array(n * n);
  let darkest = 0;
  for (let p = 0; p < n * n; p += 1) {
    dark[p] = Math.max(0, skyLum[p] - lum[p]);
    darkest = Math.max(darkest, dark[p]);
  }
  const alpha = new Float32Array(n * n);
  const span = Math.max(0.08, SOLID_AT * darkest - MIN_DARKNESS);
  for (let p = 0; p < n * n; p += 1) {
    alpha[p] = Math.min(1, Math.max(0, (dark[p] - MIN_DARKNESS) / span));
  }

  // Keep the heaviest blob, plus anything within 2px of it (thin wingtips).
  const { labels, sizes } = components(alpha.map((a) => (a > 0.3 ? 1 : 0)), alpha, n);
  if (!sizes.length) return { row, col, status: 'empty' };
  const bird = sizes.indexOf(Math.max(...sizes));
  let keep = labels.map((l) => (l === bird ? 1 : 0));
  keep = filter2d(Float32Array.from(keep), n, 2, 'max');
  for (let p = 0; p < n * n; p += 1) alpha[p] *= keep[p];

  // Bounding box of the bird.
  let x0 = n;
  let y0 = n;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (alpha[y * n + x] > 0.1) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) return { row, col, status: 'empty' };
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  // Many birds in the source touch their tile's edge. Count the solid pixels
  // on the border, so the review sheet shows how much of each bird is clipped.
  let edgeSolid = 0;
  for (let i = 0; i < n; i += 1) {
    for (const p of [i, (n - 1) * n + i, i * n, i * n + n - 1]) if (alpha[p] > 0.5) edgeSolid += 1;
  }
  const status = Math.max(w, h) < MIN_BIRD_PX ? 'tiny' : 'ok';

  // RGBA crop with the sky un-mixed from the edges: C = a*F + (1-a)*S.
  const pad = 2;
  const cx0 = Math.max(0, x0 - pad);
  const cy0 = Math.max(0, y0 - pad);
  const cw = Math.min(n, x1 + pad + 1) - cx0;
  const ch = Math.min(n, y1 + pad + 1) - cy0;
  const rgba = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const p = (cy0 + y) * n + (cx0 + x);
      const a = alpha[p] < 0.03 ? 0 : alpha[p];
      const o = (y * cw + x) * 4;
      const unmix = (c, s) => (a > 0 ? Math.min(1, Math.max(0, (c - (1 - a) * s) / a)) : 0);
      rgba[o] = Math.round(255 * unmix(r[p], skyR[p]));
      rgba[o + 1] = Math.round(255 * unmix(g[p], skyG[p]));
      rgba[o + 2] = Math.round(255 * unmix(b[p], skyB[p]));
      rgba[o + 3] = Math.round(255 * a);
    }
  }

  // Normalize into a CELL_PX square.
  const scale = Math.min(BIRD_PX / Math.max(w, h), CELL_PX / Math.max(cw, ch));
  const rw = Math.max(1, Math.round(cw * scale));
  const rh = Math.max(1, Math.round(ch * scale));
  const resized = await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } })
    .resize(rw, rh, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  const left = Math.floor((CELL_PX - rw) / 2);
  const top = Math.floor((CELL_PX - rh) / 2);
  const cell = await sharp({
    create: { width: CELL_PX, height: CELL_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: resized, raw: { width: rw, height: rh, channels: 4 }, left, top }])
    .raw()
    .toBuffer();

  return { row, col, status, edgeSolid, size: Math.max(w, h), cell };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
async function writeAtlas(sprites, file) {
  const rows = Math.ceil(sprites.length / ATLAS_COLS);
  await sharp({
    create: {
      width: ATLAS_COLS * CELL_PX,
      height: rows * CELL_PX,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      sprites.map((s, i) => ({
        input: s.cell,
        raw: { width: CELL_PX, height: CELL_PX, channels: 4 },
        left: (i % ATLAS_COLS) * CELL_PX,
        top: Math.floor(i / ATLAS_COLS) * CELL_PX,
      })),
    )
    .png({ compressionLevel: 9 })
    .toFile(file);
  return rows;
}

// Contact sheets for labeling: each tile at 2x on light gray with its
// "row,col", status (or current label) and how many solid pixels touch the
// tile edge, plus a red tick marking "up" (bearing 0).
async function writeReviewSheets(tiles, labels, dir) {
  mkdirSync(dir, { recursive: true });
  const SHOW = 128;
  const PER_ROW = 6;
  const PER_SHEET = 36;
  for (let sheet = 0; sheet * PER_SHEET < tiles.length; sheet += 1) {
    const group = tiles.slice(sheet * PER_SHEET, (sheet + 1) * PER_SHEET);
    const W = PER_ROW * SHOW;
    const H = Math.ceil(group.length / PER_ROW) * (SHOW + 18);
    const overlays = [];
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
    for (const [i, t] of group.entries()) {
      const x = (i % PER_ROW) * SHOW;
      const y = Math.floor(i / PER_ROW) * (SHOW + 18);
      const key = `${t.row},${t.col}`;
      const label = labels[key];
      const tag = label ? (label.skip ? 'skip' : `${label.view} ${label.heading ?? ''}`) : t.status;
      const color = t.status === 'ok' && !t.edgeSolid ? '#000' : '#b00';
      const edge = t.edgeSolid ? ` edge${t.edgeSolid}` : '';
      svg += `<rect x="${x}" y="${y}" width="${SHOW - 2}" height="${SHOW - 2}" fill="#d9dde3"/>`;
      svg += `<line x1="${x + SHOW / 2}" y1="${y + 2}" x2="${x + SHOW / 2}" y2="${y + 8}" stroke="#e33" stroke-width="2"/>`;
      svg += `<text x="${x + 3}" y="${y + SHOW + 12}" font-family="Helvetica" font-size="12" fill="${color}">${key} ${tag}${edge} (${t.size ?? 0}px)</text>`;
      if (t.cell) {
        const big = await sharp(t.cell, { raw: { width: CELL_PX, height: CELL_PX, channels: 4 } })
          .resize(SHOW - 2, SHOW - 2, { kernel: 'nearest' })
          .png()
          .toBuffer();
        overlays.push({ input: big, left: x, top: y });
      }
    }
    svg += '</svg>';
    await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
      .composite([{ input: Buffer.from(svg), left: 0, top: 0 }, ...overlays])
      .png()
      .toFile(join(dir, `review-${sheet + 1}.png`));
  }
}

const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const labels = existsSync(LABELS) ? JSON.parse(readFileSync(LABELS, 'utf8')) : {};

const tiles = [];
for (let row = 0; row < GRID; row += 1) {
  for (let col = 0; col < GRID; col += 1) {
    tiles.push(await extractTile(data, info.width, row, col));
  }
}

const counts = {};
for (const t of tiles) counts[t.status] = (counts[t.status] || 0) + 1;
console.log('tiles:', counts);

if (reviewDir) {
  await writeReviewSheets(tiles, labels, reviewDir);
  console.log('review sheets written to', reviewDir);
}

// Only usable, labeled, non-skipped birds go into the atlas.
const sprites = tiles.filter((t) => t.status === 'ok' && labels[`${t.row},${t.col}`] && !labels[`${t.row},${t.col}`].skip);
if (!sprites.length) {
  console.log('no labeled sprites yet; fill in scripts/sprite-labels.json');
  process.exit(0);
}
mkdirSync(OUT_DIR, { recursive: true });
const rows = await writeAtlas(sprites, join(OUT_DIR, 'swallows.png'));
const meta = {
  source: 'src/boids.jpg',
  cell: CELL_PX,
  cols: ATLAS_COLS,
  rows,
  // heading: compass bearing the bird faces in the image, degrees clockwise from up.
  // view: "plan" = seen from below or above, so it can be rotated to any heading;
  //       "front" = coming at (or going away from) the camera.
  sprites: sprites.map((s, i) => {
    const { view, heading } = labels[`${s.row},${s.col}`];
    return { index: i, tile: [s.row, s.col], view, ...(view === 'plan' ? { heading } : {}) };
  }),
};
writeFileSync(join(OUT_DIR, 'swallows.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`atlas: ${sprites.length} sprites, ${ATLAS_COLS}x${rows} cells of ${CELL_PX}px →`, OUT_DIR);
