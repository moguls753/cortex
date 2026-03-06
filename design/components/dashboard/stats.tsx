import { mockStats } from "@/lib/mock-data"
import { Brain, CheckSquare, AlertTriangle, Zap } from "lucide-react"

const stats = [
  {
    label: "This week",
    value: mockStats.entries_this_week,
    icon: Zap,
    color: "text-primary",
  },
  {
    label: "Total entries",
    value: mockStats.total_entries,
    icon: Brain,
    color: "text-foreground",
  },
  {
    label: "Open tasks",
    value: mockStats.open_tasks,
    icon: CheckSquare,
    color: "text-accent",
  },
  {
    label: "Stalled",
    value: mockStats.stalled_projects,
    icon: AlertTriangle,
    color: "text-destructive",
  },
]

export function Stats() {
  return (
    <div className="grid grid-cols-2 gap-2 h-full">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-card px-2 py-2"
        >
          <stat.icon className={`size-3 ${stat.color}`} />
          <span className={`text-base font-medium leading-none ${stat.color}`}>
            {stat.value}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {stat.label}
          </span>
        </div>
      ))}
    </div>
  )
}
