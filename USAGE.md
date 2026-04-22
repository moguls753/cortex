# Using Cortex

Day-to-day workflows for capturing thoughts, correcting the LLM when it hedges, searching your brain, and pulling data out via MCP. See [README.md](README.md) for setup and [ARCHITECTURE.md](ARCHITECTURE.md) for internals.

All examples use Monkey Island characters — Guybrush is the user, Elaine is his wife, and the rest drift in as context.

## Contents

- [Capturing thoughts](#capturing-thoughts)
- [Correcting a classification](#correcting-a-classification)
- [Private vs shared](#private-vs-shared)
- [Searching](#searching)
- [Digests](#digests)
- [Display (e-ink)](#display-e-ink)
- [MCP from AI tools](#mcp-from-ai-tools)

---

## Capturing thoughts

### Telegram text

Send any message. Classification + reply in 1–3 seconds.

```
Guybrush: Buy grog at Stan's on the way back to the ship
Bot: ✅ Filed as Tasks 👁 → Buy grog at Stan's (92%) — reply /fix to correct
```

The `👁` means the entry is `shared` (safe for the household display). No glyph means `private`.

### Telegram voice

Record a voice note. Local Whisper transcribes it and the pipeline is identical:

```
Bot: 🎤 'Remind me to talk to Murray about the navigator's key'
     ✅ Filed as Tasks 👁 → Talk to Murray — navigator's key (87%)
```

### Webapp quick capture

The single-line input at the top of `/`. Type, hit Enter. The entry appears live below without a page reload.

### Webapp full editor

`/new` for markdown notes. You can type the entry by hand (category + tags manual), or click **AI Suggest** to have the LLM propose category and tags from whatever you've drafted so far.

### MCP

Any MCP-speaking AI tool can call `add_thought`:

```json
{"name": "add_thought", "arguments": {
  "text": "Elaine wants to invite the Voodoo Lady to the harvest dinner"
}}
```

Optional `visibility: "private" | "shared"` bypasses the LLM's inference and the confidence fail-safe — useful when the calling agent already knows intent.

---

## Correcting a classification

The LLM returns a confidence score. When confidence falls below the `confidence_threshold` setting (default `0.6`), the Telegram reply carries an inline keyboard:

```
Bot: ❓ Best guess: Tasks → Conversation with Herman (42%)
     [People] [Projects] [Tasks] [Ideas] [Reference]
     [👁 Make shared]
```

- Tap a **category button** → full re-classification, the correction hint is fed to the LLM.
- Tap the **visibility toggle** → direct UPDATE, no LLM call. Flips `private` ↔ `shared` and edits the original reply to reflect the new state. Category buttons stay so you can keep correcting.

### `/fix` on Telegram

For a confidently-wrong capture (no inline keyboard shown), use `/fix`. It retargets your most recent Telegram entry and re-classifies with your correction text as context:

```
Guybrush: Buy map for Wally
Bot: ✅ Filed as Tasks → Buy map for Wally (88%)

Guybrush: /fix that's actually a surprise, keep it private
Bot: ✅ Fixed → Tasks → Buy map for Wally
```

Category, tags, fields, and visibility can all change in one pass. The confidence fail-safe still applies, so if your correction makes the LLM less sure, visibility falls back to `private`.

### Webapp edit

Open `/entry/:id/edit`. Fields: name, category, tags, content, and a **Private / Shared** radio. Current visibility is pre-selected. Save triggers an SSE update — any other open browser tab re-renders the entry's `👁` marker instantly.

### MCP `update_entry`

```json
{"name": "update_entry", "arguments": {
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "visibility": "shared",
  "tags": ["navigator", "elaine"]
}}
```

Omitted fields stay unchanged. Invalid `visibility` values return an error and no write happens.

---

## Private vs shared

Every entry is flagged `private` or `shared`. The LLM decides at classification time; the confidence fail-safe forces `private` whenever the overall confidence is below the threshold.

| Surface | Behavior |
|---|---|
| Display (`/api/display.png`) | Only `shared` tasks appear |
| Webapp lists (dashboard / browse / trash) | Everything shown; `shared` gets a `👁` icon |
| Entry view page | `👁` icon next to the category badge if `shared` |
| Digests (daily / weekly email) | Everything included — visibility is not a filter |
| MCP read tools | Everything returned, `visibility` field included in the payload |
| Google Calendar write-through | Not gated — use multi-calendar routing to land private events on a personal calendar |

Rule of thumb the LLM follows: content that mentions surprises, gifts for named recipients, personal reflections, health, finances, or work-sensitive material → `private`. Household / logistical / public content → `shared`. When uncertain → `private`.

### Flipping visibility

| Where | How |
|---|---|
| Telegram, low-confidence reply | Tap `[👁 Make shared]` / `[🔒 Make private]` |
| Telegram, confident reply | `/fix <hint>` — re-classifies with your correction |
| Webapp | `/entry/:id/edit` → Private / Shared radio |
| MCP | `update_entry` with `visibility` |

---

## Searching

Go to `/browse`.

**Semantic search** is the default. Your query is embedded via Ollama (qwen3-embedding), then entries are ranked by cosine similarity ≥ 0.5.

```
Query: "how do I deal with LeChuck"
→ Ideas · Possible voodoo approach to LeChuck    (similarity 0.78)
→ People · LeChuck — known weakness: root beer   (similarity 0.71)
→ Projects · Melee Island defense plan            (similarity 0.62)
```

**Text search fallback** engages automatically when semantic returns nothing. You can also force it:

```
/browse?mode=text&q=grog
```

Four dropdowns above the list — **Kategorie**, **Tag**, **Status**, **Aktivität** — narrow the results. Each is idle by default (`dropdown ▼`) and becomes active when you pick a value (`dropdown: value ×`). Click the chip body to change the value; click × to clear.

`Aktivität` is one axis covering both recency and staleness: `today`, `this week`, `this month`, `stale 5+ days`, `stale 14+ days`, `stale 30+ days`. Picking a recency value clears any stale value and vice versa.

---

## Digests

Configured under `/settings`:

| Setting | Default | Meaning |
|---|---|---|
| `daily_digest_cron` | `30 7 * * *` | 07:30 local time every day |
| `weekly_digest_cron` | `0 16 * * 0` | Sunday 16:00 |
| `digest_email_to` | *(required for email)* | SMTP recipient |

The daily digest pulls stalled projects, open tasks, and recent activity, hands the set to the configured LLM with the daily prompt, and delivers the result both as email and on the dashboard. The weekly review does the same on a wider window. The dashboard copy auto-refreshes via SSE when a new digest lands — no reload needed.

---

## Display (e-ink)

Enable in Settings: `display_enabled = true`. Optionally set `display_token` for basic auth. Point a TRMNL (or any device that can pull a PNG at an interval) at:

```
http://<your-host>/api/display.png?token=<display_token>
```

The rendered image shows:

- Today's + tomorrow's Google Calendar events (from configured calendars)
- Shared pending tasks + recently-completed tasks (< 24h)
- Current weather, if `display_weather_lat` / `display_weather_lng` are set
- Date and time

Private entries never appear. If Guybrush captures *"engagement ring for Elaine, from the cartographer on Phatt Island"*, the LLM marks it private and the display stays silent.

---

## MCP from AI tools

After wiring Cortex into your MCP config (see [README.md § MCP](README.md#mcp)), any MCP-speaking assistant can query and write to your brain.

### Available tools

| Tool | Purpose |
|---|---|
| `search_brain` | Semantic search across all entries (private + shared) |
| `add_thought` | Capture a new entry; optional `visibility` override |
| `list_recent` | Last N days, optionally filtered by category |
| `get_entry` | Read a specific entry by UUID |
| `update_entry` | Mutate any subset of fields (including `visibility`) |
| `delete_entry` | Soft-delete (entries land in trash, not dropped) |
| `brain_stats` | Counts by category, stalled projects, recent activity, etc. |

### Example prompts

These are things you'd say to an MCP-speaking agent. The agent picks the tool — you don't have to name it.

- *"What do I know about LeChuck?"* → `search_brain({ query: "LeChuck" })`
- *"Save a note that Elaine suggested we visit the Scumm Bar tomorrow."* → `add_thought(...)`
- *"Mark the Monkey Island voyage project as done."* → `search_brain` → `update_entry`
- *"What projects from the last month are still open?"* → `list_recent({ days: 30, category: "projects" })`
- *"Give me my brain stats."* → `brain_stats()`
- *"Delete that last note about the Scumm Bar."* → `list_recent` → `delete_entry`

### Response shape (example)

```json
{
  "id": "e8a1...",
  "name": "LeChuck — known weakness: root beer",
  "category": "people",
  "tags": ["lechuck", "voodoo", "weakness"],
  "visibility": "shared",
  "similarity": 0.71,
  "created_at": "2026-04-15T09:12:03Z"
}
```

Visibility is informational at the MCP layer — agents get everything; they can use the flag to decide what to surface back to the user.
