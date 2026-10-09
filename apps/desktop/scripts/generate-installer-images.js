/**
 * Generate modern installer BMP images for NSIS MUI2.
 *
 * Produces two 24-bit BMP files that electron-builder feeds to the NSIS
 * compiler at build time:
 *
 *   resources/installerSidebar.bmp   — 164 × 314 px  (welcome / finish pages)
 *   resources/installerHeader.bmp    — 150 × 57  px  (step header area)
 *
 * Design: gradient background (brand dark-blue → lighter blue) with the
 * product name rendered as a simple pixel-font watermark.
 *
 * Run:  node scripts/generate-installer-images.js
 */

const fs = require('fs');
const path = require('path');

// ── Brand colours ───────────────────────────────────────────────────
const BRAND_START = { r: 22, g: 28, b: 45 }; // dark navy
const BRAND_END = { r: 56, g: 97, b: 170 }; // medium blue
const ACCENT = { r: 110, g: 140, b: 210 }; // light accent for decorations
const WHITE = { r: 255, g: 255, b: 255 };

// ── Helpers ─────────────────────────────────────────────────────────

/** Linear interpolation between two colour channels */
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/** Interpolate two RGB objects */
function lerpColor(c1, c2, t) {
  return {
    r: lerp(c1.r, c2.r, t),
    g: lerp(c1.g, c2.g, t),
    b: lerp(c1.b, c2.b, t),
  };
}

/**
 * Write a 24-bit BMP file (no compression, bottom-up row order).
 * `pixelFn(x, y)` returns `{ r, g, b }` for each pixel where
 * (0, 0) is the top-left corner.
 */
function writeBMP(filePath, width, height, pixelFn) {
  const rowBytes = width * 3;
  const rowPadding = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + rowPadding;
  const pixelDataSize = stride * height;
  const fileSize = 54 + pixelDataSize;

  const buf = Buffer.alloc(fileSize);

  // ── BMP file header (14 bytes) ──
  buf.write('BM', 0); // signature
  buf.writeUInt32LE(fileSize, 2); // file size
  buf.writeUInt32LE(0, 6); // reserved
  buf.writeUInt32LE(54, 10); // pixel data offset

  // ── DIB header – BITMAPINFOHEADER (40 bytes) ──
  buf.writeUInt32LE(40, 14); // header size
  buf.writeInt32LE(width, 18); // width
  buf.writeInt32LE(height, 22); // height (positive = bottom-up)
  buf.writeUInt16LE(1, 26); // colour planes
  buf.writeUInt16LE(24, 28); // bits per pixel
  buf.writeUInt32LE(0, 30); // compression (BI_RGB)
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(2835, 38); // X pixels/metre (~72 DPI)
  buf.writeInt32LE(2835, 42); // Y pixels/metre
  buf.writeUInt32LE(0, 46); // colours in table
  buf.writeUInt32LE(0, 50); // important colours

  // ── Pixel data (bottom-up) ──
  for (let y = height - 1; y >= 0; y--) {
    const rowOffset = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const { r, g, b } = pixelFn(x, y);
      const off = rowOffset + x * 3;
      buf[off] = b; // BMP stores BGR
      buf[off + 1] = g;
      buf[off + 2] = r;
    }
    // padding bytes are already 0
  }

  fs.writeFileSync(filePath, buf);
  console.log(`  ✓ ${path.basename(filePath)}  (${width}×${height})`);
}

// ── Simple 5×7 pixel font for product name ──────────────────────────
const GLYPH = {
  S: [
    '0111',
    '1000',
    '0110',
    '0001',
    '1110',
  ],
  u: [
    '0000',
    '1001',
    '1001',
    '1001',
    '0110',
  ],
  d: [
    '0001',
    '1011',
    '1101',
    '1001',
    '0111',
  ],
  o: [
    '0000',
    '0110',
    '1001',
    '1001',
    '0110',
  ],
  w: [
    '0000',
    '10001',
    '10101',
    '10101',
    '01010',
  ],
  r: [
    '0000',
    '1011',
    '1100',
    '1000',
    '1000',
  ],
  k: [
    '1000',
    '1010',
    '1100',
    '1010',
    '1001',
  ],
};

/**
 * Draw the text "Sudowork" into the pixel grid.
 * Returns a Set of "x,y" strings that should be lit up.
 */
function renderText(startX, startY, scale) {
  const text = 'Sudowork';
  const pixels = new Set();
  let cursorX = startX;

  for (const ch of text) {
    const g = GLYPH[ch];
    if (!g) {
      cursorX += 4 * scale;
      continue;
    }
    for (let gy = 0; gy < g.length; gy++) {
      for (let gx = 0; gx < g[gy].length; gx++) {
        if (g[gy][gx] === '1') {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              pixels.add(`${cursorX + gx * scale + sx},${startY + gy * scale + sy}`);
            }
          }
        }
      }
    }
    cursorX += (g[0].length + 1) * scale;
  }
  return pixels;
}

// ── Generate sidebar image (164 × 314) ─────────────────────────────
function generateSidebar(outPath) {
  const W = 164;
  const H = 314;

  // Pre-render product name at the bottom
  const textPixels = renderText(16, H - 40, 2);

  writeBMP(outPath, W, H, (x, y) => {
    // Vertical gradient
    const t = y / (H - 1);
    const bg = lerpColor(BRAND_START, BRAND_END, t);

    // Decorative diagonal lines (subtle)
    const diag = ((x + y) % 40) < 1;
    if (diag && t > 0.1 && t < 0.6) {
      return lerpColor(bg, ACCENT, 0.15);
    }

    // Decorative circle near top
    const cx = W / 2;
    const cy = 80;
    const radius = 35;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (Math.abs(dist - radius) < 2) {
      return lerpColor(bg, WHITE, 0.25);
    }
    // Inner small circle
    if (Math.abs(dist - 15) < 1.5) {
      return lerpColor(bg, WHITE, 0.35);
    }

    // Diamond shape inside the circle (simplified logo)
    const dx = Math.abs(x - cx);
    const dy = Math.abs(y - cy);
    if (dx + dy <= 10 && dx + dy >= 7) {
      return lerpColor(bg, WHITE, 0.5);
    }

    // Horizontal accent line
    if (y >= 140 && y <= 142 && x >= 20 && x <= W - 20) {
      return lerpColor(bg, ACCENT, 0.4);
    }

    // Product name text
    if (textPixels.has(`${x},${y}`)) {
      return lerpColor(bg, WHITE, 0.7);
    }

    return bg;
  });
}

// ── Generate header image (150 × 57) ───────────────────────────────
function generateHeader(outPath) {
  const W = 150;
  const H = 57;

  writeBMP(outPath, W, H, (x, y) => {
    // Horizontal gradient (left to right)
    const t = x / (W - 1);
    const bg = lerpColor(BRAND_START, BRAND_END, t);

    // Small diamond icon on the right side
    const cx = W - 30;
    const cy = H / 2;
    const dx = Math.abs(x - cx);
    const dy = Math.abs(y - cy);
    if (dx + dy <= 12 && dx + dy >= 9) {
      return lerpColor(bg, WHITE, 0.5);
    }
    if (dx + dy <= 5) {
      return lerpColor(bg, WHITE, 0.3);
    }

    // Subtle horizontal lines pattern
    if (y % 8 === 0 && x < W - 50) {
      return lerpColor(bg, ACCENT, 0.08);
    }

    return bg;
  });
}

// ── Main ────────────────────────────────────────────────────────────
const resDir = path.join(__dirname, '..', 'resources');

console.log('Generating NSIS installer images…');
generateSidebar(path.join(resDir, 'installerSidebar.bmp'));
generateHeader(path.join(resDir, 'installerHeader.bmp'));
console.log('Done.');
