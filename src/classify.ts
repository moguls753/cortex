import type postgres from "postgres";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLLMProvider } from "./llm/index.js";
import { generateEmbedding } from "./embed.js";
import { createLogger } from "./logger.js";
import { sleep } from "./sleep.js";

const log = createLogger("classify");

const VALID_CATEGORIES = [
  "people",
  "projects",
  "tasks",
  "ideas",
  "reference",
] as const;

type Category = (typeof VALID_CATEGORIES)[number];

const MAX_INPUT_LENGTH = 50_000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
const CONTEXT_SNIPPET_LENGTH = 200;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function validateClassificationResponse(raw: string): {
  category: string;
  name: string;
  confidence: number;
  fields: Record<string, unknown>;
  tags: string[];
  create_calendar_event: boolean;
  calendar_date: string | null;
} | null {
  // Extract JSON from response — LLMs often wrap in markdown code fences
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const { category, name, confidence, fields, tags, create_calendar_event, calendar_date } = parsed;

  // category
  if (typeof category !== "string" || !(VALID_CATEGORIES as readonly string[]).includes(category)) {
    return null;
  }

  // name
  if (typeof name !== "string") return null;

  // confidence — coerce numeric strings
  let conf: number;
  if (typeof confidence === "number") {
    conf = confidence;
  } else if (typeof confidence === "string") {
    conf = Number(confidence);
    if (isNaN(conf)) return null;
  } else {
    return null;
  }
  if (conf < 0 || conf > 1) return null;

  // fields
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return null;
  }

  // tags
  if (!Array.isArray(tags)) return null;

  // create_calendar_event
  const calEvent = typeof create_calendar_event === "boolean" ? create_calendar_event : false;

  // calendar_date
  const calDate = typeof calendar_date === "string" ? calendar_date : null;

  return {
    category: category as Category,
    name: name as string,
    confidence: conf,
    fields: fields as Record<string, unknown>,
    tags: tags as string[],
    create_calendar_event: calEvent,
    calendar_date: calDate,
  };
}

export function formatContextEntries(
  entries: Array<{ name: string; category: string; content: string | null }>,
): string {
  if (entries.length === 0) {
    return "No existing entries yet. No context available.";
  }

  return entries
    .map((e) => {
      const snippet =
        e.content && e.content.length > CONTEXT_SNIPPET_LENGTH
          ? e.content.substring(0, CONTEXT_SNIPPET_LENGTH)
          : (e.content ?? "");
      return `- ${e.name} [${e.category}]: ${snippet}`;
    })
    .join("\n");
}

export function assemblePrompt(
  template: string,
  contextEntries: string,
  inputText: string,
): string {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const tmrw = new Date(now);
  tmrw.setDate(tmrw.getDate() + 1);
  const tomorrow = tmrw.toISOString().split("T")[0];
  return template
    .replace(/\{today\}/g, today)
    .replace(/\{tomorrow\}/g, tomorrow)
    .replace("{context_entries}", contextEntries)
    .replace("{input_text}", inputText);
}

export function resolveConfidenceThreshold(settingsValue?: string | null): number {
  if (settingsValue === undefined || settingsValue === null) {
    return DEFAULT_CONFIDENCE_THRESHOLD;
  }

  const parsed = Number(settingsValue);
  if (isNaN(parsed)) {
    return DEFAULT_CONFIDENCE_THRESHOLD;
  }

  if (parsed < 0) {
    log.warn("Confidence threshold below 0, clamping to 0.0", { raw: settingsValue });
    return 0.0;
  }
  if (parsed > 1) {
    log.warn("Confidence threshold above 1.0, clamping to 1.0", { raw: settingsValue });
    return 1.0;
  }

  return parsed;
}

export function isConfident(confidence: number, threshold: number): boolean {
  return confidence >= threshold;
}

// ---------------------------------------------------------------------------
// Prompt loading (re-read each call — no caching)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadPromptTemplate(): Promise<string> {
  const promptPath = resolve(__dirname, "..", "prompts", "classify.md");
  return readFile(promptPath, "utf-8");
}

// ---------------------------------------------------------------------------
// Context gathering (DB)
// ---------------------------------------------------------------------------

export async function getRecentEntries(
  sql: postgres.Sql,
): Promise<Array<{ id: string; name: string; category: string | null; content: string | null }>> {
  const rows = await sql`
    SELECT id, name, category, content
    FROM entries
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 5
  `;
  return rows as unknown as Array<{ id: string; name: string; category: string | null; content: string | null }>;
}

export async function getSimilarEntries(
  sql: postgres.Sql,
  text: string,
): Promise<Array<{ id: string; name: string; category: string | null; content: string | null }>> {
  const embedding = await generateEmbedding(text);
  if (!embedding) return [];

  const vecStr = `[${embedding.join(",")}]`;
  const rows = await sql`
    SELECT id, name, category, content,
           1 - (embedding <=> ${vecStr}::vector) AS similarity
    FROM entries
    WHERE deleted_at IS NULL
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${vecStr}::vector) >= 0.5
    ORDER BY similarity DESC
    LIMIT 3
  `;
  return rows as unknown as Array<{ id: string; name: string; category: string | null; content: string | null }>;
}

export async function assembleContext(
  sql: postgres.Sql,
  text: string,
): Promise<Array<{ id: string; name: string; category: string | null; content: string | null }>> {
  const [recent, similar] = await Promise.all([
    getRecentEntries(sql),
    getSimilarEntries(sql, text),
  ]);

  const seen = new Set<string>();
  const result: Array<{ id: string; name: string; category: string | null; content: string | null }> = [];

  for (const entry of [...recent, ...similar]) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      result.push(entry);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Classification (text-only, no DB writes)
// ---------------------------------------------------------------------------

export async function classifyText(
  text: string,
  options?: {
    entryId?: string;
    contextEntries?: Array<{ name: string; category: string | null; content: string | null }>;
  },
): Promise<{
  category: string | null;
  name: string | null;
  confidence: number | null;
  fields: Record<string, unknown>;
  tags: string[];
  create_calendar_event?: boolean;
  calendar_date?: string | null;
  content: string;
} | null> {
  const provider = createLLMProvider({
    provider: process.env.LLM_PROVIDER || "anthropic",
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
    baseUrl: process.env.LLM_BASE_URL || undefined,
  });

  let template: string;
  try {
    template = await loadPromptTemplate();
  } catch {
    log.error("Failed to load classification prompt template");
    return null;
  }

  // Truncate very long input
  let inputText = text;
  if (inputText.length > MAX_INPUT_LENGTH) {
    inputText = inputText.substring(0, MAX_INPUT_LENGTH);
  }

  // Format context entries if provided
  const contextStr = options?.contextEntries
    ? formatContextEntries(
        options.contextEntries.map((e) => ({
          name: e.name,
          category: e.category ?? "unclassified",
          content: e.content,
        })),
      )
    : "";

  const prompt = assemblePrompt(template, contextStr, inputText);

  let response: string;
  try {
    response = await provider.chat(prompt);
  } catch (error) {
    const err = error as Error & { status?: number };
    log.error("Classification LLM request failed", {
      status: err.status ?? null,
      error: err.message,
      entryId: options?.entryId ?? null,
      inputLength: text.length,
    });
    return null;
  }

  const validated = validateClassificationResponse(response);
  if (!validated) {
    return null;
  }

  return {
    category: validated.category,
    name: validated.name,
    confidence: validated.confidence,
    fields: validated.fields,
    tags: validated.tags,
    create_calendar_event: validated.create_calendar_event,
    calendar_date: validated.calendar_date,
    content: text,
  };
}

// ---------------------------------------------------------------------------
// classifyEntry — classify + write to DB
// ---------------------------------------------------------------------------

export async function classifyEntry(
  sql: postgres.Sql,
  entryId: string,
): Promise<void> {
  const rows = await sql`SELECT name, content FROM entries WHERE id = ${entryId}`;
  if (rows.length === 0) {
    log.error("Entry not found for classification", { entryId });
    return;
  }

  const entry = rows[0] as { name: string; content: string | null };
  const text = entry.content || entry.name;

  // Gather context
  const contextEntries = await assembleContext(sql, text);

  // Load prompt
  let template: string;
  try {
    template = await loadPromptTemplate();
  } catch {
    log.error("Failed to load classification prompt template");
    return;
  }

  // Format context
  const contextStr = formatContextEntries(
    contextEntries
      .filter((e) => e.id !== entryId)
      .map((e) => ({
        name: e.name,
        category: e.category ?? "unclassified",
        content: e.content,
      })),
  );

  // Truncate input
  let inputText = text;
  if (inputText.length > MAX_INPUT_LENGTH) {
    inputText = inputText.substring(0, MAX_INPUT_LENGTH);
  }

  const prompt = assemblePrompt(template, contextStr, inputText);

  const provider = createLLMProvider({
    provider: process.env.LLM_PROVIDER || "anthropic",
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
    baseUrl: process.env.LLM_BASE_URL || undefined,
  });

  let response: string;
  try {
    response = await provider.chat(prompt);
  } catch (error) {
    const err = error as Error & { status?: number };
    log.error("Classification failed for entry", {
      entryId,
      status: err.status ?? null,
      error: err.message,
    });
    return;
  }

  const validated = validateClassificationResponse(response);
  if (!validated) {
    log.error("Invalid classification response for entry", { entryId });
    return;
  }

  // Update entry — do NOT store calendar fields
  await sql`
    UPDATE entries SET
      category = ${validated.category},
      name = ${validated.name},
      confidence = ${validated.confidence},
      fields = ${JSON.stringify(validated.fields)}::jsonb,
      tags = ${validated.tags}
    WHERE id = ${entryId}
  `;
}

// ---------------------------------------------------------------------------
// Retry failed classifications
// ---------------------------------------------------------------------------

export async function retryFailedClassifications(
  sql: postgres.Sql,
): Promise<void> {
  const entries = await sql`
    SELECT id, name, content FROM entries
    WHERE category IS NULL AND deleted_at IS NULL
    ORDER BY created_at ASC
  `;

  if (entries.length === 0) return;

  let template: string;
  try {
    template = await loadPromptTemplate();
  } catch {
    log.error("Failed to load classification prompt template during retry");
    return;
  }

  // Gather context for all entries up front
  const prepared: Array<{ id: string; prompt: string }> = [];
  for (const entry of entries) {
    const entryId = entry.id as string;
    const text = (entry.content as string | null) || (entry.name as string);

    const contextEntries = await assembleContext(sql, text);
    const contextStr = formatContextEntries(
      contextEntries
        .filter((e) => e.id !== entryId)
        .map((e) => ({
          name: e.name,
          category: e.category ?? "unclassified",
          content: e.content,
        })),
    );

    let inputText = text;
    if (inputText.length > MAX_INPUT_LENGTH) {
      inputText = inputText.substring(0, MAX_INPUT_LENGTH);
    }

    prepared.push({ id: entryId, prompt: assemblePrompt(template, contextStr, inputText) });
  }

  // LLM calls with exponential backoff on 429s
  let backoffMs = 1_000;

  for (const { id, prompt } of prepared) {
    const provider = createLLMProvider({
      provider: process.env.LLM_PROVIDER || "anthropic",
      apiKey: process.env.LLM_API_KEY || "",
      model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
      baseUrl: process.env.LLM_BASE_URL || undefined,
    });

    let response: string;
    try {
      response = await provider.chat(prompt);
    } catch (error) {
      const err = error as Error & { status?: number };
      log.error("Retry classification failed for entry", {
        entryId: id,
        status: err.status ?? null,
        error: err.message,
      });

      if (err.status === 429) {
        await sleep(backoffMs);
        backoffMs *= 2;
      }
      continue;
    }

    // Reset backoff on success
    backoffMs = 1_000;

    const validated = validateClassificationResponse(response);
    if (!validated) {
      log.error("Invalid retry classification response", { entryId: id });
      continue;
    }

    await sql`
      UPDATE entries SET
        category = ${validated.category},
        name = ${validated.name},
        confidence = ${validated.confidence},
        fields = ${JSON.stringify(validated.fields)}::jsonb,
        tags = ${validated.tags}
      WHERE id = ${id}
    `;
  }
}

// ---------------------------------------------------------------------------
// reclassifyEntry — re-classify with correction context
// ---------------------------------------------------------------------------

export async function reclassifyEntry(
  content: string,
  correctionCategory: string | null,
  correctionText: string,
): Promise<{
  category: string;
  name: string;
  confidence: number;
  fields: Record<string, unknown>;
  tags: string[];
} | null> {
  const provider = createLLMProvider({
    provider: process.env.LLM_PROVIDER || "anthropic",
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
    baseUrl: process.env.LLM_BASE_URL || undefined,
  });

  let template: string;
  try {
    template = await loadPromptTemplate();
  } catch {
    log.error("Failed to load classification prompt template for reclassify");
    return null;
  }

  const correctionContext = correctionCategory
    ? `\n\nUser correction: The user has indicated this should be categorized as "${correctionCategory}". ${correctionText}`
    : `\n\nUser correction: ${correctionText}`;

  const inputText = content + correctionContext;
  const prompt = assemblePrompt(template, "", inputText);

  let response: string;
  try {
    response = await provider.chat(prompt);
  } catch (error) {
    const err = error as Error;
    log.error("Reclassification LLM request failed", { error: err.message });
    return null;
  }

  const validated = validateClassificationResponse(response);
  if (!validated) return null;

  return {
    category: validated.category,
    name: validated.name,
    confidence: validated.confidence,
    fields: validated.fields,
    tags: validated.tags,
  };
}
