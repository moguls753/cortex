/**
 * Test helpers for mocking Ollama HTTP API responses.
 * Used by embedding tests to simulate Ollama behavior without a real server.
 */

/**
 * Generate a deterministic fake embedding vector.
 * Uses Math.sin for reproducibility — same dim always produces the same values.
 */
export function createFakeEmbedding(dim = 4096): number[] {
  return Array.from({ length: dim }, (_, i) => Math.sin(i) * 0.5);
}

/**
 * Create a successful /api/embed JSON response.
 */
export function createEmbedResponse(embedding?: number[]): Response {
  const vec = embedding ?? createFakeEmbedding();
  return new Response(JSON.stringify({ embeddings: [vec] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create a /api/tags response listing the specified model names.
 */
export function createTagsResponse(models: string[]): Response {
  return new Response(
    JSON.stringify({
      models: models.map((name) => ({ name, model: name })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Create a /api/pull success response.
 */
export function createPullResponse(): Response {
  return new Response(JSON.stringify({ status: "success" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create an error response from Ollama.
 */
export function createErrorResponse(
  status: number,
  message: string,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create a URL-based fetch router for multi-endpoint scenarios.
 * Routes requests by URL path suffix to return appropriate mock responses.
 *
 * Usage:
 *   fetchSpy.mockImplementation(createOllamaRouter({ tagsModels: [...] }));
 */
export function createOllamaRouter(options: {
  tagsModels?: string[];
  embedResult?: number[] | "error";
  pullResult?: "success" | "error";
}): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("/api/tags")) {
      return createTagsResponse(options.tagsModels ?? []);
    }
    if (url.includes("/api/pull")) {
      if (options.pullResult === "error") {
        return createErrorResponse(500, "pull failed");
      }
      return createPullResponse();
    }
    if (url.includes("/api/embed")) {
      if (options.embedResult === "error") {
        return createErrorResponse(500, "model not found");
      }
      return createEmbedResponse(
        Array.isArray(options.embedResult) ? options.embedResult : undefined,
      );
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  };
}
