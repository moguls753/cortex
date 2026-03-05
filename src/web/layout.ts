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
        return `<a href="/" class="brand">Cortex</a>`;
      }
      const isActive = activePage === item.href;
      return `<a href="${item.href}" class="nav-link${isActive ? " active" : ""}">${item.label}</a>`;
    })
    .join("");

  const logoutBtn = `<form method="POST" action="/logout" class="logout-form">
    <button type="submit" class="logout-btn">Log out</button>
  </form>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Cortex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:ital,wght@0,400;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:            #ffffff;
      --bg-off:        #f7f7f7;
      --bg-dark:       #eeeeee;
      --border:        #cccccc;
      --border-strong: #333333;
      --text:          #111111;
      --text-mid:      #444444;
      --text-muted:    #888888;
      --text-faint:    #bbbbbb;

      --font-serif:    "IBM Plex Serif", Georgia, serif;
      --font-mono:     "JetBrains Mono", "Courier New", monospace;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 14px;
      line-height: 1.7;
      -webkit-font-smoothing: antialiased;
    }

    /* — Header band — */
    .header-band {
      border-bottom: 1px solid var(--border-strong);
    }
    .navbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 640px;
      margin: 0 auto;
      padding: 14px 24px;
    }
    .navbar-left { display: flex; align-items: center; gap: 24px; }
    .navbar-right { display: flex; align-items: center; }

    .brand {
      font-family: var(--font-serif);
      font-size: 20px;
      font-weight: 600;
      color: var(--text);
      text-decoration: none;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .nav-link {
      font-family: var(--font-mono);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      text-decoration: none;
      padding-bottom: 2px;
      transition: color 0.15s;
    }
    .nav-link:hover { color: var(--text); }
    .nav-link.active {
      color: var(--text);
      border-bottom: 1px solid var(--border-strong);
    }
    .logout-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      padding: 0;
      transition: color 0.15s;
    }
    .logout-btn:hover { color: var(--text); }

    /* — Band system — */
    .band {
      width: 100%;
      padding: 0 24px;
    }
    .band-off { background: var(--bg-off); }
    .band-white { background: var(--bg); }
    .band-border { border-top: 1px solid var(--border); }
    .band-inner {
      max-width: 640px;
      margin: 0 auto;
      padding: 32px 0;
    }

    /* — Section labels — */
    .section-label {
      font-family: var(--font-serif);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      margin-bottom: 16px;
    }

    /* — Category badges — */
    .category-badge {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 8px;
      border-radius: 2px;
      display: inline-block;
    }
    .badge-people { background: rgba(91,127,194,0.12); color: #5B7FC2; }
    .badge-projects { background: rgba(91,166,122,0.12); color: #5BA67A; }
    .badge-tasks { background: rgba(194,153,91,0.12); color: #C2995B; }
    .badge-ideas { background: rgba(139,91,194,0.12); color: #8B5BC2; }
    .badge-reference { background: rgba(107,114,128,0.12); color: #6B7280; }
    .badge-unclassified { background: rgba(136,136,136,0.12); color: var(--text-muted); }

    /* — Stats — */
    .stats-grid {
      display: flex;
      gap: 0;
    }
    .stat-card {
      flex: 1;
      text-align: center;
      padding: 8px 0;
    }
    .stat-card + .stat-card {
      border-left: 1px solid var(--border);
    }
    .stat-number {
      font-family: var(--font-serif);
      font-size: 32px;
      font-weight: 700;
      color: var(--text);
      line-height: 1.2;
    }
    .stat-label {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-top: 2px;
    }

    /* — Entries — */
    a.entry-link {
      font-family: var(--font-mono);
      font-size: 14px;
      color: var(--text);
      text-decoration: none;
      transition: color 0.15s;
      flex: 1;
    }
    a.entry-link:hover { color: var(--text-mid); }
    .entry-time {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .entry-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
    }
    .entry-row + .entry-row {
      border-top: 1px solid var(--bg-dark);
    }

    /* — Date group — */
    .date-group-label {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 12px;
    }

    /* — Capture — */
    .capture-form {
      position: relative;
    }
    .capture-hint {
      position: absolute;
      right: 0;
      top: 12px;
      color: var(--text-faint);
      font-size: 14px;
    }
    .capture-input {
      width: 100%;
      padding: 12px 0;
      font-family: var(--font-mono);
      font-size: 14px;
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--border);
      outline: none;
      color: var(--text);
      transition: border-color 0.15s;
    }
    .capture-input::placeholder {
      color: var(--text-faint);
      font-style: italic;
    }
    .capture-input:focus {
      border-bottom-color: var(--border-strong);
    }

    /* — Digest — */
    .digest-date {
      font-family: var(--font-serif);
      font-style: italic;
      color: var(--text-muted);
      font-size: 15px;
    }
    .digest-content {
      font-family: var(--font-mono);
      font-size: 14px;
      line-height: 1.7;
      color: var(--text-mid);
    }
    .digest-content h2, .digest-content h3, .digest-content h4 {
      font-family: var(--font-serif);
      font-weight: 600;
      color: var(--text);
      margin: 16px 0 8px;
    }
    .digest-content h2 { font-size: 22px; }
    .digest-content h3 { font-size: 18px; }
    .digest-content h4 { font-size: 16px; }
    .digest-content p {
      margin: 4px 0;
    }
    .digest-content ul {
      margin: 8px 0;
      padding-left: 20px;
    }
    .digest-content blockquote {
      border-left: 2px solid var(--border-strong);
      padding-left: 12px;
      color: var(--text-muted);
      font-style: italic;
      margin: 8px 0;
    }
    .digest-content code {
      font-family: var(--font-mono);
      font-size: 13px;
      background: var(--bg-dark);
      padding: 1px 4px;
    }

    /* — View all link — */
    .view-all {
      font-family: var(--font-mono);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      text-decoration: none;
      transition: color 0.15s;
    }
    .view-all:hover { color: var(--text); }

    /* — Entry groups — */
    .entry-group {
      margin-bottom: 24px;
    }
    .view-all-wrap {
      text-align: center;
      margin-top: 16px;
    }

    /* — Digest header — */
    .digest-header {
      margin-bottom: 16px;
    }

    /* — Logout form — */
    .logout-form {
      display: inline;
      margin: 0;
    }

    /* — Empty state — */
    .empty-state {
      text-align: center;
      font-style: italic;
      color: var(--text-muted);
      font-size: 14px;
    }

    /* — Capture feedback — */
    .capture-feedback {
      margin-top: 8px;
      font-size: 13px;
      font-family: var(--font-mono);
      min-height: 20px;
      color: var(--text-mid);
    }

    /* — Generic text utilities — */
    .text-secondary { color: var(--text-muted); }
    .heading-serif {
      font-family: var(--font-serif);
      font-weight: 600;
      font-size: 18px;
      color: var(--text);
    }
  </style>
</head>
<body>
  <div class="header-band">
    <nav class="navbar">
      <div class="navbar-left">
        ${navLinks}
      </div>
      <div class="navbar-right">${logoutBtn}</div>
    </nav>
  </div>
  <main>
    ${content}
  </main>
</body>
</html>`;
}
