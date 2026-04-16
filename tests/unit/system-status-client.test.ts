/**
 * Unit tests for the client-side system-status polling script.
 *
 * Scenarios: TS-3.1–3.5, TS-2.3–2.5
 *
 * The script lives at src/web/system-status-client.src.js and is executed
 * inside a Node vm sandbox with a mocked DOM. See status-client-sandbox.ts.
 *
 * Phase 4 contract: these tests fail because src/web/system-status-client.src.js
 * does not yet exist. The sandbox helper throws from readFileSync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStatusClientSandbox } from "../helpers/status-client-sandbox.js";
import { fakeHealthAllReady, fakeHealthWhisperLoading } from "../helpers/fake-health.js";

describe("System status — client polling script", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 3 — polling behavior
  // ─────────────────────────────────────────────────────────────────

  describe("Group 3 — polling", () => {
    it("TS-3.1 — client polls /health every 10 seconds", async () => {
      const sandbox = createStatusClientSandbox({ includeTelegramDot: true });

      // Respond to the initial poll.
      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthAllReady(),
        uptime: 10,
      });
      expect(sandbox.fetch).toHaveBeenCalledTimes(1);

      // Advance 10 seconds → one more poll fires.
      await sandbox.advanceTime(10_000);
      expect(sandbox.fetch).toHaveBeenCalledTimes(2);

      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthAllReady(),
        uptime: 20,
      });

      await sandbox.advanceTime(10_000);
      expect(sandbox.fetch).toHaveBeenCalledTimes(3);
    });

    it("TS-3.2 — successful poll updates indicator colors", async () => {
      const sandbox = createStatusClientSandbox({ includeTelegramDot: true });

      const whisperDot = sandbox.getDot("whisper")!;
      expect(whisperDot.classList._set.has("bg-primary")).toBe(true);
      expect(whisperDot.classList._set.has("bg-destructive")).toBe(false);

      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthWhisperLoading(),
        uptime: 10,
      });

      expect(whisperDot.classList._set.has("bg-destructive")).toBe(true);
      expect(whisperDot.classList._set.has("animate-pulse")).toBe(false);
    });

    it("TS-3.3 — network-error poll retains previous state", async () => {
      const sandbox = createStatusClientSandbox({ includeTelegramDot: true });

      // First poll: everything ready.
      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthAllReady(),
        uptime: 10,
      });
      const whisperDot = sandbox.getDot("whisper")!;
      expect(whisperDot.classList._set.has("bg-primary")).toBe(true);

      // Second poll: fails.
      await sandbox.advanceTime(10_000);
      await sandbox.failPoll(new Error("network"));

      // Dot state unchanged.
      expect(whisperDot.classList._set.has("bg-primary")).toBe(true);
      expect(whisperDot.classList._set.has("bg-destructive")).toBe(false);
    });

    it("TS-3.4 — HTTP 500 poll response retains previous state", async () => {
      const sandbox = createStatusClientSandbox({ includeTelegramDot: true });

      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthAllReady(),
        uptime: 10,
      });
      const whisperDot = sandbox.getDot("whisper")!;

      await sandbox.advanceTime(10_000);
      await sandbox.respondWith500();

      expect(whisperDot.classList._set.has("bg-primary")).toBe(true);
      expect(whisperDot.classList._set.has("bg-destructive")).toBe(false);
    });

    it("TS-3.5 — dot color update occurs in the same tick as the poll response", async () => {
      const sandbox = createStatusClientSandbox({ includeTelegramDot: true });

      // `respondWith` resolves the fetch promise and then flushes two
      // microtask turns. If the DOM update happens within that flush, the
      // update is effectively synchronous with the response — well under
      // the 100ms UX budget.
      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthWhisperLoading(),
        uptime: 10,
      });

      const whisperDot = sandbox.getDot("whisper")!;
      expect(whisperDot.classList._set.has("bg-destructive")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Group 2 (client half) — banner dismissal
  // ─────────────────────────────────────────────────────────────────

  describe("Group 2 — banner dismissal", () => {
    it("TS-2.3 — dismiss button removes banner from DOM", async () => {
      const sandbox = createStatusClientSandbox({
        includeTelegramDot: true,
        initialBannerServices: [
          { key: "whisper", detail: "Loading Whisper model" },
        ],
      });

      expect(sandbox.getBanner()).not.toBeNull();
      expect(sandbox.getBanner()!.parentNode).not.toBeNull();

      const dismiss = sandbox.getDismissButton()!;
      expect(dismiss).not.toBeNull();
      dismiss._fireClick();

      // After dismissal, the banner is detached from its parent.
      expect(sandbox.getBanner()!.parentNode).toBeNull();
    });

    it("TS-2.4 — dismissed banner does not reappear during same page load", async () => {
      const sandbox = createStatusClientSandbox({
        includeTelegramDot: true,
        initialBannerServices: [
          { key: "whisper", detail: "Loading Whisper model" },
        ],
      });

      sandbox.getDismissButton()!._fireClick();

      // Advance 10s and respond with the same health state.
      await sandbox.advanceTime(10_000);
      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthWhisperLoading(),
        uptime: 20,
      });

      // The banner must not have been re-attached anywhere. The sandbox
      // exposes the current banner element; after dismissal it is detached.
      const banner = sandbox.getBanner();
      expect(banner?.parentNode).toBeNull();
    });

    it("TS-2.5 — after dismissal, footer dot still updates on state change", async () => {
      const sandbox = createStatusClientSandbox({
        includeTelegramDot: true,
        initialBannerServices: [
          { key: "whisper", detail: "Loading Whisper model" },
        ],
      });
      const whisperDot = sandbox.getDot("whisper")!;
      // Start with whisper in not-ready state.
      whisperDot.classList._set.delete("bg-primary");
      whisperDot.classList._set.delete("animate-pulse");
      whisperDot.classList._set.add("bg-destructive");

      sandbox.getDismissButton()!._fireClick();

      await sandbox.advanceTime(10_000);
      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthAllReady(),
        uptime: 20,
      });

      expect(whisperDot.classList._set.has("bg-primary")).toBe(true);
      expect(whisperDot.classList._set.has("animate-pulse")).toBe(true);
      expect(whisperDot.classList._set.has("bg-destructive")).toBe(false);

      // Banner still dismissed.
      expect(sandbox.getBanner()?.parentNode).toBeNull();
    });

    it("banner auto-dismisses when all services become ready", async () => {
      const sandbox = createStatusClientSandbox({
        includeTelegramDot: true,
        initialBannerServices: [
          { key: "whisper", detail: "Loading Whisper model" },
        ],
      });

      // Banner starts attached.
      expect(sandbox.getBanner()!.parentNode).not.toBeNull();

      // First poll: whisper still not ready — banner stays.
      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthWhisperLoading(),
        uptime: 10,
      });
      expect(sandbox.getBanner()!.parentNode).not.toBeNull();

      // Second poll: all services now ready — banner auto-removed.
      await sandbox.advanceTime(10_000);
      await sandbox.respondWith({
        status: "ok",
        services: fakeHealthAllReady(),
        uptime: 20,
      });
      expect(sandbox.getBanner()!.parentNode).toBeNull();
    });
  });
});
