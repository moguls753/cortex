import {
  iconBrain,
  iconSearch,
  iconFolderOpen,
  iconTrash2,
  iconSettings,
  iconSun,
  iconMoon,
  iconLogOut,
} from "./icons.js";

function navItem(
  href: string,
  iconHtml: string,
  label: string,
  active: boolean,
): string {
  const activeClass = active ? "text-foreground bg-secondary" : "";
  return `<a href="${href}" class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ${activeClass}" title="${label}">${iconHtml}<span class="hidden sm:inline">${label}</span></a>`;
}

export function renderLayout(
  title: string,
  content: string,
  activePage = "/",
): string {
  const nav = [
    { href: "/browse?q=", icon: iconSearch("size-3.5"), label: "Search" },
    { href: "/browse", icon: iconFolderOpen("size-3.5"), label: "Browse" },
    { href: "/trash", icon: iconTrash2("size-3.5"), label: "Trash" },
    { href: "/settings", icon: iconSettings("size-3.5"), label: "Settings" },
  ];

  const navHtml = nav
    .map((n) => navItem(n.href, n.icon, n.label, activePage === n.href))
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title.replace(/</g, "&lt;").replace(/>/g, "&gt;")} — Cortex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
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
  <style>
    :root {
      --background: oklch(0.97 0.005 90);
      --foreground: oklch(0.18 0.01 160);
      --card: oklch(0.99 0.003 90);
      --card-foreground: oklch(0.18 0.01 160);
      --primary: oklch(0.45 0.14 155);
      --primary-foreground: oklch(0.98 0.005 90);
      --secondary: oklch(0.93 0.008 90);
      --secondary-foreground: oklch(0.25 0.01 160);
      --muted: oklch(0.93 0.008 90);
      --muted-foreground: oklch(0.50 0.01 160);
      --accent: oklch(0.55 0.12 80);
      --accent-foreground: oklch(0.98 0.005 90);
      --destructive: oklch(0.55 0.20 25);
      --border: oklch(0.88 0.008 90);
      --input: oklch(0.93 0.008 90);
      --ring: oklch(0.45 0.14 155);
    }
    .dark {
      --background: oklch(0.10 0.005 160);
      --foreground: oklch(0.90 0.01 160);
      --card: oklch(0.13 0.005 160);
      --card-foreground: oklch(0.90 0.01 160);
      --primary: oklch(0.75 0.15 155);
      --primary-foreground: oklch(0.10 0.005 160);
      --secondary: oklch(0.18 0.005 160);
      --secondary-foreground: oklch(0.85 0.01 160);
      --muted: oklch(0.18 0.005 160);
      --muted-foreground: oklch(0.55 0.01 160);
      --accent: oklch(0.70 0.10 80);
      --accent-foreground: oklch(0.10 0.005 160);
      --destructive: oklch(0.55 0.20 25);
      --border: oklch(0.22 0.008 160);
      --input: oklch(0.18 0.005 160);
      --ring: oklch(0.75 0.15 155);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      line-height: 1.6;
      background: var(--background);
      color: var(--foreground);
      -webkit-font-smoothing: antialiased;
    }
    /* Tailwind-like utility classes (inline, no build step needed for layout) */
    .bg-background { background: var(--background); }
    .bg-card { background: var(--card); }
    .bg-secondary { background: var(--secondary); }
    .bg-muted { background: var(--muted); }
    .text-foreground { color: var(--foreground); }
    .text-card-foreground { color: var(--card-foreground); }
    .text-primary { color: var(--primary); }
    .text-primary-foreground { color: var(--primary-foreground); }
    .text-secondary-foreground { color: var(--secondary-foreground); }
    .text-muted-foreground { color: var(--muted-foreground); }
    .text-accent { color: var(--accent); }
    .text-destructive { color: var(--destructive); }
    .border-border { border-color: var(--border); }
    .bg-primary { background: var(--primary); }
    .ring-primary { --tw-ring-color: var(--primary); }

    /* Category badge colors */
    .badge-people { background: oklch(0.65 0.15 250 / 0.10); color: oklch(0.65 0.15 250); }
    .badge-projects { background: oklch(0.45 0.14 155 / 0.10); color: var(--primary); }
    .dark .badge-projects { background: oklch(0.75 0.15 155 / 0.10); }
    .badge-tasks { background: oklch(0.55 0.12 80 / 0.10); color: var(--accent); }
    .dark .badge-tasks { background: oklch(0.70 0.10 80 / 0.10); }
    .badge-ideas { background: oklch(0.65 0.20 330 / 0.10); color: oklch(0.65 0.20 330); }
    .badge-reference { background: var(--muted); color: var(--muted-foreground); }
    .badge-unclassified { background: var(--muted); color: var(--muted-foreground); }

    .category-badge {
      font-size: 9px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 1px 4px;
      border-radius: 4px;
      display: inline-block;
      white-space: nowrap;
    }

    /* Scrollbar */
    .scrollbar-thin { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
    .scrollbar-thin::-webkit-scrollbar { width: 4px; }
    .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    /* Transitions */
    .transition-colors { transition: color 0.15s, background-color 0.15s, border-color 0.15s; }

    /* Animate pulse */
    @keyframes pulse { 50% { opacity: 0.5; } }
    .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }

    a { text-decoration: none; color: inherit; }
  </style>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body class="font-sans antialiased">
  <div style="height:100dvh;display:flex;flex-direction:column;padding:16px 24px;gap:16px;max-width:1024px;margin:0 auto;width:100%;">

    <!-- Header -->
    <header style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:10px;">
        ${iconBrain("size-4 text-primary")}
        <span style="font-size:14px;font-weight:500;letter-spacing:-0.02em;color:var(--foreground);">cortex</span>
        <span style="font-size:10px;color:var(--muted-foreground);border:1px solid var(--border);border-radius:4px;padding:2px 6px;">v0.1</span>
      </div>
      <nav style="display:flex;align-items:center;gap:4px;">
        ${navHtml}
        <button id="theme-toggle" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;border:none;background:transparent;color:var(--muted-foreground);cursor:pointer;" class="transition-colors" aria-label="Toggle theme">
          <span id="theme-icon-sun" style="display:none;">${iconSun("size-3.5")}</span>
          <span id="theme-icon-moon">${iconMoon("size-3.5")}</span>
        </button>
        <form method="POST" action="/logout" style="display:inline;margin:0;">
          <button type="submit" style="display:flex;align-items:center;gap:6px;border-radius:6px;padding:6px 10px;font-size:12px;color:var(--muted-foreground);background:transparent;border:none;cursor:pointer;font-family:inherit;" class="transition-colors" title="Log out">
            ${iconLogOut("size-3.5")}
            <span class="hidden sm:inline">Log out</span>
          </button>
        </form>
      </nav>
    </header>

    <!-- Content -->
    ${content}

    <!-- Status bar -->
    <footer style="display:flex;align-items:center;justify-content:space-between;font-size:10px;color:var(--muted-foreground);flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--primary);display:inline-block;" class="animate-pulse"></span> postgres</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--primary);display:inline-block;" class="animate-pulse"></span> ollama</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--primary);display:inline-block;" class="animate-pulse"></span> whisper</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--primary);display:inline-block;" class="animate-pulse"></span> telegram</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <span>SSE connected</span>
      </div>
    </footer>

  </div>

  <script>
    (function() {
      var toggle = document.getElementById('theme-toggle');
      var sunIcon = document.getElementById('theme-icon-sun');
      var moonIcon = document.getElementById('theme-icon-moon');
      function updateIcons() {
        var isDark = document.documentElement.classList.contains('dark');
        sunIcon.style.display = isDark ? '' : 'none';
        moonIcon.style.display = isDark ? 'none' : '';
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
</body>
</html>`;
}
