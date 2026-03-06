import { mockEntries, CATEGORY_BG, type Entry } from "@/lib/mock-data"
import { MessageSquare, Globe, Cpu, Mic } from "lucide-react"

function groupByDay(entries: Entry[]): Record<string, Entry[]> {
  const groups: Record<string, Entry[]> = {}
  for (const entry of entries) {
    const date = new Date(entry.created_at)
    const today = new Date("2026-03-05")
    const yesterday = new Date("2026-03-04")

    let key: string
    if (date.toDateString() === today.toDateString()) {
      key = "Today"
    } else if (date.toDateString() === yesterday.toDateString()) {
      key = "Yesterday"
    } else {
      key = date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    }

    if (!groups[key]) groups[key] = []
    groups[key].push(entry)
  }
  return groups
}

function SourceIcon({
  source,
  source_type,
}: {
  source: string
  source_type: string
}) {
  if (source_type === "voice")
    return <Mic className="size-3 text-muted-foreground" />
  if (source === "telegram")
    return <MessageSquare className="size-3 text-muted-foreground" />
  if (source === "mcp")
    return <Cpu className="size-3 text-muted-foreground" />
  return <Globe className="size-3 text-muted-foreground" />
}

export function RecentEntries() {
  const grouped = groupByDay(mockEntries)

  return (
    <div className="flex flex-col min-h-0">
      <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2 shrink-0">
        Recent
      </h2>
      <div className="space-y-3">
        {Object.entries(grouped).map(([day, entries]) => (
          <div key={day}>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              {day}
            </div>
            <div className="space-y-0.5">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  className="w-full flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-secondary transition-colors group"
                >
                  <span
                    className={`text-[9px] uppercase tracking-wide px-1 py-0.5 rounded font-medium shrink-0 ${CATEGORY_BG[entry.category]}`}
                  >
                    {entry.category.slice(0, 3)}
                  </span>
                  <span className="text-xs text-foreground truncate flex-1 group-hover:text-primary transition-colors">
                    {entry.name}
                  </span>
                  <SourceIcon
                    source={entry.source}
                    source_type={entry.source_type}
                  />
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(entry.created_at).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
