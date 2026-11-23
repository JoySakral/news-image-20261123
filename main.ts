// news-image-20261123 — "The World in One Image"
// A Node 22 program that draws a 1024x1024 newspaper-style front page
// summing up the world news of Monday 23 November 2026, and writes it
// as /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png).
//
// Everything here is drawn from scratch at runtime: my own RGB canvas,
// my own 5x7 bitmap font, my own pictograms, and my own PNG encoder
// (zlib from the Node standard library for the DEFLATE stream).
// No network, no dependencies, fully deterministic output.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// PNG encoding: CRC32 + chunk writer + raw scanlines (filter 0 per row).
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // One filter byte (0 = none) at the start of every scanline.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    iend,
  ]);
}

// ---------------------------------------------------------------------------
// Canvas: a plain RGB pixel buffer with simple shape primitives.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;

  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.fillRect(0, 0, w, h, bg);
  }

  set(x: number, y: number, c: RGB): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    const o = (iy * this.w + ix) * 3;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const o = (yy * this.w + xx) * 3;
        this.px[o] = c[0];
        this.px[o + 1] = c[1];
        this.px[o + 2] = c[2];
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
    this.fillRect(x, y, w, t, c);
    this.fillRect(x, y + h - t, w, t, c);
    this.fillRect(x, y, t, h, c);
    this.fillRect(x + w - t, y, t, h, c);
  }

  // DDA line with a square brush of the given thickness. A fixed step
  // count guarantees termination for any (fractional) endpoints.
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const half = Math.floor(t / 2);
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(x0 + (dx * i) / steps);
      const py = Math.round(y0 + (dy * i) / steps);
      for (let oy = -half; oy <= half; oy++)
        for (let ox = -half; ox <= half; ox++) this.set(px + ox, py + oy, c);
    }
  }

  fillCircle(cx: number, cy: number, r: number, c: RGB): void {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, c);
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: RGB, t = 1): void {
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180;
      this.fillRect(
        Math.round(cx + Math.cos(rad) * r) - Math.floor(t / 2),
        Math.round(cy + Math.sin(rad) * r) - Math.floor(t / 2),
        t,
        t,
        c,
      );
    }
  }

  // Filled polygon via the even-odd scanline rule.
  fillPoly(points: [number, number][], c: RGB): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        this.fillRect(Math.ceil(xs[i]), y, Math.floor(xs[i + 1]) - Math.ceil(xs[i]) + 1, 1, c);
      }
    }
  }

  polyLine(points: [number, number][], c: RGB, t = 1): void {
    for (let i = 0; i + 1 < points.length; i++) {
      this.line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], c, t);
    }
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font, drawn from my own glyph table. Each glyph is 7 rows of
// 5 bits, written as strings of '0' and '1'. Only the characters the page
// actually uses are defined; anything else renders as a blank.
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "\u00a2": ["00000", "00100", "01110", "10001", "10001", "01110", "00100"],
  "\u2014": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "\u2019": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "\u2022": ["00000", "00000", "01100", "01100", "01100", "00000", "00000"],
  "\u2193": ["00100", "00100", "00100", "00100", "10101", "01110", "00100"],
};

const CHAR_W = 6; // 5 px glyph + 1 px gap, before scaling
const CHAR_H = 7;

function textWidth(text: string, scale: number): number {
  return text.length * CHAR_W * scale - scale;
}

function drawText(
  cv: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: RGB,
): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if (bits[col] === "1") {
          cv.fillRect(cx + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cx += CHAR_W * scale;
  }
}

// Word-wrap a paragraph to lines that fit maxWidth px at the given scale.
// Returns the lines; the caller draws them one by one.
function wrapText(text: string, scale: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? line + " " + word : word;
    if (textWidth(trial, scale) <= maxWidth || !line) {
      line = trial;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Draw a wrapped paragraph; returns the y just below the last line.
function drawPara(
  cv: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  maxWidth: number,
  color: RGB,
  lineGap = 6,
): number {
  const lines = wrapText(text, scale, maxWidth);
  let yy = y;
  for (const ln of lines) {
    drawText(cv, ln, x, yy, scale, color);
    yy += CHAR_H * scale + lineGap;
  }
  return yy;
}

// Centred single line of text.
function drawCentred(
  cv: Canvas,
  text: string,
  centreX: number,
  y: number,
  scale: number,
  color: RGB,
): void {
  drawText(cv, text, centreX - Math.floor(textWidth(text, scale) / 2), y, scale, color);
}

// ---------------------------------------------------------------------------
// Palette and pictograms. Every picture on the page is drawn from these
// shapes — no images, no copied art.
// ---------------------------------------------------------------------------

const PAPER: RGB = [247, 243, 232];
const INK: RGB = [18, 24, 38];
const NAVY: RGB = [18, 35, 63];
const NAVY2: RGB = [28, 52, 92];
const RED: RGB = [178, 34, 34];
const GOLD: RGB = [196, 148, 44];
const TEAL: RGB = [13, 110, 110];
const SEA: RGB = [36, 84, 130];
const SEA_DARK: RGB = [22, 58, 94];
const SKY: RGB = [168, 205, 226];
const WHITE: RGB = [255, 255, 255];
const GREY: RGB = [96, 100, 110];
const LIGHT_GREY: RGB = [226, 222, 210];
const GREEN: RGB = [34, 120, 60];
const ORANGE: RGB = [214, 106, 28];

function dashedLine(
  cv: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGB,
  dash = 8,
  gap = 6,
  t = 3,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.floor(len / (dash + gap)));
  for (let i = 0; i < steps; i++) {
    const t0 = (i * (dash + gap)) / len;
    const t1 = Math.min(1, (i * (dash + gap) + dash) / len);
    cv.line(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1, c, t);
  }
}

// --- Lead scene: a warship on a night sea, hit by a sea drone. ----------
function drawWarshipScene(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, SKY);
  // sun glow behind smoke
  cv.fillCircle(x + w * 0.78, y + h * 0.22, 26, [240, 214, 150]);
  // distant sea horizon
  cv.fillRect(x, y + h * 0.62, w, h * 0.38, SEA);
  cv.fillRect(x, y + h * 0.62, w, 4, SEA_DARK);
  // waves
  for (let i = 0; i < 5; i++) {
    const wy = y + h * (0.70 + i * 0.06);
    cv.line(x + 14 + i * 22, wy, x + 90 + i * 30, wy, [120, 170, 205], 3);
  }
  // the corvette: hull, bow, superstructure, mast
  const hx = x + w * 0.08;
  const hy = y + h * 0.52;
  cv.fillPoly(
    [
      [hx, hy],
      [hx + w * 0.62, hy],
      [hx + w * 0.70, hy + 22],
      [hx + w * 0.06, hy + 22],
    ],
    [64, 68, 76],
  );
  cv.fillRect(hx + w * 0.16, hy - 26, w * 0.30, 26, [84, 88, 96]);
  cv.fillRect(hx + w * 0.24, hy - 48, 10, 22, [64, 68, 76]);
  cv.fillRect(hx + w * 0.20, hy - 52, 34, 6, [64, 68, 76]);
  cv.fillRect(hx + w * 0.05, hy - 8, 8, 8, RED); // hull number light
  // fire + smoke where the drone struck, low on the stern deck
  cv.fillCircle(hx + w * 0.10, hy - 6, 15, [232, 120, 40]);
  cv.fillCircle(hx + w * 0.16, hy - 18, 11, [240, 180, 60]);
  cv.fillCircle(hx + w * 0.12, hy - 36, 9, [120, 120, 120]);
  cv.fillCircle(hx + w * 0.08, hy - 50, 7, [150, 150, 150]);
  // sea drone skimming in from the right, with a dashed approach path
  const dx = x + w * 0.86;
  const dy = y + h * 0.52;
  dashedLine(cv, dx + 60, dy - 46, dx + 8, dy - 6, INK, 9, 7, 3);
  cv.fillCircle(dx, dy, 7, INK);
  cv.fillRect(dx - 16, dy - 3, 32, 6, INK);
  cv.fillRect(dx - 3, dy - 16, 6, 32, INK);
  cv.fillCircle(dx - 18, dy - 16, 4, INK);
  cv.fillCircle(dx + 18, dy - 16, 4, INK);
  cv.fillCircle(dx - 18, dy + 16, 4, INK);
  cv.fillCircle(dx + 18, dy + 16, 4, INK);
  // splash where a second drone hit the water
  cv.fillCircle(x + w * 0.55, y + h * 0.72, 10, WHITE);
  cv.fillCircle(x + w * 0.58, y + h * 0.68, 7, WHITE);
}

// --- COP31: a globe with a rising thermometer and a broken deal. ---------
function drawGlobeScene(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2;
  const cy = y + h / 2 - 6;
  const r = Math.min(w, h) * 0.34;
  cv.fillCircle(cx, cy, r, SEA);
  // simple land blobs
  cv.fillCircle(cx - r * 0.35, cy - r * 0.30, r * 0.34, GREEN);
  cv.fillCircle(cx + r * 0.35, cy + r * 0.25, r * 0.30, GREEN);
  cv.fillCircle(cx + r * 0.45, cy - r * 0.35, r * 0.16, GREEN);
  cv.circle(cx, cy, r, NAVY, 4);
  // thermometer at the side, mercury high
  const tx = x + w - 26;
  cv.fillRect(tx, y + 14, 10, h - 44, WHITE);
  cv.rect(tx, y + 14, 10, h - 44, INK, 2);
  cv.fillRect(tx + 2, y + 20, 6, h - 66, RED);
  cv.fillCircle(tx + 5, y + h - 24, 9, RED);
  cv.circle(tx + 5, y + h - 24, 9, INK, 2);
}

// --- US Capitol dome. -----------------------------------------------------
function drawCapitolScene(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2;
  const base = y + h - 16;
  cv.fillRect(x + 12, base, w - 24, 8, NAVY);
  // columns
  for (let i = 0; i < 5; i++) {
    cv.fillRect(x + 26 + i * ((w - 52) / 4) - 4, base - 34, 8, 34, NAVY);
  }
  cv.fillRect(x + 18, base - 40, w - 36, 7, NAVY);
  // dome: stacked arcs approximated with circles
  cv.fillCircle(cx, base - 44, 34, NAVY);
  cv.fillRect(cx - 34, base - 44, 68, 6, NAVY);
  cv.fillRect(cx - 20, base - 84, 40, 8, NAVY);
  cv.fillRect(cx - 3, base - 100, 6, 18, NAVY);
  cv.fillCircle(cx, base - 102, 5, GOLD);
  // stars for the 258 seats
  for (let i = 0; i < 6; i++) {
    const sx = x + 16 + i * 14;
    cv.fillRect(sx, y + 12, 7, 7, GOLD);
  }
}

// --- Drone over a strait: a quadcopter above blue water. ------------------
function drawDroneScene(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2;
  const cy = y + h * 0.42;
  cv.fillRect(x, y + h * 0.55, w, h * 0.45, SEA);
  cv.line(x + 8, y + h * 0.62, x + w - 8, y + h * 0.62, [120, 170, 205], 2);
  cv.line(x + 20, y + h * 0.74, x + w - 30, y + h * 0.74, [120, 170, 205], 2);
  cv.line(x + 14, y + h * 0.86, x + w - 14, y + h * 0.86, [120, 170, 205], 2);
  // a tanker on the water
  cv.fillRect(x + w * 0.14, y + h * 0.60, w * 0.42, 14, [150, 60, 50]);
  cv.fillRect(x + w * 0.50, y + h * 0.52, 12, 10, [150, 60, 50]);
  // the quadcopter
  cv.fillCircle(cx, cy, 8, INK);
  cv.fillRect(cx - 22, cy - 3, 44, 6, INK);
  cv.fillRect(cx - 3, cy - 22, 6, 44, INK);
  cv.fillCircle(cx - 24, cy - 24, 5, INK);
  cv.fillCircle(cx + 24, cy - 24, 5, INK);
  cv.fillCircle(cx - 24, cy + 24, 5, INK);
  cv.fillCircle(cx + 24, cy + 24, 5, INK);
  // a red X marking it shot down
  cv.line(cx + 34, cy - 44, cx + 58, cy - 20, RED, 5);
  cv.line(cx + 58, cy - 44, cx + 34, cy - 20, RED, 5);
}

// --- Falling market chart, drawn relative to its box so it never spills
// into the neighbouring text column. --------------------------------------
function drawChartScene(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const ox = x + 14;
  const oy = y + h - 14;
  const rx = x + w - 12; // right edge of the plot
  const top = y + 18;
  cv.line(ox, top, ox, oy, INK, 3);
  cv.line(ox, oy, rx, oy, INK, 3);
  const span = rx - ox - 8;
  const drop = oy - top - 16;
  // A jagged line that falls from the top-left to the bottom-right.
  const frac: [number, number][] = [
    [0.0, 0.05],
    [0.14, 0.18],
    [0.28, 0.10],
    [0.42, 0.38],
    [0.56, 0.30],
    [0.70, 0.58],
    [0.84, 0.50],
    [1.0, 0.92],
  ];
  const pts: [number, number][] = frac.map(([fx, fy]) => [
    ox + 4 + fx * span,
    top + 8 + fy * drop,
  ]);
  cv.polyLine(pts, RED, 4);
  // down arrow at the end of the line
  const [ax, ay] = pts[pts.length - 1];
  cv.fillPoly(
    [
      [ax - 10, ay - 16],
      [ax + 6, ay - 16],
      [ax - 2, ay],
    ],
    RED,
  );
}

// --- The penny: a big copper coin. -----------------------------------------
function drawPennyScene(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) * 0.36;
  cv.fillCircle(cx, cy, r, [184, 115, 51]);
  cv.circle(cx, cy, r, [120, 70, 25], 3);
  cv.circle(cx, cy, r - 8, [120, 70, 25], 2);
  drawCentred(cv, "1\u00a2", cx, cy - 18, 4, [90, 50, 15]);
  drawCentred(cv, "1793-2026", cx, cy + 16, 2, [90, 50, 15]);
}

// ---------------------------------------------------------------------------
// The page: a newspaper front page for Monday 23 November 2026.
//
// Stories (all reported on 23 November 2026, from BBC, France 24, The
// Guardian, the New York Times and Inshorts):
//   LEAD  Ukrainian sea drone badly damages the Russian Navy corvette
//         Merkury off Benghazi, Libya; Russian cargo ship Sparta II also
//         set ablaze in the Baltic and drifting into Finnish waters.
//   COP31 UN climate talks in Antalya, Turkey, end with no deal on fossil
//         fuels or finance after the longest talks ever.
//   US    Democrats win 258 seats in the House, their largest majority in
//         more than 30 years, after a North Carolina recount.
//   GULF  Iran says it shot down a US MQ-9 Reaper drone over the Strait
//         of Hormuz; Bahrain reports strikes on its sites.
//   ASIA  Asian markets slide as the AI rally fades; Taiwan bans short
//         sales below the previous close.
//   PENNY Trump signs the Common Cents Act, ending the penny after 232
//         years; a Delta systems outage delays 1,600+ flights.
//   ALSO  Nepal PM Balen Shah meets Modi in Delhi; Indonesia seizes a
//         ship carrying rocket-fuel chemical.
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;
const MARGIN = 28;

interface Tile {
  kicker: string;
  headline: string;
  detail: string;
  accent: RGB;
  draw: (cv: Canvas, x: number, y: number, w: number, h: number) => void;
}

const TILES: Tile[] = [
  {
    kicker: "CLIMATE  •  ANTALYA",
    headline: "COP31 ENDS WITH NO CLIMATE DEAL",
    detail: "Two weeks of UN talks close without agreement on fossil fuels or finance.",
    accent: TEAL,
    draw: drawGlobeScene,
  },
  {
    kicker: "UNITED STATES",
    headline: "DEMOCRATS WIN 258 HOUSE SEATS",
    detail: "Largest House majority in over 30 years after a North Carolina recount.",
    accent: NAVY2,
    draw: drawCapitolScene,
  },
  {
    kicker: "THE GULF  •  HORMUZ",
    headline: "IRAN SAYS IT SHOT DOWN US DRONE",
    detail: "MQ-9 Reaper claimed downed; Bahrain reports strikes on its sites.",
    accent: RED,
    draw: drawDroneScene,
  },
  {
    kicker: "MARKETS  •  ASIA",
    headline: "ASIAN MARKETS SLIDE AS AI RALLY FADES",
    detail: "Chip stocks fall; Taiwan bans short sales below the previous close.",
    accent: ORANGE,
    draw: drawChartScene,
  },
  {
    kicker: "THE PENNY",
    headline: "AFTER 232 YEARS, THE PENNY ENDS",
    detail: "Trump signs the Common Cents Act; a Delta outage delays 1,600 flights.",
    accent: GOLD,
    draw: drawPennyScene,
  },
];

function drawTile(cv: Canvas, tile: Tile, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, WHITE);
  cv.rect(x, y, w, h, INK, 2);
  cv.fillRect(x, y, w, 6, tile.accent);
  const ix = x + 12;
  const iy = y + 18;
  const iw = Math.floor(w * 0.30);
  tile.draw(cv, ix, iy, iw, 108);
  const tx = ix + iw + 14;
  const tw = w - (tx - x) - 14;
  drawText(cv, tile.kicker, tx, y + 20, 2, tile.accent);
  const headEnd = drawPara(cv, tile.headline, tx, y + 40, 3, tw, INK, 4);
  drawPara(cv, tile.detail, tx, headEnd + 2, 2, tw, GREY, 3);
}

function drawPage(): Buffer {
  const cv = new Canvas(W, H, PAPER);

  // --- Masthead ------------------------------------------------------------
  cv.fillRect(0, 0, W, 148, NAVY);
  cv.fillRect(0, 148, W, 6, GOLD);
  drawCentred(cv, "THE WORLD IN ONE IMAGE", W / 2, 26, 7, WHITE);
  drawCentred(cv, "MONDAY  23  NOVEMBER  2026", W / 2, 92, 4, GOLD);

  // --- Lead story ----------------------------------------------------------
  const lx = MARGIN;
  const ly = 172;
  const lw = W - 2 * MARGIN;
  cv.fillRect(lx, ly, lw, 220, WHITE);
  cv.rect(lx, ly, lw, 220, INK, 3);
  drawText(cv, "LEAD  •  UKRAINE WAR AT SEA", lx + 16, ly + 14, 2, RED);
  const leadLines = wrapText("UKRAINE DRONE HITS RUSSIAN WARSHIP OFF LIBYA", 5, 580);
  let hy2 = ly + 36;
  for (const ln of leadLines) {
    drawText(cv, ln, lx + 16, hy2, 5, INK);
    hy2 += CHAR_H * 5 + 5;
  }
  drawPara(
    cv,
    "Merkury damaged off Benghazi; Sparta II ablaze in the Baltic.",
    lx + 16,
    hy2 + 6,
    3,
    580,
    GREY,
    4,
  );
  drawWarshipScene(cv, lx + 604, ly + 12, lw - 620, 196);

  // --- Story tiles ---------------------------------------------------------
  const tileH = 160;
  const gap = 12;
  const colW = Math.floor((W - 2 * MARGIN - gap) / 2);
  let ty = ly + 220 + gap;
  // Row 1: two tiles (COP31, US House). Row 2: two tiles (Gulf, Markets).
  // Row 3: one wide tile (the penny).
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const tile = TILES[row * 2 + col];
      drawTile(cv, tile, MARGIN + col * (colW + gap), ty, colW, tileH);
    }
    ty += tileH + gap;
  }
  drawTile(cv, TILES[4], MARGIN, ty, W - 2 * MARGIN, tileH);
  ty += tileH + gap;

  // --- Also-in-the-news ticker ---------------------------------------------
  cv.fillRect(MARGIN, ty, W - 2 * MARGIN, 44, NAVY);
  drawText(
    cv,
    "ALSO: NEPAL PM MEETS MODI IN DELHI  •  INDONESIA SEIZES ROCKET-CHEMICAL SHIP",
    MARGIN + 14,
    ty + 12,
    2,
    WHITE,
  );
  ty += 44 + 12;

  // --- Footer ---------------------------------------------------------------
  drawCentred(
    cv,
    "REPORTED 23 NOVEMBER 2026  •  BBC  •  FRANCE 24  •  THE GUARDIAN  •  NEW YORK TIMES",
    W / 2,
    ty + 2,
    2,
    GREY,
  );

  return encodePng(W, H, cv.px);
}

// ---------------------------------------------------------------------------
// Entry point: write the image, validate it, and log what happened.
// ---------------------------------------------------------------------------

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  if (!outDir || outDir.includes("\0")) {
    throw new Error("MAKEFUN_OUTPUT_DIR is missing or invalid");
  }
  mkdirSync(outDir, { recursive: true });
  const png = drawPage();
  const outPath = join(outDir, "entry.png");
  writeFileSync(outPath, png);

  // Self-checks: the gate's own limits, enforced here so a bad run fails
  // loudly instead of shipping a bad image.
  if (png.length > 1048576) {
    throw new Error(`entry.png is ${png.length} bytes, over the 1 MiB limit`);
  }
  const sig = png.subarray(0, 8);
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!sig.equals(expected)) throw new Error("entry.png is not a PNG");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width > 1024 || height > 1024) {
    throw new Error(`entry.png is ${width}x${height}, over the 1024x1024 limit`);
  }
  const sha = createHash("sha256").update(png).digest("hex");
  console.log(`wrote ${outPath} (${width}x${height}, ${png.length} bytes, sha256 ${sha})`);
}

main();
