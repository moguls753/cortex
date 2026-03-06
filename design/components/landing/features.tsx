import {
  MessageSquare,
  Brain,
  Search,
  Mail,
  Pencil,
  Wrench,
  Shield,
  Globe,
} from "lucide-react"

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Capture anywhere",
    description:
      "Telegram bot (text + voice), web dashboard with markdown editor, or any MCP client like Claude and Cursor.",
  },
  {
    icon: Brain,
    title: "AI classification",
    description:
      "Every thought is sorted into People, Projects, Tasks, Ideas, or Reference with confidence scoring. Low-confidence entries get inline correction buttons.",
  },
  {
    icon: Search,
    title: "Semantic search",
    description:
      "Vector embeddings via pgvector + snowflake-arctic-embed2. Ask questions in natural language, get ranked results by meaning.",
  },
  {
    icon: Mail,
    title: "Daily & weekly digests",
    description:
      "Morning briefing with top priorities and stuck items. Weekly review with activity summary, open loops, and recurring themes.",
  },
  {
    icon: Pencil,
    title: "Full markdown editor",
    description:
      "Write long-form notes in the web dashboard. Everything is stored in PostgreSQL, searchable, and exposed via MCP.",
  },
  {
    icon: Wrench,
    title: "MCP server",
    description:
      "7 tools for full CRUD access. Any MCP-compatible AI tool can read, write, search, and manage your second brain.",
  },
  {
    icon: Shield,
    title: "Self-hosted & private",
    description:
      "Your data lives on your server. PostgreSQL, local embeddings, local voice transcription. No SaaS middlemen.",
  },
  {
    icon: Globe,
    title: "Multilingual",
    description:
      "English and German out of the box. Semantic search works across languages because meaning doesn't need translation.",
  },
]

export function Features() {
  return (
    <section id="features" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        {/* Section header */}
        <div className="mb-16 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-primary">
            Features
          </p>
          <h2 className="text-balance text-2xl font-bold text-foreground md:text-3xl">
            Everything your brain needs,
            <br />
            nothing it doesn{"'"}t.
          </h2>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            Cortex is designed to stay out of your way. Capture fast, find
            instantly, and let every AI tool you use tap into what you know.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => {
            const Icon = feature.icon
            return (
              <div
                key={feature.title}
                className="flex flex-col gap-3 bg-card p-6"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-secondary">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
