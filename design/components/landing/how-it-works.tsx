const STEPS = [
  {
    number: "01",
    title: "Capture",
    description:
      "Send a Telegram message (text or voice), write a note in the web dashboard, or add a thought from any AI tool via MCP.",
    code: `$ cortex capture "Look into Vercel's
  new edge middleware for auth"

  Received. Processing...`,
  },
  {
    number: "02",
    title: "Classify",
    description:
      "An LLM sorts your thought into one of five categories and extracts structured fields. Context-aware: it uses recent and similar entries to improve accuracy.",
    code: `  Category: Idea (confidence: 0.91)
  Tags: #vercel #auth #edge
  Related: "Auth architecture notes"
  
  Stored with embedding.`,
  },
  {
    number: "03",
    title: "Store",
    description:
      "Everything goes into PostgreSQL with vector embeddings for semantic search. Your data, your server. Soft delete with trash and restore.",
    code: `  INSERT INTO entries (
    content, category, embedding,
    tags, metadata, created_at
  ) VALUES ($1, $2, $3, $4, $5, NOW())
  
  1 row inserted.`,
  },
  {
    number: "04",
    title: "Access",
    description:
      "Browse and search from the web dashboard, get daily/weekly digests by email, or let any MCP-compatible AI tool query your brain.",
    code: `$ mcp query cortex.search(
    "authentication decisions"
  )
  
  Returning 3 entries (semantic)...`,
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        {/* Section header */}
        <div className="mb-16 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-primary">
            How it works
          </p>
          <h2 className="text-balance text-2xl font-bold text-foreground md:text-3xl">
            Four steps. Zero friction.
          </h2>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            Cortex is designed around a simple pipeline: capture, classify,
            store, access. Every step is automatic.
          </p>
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-px overflow-hidden rounded-sm border border-border bg-border">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="flex flex-col gap-6 bg-card p-6 md:flex-row md:items-start md:gap-12"
            >
              {/* Left: info */}
              <div className="flex flex-1 flex-col gap-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-xs font-bold text-primary">
                    {step.number}
                  </span>
                  <h3 className="text-lg font-bold text-foreground">
                    {step.title}
                  </h3>
                </div>
                <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>

              {/* Right: code block */}
              <div className="flex-1">
                <div className="rounded-sm border border-border bg-background p-4">
                  <pre className="overflow-x-auto text-xs leading-6 text-muted-foreground">
                    <code>{step.code}</code>
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
