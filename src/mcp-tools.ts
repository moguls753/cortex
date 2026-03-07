import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { generateEmbedding } from "./embed.js";
import { classifyText, assembleContext } from "./classify.js";
import {
  searchBySimilarity,
  insertMcpEntry,
  listRecentEntries,
  getEntryById,
  updateEntryFields,
  softDeleteEntry,
  getBrainStats,
} from "./mcp-queries.js";
import { createLogger } from "./logger.js";

const log = createLogger("mcp");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CATEGORIES = ["people", "projects", "tasks", "ideas", "reference"];

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// ─── Tool Definitions ─────────────────────────────────────────────────

const TOOLS = [
  {
    name: "search_brain",
    description: "Search the brain by semantic meaning to find relevant entries",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 10, max 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "add_thought",
    description: "Capture a thought, classify it, and store it in the brain",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The thought to capture" },
      },
      required: ["text"],
    },
  },
  {
    name: "list_recent",
    description: "Browse recent entries from the brain",
    inputSchema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "Number of days to look back (default 7)" },
        category: {
          type: "string",
          description: "Filter by category",
          enum: VALID_CATEGORIES,
        },
      },
    },
  },
  {
    name: "get_entry",
    description: "Read a specific entry in full by its ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Entry UUID" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_entry",
    description: "Update an existing entry's fields",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Entry UUID" },
        name: { type: "string", description: "New name" },
        content: { type: "string", description: "New content" },
        category: { type: "string", description: "New category", enum: VALID_CATEGORIES },
        tags: { type: "array", items: { type: "string" }, description: "New tags" },
        fields: { type: "object", description: "New fields" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_entry",
    description: "Soft-delete an entry from the brain",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Entry UUID" },
      },
      required: ["id"],
    },
  },
  {
    name: "brain_stats",
    description: "Get an overview of what's in the brain",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ─── Handler Functions ────────────────────────────────────────────────

export async function handleSearchBrain(sql: any, params: { query: string; limit?: number }): Promise<ToolResult> {
  if (!params.query || !params.query.trim()) {
    return err("Query cannot be empty");
  }

  let limit = params.limit ?? 10;
  if (limit <= 0) limit = 10;
  if (limit > 50) limit = 50;

  let embedding: number[] | null;
  try {
    embedding = await generateEmbedding(params.query);
    if (!embedding) throw new Error("No embedding returned");
  } catch {
    return err("Embedding service unavailable");
  }

  try {
    const results = await searchBySimilarity(sql, embedding, limit);
    const mapped = results.map((r: any) => ({
      id: r.id,
      category: r.category,
      name: r.name,
      content: r.content && r.content.length > 500 ? r.content.substring(0, 500) : r.content,
      tags: r.tags,
      similarity: r.similarity,
      created_at: r.created_at,
    }));
    return ok(mapped);
  } catch (e) {
    log.error("Search failed", { error: (e as Error).message });
    return err("Database unavailable");
  }
}

export async function handleAddThought(sql: any, params: { text: string }): Promise<ToolResult> {
  if (!params.text || !params.text.trim()) {
    return err("Text cannot be empty");
  }

  let classification: any = null;
  try {
    const contextEntries = await assembleContext(sql, params.text);
    classification = await classifyText(params.text, {
      contextEntries: Array.isArray(contextEntries) ? contextEntries : [],
    });
  } catch {
    // Classification failed — store unclassified
  }

  let embedding: number[] | null = null;
  try {
    embedding = await generateEmbedding(params.text);
  } catch {
    // Embedding failed — store without embedding
  }

  const entryData = {
    name: classification?.name ?? params.text.substring(0, 100),
    content: params.text,
    category: classification?.category ?? null,
    confidence: classification?.confidence ?? null,
    fields: classification?.fields ?? {},
    tags: classification?.tags ?? [],
    source: "mcp",
    source_type: "text",
    embedding,
  };

  try {
    const entry = await insertMcpEntry(sql, entryData);
    return ok({
      id: entry.id,
      category: entry.category,
      name: entry.name,
      confidence: entry.confidence,
      tags: entry.tags,
    });
  } catch (e) {
    log.error("Insert failed", { error: (e as Error).message });
    return err("Database unavailable");
  }
}

export async function handleListRecent(sql: any, params: { days?: number; category?: string }): Promise<ToolResult> {
  if (params.category && !VALID_CATEGORIES.includes(params.category)) {
    return err("Invalid category");
  }

  const days = params.days ?? 7;

  try {
    const entries = await listRecentEntries(sql, days, params.category);
    const mapped = entries.map((e: any) => ({
      id: e.id,
      category: e.category,
      name: e.name,
      tags: e.tags,
      created_at: e.created_at,
      updated_at: e.updated_at,
    }));
    return ok(mapped);
  } catch (e) {
    log.error("List recent failed", { error: (e as Error).message });
    return err("Database unavailable");
  }
}

export async function handleGetEntry(sql: any, params: { id: string }): Promise<ToolResult> {
  if (!UUID_RE.test(params.id)) {
    return err("Invalid entry ID");
  }

  try {
    const entry = await getEntryById(sql, params.id);
    if (!entry) return err("Entry not found");
    if (entry.deleted_at) return err("Entry has been deleted");

    return ok({
      id: entry.id,
      category: entry.category,
      name: entry.name,
      content: entry.content,
      fields: entry.fields,
      tags: entry.tags,
      confidence: entry.confidence,
      source: entry.source,
      source_type: entry.source_type,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  } catch (e) {
    log.error("Get entry failed", { error: (e as Error).message });
    return err("Database unavailable");
  }
}

export async function handleUpdateEntry(sql: any, params: {
  id: string;
  name?: string;
  content?: string;
  category?: string;
  tags?: string[];
  fields?: Record<string, unknown>;
}): Promise<ToolResult> {
  if (!UUID_RE.test(params.id)) {
    return err("Invalid entry ID");
  }

  if (params.category && !VALID_CATEGORIES.includes(params.category)) {
    return err("Invalid category");
  }

  let entry: any;
  try {
    entry = await getEntryById(sql, params.id);
  } catch (e) {
    log.error("Get entry for update failed", { error: (e as Error).message });
    return err("Database unavailable");
  }

  if (!entry) return err("Entry not found");
  if (entry.deleted_at) return err("Entry has been deleted");

  const updates: Record<string, unknown> = {};
  if (params.name !== undefined) updates.name = params.name;
  if (params.content !== undefined) updates.content = params.content;
  if (params.category !== undefined) updates.category = params.category;
  if (params.tags !== undefined) updates.tags = params.tags;
  if (params.fields !== undefined) updates.fields = params.fields;

  if (Object.keys(updates).length === 0) {
    return ok({
      id: entry.id,
      category: entry.category,
      name: entry.name,
      content: entry.content,
      fields: entry.fields,
      tags: entry.tags,
      confidence: entry.confidence,
      source: entry.source,
      source_type: entry.source_type,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  }

  // Re-embed if content or name changed
  const needsReembed = "content" in updates || "name" in updates;
  if (needsReembed) {
    const textForEmbed = (updates.content as string) ?? entry.content ?? (updates.name as string) ?? entry.name;
    try {
      const embedding = await generateEmbedding(textForEmbed);
      updates.embedding = embedding;
    } catch {
      updates.embedding = null;
    }
  }

  try {
    const updated = await updateEntryFields(sql, params.id, updates);
    if (!updated) return err("Entry not found");

    return ok({
      id: updated.id,
      category: updated.category,
      name: updated.name,
      content: updated.content,
      fields: updated.fields,
      tags: updated.tags,
      confidence: updated.confidence,
      source: updated.source,
      source_type: updated.source_type,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    });
  } catch (e) {
    log.error("Update entry failed", { error: (e as Error).message });
    return err("Database unavailable");
  }
}

export async function handleDeleteEntry(sql: any, params: { id: string }): Promise<ToolResult> {
  if (!UUID_RE.test(params.id)) {
    return err("Invalid entry ID");
  }

  try {
    const entry = await getEntryById(sql, params.id);
    if (!entry) return err("Entry not found");
    if (entry.deleted_at) return err("Entry is already deleted");

    await softDeleteEntry(sql, params.id);
    return ok("Entry deleted");
  } catch (e) {
    log.error("Delete entry failed", { error: (e as Error).message });
    return err("Database unavailable");
  }
}

const DB_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Query timeout")), ms),
    ),
  ]);
}

export async function handleBrainStats(sql: any): Promise<ToolResult> {
  try {
    const stats = await withTimeout(getBrainStats(sql), DB_TIMEOUT_MS);
    return ok(stats);
  } catch (e) {
    log.error("Brain stats failed", { error: (e as Error).message });
    return err("Database unavailable");
  }
}

// ─── MCP Server Factory ──────────────────────────────────────────────

const HANDLER_MAP: Record<string, (sql: any, params: any) => Promise<ToolResult>> = {
  search_brain: handleSearchBrain,
  add_thought: handleAddThought,
  list_recent: handleListRecent,
  get_entry: handleGetEntry,
  update_entry: handleUpdateEntry,
  delete_entry: handleDeleteEntry,
  brain_stats: (sql) => handleBrainStats(sql),
};

export function createMcpServer(sql: any): Server {
  const server = new Server(
    { name: "cortex", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    const { name, arguments: args } = request.params;
    const handler = HANDLER_MAP[name];
    if (!handler) {
      return err(`Unknown tool: ${name}`);
    }
    return handler(sql, args ?? {});
  });

  return server;
}

// ─── HTTP JSON-RPC Handler ───────────────────────────────────────────

export function createMcpHttpHandler(sql: any) {
  return async (body: any): Promise<any> => {
    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== "2.0") {
      return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid Request" } };
    }

    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      const handler = HANDLER_MAP[toolName];
      if (!handler) {
        return { jsonrpc: "2.0", id, result: err(`Unknown tool: ${toolName}`) };
      }
      const result = await handler(sql, toolArgs);
      return { jsonrpc: "2.0", id, result };
    }

    return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: "Method not found" } };
  };
}
