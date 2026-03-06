import { Hono } from "hono";
import type postgres from "postgres";
import { renderLayout } from "./layout.js";
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

type Sql = postgres.Sql;

const CATEGORIES = ["people", "projects", "tasks", "ideas", "reference"];
const CATEGORY_LABELS: Record<string, string> = {
  people: "People",
  projects: "Projects",
  tasks: "Tasks",
  ideas: "Ideas",
  reference: "Reference",
};
const MAX_VISIBLE_TAGS = 10;
const MAX_QUERY_LENGTH = 500;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function buildUrl(
  params: { category?: string; tag?: string; q?: string; mode?: string },
): string {
  const parts: string[] = [];
  if (params.category) parts.push(`category=${encodeURIComponent(params.category)}`);
  if (params.tag) parts.push(`tag=${encodeURIComponent(params.tag)}`);
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.mode) parts.push(`mode=${encodeURIComponent(params.mode)}`);
  return parts.length > 0 ? `/browse?${parts.join("&")}` : "/browse";
}

function renderCategoryTabs(
  activeCategory: string | undefined,
  currentTag: string | undefined,
  currentQuery: string | undefined,
  currentMode: string | undefined,
): string {
  const allActive = !activeCategory;
  const allUrl = buildUrl({ tag: currentTag, q: currentQuery, mode: currentMode });
  let html = `<div class="flex items-center gap-1 flex-wrap">`;
  html += `<a href="${escapeHtml(allUrl)}" class="rounded-md px-2.5 py-1 text-xs transition-colors ${allActive ? "bg-primary text-primary-foreground active" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}">All</a>`;

  for (const cat of CATEGORIES) {
    const label = CATEGORY_LABELS[cat]!;
    const isActive = activeCategory === cat;
    const url = buildUrl({ category: cat, tag: currentTag, q: currentQuery, mode: currentMode });
    html += `<a href="${escapeHtml(url)}" class="rounded-md px-2.5 py-1 text-xs transition-colors ${isActive ? "bg-primary text-primary-foreground active" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}">${escapeHtml(label)}</a>`;
  }

  html += `</div>`;
  return html;
}

function renderTagPills(
  tags: string[],
  activeTag: string | undefined,
  currentCategory: string | undefined,
  currentQuery: string | undefined,
  currentMode: string | undefined,
): string {
  if (tags.length === 0) return "";

  let html = `<div class="flex items-center gap-1 flex-wrap">`;

  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTags = tags.slice(MAX_VISIBLE_TAGS);

  for (const tag of visibleTags) {
    const isActive = activeTag === tag;
    const url = isActive
      ? buildUrl({ category: currentCategory, q: currentQuery, mode: currentMode })
      : buildUrl({ category: currentCategory, tag, q: currentQuery, mode: currentMode });
    html += `<a href="${escapeHtml(url)}" class="rounded-full px-2 py-0.5 text-[10px] border transition-colors ${isActive ? "border-primary text-primary active" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}">${escapeHtml(tag)}</a>`;
  }

  if (hiddenTags.length > 0) {
    html += `<div class="hidden" id="extra-tags">`;
    for (const tag of hiddenTags) {
      const isActive = activeTag === tag;
      const url = isActive
        ? buildUrl({ category: currentCategory, q: currentQuery, mode: currentMode })
        : buildUrl({ category: currentCategory, tag, q: currentQuery, mode: currentMode });
      html += `<a href="${escapeHtml(url)}" class="rounded-full px-2 py-0.5 text-[10px] border transition-colors ${isActive ? "border-primary text-primary active" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}">${escapeHtml(tag)}</a>`;
    }
    html += `</div>`;
    html += `<button onclick="document.getElementById('extra-tags').classList.toggle('hidden');this.textContent=this.textContent.includes('show')?'show less':'show more'" class="text-[10px] text-primary hover:underline">show more</button>`;
  }

  html += `</div>`;
  return html;
}

function renderSearchBar(
  currentQuery: string | undefined,
  currentCategory: string | undefined,
  currentTag: string | undefined,
): string {
  const actionUrl = "/browse";
  return `
    <form action="${actionUrl}" method="GET" class="flex items-center gap-2">
      ${currentCategory ? `<input type="hidden" name="category" value="${escapeHtml(currentCategory)}">` : ""}
      ${currentTag ? `<input type="hidden" name="tag" value="${escapeHtml(currentTag)}">` : ""}
      <div class="flex items-center gap-2 flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-colors">
        ${iconSearch("size-3 text-muted-foreground")}
        <input type="text" name="q" value="${escapeHtml(currentQuery ?? "")}" placeholder="Search entries..." autocomplete="off" class="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none font-sans">
      </div>
    </form>`;
}

function renderEntryList(entries: EntryRow[]): string {
  if (entries.length === 0) return "";

  let html = `<div class="space-y-0.5">`;
  for (const entry of entries) {
    const badgeLabel = categoryAbbr(entry.category);
    const badgeClass = categoryBadgeClass(entry.category);
    const time = relativeTime(entry.updated_at);
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

function renderNotice(message: string): string {
  return `<div class="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">${escapeHtml(message)}</div>`;
}

function renderEmptyState(
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

    const hasResults = entries.length > 0;
    const hasQuery = !!q;
    const hasCategory = !!category;

    const content = `
      <div class="flex-1 min-h-0 flex flex-col gap-3">
        <div class="shrink-0 flex flex-col gap-2">
          ${renderSearchBar(q, category, tag)}
          ${renderCategoryTabs(category, tag, q, mode)}
          ${renderTagPills(tags, tag, category, q, mode)}
        </div>
        ${notice ? renderNotice(notice) : ""}
        <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-md border border-border bg-card px-4 py-3">
          ${hasResults ? renderEntryList(entries) : renderEmptyState(hasQuery, hasCategory)}
        </div>
      </div>`;

    return c.html(renderLayout("Browse", content, "/browse"));
  });

  return app;
}
