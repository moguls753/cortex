/**
 * Unit tests for docker-compose.yml content.
 *
 * Scenarios: TS-9.1, TS-9.2, TS-9.3
 *
 * We parse the raw YAML text with regex rather than a YAML library so we
 * don't introduce a new dependency (C-3).
 *
 * Phase 4 contract: these tests fail because docker-compose.yml does not
 * yet contain PRELOAD_MODELS or a healthcheck block.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const COMPOSE_PATH = "docker-compose.yml";

function readCompose(): string {
  return readFileSync(COMPOSE_PATH, "utf8");
}

/**
 * Extract the text of a top-level service block (2-space indent).
 * Returns the body between `  <name>:\n` and the next top-level `  <sibling>:`
 * line (or the `volumes:` section / EOF, whichever comes first).
 */
function extractServiceBlock(yaml: string, name: string): string | null {
  const header = `\n  ${name}:\n`;
  const startIdx = yaml.indexOf(header);
  if (startIdx === -1) return null;
  const bodyStart = startIdx + header.length;
  const rest = yaml.slice(bodyStart);
  // Next 2-space indented block header terminates this service. Match any
  // line that starts with exactly 2 spaces followed by a word char and a colon.
  const endMatch = rest.match(/\n {2}[A-Za-z_][\w-]*:/);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

describe("docker-compose.yml — system status configuration", () => {
  it("TS-9.1 — whisper service sets PRELOAD_MODELS environment variable", () => {
    const block = extractServiceBlock(readCompose(), "whisper");
    expect(block).not.toBeNull();
    expect(block).toMatch(
      /PRELOAD_MODELS:\s*'?\["Systran\/faster-whisper-medium"\]'?/,
    );
  });

  it("TS-9.2 — whisper service declares a healthcheck block", () => {
    const block = extractServiceBlock(readCompose(), "whisper");
    expect(block).not.toBeNull();

    expect(block).toMatch(/healthcheck:/);
    expect(block).toMatch(
      /CMD-SHELL.*curl -sf http:\/\/localhost:8000\/health/,
    );
    expect(block).toMatch(/interval:\s*15s/);
    expect(block).toMatch(/timeout:\s*10s/);
    expect(block).toMatch(/retries:\s*20/);
    expect(block).toMatch(/start_period:\s*300s/);
  });

  it("TS-9.3 — app depends on whisper with service_started condition", () => {
    const block = extractServiceBlock(readCompose(), "app");
    expect(block).not.toBeNull();

    const whisperDepMatch = block!.match(
      /whisper:\s*\n\s*condition:\s*(service_started|service_healthy)/,
    );
    expect(whisperDepMatch).not.toBeNull();
    expect(whisperDepMatch![1]).toBe("service_started");
  });
});
