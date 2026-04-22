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
  getTagCounts,
  type BrowseFilters,
  type SinceValue,
  type StatusValue,
  type TagCount,
} from "./browse-queries.js";
import { generateEmbedding } from "../embed.js";
import type { EntryRow } from "./dashboard-queries.js";
import { iconSearch, iconEye, iconChevronDown, iconCheck } from "./icons.js";
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

export function renderSidebarTags(
  tagCounts: TagCount[],
  activeTag: string | undefined,
  currentCategory: string | undefined,
  currentQuery: string | undefined,
  currentMode: string | undefined,
  basePath = "/browse",
  t?: TFunction,
): string {
  const label = t ? t("browse.filter_tags") : "Tags";

  function renderTagItem(tc: TagCount): string {
    const isActive = activeTag === tc.tag;
    const href = isActive
      ? buildUrl({ category: currentCategory, q: currentQuery, mode: currentMode }, basePath)
      : buildUrl({ category: currentCategory, tag: tc.tag, q: currentQuery, mode: currentMode }, basePath);
    const linkCls = isActive
      ? "flex-1 min-w-0 px-2 py-1 text-xs text-primary truncate active"
      : "flex-1 min-w-0 px-2 py-1 text-xs text-muted-foreground hover:text-foreground truncate";
    const countCls = isActive
      ? "text-[10px] text-primary/60 shrink-0 pr-2 tabular-nums"
      : "text-[10px] text-muted-foreground/50 shrink-0 pr-2 tabular-nums";
    return `<div class="flex items-center rounded hover:bg-secondary transition-colors"><a href="${escapeHtml(href)}" class="${linkCls}">${escapeHtml(tc.tag)}</a><span class="${countCls}">${tc.count}</span></div>`;
  }

  if (tagCounts.length === 0) {
    return `<div class="px-3 py-3">
      <div class="text-[9px] uppercase tracking-widest text-muted-foreground font-medium mb-2 px-1">${escapeHtml(label)}</div>
    </div>`;
  }

  const visibleTags = tagCounts.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTags = tagCounts.slice(MAX_VISIBLE_TAGS);

  let html = `<div class="px-3 py-3">
    <div class="text-[9px] uppercase tracking-widest text-muted-foreground font-medium mb-2 px-1">${escapeHtml(label)}</div>
    <div class="flex flex-col gap-0.5">
      ${visibleTags.map((tc) => renderTagItem(tc)).join("")}`;

  if (hiddenTags.length > 0) {
    html += `<div class="hidden" id="extra-sidebar-tags">${hiddenTags.map((tc) => renderTagItem(tc)).join("")}</div>
      <button onclick="document.getElementById('extra-sidebar-tags').classList.toggle('hidden');this.textContent=this.textContent.includes('show more')?'show less':'show more'" class="text-[10px] text-primary hover:underline px-2 py-0.5 text-left w-full">show more</button>`;
  }

  html += `</div></div>`;
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
 * Resolve the localized pill text for a given dimension + raw value.
 * The stale_days dimension uses the singular catalog key for count=1 and the
 * plural key otherwise, mirroring i18next's plural-suffix convention.
 */
function pillTextFor(
  dimension: Dimension,
  rawValue: string,
  t: TFunction,
): string {
  if (dimension === "status") {
    // rawValue here is the localized status label (e.g., "Pending")
    return t("browse.filter.pill.status", { value: rawValue });
  }
  if (dimension === "since") {
    return t("browse.filter.pill.since", { value: rawValue });
  }
  const count = parseInt(rawValue, 10);
  return count === 1
    ? t("browse.filter.pill.stale_days_one", { count })
    : t("browse.filter.pill.stale_days_other", { count });
}

/**
 * Render a single filter pill: a positioned wrapper containing the trigger
 * (value + chevron), the × remove anchor, and the value picker overlay.
 *
 * The wrapper carries `relative` so the picker (`absolute top-full`) anchors
 * to the pill itself per AC-3.18 (layout invariant). The trigger exposes
 * `data-picker`, `aria-haspopup="listbox"`, `aria-expanded="false"`, and a
 * chevron-down SVG between the value text and the × anchor (AC-3.12).
 */
function renderPill(params: {
  dimension: Dimension;
  pillText: string;
  removeHref: string;
  picker: string; // pre-rendered picker HTML (renderValuePicker output)
}): string {
  const { dimension, pillText, removeHref, picker } = params;
  return `
    <span class="relative inline-flex items-center gap-1 rounded-full border border-primary px-2 py-0.5 text-[10px] text-primary">
      <span data-picker="${escapeHtml(dimension)}" aria-haspopup="listbox" aria-expanded="false" role="button" tabindex="0" class="cursor-pointer inline-flex items-center gap-1">
        <span>${escapeHtml(pillText)}</span>
        <span data-picker-chevron class="inline-flex items-center transition-transform">${iconChevronDown("size-3")}</span>
      </span>
      <a href="${escapeHtml(removeHref)}" aria-label="Remove filter" class="text-muted-foreground hover:text-foreground">×</a>
      ${picker}
    </span>`;
}

/**
 * Render the value picker overlay for a single dimension.
 *
 * The picker is an `absolute`-positioned `role="listbox"` containing one
 * `role="option"` anchor per legal value. The option matching the currently-
 * applied value is marked with `aria-selected="true"`, prefixed with a
 * Lucide check icon, and styled with `text-primary`. All other options carry
 * `aria-selected="false"`. Per AC-3.15 (roving tabindex), the matching
 * option (or the first option if no value is applied) carries `tabindex="0"`;
 * all other options carry `tabindex="-1"`.
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

  let options: Array<{ href: string; label: string; value: string }> = [];
  let currentValueKey: string | undefined;
  if (dimension === "status") {
    options = statusOptions(currentCategory).map((v) => ({
      href: browseUrl({ ...base, status: v }),
      label: statusLabel(v, t),
      value: v,
    }));
    currentValueKey = currentStatus;
  } else if (dimension === "since") {
    options = SINCE_VALUES.map((v) => ({
      href: browseUrl({ ...base, since: v }),
      label: sinceLabel(v, t),
      value: v,
    }));
    currentValueKey = currentSince;
  } else {
    options = STALE_DAYS_PRESETS.map((n) => ({
      href: browseUrl({ ...base, stale_days: n }),
      label:
        n === 1
          ? t("browse.filter.pill.stale_days_one", { count: n })
          : t("browse.filter.pill.stale_days_other", { count: n }),
      value: String(n),
    }));
    currentValueKey =
      currentStaleDays !== undefined ? String(currentStaleDays) : undefined;
  }

  const selectedIdx =
    currentValueKey !== undefined
      ? options.findIndex((o) => o.value === currentValueKey)
      : -1;
  const focusIdx = selectedIdx >= 0 ? selectedIdx : 0;

  const optionHtml = options
    .map((o, i) => {
      const isSelected = i === selectedIdx;
      const tabindex = i === focusIdx ? "0" : "-1";
      const ariaSelected = isSelected ? "true" : "false";
      // The selected option gets a check icon prefix; unselected options get a
      // size-matched empty span so labels align across the column.
      const prefix = isSelected
        ? iconCheck("size-3 mr-1 inline-block shrink-0")
        : `<span class="size-3 mr-1 inline-block shrink-0"></span>`;
      const colorCls = isSelected ? "text-primary" : "";
      return `<a href="${escapeHtml(o.href)}" role="option" aria-selected="${ariaSelected}" tabindex="${tabindex}" class="flex items-center px-3 py-1.5 text-xs hover:bg-secondary ${colorCls}">${prefix}${escapeHtml(o.label)}</a>`;
    })
    .join("");

  return `
    <div data-picker-values="${escapeHtml(dimension)}" role="listbox" class="hidden absolute top-full left-0 mt-1 rounded-md border border-border bg-card shadow-md min-w-32 z-20">
      ${optionHtml}
    </div>`;
}

/**
 * Render the "+ Filter" add-menu. Only includes dimensions that are not
 * already applied. Each dimension item carries data-dimension + data-picker
 * so JS can open the matching value picker. Items also expose
 * `aria-haspopup="listbox"` and `aria-expanded="false"` per AC-3.17.
 *
 * Without JS, clicking a dimension item navigates to the default-href URL
 * (the dimension's first legal value) — a graceful fallback per C-2.
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
        `<a href="${escapeHtml(defaultHref(dim))}" data-dimension="${escapeHtml(dim)}" data-picker="${escapeHtml(dim)}" aria-haspopup="listbox" aria-expanded="false" role="button" class="block px-3 py-1.5 text-xs hover:bg-secondary">${escapeHtml(dimensionLabel(dim, t))}</a>`,
    )
    .join("");

  // The unapplied-dim pickers and this <details> share a single `relative`
  // wrapper in renderFilterBar. The dropdown content is `absolute` and
  // anchors to that wrapper. We deliberately do NOT mark <details> itself as
  // `relative` so closest('.relative') from a dimension trigger reaches the
  // wrapping span (the picker's already-correct positioned ancestor) rather
  // than <details> — which would hide the picker on close per the HTML spec
  // (a closed <details> hides every non-<summary> child).
  return `
    <details data-filter-add-menu>
      <summary class="cursor-pointer rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-primary hover:border-primary transition-colors">${escapeHtml(t("browse.filter.add"))}</summary>
      <div class="absolute z-10 mt-1 rounded-md border border-border bg-card shadow-md min-w-32">${itemHtml}</div>
    </details>`;
}

/** Render the filter bar: pills (with co-located pickers) + +Filter menu +
 *  unapplied-dimension pickers + clear + count.
 *
 *  Per the UX upgrade (AC-3.5, AC-3.18): each picker is rendered exactly once
 *  per dimension. Active-dimension pickers are co-located inside the pill's
 *  positioned wrapper. Unapplied-dimension pickers are rendered in their own
 *  positioned span so they have a `relative` ancestor; client JS may relocate
 *  them into the +Filter <details> at open time so they visually anchor to
 *  the +Filter button.
 */
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
  vertical?: boolean;
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
    vertical = false,
  } = params;

  const base = { category, tag, q, mode, since, status, stale_days: staleDays };
  const applied = new Set<Dimension>();
  const pills: string[] = [];

  function pickerFor(dim: Dimension): string {
    return renderValuePicker({
      dimension: dim,
      currentCategory: category,
      currentTag: tag,
      currentQuery: q,
      currentMode: mode,
      currentSince: since,
      currentStatus: status,
      currentStaleDays: staleDays,
      t,
    });
  }

  if (since) {
    applied.add("since");
    pills.push(
      renderPill({
        dimension: "since",
        pillText: pillTextFor("since", sinceLabel(since, t), t),
        removeHref: browseUrl({ ...base, since: undefined }),
        picker: pickerFor("since"),
      }),
    );
  }
  if (status) {
    applied.add("status");
    pills.push(
      renderPill({
        dimension: "status",
        pillText: pillTextFor("status", statusLabel(status, t), t),
        removeHref: browseUrl({ ...base, status: undefined }),
        picker: pickerFor("status"),
      }),
    );
  }
  if (staleDays !== undefined) {
    applied.add("stale_days");
    pills.push(
      renderPill({
        dimension: "stale_days",
        pillText: pillTextFor("stale_days", String(staleDays), t),
        removeHref: browseUrl({ ...base, stale_days: undefined }),
        picker: pickerFor("stale_days"),
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

  // Unapplied-dimension pickers: rendered as siblings of the +Filter <details>
  // inside a single positioned wrapper. This places them in the same `relative`
  // ancestor as <details> itself, so each picker's `absolute top-full left-0`
  // anchors to the wrapper (visually beneath the +Filter button) without
  // having to be a child of <details> — which would hide them when the
  // disclosure is closed (the HTML <details> spec hides all non-<summary>
  // children when closed).
  const unappliedDims = ADD_FILTER_DIMENSIONS.filter((d) => !applied.has(d));
  const addMenuBlock =
    unappliedDims.length > 0
      ? `<span class="relative inline-block">${addMenu}${unappliedDims
          .map((dim) => pickerFor(dim))
          .join("")}</span>`
      : "";

  const hasAnyClearable =
    !!tag || !!since || !!status || staleDays !== undefined;
  const clearHref = browseUrl({ category, q });
  const clearLink = hasAnyClearable
    ? `<a href="${escapeHtml(clearHref)}" class="text-xs text-muted-foreground hover:text-primary transition-colors">${escapeHtml(t("browse.filter.clear"))}</a>`
    : "";

  const countKey =
    resultCount === 0
      ? "browse.filter.results_zero"
      : resultCount === 1
        ? "browse.filter.results_one"
        : "browse.filter.results_other";
  const countText = t(countKey, { count: resultCount });

  const containerCls = vertical
    ? "flex flex-col gap-1.5"
    : "flex items-center gap-2 flex-wrap";
  const countCls = vertical
    ? "text-[10px] text-muted-foreground pt-1 px-1"
    : "text-xs text-muted-foreground ml-auto";

  return `
    <div data-filter-bar class="${containerCls}">
      ${pills.join("")}
      ${addMenuBlock}
      ${clearLink}
      <span class="${countCls}">${escapeHtml(countText)}</span>
    </div>`;
}

/**
 * Client-side script that powers the anchored-popover filter bar (Pattern A).
 *
 * Responsibilities (per AC-3.5, AC-3.13–AC-3.18):
 * - Open / close pickers on trigger click; open by relocating the picker into
 *   the trigger's nearest positioned ancestor so it visually anchors there.
 * - Toggle `aria-expanded` on triggers; rotate the chevron via `rotate-180`.
 * - Manage roving-tabindex focus inside the picker (ArrowUp/Down cycle with
 *   wrap; Tab from last / Shift-Tab from first close + yield focus).
 * - Treat clicks on the currently-selected option (`aria-selected="true"`) as
 *   a no-op (close picker, no navigation) per AC-3.5 / E-16.
 * - Auto-flip overlay alignment to `right-0` when the trigger sits within
 *   200px of the right viewport edge (AC-3.16, E-15).
 * - Escape closes the open picker and returns focus to the trigger.
 * - Without JS, the × anchors and the +Filter dimension items still navigate
 *   via their default hrefs (progressive enhancement, C-2).
 */
function renderFilterBarScript(): string {
  return `
<script>
(function() {
  function setExpanded(trigger, open) {
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function chevronIn(trigger) {
    return trigger ? trigger.querySelector('[data-picker-chevron]') : null;
  }
  function getPicker(dim) {
    return document.querySelector('[data-picker-values="' + dim + '"]');
  }
  function getOptions(picker) {
    return Array.prototype.slice.call(picker.querySelectorAll('[role="option"]'));
  }
  function focusOption(options, idx) {
    options.forEach(function(o, i) {
      o.setAttribute('tabindex', i === idx ? '0' : '-1');
    });
    var target = options[idx];
    if (target) target.focus();
  }
  function closeAll() {
    document.querySelectorAll('[data-picker-values]').forEach(function(p) {
      p.classList.add('hidden');
    });
    document.querySelectorAll('[data-picker]').forEach(function(t) {
      setExpanded(t, false);
      var c = chevronIn(t);
      if (c) c.classList.remove('rotate-180');
    });
  }
  function triggerFor(dim) {
    return document.querySelector('[data-picker="' + dim + '"]');
  }
  function openPicker(trigger) {
    var dim = trigger.getAttribute('data-picker');
    if (!dim) return;
    var picker = getPicker(dim);
    if (!picker) return;
    // Resolve the element the picker visually anchors to. For a pill trigger
    // that's the trigger itself; for a +Filter dimension item the picker
    // anchors to the wrapping span (visually under the +Filter <summary>),
    // so use the <summary>'s rect for the overflow-flip decision.
    var addMenu = trigger.closest('details[data-filter-add-menu]');
    var rectEl = addMenu ? addMenu.querySelector('summary') : trigger;
    var rect = (rectEl || trigger).getBoundingClientRect();
    closeAll();
    // If the trigger is a +Filter dimension item, close the <details>
    // disclosure so the dropdown does not visually compete with the picker.
    // We do NOT relocate the picker into <details> — the HTML spec hides
    // all non-<summary> children when <details> is closed, so the picker
    // would vanish. Pickers are already siblings of <details> inside the
    // shared positioned wrapper, server-rendered in the right place.
    if (addMenu) addMenu.removeAttribute('open');
    // Overflow flip: align right when the trigger is within 200px of the edge.
    picker.classList.remove('left-0', 'right-0');
    if (rect.right > window.innerWidth - 200) {
      picker.classList.add('right-0');
    } else {
      picker.classList.add('left-0');
    }
    picker.classList.remove('hidden');
    setExpanded(trigger, true);
    var c = chevronIn(trigger);
    if (c) c.classList.add('rotate-180');
    // Focus the option that already carries tabindex="0" — that's the
    // currently-selected option, or the first option if no value is applied.
    var focused = picker.querySelector('[role="option"][tabindex="0"]');
    if (focused) focused.focus();
  }
  function effectiveFocusTarget(trigger) {
    // If trigger lives inside a now-closed +Filter <details>, the trigger
    // itself is hidden — focus the visible <summary> instead so keyboard
    // focus lands somewhere usable.
    if (!trigger) return null;
    var addMenu = trigger.closest('details[data-filter-add-menu]');
    if (addMenu && !addMenu.hasAttribute('open')) {
      var summary = addMenu.querySelector('summary');
      if (summary) return summary;
    }
    return trigger;
  }
  function closeAndFocus(trigger) {
    closeAll();
    var target = effectiveFocusTarget(trigger);
    if (target) target.focus();
  }
  // Wire trigger click + keyboard activation
  document.querySelectorAll('[data-picker]').forEach(function(trigger) {
    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var picker = getPicker(trigger.getAttribute('data-picker'));
      if (!picker) return;
      if (!picker.classList.contains('hidden')) {
        closeAll();
      } else {
        openPicker(trigger);
      }
    });
    trigger.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var picker = getPicker(trigger.getAttribute('data-picker'));
        if (!picker) return;
        if (!picker.classList.contains('hidden')) closeAll();
        else openPicker(trigger);
      }
    });
  });
  // Wire picker-level keyboard nav + selected-option click interception
  document.querySelectorAll('[data-picker-values]').forEach(function(picker) {
    picker.addEventListener('keydown', function(e) {
      var options = getOptions(picker);
      if (options.length === 0) return;
      var dim = picker.getAttribute('data-picker-values');
      var trigger = triggerFor(dim);
      var currentIdx = options.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAndFocus(trigger);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        var next = currentIdx < 0 ? 0 : (currentIdx + 1) % options.length;
        focusOption(options, next);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        var prev = currentIdx <= 0 ? options.length - 1 : currentIdx - 1;
        focusOption(options, prev);
        return;
      }
      if (e.key === 'Tab') {
        if (!e.shiftKey) {
          if (currentIdx >= options.length - 1 || currentIdx < 0) {
            // Tab past last option (or unfocused): focus the (effective)
            // trigger so the browser's default Tab moves on to the next
            // focusable element after the trigger, then close. Without the
            // explicit focus, focus would be on a now-hidden option and the
            // browser's tab order recovery is inconsistent across engines.
            var fwdTarget = effectiveFocusTarget(trigger);
            if (fwdTarget) fwdTarget.focus();
            closeAll();
          } else {
            e.preventDefault();
            focusOption(options, currentIdx + 1);
          }
        } else {
          if (currentIdx <= 0) {
            // Shift-Tab past first option: focus the trigger so default
            // Shift-Tab moves to the previous focusable element.
            var backTarget = effectiveFocusTarget(trigger);
            if (backTarget) backTarget.focus();
            closeAll();
          } else {
            e.preventDefault();
            focusOption(options, currentIdx - 1);
          }
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var current = options[currentIdx];
        if (!current) return;
        if (current.getAttribute('aria-selected') === 'true') {
          closeAndFocus(trigger);
        } else {
          var href = current.getAttribute('href');
          if (href) window.location.href = href;
        }
      }
    });
    // Click on the already-selected option → close picker, no navigation
    picker.addEventListener('click', function(e) {
      var target = e.target;
      var opt = target && target.closest && target.closest('[role="option"]');
      if (opt && opt.getAttribute('aria-selected') === 'true') {
        e.preventDefault();
        e.stopPropagation();
        var dim = picker.getAttribute('data-picker-values');
        closeAndFocus(triggerFor(dim));
      }
    });
  });
  // Click outside any trigger or picker → close
  document.addEventListener('click', function(e) {
    var target = e.target;
    if (target && target.closest && target.closest('[data-picker], [data-picker-values]')) return;
    closeAll();
  });
  // Global Escape → close
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

    const tagCounts = (await getTagCounts(sql, { category })) ?? [];

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
      vertical: true,
    });

    const clearFiltersHref = hasAnyFilter
      ? browseUrl({ category, q })
      : undefined;
    const content = `
      <div class="flex-1 min-h-0 flex flex-col gap-3">
        <div class="shrink-0 flex flex-col gap-2">
          ${renderSearchBar(q, category, tag, "/browse", t)}
          ${renderCategoryTabs(category, tag, q, mode, unclassifiedCount, "/browse", t)}
        </div>
        <div class="flex-1 min-h-0 flex gap-3">
          <div class="w-44 shrink-0 flex flex-col rounded-md border border-border bg-card">
            <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
              ${renderSidebarTags(tagCounts, tag, category, q, mode, "/browse", t)}
            </div>
            <div class="border-t border-border shrink-0"></div>
            <div class="shrink-0 px-3 py-3">
              ${filterBarHtml}
            </div>
          </div>
          <div class="flex-1 min-h-0 flex flex-col gap-2">
            ${notice ? renderNotice(notice) : ""}
            <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-md border border-border bg-card px-4 py-3">
              ${hasResults ? renderEntryList(entries) : renderEmptyState(hasQuery, hasCategory, t, clearFiltersHref)}
            </div>
          </div>
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
