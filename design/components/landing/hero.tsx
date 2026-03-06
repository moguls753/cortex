"use client"

import { useEffect, useState } from "react"
import { Terminal, Github, ArrowRight } from "lucide-react"

const TYPING_LINES = [
  '$ cortex capture "Ship the MCP server by Friday"',
  "  Classified: Task (confidence: 0.94)",
  "  Tags: #mcp #shipping #deadline",
  '  Linked to project: "Cortex v2"',
  "",
  "$ cortex search --semantic 'what did I decide about auth?'",
  '  [1] "Use Supabase RLS for row-level security" (0.89)',
  '  [2] "JWT tokens with 7-day expiry" (0.84)',
  '  [3] "Move to passkeys in Q3" (0.76)',
]

export function Hero() {
  const [visibleLines, setVisibleLines] = useState(0)

  useEffect(() => {
    if (visibleLines < TYPING_LINES.length) {
      const delay = TYPING_LINES[visibleLines] === "" ? 300 : 80 + Math.random() * 120
      const timer = setTimeout(() => setVisibleLines((v) => v + 1), delay)
      return () => clearTimeout(timer)
    }
  }, [visibleLines])

  return (
    <section className="relative overflow-hidden">
      {/* Subtle grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-12 px-6 pb-24 pt-32">
        {/* Badge */}
        <div className="flex items-center gap-2 rounded-sm border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span>Self-hosted. Agent-readable. Your data.</span>
        </div>

        {/* Heading */}
        <div className="flex max-w-3xl flex-col items-center gap-6 text-center">
          <h1 className="text-balance text-4xl font-bold tracking-tight text-foreground md:text-6xl">
            Your brain,
            <br />
            <span className="text-primary">as an operating system</span>
          </h1>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
            Capture thoughts from Telegram, a web editor, or any AI tool.
            Cortex classifies, embeds, and exposes everything via MCP &mdash; so every AI you use can read your mind.
          </p>
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <a
            href="#get-started"
            className="group flex items-center gap-2 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-sm border border-border bg-secondary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Github className="h-4 w-4" />
            View on GitHub
          </a>
        </div>

        {/* Terminal animation */}
        <div className="w-full max-w-2xl">
          <div className="rounded-sm border border-border bg-card">
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                <div className="h-2.5 w-2.5 rounded-full bg-accent/60" />
                <div className="h-2.5 w-2.5 rounded-full bg-primary/60" />
              </div>
              <span className="ml-2 text-xs text-muted-foreground">cortex</span>
            </div>

            {/* Terminal content */}
            <div className="p-4 text-xs leading-6 md:text-sm md:leading-7">
              {TYPING_LINES.slice(0, visibleLines).map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {line.startsWith("$") ? (
                    <>
                      <span className="text-primary">{"$"}</span>
                      <span className="text-foreground">{line.slice(1)}</span>
                    </>
                  ) : line.startsWith("  [") ? (
                    <span className="text-accent">{line}</span>
                  ) : line.startsWith("  ") ? (
                    <span className="text-muted-foreground">{line}</span>
                  ) : (
                    <span>{line}</span>
                  )}
                </div>
              ))}
              {visibleLines < TYPING_LINES.length && (
                <span className="inline-block h-4 w-2 animate-pulse bg-primary" />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
