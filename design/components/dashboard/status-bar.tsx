export function StatusBar() {
  return (
    <footer className="flex items-center justify-between text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          postgres
        </span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          ollama
        </span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          whisper
        </span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          telegram
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span>SSE connected</span>
        <span>uptime 4h 12m</span>
      </div>
    </footer>
  )
}
