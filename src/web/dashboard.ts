import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
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
import { escapeHtml } from "./shared.js";

type Sql = postgres.Sql;

function parseCronHour(cron: string | undefined): string {
  if (!cron) return "7:00";
  const parts = cron.split(/\s+/);
  const minute = parseInt(parts[0] ?? "0", 10);
  const hour = parseInt(parts[1] ?? "7", 10);
  return `${hour}:${String(minute).padStart(2, "0")}`;
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
  if (!category) return "—";
  const map: Record<string, string> = {
    people: "People",
    projects: "Project",
    tasks: "Task",
    ideas: "Idea",
    reference: "Ref",
  };
  return map[category] ?? "—";
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
  if (sourceType === "voice") return iconMic("size-3 text-muted-foreground");
  if (source === "telegram") return iconMessageSquare("size-3 text-muted-foreground");
  if (source === "mcp") return iconCpu("size-3 text-muted-foreground");
  return iconGlobe("size-3 text-muted-foreground");
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
      const tag = `h${level + 1}`;
      html += `<${tag} class="text-sm font-medium mt-4 mb-2">${inlineMarkdown(escapeHtml(headingMatch[2]!))}</${tag}>`;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<blockquote class="border-l-[3px] border-primary pl-3 my-2 text-muted-foreground italic">${inlineMarkdown(escapeHtml(trimmed.slice(2)))}</blockquote>`;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) { html += '<ul class="my-2 pl-5 list-disc">'; inList = true; }
      html += `<li>${inlineMarkdown(escapeHtml(trimmed.replace(/^[-*]\s+/, "")))}</li>`;
      continue;
    }

    if (inList) { html += "</ul>"; inList = false; }
    html += `<p class="my-1">${inlineMarkdown(escapeHtml(trimmed))}</p>`;
  }

  if (inList) html += "</ul>";
  return html;
}

function inlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="text-[13px] bg-secondary px-1 py-px rounded">$1</code>');
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
      <div class="flex items-baseline justify-between mb-5 shrink-0">
        <div>
          <p class="text-sm text-muted-foreground">${escapeHtml(dateLine)}</p>
          <h1 class="text-lg font-medium text-foreground mt-0.5 tracking-tight text-balance">Good morning. Here is what needs your attention.</h1>
        </div>
        <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0">
          ${iconSparkles("size-3 text-primary")}
          <span>Generated ${genTime}</span>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div data-digest class="leading-relaxed">
          ${renderMarkdown(digest.content)}
        </div>
      </div>`;
  } else {
    digestBody = `
      <div class="flex items-baseline justify-between mb-5 shrink-0">
        <div>
          <p class="text-sm text-muted-foreground">${escapeHtml(dateLine)}</p>
        </div>
      </div>
      <div class="flex-1 flex items-center justify-center">
        <p data-digest class="text-center italic text-muted-foreground">
          No digest yet &mdash; your first one arrives tomorrow at ${escapeHtml(cronTime)}
        </p>
      </div>`;
  }

  return `<div class="min-h-[420px] max-h-[60vh] rounded-md border border-border bg-card p-6 flex flex-col">
    ${digestBody}
  </div>`;
}

function renderCapture(): string {
  return `
    <form id="capture-form" class="relative">
      <div class="flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-colors">
        <span class="text-primary text-sm select-none shrink-0">&gt;</span>
        <input type="text" name="text" id="capture-input"
          placeholder="capture a thought..."
          autocomplete="off"
          class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50 font-sans">
        <button type="submit" id="capture-submit"
          class="flex items-center text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors shrink-0">
          ${iconCornerDownLeft("size-3.5")}
        </button>
      </div>
      <div id="capture-feedback" class="text-[11px] pl-3 min-h-4"></div>
    </form>`;
}

function renderStats(stats: {
  entriesThisWeek: number;
  totalEntries?: number;
  openTasks: number;
  stalledProjects: number;
}): string {
  const items = [
    { value: stats.entriesThisWeek, label: "Entries this week", icon: iconZap("size-3"), colorCls: "text-primary", statKey: "entries-week" },
    { value: stats.totalEntries ?? 0, label: "Total entries", icon: iconBrain("size-3"), colorCls: "text-foreground", statKey: "entries-total" },
    { value: stats.openTasks, label: "Open tasks", icon: iconCheckSquare("size-3"), colorCls: "text-accent", statKey: "open-tasks" },
    { value: stats.stalledProjects, label: "Stalled projects", icon: iconAlertTriangle("size-3"), colorCls: "text-destructive", statKey: "stalled" },
  ];

  const cards = items
    .map(
      (s) => `
      <div class="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-card px-2 py-2">
        <span class="${s.colorCls}">${s.icon}</span>
        <span data-stat="${s.statKey}" class="${s.colorCls} text-base font-medium leading-none">${s.value}</span>
        <span class="text-[9px] uppercase tracking-wider text-muted-foreground">${s.label}</span>
      </div>`,
    )
    .join("");

  return `<div class="grid grid-cols-2 gap-2 h-full">${cards}</div>`;
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
        <p data-empty class="text-center italic text-muted-foreground py-4">
          No entries yet. Capture your first thought above or send a message via Telegram.
        </p>
      </div>
    `;
  }

  let html = '<div data-entries><div data-entry-list class="space-y-0.5">';

  for (const entry of entries) {
    const badgeLabel = categoryAbbr(entry.category);
    const badgeClass = categoryBadgeClass(entry.category);
    const time = relativeTime(entry.created_at);
    html += `
      <a href="/entry/${escapeHtml(entry.id)}" data-entry-id="${escapeHtml(entry.id)}" class="w-full flex items-center gap-2 rounded px-2 py-1 hover:bg-secondary transition-colors group">
        <span class="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded font-medium shrink-0 ${badgeClass}">${escapeHtml(badgeLabel)}</span>
        <span class="text-xs text-foreground truncate flex-1 group-hover:text-primary transition-colors entry-name">${escapeHtml(entry.name)}</span>
        <span class="shrink-0">${sourceIcon(entry.source, entry.source_type)}</span>
        <span class="text-[10px] text-muted-foreground shrink-0">${time}</span>
      </a>`;
  }

  html += `</div></div>`;

  return html;
}

function renderClientScript(): string {
  return `
<script>
(function() {
  var form = document.getElementById('capture-form');
  var input = document.getElementById('capture-input');
  var feedback = document.getElementById('capture-feedback');
  var submitBtn = document.getElementById('capture-submit');

  function updateSubmit() {
    if (submitBtn) submitBtn.disabled = !input.value.trim();
  }

  if (input) {
    input.addEventListener('input', updateSubmit);
    updateSubmit();
  }

  function doCapture() {
    var text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    feedback.innerHTML = '<span class="text-primary animate-pulse">classifying...</span>';
    fetch('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      input.value = '';
      input.disabled = false;
      updateSubmit();
      if (res.ok) {
        var cat = res.data.category || 'unclassified';
        var conf = res.data.confidence ? Math.round(res.data.confidence * 100) + '%' : '';
        feedback.innerHTML = '<span class="text-primary">Captured as <strong>' + cat + '</strong>: ' + (res.data.name || '') + (conf ? ' (' + conf + ')' : '') + '</span>';
        setTimeout(function() { feedback.innerHTML = ''; }, 3000);
      }
    })
    .catch(function() {
      input.disabled = false;
      updateSubmit();
      feedback.innerHTML = '<span class="text-destructive">Capture failed — try again</span>';
      setTimeout(function() { feedback.innerHTML = ''; }, 8000);
    });
  }

  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      doCapture();
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); doCapture(); }
    });
  }

  if (typeof EventSource !== 'undefined') {
    var es = new EventSource('/api/events');

    function badgeHtml(cat) {
      var c = cat || 'unclassified';
      var abbr = {people:'PEO',projects:'PRO',tasks:'TSK',ideas:'IDE',reference:'REF'}[c] || 'UNC';
      var cls = {people:'badge-people',projects:'badge-projects',tasks:'badge-tasks',ideas:'badge-ideas',reference:'badge-reference'}[c] || 'badge-unclassified';
      return '<span class="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded font-medium shrink-0 ' + cls + '">' + abbr + '</span>';
    }

    function esc(s) {
      var d = document.createElement('div');
      d.appendChild(document.createTextNode(s));
      return d.innerHTML;
    }

    function entryRowHtml(d) {
      return '<a href="/entry/' + esc(d.id) + '" data-entry-id="' + esc(d.id) + '" class="w-full flex items-center gap-2 rounded px-2 py-1 hover:bg-secondary transition-colors group opacity-0 transition-opacity duration-300">'
        + badgeHtml(d.category)
        + '<span class="text-xs text-foreground truncate flex-1 group-hover:text-primary transition-colors entry-name">' + esc(d.name || 'Untitled') + '</span>'
        + '<span class="text-[10px] text-muted-foreground shrink-0">just now</span></a>';
    }

    function incrementStat(key, delta) {
      var el = document.querySelector('[data-stat="' + key + '"]');
      if (el) el.textContent = Math.max(0, parseInt(el.textContent || '0', 10) + delta);
    }

    es.addEventListener('entry:created', function(e) {
      var d;
      try { d = JSON.parse(e.data); } catch(err) { return; }
      // Update stats
      incrementStat('entries-week', 1);
      incrementStat('entries-total', 1);
      if (d.category === 'tasks') incrementStat('open-tasks', 1);
      // Update list
      try {
        var list = document.querySelector('[data-entries]');
        if (!list) return;
        var empty = list.querySelector('[data-empty]');
        if (empty) empty.remove();
        var row = document.createElement('div');
        row.innerHTML = entryRowHtml(d);
        var el = row.firstElementChild;
        var entryList = list.querySelector('[data-entry-list]');
        if (entryList) {
          entryList.insertAdjacentElement('afterbegin', el);
          while (entryList.children.length > 9) entryList.lastElementChild.remove();
        } else list.appendChild(el);
        requestAnimationFrame(function() { el.classList.remove('opacity-0'); });
      } catch(err) {}
    });

    es.addEventListener('entry:updated', function(e) {
      var d;
      try { d = JSON.parse(e.data); } catch(err) { return; }
      try {
        var row = document.querySelector('[data-entry-id="' + d.id + '"]');
        if (!row) return;
        row.classList.add('bg-secondary');
        var link = row.querySelector('.entry-name');
        if (link && d.name) link.textContent = d.name;
        var badge = row.querySelector('[class*="badge-"]');
        if (badge && d.category) {
          var oldCat = badge.classList.contains('badge-tasks') ? 'tasks' : badge.classList.contains('badge-projects') ? 'projects' : null;
          var abbr = {people:'PEO',projects:'PRO',tasks:'TSK',ideas:'IDE',reference:'REF'}[d.category] || 'UNC';
          var oldBadge = badge.className.match(/badge-\\w+/);
          if (oldBadge) badge.classList.remove(oldBadge[0]);
          var newCls = {people:'badge-people',projects:'badge-projects',tasks:'badge-tasks',ideas:'badge-ideas',reference:'badge-reference'}[d.category] || 'badge-unclassified';
          badge.classList.add(newCls);
          badge.textContent = abbr;
          if (oldCat !== d.category) {
            if (oldCat === 'tasks') incrementStat('open-tasks', -1);
            if (d.category === 'tasks') incrementStat('open-tasks', 1);
          }
        }
        setTimeout(function() { row.classList.remove('bg-secondary'); }, 500);
      } catch(err) { console.error('SSE entry:updated error', err); }
    });

    es.addEventListener('entry:deleted', function(e) {
      var d;
      try { d = JSON.parse(e.data); } catch(err) { return; }
      try {
        var row = document.querySelector('[data-entry-id="' + d.id + '"]');
        if (!row) return;
        var badge = row.querySelector('[class*="badge-"]');
        if (badge && badge.classList.contains('badge-tasks')) incrementStat('open-tasks', -1);
        incrementStat('entries-week', -1);
        incrementStat('entries-total', -1);
        row.classList.add('opacity-0');
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
          digestEl.classList.add('bg-secondary');
          digestEl.innerHTML = d.content.replace(/\\n/g, '<br>');
          setTimeout(function() { digestEl.classList.remove('bg-secondary'); }, 500);
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

  app.get("/", async (c) => {
    const [rawEntries, rawStats, digest, cronValue] = await Promise.all([
      getRecentEntries(sql, 9),
      getDashboardStats(sql),
      getLatestDigest(sql),
      resolveConfigValue("digest_daily_cron", sql),
    ]);

    const entries = rawEntries ?? [];
    const stats = rawStats ?? {
      entriesThisWeek: 0,
      totalEntries: 0,
      openTasks: 0,
      stalledProjects: 0,
    };
    const cronTime = parseCronHour(cronValue);

    const content = `
      ${renderDigest(digest ?? null, cronTime)}

      <div class="shrink-0 flex flex-col gap-3 mt-3">
        ${renderCapture()}
        <div class="grid grid-cols-12 gap-3">
          <div class="col-span-4">
            ${renderStats(stats)}
          </div>
          <div class="col-span-8 rounded-md border border-border bg-card px-4 py-3 max-h-[276px] overflow-y-auto scrollbar-thin">
            ${renderEntries(entries)}
          </div>
        </div>
      </div>

      ${renderClientScript()}
    `;

    return c.html(renderLayout("Dashboard", content, "/"));
  });

  app.post("/api/capture", async (c) => {
    const body = await c.req.json<{ text: string }>();
    const text = body.text;

    let category: string | null = null;
    let name: string | null = null;
    let confidence: number | null = null;
    let fields: Record<string, unknown> = {};
    let tags: string[] = [];
    let content: string | null = text;

    let contextEntries: Array<{ name: string; category: string | null; content: string | null }> = [];
    const outputLanguage = (await resolveConfigValue("output_language", sql)) || undefined;
    try {
      contextEntries = await assembleContext(sql, text);
    } catch {
      // Context unavailable
    }

    try {
      const result = await classifyText(text, { contextEntries, outputLanguage, sql });
      if (result) {
        category = result.category ?? null;
        name = result.name ?? null;
        confidence = result.confidence ?? null;
        fields = result.fields ?? {};
        tags = result.tags ?? [];
        content = result.content ?? text;
      }
    } catch {
      // Classification failed
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

    try {
      await embedEntry(sql, entryId);
    } catch {
      // Ollama down
    }

    return c.json({ id: entryId, category, name, confidence }, 201);
  });

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: "", retry: 5000 });

      const unsubscribe = broadcaster.subscribe((event: SSEEvent) => {
        stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        });
      });

      stream.onAbort(() => {
        unsubscribe();
      });

      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
    });
  });

  return app;
}
