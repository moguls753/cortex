# Kitchen Display — Design Prompt for v0 / Stitch

Use this prompt in v0.dev, Google Stitch, or any AI design tool to generate the visual layout.

---

## Prompt

Design a static kitchen dashboard image component for an e-paper display. This will be rendered as a PNG image, not an interactive app.

### Display constraints

- **Resolution:** 1872 x 1404 pixels (portrait orientation, 10.3 inch e-paper)
- **Color:** Grayscale only — 16 shades from white to black. No color at all.
- **Readability:** Must be readable from 1-2 meters away while standing in a kitchen
- **Font:** JetBrains Mono (monospace). Use it for everything.
- **Aesthetic:** "Terminal / Command Center" — clean, information-dense, high contrast. Think a well-designed TUI running on an e-paper screen. No rounded corners larger than 4px. No gradients. No shadows. Thin 1px borders.
- **No interactivity:** This is a static image. No buttons, no hover states, no inputs.

### Layout sections (top to bottom)

**1. Header bar**
- Left: "cortex" in medium weight + a small brain icon
- Right: Current date formatted as "Monday, March 31" and current time "07:30"

**2. Weather strip**
- Current temperature large (e.g., "14°C")
- Weather condition text (e.g., "Partly Cloudy")
- A simple weather icon (sun, cloud, rain — use a basic geometric/ascii representation suitable for grayscale)
- Today's high/low (e.g., "H: 18° L: 9°")
- Optionally: next 3-4 hours as a compact mini forecast row

**3. Today's schedule (largest section)**
- Header: "TODAY" with a calendar icon
- Timeline of events, each showing: time (e.g., "08:30"), event name (e.g., "Dentist — Mila"), calendar name in a small label (e.g., "FAMILY" or "WORK")
- Events listed vertically with enough spacing to read from distance
- If there are events tomorrow, show a smaller "TOMORROW" subsection below with 2-3 upcoming events

**4. Tasks / Don't forget**
- Header: "DON'T FORGET" or "TASKS" with a checkbox icon
- List of 3-5 pending tasks, each showing: task name, due date if available (e.g., "in 3 days")
- Style like a checklist with empty square checkboxes

**5. Footer / status bar**
- Small text at the bottom: "Last updated 07:30" and "cortex v0.1"

### Sample data to use

**Weather:**
- Current: 14°C, Partly Cloudy
- High: 18°C, Low: 9°C
- Next hours: 08:00 13°, 09:00 14°, 10:00 15°, 11:00 16°

**Today's events:**
- 08:30 Dentist — Mila [FAMILY]
- 10:00 Sprint Planning [WORK]
- 12:30 Lunch with Marcus [PERSONAL]
- 15:00 Soccer practice — Liam [FAMILY]
- 17:30 Grocery pickup [FAMILY]

**Tomorrow's events:**
- 09:00 Parent-teacher conference [FAMILY]
- 14:00 Call with Sarah [WORK]

**Tasks:**
- Renew passport (due Apr 3)
- Book summer flights
- Fix kitchen shelf
- Reply to school form (due Apr 1)
- Buy birthday gift for Anna (due Apr 5)

### Design notes

- Use generous whitespace between sections — e-paper dithering makes tightly packed content harder to read
- Section headers should use UPPERCASE, small tracking, with a thin horizontal rule below
- Text hierarchy: section headers ~24-28px, event times ~20px, event names ~22-24px, footer ~14px (scale proportionally for the 1872x1404 canvas)
- The entire layout should feel like one cohesive dashboard, not separate cards
- High contrast: use near-black (#1a1a1a) on near-white (#f5f5f5) background. Use medium gray (#888) sparingly for secondary info
- No emoji. Use simple geometric icons or omit icons entirely if it looks cleaner.
- Consider using thin horizontal dividers between sections, not boxes/cards
