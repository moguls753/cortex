import { Hono } from "hono";
import type postgres from "postgres";
import { renderLayout } from "./layout.js";
import { getServiceStatus } from "./service-checkers.js";
import { isBotRunning } from "../telegram.js";
import {
  browseEntries,
  semanticSearch,
  textSearch,
  getFilterTags,
  type BrowseFilters,
} from "./browse-queries.js";
import { generateEmbedding } from "../embed.js";
import type { EntryRow } from "./dashboard-queries.js";
import { iconSearch } from "./icons.js";
import { CATEGORIES, CATEGORY_LABELS, escapeHtml } from "./shared.js";

type Sql = postgres.Sql;

const MAX_VISIBLE_TAGS = 10;
const MAX_QUERY_LENGTH = 500;

export function categoryBadgeClass(category: string | null): string {
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

export function categoryAbbr(category: string | null): string {
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

export function relativeTime(date: Date): string {
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

export function buildUrl(
  params: { category?: string; tag?: string; q?: string; mode?: string },
  basePath = "/browse",
): string {
  const parts: string[] = [];
  if (params.category) parts.push(`category=${encodeURIComponent(params.category)}`);
  if (params.tag) parts.push(`tag=${encodeURIComponent(params.tag)}`);
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.mode) parts.push(`mode=${encodeURIComponent(params.mode)}`);
  return parts.length > 0 ? `${basePath}?${parts.join("&")}` : basePath;
}

export function renderCategoryTabs(
  activeCategory: string | undefined,
  currentTag: string | undefined,
  currentQuery: string | undefined,
  currentMode: string | undefined,
  unclassifiedCount: number,
  basePath = "/browse",
): string {
  const allActive = !activeCategory;
  const allUrl = buildUrl({ tag: currentTag, q: currentQuery, mode: currentMode }, basePath);
  let html = `<div class="flex items-center gap-1 flex-wrap">`;
  html += `<a href="${escapeHtml(allUrl)}" class="rounded-md px-2.5 py-1 text-xs transition-colors ${allActive ? "bg-primary text-primary-foreground active" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}">All</a>`;

  for (const cat of CATEGORIES) {
    const label = CATEGORY_LABELS[cat]!;
    const isActive = activeCategory === cat;
    const url = buildUrl({ category: cat, tag: currentTag, q: currentQuery, mode: currentMode }, basePath);
    html += `<a href="${escapeHtml(url)}" class="rounded-md px-2.5 py-1 text-xs transition-colors ${isActive ? "bg-primary text-primary-foreground active" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}">${escapeHtml(label)}</a>`;
  }

  // Unclassified tab — only shown when unclassified entries exist
  if (unclassifiedCount > 0) {
    const isActive = activeCategory === "unclassified";
    const url = buildUrl({ category: "unclassified", tag: currentTag, q: currentQuery, mode: currentMode }, basePath);
    html += `<a href="${escapeHtml(url)}" class="rounded-md px-2.5 py-1 text-xs transition-colors ${isActive ? "bg-primary text-primary-foreground active" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}">Unclassified</a>`;

    // Reclassify button — only when Unclassified tab is active and not in trash
    if (isActive && basePath === "/browse") {
      html += `<span class="text-muted-foreground text-xs select-none">·</span>`;
      html += `<button type="button" id="reclassify-all-btn"
        class="rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wider border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-30">
        Reclassify all
      </button>`;
      html += `<span id="reclassify-all-feedback" class="text-[11px]"></span>`;
    }
  }

  html += `</div>`;
  return html;
}

export function renderTagPills(
  tags: string[],
  activeTag: string | undefined,
  currentCategory: string | undefined,
  currentQuery: string | undefined,
  currentMode: string | undefined,
  basePath = "/browse",
): string {
  if (tags.length === 0) return "";

  let html = `<div class="flex items-center gap-1 flex-wrap">`;

  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTags = tags.slice(MAX_VISIBLE_TAGS);

  for (const tag of visibleTags) {
    const isActive = activeTag === tag;
    const url = isActive
      ? buildUrl({ category: currentCategory, q: currentQuery, mode: currentMode }, basePath)
      : buildUrl({ category: currentCategory, tag, q: currentQuery, mode: currentMode }, basePath);
    html += `<a href="${escapeHtml(url)}" class="rounded-full px-2 py-0.5 text-[10px] border transition-colors ${isActive ? "border-primary text-primary active" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}">${escapeHtml(tag)}</a>`;
  }

  if (hiddenTags.length > 0) {
    html += `<div class="hidden" id="extra-tags">`;
    for (const tag of hiddenTags) {
      const isActive = activeTag === tag;
      const url = isActive
        ? buildUrl({ category: currentCategory, q: currentQuery, mode: currentMode }, basePath)
        : buildUrl({ category: currentCategory, tag, q: currentQuery, mode: currentMode }, basePath);
      html += `<a href="${escapeHtml(url)}" class="rounded-full px-2 py-0.5 text-[10px] border transition-colors ${isActive ? "border-primary text-primary active" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}">${escapeHtml(tag)}</a>`;
    }
    html += `</div>`;
    html += `<button onclick="document.getElementById('extra-tags').classList.toggle('hidden');this.textContent=this.textContent.includes('show')?'show less':'show more'" class="text-[10px] text-primary hover:underline">show more</button>`;
  }

  html += `</div>`;
  return html;
}

export function renderSearchBar(
  currentQuery: string | undefined,
  currentCategory: string | undefined,
  currentTag: string | undefined,
  basePath = "/browse",
): string {
  return `
    <form action="${basePath}" method="GET" class="flex items-center gap-2">
      ${currentCategory ? `<input type="hidden" name="category" value="${escapeHtml(currentCategory)}">` : ""}
      ${currentTag ? `<input type="hidden" name="tag" value="${escapeHtml(currentTag)}">` : ""}
      <div class="flex items-center gap-2 flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-colors">
        ${iconSearch("size-3 text-muted-foreground")}
        <input type="text" name="q" value="${escapeHtml(currentQuery ?? "")}" placeholder="Search entries..." autocomplete="off" class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none font-sans">
      </div>
    </form>`;
}

export function renderEntryList(entries: EntryRow[], timeField: "updated_at" | "deleted_at" = "updated_at"): string {
  if (entries.length === 0) return "";

  let html = `<div class="space-y-0.5">`;
  for (const entry of entries) {
    const badgeLabel = categoryAbbr(entry.category);
    const badgeClass = categoryBadgeClass(entry.category);
    const timeDate = timeField === "deleted_at" && entry.deleted_at ? entry.deleted_at : entry.updated_at;
    const time = relativeTime(timeDate);
    html += `
      <a href="/entry/${escapeHtml(entry.id)}" class="w-full flex items-center gap-2 rounded px-2 py-1.5 hover:bg-secondary transition-colors group">
        <span class="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded font-medium shrink-0 ${badgeClass}">${escapeHtml(badgeLabel)}</span>
        <span class="text-xs text-foreground truncate flex-1 group-hover:text-primary transition-colors">${escapeHtml(entry.name)}</span>
        <span class="text-[10px] text-muted-foreground shrink-0">${time}</span>
      </a>`;
  }
  html += `</div>`;
  return html;
}

export function renderNotice(message: string): string {
  return `<div class="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">${escapeHtml(message)}</div>`;
}

export function renderEmptyState(
  hasQuery: boolean,
  hasCategory: boolean,
): string {
  if (hasQuery) {
    return `<div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <p class="text-sm text-muted-foreground">No results found</p>
        <p class="text-xs text-muted-foreground mt-1">Try different search terms or broaden your filters.</p>
      </div>
    </div>`;
  }
  if (hasCategory) {
    return `<div class="flex-1 flex items-center justify-center">
      <p class="text-sm text-muted-foreground">No entries in this category.</p>
    </div>`;
  }
  return `<div class="flex-1 flex items-center justify-center">
    <p class="text-sm text-muted-foreground">No entries yet. Start capturing thoughts via the dashboard or Telegram.</p>
  </div>`;
}

export function createBrowseRoutes(sql: Sql): Hono {
  const app = new Hono();

  app.get("/browse", async (c) => {
    // Start health check early so it runs in parallel with DB queries below.
    const healthPromise = getServiceStatus(sql, { isBotRunning });

    const url = new URL(c.req.url);
    const rawQuery = url.searchParams.get("q") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;
    const tag = url.searchParams.get("tag") ?? undefined;
    const mode = url.searchParams.get("mode") ?? undefined;

    const q = rawQuery ? rawQuery.slice(0, MAX_QUERY_LENGTH) : undefined;

    const filters: BrowseFilters = {};
    if (category) filters.category = category;
    if (tag) filters.tag = tag;

    let entries: EntryRow[] = [];
    let notice: string | undefined;

    if (q) {
      if (mode === "text") {
        entries = await textSearch(sql, q, filters);
      } else {
        try {
          const embedding = await generateEmbedding(q);
          if (!embedding) throw new Error("Embedding generation returned null");
          entries = await semanticSearch(sql, embedding, filters);
          if (entries.length === 0) {
            entries = await textSearch(sql, q, filters);
            if (entries.length > 0) {
              notice = "No semantic matches found. Showing text results instead.";
            }
          }
        } catch {
          notice = "Semantic search is unavailable. Showing text results instead.";
          entries = await textSearch(sql, q, filters);
        }
      }
    } else {
      entries = await browseEntries(sql, filters);
    }

    const tags = (await getFilterTags(sql, { category })) ?? [];

    // Count unclassified entries (for tab visibility)
    const [{ count: unclassifiedCount }] = await sql`
      SELECT COUNT(*)::int AS count FROM entries WHERE deleted_at IS NULL AND category IS NULL
    ` as unknown as [{ count: number }];

    const hasResults = entries.length > 0;
    const hasQuery = !!q;
    const hasCategory = !!category;

    const content = `
      <div class="flex-1 min-h-0 flex flex-col gap-3">
        <div class="shrink-0 flex flex-col gap-2">
          ${renderSearchBar(q, category, tag)}
          ${renderCategoryTabs(category, tag, q, mode, unclassifiedCount)}
          ${renderTagPills(tags, tag, category, q, mode)}
        </div>
        ${notice ? renderNotice(notice) : ""}
        <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-md border border-border bg-card px-4 py-3">
          ${hasResults ? renderEntryList(entries) : renderEmptyState(hasQuery, hasCategory)}
        </div>
      </div>
      ${category === "unclassified" && unclassifiedCount > 0 ? `
      <script>
      (function() {
        var btn = document.getElementById('reclassify-all-btn');
        var feedback = document.getElementById('reclassify-all-feedback');
        if (!btn || !feedback) return;

        btn.addEventListener('click', function() {
          btn.disabled = true;
          feedback.innerHTML = '<span class="text-primary animate-pulse">reclassifying...</span>';

          fetch('/api/reclassify-unclassified', { method: 'POST' })
            .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
            .then(function(res) {
              btn.disabled = false;
              if (!res.ok) {
                feedback.innerHTML = '<span class="text-destructive">' + (res.data.error || 'Failed') + '</span>';
                setTimeout(function() { feedback.innerHTML = ''; }, 5000);
                return;
              }
              var d = res.data;
              if (d.classified > 0) {
                var msg = d.classified + ' entries reclassified';
                if (d.remaining > 0) msg += ' — ' + d.remaining + ' remaining';
                feedback.innerHTML = '<span class="text-primary">' + msg + '</span>';
                setTimeout(function() { window.location.reload(); }, 1500);
              } else if (d.total === 0) {
                feedback.innerHTML = '<span class="text-muted-foreground">No unclassified entries</span>';
              } else {
                feedback.innerHTML = '<span class="text-destructive">Classification failed — check LLM settings</span>';
                setTimeout(function() { feedback.innerHTML = ''; }, 8000);
              }
            })
            .catch(function() {
              btn.disabled = false;
              feedback.innerHTML = '<span class="text-destructive">Request failed</span>';
              setTimeout(function() { feedback.innerHTML = ''; }, 8000);
            });
        });
      })();
      </script>` : ""}`;

    const healthStatus = await healthPromise;
    return c.html(renderLayout("Browse", content, "/browse", healthStatus));
  });

  // Reclassify all unclassified entries (max 25 per request)
  let reclassifyRunning = false;

  app.post("/api/reclassify-unclassified", async (c) => {
    if (reclassifyRunning) {
      return c.json({ error: "Reclassification already in progress" }, 409);
    }
    reclassifyRunning = true;

    try {
      const rows = await sql`
        SELECT id, name, content FROM entries
        WHERE deleted_at IS NULL AND category IS NULL
        ORDER BY created_at ASC
        LIMIT 25
      `;

      if (rows.length === 0) {
        return c.json({ total: 0, classified: 0 });
      }

      const { classifyText, assembleContext } = await import("../classify.js");
      const { resolveConfigValue } = await import("../config.js");
      const { embedEntry } = await import("../embed.js");
      const outputLanguage = (await resolveConfigValue("output_language", sql)) || undefined;

      let classified = 0;
      for (const row of rows) {
        const text = (row.content as string) || (row.name as string);
        let contextEntries: Array<{ name: string; category: string | null; content: string | null }> = [];
        try { contextEntries = await assembleContext(sql, text); } catch { /* */ }

        const result = await classifyText(text, { entryId: row.id as string, contextEntries, outputLanguage, sql });

        if (result && result.category && !result.error) {
          const tags = result.tags || [];
          await sql`
            UPDATE entries SET
              name = ${result.name || row.name},
              category = ${result.category},
              confidence = ${result.confidence},
              fields = ${sql.json((result.fields || {}) as unknown as Parameters<typeof sql.json>[0])},
              tags = ${sql.array(tags)},
              updated_at = NOW()
            WHERE id = ${row.id}
          `;
          try { await embedEntry(sql, row.id as string); } catch { /* */ }
          classified++;
        }
      }

      // Check if more remain
      const [{ count: remaining }] = await sql`
        SELECT COUNT(*)::int AS count FROM entries WHERE deleted_at IS NULL AND category IS NULL
      ` as unknown as [{ count: number }];

      return c.json({ total: rows.length, classified, remaining });
    } finally {
      reclassifyRunning = false;
    }
  });

  return app;
}
