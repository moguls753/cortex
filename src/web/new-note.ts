import { Hono } from "hono";
import type postgres from "postgres";
import { renderLayout } from "./layout.js";
import { insertEntry } from "./dashboard-queries.js";
import { getAllTags } from "./entry-queries.js";
import { classifyText, assembleContext } from "../classify.js";
import { embedEntry } from "../embed.js";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_FIELDS,
  escapeHtml,
  parseTags,
} from "./shared.js";

type Sql = postgres.Sql;

function defaultFields(category: string | null): Record<string, unknown> {
  if (!category || !CATEGORY_FIELDS[category]) return {};
  const result: Record<string, unknown> = {};
  for (const field of CATEGORY_FIELDS[category]) {
    result[field] = null;
  }
  return result;
}

function renderNewNotePage(allTags: string[], error?: string): string {
  let html = `<div class="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto scrollbar-thin">`;

  html += `<div class="flex items-center justify-between">`;
  html += `<h1 class="text-lg font-medium text-foreground tracking-tight">New Note</h1>`;
  html += `<a href="/" class="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground border border-border hover:bg-secondary transition-colors">Cancel</a>`;
  html += `</div>`;

  if (error) {
    html += `<div class="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">${escapeHtml(error)}</div>`;
  }

  html += `<form method="POST" action="/new" id="new-note-form" class="flex flex-col gap-3">`;

  // Name
  html += `<div>`;
  html += `<label class="block text-xs font-medium text-muted-foreground mb-1">Name</label>`;
  html += `<input type="text" name="name" required class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
  html += `</div>`;

  // Category
  html += `<div>`;
  html += `<label class="block text-xs font-medium text-muted-foreground mb-1">Category</label>`;
  html += `<select name="category" id="note-category" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
  html += `<option value="">-- Select category --</option>`;
  for (const cat of CATEGORIES) {
    html += `<option value="${escapeHtml(cat)}">${escapeHtml(CATEGORY_LABELS[cat] ?? cat)}</option>`;
  }
  html += `</select>`;
  html += `</div>`;

  // Tags
  html += `<div>`;
  html += `<label class="block text-xs font-medium text-muted-foreground mb-1">Tags</label>`;
  html += `<input type="text" name="tags" list="tag-suggestions" placeholder="Comma-separated tags" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
  html += `<datalist id="tag-suggestions">`;
  for (const tag of allTags) {
    html += `<option value="${escapeHtml(tag)}">`;
  }
  html += `</datalist>`;
  html += `</div>`;

  // Content
  html += `<div>`;
  html += `<label class="block text-xs font-medium text-muted-foreground mb-1">Content</label>`;
  html += `<textarea name="content" rows="10" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans resize-y"></textarea>`;
  html += `</div>`;

  // Buttons
  html += `<div class="flex items-center gap-2">`;
  html += `<button type="submit" class="rounded-md px-4 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">Save</button>`;
  html += `<button type="button" id="ai-suggest-btn" class="rounded-md px-4 py-1.5 text-xs text-primary border border-primary hover:bg-primary hover:text-primary-foreground transition-colors">AI Suggest</button>`;
  html += `</div>`;

  html += `</form>`;

  // Client-side scripts
  html += `<script>
(function() {
  var form = document.getElementById('new-note-form');
  var suggestBtn = document.getElementById('ai-suggest-btn');
  var categorySelect = document.getElementById('note-category');
  var dirty = false;

  if (form) {
    form.addEventListener('input', function() { dirty = true; });
    form.addEventListener('submit', function() { dirty = false; });
  }

  window.addEventListener('beforeunload', function(e) {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  if (suggestBtn) {
    suggestBtn.addEventListener('click', function() {
      var name = form.querySelector('[name="name"]').value.trim();
      var content = form.querySelector('[name="content"]').value.trim();
      if (!name && !content) return;

      suggestBtn.disabled = true;
      suggestBtn.textContent = 'Classifying...';

      fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'name=' + encodeURIComponent(name) + '&content=' + encodeURIComponent(content)
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        suggestBtn.disabled = false;
        suggestBtn.textContent = 'AI Suggest';
        if (data.error) return;
        if (data.category && categorySelect) {
          categorySelect.value = data.category;
        }
        if (data.tags && data.tags.length > 0) {
          var tagsInput = form.querySelector('[name="tags"]');
          var existing = tagsInput.value.trim();
          var newTags = data.tags.join(', ');
          tagsInput.value = existing ? existing + ', ' + newTags : newTags;
        }
      })
      .catch(function() {
        suggestBtn.disabled = false;
        suggestBtn.textContent = 'AI Suggest';
      });
    });
  }
})();
</script>`;

  html += `</div>`;
  return html;
}

export function createNewNoteRoutes(sql: Sql): Hono {
  const app = new Hono();

  // GET /new - render form
  app.get("/new", async (c) => {
    const allTags = (await getAllTags(sql)) ?? [];
    return c.html(renderLayout("New Note", renderNewNotePage(allTags)));
  });

  // POST /new - save note
  app.post("/new", async (c) => {
    const formData = await c.req.parseBody();
    const name = String(formData["name"] ?? "").trim();
    const categoryRaw = String(formData["category"] ?? "");
    const category =
      categoryRaw && CATEGORIES.includes(categoryRaw) ? categoryRaw : null;
    const content = String(formData["content"] ?? "") || null;
    const tags = parseTags(String(formData["tags"] ?? ""));
    const fields = defaultFields(category);

    // Validate name
    if (!name) {
      const allTags = (await getAllTags(sql)) ?? [];
      return c.html(
        renderLayout(
          "New Note",
          renderNewNotePage(allTags, "Name is required"),
        ),
        422,
      );
    }

    const entryId = await insertEntry(sql, {
      name,
      content,
      category,
      confidence: null,
      fields,
      tags,
      source: "webapp",
      source_type: "text",
    });

    // Best-effort embedding
    try {
      await embedEntry(sql, entryId);
    } catch {
      // Ollama down — entry saved, embedding will be retried later
    }

    return c.redirect(`/entry/${entryId}`, 302);
  });

  // POST /api/classify - AI Suggest endpoint
  app.post("/api/classify", async (c) => {
    const formData = await c.req.parseBody();
    const name = String(formData["name"] ?? "").trim();
    const content = String(formData["content"] ?? "").trim();

    if (!name && !content) {
      return c.json({ error: "Write some content first" }, 400);
    }

    const text = content ? `${name}\n\n${content}` : name;

    try {
      const contextEntries = await assembleContext(sql, text);
      const result = await classifyText(text, { contextEntries });

      if (!result) {
        return c.json({
          error: "Classification service unavailable",
        });
      }

      return c.json({
        category: result.category ?? null,
        tags: result.tags ?? [],
      });
    } catch {
      return c.json({
        error: "Classification service unavailable",
      });
    }
  });

  return app;
}
