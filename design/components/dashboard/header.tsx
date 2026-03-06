import { Brain, Search, Settings, FolderOpen, Trash2 } from "lucide-react"
import { ThemeToggle } from "./theme-toggle"

export function Header() {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <Brain className="size-4 text-primary" />
        <span className="text-sm font-medium text-foreground tracking-tight">cortex</span>
        <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
          v0.1
        </span>
      </div>
      <nav className="flex items-center gap-1">
        <NavItem icon={Search} label="Search" href="/browse" />
        <NavItem icon={FolderOpen} label="Browse" href="/browse" />
        <NavItem icon={Trash2} label="Trash" href="/trash" />
        <NavItem icon={Settings} label="Settings" href="/settings" />
        <ThemeToggle />
      </nav>
    </header>
  )
}

function NavItem({ icon: Icon, label, href }: { icon: React.ComponentType<{ className?: string }>; label: string; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      title={label}
    >
      <Icon className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </a>
  )
}
