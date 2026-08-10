// Display rendering pipeline: layout -> Satori (SVG) -> Resvg (PNG).

import satori from "satori";
// Side-effect import: registers the translation catalogs with i18next.
// A type-only import would be erased and leave t() resolving to nothing.
import "../web/i18n/index.js";
import i18next, { type TFunction } from "i18next";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayout } from "./layout.js";
import { encodeGray4 } from "./png-gray4.js";
import type { DisplayData } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lazy-loaded fonts and WASM (avoids crashing app startup if fonts are missing)
let fontRegular: Buffer | null = null;
let fontMedium: Buffer | null = null;
let resvgInitialized = false;

function loadFonts(): void {
  if (fontRegular) return;
  fontRegular = readFileSync(
    join(__dirname, "fonts", "JetBrainsMono-Regular.ttf"),
  );
  fontMedium = readFileSync(
    join(__dirname, "fonts", "JetBrainsMono-Medium.ttf"),
  );
}

export async function renderDisplay(
  data: DisplayData,
  width = 1872,
  height = 1404,
  fontScale = 1,
  t: TFunction = i18next.getFixedT("en") as TFunction,
): Promise<Buffer> {
  // Load fonts on first call
  loadFonts();

  // Initialize resvg WASM on first call
  if (!resvgInitialized) {
    try {
      const wasmPath = join(
        dirname(fileURLToPath(import.meta.resolve("@resvg/resvg-wasm"))),
        "index_bg.wasm",
      );
      const wasmBuffer = readFileSync(wasmPath);
      await initWasm(wasmBuffer);
    } catch {
      // Already initialized (e.g., hot reload)
    }
    resvgInitialized = true;
  }

  // Render at reference width (1872px) preserving the target aspect ratio.
  // The layout uses fixed pixel values designed for 1872px; smaller canvases
  // cause Satori/Resvg WASM panics. Resvg rasterizes the SVG vectors directly
  // at the target resolution via fitTo, so the output is crisp — no bitmap scaling.
  const REF_WIDTH = 1872;
  const renderWidth = Math.max(width, REF_WIDTH);
  const renderHeight = Math.round(renderWidth * (height / width));

  // Build the Satori element tree
  const element = buildLayout(data, renderWidth, renderHeight, fontScale, t);

  // Render to SVG via Satori
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await satori(element as any, {
    width: renderWidth,
    height: renderHeight,
    fonts: [
      {
        name: "JetBrains Mono",
        data: fontRegular!,
        weight: 400 as const,
        style: "normal" as const,
      },
      {
        name: "JetBrains Mono",
        data: fontMedium!,
        weight: 500 as const,
        style: "normal" as const,
      },
    ],
  });

  // Convert SVG to PNG via Resvg
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
  });

  const pngData = resvg.render();

  // Resvg only emits 8-bit RGBA. E-ink panels want a device-native image —
  // TRMNL X renders 4-bit grayscale and mangles anything else — so re-encode
  // before returning. Also cuts the payload roughly 3x, which matters against
  // the firmware's image size cap.
  const png = encodeGray4(pngData.pixels, pngData.width, pngData.height);

  // Both handles own Rust-side memory that the JS garbage collector cannot
  // reach. Without these, ~10MB leaks per render until wasm32 hits its 4GB
  // ceiling and traps — around 400 renders, after which EVERY subsequent
  // render throws `unreachable` until the process restarts. At a 15-minute
  // device refresh that is a permanently blank panel after about four days.
  pngData.free();
  resvg.free();

  return png;
}
