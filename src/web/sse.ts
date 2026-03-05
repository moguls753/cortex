export interface SSEEvent {
  type: "entry:created" | "entry:updated" | "entry:deleted" | "digest:updated";
  data: Record<string, unknown>;
}

export interface SSEBroadcaster {
  subscribe(listener: (event: SSEEvent) => void): () => void;
  broadcast(event: SSEEvent): void;
}

export function createSSEBroadcaster(): SSEBroadcaster {
  const listeners = new Set<(event: SSEEvent) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    broadcast(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}
