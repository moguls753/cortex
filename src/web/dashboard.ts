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
import {
  iconSparkles,
  iconCornerDownLeft,
  iconZap,
  iconBrain,
  iconCheckSquare,
  iconAlertTriangle,
  iconMessageSquare,
  iconGlobe,
  iconCpu,
  iconMic,
} from "./icons.js";
import type postgres from "postgres";

type Sql = postgres.Sql;

function parseCronHour(cron: string | undefined): string {
  if (!cron) return "7:00";
  const parts = cron.split(/\s+/);
  const minute = parseInt(parts[0] ?? "0", 10);
  const hour = parseInt(parts[1] ?? "7", 10);
  return `${hour}:${String(minute).padStart(2, "0")}`;
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

function categoryAbbr(category: string | null): string {
  if (!category) return "UNC";
  const map: Record<string, string> = {
    people: "PEO",
    projects: "PRO",
    tasks: "TSK",
    ideas: "IDE",
    reference: "REF",
  };
  return map[category] ?? "UNC";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function sourceIcon(source?: string, sourceType?: string): string {
  if (sourceType === "voice") return iconMic("size-3");
  if (source === "telegram") return iconMessageSquare("size-3");
  if (source === "mcp") return iconCpu("size-3");
  return iconGlobe("size-3");
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { html += "</ul>"; inList = false; }
      const level = headingMatch[1]!.length;
      const sizes = ["18px", "16px", "14px"];
      html += `<h${level + 1} style="font-size:${sizes[level - 1]};font-weight:500;margin:16px 0 8px;">${inlineMarkdown(escapeHtml(headingMatch[2]!))}</h${level + 1}>`;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<blockquote style="border-left:3px solid var(--primary);padding-left:12px;margin:8px 0;color:var(--muted-foreground);font-style:italic;">${inlineMarkdown(escapeHtml(trimmed.slice(2)))}</blockquote>`;
      continue;
    }

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
    .replace(/`(.+?)`/g, '<code style="font-size:13px;background:var(--secondary);padding:1px 4px;border-radius:3px;">$1</code>');
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

  let digestBody: string;
  if (digest) {
    const genTime = formatTime(digest.created_at);
    digestBody = `
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:20px;flex-shrink:0;">
        <div>
          <p style="font-size:14px;color:var(--muted-foreground);">${escapeHtml(dateLine)}</p>
          <h1 style="font-size:18px;font-weight:500;letter-spacing:-0.02em;margin-top:2px;text-wrap:balance;">Good morning. Here is what needs your attention.</h1>
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted-foreground);flex-shrink:0;">
          ${iconSparkles("size-3 text-primary")}
          <span>Generated ${genTime}</span>
        </div>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;" class="scrollbar-thin">
        <div data-digest style="line-height:1.7;">
          ${renderMarkdown(digest.content)}
        </div>
      </div>`;
  } else {
    digestBody = `
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:20px;flex-shrink:0;">
        <div>
          <p style="font-size:14px;color:var(--muted-foreground);">${escapeHtml(dateLine)}</p>
        </div>
      </div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;">
        <p data-digest style="text-align:center;font-style:italic;color:var(--muted-foreground);">
          No digest yet &mdash; your first one arrives tomorrow at ${escapeHtml(cronTime)}
        </p>
      </div>`;
  }

  return `<div style="flex:1;min-height:0;border-radius:6px;border:1px solid var(--border);background:var(--card);padding:24px;display:flex;flex-direction:column;">
    ${digestBody}
  </div>`;
}

function renderCapture(): string {
  return `
    <form id="capture-form" style="position:relative;">
      <div style="display:flex;align-items:center;gap:12px;border-radius:6px;border:1px solid var(--border);background:var(--secondary);padding:8px 12px;">
        <span style="color:var(--primary);font-size:14px;user-select:none;flex-shrink:0;">&gt;</span>
        <input type="text" name="text" id="capture-input"
          placeholder="capture a thought..."
          autocomplete="off"
          style="flex:1;background:transparent;border:none;outline:none;font-size:14px;color:var(--foreground);font-family:inherit;">
        <button type="submit" id="capture-submit"
          style="display:flex;align-items:center;color:var(--muted-foreground);background:none;border:none;cursor:pointer;flex-shrink:0;opacity:0.3;font-family:inherit;" class="transition-colors">
          ${iconCornerDownLeft("size-3.5")}
        </button>
      </div>
      <div id="capture-feedback" style="margin-top:4px;font-size:11px;min-height:16px;padding-left:12px;"></div>
    </form>`;
}

function renderStats(stats: {
  entriesThisWeek: number;
  totalEntries?: number;
  openTasks: number;
  stalledProjects: number;
}): string {
  const items = [
    { value: stats.entriesThisWeek, label: "Entries this week", icon: iconZap("size-3"), colorClass: "text-primary" },
    { value: stats.totalEntries ?? 0, label: "Total entries", icon: iconBrain("size-3"), colorClass: "text-foreground" },
    { value: stats.openTasks, label: "Open tasks", icon: iconCheckSquare("size-3"), colorClass: "text-accent" },
    { value: stats.stalledProjects, label: "Stalled projects", icon: iconAlertTriangle("size-3"), colorClass: "text-destructive" },
  ];

  const cards = items
    .map(
      (s) => `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:6px;border:1px solid var(--border);background:var(--card);padding:8px;">
        <span class="${s.colorClass}">${s.icon}</span>
        <span class="${s.colorClass}" style="font-size:16px;font-weight:500;line-height:1;">${s.value}</span>
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted-foreground);">${s.label}</span>
      </div>`,
    )
    .join("");

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;height:100%;">${cards}</div>`;
}

function renderEntries(
  entries: Array<{
    id: string;
    name: string;
    category: string | null;
    source?: string;
    source_type?: string;
    created_at: Date;
  }>,
): string {
  if (entries.length === 0) {
    return `
      <div data-entries>
        <p data-empty style="text-align:center;font-style:italic;color:var(--muted-foreground);padding:16px 0;">
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

  // Section header
  html += '<div style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted-foreground);margin-bottom:8px;">Recent</div>';

  for (const [label, groupEntries] of groups) {
    html += `<div style="margin-bottom:12px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted-foreground);margin-bottom:4px;">${escapeHtml(label)}</div>`;

    for (const entry of groupEntries) {
      const badgeLabel = categoryAbbr(entry.category);
      const badgeClass = categoryBadgeClass(entry.category);
      const time = relativeTime(entry.created_at);
      html += `
        <a href="/entry/${escapeHtml(entry.id)}" data-entry-id="${escapeHtml(entry.id)}" style="width:100%;display:flex;align-items:center;gap:8px;border-radius:4px;padding:4px 8px;cursor:pointer;" class="transition-colors entry-row">
          <span class="category-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
          <span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" class="entry-name">${escapeHtml(entry.name)}</span>
          <span style="color:var(--muted-foreground);flex-shrink:0;">${sourceIcon(entry.source, entry.source_type)}</span>
          <span style="font-size:10px;color:var(--muted-foreground);flex-shrink:0;">${time}</span>
        </a>`;
    }

    html += "</div>";
  }

  html += `</div>
  <div style="text-align:center;margin-top:8px;">
    <a href="/browse" style="font-size:12px;color:var(--primary);">View all &rarr;</a>
  </div>`;

  return html;
}

function renderClientScript(): string {
  return `
<script>
(function() {
  // Quick capture
  var form = document.getElementById('capture-form');
  var input = document.getElementById('capture-input');
  var feedback = document.getElementById('capture-feedback');
  var submitBtn = document.getElementById('capture-submit');

  function updateSubmitOpacity() {
    if (submitBtn) submitBtn.style.opacity = input.value.trim() ? '1' : '0.3';
  }

  if (input) {
    input.addEventListener('input', updateSubmitOpacity);
    updateSubmitOpacity();
  }

  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      if (submitBtn) submitBtn.style.opacity = '0.3';
      feedback.innerHTML = '<span style="color:var(--primary);" class="animate-pulse">classifying...</span>';
      fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        input.value = '';
        input.disabled = false;
        updateSubmitOpacity();
        if (res.ok) {
          var cat = res.data.category || 'unclassified';
          var conf = res.data.confidence ? Math.round(res.data.confidence * 100) + '%' : '';
          feedback.innerHTML = '<span style="color:var(--primary);">Captured as <strong>' + cat + '</strong>: ' + (res.data.name || '') + (conf ? ' (' + conf + ')' : '') + '</span>';
          setTimeout(function() { feedback.innerHTML = ''; }, 3000);
        }
      })
      .catch(function() {
        input.disabled = false;
        updateSubmitOpacity();
        feedback.innerHTML = '<span style="color:var(--destructive);">Capture failed — try again</span>';
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
      var abbr = {people:'PEO',projects:'PRO',tasks:'TSK',ideas:'IDE',reference:'REF'}[c] || 'UNC';
      var cls = {people:'badge-people',projects:'badge-projects',tasks:'badge-tasks',ideas:'badge-ideas',reference:'badge-reference'}[c] || 'badge-unclassified';
      return '<span class="category-badge ' + cls + '">' + abbr + '</span>';
    }

    function entryRowHtml(d) {
      return '<a href="/entry/' + d.id + '" data-entry-id="' + d.id + '" style="width:100%;display:flex;align-items:center;gap:8px;border-radius:4px;padding:4px 8px;cursor:pointer;opacity:0;transition:opacity 0.3s;" class="transition-colors entry-row">'
        + badgeHtml(d.category)
        + '<span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" class="entry-name">' + (d.name || 'Untitled') + '</span>'
        + '<span style="font-size:10px;color:var(--muted-foreground);flex-shrink:0;">just now</span></a>';
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
        row.style.background = 'var(--secondary)';
        var link = row.querySelector('.entry-name');
        if (link && d.name) link.textContent = d.name;
        var badge = row.querySelector('.category-badge');
        if (badge) {
          var abbr = {people:'PEO',projects:'PRO',tasks:'TSK',ideas:'IDE',reference:'REF'}[d.category] || 'UNC';
          badge.className = 'category-badge ' + ({people:'badge-people',projects:'badge-projects',tasks:'badge-tasks',ideas:'badge-ideas',reference:'badge-reference'}[d.category] || 'badge-unclassified');
          badge.textContent = abbr;
        }
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
          digestEl.style.background = 'var(--secondary)';
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
      <!-- Digest hero -->
      ${renderDigest(digest ?? null, cronTime)}

      <!-- Secondary row: capture + stats + recent -->
      <div style="flex-shrink:0;display:flex;flex-direction:column;gap:12px;">
        ${renderCapture()}
        <div style="display:grid;grid-template-columns:4fr 8fr;gap:12px;">
          <div>${renderStats(stats)}</div>
          <div style="border-radius:6px;border:1px solid var(--border);background:var(--card);padding:12px 16px;max-height:144px;overflow-y:auto;" class="scrollbar-thin">
            ${renderEntries(entries)}
          </div>
        </div>
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
        writeToBuffer("retry: 5000\n\n");

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
