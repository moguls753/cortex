import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes timestamp, level, module, and message in log output", async () => {
    const { createLogger } = await import("../../src/logger.js");
    const logger = createLogger("test-module");

    logger.info("test message");

    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(parsed.level).toBe("info");
    expect(parsed.module).toBe("test-module");
    expect(parsed.message).toBe("test message");
  });

  it("includes context object when provided", async () => {
    const { createLogger } = await import("../../src/logger.js");
    const logger = createLogger("test-module");

    logger.error("failed", { code: 500, detail: "timeout" });

    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.context).toEqual({ code: 500, detail: "timeout" });
  });

  describe("log levels", () => {
    it("outputs level 'debug' for debug()", async () => {
      const { createLogger } = await import("../../src/logger.js");
      const logger = createLogger("test-module");

      logger.debug("debug message");

      const output = stdoutSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("debug");
    });

    it("outputs level 'info' for info()", async () => {
      const { createLogger } = await import("../../src/logger.js");
      const logger = createLogger("test-module");

      logger.info("info message");

      const output = stdoutSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("info");
    });

    it("outputs level 'warn' for warn()", async () => {
      const { createLogger } = await import("../../src/logger.js");
      const logger = createLogger("test-module");

      logger.warn("warn message");

      const output = stdoutSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("warn");
    });

    it("outputs level 'error' for error()", async () => {
      const { createLogger } = await import("../../src/logger.js");
      const logger = createLogger("test-module");

      logger.error("error message");

      const output = stdoutSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("error");
    });
  });

  it("produces newline-delimited JSON on stdout", async () => {
    const { createLogger } = await import("../../src/logger.js");
    const logger = createLogger("test-module");

    logger.info("first message");
    logger.warn("second message");

    const allOutput = stdoutSpy.mock.calls
      .map((call) => call[0] as string)
      .join("");

    const lines = allOutput.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);

    // Each line should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
