/**
 * Node `vm` sandbox for executing the client-side system-status polling script
 * in a controlled environment. Lets unit tests exercise the exact JavaScript
 * that ships to the browser without a JSDOM dependency.
 *
 * Usage:
 *   const sandbox = createStatusClientSandbox({ initialHealth, initialTelegram });
 *   await sandbox.firstPollResolves({ ... });
 *   sandbox.advanceTime(10_000);
 *   expect(sandbox.fetch).toHaveBeenCalledTimes(2);
 *
 * Dependencies: only Node builtins (fs, path, vm) + vitest. No jsdom.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vm from "node:vm";
import { vi } from "vitest";
import type { HealthStatus, ServiceStatus } from "./fake-health.js";

// ─── Mock DOM types ─────────────────────────────────────────────────

interface MockClassList {
  add: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  toggle: ReturnType<typeof vi.fn>;
  /** Current underlying class names for inspection in assertions. */
  _set: Set<string>;
}

interface MockElement {
  id: string;
  tagName: string;
  textContent: string;
  innerHTML: string;
  classList: MockClassList;
  dataset: Record<string, string>;
  children: MockElement[];
  parentNode: MockElement | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  removeChild: ReturnType<typeof vi.fn>;
  appendChild: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  querySelector: (selector: string) => MockElement | null;
  querySelectorAll: (selector: string) => MockElement[];
  /** Test-only: fires a click event by invoking registered click listeners. */
  _fireClick: () => void;
  /** Test-only: stored click handlers. */
  _clickHandlers: Array<(ev: unknown) => void>;
}

function createMockClassList(initial: string[] = []): MockClassList {
  const set = new Set<string>(initial);
  const cl: MockClassList = {
    _set: set,
    add: vi.fn((...names: string[]) => {
      for (const n of names) set.add(n);
    }),
    remove: vi.fn((...names: string[]) => {
      for (const n of names) set.delete(n);
    }),
    contains: vi.fn((name: string) => set.has(name)),
    toggle: vi.fn((name: string) => {
      if (set.has(name)) {
        set.delete(name);
        return false;
      }
      set.add(name);
      return true;
    }),
  };
  return cl;
}

function createMockElement(init: {
  id?: string;
  tagName?: string;
  classes?: string[];
  dataset?: Record<string, string>;
}): MockElement {
  const clickHandlers: Array<(ev: unknown) => void> = [];
  const el: MockElement = {
    id: init.id ?? "",
    tagName: (init.tagName ?? "DIV").toUpperCase(),
    textContent: "",
    innerHTML: "",
    classList: createMockClassList(init.classes ?? []),
    dataset: { ...(init.dataset ?? {}) },
    children: [],
    parentNode: null,
    _clickHandlers: clickHandlers,
    addEventListener: vi.fn((event: string, handler: (ev: unknown) => void) => {
      if (event === "click") clickHandlers.push(handler);
    }),
    removeEventListener: vi.fn(),
    removeChild: vi.fn((child: MockElement) => {
      el.children = el.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    }),
    appendChild: vi.fn((child: MockElement) => {
      el.children.push(child);
      child.parentNode = el;
      return child;
    }),
    remove: vi.fn(() => {
      if (el.parentNode) {
        el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
        el.parentNode = null;
      }
    }),
    querySelector: (selector: string): MockElement | null => {
      for (const child of el.children) {
        if (matchesSelector(child, selector)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    },
    querySelectorAll: (selector: string): MockElement[] => {
      const out: MockElement[] = [];
      for (const child of el.children) {
        if (matchesSelector(child, selector)) out.push(child);
        out.push(...child.querySelectorAll(selector));
      }
      return out;
    },
    _fireClick: () => {
      for (const h of clickHandlers) h({ type: "click" });
    },
  };
  return el;
}

function matchesSelector(el: MockElement, selector: string): boolean {
  // Very small subset: "#id", ".class", "[attr=value]", "[data-foo]"
  if (selector.startsWith("#")) return el.id === selector.slice(1);
  if (selector.startsWith(".")) return el.classList._set.has(selector.slice(1));
  const attrMatch = selector.match(/^\[([a-z-]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
  if (attrMatch) {
    const [, attr, value] = attrMatch;
    if (attr.startsWith("data-")) {
      const key = attr
        .slice(5)
        .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      if (value === undefined) return key in el.dataset;
      return el.dataset[key] === value;
    }
  }
  return false;
}

// ─── Sandbox construction ──────────────────────────────────────────

export interface SandboxOptions {
  /**
   * Whether Telegram has a footer dot in the initial DOM. Matches server-side
   * rendering: the dot is rendered iff Telegram is configured.
   */
  includeTelegramDot?: boolean;
  /**
   * Whether a banner element is present in the initial DOM (server-rendered).
   */
  initialBannerServices?: Array<{ key: string; detail: string }>;
}

export interface Sandbox {
  document: MockElement;
  fetch: ReturnType<typeof vi.fn>;
  advanceTime: (ms: number) => Promise<void>;
  getDot: (service: string) => MockElement | null;
  getBanner: () => MockElement | null;
  getDismissButton: () => MockElement | null;
  /**
   * Resolves the pending fetch with the given health response and flushes
   * microtasks so DOM updates settle.
   */
  respondWith: (health: {
    status: "ok" | "degraded";
    services: Record<string, ServiceStatus>;
    uptime: number;
  }) => Promise<void>;
  /** Rejects the pending fetch with a network-like error. */
  failPoll: (error?: Error) => Promise<void>;
  /** Resolves the pending fetch with an HTTP 500 response. */
  respondWith500: () => Promise<void>;
}

const SCRIPT_PATH = resolve("src/web/system-status-client.src.js");

export function createStatusClientSandbox(
  options: SandboxOptions = {},
): Sandbox {
  const includeTelegram = options.includeTelegramDot ?? false;

  // Build initial DOM: a fake document element containing four dots + banner slot.
  const dots: Record<string, MockElement> = {};
  const documentRoot = createMockElement({ id: "__document__" });

  for (const key of ["postgres", "ollama", "whisper", ...(includeTelegram ? ["telegram"] : [])]) {
    const dot = createMockElement({
      classes: ["size-1.5", "rounded-full", "bg-primary", "animate-pulse"],
      dataset: { statusDot: key },
    });
    dot.id = `status-dot-${key}`;
    documentRoot.appendChild(dot);
    dots[key] = dot;
  }

  // Banner slot (rendered server-side when any service is not-ready).
  let bannerElement: MockElement | null = null;
  if (options.initialBannerServices && options.initialBannerServices.length > 0) {
    bannerElement = createMockElement({
      dataset: { statusBanner: "true" },
    });
    bannerElement.id = "status-banner";
    documentRoot.appendChild(bannerElement);

    const dismiss = createMockElement({
      tagName: "BUTTON",
      dataset: { statusBannerDismiss: "true" },
    });
    dismiss.id = "status-banner-dismiss";
    bannerElement.appendChild(dismiss);
  }

  // Fetch spy — tests control its resolution via respondWith / failPoll.
  let pendingResolve: ((v: Response) => void) | null = null;
  let pendingReject: ((e: unknown) => void) | null = null;
  const fetchSpy = vi.fn(() => {
    return new Promise<Response>((resolveFn, rejectFn) => {
      pendingResolve = resolveFn;
      pendingReject = rejectFn;
    });
  });

  const mockDocument = {
    getElementById: (id: string): MockElement | null => {
      if (id === "status-banner") return bannerElement;
      if (id === "status-banner-dismiss") return bannerElement?.querySelector("#status-banner-dismiss") ?? null;
      return documentRoot.querySelectorAll(`#${id}`)[0] ?? null;
    },
    querySelector: (selector: string) => documentRoot.querySelector(selector),
    querySelectorAll: (selector: string) => documentRoot.querySelectorAll(selector),
    addEventListener: vi.fn(),
  };

  const sandboxGlobals = {
    document: mockDocument,
    window: {
      fetch: fetchSpy,
    },
    fetch: fetchSpy,
    console: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    setInterval: (cb: () => void, ms: number) => setInterval(cb, ms),
    clearInterval: (h: NodeJS.Timeout) => clearInterval(h),
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (h: NodeJS.Timeout) => clearTimeout(h),
  };

  // Load and execute the client script. If the file doesn't exist, the test
  // fails at readFileSync — which is correct for Phase 4 (tests must FAIL).
  const scriptSource = readFileSync(SCRIPT_PATH, "utf8");
  vm.createContext(sandboxGlobals);
  vm.runInContext(scriptSource, sandboxGlobals, { filename: "system-status-client.src.js" });

  // Flush any script-dispatched DOMContentLoaded handler.
  const listeners = (mockDocument.addEventListener as ReturnType<typeof vi.fn>).mock.calls
    .filter((c: unknown[]) => c[0] === "DOMContentLoaded")
    .map((c: unknown[]) => c[1] as () => void);
  for (const l of listeners) l();

  const sandbox: Sandbox = {
    document: documentRoot,
    fetch: fetchSpy,
    advanceTime: async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      // Drain any microtasks triggered by the interval callback (fetch →
      // pending promise creation).
      await new Promise<void>((r) => setImmediate(r));
    },
    getDot: (service: string) => dots[service] ?? null,
    getBanner: () => bannerElement,
    getDismissButton: () => bannerElement?.querySelector("#status-banner-dismiss") ?? null,
    respondWith: async (health) => {
      if (!pendingResolve) return;
      const body = JSON.stringify(health);
      const response = new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      const resolveFn = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      resolveFn(response);
      // Drain microtasks across Response.json() rounds. setImmediate is NOT
      // faked by vitest's fakeTimers.toFake list, so it reliably yields after
      // all pending microtasks from the fetch/.then chain have settled.
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));
    },
    failPoll: async (error = new Error("network")) => {
      if (!pendingReject) return;
      const rejectFn = pendingReject;
      pendingResolve = null;
      pendingReject = null;
      rejectFn(error);
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));
    },
    respondWith500: async () => {
      if (!pendingResolve) return;
      const response = new Response(JSON.stringify({ error: "oops" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
      const resolveFn = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      resolveFn(response);
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));
    },
  };

  return sandbox;
}

/** Build a /health response from a HealthStatus plus overall status. */
export function healthResponse(
  status: "ok" | "degraded",
  services: HealthStatus,
  uptime = 42,
): { status: "ok" | "degraded"; services: HealthStatus; uptime: number } {
  return { status, services, uptime };
}
