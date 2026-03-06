"use client"

import { useState } from "react"
import { CornerDownLeft } from "lucide-react"

export function QuickCapture() {
  const [value, setValue] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim()) return
    setIsProcessing(true)
    setTimeout(() => {
      setValue("")
      setIsProcessing(false)
    }, 1200)
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-colors">
        <span className="text-primary text-sm select-none shrink-0">{">"}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="capture a thought..."
          disabled={isProcessing}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
          autoFocus
        />
        <button
          type="submit"
          disabled={!value.trim() || isProcessing}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors shrink-0"
        >
          <CornerDownLeft className="size-3.5" />
        </button>
      </div>
      {isProcessing && (
        <div className="absolute -bottom-5 left-3 text-[11px] text-primary animate-pulse">
          classifying...
        </div>
      )}
    </form>
  )
}
