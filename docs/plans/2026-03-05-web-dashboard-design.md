# Web Dashboard — Design Document

| Field | Value |
|-------|-------|
| Date | 2026-03-05 |
| Status | Approved |
| Derives From | `docs/specs/web-dashboard-specification.md` |

## IMPORTANT: Frontend Design Skill

**The `frontend-design` skill MUST be invoked on every implementation step for this feature and all web features.** Every template, component, layout, and styling decision should be guided by the frontend-design skill to ensure distinctive, production-grade aesthetics. No exceptions.

## Overview

The dashboard is the user's browser start page. It shows today's digest, a quick capture bar, stats at a glance, and the 5 most recent entries. Live updates via SSE keep the page current without refresh.

**Design philosophy:** Editorial / Journal. The dashboard should feel like reading a well-typeset personal newspaper — calm, literary, unhurried. Not a SaaS dashboard.

## Resolved Open Questions

| Question | Decision |
|----------|----------|
| Quick capture: single-line or textarea? | Single-line input bar. Longer notes go to `/new`. |
| SSE payload: full objects or IDs? | Full entry objects. Simpler client JS, no follow-up fetches. |
| Digest section: collapsible? | Always visible. It's the primary content. |
| Max entries before "show more"? | 5 entries on dashboard. "View all" links to `/browse`. |

## Aesthetic Direction: Editorial / Journal

### Typography

| Role | Font | Size / Weight | Details |
|------|------|--------------|---------|
| Page title / digest headings | Lora (serif) | 28px / 700 | letter-spacing -0.02em |
| Section headings | Lora | 18px / 600 | — |
| Body text | Source Sans 3 | 16px / 400 | line-height 1.7 |
| Small / meta | Source Sans 3 | 13px / 400 | — |
| Category badges | IBM Plex Mono | 11px / 500 | uppercase, letter-spacing 0.05em |

Font loading via Google Fonts with `font-display: swap`.

### Color Palette

| Role | Color | Hex |
|------|-------|-----|
| Background | Warm cream | `#FAF8F5` |
| Surface (cards) | Soft white | `#FFFFFF` |
| Text primary | Warm charcoal | `#2D2A26` |
| Text secondary | Stone | `#7A746D` |
| Accent | Muted terracotta | `#C2705B` |
| Accent hover | Deeper terracotta | `#A85A47` |
| Category: People | Warm blue | `#5B7FC2` |
| Category: Projects | Forest green | `#5BA67A` |
| Category: Tasks | Amber | `#C2995B` |
| Category: Ideas | Violet | `#8B5BC2` |
| Category: Reference | Slate | `#6B7280` |
| Border / Divider | Light warm gray | `#E8E4DF` |

### Category Badge Design

Small pill-shaped elements: category color background at 12% opacity, category color text, IBM Plex Mono 11px uppercase.

## Layout

Single-column, max-width `640px`, centered. Sections separated by `48px` vertical space with subtle `1px` dividers in `#E8E4DF`.

### Page Order (top to bottom)

```
┌─────────────────────────────────────┐
│  Cortex          Browse  New  ⚙  ×  │  Navbar (48px, border-bottom)
├─────────────────────────────────────┤
│                                     │  48px gap
│  ── Thursday, March 5 ──            │  Date line (Lora italic, centered)
│                                     │  24px gap
│  Digest content rendered as         │  Digest section
│  markdown with warm reading tones   │  (variable height)
│                                     │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤  48px gap + divider
│  [ What's on your mind?       ⏎ ]  │  Capture bar (bottom-border only)
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤  48px gap + divider
│  12 this week   3 tasks   1 stalled │  Stats (Lora 28px numbers)
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤  48px gap + divider
│  Recent                             │
│  TASK  Buy groceries         2h ago │  5 entries max
│  IDEA  Cortex mobile app     5h ago │  category badge + name + time
│           View all →                │  Link to /browse
└─────────────────────────────────────┘
```

## Component Details

### Navbar

- "Cortex" in Lora 20px/600 — serif masthead. Links to `/`.
- Nav links: Source Sans 14px/400, secondary color. Active page: terracotta + 2px bottom border.
- Items: Browse (`/browse`), New (`/new`), Settings (`/settings` as `⚙`), Log out (`POST /logout` as form button).

### Digest Section

- Date line above: centered, Lora italic, secondary color (like a newspaper masthead date).
- Rendered markdown content. Headings in Lora, body in Source Sans 3.
- Blockquotes: terracotta left border.
- Empty state: centered italic — *"No digest yet — your first one arrives tomorrow at 7:30 AM"*

### Capture Bar

- Bottom-border-only `<input>` — like a ruled notebook line.
- Placeholder: "What's on your mind?" in italic, secondary color.
- Focus: bottom border transitions to terracotta.
- Small `⏎` hint icon on the right, fades in on focus.
- Submit on Enter. Input disabled during capture, placeholder changes to "Capturing..."
- Confirmation below: *Captured as **Task**: Buy groceries (92%)* — fades out after 3s.
- Error: *"Capture failed — try again"* — red text, fades out after 5s.

### Stats Row

- Three columns, evenly spaced.
- Number: Lora 28px, warm charcoal. Label below: Source Sans 13px, secondary, uppercase.
- Hover: number transitions to terracotta.

### Recent Entries

- Each row: `[CATEGORY BADGE]` + entry name + relative time (right-aligned, secondary).
- Name is clickable — navigates to `/entry/:id`.
- Hover: name shifts to terracotta + subtle `translateX(2px)`.
- No borders between rows — generous 16px vertical padding.
- "View all →" centered below, terracotta, Source Sans 14px.

## SSE & Interactivity

### Connection

- `EventSource` to `GET /api/events` on page load. Session cookie sent automatically.
- Event types: `entry:new`, `entry:update`, `entry:delete`, `digest:new`.
- Payloads: full JSON objects.
- Reconnection: native `EventSource` retry. No catch-up mechanism.

### Live Update Animations

| Event | Animation |
|-------|-----------|
| New entry | Prepend to list, fade-in (opacity 0→1, 300ms) |
| Entry update | Replace row content, highlight flash (terracotta 5% → transparent, 500ms) |
| Entry delete | Fade out + height collapse (300ms), remove from DOM |
| New digest | Replace digest content, highlight flash |

### Client-Side JS

- Vanilla JS, no framework. ~80-100 lines.
- SSE listener + DOM manipulation for live updates.
- Capture bar submit handler (`POST /api/entries`).
- No bundler — inline `<script>` or single static `.js` file.

## Shared Web Infrastructure

### Layout Template

`src/web/layout.ts` exports `renderLayout(title, content, activePage)`:
- Full HTML document with `<head>` (fonts, Tailwind CSS), navbar, content slot, shared scripts.
- Each page calls `renderLayout()` with its body HTML.
- Avoids duplicating navbar, fonts, and CSS across pages.

### Tailwind CSS

- Pre-built via Tailwind CLI into `public/styles.css`.
- Custom theme extends defaults with the editorial color palette and font families.
- Served via Hono's `serveStatic` middleware.

### File Structure

Each web feature gets its own file, exporting a factory function:

| File | Export | Routes |
|------|--------|--------|
| `src/web/layout.ts` | `renderLayout()` | — (shared template) |
| `src/web/dashboard.ts` | `createDashboardRoutes(deps)` | `GET /` |
| `src/web/browse.ts` | `createBrowseRoutes(deps)` | `GET /browse` |
| `src/web/entry.ts` | `createEntryRoutes(deps)` | `GET /entry/:id`, `POST /entry/:id` |
| `src/web/new-note.ts` | `createNewNoteRoutes(deps)` | `GET /new`, `POST /new` |
| `src/web/settings.ts` | `createSettingsRoutes(deps)` | `GET /settings`, `POST /settings` |
| `src/web/app.ts` | `createWebApp(deps)` | Wires all sub-apps + auth middleware |

All follow the `createXxxRoutes(dependencies): Hono` factory pattern established by `createHealthRoute` and `createAuthRoutes`.
