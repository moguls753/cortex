// Kitchen display layout builder for Satori rendering.
// Produces a Satori-compatible element tree matching the "Classified Briefing" design.

import type { KitchenData, DisplayEvent, DisplayTask } from "./types.js";
import {
  iconBrain,
  iconCalendar,
  iconCheckSquare,
  iconCheck,
  weatherIcon,
} from "./icons.js";

// ─── Scale Factor ─────────────────────────────────────────────
// Reference layout is designed for 1872×1404. Scale all pixel values
// proportionally so the layout renders crisply at any resolution.

const REF_W = 1872;
const REF_H = 1404;
let s: (px: number) => number = (px) => px;

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

function divider(color = "#1a1a1a"): El {
  return el("div", {
    style: { height: Math.max(1, s(1)), backgroundColor: color, width: "100%" },
  });
}

// ─── Reusable Components ───────────────────────────────────────

function sectionHeader(title: string, icon: El): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        marginBottom: s(24),
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: s(12),
          marginBottom: s(8),
        },
      },
      icon,
      text(
        {
          fontSize: s(24),
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

function calendarBadge(label: string): El {
  return text(
    {
      fontSize: s(14),
      color: "#888",
      border: "1px solid #888",
      borderRadius: s(2),
      paddingTop: Math.max(1, s(1)),
      paddingBottom: Math.max(1, s(1)),
      paddingLeft: s(8),
      paddingRight: s(8),
      letterSpacing: "0.05em",
    },
    label,
  );
}

function eventRow(event: DisplayEvent, large: boolean): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: s(24),
      },
    },
    text(
      {
        fontSize: s(large ? 22 : 18),
        color: "#888",
        width: s(100),
        flexShrink: 0,
      },
      event.time,
    ),
    text(
      {
        fontSize: s(large ? 26 : 20),
        flex: 1,
        color: large ? "#1a1a1a" : "#555",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      event.name,
    ),
    calendarBadge(event.calendar),
  );
}

function checkbox(done: boolean): El {
  if (done) {
    return el(
      "div",
      {
        style: {
          width: s(24),
          height: s(24),
          backgroundColor: "#1a1a1a",
          color: "#f5f5f5",
          borderRadius: s(2),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        },
      },
      iconCheck(s(14)),
    );
  }
  return el("div", {
    style: {
      width: s(24),
      height: s(24),
      border: `${Math.max(1, s(2))}px solid #1a1a1a`,
      borderRadius: s(2),
      flexShrink: 0,
    },
  });
}

function taskRow(task: DisplayTask): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: s(16),
      },
    },
    checkbox(task.done),
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
          fontSize: s(22),
          color: task.done ? "#888" : "#1a1a1a",
          textDecoration: task.done ? "line-through" : "none",
        },
        task.name,
      ),
      task.due
        ? text(
            {
              fontSize: s(16),
              color: "#888",
              marginTop: s(4),
              fontWeight: task.due === "overdue" ? 700 : 400,
            },
            task.due,
          )
        : false,
    ),
  );
}

// ─── Layout Sections ───────────────────────────────────────────

function buildHeader(data: KitchenData): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingBottom: s(24),
        borderBottom: "1px solid #1a1a1a",
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: s(12),
        },
      },
      iconBrain(s(32)),
      text(
        { fontSize: s(32), fontWeight: 500, letterSpacing: "0.05em" },
        "cortex",
      ),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: s(32),
          fontSize: s(24),
        },
      },
      text({}, data.date),
      text({ fontWeight: 500 }, data.time),
    ),
  );
}

function buildWeatherStrip(data: KitchenData): El | false {
  if (!data.weather) return false;

  const w = data.weather;
  return el(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: s(32),
        paddingBottom: s(32),
        borderBottom: "1px solid #1a1a1a",
      },
    },
    // Left group: icon + temp + condition + H/L
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: s(40),
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: s(24),
          },
        },
        weatherIcon(w.weatherCode, s(48)),
        el(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
            },
          },
          text(
            { fontSize: s(64), fontWeight: 300, lineHeight: 1 },
            `${w.current}\u00B0C`,
          ),
          text({ fontSize: s(20), color: "#888", marginTop: s(4) }, w.condition),
        ),
      ),
      el(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            paddingLeft: s(40),
            borderLeft: "1px solid #ccc",
            fontSize: s(20),
            color: "#888",
          },
        },
        text({}, `H: ${w.high}\u00B0`),
        text({}, `L: ${w.low}\u00B0`),
      ),
    ),
    // Right group: hourly forecasts
    el(
      "div",
      { style: { display: "flex", gap: s(32) } },
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
          text({ fontSize: s(18), color: "#888" }, h.time),
          text({ fontSize: s(22), marginTop: s(4) }, `${h.temp}\u00B0`),
        ),
      ),
    ),
  );
}

function buildTodaySection(data: KitchenData): El {
  const visibleEvents = data.todayEvents.slice(0, data.maxTodayEvents);
  const overflow = data.todayEvents.length - data.maxTodayEvents;

  const todayContent: (El | string | null | false)[] =
    data.todayEvents.length === 0
      ? [
          text(
            {
              fontSize: s(22),
              color: "#888",
              fontStyle: "italic",
              marginTop: s(20),
            },
            "No events today",
          ),
        ]
      : [
          ...visibleEvents.map((e) => eventRow(e, true)),
          ...(overflow > 0
            ? [
                text(
                  { fontSize: s(18), color: "#888", marginTop: s(8) },
                  `+${overflow} more`,
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
    sectionHeader("Today", iconCalendar(s(24))),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: s(20),
        },
      },
      ...todayContent,
    ),
    data.tomorrowEvents.length > 0
      ? el(
          "div",
          {
            style: {
              marginTop: s(40),
              paddingTop: s(32),
              borderTop: "1px solid #ccc",
              display: "flex",
              flexDirection: "column",
            },
          },
          text(
            {
              fontSize: s(20),
              fontWeight: 500,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "#888",
              marginBottom: s(20),
            },
            "Tomorrow",
          ),
          el(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: s(16),
              },
            },
            ...data.tomorrowEvents.map((e) => eventRow(e, false)),
          ),
        )
      : false,
  );
}

function buildTaskSection(data: KitchenData): El {
  const taskContent: (El | string | null | false)[] =
    data.tasks.length === 0
      ? [
          el(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: s(8),
                marginTop: s(20),
                color: "#888",
              },
            },
            iconCheck(s(20)),
            text(
              {
                fontSize: s(22),
                fontStyle: "italic",
              },
              "All clear",
            ),
          ),
        ]
      : data.tasks.map((t) => taskRow(t));

  return el(
    "div",
    {
      style: {
        flex: 1,
        borderLeft: "1px solid #ccc",
        paddingLeft: s(48),
        display: "flex",
        flexDirection: "column",
      },
    },
    sectionHeader("Don't Forget", iconCheckSquare(s(24))),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: s(20),
        },
      },
      ...taskContent,
    ),
  );
}

function buildFooter(data: KitchenData): El {
  return el(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "space-between",
        paddingTop: s(24),
        borderTop: "1px solid #1a1a1a",
        fontSize: s(14),
        color: "#888",
      },
    },
    text({}, `Last updated ${data.time}`),
    text({}, "cortex v0.1"),
  );
}

// ─── Main Export ───────────────────────────────────────────────

export function buildLayout(
  data: KitchenData,
  width: number,
  height: number,
): El {
  const factor = Math.min(width / REF_W, height / REF_H);
  s = (px) => Math.round(px * factor);

  const header = buildHeader(data);
  const weatherStrip = buildWeatherStrip(data);
  const mainContent = el(
    "div",
    {
      style: {
        flex: 1,
        display: "flex",
        gap: s(48),
        paddingTop: s(32),
        overflow: "hidden",
      },
    },
    buildTodaySection(data),
    buildTaskSection(data),
  );
  const footer = buildFooter(data);

  return el(
    "div",
    {
      style: {
        width,
        height,
        backgroundColor: "#f5f5f5",
        color: "#1a1a1a",
        padding: s(48),
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
