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
import {
  buildUrl,
  renderCategoryTabs,
  renderTagPills,
  renderSearchBar,
  renderEntryList,
  renderNotice,
  renderEmptyState,
} from "./browse.js";
import { escapeHtml } from "./shared.js";

type Sql = postgres.Sql;

const MAX_QUERY_LENGTH = 500;

function renderTrashEmptyState(): string {
  return `<div class="flex-1 flex items-center justify-center">
    <p class="text-sm text-muted-foreground">Trash is empty.</p>
  </div>`;
}

export function createTrashRoutes(sql: Sql): Hono {
  const app = new Hono();

  app.get("/trash", async (c) => {
    const healthPromise = getServiceStatus(sql, { isBotRunning });

    const url = new URL(c.req.url);
    const rawQuery = url.searchParams.get("q") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;
    const tag = url.searchParams.get("tag") ?? undefined;
    const mode = url.searchParams.get("mode") ?? undefined;

    const q = rawQuery ? rawQuery.slice(0, MAX_QUERY_LENGTH) : undefined;

    const filters: BrowseFilters = { deleted: true };
    if (category) filters.category = category;
    if (tag) filters.tag = tag;

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

    const tags = (await getFilterTags(sql, { category, deleted: true })) ?? [];

    // Count unclassified deleted entries (for tab visibility)
    const [{ count: unclassifiedCount }] = await sql`
      SELECT COUNT(*)::int AS count FROM entries WHERE deleted_at IS NOT NULL AND category IS NULL
    ` as unknown as [{ count: number }];

    // Total trash count (for Empty Trash button and confirmation)
    const [{ count: trashCount }] = await sql`
      SELECT COUNT(*)::int AS count FROM entries WHERE deleted_at IS NOT NULL
    ` as unknown as [{ count: number }];

    const hasResults = entries.length > 0;
    const hasQuery = !!q;
    const hasCategory = !!category;
    const basePath = "/trash";

    // Empty Trash button (only when there are trashed entries)
    let emptyTrashHtml = "";
    if (trashCount > 0) {
      emptyTrashHtml = `
        <div class="flex items-center gap-2">
          <button type="button" id="empty-trash-btn"
            class="rounded-md px-2.5 py-1 text-xs border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors">
            Empty Trash
          </button>
          <span id="empty-trash-feedback" class="text-[11px]"></span>
        </div>`;
    }

    // Determine empty state
    let emptyHtml: string;
    if (!hasResults && trashCount === 0 && !hasQuery && !hasCategory) {
      emptyHtml = renderTrashEmptyState();
    } else if (!hasResults) {
      emptyHtml = renderEmptyState(hasQuery, hasCategory);
    } else {
      emptyHtml = renderEntryList(entries, "deleted_at");
    }

    const content = `
      <div class="flex-1 min-h-0 flex flex-col gap-3">
        <div class="shrink-0 flex flex-col gap-2">
          ${renderSearchBar(q, category, tag, basePath)}
          ${renderCategoryTabs(category, tag, q, mode, unclassifiedCount, basePath)}
          ${renderTagPills(tags, tag, category, q, mode, basePath)}
          ${emptyTrashHtml}
        </div>
        ${notice ? renderNotice(notice) : ""}
        <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-md border border-border bg-card px-4 py-3">
          ${emptyHtml}
        </div>
      </div>
      ${trashCount > 0 ? `
      <script>
      (function() {
        var btn = document.getElementById('empty-trash-btn');
        var feedback = document.getElementById('empty-trash-feedback');
        if (!btn || !feedback) return;

        btn.addEventListener('click', function() {
          if (!confirm('Permanently delete all ${escapeHtml(String(trashCount))} entries in trash? This cannot be undone.')) return;

          btn.disabled = true;
          feedback.innerHTML = '<span class="text-destructive animate-pulse">deleting...</span>';

          fetch('/api/empty-trash', { method: 'POST' })
            .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
            .then(function(res) {
              btn.disabled = false;
              if (!res.ok) {
                feedback.innerHTML = '<span class="text-destructive">' + (res.data.error || 'Failed') + '</span>';
                setTimeout(function() { feedback.innerHTML = ''; }, 5000);
                return;
              }
              feedback.innerHTML = '<span class="text-destructive">' + res.data.deleted + ' entries permanently deleted</span>';
              setTimeout(function() { window.location.reload(); }, 1000);
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
    return c.html(renderLayout("Trash", content, "/trash", healthStatus));
  });

  // Empty Trash endpoint
  app.post("/api/empty-trash", async (c) => {
    const result = await sql`
      DELETE FROM entries WHERE deleted_at IS NOT NULL
    `;
    return c.json({ deleted: result.count });
  });

  return app;
}
