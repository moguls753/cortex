import { Header } from "@/components/dashboard/header"
import { QuickCapture } from "@/components/dashboard/quick-capture"
import { Digest } from "@/components/dashboard/digest"
import { Stats } from "@/components/dashboard/stats"
import { RecentEntries } from "@/components/dashboard/recent-entries"
import { StatusBar } from "@/components/dashboard/status-bar"

export default function DashboardPage() {
  return (
    <div className="h-dvh flex flex-col px-6 py-4 gap-4 max-w-5xl mx-auto w-full">
      <Header />

      {/* Digest -- full width, the hero, the morning briefing */}
      <div className="flex-1 min-h-0 rounded-md border border-border bg-card p-6 flex flex-col">
        <Digest />
      </div>

      {/* Secondary row: capture + stats + recent entries */}
      <div className="shrink-0 flex flex-col gap-3">
        <QuickCapture />
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-4">
            <Stats />
          </div>
          <div className="col-span-8 rounded-md border border-border bg-card px-4 py-3 max-h-36 overflow-y-auto scrollbar-thin">
            <RecentEntries />
          </div>
        </div>
      </div>

      <StatusBar />
    </div>
  )
}
