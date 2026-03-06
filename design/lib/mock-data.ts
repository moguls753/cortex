export type Category = "people" | "projects" | "tasks" | "ideas" | "reference"

export interface Entry {
  id: string
  category: Category
  name: string
  content: string
  fields: Record<string, string | null>
  tags: string[]
  confidence: number | null
  source: "telegram" | "webapp" | "mcp"
  source_type: "text" | "voice"
  created_at: string
  updated_at: string
}

export const CATEGORY_COLORS: Record<Category, string> = {
  people: "text-blue-400",
  projects: "text-primary",
  tasks: "text-accent",
  ideas: "text-pink-400",
  reference: "text-muted-foreground",
}

export const CATEGORY_BG: Record<Category, string> = {
  people: "bg-blue-400/10 text-blue-400",
  projects: "bg-primary/10 text-primary",
  tasks: "bg-accent/10 text-accent",
  ideas: "bg-pink-400/10 text-pink-400",
  reference: "bg-muted text-muted-foreground",
}

export const mockDigest = {
  generated_at: "2026-03-05T07:30:00Z",
  content: `Good morning

TOP 3 TODAY
  Confirm copy deadline with Sarah Chen -- Website Relaunch is blocked until she signs off. She mentioned at the conference she is considering consulting; this might affect the timeline.
  Renew passport -- expires April 17, only 12 days until the deadline you set. You still need photos and the form.
  Follow up with Marcus Rivera -- you sent the proposal last Tuesday and have not heard back. This is the consulting partnership you flagged as high priority.

STUCK ON
  Cortex project has no defined next action. Last update was 2 days ago: embedding retry cron is working. The open-source target is end of March -- you need to decide on the settings page UI.

SMALL WIN
  You captured 8 thoughts yesterday across Telegram and the web editor. That is a 5-day streak. Most were classified with >85% confidence.`,
}

export const mockStats = {
  entries_this_week: 23,
  open_tasks: 7,
  stalled_projects: 1,
  total_entries: 342,
}

export const mockEntries: Entry[] = [
  {
    id: "a1",
    category: "tasks",
    name: "Renew passport",
    content: "Passport expires April 17. Need photos and the form.",
    fields: { due_date: "2026-04-01", status: "pending", notes: "Need photos too" },
    tags: ["admin", "urgent"],
    confidence: 0.92,
    source: "telegram",
    source_type: "text",
    created_at: "2026-03-05T09:12:00Z",
    updated_at: "2026-03-05T09:12:00Z",
  },
  {
    id: "a2",
    category: "people",
    name: "Sarah Chen",
    content: "Sarah mentioned she's considering moving to the consulting side. Wants to chat next week.",
    fields: { context: "Product lead at Acme, met at conference", follow_ups: "Ask about Q2 roadmap next call" },
    tags: ["acme", "product"],
    confidence: 0.88,
    source: "telegram",
    source_type: "voice",
    created_at: "2026-03-05T08:45:00Z",
    updated_at: "2026-03-05T08:45:00Z",
  },
  {
    id: "a3",
    category: "projects",
    name: "Website Relaunch",
    content: "Need to finalize the copy and send to design by Friday.",
    fields: { status: "active", next_action: "Email Sarah to confirm copy deadline", notes: "Launch target end of Q2" },
    tags: ["website", "q2"],
    confidence: 0.95,
    source: "webapp",
    source_type: "text",
    created_at: "2026-03-04T17:30:00Z",
    updated_at: "2026-03-04T17:30:00Z",
  },
  {
    id: "a4",
    category: "ideas",
    name: "MCP for local files",
    content: "What if Cortex could also index local markdown files via an MCP bridge?",
    fields: { oneliner: "Local file indexing via MCP bridge", notes: "Could watch a folder and auto-embed" },
    tags: ["cortex", "mcp"],
    confidence: 0.78,
    source: "telegram",
    source_type: "text",
    created_at: "2026-03-04T14:20:00Z",
    updated_at: "2026-03-04T14:20:00Z",
  },
  {
    id: "a5",
    category: "reference",
    name: "Docker host networking",
    content: "Use host.docker.internal to access host services from inside a container on Mac/Windows.",
    fields: { notes: "Use host.docker.internal to access host from container" },
    tags: ["docker", "devops"],
    confidence: 0.91,
    source: "mcp",
    source_type: "text",
    created_at: "2026-03-04T11:05:00Z",
    updated_at: "2026-03-04T11:05:00Z",
  },
  {
    id: "a6",
    category: "tasks",
    name: "Review Q2 budget draft",
    content: "Finance sent the Q2 budget. Review and send comments by Thursday.",
    fields: { due_date: "2026-03-06", status: "pending", notes: null },
    tags: ["finance"],
    confidence: 0.87,
    source: "telegram",
    source_type: "text",
    created_at: "2026-03-04T09:15:00Z",
    updated_at: "2026-03-04T09:15:00Z",
  },
  {
    id: "a7",
    category: "people",
    name: "Marcus Rivera",
    content: "Sent the proposal last Tuesday. No reply yet.",
    fields: { context: "Freelance consultant, potential partner", follow_ups: "Follow up about the proposal" },
    tags: ["consulting"],
    confidence: 0.83,
    source: "telegram",
    source_type: "text",
    created_at: "2026-03-03T16:40:00Z",
    updated_at: "2026-03-03T16:40:00Z",
  },
  {
    id: "a8",
    category: "projects",
    name: "Cortex",
    content: "Embedding retry cron is working. Next: build the settings page.",
    fields: { status: "active", next_action: "Build settings page UI", notes: "Open source target: end of March" },
    tags: ["cortex", "open-source"],
    confidence: null,
    source: "webapp",
    source_type: "text",
    created_at: "2026-03-03T12:10:00Z",
    updated_at: "2026-03-03T12:10:00Z",
  },
]
