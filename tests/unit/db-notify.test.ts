/**
 * Unit tests for DB NOTIFY → SSE broadcaster wiring.
 * Mocks sql.listen to verify event parsing and broadcasting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("listenForEntryChanges", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls sql.listen on 'entries_changed' channel", async () => {
    const mockListen = vi.fn().mockResolvedValue({ unlisten: vi.fn() });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    expect(mockListen).toHaveBeenCalledWith(
      "entries_changed",
      expect.any(Function),
    );
  });

  it("broadcasts parsed entry:created event", async () => {
    let capturedCallback: (payload: string) => void = () => {};
    const mockListen = vi.fn().mockImplementation((_channel, cb) => {
      capturedCallback = cb;
      return Promise.resolve({ unlisten: vi.fn() });
    });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    capturedCallback(JSON.stringify({
      type: "entry:created",
      data: { id: "abc-123", name: "Test", category: "tasks", confidence: 0.9 },
    }));

    expect(mockBroadcaster.broadcast).toHaveBeenCalledWith({
      type: "entry:created",
      data: { id: "abc-123", name: "Test", category: "tasks", confidence: 0.9 },
    });
  });

  it("broadcasts parsed entry:updated event", async () => {
    let capturedCallback: (payload: string) => void = () => {};
    const mockListen = vi.fn().mockImplementation((_channel, cb) => {
      capturedCallback = cb;
      return Promise.resolve({ unlisten: vi.fn() });
    });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    capturedCallback(JSON.stringify({
      type: "entry:updated",
      data: { id: "abc-123", name: "Updated", category: "ideas", confidence: 0.8 },
    }));

    expect(mockBroadcaster.broadcast).toHaveBeenCalledWith({
      type: "entry:updated",
      data: { id: "abc-123", name: "Updated", category: "ideas", confidence: 0.8 },
    });
  });

  it("broadcasts parsed entry:deleted event", async () => {
    let capturedCallback: (payload: string) => void = () => {};
    const mockListen = vi.fn().mockImplementation((_channel, cb) => {
      capturedCallback = cb;
      return Promise.resolve({ unlisten: vi.fn() });
    });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    capturedCallback(JSON.stringify({
      type: "entry:deleted",
      data: { id: "abc-123" },
    }));

    expect(mockBroadcaster.broadcast).toHaveBeenCalledWith({
      type: "entry:deleted",
      data: { id: "abc-123" },
    });
  });

  it("does not broadcast on invalid JSON payload", async () => {
    let capturedCallback: (payload: string) => void = () => {};
    const mockListen = vi.fn().mockImplementation((_channel, cb) => {
      capturedCallback = cb;
      return Promise.resolve({ unlisten: vi.fn() });
    });
    const mockSql = { listen: mockListen } as any;
    const mockBroadcaster = { broadcast: vi.fn(), subscribe: vi.fn() };

    const { listenForEntryChanges } = await import("../../src/db/notify.js");
    await listenForEntryChanges(mockSql, mockBroadcaster);

    capturedCallback("not-json");

    expect(mockBroadcaster.broadcast).not.toHaveBeenCalled();
  });
});
