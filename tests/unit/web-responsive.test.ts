import { describe, it, expect } from "vitest";
import { renderLayout } from "../../src/web/layout.js";

// REQ-NFR-007 verification. Structural checks only: the SRS explicitly scopes
// this requirement to (a) viewport meta tag presence and (b) fluid main
// containers. Visual mobile compatibility is manual QA.

describe("REQ-NFR-007 — responsive design fit criteria", () => {
  describe("viewport meta tag", () => {
    it("renderLayout emits the viewport meta tag", () => {
      const html = renderLayout("Test", "<main>ok</main>", "/");
      expect(html).toContain(
        `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
      );
    });

    it("setup wizard pages emit the viewport meta tag", async () => {
      // Setup pages inline their own <head>. Read the source to verify the
      // meta tag is emitted by renderSetupLayout and renderLoginPage.
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const setupPath = resolve(here, "../../src/web/setup.ts");
      const setupSource = readFileSync(setupPath, "utf-8");
      const viewportMatches = setupSource.match(
        /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/g,
      );
      // Expect at least two — one for renderSetupLayout and one for renderLoginPage.
      expect(viewportMatches).not.toBeNull();
      expect(viewportMatches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("fluid main containers", () => {
    it("renderLayout's root container is fluid with a max-width bound", () => {
      const html = renderLayout("Test", "<main>ok</main>", "/");
      // Root container uses w-full + max-w-*, so it adapts from 320px up.
      expect(html).toMatch(/class="[^"]*\bw-full\b[^"]*"/);
      expect(html).toMatch(/class="[^"]*\bmax-w-[^"\s]+[^"]*"/);
    });

    it("renderLayout does not apply a min-width on the root container", () => {
      const html = renderLayout("Test", "<main>ok</main>", "/");
      // A min-width greater than 320px would force horizontal scrolling on
      // small viewports. Assert none exists on the outer wrapper.
      expect(html).not.toMatch(/class="[^"]*\bmin-w-(sm|md|lg|xl|\d+|\[[^\]]+\])[^"]*"/);
    });

    it("nav labels collapse below the sm breakpoint", () => {
      const html = renderLayout("Test", "<main>ok</main>", "/");
      // Nav labels are wrapped in <span class="hidden sm:inline"> so the bar
      // stays icon-only on mobile.
      expect(html).toContain(`hidden sm:inline`);
    });
  });
});
