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

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function navItem(
  href: string,
  iconHtml: string,
  label: string,
  active: boolean,
): string {
  const activeCls = active ? "text-foreground bg-secondary" : "";
  return `<a href="${href}" class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ${activeCls}" title="${label}">${iconHtml}<span class="hidden sm:inline">${label}</span></a>`;
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
  <title>${escapeHtml(title)} — Cortex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
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
          <button type="submit" class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Log out">
            ${iconLogOut("size-3.5")}
            <span class="hidden sm:inline">Log out</span>
          </button>
        </form>
      </nav>
    </header>

    <!-- Content -->
    ${content}

    <!-- Status bar -->
    <footer class="flex items-center justify-between text-[10px] text-muted-foreground shrink-0">
      <div class="flex items-center gap-3">
        <span class="flex items-center gap-1"><span class="size-1.5 rounded-full bg-primary animate-pulse"></span> postgres</span>
        <span class="flex items-center gap-1"><span class="size-1.5 rounded-full bg-primary animate-pulse"></span> ollama</span>
        <span class="flex items-center gap-1"><span class="size-1.5 rounded-full bg-primary animate-pulse"></span> whisper</span>
        <span class="flex items-center gap-1"><span class="size-1.5 rounded-full bg-primary animate-pulse"></span> telegram</span>
      </div>
      <div class="flex items-center gap-3">
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
</body>
</html>`;
}
