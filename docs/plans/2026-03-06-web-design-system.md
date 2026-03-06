# Web Design System — Terminal / Command Center

| Field | Value |
|-------|-------|
| Date | 2026-03-06 |
| Status | Approved |
| Supersedes | `docs/plans/2026-03-05-web-dashboard-design.md` (Editorial / Journal) |

## Overview

Complete visual identity for the Cortex web interface. Replaces the previous "Editorial / Journal" design with a monospace, information-dense "Terminal / Command Center" aesthetic. Dark-first with a warm light mode. Everything feels like a well-designed TUI running in the browser.

## Implementation Approach

- **Server-rendered HTML** via Hono (no React, no client-side framework)
- **Tailwind CSS v4** via `@tailwindcss/cli`. Input: `src/web/styles.css`. Output: `public/style.css` (gitignored). Build: `npm run build:css`. Watch: `npm run dev:css`.
- **No inline styles.** All styling uses Tailwind utility classes only. oklch tokens and custom components defined in `src/web/styles.css`.
- **Lucide icons** as inline SVGs from a helper module (`src/web/icons.ts`)
- **Vanilla JS** for interactivity: theme toggle, SSE, capture bar
- **Dark/light theme** toggle with `localStorage` persistence

No shadcn/ui, no Radix primitives, no React. The design reference in `design/` uses these but none of the actual components depend on them — it's all Tailwind classes and SVG icons.

## Typography

| Role | Font | Size / Weight | Details |
|------|------|---------------|---------|
| Everything | JetBrains Mono | 400 / 500 | Single font, monospace everywhere |
| Page headings | 18px / 500 | `tracking-tight` | |
| Body / default | 14px (text-sm) / 400 | Standard for most content | |
| Labels / meta | 10px / 500 | `uppercase tracking-widest` | |
| Category badges | 9px / 500 | `uppercase tracking-wide`, colored bg at 10% opacity | |
| Status bar | 10px / 400 | Muted foreground | |

Font loading: Google Fonts `<link>` in `<head>`, weights 400 + 500. Single font replaces the previous three-font stack (Lora, Source Sans 3, IBM Plex Mono).

## Color System

All colors use oklch CSS custom properties, applied via Tailwind's `@theme` directive. The `.dark` class on `<html>` switches between themes.

### Light Theme — Warm Paper with Green Ink

| Token | Value | Role |
|-------|-------|------|
| `--background` | `oklch(0.97 0.005 90)` | Page background (warm cream) |
| `--foreground` | `oklch(0.18 0.01 160)` | Primary text (dark green-black) |
| `--card` | `oklch(0.99 0.003 90)` | Card/surface background |
| `--card-foreground` | `oklch(0.18 0.01 160)` | Card text |
| `--primary` | `oklch(0.45 0.14 155)` | Primary accent (forest green) |
| `--primary-foreground` | `oklch(0.98 0.005 90)` | Text on primary |
| `--secondary` | `oklch(0.93 0.008 90)` | Secondary surface |
| `--secondary-foreground` | `oklch(0.25 0.01 160)` | Text on secondary |
| `--muted` | `oklch(0.93 0.008 90)` | Muted surface |
| `--muted-foreground` | `oklch(0.50 0.01 160)` | Muted text |
| `--accent` | `oklch(0.55 0.12 80)` | Accent (warm amber) |
| `--accent-foreground` | `oklch(0.98 0.005 90)` | Text on accent |
| `--destructive` | `oklch(0.55 0.20 25)` | Destructive actions (red) |
| `--border` | `oklch(0.88 0.008 90)` | Borders and dividers |
| `--input` | `oklch(0.93 0.008 90)` | Input backgrounds |
| `--ring` | `oklch(0.45 0.14 155)` | Focus rings |

### Dark Theme — Terminal Green on Black

| Token | Value | Role |
|-------|-------|------|
| `--background` | `oklch(0.10 0.005 160)` | Page background (near-black green) |
| `--foreground` | `oklch(0.90 0.01 160)` | Primary text (light green-gray) |
| `--card` | `oklch(0.13 0.005 160)` | Card/surface background |
| `--card-foreground` | `oklch(0.90 0.01 160)` | Card text |
| `--primary` | `oklch(0.75 0.15 155)` | Primary accent (bright green) |
| `--primary-foreground` | `oklch(0.10 0.005 160)` | Text on primary |
| `--secondary` | `oklch(0.18 0.005 160)` | Secondary surface |
| `--secondary-foreground` | `oklch(0.85 0.01 160)` | Text on secondary |
| `--muted` | `oklch(0.18 0.005 160)` | Muted surface |
| `--muted-foreground` | `oklch(0.55 0.01 160)` | Muted text |
| `--accent` | `oklch(0.70 0.10 80)` | Accent (warm amber) |
| `--accent-foreground` | `oklch(0.10 0.005 160)` | Text on accent |
| `--destructive` | `oklch(0.55 0.20 25)` | Destructive actions (red) |
| `--border` | `oklch(0.22 0.008 160)` | Borders and dividers |
| `--input` | `oklch(0.18 0.005 160)` | Input backgrounds |
| `--ring` | `oklch(0.75 0.15 155)` | Focus rings |

### Category Badge Colors

| Category | Background | Text |
|----------|-----------|------|
| People | `blue-400` at 10% | `blue-400` |
| Projects | `primary` at 10% | `primary` |
| Tasks | `accent` at 10% | `accent` |
| Ideas | `pink-400` at 10% | `pink-400` |
| Reference | `muted` | `muted-foreground` |

Badges: 3-letter abbreviation (PEO, PRO, TSK, IDE, REF), 9px uppercase, pill-shaped with `rounded` and `px-1 py-0.5`.

## Dashboard Layout

Max-width `max-w-5xl` (~1024px), centered, full viewport height (`h-dvh`), flex column with `gap-4`, padded `px-6 py-4`.

```
+-----------------------------------------------------+
|  brain cortex [v0.1]  Search Browse Trash Settings O |  Header (shrink-0)
+-----------------------------------------------------+
|                                                     |
|  Wednesday, March 5                                 |  Digest hero
|  Good morning. Here is what needs your attention.   |  (flex-1 min-h-0,
|                                                     |   scrollable,
|  -- PRIORITY -----------------------------------    |   border + bg-card
|  1. Confirm copy deadline with Sarah Chen...        |   + rounded-md)
|  2. Renew passport...                               |
|  3. Follow up with Marcus Rivera...                 |
|                                                     |
|  -- NEEDS ATTENTION --    -- YESTERDAY ----------   |  2-col within digest
|  -- Cortex has no...      8 thoughts captured...    |
|                                                     |
+-----------------------------------------------------+
|  > capture a thought...                          <- |  Capture bar (shrink-0)
+------------------+----------------------------------+
|  zap 23  bra 342 |  RECENT                          |  grid-cols-12
|  chk  7  wrn  1  |  Today                           |  col-span-4 | col-span-8
|  (2x2 stat grid) |  TSK Renew passport    mic 09:12 |  max-h-36 overflow-y-auto
|                   |  PEO Sarah Chen        msg 08:45 |
|                   |  ...                             |
+------------------+----------------------------------+
|  * postgres  * ollama  * whisper  * telegram  ...   |  Status bar (shrink-0)
+-----------------------------------------------------+
```

### Component Details

**Header**
- Left: Brain icon (size-4, primary) + "cortex" (text-sm, font-medium, tracking-tight) + version badge (text-[10px], border, rounded, px-1.5 py-0.5, muted-foreground)
- Right: Nav items (Search, Browse, Trash, Settings) as icon + label links. Labels hidden below `sm:`. Each: `rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary`. Icons at size-3.5.
- Far right: Theme toggle button (Sun/Moon, size-3.5)

**Digest**
- Container: `flex-1 min-h-0 rounded-md border border-border bg-card p-6 flex flex-col`
- Top: date (text-sm, muted-foreground) + greeting heading (text-lg, font-medium, tracking-tight, text-balance). Right side: Sparkles icon + "Generated HH:MM" (text-[10px], muted-foreground).
- Body: scrollable (`flex-1 min-h-0 overflow-y-auto scrollbar-thin`)
- Section labels: 10px uppercase tracking-widest + horizontal rule (`flex-1 h-px bg-border`)
- Priority items: numbered, in `rounded-md bg-secondary/50 px-4 py-3` cards
- "Needs attention" + "Yesterday": side by side in `grid grid-cols-2 gap-6`
- "Needs attention" items prefixed with `--` in accent color
- Empty state: centered italic text about next digest time

**Quick Capture**
- Container: `rounded-md border border-border bg-secondary px-3 py-2` with `focus-within:border-primary focus-within:ring-1 focus-within:ring-primary`
- Prompt: `>` character in primary color (text-sm)
- Input: bg-transparent, text-sm, placeholder "capture a thought..." in muted-foreground
- Submit: CornerDownLeft icon (size-3.5), muted-foreground, hover:text-primary, disabled:opacity-30
- Processing: "classifying..." below input, text-[11px], primary color, animate-pulse
- Confirmation: "Captured as **Category**: name (confidence%)" — fades out after 3s

**Stats**
- Container: `grid grid-cols-2 gap-2 h-full` (4 boxes in 2x2)
- Each box: `flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-card px-2 py-2`
- Icon (size-3, colored per stat) + number (text-base, font-medium, colored) + label (text-[9px], uppercase, tracking-wider, muted-foreground)
- Stats: "This week" (Zap, primary), "Total entries" (Brain, foreground), "Open tasks" (CheckSquare, accent), "Stalled" (AlertTriangle, destructive)

**Recent Entries**
- Container: `col-span-8 rounded-md border border-border bg-card px-4 py-3 max-h-36 overflow-y-auto scrollbar-thin`
- Section header: "Recent" (text-[10px], uppercase, tracking-wider, muted-foreground)
- Grouped by day: "Today", "Yesterday", or formatted date (text-[10px], uppercase, tracking-widest)
- Each row: button, `w-full flex items-center gap-2 rounded px-2 py-1 hover:bg-secondary`
  - Category badge (9px, colored, 3-letter)
  - Entry name (text-xs, truncate, hover:text-primary)
  - Source icon (size-3, muted: MessageSquare=telegram, Mic=voice, Globe=webapp, Cpu=mcp)
  - Time (text-[10px], muted-foreground, HH:MM 24h)

**Status Bar**
- Container: `flex items-center justify-between text-[10px] text-muted-foreground`
- Left: service indicators — pulsing green dot (`size-1.5 rounded-full bg-primary animate-pulse`) + service name. Services: postgres, ollama, whisper, telegram.
- Right: "SSE connected" + "uptime Xh Ym"
- Service status updated via SSE or periodic health check

## Theme Toggle

1. Inline `<script>` in `<head>` before body renders: reads `localStorage.getItem("cortex-theme")`, applies `.dark` class if `"dark"`. Prevents flash of wrong theme.
2. Toggle button in header: swaps Sun/Moon icon, toggles `.dark` on `<html>`, writes to `localStorage`.
3. Default: follows system preference (`prefers-color-scheme: dark` media query) on first visit.

## Icons Module

`src/web/icons.ts` exports a function per icon, returning an SVG string:

```typescript
export function iconBrain(className?: string): string {
  return `<svg class="${className ?? ''}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">...</svg>`;
}
```

Icons needed (~15-20): Brain, Search, FolderOpen, Trash2, Settings, Sun, Moon, Sparkles, Zap, CheckSquare, AlertTriangle, CornerDownLeft, MessageSquare, Globe, Cpu, Mic, ChevronRight.

SVG paths sourced directly from Lucide. Uses `currentColor` so they inherit text color from Tailwind classes.

## SSE & Interactivity

Same behavioral spec as before. Implementation changes:

- SSE listener in vanilla JS (~80-100 lines inline or single static `.js` file)
- DOM manipulation for live updates (entry:new, entry:update, entry:delete, digest:new)
- Capture bar submit handler (`POST /api/capture`)
- Theme toggle handler
- Status bar SSE connection indicator (shows "SSE disconnected" on error/close)
- Service health: periodic fetch to `/health` endpoint to update status dots, or pushed via SSE `health` event

## Scrollbar Styling

Custom thin scrollbar for scrollable areas:

```css
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
```

WebKit fallback with 4px width, transparent track, `--border` colored thumb.

## Shared Layout

`src/web/layout.ts` exports `renderLayout(title, content, activePage)`:

- Full HTML document with:
  - `<head>`: charset, viewport, title, Google Fonts link (JetBrains Mono 400+500), inline theme script, `<link>` to `public/style.css`
  - `<body class="font-sans antialiased">`: header + content slot + status bar
- Header and status bar rendered on every page (shared navigation)
- Content slot receives page-specific HTML
- **No inline styles.** All styling uses Tailwind utility classes only. oklch tokens, badge colors, and custom utilities are defined in `src/web/styles.css` (the Tailwind input file), not in a `<style>` block.

## Applying to Other Pages

This design system applies to all web pages, not just the dashboard:

| Page | Key Layout Notes |
|------|-----------------|
| Dashboard (`/`) | As described above |
| Browse (`/browse`) | Same max-w-5xl, header/status bar, card-based entry list with category badges |
| Entry (`/entry/:id`) | Card container for entry detail, monospace rendered content |
| New Note (`/new`) | Capture form with textarea, same input styling as quick capture |
| Trash (`/trash`) | Same as browse but with restore/delete actions |
| Settings (`/settings`) | Form inputs using the design system's input/label styles |
| Login (`/login`) | Centered card, minimal, same color system |

## What This Replaces

| Before (Editorial / Journal) | After (Terminal / Command Center) |
|-------------------------------|-----------------------------------|
| Lora + Source Sans 3 + IBM Plex Mono | JetBrains Mono only |
| Warm cream `#FAF8F5` + terracotta `#C2705B` | oklch green/amber with dark mode |
| 640px single-column | 1024px dense grid layout |
| No dark mode | Dark/light with localStorage toggle |
| No status bar | Live service health indicators |
| No icons | Lucide inline SVGs |
| Three Google Fonts | One Google Font |
| Hex colors | oklch color space |

## File Structure

| File | Purpose |
|------|---------|
| `src/web/styles.css` | Tailwind input: oklch tokens (light+dark), `@theme` bindings, badge colors, scrollbar utility |
| `src/web/layout.ts` | Shared HTML layout: `<head>`, header, status bar, theme toggle script |
| `src/web/icons.ts` | Inline SVG icon helpers (~18 icons from Lucide), resolves `size-*` to `width`/`height` |
| `public/style.css` | Build output (gitignored): `npm run build:css` compiles from `src/web/styles.css` |

## CSS Convention

- **No inline styles.** All `src/web/` templates use Tailwind utility classes exclusively.
- **`src/web/styles.css`** is the single source for CSS custom properties and custom components (`badge-*`, `scrollbar-thin`).
- **`public/style.css`** is a build artifact — never edit or commit it. Rebuild with `npm run build:css` (or `npm run dev:css` for watch mode).
- When adding new pages, copy class patterns from the `design/` reference components verbatim.

## Reference

The `design/` directory at the project root contains the original React/Next.js/shadcn prototype that this design system is derived from. It serves as the visual reference but is not used in production. The server-rendered implementation should be pixel-identical in appearance.
