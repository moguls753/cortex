// Kitchen display rendering pipeline: layout -> Satori (SVG) -> Resvg (PNG).

import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayout } from "./layout.js";
import type { KitchenData } from "./types.js";

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

export async function renderKitchenDisplay(
  data: KitchenData,
  width = 1872,
  height = 1404,
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

  // Build the Satori element tree
  const element = buildLayout(data, width, height);

  // Render to SVG via Satori
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await satori(element as any, {
    width,
    height,
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
  return Buffer.from(pngData.asPng());
}
