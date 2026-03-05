export function renderLayout(
  title: string,
  content: string,
  activePage = "/",
): string {
  const navItems = [
    { href: "/", label: "Cortex", isBrand: true },
    { href: "/browse", label: "Browse" },
    { href: "/new", label: "New" },
    { href: "/settings", label: "\u2699" },
  ];

  const navLinks = navItems
    .map((item) => {
      if (item.isBrand) {
        return `<a href="/" style="font-family:'Lora',serif;font-size:20px;font-weight:600;color:#2D2A26;text-decoration:none;">Cortex</a>`;
      }
      const isActive = activePage === item.href;
      const activeStyle = isActive
        ? "color:#C2705B;border-bottom:2px solid #C2705B;padding-bottom:2px;"
        : "color:#7A746D;";
      return `<a href="${item.href}" style="font-family:'Source Sans 3',sans-serif;font-size:14px;text-decoration:none;${activeStyle}">${item.label}</a>`;
    })
    .join("");

  const logoutBtn = `<form method="POST" action="/logout" style="display:inline;margin:0;">
    <button type="submit" style="font-family:'Source Sans 3',sans-serif;font-size:14px;color:#7A746D;background:none;border:none;cursor:pointer;">Log out</button>
  </form>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Cortex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Source+Sans+3:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #FAF8F5;
      color: #2D2A26;
      font-family: 'Source Sans 3', sans-serif;
      font-size: 16px;
      line-height: 1.7;
      -webkit-font-smoothing: antialiased;
    }
    .navbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 640px;
      margin: 0 auto;
      padding: 12px 24px;
      border-bottom: 1px solid #E8E4DF;
      height: 48px;
    }
    .navbar-links { display: flex; align-items: center; gap: 20px; }
    .content {
      max-width: 640px;
      margin: 0 auto;
      padding: 0 24px 64px;
    }
    .section-divider {
      border: none;
      border-top: 1px solid #E8E4DF;
      margin: 48px 0;
    }
    .category-badge {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 8px;
      border-radius: 999px;
      display: inline-block;
    }
    .badge-people { background: rgba(91,127,194,0.12); color: #5B7FC2; }
    .badge-projects { background: rgba(91,166,122,0.12); color: #5BA67A; }
    .badge-tasks { background: rgba(194,153,91,0.12); color: #C2995B; }
    .badge-ideas { background: rgba(139,91,194,0.12); color: #8B5BC2; }
    .badge-reference { background: rgba(107,114,128,0.12); color: #6B7280; }
    .badge-unclassified { background: rgba(122,116,109,0.12); color: #7A746D; }
    .stat-number {
      font-family: 'Lora', serif;
      font-size: 28px;
      font-weight: 700;
      color: #2D2A26;
      transition: color 0.2s;
    }
    .stat-label {
      font-family: 'Source Sans 3', sans-serif;
      font-size: 13px;
      color: #7A746D;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .stat-card:hover .stat-number { color: #C2705B; }
    a.entry-link {
      color: #2D2A26;
      text-decoration: none;
      transition: color 0.2s, transform 0.2s;
      display: inline-block;
    }
    a.entry-link:hover { color: #C2705B; transform: translateX(2px); }
    .entry-time {
      font-size: 13px;
      color: #7A746D;
      white-space: nowrap;
    }
    .text-secondary { color: #7A746D; }
    .text-accent { color: #C2705B; }
    .heading-serif {
      font-family: 'Lora', serif;
      font-weight: 600;
      font-size: 18px;
    }
  </style>
</head>
<body>
  <nav class="navbar">
    ${navLinks}
    <div class="navbar-links">${logoutBtn}</div>
  </nav>
  <main class="content">
    ${content}
  </main>
</body>
</html>`;
}
