import { describe, it, expect } from "vitest";
import { crc32, inflateSync } from "node:zlib";
import { encodeGray4 } from "../../src/display/png-gray4.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Build an RGBA buffer from [r,g,b,a] tuples, row-major. */
function rgbaFrom(pixels: number[][]): Uint8Array {
  return Uint8Array.from(pixels.flat());
}

/** Walk the PNG chunk list: [{ type, data, crc, expectedCrc }] in file order. */
function readChunks(
  png: Buffer,
): { type: string; data: Buffer; crc: number; expectedCrc: number }[] {
  const chunks = [];
  let offset = SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({
      type,
      data,
      crc: png.readUInt32BE(offset + 8 + length),
      // Per spec the CRC covers the chunk type *and* the data — omitting the
      // type is the classic hand-rolled-PNG bug, so compute it independently
      // here with node's own implementation.
      expectedCrc: crc32(png.subarray(offset + 4, offset + 8 + length)),
    });
    offset += 12 + length; // length + type + data + crc
  }
  return chunks;
}

/** Inflate IDAT and strip the per-row filter byte, returning packed rows. */
function decodeRows(png: Buffer, bytesPerRow: number): Buffer[] {
  const idat = readChunks(png).find((c) => c.type === "IDAT")!;
  const raw = inflateSync(idat.data);
  const rows: Buffer[] = [];
  for (let offset = 0; offset < raw.length; offset += bytesPerRow + 1) {
    expect(raw[offset]).toBe(0); // filter type None
    rows.push(raw.subarray(offset + 1, offset + 1 + bytesPerRow));
  }
  return rows;
}

const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

describe("encodeGray4", () => {
  it("emits a PNG signature and IHDR/IDAT/IEND in order", () => {
    const png = encodeGray4(rgbaFrom([WHITE, BLACK]), 2, 1);

    expect(png.subarray(0, 8).equals(SIGNATURE)).toBe(true);
    expect(readChunks(png).map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("declares 4-bit grayscale with the given dimensions", () => {
    const png = encodeGray4(rgbaFrom(Array(12).fill(WHITE)), 4, 3);
    const ihdr = readChunks(png)[0].data;

    expect(ihdr.readUInt32BE(0)).toBe(4); // width
    expect(ihdr.readUInt32BE(4)).toBe(3); // height
    expect(ihdr[8]).toBe(4); // bit depth
    expect(ihdr[9]).toBe(0); // color type 0 = grayscale, no alpha
    expect(ihdr[10]).toBe(0); // deflate
    expect(ihdr[11]).toBe(0); // adaptive filtering
    expect(ihdr[12]).toBe(0); // non-interlaced
  });

  it("stores a valid CRC-32 over type+data for every chunk", () => {
    const png = encodeGray4(rgbaFrom([WHITE, BLACK, WHITE, BLACK]), 2, 2);

    for (const c of readChunks(png)) {
      expect(`${c.type}:${c.crc}`).toBe(`${c.type}:${c.expectedCrc}`);
    }
  });

  it("stores CRCs that survive a payload large enough to span deflate blocks", () => {
    const png = encodeGray4(new Uint8Array(512 * 512 * 4).fill(255), 512, 512);

    for (const c of readChunks(png)) {
      expect(`${c.type}:${c.crc}`).toBe(`${c.type}:${c.expectedCrc}`);
    }
  });

  it("carries no alpha or palette chunks", () => {
    const png = encodeGray4(rgbaFrom([WHITE, BLACK]), 2, 1);
    const types = readChunks(png).map((c) => c.type);

    expect(types).not.toContain("tRNS");
    expect(types).not.toContain("PLTE");
  });

  it("maps white to level 15 and black to level 0, two pixels per byte", () => {
    const png = encodeGray4(rgbaFrom([WHITE, BLACK]), 2, 1);
    const [row] = decodeRows(png, 1);

    expect(row.length).toBe(1);
    expect(row[0]).toBe(0xf0); // high nibble = first pixel
  });

  it("composites transparent pixels over white instead of blackening them", () => {
    // Fully transparent black — naive alpha-dropping would yield level 0.
    const png = encodeGray4(rgbaFrom([[0, 0, 0, 0], WHITE]), 2, 1);
    const [row] = decodeRows(png, 1);

    expect(row[0] >> 4).toBe(15);
  });

  it("quantizes half-transparent black over white to a mid-gray level", () => {
    const png = encodeGray4(rgbaFrom([[0, 0, 0, 128], WHITE]), 2, 1);
    const [row] = decodeRows(png, 1);

    const level = row[0] >> 4;
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(15);
  });

  it("treats input as premultiplied — half-transparent white stays white", () => {
    // Resvg emits premultiplied pixels: 50%-opacity white is (128,128,128,128),
    // which composited over white is still white. Reading it as straight alpha
    // would darken it to a mid-gray.
    const png = encodeGray4(rgbaFrom([[128, 128, 128, 128], BLACK]), 2, 1);
    const [row] = decodeRows(png, 1);

    expect(row[0] >> 4).toBe(15);
  });

  it("treats input as premultiplied — a 25%-opacity gray lands near white", () => {
    // #cccccc at 25% opacity premultiplies to (51,51,51,64); over white that is
    // 242 -> level 14. The straight-alpha reading would give level 8.
    const png = encodeGray4(rgbaFrom([[51, 51, 51, 64], BLACK]), 2, 1);
    const [row] = decodeRows(png, 1);

    expect(row[0] >> 4).toBe(14);
  });

  it("uses Rec. 709 luma so color channels are weighted, not averaged", () => {
    // Pure green is much brighter than pure blue under Rec. 709.
    const png = encodeGray4(rgbaFrom([[0, 255, 0, 255], [0, 0, 255, 255]]), 2, 1);
    const [row] = decodeRows(png, 1);

    expect(row[0] >> 4).toBeGreaterThan(row[0] & 0x0f);
  });

  it("pads odd widths to a whole byte per row", () => {
    const png = encodeGray4(rgbaFrom([WHITE, BLACK, WHITE]), 3, 1);
    const [row] = decodeRows(png, 2);

    expect(row.length).toBe(2);
    expect(row[0]).toBe(0xf0);
    expect(row[1]).toBe(0xf0); // third pixel white, unused low nibble zeroed
  });

  it("emits one filtered row per scanline", () => {
    const png = encodeGray4(rgbaFrom(Array(8).fill(WHITE)), 2, 4);
    const rows = decodeRows(png, 1);

    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r[0] === 0xff)).toBe(true);
  });

  it("keeps rows independent — a black row does not bleed into its neighbours", () => {
    const png = encodeGray4(
      rgbaFrom([WHITE, WHITE, BLACK, BLACK, WHITE, WHITE]),
      2,
      3,
    );
    const rows = decodeRows(png, 1);

    expect(rows.map((r) => r[0])).toEqual([0xff, 0x00, 0xff]);
  });

  it("rounds to the nearest level instead of truncating", () => {
    // Gray 30 is 1.76 levels up the 16-step scale. Truncating (>> 4) yields 1.
    const png = encodeGray4(rgbaFrom([[30, 30, 30, 255], BLACK]), 2, 1);
    const [row] = decodeRows(png, 1);

    expect(row[0] >> 4).toBe(2);
  });

  it("rejects non-positive or non-integer dimensions", () => {
    expect(() => encodeGray4(new Uint8Array(0), 0, 4)).toThrow(
      /width must be a positive integer, got 0/,
    );
    expect(() => encodeGray4(new Uint8Array(0), 4, 0)).toThrow(
      /height must be a positive integer, got 0/,
    );
    expect(() => encodeGray4(new Uint8Array(0), -2, 4)).toThrow(/width/);
    expect(() => encodeGray4(new Uint8Array(64), 2.5, 4)).toThrow(/width/);
  });

  it("throws when the buffer length does not match the dimensions", () => {
    expect(() => encodeGray4(rgbaFrom([WHITE]), 2, 1)).toThrow(
      /expected 8 bytes for 2x1 RGBA, got 4/,
    );
  });

  it("keeps a full-size inked frame under the firmware's 750 KB cap", () => {
    const width = 1872;
    const height = 1404;

    const blank = new Uint8Array(width * height * 4).fill(255);
    // Text-like ink coverage (~7%) rather than a flat fill, which any
    // implementation — including a broken one emitting a constant — would pass.
    const inked = new Uint8Array(blank);
    for (let y = 0; y < height; y++) {
      if (y % 40 >= 20) continue;
      for (let x = 0; x < width; x += 7) {
        const i = (y * width + x) * 4;
        inked[i] = inked[i + 1] = inked[i + 2] = 0;
      }
    }

    const inkedPng = encodeGray4(inked, width, height);

    expect(inkedPng.length).toBeLessThan(750_000);
    // Output tracks content, so it is not a fixed-size artefact.
    expect(inkedPng.length).toBeGreaterThan(
      encodeGray4(blank, width, height).length,
    );
  });
});
