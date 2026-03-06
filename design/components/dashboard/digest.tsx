import { mockDigest } from "@/lib/mock-data"
import { Sparkles } from "lucide-react"

export function Digest() {
  const sections = parseDigest(mockDigest.content)
  const date = new Date(mockDigest.generated_at)
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header row */}
      <div className="flex items-baseline justify-between mb-5 shrink-0">
        <div>
          <p className="text-sm text-muted-foreground">{dateStr}</p>
          <h1 className="text-lg font-medium text-foreground mt-0.5 tracking-tight text-balance">
            Good morning. Here is what needs your attention.
          </h1>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Sparkles className="size-3 text-primary" />
          <span>
            Generated{" "}
            {date.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="flex flex-col gap-6">
          {/* Priority items -- the main content */}
          {sections.top3.length > 0 && (
            <div>
              <SectionLabel label="Priority" />
              <div className="mt-3 flex flex-col gap-3">
                {sections.top3.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-md bg-secondary/50 px-4 py-3"
                  >
                    <span className="text-sm text-primary font-medium shrink-0 mt-0.5 w-5 text-right">
                      {i + 1}.
                    </span>
                    <span className="text-sm text-foreground leading-relaxed">
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two-column: stuck + wins side by side */}
          <div className="grid grid-cols-2 gap-6">
            {sections.stuck.length > 0 && (
              <div>
                <SectionLabel label="Needs attention" variant="warn" />
                <ul className="mt-3 space-y-2">
                  {sections.stuck.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 text-sm text-foreground leading-relaxed"
                    >
                      <span className="text-accent shrink-0 mt-0.5">{"--"}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sections.wins.length > 0 && (
              <div>
                <SectionLabel label="Yesterday" />
                <ul className="mt-3 space-y-2">
                  {sections.wins.map((item, i) => (
                    <li
                      key={i}
                      className="text-sm text-muted-foreground leading-relaxed"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({
  label,
  variant = "default",
}: {
  label: string
  variant?: "default" | "warn"
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`text-[10px] font-medium uppercase tracking-widest ${
          variant === "warn" ? "text-accent" : "text-muted-foreground"
        }`}
      >
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function parseDigest(content: string) {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const top3: string[] = []
  const stuck: string[] = []
  const wins: string[] = []

  let section: "greeting" | "top3" | "stuck" | "wins" = "greeting"

  for (const line of lines) {
    if (line.startsWith("TOP 3")) {
      section = "top3"
      continue
    }
    if (line.startsWith("STUCK")) {
      section = "stuck"
      continue
    }
    if (line.startsWith("SMALL WIN")) {
      section = "wins"
      continue
    }
    if (line === "Good morning") continue

    if (section === "top3") top3.push(line)
    else if (section === "stuck") stuck.push(line)
    else if (section === "wins") wins.push(line)
  }

  return { top3, stuck, wins }
}
