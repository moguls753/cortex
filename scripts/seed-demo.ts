/**
 * Seed script for demo data.
 * Run: npx tsx scripts/seed-demo.ts
 *
 * Requires DATABASE_URL env var (or reads from .env).
 * Inserts ~30 realistic entries across all 5 categories,
 * spread over the past 3 weeks to make dashboards/digests look alive.
 */

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(url);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number, hour = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d;
}

interface SeedEntry {
  name: string;
  content: string;
  category: string;
  fields: Record<string, unknown>;
  tags: string[];
  confidence: number;
  source: string;
  source_type: string;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Demo entries — tells a story of someone building a side project,
// managing work, staying in touch with people, capturing ideas
// ---------------------------------------------------------------------------

const entries: SeedEntry[] = [
  // === PROJECTS (6) ===
  {
    name: "Cortex — Second Brain App",
    content: "Building a self-hosted second brain. Telegram capture working, web dashboard next. Using PostgreSQL + pgvector for semantic search.",
    category: "projects",
    fields: { status: "active", next_action: "Deploy to home server and test MCP integration", notes: "All 12 features complete, 318 tests passing" },
    tags: ["cortex", "side-project", "typescript"],
    confidence: 0.95,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(18, 9),
  },
  {
    name: "Apartment Search Munich",
    content: "Need to find a 2-room apartment in Munich by April. Budget up to 1200€ warm. Checked Schwabing and Sendling so far.",
    category: "projects",
    fields: { status: "active", next_action: "Call landlord about Sendling apartment", notes: "Viewing scheduled for Thursday 14:00" },
    tags: ["apartment", "munich", "urgent"],
    confidence: 0.91,
    source: "telegram",
    source_type: "voice",
    created_at: daysAgo(14, 20),
  },
  {
    name: "Guitar Practice Routine",
    content: "Setting up a structured practice routine. 30 min daily: 10 min scales, 10 min chord progressions, 10 min repertoire. Tracking progress weekly.",
    category: "projects",
    fields: { status: "active", next_action: "Learn Autumn Leaves chord melody", notes: "Week 3 — can play all major modes cleanly" },
    tags: ["guitar", "music", "practice"],
    confidence: 0.88,
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(20, 21),
  },
  {
    name: "Blog Migration to Astro",
    content: "Migrating personal blog from Jekyll to Astro. Content collection API is great. Need to port the 12 existing posts and set up RSS.",
    category: "projects",
    fields: { status: "paused", next_action: "Port remaining blog posts", notes: "Paused — focusing on Cortex first" },
    tags: ["blog", "astro", "web"],
    confidence: 0.93,
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(21, 11),
  },
  {
    name: "Home Server Setup",
    content: "Setting up Proxmox on the mini PC. Running Docker containers for Cortex, Nextcloud, and Pi-hole. WireGuard VPN for remote access via FritzBox.",
    category: "projects",
    fields: { status: "active", next_action: "Configure automatic backups to external drive", notes: "Proxmox installed, Docker running, WireGuard connected" },
    tags: ["homelab", "server", "docker", "selfhosted"],
    confidence: 0.96,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(10, 15),
  },
  {
    name: "Thesis Final Revision",
    content: "Final revision round for the master's thesis. Supervisor feedback received — needs stronger conclusion and two more references in chapter 4.",
    category: "projects",
    fields: { status: "done", next_action: null, notes: "Submitted on March 1st. Done!" },
    tags: ["thesis", "university"],
    confidence: 0.97,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(19, 14),
  },

  // === PEOPLE (5) ===
  {
    name: "Coffee with Lisa",
    content: "Had coffee with Lisa. She's switching from backend to ML engineering at her company. Recommended the fast.ai course. She might know someone at Anthropic.",
    category: "people",
    fields: { context: "Old university friend, works at BMW", follow_ups: "Send her the fast.ai link, ask about Anthropic contact" },
    tags: ["lisa", "networking", "ml"],
    confidence: 0.92,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(3, 16),
  },
  {
    name: "Call with Dad",
    content: "Dad called about the family dinner on Easter. He's also having router issues — offered to help set up the new FritzBox when I visit.",
    category: "people",
    fields: { context: "Family", follow_ups: "Visit on Easter Saturday, bring FritzBox manual" },
    tags: ["family", "dad"],
    confidence: 0.89,
    source: "telegram",
    source_type: "voice",
    created_at: daysAgo(2, 19),
  },
  {
    name: "Max — Climbing Partner",
    content: "Max is back from his trip to Spain. Wants to go bouldering at the DAV center this weekend. He also asked if I want to join a multi-pitch course in May.",
    category: "people",
    fields: { context: "Climbing buddy, met at DAV Munich", follow_ups: "Confirm Saturday bouldering, check May calendar for multi-pitch" },
    tags: ["max", "climbing", "sports"],
    confidence: 0.94,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(1, 12),
  },
  {
    name: "Prof. Weber — Thesis Feedback",
    content: "Professor Weber sent final feedback on the thesis. Very positive overall. Suggested I could turn chapter 3 into a conference paper.",
    category: "people",
    fields: { context: "Thesis supervisor at TU Munich", follow_ups: "Thank him, ask about suitable conferences for the paper" },
    tags: ["university", "thesis", "prof-weber"],
    confidence: 0.90,
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(8, 10),
  },
  {
    name: "Neighbor Julia — Package",
    content: "Julia from downstairs took a package for me on Tuesday. Need to pick it up. She mentioned the building meeting is next month.",
    category: "people",
    fields: { context: "Neighbor, 2nd floor", follow_ups: "Pick up package, ask about building meeting date" },
    tags: ["neighbor", "apartment"],
    confidence: 0.85,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(1, 18),
  },

  // === TASKS (8) ===
  {
    name: "Buy groceries for the week",
    content: "Milk, eggs, bread, pasta, tomatoes, onions, chicken, rice, olive oil. Also need dishwasher tabs.",
    category: "tasks",
    fields: { due_date: null, status: "done", notes: null },
    tags: ["groceries", "errands"],
    confidence: 0.97,
    source: "telegram",
    source_type: "voice",
    created_at: daysAgo(5, 8),
  },
  {
    name: "Renew health insurance card",
    content: "TK sent a letter — health insurance card expires end of March. Need to upload a new photo through the TK app.",
    category: "tasks",
    fields: { due_date: "2026-03-31", status: "pending", notes: "Photo requirements: biometric, white background" },
    tags: ["insurance", "admin", "urgent"],
    confidence: 0.93,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(6, 11),
  },
  {
    name: "Book dentist appointment",
    content: "Haven't been in 8 months. Dr. Schneider's practice, call in the morning. They're usually booked 2-3 weeks out.",
    category: "tasks",
    fields: { due_date: "2026-03-15", status: "pending", notes: null },
    tags: ["health", "appointment"],
    confidence: 0.91,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(4, 9),
  },
  {
    name: "Fix bike rear brake",
    content: "Rear brake is rubbing. Probably just needs cable tension adjustment. If not, replace pads — bought Shimano pads last month.",
    category: "tasks",
    fields: { due_date: null, status: "pending", notes: "Shimano B01S pads in the drawer" },
    tags: ["bike", "maintenance"],
    confidence: 0.88,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(7, 17),
  },
  {
    name: "Reply to Aunt Monika's birthday email",
    content: "She turned 60 last week. Sent a nice email. Need to reply and ask about the summer family gathering.",
    category: "tasks",
    fields: { due_date: null, status: "pending", notes: null },
    tags: ["family", "email"],
    confidence: 0.86,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(3, 20),
  },
  {
    name: "Cancel old Spotify account",
    content: "Still paying for the old Spotify premium account from university email. Already have family plan on the new one.",
    category: "tasks",
    fields: { due_date: null, status: "done", notes: "Cancelled via account settings" },
    tags: ["subscriptions", "money"],
    confidence: 0.94,
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(12, 22),
  },
  {
    name: "Send invoice to freelance client",
    content: "Web scraping project for DataFlow GmbH. 12 hours at 85€/hr. Invoice template is in Dokumente/Rechnungen.",
    category: "tasks",
    fields: { due_date: "2026-03-10", status: "pending", notes: "Total: 1020€, payment terms NET 14" },
    tags: ["freelance", "invoice", "money"],
    confidence: 0.96,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(2, 10),
  },
  {
    name: "Update CV with thesis topic",
    content: "Add thesis title and description to CV. Also update the skills section — add pgvector, Drizzle ORM, MCP.",
    category: "tasks",
    fields: { due_date: null, status: "pending", notes: null },
    tags: ["career", "cv"],
    confidence: 0.90,
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(5, 14),
  },

  // === IDEAS (5) ===
  {
    name: "Pomodoro Timer with Spotify Integration",
    content: "A pomodoro timer that automatically plays focus music from a Spotify playlist during work sessions and pauses it during breaks. Could use the Spotify Web API.",
    category: "ideas",
    fields: { oneliner: "Pomodoro + Spotify auto-play for focus sessions", notes: "Check if Spotify API allows playback control from a web app" },
    tags: ["app-idea", "productivity", "spotify"],
    confidence: 0.87,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(11, 23),
  },
  {
    name: "Teach a Workshop on Self-Hosting",
    content: "Could run a small workshop at the local hackerspace about self-hosting basics. Docker, Proxmox, WireGuard, DNS. People always ask me about this stuff.",
    category: "ideas",
    fields: { oneliner: "Workshop: self-hosting for beginners at the hackerspace", notes: "Talk to Hackerspace Munich about scheduling, maybe 2-hour format" },
    tags: ["workshop", "selfhosted", "community"],
    confidence: 0.83,
    source: "telegram",
    source_type: "voice",
    created_at: daysAgo(9, 21),
  },
  {
    name: "Recipe Scaling Calculator",
    content: "A tiny web app that takes a recipe URL and scales ingredients up or down. Parse the structured data from recipe sites (JSON-LD). Could be a fun weekend project.",
    category: "ideas",
    fields: { oneliner: "Scale any recipe up/down from a URL", notes: "Most recipe sites use schema.org Recipe markup" },
    tags: ["app-idea", "cooking", "web"],
    confidence: 0.89,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(15, 19),
  },
  {
    name: "Weekly Review Ritual",
    content: "Start doing a proper weekly review every Sunday. Look at what got done, what's stuck, plan the week ahead. Cortex could help with this — the weekly digest is basically this.",
    category: "ideas",
    fields: { oneliner: "Structured Sunday review using Cortex weekly digest", notes: null },
    tags: ["productivity", "habits", "cortex"],
    confidence: 0.85,
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(6, 16),
  },
  {
    name: "German-English Flashcard Generator",
    content: "An LLM-powered tool that takes a German text and generates Anki flashcards for the hardest vocabulary. Could use the same LLM abstraction as Cortex.",
    category: "ideas",
    fields: { oneliner: "Auto-generate Anki cards from German texts via LLM", notes: "AnkiConnect API for direct import" },
    tags: ["app-idea", "language", "anki", "llm"],
    confidence: 0.91,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(13, 10),
  },

  // === REFERENCE (5) ===
  {
    name: "PostgreSQL JSONB Query Cheatsheet",
    content: "**Accessing fields:**\n- `fields->>'key'` — text value\n- `fields->'key'` — JSON value\n- `fields @> '{\"status\": \"active\"}'` — contains\n\n**Indexing:**\n- `CREATE INDEX ON entries USING GIN (fields);`\n- For specific paths: `CREATE INDEX ON entries ((fields->>'status'));`",
    category: "reference",
    fields: { notes: "From PostgreSQL docs + practical experience with Cortex" },
    tags: ["postgresql", "jsonb", "cheatsheet", "database"],
    confidence: 0.94,
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(16, 13),
  },
  {
    name: "WireGuard VPN Setup on FritzBox",
    content: "1. FritzBox: Internet → Permit Access → VPN (WireGuard) → Add connection\n2. Download config file\n3. On client: `wg-quick up wg0`\n4. DNS: use FritzBox IP as DNS server for local resolution\n\nKeep-alive: `PersistentKeepalive = 25` for mobile connections.",
    category: "reference",
    fields: { notes: "Tested with FritzBox 7590 and Ubuntu 22.04" },
    tags: ["wireguard", "vpn", "fritzbox", "networking"],
    confidence: 0.96,
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(12, 11),
  },
  {
    name: "Espresso Dial-In Parameters",
    content: "Current best settings for the Sage Barista Express:\n- Grind: 5 (inner) / 12 (outer)\n- Dose: 18g in, 36g out\n- Time: 25-28 seconds\n- Water temp: default\n\nBeans: JB Kaffee München, \"Hausmischung\" medium roast.",
    category: "reference",
    fields: { notes: "Adjust grind finer for lighter roasts" },
    tags: ["coffee", "espresso", "recipe"],
    confidence: 0.88,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(8, 7),
  },
  {
    name: "Docker Compose Useful Commands",
    content: "```\ndocker compose up -d          # start detached\ndocker compose logs -f app    # follow app logs\ndocker compose exec app sh    # shell into container\ndocker compose down -v        # stop + remove volumes (!)\ndocker compose build --no-cache  # force rebuild\n```\n\nProject name comes from directory name unless `name:` is set in compose file.",
    category: "reference",
    fields: { notes: "The -v flag on down deletes volumes — be careful" },
    tags: ["docker", "cheatsheet", "devops"],
    confidence: 0.95,
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(10, 16),
  },
  {
    name: "Bouldering Grades Comparison",
    content: "Fontainebleau → V-Scale → UIAA:\n- 5 → V2 → 6-\n- 5+ → V3 → 6\n- 6A → V3 → 6+\n- 6A+ → V4 → 7-\n- 6B → V4 → 7\n- 6B+ → V5 → 7+\n- 6C → V5 → 8-\n- 7A → V6 → 8\n\nCurrently climbing 6B+ / V5 consistently, projecting 6C.",
    category: "reference",
    fields: { notes: "Font scale is the standard in European gyms" },
    tags: ["climbing", "bouldering", "grades"],
    confidence: 0.87,
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(5, 20),
  },
];

// ---------------------------------------------------------------------------
// Also seed a demo daily digest so the dashboard looks complete
// ---------------------------------------------------------------------------

const dailyDigest = `**TOP 3 TODAY**
1. Call landlord about the Sendling apartment — viewing is Thursday
2. Send invoice to DataFlow GmbH (1020€, due March 10)
3. Configure automatic backups on the home server

**STUCK ON**
Health insurance card renewal — need to take a biometric photo first

**SMALL WIN**
Thesis officially submitted! Prof. Weber even suggested turning chapter 3 into a conference paper.`;

const weeklyDigest = `**WHAT HAPPENED**
14 entries captured this week. Most active category: Tasks (5). Busiest day: Wednesday (4 entries).

**OPEN LOOPS**
- Apartment search: viewing Thursday, but no backup options yet
- 4 pending tasks including the overdue dentist appointment
- Blog migration paused — revisit after home server is stable

**NEXT WEEK**
- Apartment viewing Thursday 14:00
- Bouldering with Max on Saturday
- Easter visit to Dad — bring FritzBox manual

**RECURRING THEME**
Infrastructure week — home server, Docker, and self-hosting dominated. The foundation is coming together.`;

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

async function seed() {
  console.log("Seeding demo data...\n");

  // Clear existing entries (but not settings)
  await sql`DELETE FROM entries`;
  await sql`DELETE FROM digests`;
  console.log("Cleared existing entries and digests.\n");

  for (const e of entries) {
    await sql`
      INSERT INTO entries (name, content, category, fields, tags, confidence, source, source_type, created_at, updated_at)
      VALUES (
        ${e.name},
        ${e.content},
        ${e.category},
        ${sql.json(e.fields)},
        ${e.tags},
        ${e.confidence},
        ${e.source},
        ${e.source_type},
        ${e.created_at},
        ${e.created_at}
      )
    `;
    console.log(`  ✓ [${e.category}] ${e.name}`);
  }

  // Seed digests
  await sql`
    INSERT INTO digests (type, content, generated_at)
    VALUES ('daily', ${dailyDigest}, NOW())
    ON CONFLICT (type) DO UPDATE SET content = EXCLUDED.content, generated_at = NOW()
  `;
  console.log(`  ✓ [digest] Daily digest`);

  await sql`
    INSERT INTO digests (type, content, generated_at)
    VALUES ('weekly', ${weeklyDigest}, NOW())
    ON CONFLICT (type) DO UPDATE SET content = EXCLUDED.content, generated_at = NOW()
  `;
  console.log(`  ✓ [digest] Weekly digest`);

  console.log(`\nSeeded ${entries.length} entries + 2 digests.`);
  await sql.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
