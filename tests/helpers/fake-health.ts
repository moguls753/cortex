/**
 * Fake HealthStatus objects for layout and banner rendering tests.
 *
 * The production `HealthStatus` type lives in src/web/service-checkers.ts and
 * is imported from there once it exists. Until then, this helper defines the
 * shape inline so tests can be written against the contract in
 * system-status-specification.md (AC-4.1 / AC-4.2).
 */

export type ServiceStatus = { ready: boolean; detail: string | null };

export type HealthStatus = {
  postgres: ServiceStatus;
  ollama: ServiceStatus;
  whisper: ServiceStatus;
  /** Omitted entirely when Telegram is unconfigured (AC-3.7, EC-3). */
  telegram?: ServiceStatus;
};

const ready: ServiceStatus = { ready: true, detail: null };

export function fakeHealthAllReady(): HealthStatus {
  return {
    postgres: { ...ready },
    ollama: { ...ready },
    whisper: { ...ready },
    telegram: { ...ready },
  };
}

export function fakeHealthWhisperLoading(): HealthStatus {
  return {
    postgres: { ...ready },
    ollama: { ...ready },
    whisper: {
      ready: false,
      detail: "Loading Whisper model — first boot can take several minutes",
    },
    telegram: { ...ready },
  };
}

export function fakeHealthOllamaDownloading(): HealthStatus {
  return {
    postgres: { ...ready },
    ollama: {
      ready: false,
      detail: "Downloading embedding model (qwen3-embedding)",
    },
    whisper: { ...ready },
    telegram: { ...ready },
  };
}

export function fakeHealthBothDownloading(): HealthStatus {
  return {
    postgres: { ...ready },
    ollama: {
      ready: false,
      detail: "Downloading embedding model (qwen3-embedding)",
    },
    whisper: {
      ready: false,
      detail: "Loading Whisper model — first boot can take several minutes",
    },
    telegram: { ...ready },
  };
}

export function fakeHealthPostgresDown(): HealthStatus {
  return {
    postgres: { ready: false, detail: "Database unreachable" },
    ollama: { ...ready },
    whisper: { ...ready },
    telegram: { ...ready },
  };
}

export function fakeHealthNoTelegram(): HealthStatus {
  return {
    postgres: { ...ready },
    ollama: { ...ready },
    whisper: { ...ready },
    // telegram key deliberately omitted
  };
}

export function fakeHealthNoTelegramWhisperLoading(): HealthStatus {
  return {
    postgres: { ...ready },
    ollama: { ...ready },
    whisper: {
      ready: false,
      detail: "Loading Whisper model — first boot can take several minutes",
    },
    // telegram key deliberately omitted
  };
}
