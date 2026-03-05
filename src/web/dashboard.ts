import { Hono } from "hono";
import type { SSEBroadcaster, SSEEvent } from "./sse.js";
import { renderLayout } from "./layout.js";
import {
  getRecentEntries,
  getDashboardStats,
  getLatestDigest,
  insertEntry,
} from "./dashboard-queries.js";
import { classifyText, assembleContext } from "../classify.js";
import { embedEntry } from "../embed.js";
import { resolveConfigValue } from "../config.js";
import type postgres from "postgres";

type Sql = postgres.Sql;

function parseCronHour(cron: string | undefined): string {
  if (!cron) return "7:00";
  const parts = cron.split(/\s+/);
  const minute = parseInt(parts[0] ?? "0", 10);
  const hour = parseInt(parts[1] ?? "7", 10);
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function dateGroupLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const diffDays = Math.floor(
    (today.getTime() - entryDate.getTime()) / 86400000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return entryDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function categoryBadgeClass(category: string | null): string {
  if (!category) return "badge-unclassified";
  const map: Record<string, string> = {
    people: "badge-people",
    projects: "badge-projects",
    tasks: "badge-tasks",
    ideas: "badge-ideas",
    reference: "badge-reference",
  };
  return map[category] ?? "badge-unclassified";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  let html = "";
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (inList) { html += "</ul>"; inList = false; }
      html += "<br>";
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { html += "</ul>"; inList = false; }
      const level = headingMatch[1]!.length;
      const sizes = ["22px", "18px", "16px"];
      html += `<h${level + 1} style="font-family:'Lora',serif;font-size:${sizes[level - 1]};font-weight:600;margin:16px 0 8px;">${inlineMarkdown(escapeHtml(headingMatch[2]!))}</h${level + 1}>`;
      continue;
    }

    // Blockquotes
    if (trimmed.startsWith("> ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<blockquote style="border-left:3px solid #C2705B;padding-left:12px;margin:8px 0;color:#7A746D;font-style:italic;">${inlineMarkdown(escapeHtml(trimmed.slice(2)))}</blockquote>`;
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) { html += "<ul style='margin:8px 0;padding-left:20px;'>"; inList = true; }
      html += `<li>${inlineMarkdown(escapeHtml(trimmed.replace(/^[-*]\s+/, "")))}</li>`;
      continue;
    }

    if (inList) { html += "</ul>"; inList = false; }
    html += `<p style="margin:4px 0;">${inlineMarkdown(escapeHtml(trimmed))}</p>`;
  }

  if (inList) html += "</ul>";
  return html;
}

function inlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code style="font-family:\'IBM Plex Mono\',monospace;font-size:14px;background:rgba(0,0,0,0.05);padding:1px 4px;border-radius:3px;">$1</code>');
}

function renderDigest(
  digest: { content: string; created_at: Date } | null,
  cronTime: string,
): string {
  const today = new Date();
  const dateLine = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  let digestHtml: string;
  if (digest) {
    digestHtml = `<div data-digest style="font-family:'Source Sans 3',sans-serif;line-height:1.7;">
      ${renderMarkdown(digest.content)}
    </div>`;
  } else {
    digestHtml = `<p style="text-align:center;font-style:italic;color:#7A746D;">
      No digest yet &mdash; your first one arrives tomorrow at ${escapeHtml(cronTime)}
    </p>`;
  }

  return `
    <div style="text-align:center;margin-top:48px;">
      <span style="font-family:'Lora',serif;font-style:italic;color:#7A746D;font-size:15px;">
        ${escapeHtml(dateLine)}
      </span>
    </div>
    <div style="margin-top:24px;">
      ${digestHtml}
    </div>
  `;
}

function renderStats(stats: {
  entriesThisWeek: number;
  openTasks: number;
  stalledProjects: number;
}): string {
  const items = [
    { value: stats.entriesThisWeek, label: "Entries this week" },
    { value: stats.openTasks, label: "Open tasks" },
    { value: stats.stalledProjects, label: "Stalled projects" },
  ];

  const statCards = items
    .map(
      (s) => `
      <div class="stat-card" style="text-align:center;flex:1;">
        <div class="stat-number">${s.value}</div>
        <div class="stat-label">${s.label}</div>
      </div>
    `,
    )
    .join("");

  return `<div style="display:flex;gap:16px;">${statCards}</div>`;
}

function renderEntries(
  entries: Array<{
    id: string;
    name: string;
    category: string | null;
    created_at: Date;
  }>,
): string {
  if (entries.length === 0) {
    return `
      <div data-entries>
        <p data-empty style="text-align:center;font-style:italic;color:#7A746D;">
          No entries yet. Capture your first thought above or send a message via Telegram.
        </p>
      </div>
    `;
  }

  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const label = dateGroupLabel(entry.created_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }

  let html = '<div data-entries>';
  for (const [label, groupEntries] of groups) {
    html += `<div style="margin-bottom:24px;">
      <h3 style="font-family:'Source Sans 3',sans-serif;font-size:13px;color:#7A746D;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">${escapeHtml(label)}</h3>`;

    for (const entry of groupEntries) {
      const badgeLabel = entry.category ?? "unclassified";
      const badgeClass = categoryBadgeClass(entry.category);
      html += `
        <div data-entry-id="${escapeHtml(entry.id)}" style="display:flex;align-items:center;gap:12px;padding:8px 0;">
          <span class="category-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
          <a href="/entry/${escapeHtml(entry.id)}" class="entry-link" style="flex:1;">${escapeHtml(entry.name)}</a>
          <span class="entry-time">${relativeTime(entry.created_at)}</span>
        </div>`;
    }

    html += "</div>";
  }

  html += `</div>
  <div style="text-align:center;margin-top:16px;">
    <a href="/browse" class="text-accent" style="font-size:14px;text-decoration:none;">View all &rarr;</a>
  </div>`;

  return html;
}

function renderCapture(): string {
  return `
    <form id="capture-form" style="position:relative;">
      <input type="text" name="text" id="capture-input"
        placeholder="What's on your mind?"
        autocomplete="off"
        style="width:100%;padding:12px 0;font-family:'Source Sans 3',sans-serif;font-size:16px;
               background:transparent;border:none;border-bottom:2px solid #E8E4DF;
               outline:none;color:#2D2A26;font-style:italic;transition:border-color 0.2s;"
        onfocus="this.style.borderBottomColor='#C2705B';this.style.fontStyle='normal'"
        onblur="if(!this.value)this.style.fontStyle='italic';this.style.borderBottomColor='#E8E4DF'">
      <span style="position:absolute;right:0;top:12px;color:#7A746D;opacity:0.5;font-size:14px;">&#9166;</span>
    </form>
    <div id="capture-feedback" style="margin-top:8px;font-size:14px;min-height:20px;"></div>
  `;
}

function renderClientScript(): string {
  return `
<script>
(function() {
  // Quick capture
  var form = document.getElementById('capture-form');
  var input = document.getElementById('capture-input');
  var feedback = document.getElementById('capture-feedback');

  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      input.placeholder = 'Capturing...';
      fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        input.value = '';
        input.disabled = false;
        input.placeholder = "What's on your mind?";
        if (res.ok) {
          var cat = res.data.category || 'unclassified';
          var conf = res.data.confidence ? Math.round(res.data.confidence * 100) + '%' : '';
          feedback.innerHTML = '<span style="color:#5BA67A;">Captured as <strong>' + cat + '</strong>: ' + (res.data.name || '') + (conf ? ' (' + conf + ')' : '') + '</span>';
          setTimeout(function() { feedback.innerHTML = ''; }, 3000);
        }
      })
      .catch(function() {
        input.disabled = false;
        input.placeholder = "What's on your mind?";
        feedback.innerHTML = '<span style="color:#C2705B;">Capture failed — try again</span>';
        setTimeout(function() { feedback.innerHTML = ''; }, 5000);
      });
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); form.dispatchEvent(new Event('submit')); }
    });
  }

  // SSE live updates
  if (typeof EventSource !== 'undefined') {
    var es = new EventSource('/api/events');

    function badgeHtml(cat) {
      var c = cat || 'unclassified';
      var cls = {people:'badge-people',projects:'badge-projects',tasks:'badge-tasks',ideas:'badge-ideas',reference:'badge-reference'}[c] || 'badge-unclassified';
      return '<span class="category-badge ' + cls + '">' + c + '</span>';
    }

    function entryRowHtml(d) {
      return '<div data-entry-id="' + d.id + '" style="display:flex;align-items:center;gap:12px;padding:8px 0;opacity:0;transition:opacity 0.3s;">'
        + badgeHtml(d.category)
        + '<a href="/entry/' + d.id + '" class="entry-link" style="flex:1;">' + (d.name || 'Untitled') + '</a>'
        + '<span class="entry-time">just now</span></div>';
    }

    es.addEventListener('entry:created', function(e) {
      try {
        var d = JSON.parse(e.data);
        var list = document.querySelector('[data-entries]');
        if (!list) return;
        var empty = list.querySelector('[data-empty]');
        if (empty) empty.remove();
        var row = document.createElement('div');
        row.innerHTML = entryRowHtml(d);
        var el = row.firstElementChild;
        var firstGroup = list.firstElementChild;
        if (firstGroup) firstGroup.insertAdjacentElement('afterbegin', el);
        else list.appendChild(el);
        requestAnimationFrame(function() { el.style.opacity = '1'; });
      } catch(err) {}
    });

    es.addEventListener('entry:updated', function(e) {
      try {
        var d = JSON.parse(e.data);
        var row = document.querySelector('[data-entry-id="' + d.id + '"]');
        if (!row) return;
        row.style.background = 'rgba(194,112,91,0.05)';
        var link = row.querySelector('.entry-link');
        if (link && d.name) link.textContent = d.name;
        var badge = row.querySelector('.category-badge');
        if (badge) { badge.className = 'category-badge ' + ({people:'badge-people',projects:'badge-projects',tasks:'badge-tasks',ideas:'badge-ideas',reference:'badge-reference'}[d.category] || 'badge-unclassified'); badge.textContent = d.category || 'unclassified'; }
        setTimeout(function() { row.style.background = 'transparent'; }, 500);
      } catch(err) {}
    });

    es.addEventListener('entry:deleted', function(e) {
      try {
        var d = JSON.parse(e.data);
        var row = document.querySelector('[data-entry-id="' + d.id + '"]');
        if (!row) return;
        row.style.opacity = '0';
        row.style.maxHeight = row.offsetHeight + 'px';
        row.style.transition = 'opacity 0.3s, max-height 0.3s';
        setTimeout(function() { row.style.maxHeight = '0'; row.style.overflow = 'hidden'; row.style.padding = '0'; }, 10);
        setTimeout(function() { row.remove(); }, 350);
      } catch(err) {}
    });

    es.addEventListener('digest:updated', function(e) {
      try {
        var d = JSON.parse(e.data);
        var digestEl = document.querySelector('[data-digest]');
        if (digestEl && d.content) {
          digestEl.style.background = 'rgba(194,112,91,0.05)';
          digestEl.innerHTML = d.content.replace(/\\n/g, '<br>');
          setTimeout(function() { digestEl.style.background = 'transparent'; }, 500);
        }
      } catch(err) {}
    });
  }
})();
</script>`;
}

export function createDashboardRoutes(
  sql: Sql,
  broadcaster: SSEBroadcaster,
): Hono {
  const app = new Hono();

  // GET / — Dashboard page
  app.get("/", async (c) => {
    const [rawEntries, rawStats, digest, cronValue] = await Promise.all([
      getRecentEntries(sql, 5),
      getDashboardStats(sql),
      getLatestDigest(sql),
      resolveConfigValue("digest_daily_cron", sql),
    ]);

    const entries = rawEntries ?? [];
    const stats = rawStats ?? {
      entriesThisWeek: 0,
      openTasks: 0,
      stalledProjects: 0,
    };
    const cronTime = parseCronHour(cronValue);

    const content = `
      ${renderDigest(digest ?? null, cronTime)}
      <hr class="section-divider">
      ${renderCapture()}
      <hr class="section-divider">
      ${renderStats(stats)}
      <hr class="section-divider">
      <div>
        <h2 class="heading-serif" style="margin-bottom:16px;">Recent</h2>
        ${renderEntries(entries)}
      </div>
      ${renderClientScript()}
    `;

    return c.html(renderLayout("Dashboard", content, "/"));
  });

  // POST /api/capture — Quick capture
  app.post("/api/capture", async (c) => {
    const body = await c.req.json<{ text: string }>();
    const text = body.text;

    let category: string | null = null;
    let name: string | null = null;
    let confidence: number | null = null;
    let fields: Record<string, unknown> = {};
    let tags: string[] = [];
    let content: string | null = text;

    // Gather context (best-effort — don't block classification if this fails)
    let contextEntries: Array<{ name: string; category: string | null; content: string | null }> = [];
    try {
      contextEntries = await assembleContext(sql, text);
    } catch {
      // Context unavailable — classify without it
    }

    try {
      const result = await classifyText(text, { contextEntries });
      if (result) {
        category = result.category ?? null;
        name = result.name ?? null;
        confidence = result.confidence ?? null;
        fields = result.fields ?? {};
        tags = result.tags ?? [];
        content = result.content ?? text;
      }
    } catch {
      // Classification failed — save with null category
    }

    const entryId = await insertEntry(sql, {
      name: name ?? "Untitled",
      content,
      category,
      confidence,
      fields,
      tags,
      source: "webapp",
      source_type: "text",
    });

    // Embed asynchronously — don't block on failure
    try {
      await embedEntry(sql, entryId);
    } catch {
      // Ollama down — entry saved without embedding
    }

    broadcaster.broadcast({
      type: "entry:created",
      data: { id: entryId, name: name ?? "Untitled", category, confidence },
    });

    return c.json({ id: entryId, category, name, confidence }, 201);
  });

  // GET /api/events — SSE endpoint
  app.get("/api/events", (c) => {
    const encoder = new TextEncoder();
    let buffer = "";
    let pendingResolve: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    function writeToBuffer(data: string): void {
      buffer += data;
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r();
      }
    }

    const stream = new ReadableStream({
      start() {
        // Write retry field immediately to buffer
        writeToBuffer("retry: 5000\n\n");

        // Subscribe to broadcaster events
        unsubscribe = broadcaster.subscribe((event: SSEEvent) => {
          if (cancelled) return;
          const data = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
          writeToBuffer(data);
        });
      },
      pull(controller) {
        if (cancelled) {
          controller.close();
          return;
        }
        if (buffer) {
          controller.enqueue(encoder.encode(buffer));
          buffer = "";
          return;
        }
        // Wait for data to arrive
        return new Promise<void>((resolve) => {
          pendingResolve = resolve;
        });
      },
      cancel() {
        cancelled = true;
        if (unsubscribe) unsubscribe();
        if (pendingResolve) {
          const r = pendingResolve;
          pendingResolve = null;
          r();
        }
      },
    }, { highWaterMark: 0 });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}
