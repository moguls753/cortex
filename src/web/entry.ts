import { Hono } from "hono";
import type postgres from "postgres";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { renderLayout } from "./layout.js";
import { getServiceStatus, type HealthStatus } from "./service-checkers.js";
import { isBotRunning } from "../telegram.js";
import {
  getEntry,
  updateEntry,
  softDeleteEntry,
  restoreEntry,
  getAllTags,
} from "./entry-queries.js";
import { embedEntry } from "../embed.js";
import { handleEntryCalendarCleanup } from "../google-calendar.js";
import {
  iconTrash2,
} from "./icons.js";
import {
  CATEGORIES,
  CATEGORY_FIELDS,
  CATEGORY_LABELS,
  escapeHtml,
  parseTags,
} from "./shared.js";

type Sql = postgres.Sql;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function migrateFields(
  submittedFields: Record<string, unknown>,
  newCategory: string | null,
): Record<string, unknown> {
  if (!newCategory || !CATEGORY_FIELDS[newCategory]) return {};
  const schema = CATEGORY_FIELDS[newCategory]!;
  const result: Record<string, unknown> = {};
  for (const field of schema) {
    result[field] = submittedFields[field] ?? null;
  }
  return result;
}

function renderViewPage(entry: {
  id: string;
  name: string;
  category: string | null;
  content: string | null;
  fields: Record<string, unknown>;
  tags: string[];
  confidence: number | null;
  source: string;
  source_type: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): string {
  const badgeClass = categoryBadgeClass(entry.category);
  const badgeLabel = entry.category ? CATEGORY_LABELS[entry.category] ?? entry.category : "Unclassified";
  const rawHtml = entry.content ? (marked.parse(entry.content) as string) : "";
  const renderedContent = sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "title"],
    },
  });

  let html = `<div class="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto scrollbar-thin">`;

  // Header
  html += `<div class="flex items-start justify-between gap-4">`;
  html += `<div class="flex-1 min-w-0">`;
  html += `<h1 class="text-lg font-medium text-foreground tracking-tight">${escapeHtml(entry.name)}</h1>`;
  html += `<div class="flex items-center gap-2 mt-1 flex-wrap">`;
  html += `<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${badgeClass}">${escapeHtml(badgeLabel)}</span>`;

  if (entry.deleted_at) {
    html += `<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium bg-destructive text-destructive-foreground">Deleted</span>`;
  }

  html += `</div>`; // badges row
  html += `</div>`; // left side

  // Actions
  html += `<div class="flex items-center gap-2 shrink-0">`;
  if (entry.deleted_at) {
    html += `<form method="POST" action="/entry/${escapeHtml(entry.id)}/restore">`;
    html += `<button type="submit" class="rounded-md px-2.5 py-1.5 text-sm text-primary border border-primary hover:bg-primary hover:text-primary-foreground transition-colors">Restore</button>`;
    html += `</form>`;
  } else {
    html += `<a href="/entry/${escapeHtml(entry.id)}/edit" class="rounded-md px-2.5 py-1.5 text-sm text-foreground border border-border hover:bg-secondary transition-colors">Edit</a>`;
    html += `<form method="POST" action="/entry/${escapeHtml(entry.id)}/delete" onsubmit="return confirm('Are you sure you want to delete this entry?')">`;
    html += `<button type="submit" class="rounded-md px-2.5 py-1.5 text-sm text-destructive border border-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors flex items-center gap-1">${iconTrash2("size-3")} Delete</button>`;
    html += `</form>`;
  }
  html += `</div>`;
  html += `</div>`; // header row

  // Tags
  if (entry.tags.length > 0) {
    html += `<div class="flex items-center gap-1 flex-wrap">`;
    for (const tag of entry.tags) {
      html += `<span class="rounded-full px-2 py-0.5 text-[10px] border border-border text-muted-foreground">${escapeHtml(tag)}</span>`;
    }
    html += `</div>`;
  }

  // Content
  if (renderedContent) {
    html += `<div class="rounded-md border border-border bg-card p-4 prose-sm">${renderedContent}</div>`;
  }

  // Category-specific fields
  const fieldEntries = Object.entries(entry.fields).filter(([, v]) => v !== null && v !== "");
  if (fieldEntries.length > 0) {
    html += `<div class="rounded-md border border-border bg-card p-4">`;
    html += `<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Fields</h2>`;
    html += `<dl class="grid grid-cols-2 gap-x-4 gap-y-1">`;
    for (const [key, value] of fieldEntries) {
      html += `<dt class="text-xs text-muted-foreground">${escapeHtml(key)}</dt>`;
      html += `<dd class="text-xs text-foreground">${escapeHtml(String(value))}</dd>`;
    }
    html += `</dl></div>`;
  }

  // Timestamps
  html += `<div class="flex items-center gap-4 text-[10px] text-muted-foreground">`;
  html += `<span>Created: ${formatDate(entry.created_at)}</span>`;
  html += `<span>Updated: ${formatDate(entry.updated_at)}</span>`;
  html += `</div>`;

  html += `</div>`;

  return html;
}

function renderEditPage(
  entry: {
    id: string;
    name: string;
    category: string | null;
    content: string | null;
    fields: Record<string, unknown>;
    tags: string[];
  },
  allTags: string[],
  error?: string,
): string {
  let html = `<div class="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto scrollbar-thin">`;

  html += `<div class="flex items-center justify-between">`;
  html += `<h1 class="text-lg font-medium text-foreground tracking-tight">Edit Entry</h1>`;
  html += `<a href="/entry/${escapeHtml(entry.id)}" class="rounded-md px-2.5 py-1.5 text-sm text-foreground border border-border hover:bg-secondary transition-colors">Cancel</a>`;
  html += `</div>`;

  if (error) {
    html += `<div class="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">${escapeHtml(error)}</div>`;
  }

  html += `<form method="POST" action="/entry/${escapeHtml(entry.id)}/edit" class="flex flex-col gap-3">`;

  // Name
  html += `<div>`;
  html += `<label class="block text-xs font-medium text-muted-foreground mb-1">Name</label>`;
  html += `<input type="text" name="name" value="${escapeHtml(entry.name)}" required class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
  html += `</div>`;

  // Category
  html += `<div>`;
  html += `<label class="block text-xs font-medium text-muted-foreground mb-1">Category</label>`;
  html += `<select name="category" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
  html += `<option value="">-- Select category --</option>`;
  for (const cat of CATEGORIES) {
    const selected = entry.category === cat ? " selected" : "";
    html += `<option value="${escapeHtml(cat)}"${selected}>${escapeHtml(CATEGORY_LABELS[cat] ?? cat)}</option>`;
  }
  html += `</select>`;
  html += `</div>`;

  // Tags
  html += `<div>`;
  html += `<label class="block text-xs font-medium text-muted-foreground mb-1">Tags</label>`;
  html += `<input type="text" name="tags" value="${escapeHtml(entry.tags.join(", "))}" list="tag-suggestions" placeholder="Comma-separated tags" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
  html += `<datalist id="tag-suggestions">`;
  for (const tag of allTags) {
    html += `<option value="${escapeHtml(tag)}">`;
  }
  html += `</datalist>`;
  html += `</div>`;

  // Content
  html += `<div>`;
  html += `<label class="block text-xs font-medium text-muted-foreground mb-1">Content</label>`;
  html += `<textarea name="content" rows="10" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans resize-y">${escapeHtml(entry.content ?? "")}</textarea>`;
  html += `</div>`;

  // Category-specific fields
  if (entry.category && CATEGORY_FIELDS[entry.category]) {
    const schema = CATEGORY_FIELDS[entry.category]!;
    html += `<div class="rounded-md border border-border bg-card p-4">`;
    html += `<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Category Fields</h2>`;
    html += `<div class="flex flex-col gap-2">`;
    for (const field of schema) {
      const value = entry.fields[field] ?? "";
      if (field === "status" && entry.category === "projects") {
        html += `<div>`;
        html += `<label class="block text-xs text-muted-foreground mb-1">${escapeHtml(field)}</label>`;
        html += `<select name="fields[${escapeHtml(field)}]" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
        for (const opt of ["active", "paused", "done", "cancelled"]) {
          const sel = String(value) === opt ? " selected" : "";
          html += `<option value="${opt}"${sel}>${opt}</option>`;
        }
        html += `</select></div>`;
      } else if (field === "status" && entry.category === "tasks") {
        html += `<div>`;
        html += `<label class="block text-xs text-muted-foreground mb-1">${escapeHtml(field)}</label>`;
        html += `<select name="fields[${escapeHtml(field)}]" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
        for (const opt of ["pending", "done", "cancelled"]) {
          const sel = String(value) === opt ? " selected" : "";
          html += `<option value="${opt}"${sel}>${opt}</option>`;
        }
        html += `</select></div>`;
      } else if (field === "due_date") {
        html += `<div>`;
        html += `<label class="block text-xs text-muted-foreground mb-1">${escapeHtml(field)}</label>`;
        html += `<input type="date" name="fields[${escapeHtml(field)}]" value="${escapeHtml(String(value ?? ""))}" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
        html += `</div>`;
      } else if (field === "context" || field === "follow_ups" || field === "notes") {
        html += `<div>`;
        html += `<label class="block text-xs text-muted-foreground mb-1">${escapeHtml(field)}</label>`;
        html += `<textarea name="fields[${escapeHtml(field)}]" rows="3" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans resize-y">${escapeHtml(String(value ?? ""))}</textarea>`;
        html += `</div>`;
      } else {
        html += `<div>`;
        html += `<label class="block text-xs text-muted-foreground mb-1">${escapeHtml(field)}</label>`;
        html += `<input type="text" name="fields[${escapeHtml(field)}]" value="${escapeHtml(String(value ?? ""))}" class="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans">`;
        html += `</div>`;
      }
    }
    html += `</div></div>`;
  }

  // Submit
  html += `<div class="flex items-center gap-2">`;
  html += `<button type="submit" class="rounded-md px-4 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">Save</button>`;
  html += `<a href="/entry/${escapeHtml(entry.id)}" class="rounded-md px-4 py-1.5 text-sm text-foreground border border-border hover:bg-secondary transition-colors">Cancel</a>`;
  html += `</div>`;

  html += `</form>`;
  html += `</div>`;
  return html;
}

function render404(): string {
  return `<div class="flex-1 flex items-center justify-center">
    <div class="text-center">
      <h1 class="text-lg font-medium text-foreground">Not Found</h1>
      <p class="text-sm text-muted-foreground mt-1">The entry you're looking for doesn't exist.</p>
      <a href="/" class="text-xs text-primary hover:underline mt-2 inline-block">Back to dashboard</a>
    </div>
  </div>`;
}

export function createEntryRoutes(sql: Sql): Hono {
  const app = new Hono();

  const health = (): Promise<HealthStatus> =>
    getServiceStatus(sql, { isBotRunning });

  // View entry
  app.get("/entry/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.html(renderLayout("Not Found", render404(), "/", await health()), 404);
    }

    const entry = await getEntry(sql, id);
    if (!entry) {
      return c.html(renderLayout("Not Found", render404(), "/", await health()), 404);
    }

    return c.html(renderLayout(entry.name, renderViewPage(entry), "/", await health()));
  });

  // Edit form
  app.get("/entry/:id/edit", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.html(renderLayout("Not Found", render404(), "/", await health()), 404);
    }

    const entry = await getEntry(sql, id);
    if (!entry) {
      return c.html(renderLayout("Not Found", render404(), "/", await health()), 404);
    }

    const allTagsList = (await getAllTags(sql)) ?? [];
    return c.html(renderLayout("Edit — " + entry.name, renderEditPage(entry, allTagsList), "/", await health()));
  });

  // Save edit
  app.post("/entry/:id/edit", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.html(renderLayout("Not Found", render404(), "/", await health()), 404);
    }

    const formData = await c.req.parseBody();
    const name = String(formData["name"] ?? "").trim();
    const categoryRaw = String(formData["category"] ?? "");
    const category = categoryRaw && CATEGORIES.includes(categoryRaw) ? categoryRaw : null;
    const content = String(formData["content"] ?? "") || null;
    const tagsRaw = String(formData["tags"] ?? "");
    const tags = parseTags(tagsRaw);

    // Collect submitted fields
    const submittedFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formData)) {
      const match = key.match(/^fields\[(.+)]$/);
      if (match) {
        submittedFields[match[1]!] = value || null;
      }
    }

    // Validate
    if (!name) {
      const entry = await getEntry(sql, id);
      if (!entry) {
        return c.html(renderLayout("Not Found", render404(), "/", await health()), 404);
      }
      const allTagsList = (await getAllTags(sql)) ?? [];
      const errorEntry = { ...entry, name: "", category, content, tags, fields: submittedFields };
      return c.html(
        renderLayout("Edit — " + entry.name, renderEditPage(errorEntry, allTagsList, "Name is required"), "/", await health()),
        422,
      );
    }

    // Migrate fields to new category schema
    const fields = migrateFields(submittedFields, category);

    await updateEntry(sql, id, { name, category, content, fields, tags });

    // Re-generate embedding (best-effort, async)
    try {
      await embedEntry(sql, id);
    } catch {
      // Ollama down — save succeeded, embedding preserved
    }

    return c.redirect(`/entry/${id}`, 303);
  });

  // Soft delete
  app.post("/entry/:id/delete", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.html(renderLayout("Not Found", render404(), "/", await health()), 404);
    }
    // Clean up linked calendar event before soft-delete
    try {
      await handleEntryCalendarCleanup(sql, id);
    } catch {
      // Calendar cleanup failure should not block entry deletion
    }

    await softDeleteEntry(sql, id);

    const referer = c.req.header("referer");
    if (referer) {
      try {
        const url = new URL(referer, "http://localhost");
        const target = url.pathname + url.search;
        if (target !== "/" && target !== "") {
          return c.redirect(target, 303);
        }
      } catch {
        // Invalid referer
      }
    }
    return c.redirect("/", 303);
  });

  // Restore
  app.post("/entry/:id/restore", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.html(renderLayout("Not Found", render404(), "/", await health()), 404);
    }
    await restoreEntry(sql, id);
    return c.redirect(`/entry/${id}`, 303);
  });

  return app;
}
