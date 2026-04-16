/**
 * Unit tests for server-side rendering of the system-status footer and banner.
 *
 * Scenarios: TS-1.1–1.4, TS-2.1, TS-2.2, TS-2.6, TS-2.7, TS-2.8, TS-2.9,
 *            TS-10.1, TS-10.2, TS-10.4, TS-10.5
 *
 * Dismissal scenarios (TS-2.3–2.5) live in system-status-client.test.ts
 * because they exercise the client-side JS.
 *
 * Phase 4 contract: every test here must FAIL until Phase 5 extends
 * `renderLayout` (or extracts `renderFooter` / `renderBanner`) to accept a
 * health status parameter and produce the corresponding markup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  fakeHealthAllReady,
  fakeHealthWhisperLoading,
  fakeHealthBothDownloading,
  fakeHealthNoTelegram,
  fakeHealthNoTelegramWhisperLoading,
  type HealthStatus,
} from "../helpers/fake-health.js";

const TITLE = "TestPage";
const CONTENT = `<main data-test-main="1">hello</main>`;

async function render(healthStatus: HealthStatus): Promise<string> {
  const { renderLayout } = await import("../../src/web/layout.js");
  return (renderLayout as (
    title: string,
    content: string,
    activePage?: string,
    healthStatus?: HealthStatus,
  ) => string)(TITLE, CONTENT, "/", healthStatus);
}

describe("System status — layout footer + banner", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 1: footer rendering
  // ─────────────────────────────────────────────────────────────────

  describe("Group 1 — footer indicator rendering", () => {
    it("TS-1.1 — renders one indicator per configured service (Telegram configured)", async () => {
      const html = await render(fakeHealthAllReady());
      // Footer contains a section with dots labeled postgres, ollama, whisper, telegram.
      // We don't care about exact class names here — just that each label appears
      // at most once inside the status-footer region.
      const footerMatch = html.match(
        /<footer[^>]*data-status-footer="true"[\s\S]*?<\/footer>/,
      );
      expect(footerMatch).not.toBeNull();
      const footer = footerMatch![0];
      const labels = ["postgres", "ollama", "whisper", "telegram"];
      for (const label of labels) {
        const re = new RegExp(`data-status-dot="${label}"`);
        expect(footer).toMatch(re);
      }
    });

    it("TS-1.2 — footer omits Telegram indicator when Telegram unconfigured", async () => {
      const html = await render(fakeHealthNoTelegram());
      const footerMatch = html.match(
        /<footer[^>]*data-status-footer="true"[\s\S]*?<\/footer>/,
      );
      expect(footerMatch).not.toBeNull();
      const footer = footerMatch![0];
      expect(footer).toMatch(/data-status-dot="postgres"/);
      expect(footer).toMatch(/data-status-dot="ollama"/);
      expect(footer).toMatch(/data-status-dot="whisper"/);
      expect(footer).not.toMatch(/data-status-dot="telegram"/);
    });

    it("TS-1.3 — ready indicator renders with pulsing primary class", async () => {
      const html = await render(fakeHealthAllReady());
      // Each dot element contains both bg-primary and animate-pulse.
      const whisperDot = html.match(
        /data-status-dot="whisper"[^>]*class="([^"]+)"/,
      );
      expect(whisperDot).not.toBeNull();
      const classes = whisperDot![1];
      expect(classes).toMatch(/\bbg-primary\b/);
      expect(classes).toMatch(/\banimate-pulse\b/);
      expect(classes).not.toMatch(/\bbg-destructive\b/);
    });

    it("TS-1.4 — not-ready indicator renders with destructive class, no pulse", async () => {
      const html = await render(fakeHealthWhisperLoading());
      const whisperDot = html.match(
        /data-status-dot="whisper"[^>]*class="([^"]+)"/,
      );
      expect(whisperDot).not.toBeNull();
      const whisperClasses = whisperDot![1];
      expect(whisperClasses).toMatch(/\bbg-destructive\b/);
      expect(whisperClasses).not.toMatch(/\banimate-pulse\b/);

      // Other dots retain ready styling.
      const postgresDot = html.match(
        /data-status-dot="postgres"[^>]*class="([^"]+)"/,
      );
      expect(postgresDot).not.toBeNull();
      const postgresClasses = postgresDot![1];
      expect(postgresClasses).toMatch(/\bbg-primary\b/);
      expect(postgresClasses).toMatch(/\banimate-pulse\b/);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 2: banner rendering
  // ─────────────────────────────────────────────────────────────────

  describe("Group 2 — banner rendering", () => {
    it("TS-2.1 — banner renders on initial page load with not-ready services", async () => {
      const html = await render(fakeHealthBothDownloading());
      expect(html).toMatch(/data-status-banner="true"/);
      expect(html).toContain(
        "Downloading embedding model (qwen3-embedding)",
      );
      expect(html).toContain(
        "Loading Whisper model — first boot can take several minutes",
      );
    });

    it("TS-2.2 — banner appears in server HTML above <main> (not JS-injected)", async () => {
      const html = await render(fakeHealthWhisperLoading());
      const bannerIdx = html.indexOf("data-status-banner");
      const mainIdx = html.indexOf("data-test-main");
      expect(bannerIdx).toBeGreaterThan(-1);
      expect(mainIdx).toBeGreaterThan(-1);
      expect(bannerIdx).toBeLessThan(mainIdx);

      // Banner must not only exist inside a <script>...</script> block.
      const scriptBlocks = html.match(/<script[\s\S]*?<\/script>/g) ?? [];
      for (const block of scriptBlocks) {
        expect(block).not.toContain("data-status-banner");
      }
    });

    it("TS-2.6 — no banner when all services ready", async () => {
      const html = await render(fakeHealthAllReady());
      expect(html).not.toMatch(/data-status-banner="true"/);
    });

    it("TS-2.7 — banner omits Telegram line when Telegram unconfigured", async () => {
      const html = await render(fakeHealthNoTelegramWhisperLoading());
      expect(html).toMatch(/data-status-banner="true"/);
      // Extract banner markup and inspect.
      const bannerMatch = html.match(
        /data-status-banner="true"[\s\S]*?<\/aside>/,
      );
      expect(bannerMatch).not.toBeNull();
      const banner = bannerMatch![0];
      expect(banner).toMatch(/whisper/i);
      expect(banner).not.toMatch(/telegram/i);
    });

    it("TS-2.8 — reloading after dismissal re-evaluates banner (pure render)", async () => {
      // Rendering is pure: calling renderLayout twice with the same health
      // status produces the same banner both times. Dismissal state lives
      // in the client DOM, not on the server.
      const first = await render(fakeHealthWhisperLoading());
      const second = await render(fakeHealthWhisperLoading());
      expect(first).toMatch(/data-status-banner="true"/);
      expect(second).toMatch(/data-status-banner="true"/);
    });

    it("TS-2.9 — banner lists both whisper and ollama after onboarding redirect", async () => {
      const html = await render(fakeHealthBothDownloading());
      const bannerMatch = html.match(
        /data-status-banner="true"[\s\S]*?<\/aside>/,
      );
      expect(bannerMatch).not.toBeNull();
      const banner = bannerMatch![0];
      expect(banner).toMatch(/whisper/i);
      expect(banner).toMatch(/ollama|embedding/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 10: constraint checks that fit naturally in this file
  // ─────────────────────────────────────────────────────────────────

  describe("Group 10 — constraints", () => {
    it("TS-10.1 — layout does not introduce frontend framework dependencies", async () => {
      const layoutSrc = readFileSync("src/web/layout.ts", "utf8");
      const forbidden = [
        "from \"react\"",
        "from 'react'",
        "from \"vue\"",
        "from 'vue'",
        "from \"svelte\"",
        "from 'svelte'",
        "from \"alpinejs\"",
        "from 'alpinejs'",
        "from \"preact\"",
        "from 'preact'",
        "from \"solid-js\"",
        "from 'solid-js'",
      ];
      for (const needle of forbidden) {
        expect(layoutSrc).not.toContain(needle);
      }
    });

    it("TS-10.2 — footer markup is produced by src/web/layout.ts", async () => {
      const html = await render(fakeHealthAllReady());
      expect(html).toMatch(/data-status-footer="true"/);
      const layoutSrc = readFileSync("src/web/layout.ts", "utf8");
      expect(layoutSrc).toMatch(/data-status-footer/);
    });

    it("TS-10.4 — no inline style attributes in layout.ts", async () => {
      const layoutSrc = readFileSync("src/web/layout.ts", "utf8");
      // Allow the "data-test-main" style-like attribute but forbid style="..."
      // inside template literals.
      const styleAttrMatches = layoutSrc.match(/style="/g) ?? [];
      expect(styleAttrMatches.length).toBe(0);
    });

    it("TS-10.5 — render latency is bounded by per-check timeout when one check hangs", async () => {
      // This test covers the spec's C-6 / AC-4.5 contract indirectly: the
      // layout render path calls getServiceStatus, which must impose a
      // bounded timeout per check.
      const { getServiceStatus } = await import(
        "../../src/web/service-checkers.js"
      );

      // Mock all the fetch/DB calls getServiceStatus makes. We have to rely
      // on whatever dependency-injection seam the implementation exposes —
      // the test assumes getServiceStatus accepts a deps object or reads
      // from an injected sql.
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input) => {
          const url = typeof input === "string" ? input : (input as URL).toString();
          if (url.includes("whisper")) {
            // Hang forever.
            return new Promise(() => {
              /* never */
            });
          }
          if (url.includes("ollama")) {
            return new Response(
              JSON.stringify({
                models: [{ name: "qwen3-embedding:latest", model: "qwen3-embedding:latest" }],
              }),
              { status: 200 },
            );
          }
          return new Response("{}", { status: 200 });
        },
      );

      const sql = (await import("../helpers/mock-sql.js")).createMockSql({
        onQuery: async () => [],
      });

      const started = Date.now();
      const status = await (getServiceStatus as (sql: unknown) => Promise<HealthStatus>)(
        sql,
      );
      const elapsed = Date.now() - started;

      expect(elapsed).toBeLessThan(3500);
      expect(status.whisper.ready).toBe(false);
      fetchSpy.mockRestore();
    });
  });
});
