import { Terminal, Github } from "lucide-react"

export function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <a href="/" className="flex items-center gap-2 text-foreground">
          <Terminal className="h-5 w-5 text-primary" />
          <span className="text-sm font-bold tracking-tight">CORTEX</span>
        </a>

        <nav className="hidden items-center gap-6 md:flex">
          <a href="#features" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            Features
          </a>
          <a href="#how-it-works" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#architecture" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            Architecture
          </a>
          <a href="#get-started" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            Get started
          </a>
        </nav>

        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Github className="h-4 w-4" />
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </div>
    </header>
  )
}
