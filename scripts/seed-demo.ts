/**
 * Seed script for demo data.
 * Run: npx tsx scripts/seed-demo.ts
 *
 * Requires DATABASE_URL env var (or reads from .env).
 * Inserts ~29 realistic entries across all 5 categories,
 * spread over the past 3 weeks to make dashboards/digests look alive.
 *
 * Theme: Monkey Island. Guybrush Threepwood is preparing to set sail
 * for Monkey Island to find LeChuck (rumored to be near Big Whoop)
 * before he reaches Elaine on Tri-Island.
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
  visibility: "private" | "shared";
  source: string;
  source_type: string;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Demo entries — Guybrush Threepwood preparing for the Monkey Island voyage
// ---------------------------------------------------------------------------

const entries: SeedEntry[] = [
  // === PROJECTS (6) ===
  {
    name: "Monkey Island Voyage",
    content: "Chart a course to Monkey Island. Three Scumm Bar patrons place LeChuck near Big Whoop — if he reaches the skeleton crew first, Elaine's Tri-Island is next. Need: ship, crew, map, supplies, and the navigator's key (Murray might know where).",
    category: "projects",
    fields: { status: "active", next_action: "Pay Captain Dread, confirm Sea Monkey manifest, load supplies before tide turns", notes: "Ship secured (SS Sea Monkey, 5000 pieces of eight). Map pending from Wally. Voodoo Lady blessed the route." },
    tags: ["monkey-island", "lechuck", "voyage"],
    confidence: 0.95,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(18, 9),
  },
  {
    name: "Melee Island Defense Plan",
    content: "Fortify Mêlée harbor in case LeChuck doubles back. Drill the town militia twice a week. Cannon count: 12 working, 3 rusted through. Gov. Marley signed off on the budget.",
    category: "projects",
    fields: { status: "active", next_action: "Inspect Watchtower 3 masonry with the stonemason", notes: "Three drills completed. Militia morale acceptable after grog ration increase." },
    tags: ["melee", "defense", "elaine"],
    confidence: 0.91,
    visibility: "shared",
    source: "telegram",
    source_type: "voice",
    created_at: daysAgo(10, 15),
  },
  {
    name: "Engagement Ring for Elaine",
    content: "Commissioned from Wally the cartographer's Phatt Island supplier. Simple gold band, compass rose on the inside. She cannot know about this — say 'surprise from Phatt Island' if asked.",
    category: "projects",
    fields: { status: "paused", next_action: "Nudge Wally about shipping — it's been two weeks", notes: "Paid deposit (50 doubloons). Shipping delayed, reason unclear." },
    tags: ["elaine", "engagement-ring", "secret"],
    confidence: 0.93,
    visibility: "private",
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(14, 20),
  },
  {
    name: "SS Sea Monkey Refit",
    content: "Ship handed over by Stan needed a full refit. New sails (stolen from LeChuck's old ship — poetic), rigging reinforced, hull caulked, cannons mounted port+starboard.",
    category: "projects",
    fields: { status: "active", next_action: "Final sea trial with skeleton crew — Friday at dawn", notes: "Crew manifest locked: Carla, Meathook, Otis, two new hires from the Bloody Lip." },
    tags: ["sea-monkey", "ship", "crew"],
    confidence: 0.96,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(20, 11),
  },
  {
    name: "Governor's Ball Planning",
    content: "Elaine's annual Tri-Island dignitaries' dinner. Seating arrangement was the hard part — rival governors don't sit next to each other, Stan cannot sit next to anyone important.",
    category: "projects",
    fields: { status: "completed", next_action: null, notes: "Ball happened three weeks ago. Stan still sold two people ships during dessert." },
    tags: ["elaine", "tri-island", "governor"],
    confidence: 0.88,
    visibility: "private",
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(21, 14),
  },
  {
    name: "Cookbook — Seafaring Cuisine",
    content: "Collecting recipes from every port. Current entries: grilled iguana (Plunder), sea monkey stew (DO NOT make this), fried plantain with rum reduction. Plan: publish on Phatt Island Press eventually.",
    category: "projects",
    fields: { status: "paused", next_action: "Ask Estevan for his ship's biscuit recipe", notes: "20 recipes collected. Paused during voyage prep — will pick up when back." },
    tags: ["cookbook", "cuisine", "side-project"],
    confidence: 0.85,
    visibility: "shared",
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(11, 21),
  },

  // === PEOPLE (5) ===
  {
    name: "Voodoo Lady — prophecy of stormy waters",
    content: "Visited the Voodoo Lady in her shack. She drew the cards: Tower, Wheel, Ship, Moon. Translation: 'stormy waters, but not fatal if you keep the charm I gave you.' Also: she's out of eye of newt.",
    category: "people",
    fields: { context: "Mystic advisor on Melee Island, generally honest, speaks only in implications", follow_ups: "Restock eye of newt supply (she says 'less attitude, more inventory')" },
    tags: ["voodoo", "prophecy", "monkey-island"],
    confidence: 0.90,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(1, 12),
  },
  {
    name: "Murray — navigator's key briefing",
    content: "Demonic skull. Current status: helpful, in a manner of speaking. He claims the navigator's key is buried 'where the three-headed monkey watches.' When pressed, he finished with a limerick.",
    category: "people",
    fields: { context: "Talking skull, formerly attached to a body, vaguely prophetic", follow_ups: "Figure out which three-headed monkey — there are at least two known" },
    tags: ["murray", "navigation", "monkey-island"],
    confidence: 0.89,
    visibility: "shared",
    source: "telegram",
    source_type: "voice",
    created_at: daysAgo(2, 19),
  },
  {
    name: "Stan — Used Ship Salesman",
    content: "Sold me the Sea Monkey for 5,000 pieces of eight, down from 30,000. He threw in the anchor and a pre-chewed life vest. Claims the ship 'practically sails itself' — confirmed false during sea trial.",
    category: "people",
    fields: { context: "Used-ship salesman, green jacket, occupies Stan's House of Ships between voyages", follow_ups: "Avoid his 'pre-owned chart' offer next time" },
    tags: ["stan", "grog", "ship"],
    confidence: 0.94,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(3, 16),
  },
  {
    name: "Herman Toothrot",
    content: "Castaway, still on Monkey Island, still building that tree fort. Sent a coconut telegram about LeChuck's crew movements. Surprisingly lucid this time.",
    category: "people",
    fields: { context: "Shipwreck survivor, lives on Monkey Island, knows terrain like no one else", follow_ups: "Thank him when we land — bring fresh fruit (he's scurvy-adjacent)" },
    tags: ["herman", "monkey-island", "intel"],
    confidence: 0.86,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(9, 10),
  },
  {
    name: "Carla the Swordmaster",
    content: "Lost a duel to her at the Bloody Lip. Her insult: 'You fight like a limp-wristed landlubber with soggy britches.' I had no counter. She agreed to teach advanced insult technique in exchange for helping retrieve her lost sword from the swamp.",
    category: "people",
    fields: { context: "Swordmaster of Mêlée, trains anyone brave enough to lose to her first", follow_ups: "Trip to the swamp this weekend — bring waders" },
    tags: ["carla", "insult-swordfighting", "training"],
    confidence: 0.92,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(19, 17),
  },

  // === TASKS (8) ===
  {
    name: "Reply to Elaine's letter",
    content: "She asked three things: when am I back (depends on LeChuck), is the 'surprise from Phatt Island' still on (the ring — keep vague), did the Voodoo Lady confirm the route (yes). Reply before sailing.",
    category: "tasks",
    fields: { due_date: "2026-04-22", status: "pending", notes: "Keep it light. She knows when I'm hiding something, but I'm hiding a wedding ring, so that's allowed." },
    tags: ["elaine", "family", "engagement-ring"],
    confidence: 0.88,
    visibility: "private",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(1, 18),
  },
  {
    name: "Refill ship's rum stock before departure",
    content: "Need at least 20 barrels of grog. Three barrels already on the ship. Stan wants 15 pieces of eight per barrel; negotiate.",
    category: "tasks",
    fields: { due_date: "2026-04-22", status: "pending", notes: "Crew threatened mutiny last voyage at 10 barrels. 20 is the minimum." },
    tags: ["grog", "ship", "sea-monkey"],
    confidence: 0.93,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(2, 11),
  },
  {
    name: "Pick up map from Wally the cartographer",
    content: "Commissioned two weeks ago. Detailed chart of Monkey Island's coast + known LeChuck sighting points. Wally opens at ten. Bring the full 200 doubloons.",
    category: "tasks",
    fields: { due_date: "2026-04-23", status: "pending", notes: "Also: ask subtly whether the ring has shipped." },
    tags: ["wally", "cartography", "monkey-island"],
    confidence: 0.96,
    visibility: "shared",
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(4, 9),
  },
  {
    name: "Buy grog at Stan's on the way back to the ship",
    content: "Grab three extra skins for the first night at sea. Stan owes me a discount after the Sea Monkey fiasco.",
    category: "tasks",
    fields: { due_date: null, status: "done", notes: "Got five for the price of three. Stan does not remember the fiasco." },
    tags: ["grog", "stan"],
    confidence: 0.97,
    visibility: "shared",
    source: "telegram",
    source_type: "voice",
    created_at: daysAgo(5, 8),
  },
  {
    name: "Book passage on the Sea Monkey",
    content: "Formally assign myself to the manifest. Captain Dread handles the paperwork — we both know it's my ship, but the Tri-Island port authority cares about forms.",
    category: "tasks",
    fields: { due_date: null, status: "done", notes: "Signed. Assigned cabin 1 (captain's quarters)." },
    tags: ["sea-monkey", "ship", "paperwork"],
    confidence: 0.94,
    visibility: "shared",
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(6, 11),
  },
  {
    name: "Collect rubber chicken with a pulley in the middle",
    content: "The general store claims to have one in stock. This keeps falling off my list. I've failed to acquire it on two separate store visits.",
    category: "tasks",
    fields: { due_date: null, status: "pending", notes: "Essential for at least two known Monkey Island obstacles. Don't skip again." },
    tags: ["inventory", "rubber-chicken", "monkey-island"],
    confidence: 0.85,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(7, 17),
  },
  {
    name: "Return library book to the Scumm Bar librarian",
    content: "Two weeks overdue. Fine is now three doubloons. The librarian (doubles as bartender) stopped making eye contact last time.",
    category: "tasks",
    fields: { due_date: "2026-04-10", status: "pending", notes: "Book: 'Advanced Piracy for the Motivated Beginner' — never finished it." },
    tags: ["scumm-bar", "library", "overdue"],
    confidence: 0.82,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(12, 22),
  },
  {
    name: "Sword Master Swamp Trip — recover Carla's blade",
    content: "She dropped her good sword in the swamp during last month's duel tournament. Agreed to retrieve it in exchange for advanced insult training.",
    category: "tasks",
    fields: { due_date: "2026-04-26", status: "pending", notes: "Bring waders. Bring rope. Avoid the snake that lives under the mangrove." },
    tags: ["carla", "insult-swordfighting", "swamp"],
    confidence: 0.90,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(5, 14),
  },

  // === IDEAS (5) ===
  {
    name: "Possible voodoo approach to LeChuck",
    content: "Voodoo Lady hinted at a recipe: root beer (weakness), voodoo doll (need personal effects), chicken-based contraption (exact purpose unclear). Test on a minor undead first — maybe a zombie pirate at the docks.",
    category: "ideas",
    fields: { oneliner: "Voodoo doll + root beer cannon for LeChuck", notes: "Can't use Elaine's hair — already tried, she noticed." },
    tags: ["lechuck", "voodoo", "strategy"],
    confidence: 0.87,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(11, 23),
  },
  {
    name: "Three-headed monkey misdirection technique",
    content: "Classic pirate ruse: point over someone's shoulder and yell 'Look! A three-headed monkey!' Escape while they turn. Works surprisingly often. Consider systematizing for crew training.",
    category: "ideas",
    fields: { oneliner: "Formalize the three-headed monkey gambit as standard crew drill", notes: "Only works on opponents who haven't heard it before. Expiring asset." },
    tags: ["tactics", "monkey-island", "crew"],
    confidence: 0.80,
    visibility: "shared",
    source: "telegram",
    source_type: "voice",
    created_at: daysAgo(6, 21),
  },
  {
    name: "Insult swordfighting training app",
    content: "An app that drills canonical insult/counter pairs. Could use the LLM abstraction Cortex already has. Quiz mode, tournament mode, 'fight the AI Sword Master' mode.",
    category: "ideas",
    fields: { oneliner: "Quiz app for insult swordfighting drills (LLM-powered opponent)", notes: "Might not be massively profitable, but Carla would definitely buy it." },
    tags: ["insult-swordfighting", "app-idea", "training"],
    confidence: 0.89,
    visibility: "shared",
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(15, 19),
  },
  {
    name: "Rubber chicken + pulley startup idea",
    content: "Every pirate knows rubber chickens with pulleys in the middle are essential tooling. Supply is erratic. Could corner the market — exclusive supplier contract with the general store.",
    category: "ideas",
    fields: { oneliner: "Become the sole supplier of rubber-chicken-with-pulley tooling", notes: "Wally once said 'someone will get rich off this' before laughing for an hour." },
    tags: ["rubber-chicken", "business", "tooling"],
    confidence: 0.83,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(13, 10),
  },
  {
    name: "Open treasure map standard (.gpt)",
    content: "Every cartographer uses a different projection and compass convention. Proposed standard: .gpt (General Pirate Treasure) — JSON with coords, landmarks, X-marks. Implementable over a weekend if Wally agrees.",
    category: "ideas",
    fields: { oneliner: "Open file format for treasure maps — coords, landmarks, X-marks", notes: "Name might need work. 'GPT' already taken by some other piracy-adjacent technology." },
    tags: ["cartography", "treasure", "standards"],
    confidence: 0.91,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(16, 13),
  },

  // === REFERENCE (5) ===
  {
    name: "How to properly insult a pirate",
    content: "**Canonical insult → required counter:**\n- \"You fight like a dairy farmer.\" → \"How appropriate. You fight like a cow.\"\n- \"This is the END for you, you gutter-crawling cur!\" → \"And I've got a little TIP for you, get the POINT?\"\n- \"Soon you'll be wearing my sword like a shish kebab!\" → \"First you better stop waving it like a feather-duster.\"\n\n**Notes:**\n- Carla calls this 'verbal defensive technique' — hold for the full reply before swinging.\n- On Monkey Island proper, counters differ. Different Sword Master, different insults.",
    category: "reference",
    fields: { notes: "Compiled from Carla's lessons + Scumm Bar fights" },
    tags: ["insult-swordfighting", "combat", "cheatsheet"],
    confidence: 0.94,
    visibility: "shared",
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(8, 14),
  },
  {
    name: "LeChuck — known weakness: root beer",
    content: "**Confirmed weaknesses:**\n- Root beer — dissolves zombie/ghost form. Primary disposal method.\n- Voodoo doll — requires hair, tooth, sock, something-of-the-dead.\n- Chicken-based contraptions — mechanism unclear, but they work.\n\n**Sightings log:**\n- Scumm Bar patron (drunk): near Big Whoop, three moons ago.\n- Wally: shadow on the chart, east of Plunder Island.\n- Voodoo Lady: confirmed. Said nothing more.",
    category: "reference",
    fields: { notes: "Always carry a root beer. Always." },
    tags: ["lechuck", "voodoo", "weakness"],
    confidence: 0.96,
    visibility: "shared",
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(5, 11),
  },
  {
    name: "Grog recipe (do NOT inhale)",
    content: "**Caribbean standard — per tankard:**\n- 2 parts rum\n- 1 part kerosene (!!)\n- 1 part propylene glycol\n- 1 part artificial sweeteners\n- 1 part lead (legal in international waters)\n- 1 part battery acid\n- 1 part pepperoni (optional, traditional)\n\nShake vigorously. Do not breathe fumes. Serve in wooden tankard (metal dissolves).",
    category: "reference",
    fields: { notes: "Stan's recipe. Legally distinct from Caribbean Standard Grog™ by a margin of lead content." },
    tags: ["grog", "recipe", "stan"],
    confidence: 0.87,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(16, 7),
  },
  {
    name: "Voodoo incantations reference card",
    content: "**Core repertoire (Voodoo Lady taught):**\n- *Summons Minor:* useful for retrieving dropped objects from enemy hands.\n- *Glamour of Comprehension:* briefly understand Murray's riddles.\n- *Binding of Lesser Curses:* fixes most hauntings under 50 years old.\n- *Root Beer Transmutation:* converts any liquid to root beer (range 1m, once per day).\n\nAll require the charm she gave me. Without it, results are unpredictable and often on fire.",
    category: "reference",
    fields: { notes: "Practice in the courtyard, not the kitchen. (Ask the cook about the soup incident.)" },
    tags: ["voodoo", "cheatsheet", "magic"],
    confidence: 0.88,
    visibility: "shared",
    source: "webapp",
    source_type: "text",
    created_at: daysAgo(10, 16),
  },
  {
    name: "Stan's haggling cheatsheet",
    content: "**Opening moves:**\n- Stan always opens at 6x actual value. Don't flinch.\n- Counter with 0.5x. He laughs; that's good.\n- Walk toward the door. Twice if needed.\n\n**Price floor:**\n- Used ships: 15% of opening.\n- Grog: 50% of opening.\n- Paperwork: he doesn't negotiate on paperwork. Don't waste time.\n\n**Never:**\n- Compliment the green jacket. That's his trigger.",
    category: "reference",
    fields: { notes: "Field-tested across four Stan transactions. Confidence high." },
    tags: ["stan", "haggling", "cheatsheet"],
    confidence: 0.92,
    visibility: "shared",
    source: "telegram",
    source_type: "text",
    created_at: daysAgo(17, 20),
  },
];

// ---------------------------------------------------------------------------
// Also seed a demo daily digest so the dashboard looks complete
// ---------------------------------------------------------------------------

const dailyDigest = `**TOP 3 TODAY**
1. Pay Captain Dread and board the SS Sea Monkey before the tide turns — Monkey Island won't wait, and LeChuck is already on the move.
2. Reply to Elaine's letter. She asked about the engagement ring timeline — keep it vague, it's supposed to be a surprise.
3. Pick up the commissioned map from Wally the cartographer. He opens at ten and closes whenever pirates stop buying grog.

**STUCK ON**
Talking to Murray about the navigator's key — three conversations, four riddles, zero coordinates. Consider threatening to put him back in the bag.

**SMALL WIN**
Out-haggled Stan on the ship sale — the Sea Monkey for 5,000 pieces of eight, down from 30,000. He even threw in the anchor.`;

const weeklyDigest = `**WHAT HAPPENED**
- Voyage prep dominated the week: finalised the Sea Monkey crew manifest, topped up grog, chased Wally for the map, drilled Melee Island militia twice.
- Intel on LeChuck firmed up — three independent Scumm Bar patrons placed him near Big Whoop. The Voodoo Lady confirmed "stormy waters ahead."
- Social channel: two letters to Elaine, one encoded telegram from Herman Toothrot, one oddly cheerful note from Murray.
- Sharpened insult swordfighting — won two duels, lost one to Carla (she called you a limp-wristed landlubber, which you hadn't prepared for).

**OPEN LOOPS**
- Engagement ring from the Phatt Island cartographer — paused for two weeks, still no shipping update.
- Library book overdue at the Scumm Bar — fine is now three doubloons and the librarian stopped making eye contact.
- Rubber chicken with a pulley in the middle — still unacquired despite two trips to the general store.

**NEXT WEEK**
- Set sail for Monkey Island — weather permitting, cannon count approved by the Voodoo Lady.
- Test new insult swordfighting routines on Largo LaGrande if he's at the Bloody Lip again.
- Restock voodoo supplies with the Voodoo Lady — she specifically requested "more eye of newt, less attitude."

**PATTERN**
Every voyage cycle ends with you over-provisioning grog and under-provisioning maps. Buy the map first next time.`;

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

async function seed() {
  console.log("Seeding demo data (Monkey Island edition)...\n");

  // Clear existing entries (but not settings)
  await sql`DELETE FROM entries`;
  await sql`DELETE FROM digests`;
  console.log("Cleared existing entries and digests.\n");

  for (const e of entries) {
    await sql`
      INSERT INTO entries (name, content, category, fields, tags, confidence, visibility, source, source_type, created_at, updated_at)
      VALUES (
        ${e.name},
        ${e.content},
        ${e.category},
        ${sql.json(e.fields)},
        ${e.tags},
        ${e.confidence},
        ${e.visibility},
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
