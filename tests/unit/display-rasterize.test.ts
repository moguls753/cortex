import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initWasm } from "@resvg/resvg-wasm";
import satori from "satori";
import { renderDisplay } from "../../src/display/render.js";
import { buildLayout, taskNameChars } from "../../src/display/layout.js";
import {
  makeDisplayData,
  makeEvent,
  makeTask,
  makeWeather,
} from "../helpers/display-fixtures.js";
import { ALL_DAY } from "../../src/display/types.js";

// render.ts locates the wasm binary via `import.meta.resolve`, which does not
// point at the package directory under Vitest. Initialise it here instead;
// render.ts's own attempt then no-ops.
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
});

// These tests actually rasterize. Every other display test stops at the Satori
// element tree, which cannot see the failure mode that matters most here:
// content overflowing the canvas makes Resvg abort the render (`unreachable`),
// and the route turns that into a 500 and a blank panel. Row budgets are
// supposed to make that unreachable — this is what proves it.

function busyData() {
  return makeDisplayData({
    todayEvents: Array.from({ length: 12 }, (_, i) =>
      makeEvent({
        time: `${String(8 + i).padStart(2, "0")}:00`,
        name: `Standup with a fairly long event title ${i + 1}`,
      }),
    ),
    maxTodayEvents: 20,
    upcomingDays: ["Tomorrow", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
      (label) => ({
        label,
        events: [
          // A multi-day span in the gutter, shaped by real Satori against the
          // bundled font rather than asserted as a string.
          makeEvent({ time: ALL_DAY, name: `${label} trip`, span: "to SAT" }),
          ...Array.from({ length: 3 }, (_, i) =>
            makeEvent({ name: `${label} item ${i + 1}` }),
          ),
        ],
      }),
    ),
    tasks: Array.from({ length: 12 }, (_, i) =>
      makeTask({ name: `Remember to do the thing number ${i + 1}`, due: "overdue" }),
    ),
  });
}

/**
 * The adaptive-hierarchy path: an empty today promotes the week ahead into
 * today's larger type. This is the only test that can catch the promoted row
 * budget overflowing the canvas, which aborts Resvg with `unreachable`.
 */
function quietDayData() {
  return makeDisplayData({
    todayEvents: [],
    maxTodayEvents: 20,
    upcomingDays: ["Tomorrow", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
      (label) => ({
        label,
        events: Array.from({ length: 4 }, (_, i) =>
          makeEvent({
            time: `${String(8 + i).padStart(2, "0")}:00`,
            name: `${label}: a fairly long event title number ${i + 1}`,
          }),
        ),
      }),
    ),
    tasks: Array.from({ length: 12 }, (_, i) =>
      makeTask({ name: `Remember to do the thing number ${i + 1}`, due: "overdue" }),
    ),
  });
}

/**
 * A task column carrying both blocks and the rule between them — the only
 * fixture that can catch the divider pushing the last row past the canvas.
 */
function busyMixedData() {
  return makeDisplayData({
    tasks: [
      ...Array.from({ length: 6 }, (_, i) =>
        makeTask({ name: `Still to do number ${i + 1}`, due: "overdue" }),
      ),
      // Completed rows carry no due label, per Change 2.
      ...Array.from({ length: 6 }, (_, i) =>
        makeTask({ name: `Already done number ${i + 1}`, due: null, done: true }),
      ),
    ],
  });
}

/**
 * Task names that used to abort the render. `h.task` budgeted a single name
 * line while the name had no wrapping limit at all, so a long one overflowed
 * the canvas, Resvg aborted with `unreachable`, and the route answered 500 —
 * a blank panel. Reproduced at 1872x1404 scale 1.5 and 2.0 before the clamp.
 */
const PATHOLOGICAL_NAMES = [
  // No spaces at all: Satori will not break it, so it can only be clamped.
  "A".repeat(220),
  // A German compound of the kind the capture bot actually produces.
  "Donaudampfschifffahrtsgesellschaftskapitaenswitwenrentenversicherungsantragsformular",
  // Long but wrappable — the case that used to grow the column silently.
  "Erinnere mich daran die Unterlagen fuer die Steuererklaerung zusammenzusuchen und dann bei der Bank abzugeben bevor es zu spaet wird",
  // The name from the report that should still wrap to two lines and look good.
  "Alma Haarverlängerung entfernen",
  "kurz",
];

/**
 * Every visible row carrying the same pathological name. Uniform on purpose: a
 * fixture that mixes long names with short ones lets the short rows absorb the
 * overshoot, and then the fixture stops being able to fail.
 *
 * `weather: null` is the taller task column, which is where the overflow first
 * became fatal.
 */
function pathologicalTaskData(name: string, done: boolean, hasWeather: boolean) {
  return makeDisplayData({
    todayEvents: [],
    upcomingDays: [],
    weather: hasWeather ? makeWeather() : null,
    tasks: Array.from({ length: 20 }, () =>
      makeTask({ name, due: done ? null : "overdue", done }),
    ),
  });
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("renderDisplay rasterization", () => {
  const panels: Array<[string, number, number]> = [
    ["TRMNL X", 1872, 1404],
    ["TRMNL OG", 800, 480],
  ];
  // The full band the settings page accepts, plus the default.
  const scales = [0.5, 1, 1.5, 2];

  for (const [name, width, height] of panels) {
    for (const scale of scales) {
      it(`renders ${name} ${width}x${height} at scale ${scale}`, async () => {
        const png = await renderDisplay(busyData(), width, height, scale);

        expect(png.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
        expect(png.length).toBeGreaterThan(0);
        // Firmware rejects anything larger.
        expect(png.length).toBeLessThan(750_000);
      });

      it(`renders a promoted week ahead on ${name} ${width}x${height} at scale ${scale}`, async () => {
        const png = await renderDisplay(quietDayData(), width, height, scale);

        expect(png.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
        expect(png.length).toBeGreaterThan(0);
        expect(png.length).toBeLessThan(750_000);
      });

      it(`renders a done-heavy task column on ${name} ${width}x${height} at scale ${scale}`, async () => {
        const png = await renderDisplay(busyMixedData(), width, height, scale);

        expect(png.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
        expect(png.length).toBeGreaterThan(0);
        expect(png.length).toBeLessThan(750_000);
      });

      it(`renders pathological task names on ${name} ${width}x${height} at scale ${scale}`, async () => {
        for (const taskName of PATHOLOGICAL_NAMES) {
          for (const done of [false, true]) {
            for (const hasWeather of [false, true]) {
              const png = await renderDisplay(
                pathologicalTaskData(taskName, done, hasWeather),
                width,
                height,
                scale,
              );

              expect(png.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
              expect(png.length).toBeLessThan(750_000);
            }
          }
        }
      });
    }
  }

  // The row budget decides a task row's height from `taskNameChars` — how many
  // characters it believes fit on one line. If that number is ever larger than
  // what Satori actually fits, a row draws a line taller than it was budgeted
  // for and the column can run off the canvas again. Nothing short of real
  // shaping can check it, so it is checked here.
  describe("task name capacity", () => {
    const fontDir = join(
      import.meta.dirname,
      "..",
      "..",
      "src",
      "display",
      "fonts",
    );
    const fonts = [
      {
        name: "JetBrains Mono",
        data: readFileSync(join(fontDir, "JetBrainsMono-Regular.ttf")),
        weight: 400 as const,
        style: "normal" as const,
      },
      {
        name: "JetBrains Mono",
        data: readFileSync(join(fontDir, "JetBrainsMono-Medium.ttf")),
        weight: 500 as const,
        style: "normal" as const,
      },
    ];

    // Single-letter words, so word wrap may break at any column — the hardest
    // case for a character-count estimate. "z" appears nowhere else on the
    // panel, which is what makes the marker unambiguous.
    const nameOf = (chars: number) => {
      const words = Math.floor((chars + 1) / 2);
      const built = Array(words).fill("z").join(" ");
      return built.length < chars ? `${built}q` : built;
    };

    async function lineCount(name: string, scale: number): Promise<number> {
      const data = makeDisplayData({
        // Nothing else on the panel may contain a "z".
        date: "Monday, March 31",
        todayEvents: [],
        upcomingDays: [],
        weather: null,
        tasks: [makeTask({ name, due: "overdue" })],
      });
      const svg = await satori(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildLayout(data, 1872, 1404, scale) as any,
        { width: 1872, height: 1404, embedFont: false, fonts },
      );
      // One baseline per rendered line of the name.
      return new Set(
        [...svg.matchAll(/<text [^>]*?y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
          .filter((m) => m[2].startsWith("z"))
          .map((m) => m[1]),
      ).size;
    }

    for (const scale of [0.5, 1, 1.5, 2]) {
      it(`fits ${scale}x's budgeted character count on one line`, async () => {
        const chars = taskNameChars(1872, scale);
        expect(chars).toBeGreaterThan(0);
        expect(nameOf(chars)).toHaveLength(chars);
        expect(await lineCount(nameOf(chars), scale)).toBe(1);
      });
    }
  });

  it("renders an empty day without weather", async () => {
    const data = makeDisplayData({
      todayEvents: [],
      upcomingDays: [],
      tasks: [],
      weather: null,
    });

    const png = await renderDisplay(data, 1872, 1404, 2);

    expect(png.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
  });
});
