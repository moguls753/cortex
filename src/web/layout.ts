import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  iconBrain,
  iconFolderOpen,
  iconTrash2,
  iconSettings,
  iconSun,
  iconMoon,
  iconLogOut,
  iconX,
} from "./icons.js";
import { escapeHtml } from "./shared.js";
import type { HealthStatus, ServiceStatus } from "./service-checkers.js";

// ─── Client-side polling script ─────────────────────────────────────
//
// Loaded at module init time from system-status-client.src.js (co-located with
// this module). In dev: src/web/. In production: dist/web/ (copied by build).
// The same file is exercised by tests/helpers/status-client-sandbox.ts so the
// test bytes and the served bytes are always identical — no drift possible.
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATUS_CLIENT_SCRIPT = readFileSync(
  resolve(__dirname, "system-status-client.src.js"),
  "utf8",
);

// ─── Service key ordering ──────────────────────────────────────────
// Footer and banner iterate this list. Telegram is conditional on
// healthStatus — when the checker returns null we omit its dot and banner line.
const SERVICE_ORDER = ["postgres", "ollama", "whisper", "telegram"] as const;
type ServiceKey = (typeof SERVICE_ORDER)[number];

// ─── Footer indicator rendering ────────────────────────────────────

const READY_DOT_CLASS = "size-1.5 rounded-full bg-primary animate-pulse";
const NOT_READY_DOT_CLASS = "size-1.5 rounded-full bg-destructive";

function renderFooterDot(service: ServiceKey, status: ServiceStatus): string {
  const dotClass = status.ready ? READY_DOT_CLASS : NOT_READY_DOT_CLASS;
  return `<span class="flex items-center gap-1"><span data-status-dot="${service}" id="status-dot-${service}" class="${dotClass}"></span> ${service}</span>`;
}

function renderFooter(healthStatus: HealthStatus | undefined): string {
  // When no health status is available yet (should not happen in production
  // because route handlers call getServiceStatus first), render a footer
  // with indicators defaulting to not-ready so the client script can flip
  // them on first poll without a "green flash".
  const status: HealthStatus = healthStatus ?? {
    postgres: { ready: false, detail: null },
    ollama: { ready: false, detail: null },
    whisper: { ready: false, detail: null },
  };

  const dots = SERVICE_ORDER
    .filter((key): key is ServiceKey =>
      key === "telegram" ? status.telegram !== undefined : true,
    )
    .map((key) => {
      const entry = (status as Record<string, ServiceStatus | undefined>)[key];
      return renderFooterDot(key, entry ?? { ready: false, detail: null });
    })
    .join("");

  return `<footer data-status-footer="true" class="flex items-center justify-between text-[10px] text-muted-foreground shrink-0">
    <div class="flex items-center gap-3">
      ${dots}
    </div>
    <div class="flex items-center gap-3">
      <span>SSE connected</span>
    </div>
  </footer>`;
}

// ─── Banner rendering ──────────────────────────────────────────────

function collectNotReady(
  healthStatus: HealthStatus,
): Array<{ key: ServiceKey; detail: string }> {
  const out: Array<{ key: ServiceKey; detail: string }> = [];
  for (const key of SERVICE_ORDER) {
    if (key === "telegram" && healthStatus.telegram === undefined) continue;
    const entry = (healthStatus as Record<string, ServiceStatus | undefined>)[
      key
    ];
    if (entry && !entry.ready) {
      out.push({
        key,
        detail: entry.detail ?? "Not ready",
      });
    }
  }
  return out;
}

function renderBanner(healthStatus: HealthStatus | undefined): string {
  if (!healthStatus) return "";
  const notReady = collectNotReady(healthStatus);
  if (notReady.length === 0) return "";

  const countLabel =
    notReady.length === 1 ? "(1 service)" : `(${notReady.length} services)`;

  const rows = notReady
    .map(
      ({ key, detail }) => `
      <div class="flex gap-2 items-baseline">
        <span class="text-accent/60 select-none shrink-0" aria-hidden="true">&gt;</span>
        <div class="flex-1 min-w-0">
          <span class="text-foreground font-medium">${escapeHtml(key)}</span>
          <span class="text-muted-foreground"> ${escapeHtml(detail)}</span>
        </div>
      </div>`,
    )
    .join("");

  return `<aside
    data-status-banner="true"
    id="status-banner"
    class="relative rounded-md border border-accent/40 border-l-[3px] border-l-accent bg-accent/[0.04] pl-4 pr-10 py-3 shrink-0"
  >
    <button
      type="button"
      id="status-banner-dismiss"
      data-status-banner-dismiss="true"
      class="absolute top-2 right-2 size-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      aria-label="Dismiss system notice"
    >
      ${iconX("size-3.5")}
    </button>
    <div class="flex items-center gap-2 mb-2">
      <span class="size-1.5 rounded-full bg-accent animate-pulse shrink-0" aria-hidden="true"></span>
      <span class="text-[10px] uppercase tracking-widest text-accent font-medium">cortex &middot; warming up</span>
      <span class="text-[10px] text-muted-foreground">${countLabel}</span>
    </div>
    <div class="space-y-1 text-[12.5px] leading-snug">
      ${rows}
    </div>
  </aside>`;
}

// ─── Navigation helper ─────────────────────────────────────────────

function navItem(
  href: string,
  iconHtml: string,
  label: string,
  active: boolean,
): string {
  const activeCls = active ? "text-foreground bg-secondary" : "";
  return `<a href="${href}" class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ${activeCls}" title="${label}">${iconHtml}<span class="hidden sm:inline">${label}</span></a>`;
}

// ─── Main entry point ──────────────────────────────────────────────

export function renderLayout(
  title: string,
  content: string,
  activePage = "/",
  healthStatus?: HealthStatus,
): string {
  const nav = [
    { href: "/browse", icon: iconFolderOpen("size-3.5"), label: "Browse" },
    { href: "/trash", icon: iconTrash2("size-3.5"), label: "Trash" },
    { href: "/settings", icon: iconSettings("size-3.5"), label: "Settings" },
  ];

  const navHtml = nav
    .map((n) => navItem(n.href, n.icon, n.label, activePage === n.href))
    .join("");

  const banner = renderBanner(healthStatus);
  const footer = renderFooter(healthStatus);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Cortex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="icon" type="image/svg+xml" href="/public/favicon.svg">
  <link rel="stylesheet" href="/public/style.css">
  <script>
    (function(){
      try {
        var t = localStorage.getItem("cortex-theme");
        var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (t === "dark" || (!t && prefersDark)) {
          document.documentElement.classList.add("dark");
        }
      } catch(e) {}
    })();
  </script>
</head>
<body class="font-sans antialiased">
  <div class="h-dvh flex flex-col px-6 py-4 gap-4 max-w-5xl mx-auto w-full">

    <!-- Header -->
    <header class="flex items-center justify-between shrink-0">
      <div class="flex items-center gap-2.5">
        ${iconBrain("size-4 text-primary")}
        <a href="/" class="text-sm font-medium text-foreground tracking-tight hover:text-primary transition-colors">cortex</a>
        <span class="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">v0.1</span>
      </div>
      <nav class="flex items-center gap-1">
        ${navHtml}
        <button id="theme-toggle" class="flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" aria-label="Toggle theme">
          <span id="theme-icon-sun" class="hidden">${iconSun("size-3.5")}</span>
          <span id="theme-icon-moon">${iconMoon("size-3.5")}</span>
        </button>
        <form method="POST" action="/logout" class="inline">
          <button type="submit" class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Log out">
            ${iconLogOut("size-3.5")}
            <span class="hidden sm:inline">Log out</span>
          </button>
        </form>
      </nav>
    </header>

    ${banner}

    <!-- Content -->
    ${content}

    ${footer}

  </div>

  <script>
    (function() {
      var toggle = document.getElementById('theme-toggle');
      var sunIcon = document.getElementById('theme-icon-sun');
      var moonIcon = document.getElementById('theme-icon-moon');
      function updateIcons() {
        var isDark = document.documentElement.classList.contains('dark');
        sunIcon.classList.toggle('hidden', !isDark);
        moonIcon.classList.toggle('hidden', isDark);
      }
      updateIcons();
      if (toggle) {
        toggle.addEventListener('click', function() {
          var isDark = document.documentElement.classList.toggle('dark');
          localStorage.setItem('cortex-theme', isDark ? 'dark' : 'light');
          updateIcons();
        });
      }
    })();
  </script>
  <script>${STATUS_CLIENT_SCRIPT}</script>
</body>
</html>`;
}
