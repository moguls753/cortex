// Display layout builder for Satori rendering.
// Produces a Satori-compatible element tree matching the "Classified Briefing" design.

// Side-effect import: registers the translation catalogs with i18next.
// A type-only import would be erased and leave t() resolving to nothing.
import "../web/i18n/index.js";
import i18next, { type TFunction } from "i18next";
import { ALL_DAY, type DisplayData, type DisplayEvent, type DisplayTask } from "./types.js";
import { weatherConditionKey } from "./weather-data.js";
import {
  iconBrain,
  iconCalendar,
  iconCheckSquare,
  iconCheck,
  weatherIcon,
} from "./icons.js";

// ─── Type Scale ────────────────────────────────────────────────

// Sized for a 1872x1404 panel read from across a room. Every font size in this
// file comes from here — retune the display's legibility in one place rather
// than hunting literals through the layout. `scale` is the user's
// `display_font_scale` setting: 1 reproduces the reference sizes, larger values
// suit a longer viewing distance, smaller ones suit panels like the 800x480
// TRMNL OG where the reference type overwhelms the canvas.
export function typeScale(scale: number) {
  const s = (n: number) => Math.round(n * scale);
  return {
    brand: s(48),
    headerMeta: s(34),
    sectionTitle: s(32),
    temp: s(88),
    condition: s(28),
    highLow: s(28),
    hourlyTime: s(24),
    hourlyTemp: s(30),
    eventTime: s(32),
    eventName: s(38),
    eventTimeSmall: s(26),
    eventNameSmall: s(30),
    badge: s(20),
    taskName: s(32),
    taskDue: s(24),
    tomorrowLabel: s(28),
    emptyState: s(32),
    overflow: s(26),
    footer: s(22),
  };
}

// Pixel dimensions welded to the type scale — icons sitting beside text and the
// fixed-width time gutter. These have to move with the font or the layout drifts
// out of alignment (clipped time strings, icons dwarfed by their labels).
// Deliberately excludes the root page padding: at scale 2.0 a scaled margin
// would eat the panel.
export function dimensionScale(scale: number) {
  const s = (n: number) => Math.round(n * scale);
  return {
    eventTimeColumn: s(150),
    checkbox: s(34),
    checkboxIcon: s(20),
    brandIcon: s(44),
    sectionIcon: s(32),
    emptyStateIcon: s(28),
    weatherIcon: s(64),
    // Fits "TOMORROW" at the high/low label size.
    weatherLabel: s(170),
  };
}

// The week-ahead list under Today. Rows are capped so a busy week cannot push
// the footer off the panel; the remainder is summarised instead of clipped. The
// cap is inversely proportional to the font scale because taller rows fit the
// same vertical budget fewer times — 10 rows at the reference size, 5 at 2.0x.
// Never below 1, so a single row plus a "+N more" summary always survives.
export function maxUpcomingRows(scale: number): number {
  return Math.max(1, Math.round(10 / scale));
}

// The promoted week-ahead list, used when today is empty. Rows carry today's
// larger type, so ~26% taller than a secondary row — the ceiling is lower to
// match. 8 rows at the reference size, 4 at 2.0x. The pixel budget is still the
// binding constraint on a short panel; this is the belt-and-braces ceiling,
// same as maxUpcomingRows.
export function maxPromotedRows(scale: number): number {
  return Math.max(1, Math.round(8 / scale));
}

// Everything the layout needs to size itself, resolved once per render and
// threaded explicitly. Module-level state would break re-entrancy — concurrent
// requests can legitimately render at different scales.
type Metrics = {
  fs: ReturnType<typeof typeScale>;
  dim: ReturnType<typeof dimensionScale>;
  maxUpcomingRows: number;
  maxPromotedRows: number;
  /** Vertical pixels available to each content column, after chrome. */
  columnPx: number;
  /** Horizontal pixels a task name has before it wraps. */
  taskNamePx: number;
  /** Translator for every string the panel renders. */
  t: TFunction;
};

// Text occupies roughly 1.35x its font size once line-height is accounted for.
const LINE = 1.35;

/**
 * Vertical space left for the two content columns once the header, weather
 * strip, section heading and footer have taken their share.
 *
 * Row counts must be bounded by the canvas, not by the font scale alone: at a
 * large scale on a short panel the columns otherwise overflow, and Satori/Resvg
 * abort the whole render rather than clipping — a 500 and a blank panel. This
 * is an estimate, deliberately conservative, and it only decides how many rows
 * are drawn versus summarised in a "+N more" line.
 */
export function columnBudget(
  scale: number,
  height: number,
  hasWeather: boolean,
): number {
  const fs = typeScale(scale);
  const dim = dimensionScale(scale);
  const chrome =
    96 + // root padding, top and bottom
    Math.max(fs.brand, dim.brandIcon) * LINE +
    25 + // header padding + rule
    (hasWeather ? fs.temp * 1.1 + fs.condition * LINE + 69 : 0) +
    32 + // main content padding
    Math.max(fs.sectionTitle, dim.sectionIcon) * LINE +
    33 + // section heading, divider, margin
    fs.footer * LINE +
    25; // footer padding + rule
  return Math.max(0, height - chrome);
}

/**
 * Height of one row of each kind, including the gap that follows it.
 *
 * Addressed by font scale rather than by `Metrics` so the row allocators can be
 * exported as test seams without fabricating a whole `Metrics`.
 */
function rowHeights(fs: ReturnType<typeof typeScale>) {
  const taskLine = fs.taskName * LINE;
  const taskDueLine = fs.taskDue * LINE;
  return {
    today: fs.eventName * LINE + 20,
    upcoming: fs.eventNameSmall * LINE + 16,
    upcomingGroup: fs.tomorrowLabel * LINE + 32,
    upcomingChrome: 73, // marginTop + paddingTop + rule
    overflow: fs.overflow * LINE + 8,
    /** One line of a task name. A name wraps to at most MAX_TASK_NAME_LINES. */
    taskLine,
    /** The due state under a task name. A completed row does not draw one. */
    taskDueLine,
    /**
     * The shortest row the column can draw that still carries a due state: one
     * name line, one due line, and the gap that follows. `taskRowPx` sizes the
     * real rows; this is the unit the exported allocator seam is addressed by.
     */
    task: taskLine + taskDueLine + 24,
    /**
     * The whitespace that separates open work from the completed log, on top of
     * the column's own 20px gap.
     *
     * This replaced a 1px `COLOR.rule` hairline. On a 4-bit panel the
     * background quantizes to 238 and the rule to 204 — roughly 14% Weber
     * contrast carried by a single pixel, which at ~176 ppi and 2.5–3 m is
     * below acuity. Worse, neither the 1px nor its 20px gap scaled with the
     * type, so the separation grew *weaker* at 1.5x, exactly where the panel is
     * configured for a longer viewing distance. Space scales; a hairline does
     * not. The completed block still carries three independent signals — the
     * checkbox state, the strikethrough, and the absent due line — so the rule
     * was never the thing doing the work.
     */
    taskGap: Math.round(fs.taskName * 0.75),
    /**
     * The "all clear" line that heads a task column with no open work, plus the
     * margin above it.
     */
    allClear: fs.emptyState * LINE + 20,
    // The collapsed "no events today" line plus the margin that separates it
    // from the promoted week list. Today's italic empty state is deliberately
    // *not* budgeted here — it only appears in the empty-empty state, which has
    // no rows competing for the column.
    quietToday: fs.overflow * LINE + 24,
  };
}

/**
 * How the task column divides its vertical budget between open and completed
 * work, given the drawn height of each candidate row.
 *
 * Open work claims space first: a completion is a footnote, so it is the first
 * thing dropped when the canvas runs short. The whitespace between the two
 * blocks is charged to the completed block — if it would push the last
 * completed row past the budget, that row goes rather than the separation,
 * because overflowing the canvas aborts the Resvg render and blanks the panel.
 *
 * Heights are per row rather than uniform because a task name wraps to a
 * second line and a completed row draws no due state, so rows differ by up to
 * `h.taskLine + h.taskDueLine`. Budgeting every row at the tallest shape would
 * halve a column of short names; budgeting them all at the shortest is what
 * made a long name overflow the canvas.
 */
function allocateTaskRows(
  openPx: number[],
  donePx: number[],
  columnPx: number,
  h: ReturnType<typeof rowHeights>,
): { open: number; done: number; gap: boolean } {
  // With no open work the column leads with the "All clear" line, which costs
  // vertical space before any completed row is drawn.
  const available =
    columnPx -
    h.overflow -
    (openPx.length === 0 && donePx.length > 0 ? h.allClear : 0);

  let used = 0;
  let open = 0;
  for (const px of openPx) {
    if (used + px > available) break;
    used += px;
    open += 1;
  }
  // Never below 1 — one row plus its "+N more" summary always survives, even
  // on a canvas that budgets nothing at all.
  if (open === 0 && openPx.length > 0) {
    open = 1;
    used = openPx[0];
  }

  let done = 0;
  // The separation is paid once, before the first completed row.
  let doneUsed = used + h.taskGap;
  for (const px of donePx) {
    if (doneUsed + px > available) break;
    doneUsed += px;
    done += 1;
  }

  return { open, done, gap: done > 0 };
}

/**
 * Test seam: the same maths, addressed by row counts at a given font scale.
 * Every row is sized as `h.task` — one name line plus a due line — which is
 * the shape the pixel algebra in the tests is written against. The real caller
 * sizes each row from its own name and due state via `taskRowPx`.
 */
export function taskRowAllocation(
  openCount: number,
  doneCount: number,
  columnPx: number,
  scale = 1,
) {
  const h = rowHeights(typeScale(scale));
  return allocateTaskRows(
    Array<number>(openCount).fill(h.task),
    Array<number>(doneCount).fill(h.task),
    columnPx,
    h,
  );
}

/** Test seam: the heights the task column is budgeted from. */
export function taskRowHeights(scale = 1) {
  const h = rowHeights(typeScale(scale));
  return {
    task: h.task,
    line: h.taskLine,
    dueLine: h.taskDueLine,
    overflow: h.overflow,
    gap: h.taskGap,
    allClear: h.allClear,
  };
}

/** Test seam: the heights the calendar column is budgeted from. */
export function eventRowHeights(scale = 1) {
  const h = rowHeights(typeScale(scale));
  return {
    today: h.today,
    upcoming: h.upcoming,
    upcomingGroup: h.upcomingGroup,
    upcomingChrome: h.upcomingChrome,
    overflow: h.overflow,
    quietToday: h.quietToday,
  };
}

// JetBrains Mono advance width as a fraction of the font size. Monospace, so
// one constant covers every glyph. The font's real advance is 0.6; the extra
// is slack, and it only ever over-estimates a string's width.
const GLYPH_RATIO = 0.62;

/**
 * How many lines a task name may occupy before it is truncated.
 *
 * One line was the budget but never the constraint — the name had no wrapping
 * limit at all, so a long one silently grew the row past what `h.task`
 * accounted for, ran the column off the canvas, and made Resvg abort the whole
 * render (`unreachable`) for a 500 and a blank panel. Two, because a wrapped
 * name reads well and shortening real task names to fit one line is the
 * information loss the panel exists to avoid.
 */
export const MAX_TASK_NAME_LINES = 2;

/**
 * Horizontal pixels a task name has before it wraps, derived from the flex
 * geometry the row renders in: page padding, the gap between the two columns,
 * the nominal 2:1 column split, the task column's rule and padding, then the
 * checkbox and the gap beside it.
 *
 * A deliberate under-estimate — Satori hands the task column slightly more
 * than a third, so the real line holds two or three characters more than this
 * says at every scale. Under-counting only ever budgets a row as taller than
 * it draws, which under-fills the column; over-counting is what runs it off
 * the canvas. `display-rasterize.test.ts` measures the true figure against
 * real Satori shaping and fails if this one ever overtakes it.
 *
 * `flex: 2`/`flex: 1` resolve to a zero basis in Satori, so the split does not
 * move with content: verified against an empty calendar column, a 300-glyph
 * event title, a 42-glyph badge, twelve rows, and a 96-glyph day label.
 */
function taskNameWidth(
  width: number,
  dim: ReturnType<typeof dimensionScale>,
): number {
  const content = width - 96; // root padding, both sides
  const columns = content - 48; // the gap between the two columns
  const taskColumn = columns / 3; // calendar flexGrow 2, tasks flexGrow 1
  const inner = taskColumn - 48 - 1; // paddingLeft + borderLeft
  return Math.max(1, inner - 16 - dim.checkbox); // row gap + checkbox
}

/**
 * The drawn height of one task row: its name lines, its due state if it has
 * one, and the gap that follows it.
 *
 * The line count is exact for a monospace font — a name no wider than the
 * column cannot wrap wherever its spaces fall, and anything wider is clamped
 * to `MAX_TASK_NAME_LINES` regardless of where it breaks.
 */
function taskRowPx(
  task: DisplayTask,
  m: Metrics,
  h: ReturnType<typeof rowHeights>,
): number {
  const lines =
    task.name.length <= taskNameCapacity(m.taskNamePx, m.fs.taskName)
      ? 1
      : MAX_TASK_NAME_LINES;
  return lines * h.taskLine + (task.due ? h.taskDueLine : 0) + 24;
}

/** Characters of a task name that fit on one line of the column. */
function taskNameCapacity(namePx: number, fontSize: number): number {
  return Math.floor(namePx / (fontSize * GLYPH_RATIO));
}

/**
 * Test seam: the one-line character capacity of the task name column, which
 * the row budget's line count turns on. Must never exceed what Satori actually
 * fits, or a row draws taller than it was budgeted for.
 */
export function taskNameChars(width: number, scale = 1): number {
  return taskNameCapacity(
    taskNameWidth(width, dimensionScale(scale)),
    typeScale(scale).taskName,
  );
}

function metrics(
  scale: number,
  columnPx: number,
  width: number,
  t: TFunction,
): Metrics {
  const fs = typeScale(scale);
  const dim = dimensionScale(scale);

  // The time gutter has to fit the longest label it will ever hold, which is
  // the translated all-day string — "ganztägig" is half again as wide as
  // "all day" and ran into the event title.
  const allDayWidth = Math.ceil(
    String(t("display.all_day")).length * fs.eventTime * GLYPH_RATIO,
  );

  // A multi-day event replaces its time with a day span ("to SAT", "bis SA").
  // Neither shipped locale exceeds the all-day label, but a future translation
  // could, and a clipped gutter runs into the event title.
  const spanWidth = Math.ceil(
    String(t("display.event_span_until", { to: "WWW" })).length *
      fs.eventTime *
      GLYPH_RATIO,
  );

  return {
    fs,
    dim: {
      ...dim,
      eventTimeColumn: Math.max(dim.eventTimeColumn, allDayWidth, spanWidth),
    },
    maxUpcomingRows: maxUpcomingRows(scale),
    maxPromotedRows: maxPromotedRows(scale),
    columnPx,
    taskNamePx: taskNameWidth(width, dim),
    t,
  };
}

// ─── Colour ────────────────────────────────────────────────────

// Contrast ratios against the panel background, which is unlit e-ink read from
// across a room. Everything carrying text clears WCAG AA (4.5:1); the old #888
// body colour measured 3.3:1 and was the first thing to fail in dim light.
// Two text tones, not three. Content — event titles, task names, temperatures —
// is ink. Everything that labels or locates that content — times, weekday
// headings, badges, due states — is muted. A third mid-grey read as noise
// rather than as hierarchy, since size and position already separate the
// today list from the week ahead.
const COLOR = {
  background: "#f5f5f5",
  /** Content — 16:1. */
  ink: "#1a1a1a",
  /** Labels and metadata — 5.3:1, still clear of WCAG AA. */
  muted: "#666",
  /** Borders and rules only. Never text. */
  hairline: "#888",
  /** Subdivider inside a column. */
  rule: "#ccc",
} as const;

// ─── Satori Element Helpers ────────────────────────────────────

type El = {
  type: string;
  props: Record<string, unknown>;
};

function el(
  type: string,
  props: Record<string, unknown>,
  ...children: (El | string | null | false | undefined)[]
): El {
  const filtered = children.filter(Boolean) as (El | string)[];
  // Satori expects children inside props, not as a separate field
  if (filtered.length === 1) {
    return { type, props: { ...props, children: filtered[0] } };
  }
  if (filtered.length > 1) {
    return { type, props: { ...props, children: filtered } };
  }
  return { type, props };
}

function text(style: Record<string, unknown>, content: string): El {
  return el("span", { style }, content);
}

/**
 * The current temperature keeps its tenth — it is the one number read against
 * a phone app, where a rounded degree looks like a disagreement.
 */
function formatTemp(value: number): string {
  return value.toFixed(1);
}

/**
 * Forecast values are whole degrees: a tenth of a degree six hours out is
 * false precision, and the extra glyphs cost scan time on a wall panel.
 */
function formatTempWhole(value: number): string {
  return String(Math.round(value));
}

function divider(color: string = COLOR.ink): El {
  return el("div", {
    style: { height: 1, backgroundColor: color, width: "100%" },
  });
}

// ─── Reusable Components ───────────────────────────────────────

function sectionHeader(title: string, icon: El, m: Metrics): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        marginBottom: 24,
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
        },
      },
      icon,
      text(
        {
          fontSize: m.fs.sectionTitle,
          fontWeight: 500,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
        },
        title,
      ),
    ),
    divider(),
  );
}

function calendarBadge(label: string, m: Metrics): El {
  return text(
    {
      fontSize: m.fs.badge,
      color: COLOR.muted,
      border: `1px solid ${COLOR.hairline}`,
      borderRadius: 2,
      padding: "1px 8px",
      letterSpacing: "0.05em",
    },
    label,
  );
}

/** "TODAY  14|34°" — low|high, label column fixed so the pairs line up. */
function highLowRow(label: string, high: number, low: number, m: Metrics): El {
  return el(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 16 } },
    text(
      {
        width: m.dim.weatherLabel,
        flexShrink: 0,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      },
      label,
    ),
    // No H/L letters: they needed translating (Hoch/Tief) and read
    // inconsistently once one of them changed language.
    text(
      { color: COLOR.ink },
      `${formatTempWhole(low)}|${formatTempWhole(high)}°`,
    ),
  );
}

function eventRow(event: DisplayEvent, large: boolean, m: Metrics): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 24,
      },
    },
    text(
      {
        fontSize: large ? m.fs.eventTime : m.fs.eventTimeSmall,
        color: COLOR.muted,
        // Wide enough for "all day" at the larger size.
        width: m.dim.eventTimeColumn,
        flexShrink: 0,
      },
      // A multi-day event's span replaces its start time: for something running
      // Thursday to Saturday, "when" is the span, not the hour it began.
      event.span ?? (event.time === ALL_DAY ? m.t("display.all_day") : event.time),
    ),
    text(
      {
        fontSize: large ? m.fs.eventName : m.fs.eventNameSmall,
        flex: 1,
        color: COLOR.ink,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      event.name,
    ),
    calendarBadge(event.calendar, m),
  );
}

function checkbox(done: boolean, m: Metrics): El {
  if (done) {
    // Outline and tick, both muted — not a solid ink fill. Filled, the done
    // boxes were the darkest marks anywhere on the panel, so the heaviest
    // thing in the task column flagged the least important content: the eye
    // landed on what was already finished. Unfilled, the whole completed row
    // reads as one tone, and it is still unmistakably ticked.
    return el(
      "div",
      {
        style: {
          width: m.dim.checkbox,
          height: m.dim.checkbox,
          border: `2px solid ${COLOR.muted}`,
          borderRadius: 2,
          color: COLOR.muted,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        },
      },
      iconCheck(m.dim.checkboxIcon),
    );
  }
  return el("div", {
    style: {
      width: m.dim.checkbox,
      height: m.dim.checkbox,
      border: `2px solid ${COLOR.ink}`,
      borderRadius: 2,
      flexShrink: 0,
    },
  });
}

function taskRow(task: DisplayTask, m: Metrics): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
      },
    },
    checkbox(task.done, m),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          flex: 1,
        },
      },
      text(
        {
          fontSize: m.fs.taskName,
          color: task.done ? COLOR.muted : COLOR.ink,
          textDecoration: task.done ? "line-through" : "none",
          // A name is allowed to wrap — "Alma Haarverlängerung entfernen" over
          // two lines beats a truncated one — but not without a ceiling: the
          // row budget can only guarantee the canvas if the row cannot grow
          // past what it was budgeted for. `display: block` is what makes
          // Satori honour lineClamp.
          display: "block",
          lineClamp: MAX_TASK_NAME_LINES,
          // lineClamp only ellipsises text that actually wraps, and a German
          // compound or a URL offers no break opportunity — it would run off
          // the column edge and be clipped by the page margin with nothing to
          // show it was truncated. Breaking mid-word gives the clamp something
          // to bite on, and makes the drawn height match the budgeted one.
          wordBreak: "break-word",
        },
        task.name,
      ),
      task.due
        ? text(
            {
              fontSize: m.fs.taskDue,
              color: COLOR.muted,
              marginTop: 4,
              // Compared against the catalog rather than a literal: the label
              // arrives already translated, and "überfällig" never equalled
              // "overdue", so German panels silently lost the bold weight.
              fontWeight: task.due === m.t("display.due.overdue") ? 700 : 400,
            },
            task.due,
          )
        : false,
    ),
  );
}

// ─── Layout Sections ───────────────────────────────────────────

function buildHeader(data: DisplayData, m: Metrics): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingBottom: 24,
        borderBottom: `1px solid ${COLOR.ink}`,
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 12,
        },
      },
      iconBrain(m.dim.brandIcon),
      text(
        { fontSize: m.fs.brand, fontWeight: 500, letterSpacing: "0.05em" },
        "cortex",
      ),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 32,
          fontSize: m.fs.headerMeta,
        },
      },
      text({}, data.date),
      text({ fontWeight: 500 }, data.time),
    ),
  );
}

function buildWeatherStrip(data: DisplayData, m: Metrics): El | false {
  if (!data.weather) return false;

  const w = data.weather;
  return el(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: 32,
        paddingBottom: 32,
        borderBottom: `1px solid ${COLOR.ink}`,
      },
    },
    // Left group: icon + temp + condition + H/L
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 40,
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 24,
          },
        },
        weatherIcon(w.weatherCode, m.dim.weatherIcon),
        el(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
            },
          },
          text(
            { fontSize: m.fs.temp, fontWeight: 300, lineHeight: 1 },
            `${formatTemp(w.current)}\u00B0C`,
          ),
          text(
            { fontSize: m.fs.condition, color: COLOR.muted, marginTop: 4 },
            m.t(`display.weather.${weatherConditionKey(w.weatherCode)}`, {
              defaultValue: w.condition,
            }),
          ),
        ),
      ),
      el(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 4,
            paddingLeft: 40,
            borderLeft: `1px solid ${COLOR.rule}`,
            fontSize: m.fs.highLow,
            color: COLOR.muted,
          },
        },
        // Today's pair goes stale after the afternoon peak, so tomorrow's sits
        // beside it \u2014 one of the two rows is always still ahead of you.
        highLowRow(m.t("display.today"), w.high, w.low, m),
        highLowRow(m.t("display.tomorrow"), w.tomorrowHigh, w.tomorrowLow, m),
      ),
    ),
    // Right group: hourly forecasts
    el(
      "div",
      { style: { display: "flex", gap: 32 } },
      ...w.hourly.map((h) =>
        el(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            },
          },
          text({ fontSize: m.fs.hourlyTime, color: COLOR.muted }, h.time),
          text(
            { fontSize: m.fs.hourlyTemp, marginTop: 4 },
            `${formatTempWhole(h.temp)}\u00B0`,
          ),
        ),
      ),
    ),
  );
}

/**
 * The week-ahead list.
 *
 * `promoted` is the adaptive-hierarchy mode used when today has no events: the
 * list carries the column's own section heading and today's larger type, so it
 * drops the divider chrome it wears when it sits underneath today's list.
 */
function upcomingSection(
  data: DisplayData,
  m: Metrics,
  availablePx: number,
  promoted: boolean,
): El | false {
  if (data.upcomingDays.length === 0) return false;

  const h = rowHeights(m.fs);
  // A promoted row is today's row: taller type, taller gap. Sizing the fits
  // maths with the secondary height here would overflow the canvas, which
  // aborts the Resvg render and blanks the panel.
  const rowPx = promoted ? h.today : h.upcoming;
  // Paired with `wrapperStyle` below — a promoted list draws no rule above it,
  // so it is charged no chrome. Change one and the other must follow.
  const chromePx = promoted ? 0 : h.upcomingChrome;
  const rowGap = promoted ? 20 : 16;
  const groups: El[] = [];
  let hidden = 0;
  // Rows are limited by both the scale-derived ceiling and the space actually
  // left on the panel, whichever bites first.
  let budget = promoted ? m.maxPromotedRows : m.maxUpcomingRows;
  // The section's own heading chrome and a possible "+N more" line have to fit
  // before any row is worth drawing.
  let px = availablePx - chromePx - h.overflow;

  const wrapperStyle = promoted
    ? { display: "flex", flexDirection: "column" }
    : {
        marginTop: 40,
        paddingTop: 32,
        borderTop: `1px solid ${COLOR.rule}`,
        display: "flex",
        flexDirection: "column",
      };

  for (const day of data.upcomingDays) {
    const fits = Math.floor((px - h.upcomingGroup) / rowPx);
    const room = Math.max(0, Math.min(budget, fits));
    // A day heading costs nothing if no row follows it, so stop cleanly.
    const shown = day.events.slice(0, room);
    hidden += day.events.length - shown.length;
    budget -= shown.length;
    if (shown.length > 0) {
      px -= h.upcomingGroup + shown.length * rowPx;
    }
    if (shown.length === 0) continue;

    groups.push(
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", marginBottom: 20 } },
        text(
          {
            fontSize: m.fs.tomorrowLabel,
            fontWeight: 500,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: COLOR.muted,
            marginBottom: 12,
          },
          day.label,
        ),
        el(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: rowGap } },
          ...shown.map((e) => eventRow(e, promoted, m)),
        ),
      ),
    );
  }

  // Nothing fits, but the week is not empty: keep the summary line so the
  // events are accounted for rather than silently disappearing.
  if (groups.length === 0) {
    if (hidden === 0) return false;
    return el(
      "div",
      { style: wrapperStyle },
      text(
        { fontSize: m.fs.overflow, color: COLOR.muted },
        m.t("display.more_this_week", { count: hidden }),
      ),
    );
  }

  return el(
    "div",
    { style: wrapperStyle },
    ...groups,
    hidden > 0
      ? text(
          { fontSize: m.fs.overflow, color: COLOR.muted },
          m.t("display.more_this_week", { count: hidden }),
        )
      : false,
  );
}

function buildCalendarColumn(data: DisplayData, m: Metrics): El {
  const h = rowHeights(m.fs);
  const hasToday = data.todayEvents.length > 0;
  // Not `upcomingDays.length > 0`: a day group with an empty events array
  // renders nothing, and promoting an empty list would leave a WEEK AHEAD
  // heading over one quiet line.
  const hasUpcoming = data.upcomingDays.some((d) => d.events.length > 0);

  if (!hasToday && hasUpcoming) {
    // Nothing today is the common case, and the week ahead is the only real
    // content — so it gets the column's heading and today's type, and the
    // empty day collapses to a single line of status.
    const availablePx = Math.max(0, m.columnPx - h.quietToday);
    return el(
      "div",
      {
        style: {
          flex: 2,
          display: "flex",
          flexDirection: "column",
        },
      },
      sectionHeader(m.t("display.week_ahead"), iconCalendar(m.dim.sectionIcon), m),
      text(
        {
          fontSize: m.fs.overflow,
          color: COLOR.muted,
          fontStyle: "italic",
          marginBottom: 24,
        },
        m.t("display.no_events"),
      ),
      upcomingSection(data, m, availablePx, true),
    );
  }

  // Today's list gets first claim on the column; whatever it leaves goes to the
  // week ahead. Both are bounded by the canvas so nothing overflows the panel.
  const fitsToday = Math.max(1, Math.floor(m.columnPx / h.today));
  const cap = Math.min(data.maxTodayEvents, fitsToday);
  const visibleEvents = data.todayEvents.slice(0, cap);
  const overflow = data.todayEvents.length - visibleEvents.length;
  const usedPx =
    visibleEvents.length * h.today + (overflow > 0 ? h.overflow : 0);
  const remainingPx = m.columnPx - usedPx;

  const todayContent: (El | string | null | false)[] =
    data.todayEvents.length === 0
      ? [
          text(
            {
              fontSize: m.fs.emptyState,
              color: COLOR.muted,
              fontStyle: "italic",
              marginTop: 20,
            },
            m.t("display.no_events"),
          ),
        ]
      : [
          ...visibleEvents.map((e) => eventRow(e, true, m)),
          ...(overflow > 0
            ? [
                text(
                  { fontSize: m.fs.overflow, color: COLOR.muted, marginTop: 8 },
                  m.t("display.more", { count: overflow }),
                ),
              ]
            : []),
        ];

  return el(
    "div",
    {
      style: {
        flex: 2,
        display: "flex",
        flexDirection: "column",
      },
    },
    sectionHeader(m.t("display.today"), iconCalendar(m.dim.sectionIcon), m),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 20,
        },
      },
      ...todayContent,
    ),
    upcomingSection(data, m, remainingPx, false),
  );
}

/**
 * "All clear" — the check line for a task column with nothing open.
 *
 * `muted` is the nothing-at-all state, where the line is the only thing in the
 * column and reads as a quiet aside. With completions under it the same line is
 * the column's headline instead — full ink, upright — because everything being
 * done is the best state the panel can report, and it should not be whispered
 * under four struck-through rows.
 */
function allClearRow(m: Metrics, muted: boolean): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 20,
        color: muted ? COLOR.muted : COLOR.ink,
      },
    },
    iconCheck(m.dim.emptyStateIcon),
    text(
      {
        fontSize: m.fs.emptyState,
        fontStyle: muted ? "italic" : "normal",
      },
      m.t("display.all_clear"),
    ),
  );
}

function buildTaskSection(data: DisplayData, m: Metrics): El {
  const h = rowHeights(m.fs);
  // Tasks are a separate column, so they get the full budget — but the same
  // treatment: summarise the tail instead of letting it run off the panel.
  const open = data.tasks.filter((task) => !task.done);
  const completed = data.tasks.filter((task) => task.done);
  const room = allocateTaskRows(
    open.map((task) => taskRowPx(task, m, h)),
    completed.map((task) => taskRowPx(task, m, h)),
    m.columnPx,
    h,
  );
  const visibleOpen = open.slice(0, room.open);
  const visibleDone = completed.slice(0, room.done);
  // Only open work is summarised: "+3 more" means three things still to do.
  // Completions that do not fit disappear the way the data layer's cap already
  // drops them — nobody needs to be told about ticks they cannot see.
  const taskOverflow = open.length - visibleOpen.length;

  const taskContent: (El | string | null | false)[] =
    data.tasks.length === 0
      ? [allClearRow(m, true)]
      : [
          // Nothing open, only ticks: lead with the verdict. Without it the
          // best state the column has renders as four struck-through rows and
          // nothing else, which reads as damage rather than as a clear day.
          // Paired with the `h.allClear` charge in `allocateTaskRows` — the
          // condition must stay identical there or the line goes unbudgeted.
          ...(open.length === 0 ? [allClearRow(m, false)] : []),
          ...visibleOpen.map((task) => taskRow(task, m)),
          // Whitespace, not a hairline, separates the log of completions from
          // the work above it — see `h.taskGap`. One child rather than N so
          // the extra space is paid exactly once.
          ...(room.gap
            ? [
                el(
                  "div",
                  {
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      gap: 20,
                      marginTop: h.taskGap,
                    },
                  },
                  ...visibleDone.map((task) => taskRow(task, m)),
                ),
              ]
            : []),
          ...(taskOverflow > 0
            ? [
                text(
                  { fontSize: m.fs.overflow, color: COLOR.muted, marginTop: 8 },
                  m.t("display.more", { count: taskOverflow }),
                ),
              ]
            : []),
        ];

  return el(
    "div",
    {
      style: {
        flex: 1,
        borderLeft: `1px solid ${COLOR.rule}`,
        paddingLeft: 48,
        display: "flex",
        flexDirection: "column",
      },
    },
    sectionHeader(m.t("display.dont_forget"), iconCheckSquare(m.dim.sectionIcon), m),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 20,
        },
      },
      ...taskContent,
    ),
  );
}

function buildFooter(data: DisplayData, m: Metrics): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "space-between",
        paddingTop: 24,
        borderTop: `1px solid ${COLOR.ink}`,
        fontSize: m.fs.footer,
        color: COLOR.muted,
      },
    },
    text({}, m.t("display.last_updated", { time: data.time })),
    text({}, "cortex"),
  );
}

// ─── Main Export ───────────────────────────────────────────────

export function buildLayout(
  data: DisplayData,
  width: number,
  height: number,
  fontScale = 1,
  t: TFunction = i18next.getFixedT("en") as TFunction,
): El {
  const m = metrics(
    fontScale,
    columnBudget(fontScale, height, data.weather !== null),
    width,
    t,
  );
  const header = buildHeader(data, m);
  const weatherStrip = buildWeatherStrip(data, m);
  const mainContent = el(
    "div",
    {
      style: {
        flex: 1,
        display: "flex",
        gap: 48,
        paddingTop: 32,
        overflow: "hidden",
      },
    },
    buildCalendarColumn(data, m),
    buildTaskSection(data, m),
  );
  const footer = buildFooter(data, m);

  return el(
    "div",
    {
      style: {
        width,
        height,
        backgroundColor: COLOR.background,
        color: COLOR.ink,
        // Deliberately unscaled: the page margin is a property of the panel,
        // not of the type. Scaling it would swallow the canvas at 2.0x.
        padding: 48,
        display: "flex",
        flexDirection: "column",
        fontFamily: "JetBrains Mono",
      },
    },
    header,
    weatherStrip,
    mainContent,
    footer,
  );
}
