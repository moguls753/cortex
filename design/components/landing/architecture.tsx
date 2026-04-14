export function Architecture() {
  return (
    <section id="architecture" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        {/* Section header */}
        <div className="mb-16 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-primary">
            Architecture
          </p>
          <h2 className="text-balance text-2xl font-bold text-foreground md:text-3xl">
            Every piece, under your control.
          </h2>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            Cortex runs entirely on your infrastructure. Swap any component.
            No vendor lock-in.
          </p>
        </div>

        {/* ASCII diagram */}
        <div className="overflow-x-auto rounded-sm border border-border bg-card p-6 md:p-8">
          <pre className="text-xs leading-6 text-muted-foreground md:text-sm md:leading-7">
            <code>{`CAPTURE                    INTELLIGENCE              STORAGE               ACCESS
${"─".repeat(83)}

Telegram Bot ──┐           ┌── LLM Provider           PostgreSQL            Web Dashboard
(text + voice) │           │   (Anthropic, OpenAI,    + pgvector            (browse, search,
               ├── App ────┤    or any compatible)                          edit, settings)
Web Editor ────┘           ├── Ollama
                           │   (local embeddings)     SSE ──────────────── Live updates
MCP Client ────────────────┤
(Claude, Cursor,           └── faster-whisper
 ChatGPT)                      (voice transcription)                       MCP Server
                                                                           (any AI tool)

${"─".repeat(83)}
 Your server              Your choice of model        Your database         Your interfaces`}</code>
          </pre>
        </div>

        {/* Tech stack grid */}
        <div className="mt-8 grid gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-4">
          {[
            {
              label: "Database",
              value: "PostgreSQL + pgvector",
            },
            {
              label: "Embeddings",
              value: "qwen3-embedding",
            },
            {
              label: "Transcription",
              value: "faster-whisper (local)",
            },
            {
              label: "LLM",
              value: "Any OpenAI-compatible",
            },
          ].map((item) => (
            <div key={item.label} className="bg-card p-4">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
