import type postgres from "postgres";
import type { SSEBroadcaster, SSEEvent } from "../web/sse.js";
import { createLogger } from "../logger.js";

const log = createLogger("notify");

export async function listenForEntryChanges(
  sql: postgres.Sql,
  broadcaster: SSEBroadcaster,
): Promise<void> {
  await sql.listen("entries_changed", (payload) => {
    try {
      const event = JSON.parse(payload) as SSEEvent;
      broadcaster.broadcast(event);
    } catch {
      log.error("Failed to parse entry change notification", { payload });
    }
  });
}
