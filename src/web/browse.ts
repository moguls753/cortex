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
  type SinceValue,
  type StatusValue,
} from "./browse-queries.js";
import { generateEmbedding } from "../embed.js";
import type { EntryRow } from "./dashboard-queries.js";
import { iconSearch, iconEye } from "./icons.js";
import type { TFunction } from "i18next";
import { i18next, type Locale } from "./i18n/index.js";
import { CATEGORIES, CATEGORY_LABELS, escapeHtml } from "./shared.js";

type Sql = postgres.Sql;

const MAX_VISIBLE_TAGS = 10;
const MAX_QUERY_LENGTH = 500;

const SINCE_VALUES: readonly SinceValue[] = ["today", "week", "month"] as const;
const STATUS_VALUES: readonly StatusValue[] = [
  "pending",
  "done",
  "active",
  "paused",
  "completed",
] as const;
const STALE_DAYS_PRESETS: readonly number[] = [5, 14, 30] as const;

type Dimension = "status" | "since" | "stale_days";
const ADD_FILTER_DIMENSIONS: readonly Dimension[] = [
  "status",
  "since",
  "stale_days",
] as const;

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

export function categoryAbbr(category: string | null, t?: TFunction): string {
  if (!category) return "—";
  if (t) {
    const key = `category_abbr.${category}`;
    const value = t(key);
    if (value !== key) return value;
  }
  const map: Record<string, string> = {
    people: "People",
    projects: "Project",
    tasks: "Task",
    ideas: "Idea",
    reference: "Ref",
  };
  return map[category] ?? "—";
}

export function relativeTime(date: Date, t?: TFunction): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (!t) {
    // Compact English fallback for callers that don't thread a t-function.
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
  if (minutes < 1) return t("relative.just_now");
  const subst = (tpl: string, count: number): string =>
    tpl.replace(/\d+/, String(count));
  if (minutes < 60) {
    return subst(
      t(minutes === 1 ? "relative.minutes_ago_one" : "relative.minutes_ago_other"),
      minutes,
    );
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return subst(
      t(hours === 1 ? "relative.hours_ago_one" : "relative.hours_ago_other"),
      hours,
    );
  }
  const days = Math.floor(hours / 24);
  return subst(
    t(days === 1 ? "relative.days_ago_one" : "relative.days_ago_other"),
    days,
  );
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
  t?: TFunction,
): string {
  const allLabel = t ? t("browse.all") : "All";
  const unclassifiedLabel = t
    ? t("browse.unclassified_tab")
    : "Unclassified";
  const allActive = !activeCategory;
  const allUrl = buildUrl({ tag: currentTag, q: currentQuery, mode: currentMode }, basePath);
  let html = `<div class="flex items-center gap-1 flex-wrap">`;
  html += `<a href="${escapeHtml(allUrl)}" class="rounded-md px-2.5 py-1 text-xs transition-colors ${allActive ? "bg-primary text-primary-foreground active" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}">${escapeHtml(allLabel)}</a>`;

  for (const cat of CATEGORIES) {
    const label = t
      ? (() => {
          const key = `category.${cat}`;
          const v = t(key);
          return v === key ? (CATEGORY_LABELS[cat] ?? cat) : v;
        })()
      : (CATEGORY_LABELS[cat] ?? cat);
    const isActive = activeCategory === cat;
    const url = buildUrl({ category: cat, tag: currentTag, q: currentQuery, mode: currentMode }, basePath);
    html += `<a href="${escapeHtml(url)}" class="rounded-md px-2.5 py-1 text-xs transition-colors ${isActive ? "bg-primary text-primary-foreground active" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}">${escapeHtml(label)}</a>`;
  }

  // Unclassified tab — only shown when unclassified entries exist
  if (unclassifiedCount > 0) {
    const isActive = activeCategory === "unclassified";
    const url = buildUrl({ category: "unclassified", tag: currentTag, q: currentQuery, mode: currentMode }, basePath);
    html += `<a href="${escapeHtml(url)}" class="rounded-md px-2.5 py-1 text-xs transition-colors ${isActive ? "bg-primary text-primary-foreground active" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}">${escapeHtml(unclassifiedLabel)}</a>`;

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
  t?: TFunction,
): string {
  const placeholder = t ? t("browse.search_placeholder") : "Search entries...";
  const semanticLabel = t ? t("browse.mode.semantic") : "Semantic";
  const textLabel = t ? t("browse.mode.text") : "Text";
  return `
    <form action="${basePath}" method="GET" class="flex items-center gap-2">
      ${currentCategory ? `<input type="hidden" name="category" value="${escapeHtml(currentCategory)}">` : ""}
      ${currentTag ? `<input type="hidden" name="tag" value="${escapeHtml(currentTag)}">` : ""}
      <div class="flex items-center gap-2 flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-colors">
        ${iconSearch("size-3 text-muted-foreground")}
        <input type="text" name="q" value="${escapeHtml(currentQuery ?? "")}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none font-sans">
      </div>
      <span class="hidden" data-browse-mode>
        <span data-mode="semantic">${escapeHtml(semanticLabel)}</span>
        <span data-mode="text">${escapeHtml(textLabel)}</span>
      </span>
    </form>`;
}

export function renderEntryList(
  entries: EntryRow[],
  timeField: "updated_at" | "deleted_at" = "updated_at",
  t?: TFunction,
): string {
  if (entries.length === 0) return "";

  let html = `<div class="space-y-0.5">`;
  for (const entry of entries) {
    const badgeLabel = categoryAbbr(entry.category, t);
    const badgeClass = categoryBadgeClass(entry.category);
    const timeDate = timeField === "deleted_at" && entry.deleted_at ? entry.deleted_at : entry.updated_at;
    const time = relativeTime(timeDate, t);
    const visibilityMark =
      entry.visibility === "shared"
        ? `<span data-visibility="shared" class="shrink-0 inline-flex items-center text-muted-foreground" title="Shared">${iconEye("size-3")}</span>`
        : "";
    html += `
      <a href="/entry/${escapeHtml(entry.id)}" class="w-full flex items-center gap-2 rounded px-2 py-1.5 hover:bg-secondary transition-colors group">
        <span class="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded font-medium shrink-0 ${badgeClass}">${escapeHtml(badgeLabel)}</span>
        ${visibilityMark}
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
  t?: TFunction,
  clearFiltersHref?: string,
): string {
  const emptyGlobal = t ? t("browse.empty") : "No entries yet. Start capturing thoughts via the dashboard or Telegram.";
  const emptySearch = t ? t("browse.empty_search") : "No results found. Try different search terms or broaden your filters.";
  const emptyCategory = t ? t("browse.empty_category") : "No entries in this category.";
  const clearLinkText = t ? t("browse.filter.clear") : "Clear filters";
  const clearLink = clearFiltersHref
    ? `<a href="${escapeHtml(clearFiltersHref)}" class="mt-3 text-xs text-muted-foreground hover:text-primary transition-colors">${escapeHtml(clearLinkText)}</a>`
    : "";

  if (hasQuery) {
    return `<div class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center text-center">
        <p class="text-sm text-muted-foreground">${escapeHtml(emptySearch)}</p>
        ${clearLink}
      </div>
    </div>`;
  }
  if (hasCategory) {
    return `<div class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center text-center">
        <p class="text-sm text-muted-foreground">${escapeHtml(emptyCategory)}</p>
        ${clearLink}
      </div>
    </div>`;
  }
  return `<div class="flex-1 flex items-center justify-center">
    <div class="flex flex-col items-center text-center">
      <p class="text-sm text-muted-foreground">${escapeHtml(emptyGlobal)}</p>
      ${clearLink}
    </div>
  </div>`;
}

/**
 * Build a /browse URL from a parameter bag. Omitted/undefined values are
 * dropped from the query string. Values are URI-encoded.
 */
function browseUrl(params: {
  category?: string;
  tag?: string;
  q?: string;
  mode?: string;
  since?: SinceValue;
  status?: StatusValue;
  stale_days?: number;
}): string {
  const parts: string[] = [];
  if (params.category) parts.push(`category=${encodeURIComponent(params.category)}`);
  if (params.tag) parts.push(`tag=${encodeURIComponent(params.tag)}`);
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.mode) parts.push(`mode=${encodeURIComponent(params.mode)}`);
  if (params.since) parts.push(`since=${encodeURIComponent(params.since)}`);
  if (params.status) parts.push(`status=${encodeURIComponent(params.status)}`);
  if (params.stale_days !== undefined) parts.push(`stale_days=${params.stale_days}`);
  return parts.length > 0 ? `/browse?${parts.join("&")}` : "/browse";
}

/** Status values available for a given category. Context-aware per AC-3.8. */
function statusOptions(category: string | undefined): readonly StatusValue[] {
  if (category === "tasks") return ["pending", "done"] as const;
  if (category === "projects") return ["active", "paused", "completed"] as const;
  return STATUS_VALUES;
}

function statusLabel(value: StatusValue, t: TFunction): string {
  return t(`browse.filter.value.status.${value}`);
}

function sinceLabel(value: SinceValue, t: TFunction): string {
  return t(`browse.filter.value.since.${value}`);
}

function dimensionLabel(dim: Dimension, t: TFunction): string {
  return t(`browse.filter.dimension.${dim}`);
}

/**
 * Render a single filter pill (label + removable ×). The label value portion
 * carries data-picker="<dim>" so client JS can hook it up to a popover picker.
 */
function renderPill(params: {
  dimension: Dimension;
  value: string; // localized display value
  removeHref: string;
  t: TFunction;
}): string {
  const { dimension, value, removeHref, t } = params;
  let pillText: string;
  if (dimension === "status") {
    pillText = t("browse.filter.pill.status", { value });
  } else if (dimension === "since") {
    pillText = t("browse.filter.pill.since", { value });
  } else {
    // stale_days — value is the numeric count; use plural catalog lookups
    const count = parseInt(value, 10);
    pillText = t("browse.filter.pill.stale_days", {
      count,
      defaultValue_one: t("browse.filter.pill.stale_days_one", { count }),
      defaultValue_other: t("browse.filter.pill.stale_days_other", { count }),
    });
    // i18next pluralization fallback: manually pick the branch if the above
    // doesn't resolve due to namespace/flat-key differences in the catalog.
    if (
      pillText === "browse.filter.pill.stale_days" ||
      pillText === t("browse.filter.pill.stale_days")
    ) {
      pillText =
        count === 1
          ? t("browse.filter.pill.stale_days_one", { count })
          : t("browse.filter.pill.stale_days_other", { count });
    }
  }
  return `
    <span class="inline-flex items-center gap-1 rounded-full border border-primary px-2 py-0.5 text-[10px] text-primary">
      <span data-picker="${escapeHtml(dimension)}" class="cursor-pointer">${escapeHtml(pillText)}</span>
      <a href="${escapeHtml(removeHref)}" class="text-muted-foreground hover:text-foreground" aria-label="Remove filter">×</a>
    </span>`;
}

/**
 * Render the hidden value picker panel for a single dimension. Each value is
 * a plain anchor that navigates to the updated URL — works without JS.
 */
function renderValuePicker(params: {
  dimension: Dimension;
  currentCategory: string | undefined;
  currentTag: string | undefined;
  currentQuery: string | undefined;
  currentMode: string | undefined;
  currentSince: SinceValue | undefined;
  currentStatus: StatusValue | undefined;
  currentStaleDays: number | undefined;
  t: TFunction;
}): string {
  const {
    dimension,
    currentCategory,
    currentTag,
    currentQuery,
    currentMode,
    currentSince,
    currentStatus,
    currentStaleDays,
    t,
  } = params;

  const base = {
    category: currentCategory,
    tag: currentTag,
    q: currentQuery,
    mode: currentMode,
    since: currentSince,
    status: currentStatus,
    stale_days: currentStaleDays,
  };

  let options: Array<{ href: string; label: string }> = [];
  if (dimension === "status") {
    options = statusOptions(currentCategory).map((v) => ({
      href: browseUrl({ ...base, status: v }),
      label: statusLabel(v, t),
    }));
  } else if (dimension === "since") {
    options = SINCE_VALUES.map((v) => ({
      href: browseUrl({ ...base, since: v }),
      label: sinceLabel(v, t),
    }));
  } else {
    options = STALE_DAYS_PRESETS.map((n) => ({
      href: browseUrl({ ...base, stale_days: n }),
      label:
        n === 1
          ? t("browse.filter.pill.stale_days_one", { count: n })
          : t("browse.filter.pill.stale_days_other", { count: n }),
    }));
  }

  const optionHtml = options
    .map(
      (o) =>
        `<a href="${escapeHtml(o.href)}" class="block px-3 py-1.5 text-xs hover:bg-secondary">${escapeHtml(o.label)}</a>`,
    )
    .join("");

  return `
    <div data-picker-values="${escapeHtml(dimension)}" class="hidden rounded-md border border-border bg-card shadow-md mt-1 min-w-32 w-fit">
      ${optionHtml}
    </div>`;
}

/**
 * Render the "+ Filter" add-menu. Only includes dimensions that are not
 * already applied. Each dimension item carries data-dimension + data-picker
 * so JS can open the matching value picker.
 */
function renderAddFilterMenu(params: {
  appliedDimensions: Set<Dimension>;
  currentCategory: string | undefined;
  currentTag: string | undefined;
  currentQuery: string | undefined;
  currentMode: string | undefined;
  currentSince: SinceValue | undefined;
  currentStatus: StatusValue | undefined;
  currentStaleDays: number | undefined;
  t: TFunction;
}): string {
  const { appliedDimensions, t } = params;
  const available = ADD_FILTER_DIMENSIONS.filter(
    (d) => !appliedDimensions.has(d),
  );
  if (available.length === 0) return "";

  const base = {
    category: params.currentCategory,
    tag: params.currentTag,
    q: params.currentQuery,
    mode: params.currentMode,
    since: params.currentSince,
    status: params.currentStatus,
    stale_days: params.currentStaleDays,
  };

  // For each available dimension, the default no-JS href adds the FIRST legal
  // value so the filter is reachable without running the picker JS.
  function defaultHref(dim: Dimension): string {
    if (dim === "status") {
      const firstVal = statusOptions(params.currentCategory)[0]!;
      return browseUrl({ ...base, status: firstVal });
    }
    if (dim === "since") {
      return browseUrl({ ...base, since: "week" });
    }
    return browseUrl({ ...base, stale_days: 5 });
  }

  const itemHtml = available
    .map(
      (dim) =>
        `<a href="${escapeHtml(defaultHref(dim))}" data-dimension="${escapeHtml(dim)}" data-picker="${escapeHtml(dim)}" class="block px-3 py-1.5 text-xs hover:bg-secondary">${escapeHtml(dimensionLabel(dim, t))}</a>`,
    )
    .join("");

  return `
    <details data-filter-add-menu class="relative">
      <summary class="cursor-pointer rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-primary hover:border-primary transition-colors">${escapeHtml(t("browse.filter.add"))}</summary>
      <div class="absolute z-10 mt-1 rounded-md border border-border bg-card shadow-md min-w-32">${itemHtml}</div>
    </details>`;
}

/** Render the filter bar: pills + +Filter menu + pickers + clear + count. */
export function renderFilterBar(params: {
  category: string | undefined;
  tag: string | undefined;
  q: string | undefined;
  mode: string | undefined;
  since: SinceValue | undefined;
  status: StatusValue | undefined;
  stale_days: number | undefined;
  resultCount: number;
  t: TFunction;
}): string {
  const {
    category,
    tag,
    q,
    mode,
    since,
    status,
    stale_days: staleDays,
    resultCount,
    t,
  } = params;

  const base = { category, tag, q, mode, since, status, stale_days: staleDays };
  const applied = new Set<Dimension>();
  const pills: string[] = [];

  if (since) {
    applied.add("since");
    pills.push(
      renderPill({
        dimension: "since",
        value: sinceLabel(since, t),
        removeHref: browseUrl({ ...base, since: undefined }),
        t,
      }),
    );
  }
  if (status) {
    applied.add("status");
    pills.push(
      renderPill({
        dimension: "status",
        value: statusLabel(status, t),
        removeHref: browseUrl({ ...base, status: undefined }),
        t,
      }),
    );
  }
  if (staleDays !== undefined) {
    applied.add("stale_days");
    pills.push(
      renderPill({
        dimension: "stale_days",
        value: String(staleDays),
        removeHref: browseUrl({ ...base, stale_days: undefined }),
        t,
      }),
    );
  }

  const addMenu = renderAddFilterMenu({
    appliedDimensions: applied,
    currentCategory: category,
    currentTag: tag,
    currentQuery: q,
    currentMode: mode,
    currentSince: since,
    currentStatus: status,
    currentStaleDays: staleDays,
    t,
  });

  // Value pickers: always rendered (hidden). JS may toggle visibility.
  const pickerHtml = ADD_FILTER_DIMENSIONS.map((dim) =>
    renderValuePicker({
      dimension: dim,
      currentCategory: category,
      currentTag: tag,
      currentQuery: q,
      currentMode: mode,
      currentSince: since,
      currentStatus: status,
      currentStaleDays: staleDays,
      t,
    }),
  ).join("");

  // Clear filters link: shown when at least one of tag/since/status/stale_days is active.
  const hasAnyClearable =
    !!tag || !!since || !!status || staleDays !== undefined;
  const clearHref = browseUrl({ category, q });
  const clearLink = hasAnyClearable
    ? `<a href="${escapeHtml(clearHref)}" class="text-xs text-muted-foreground hover:text-primary transition-colors">${escapeHtml(t("browse.filter.clear"))}</a>`
    : "";

  // Result count
  const countKey =
    resultCount === 0
      ? "browse.filter.results_zero"
      : resultCount === 1
        ? "browse.filter.results_one"
        : "browse.filter.results_other";
  const countText = t(countKey, { count: resultCount });

  return `
    <div data-filter-bar class="flex items-center gap-2 flex-wrap">
      ${pills.join("")}
      ${addMenu}
      ${clearLink}
      <span class="text-xs text-muted-foreground ml-auto">${escapeHtml(countText)}</span>
      ${pickerHtml}
    </div>`;
}

/**
 * Client-side vanilla JS that makes the filter bar pickers openable. Without
 * this, the `.hidden` pickers would never surface to the user.
 *
 * Behavior:
 * - Click a `[data-picker="<dim>"]` element → toggle the matching
 *   `[data-picker-values="<dim>"]` element's `hidden` class; close others.
 * - Click outside any picker trigger or panel → close all pickers.
 * - Press Escape → close all pickers.
 *
 * Without JS, users can still remove filters via the × anchor and add
 * filters via the `<details data-filter-add-menu>` default-href navigation.
 */
function renderFilterBarScript(): string {
  return `
<script>
(function() {
  function closeAll() {
    document.querySelectorAll('[data-picker-values]').forEach(function(el) {
      el.classList.add('hidden');
    });
  }
  document.querySelectorAll('[data-picker]').forEach(function(trigger) {
    trigger.addEventListener('click', function(e) {
      var dim = trigger.getAttribute('data-picker');
      if (!dim) return;
      var picker = document.querySelector('[data-picker-values="' + dim + '"]');
      if (!picker) return;
      var isOpen = !picker.classList.contains('hidden');
      e.preventDefault();
      e.stopPropagation();
      closeAll();
      if (!isOpen) picker.classList.remove('hidden');
    });
  });
  document.addEventListener('click', function(e) {
    var target = e.target;
    if (target && target.closest && target.closest('[data-picker], [data-picker-values]')) return;
    closeAll();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeAll();
  });
})();
</script>`;
}

/**
 * Parse and validate the new filter query params. Returns either the
 * validated filter bag or a `{ error }` object describing which param was
 * invalid — the handler turns that into HTTP 400.
 */
function parseFilterParams(
  url: URL,
):
  | {
      ok: true;
      since: SinceValue | undefined;
      status: StatusValue | undefined;
      stale_days: number | undefined;
    }
  | { ok: false; param: "since" | "status" | "stale_days" } {
  const sinceRaw = url.searchParams.get("since") ?? undefined;
  const statusRaw = url.searchParams.get("status") ?? undefined;
  const staleRaw = url.searchParams.get("stale_days") ?? undefined;

  let since: SinceValue | undefined;
  if (sinceRaw !== undefined) {
    if (!SINCE_VALUES.includes(sinceRaw as SinceValue)) {
      return { ok: false, param: "since" };
    }
    since = sinceRaw as SinceValue;
  }

  let status: StatusValue | undefined;
  if (statusRaw !== undefined) {
    if (!STATUS_VALUES.includes(statusRaw as StatusValue)) {
      return { ok: false, param: "status" };
    }
    status = statusRaw as StatusValue;
  }

  let staleDays: number | undefined;
  if (staleRaw !== undefined) {
    // Must be a positive integer ≥ 1. Reject empty string, non-numeric, float, zero, negative.
    if (!/^\d+$/.test(staleRaw)) {
      return { ok: false, param: "stale_days" };
    }
    const n = parseInt(staleRaw, 10);
    if (!Number.isFinite(n) || n < 1) {
      return { ok: false, param: "stale_days" };
    }
    staleDays = n;
  }

  return { ok: true, since, status, stale_days: staleDays };
}

export function createBrowseRoutes(sql: Sql): Hono {
  const app = new Hono();

  app.get("/browse", async (c) => {
    const locale = ((c.get("locale") as Locale | undefined) ?? "en") as Locale;
    const t =
      (c.get("t") as TFunction | undefined) ??
      (i18next.getFixedT(locale) as TFunction);

    const url = new URL(c.req.url);
    const rawQuery = url.searchParams.get("q") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;
    const tag = url.searchParams.get("tag") ?? undefined;
    const mode = url.searchParams.get("mode") ?? undefined;

    const q = rawQuery ? rawQuery.slice(0, MAX_QUERY_LENGTH) : undefined;

    // AC-2.5 / C-5: Validate new filter params BEFORE any database query.
    // Parsing happens before getServiceStatus so the health check is not
    // issued for an otherwise-invalid request.
    const parsed = parseFilterParams(url);
    if (!parsed.ok) {
      const body = `<div class="p-4"><p class="text-sm text-destructive">Invalid ${escapeHtml(parsed.param)} parameter.</p></div>`;
      c.status(400);
      return c.html(renderLayout("Browse", body, "/browse", undefined, c));
    }

    // Start health check after validation so it only runs for valid requests.
    const healthPromise = getServiceStatus(sql, { isBotRunning });

    const filters: BrowseFilters = {};
    if (category) filters.category = category;
    if (tag) filters.tag = tag;
    if (parsed.since) filters.since = parsed.since;
    if (parsed.status) filters.status = parsed.status;
    if (parsed.stale_days !== undefined) filters.stale_days = parsed.stale_days;

    let entries: EntryRow[] = [];
    let notice: string | undefined;

    if (q) {
      if (mode === "text") {
        entries = (await textSearch(sql, q, filters)) ?? [];
      } else {
        try {
          const embedding = await generateEmbedding(q);
          if (!embedding) throw new Error("Embedding generation returned null");
          entries = (await semanticSearch(sql, embedding, filters)) ?? [];
          if (entries.length === 0) {
            entries = (await textSearch(sql, q, filters)) ?? [];
            if (entries.length > 0) {
              notice = "No semantic matches found. Showing text results instead.";
            }
          }
        } catch {
          notice = "Semantic search is unavailable. Showing text results instead.";
          entries = (await textSearch(sql, q, filters)) ?? [];
        }
      }
    } else {
      entries = (await browseEntries(sql, filters)) ?? [];
    }

    const tags = (await getFilterTags(sql, { category })) ?? [];

    // Count unclassified entries (for tab visibility) — wrap to survive
    // unit tests that use a bare mock sql that doesn't implement the template
    // protocol.
    let unclassifiedCount = 0;
    try {
      const rows = await sql`
        SELECT COUNT(*)::int AS count FROM entries WHERE deleted_at IS NULL AND category IS NULL
      ` as unknown as Array<{ count: number }>;
      unclassifiedCount = rows[0]?.count ?? 0;
    } catch {
      // Mock sql — default to 0
    }

    const hasResults = entries.length > 0;
    const hasQuery = !!q;
    const hasCategory = !!category;
    const hasAnyFilter =
      !!tag || !!parsed.since || !!parsed.status || parsed.stale_days !== undefined;

    const filterBarHtml = renderFilterBar({
      category,
      tag,
      q,
      mode,
      since: parsed.since,
      status: parsed.status,
      stale_days: parsed.stale_days,
      resultCount: entries.length,
      t,
    });

    const clearFiltersHref = hasAnyFilter
      ? browseUrl({ category, q })
      : undefined;
    const content = `
      <div class="flex-1 min-h-0 flex flex-col gap-3">
        <div class="shrink-0 flex flex-col gap-2">
          ${renderSearchBar(q, category, tag, "/browse", t)}
          ${renderCategoryTabs(category, tag, q, mode, unclassifiedCount, "/browse", t)}
          ${renderTagPills(tags, tag, category, q, mode)}
          ${filterBarHtml}
        </div>
        ${notice ? renderNotice(notice) : ""}
        <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-md border border-border bg-card px-4 py-3">
          ${hasResults ? renderEntryList(entries) : renderEmptyState(hasQuery, hasCategory, t, clearFiltersHref)}
        </div>
      </div>
      ${renderFilterBarScript()}
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
    return c.html(renderLayout("Browse", content, "/browse", healthStatus, c));
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
          const visibility = result.visibility ?? "private";
          await sql`
            UPDATE entries SET
              name = ${result.name || row.name},
              category = ${result.category},
              confidence = ${result.confidence},
              fields = ${sql.json((result.fields || {}) as unknown as Parameters<typeof sql.json>[0])},
              tags = ${sql.array(tags)},
              visibility = ${visibility},
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
