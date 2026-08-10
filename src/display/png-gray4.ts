// 4-bit grayscale PNG encoder for e-ink displays.
//
// TRMNL X decodes PNGs itself and expects a device-native image: 4-bit
// grayscale (16 levels), no alpha channel. Resvg only emits 8-bit RGBA, and
// feeding that to the device renders the first band and then garbage. This
// module converts Resvg's raw pixel buffer into a conforming PNG using only
// node:zlib — no image library needed for a format this small.
//
// See https://trmnl.com/api/models — TRMNL X: bit_depth 4, palette gray-16.

import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Convert a **premultiplied** RGBA pixel buffer to a 4-bit grayscale PNG.
 *
 * Resvg's `RenderedImage.pixels` is premultiplied — a 50%-opacity red renders
 * as (128,0,0,128), not (255,0,0,128). Alpha is composited over white rather
 * than discarded, since the panel has no transparency and dropping it outright
 * would turn semi-transparent content into hard black.
 */
export function encodeGray4(
  rgba: Uint8Array,
  width: number,
  height: number,
): Buffer {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`encodeGray4: width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`encodeGray4: height must be a positive integer, got ${height}`);
  }

  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(
      `encodeGray4: expected ${expected} bytes for ${width}x${height} RGBA, got ${rgba.length}`,
    );
  }

  // Two pixels per byte, high nibble first; odd widths leave the final low
  // nibble unused, as the PNG spec requires.
  const bytesPerRow = Math.ceil(width / 2);
  // +1 per row for the filter-type byte (0 = None).
  const raw = Buffer.alloc(height * (bytesPerRow + 1));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (bytesPerRow + 1);
    raw[rowStart] = 0;

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Composite premultiplied source over white: channels already carry the
      // alpha factor, so only the white contribution needs weighting.
      const white = 255 - rgba[i + 3];
      const r = rgba[i] + white;
      const g = rgba[i + 1] + white;
      const b = rgba[i + 2] + white;
      // Rec. 709 luma, then map 0-255 onto the 16 levels the panel has. Round
      // rather than truncate so a level covers its nearest inputs — decoders
      // expand level L back to 17*L. Well-formed premultiplied input cannot
      // exceed 255, but clamp anyway so malformed input cannot overflow a nibble.
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const level = Math.min(15, Math.round((luma * 15) / 255));

      const byteIndex = rowStart + 1 + (x >> 1);
      raw[byteIndex] |= x % 2 === 0 ? level << 4 : level;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 4; // bit depth
  ihdr[9] = 0; // color type 0 = grayscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    // Level 6, not 9: on high-detail frames level 9 spends ~750ms blocking the
    // event loop for ~12% fewer bytes, and even level 6 lands far under the
    // firmware's image size cap.
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
