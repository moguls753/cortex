/**
 * Unit tests for the entry-visibility shared-constants wiring.
 *
 * Scenarios: TS-7.4
 */

import { describe, it, expect } from "vitest";

describe("Entry Visibility — shared constants", () => {
  // TS-7.4
  it("src/web/shared.ts exports VISIBILITY_VALUES = ['private', 'shared']", async () => {
    const shared = (await import("../../src/web/shared.js")) as unknown as {
      VISIBILITY_VALUES?: readonly string[];
    };

    expect(shared.VISIBILITY_VALUES).toBeDefined();
    expect(Array.isArray(shared.VISIBILITY_VALUES)).toBe(true);
    expect([...(shared.VISIBILITY_VALUES ?? [])]).toEqual(["private", "shared"]);
  });
});
