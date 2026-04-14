import type postgres from "postgres";
import { generateEmbedding } from "./embed.js";
import { createLLMProvider } from "./llm/index.js";
import { getLLMConfig } from "./llm/config.js";
import { resolveConfigValue } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("task-completion");

const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
const MAX_COMPLETIONS_PER_MESSAGE = 3;
const CANDIDATE_LIMIT = 5;
const SIMILARITY_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Semantic search for pending task candidates
// ---------------------------------------------------------------------------

export async function findPendingTaskCandidates(
  embedding: number[],
  sql: postgres.Sql,
): Promise<
  Array<{ id: string; name: string; content: string; similarity: number }>
> {
  const vecStr = `[${embedding.join(",")}]`;

  const rows = await sql`
    SELECT id, name, content,
           1 - (embedding <=> ${vecStr}::vector) AS similarity
    FROM entries
    WHERE category = 'tasks'
      AND fields->>'status' = 'pending'
      AND deleted_at IS NULL
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${vecStr}::vector) >= ${SIMILARITY_THRESHOLD}
    ORDER BY similarity DESC
    LIMIT ${CANDIDATE_LIMIT}
  `;
  return rows as unknown as Array<{
    id: string;
    name: string;
    content: string;
    similarity: number;
  }>;
}

// ---------------------------------------------------------------------------
// Second LLM call — match candidates to the new thought
// ---------------------------------------------------------------------------

function buildMatchPrompt(
  candidates: Array<{ id: string; name: string; content: string }>,
  thoughtText: string,
): string {
  const taskList = candidates
    .map(
      (c) =>
        `- ID: ${c.id}\n  Name: ${c.name}\n  Content: ${c.content ?? c.name}`,
    )
    .join("\n");

  return `You are analyzing whether a new thought implies the completion of one or more pending tasks.

New thought: "${thoughtText}"

Pending tasks:
${taskList}

For each task that the new thought indicates was completed — either explicitly ("I called the landlord") or implicitly ("The landlord said the apartment is available") — return it as a match with a confidence score between 0.0 and 1.0.

Return ONLY valid JSON in this exact format:
{"matches": [{"entry_id": "<task-id>", "confidence": <score>}]}

If no tasks were completed, return: {"matches": []}`;
}

export async function matchCompletedTasks(
  candidates: Array<{ id: string; name: string; content: string }>,
  thoughtText: string,
  llmConfig: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
  },
  _sql: postgres.Sql,
): Promise<Array<{ entry_id: string; confidence: number }>> {
  const provider = createLLMProvider(llmConfig);
  const prompt = buildMatchPrompt(candidates, thoughtText);

  try {
    const response = await provider.chat(prompt);

    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    const matches = parsed.matches;
    if (!Array.isArray(matches)) return [];

    return matches
      .filter(
        (m: unknown): m is { entry_id: string; confidence: number } =>
          typeof m === "object" &&
          m !== null &&
          typeof (m as Record<string, unknown>).entry_id === "string" &&
          typeof (m as Record<string, unknown>).confidence === "number",
      )
      .map((m) => ({
        entry_id: m.entry_id,
        confidence: Math.max(0, Math.min(1, m.confidence)),
      }));
  } catch (error) {
    log.warn("Task completion matching LLM call failed", {
      error: (error as Error).message,
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Apply completions — confidence gating
// ---------------------------------------------------------------------------

export async function applyTaskCompletions(
  matches: Array<{ entry_id: string; confidence: number }>,
  confidenceThreshold: number,
  sql: postgres.Sql,
): Promise<{
  autoCompleted: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
  needsConfirmation: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
}> {
  const autoCompleted: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }> = [];
  const needsConfirmation: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }> = [];

  for (const match of matches) {
    const rows = await sql`
      SELECT name FROM entries WHERE id = ${match.entry_id}
    `;
    const name =
      rows.length > 0
        ? ((rows[0] as { name: string }).name ?? "Unknown")
        : "Unknown";

    if (match.confidence >= confidenceThreshold) {
      await sql`
        UPDATE entries
        SET fields = jsonb_set(fields, '{status}', '"done"'),
            updated_at = NOW()
        WHERE id = ${match.entry_id}
          AND category = 'tasks'
          AND fields->>'status' = 'pending'
      `;
      autoCompleted.push({
        entry_id: match.entry_id,
        name,
        confidence: match.confidence,
      });
    } else {
      needsConfirmation.push({
        entry_id: match.entry_id,
        name,
        confidence: match.confidence,
      });
    }
  }

  return { autoCompleted, needsConfirmation };
}

// ---------------------------------------------------------------------------
// Confirm / undo task completion
// ---------------------------------------------------------------------------

export async function confirmTaskCompletion(
  entryId: string,
  sql: postgres.Sql,
): Promise<void> {
  await sql`
    UPDATE entries
    SET fields = jsonb_set(fields, '{status}', '"done"'),
        updated_at = NOW()
    WHERE id = ${entryId}
      AND category = 'tasks'
  `;
}

export async function undoTaskCompletion(
  entryId: string,
  sql: postgres.Sql,
): Promise<void> {
  await sql`
    UPDATE entries
    SET fields = jsonb_set(fields, '{status}', '"pending"'),
        updated_at = NOW()
    WHERE id = ${entryId}
      AND category = 'tasks'
      AND fields->>'status' = 'done'
  `;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function detectTaskCompletion(
  text: string,
  classificationResult: {
    category: string | null;
    name: string | null;
    confidence: number | null;
    is_task_completion: boolean;
    fields: Record<string, unknown>;
    tags: string[];
  },
  sql: postgres.Sql,
  newEntryId?: string,
): Promise<{
  autoCompleted: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
  needsConfirmation: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
  reclassifiedCategory: string | null;
}> {
  const empty = { autoCompleted: [], needsConfirmation: [], reclassifiedCategory: null };

  if (!classificationResult.is_task_completion) {
    return empty;
  }

  const embedding = await generateEmbedding(text);
  if (!embedding) {
    log.warn("Could not generate embedding for task completion search");
    return empty;
  }

  const candidates = await findPendingTaskCandidates(embedding, sql);
  if (candidates.length === 0) {
    return empty;
  }

  const llmConfigRaw = await getLLMConfig(sql);
  const llmConfig = {
    provider: llmConfigRaw.provider,
    apiKey: llmConfigRaw.apiKeys[llmConfigRaw.provider] ?? "",
    model: llmConfigRaw.model,
    baseUrl: llmConfigRaw.baseUrl?.trim() || undefined,
  };

  const candidateList = candidates.map((c) => ({ id: c.id, name: c.name, content: c.content }));
  let matches = await matchCompletedTasks(
    candidateList,
    text,
    llmConfig,
    sql,
  );

  // Filter out hallucinated entry_ids not in the candidate set
  const candidateIds = new Set(candidateList.map((c) => c.id));
  matches = matches.filter((m) => candidateIds.has(m.entry_id));

  // Limit to top N by confidence
  matches = matches
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_COMPLETIONS_PER_MESSAGE);

  if (matches.length === 0) {
    return empty;
  }

  const thresholdStr = await resolveConfigValue("confidence_threshold", sql);
  const threshold = thresholdStr
    ? parseFloat(thresholdStr)
    : DEFAULT_CONFIDENCE_THRESHOLD;

  const result = await applyTaskCompletions(matches, threshold, sql);

  // If tasks were auto-completed and the new entry was classified as "tasks",
  // reclassify it to "reference" — a completion report is not a new task.
  let reclassifiedCategory: string | null = null;
  if (
    newEntryId &&
    result.autoCompleted.length > 0 &&
    classificationResult.category === "tasks"
  ) {
    reclassifiedCategory = "reference";
    await sql`
      UPDATE entries
      SET category = 'reference',
          fields = jsonb_build_object('notes', COALESCE(fields->>'notes', ''))
      WHERE id = ${newEntryId}
    `;
  }

  return { ...result, reclassifiedCategory };
}

// ---------------------------------------------------------------------------
// Reply message formatting
// ---------------------------------------------------------------------------

export function formatCompletionReply(options: {
  classificationText: string;
  autoCompleted: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
  needsConfirmation: Array<{
    entry_id: string;
    name: string;
    confidence: number;
  }>;
}): {
  text: string;
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
} {
  let text = options.classificationText;

  for (const task of options.autoCompleted) {
    text += `\n✅ Marked '${task.name}' as done.`;
  }

  let inlineKeyboard:
    | Array<Array<{ text: string; callback_data: string }>>
    | undefined;

  if (options.needsConfirmation.length > 0) {
    inlineKeyboard = [];
    for (const task of options.needsConfirmation) {
      text += `\nDid this complete '${task.name}'?`;
      inlineKeyboard.push([
        {
          text: "Yes",
          callback_data: `task_complete_yes:${task.entry_id}`,
        },
        {
          text: "No",
          callback_data: `task_complete_no:${task.entry_id}`,
        },
      ]);
    }
  }

  return { text, ...(inlineKeyboard ? { inlineKeyboard } : {}) };
}
