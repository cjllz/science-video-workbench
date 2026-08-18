import { describe, expect, it, vi } from "vitest";
import { createReadiness } from "./readiness.js";

describe("deployment readiness", () => {
  it("returns only component names for failed checks", async () => {
    const readiness = createReadiness({
      database: async () => undefined,
      dataDirectory: async () => { throw new Error("/secret/path is read-only"); },
      ffmpeg: async () => undefined,
      tts: async () => undefined
    });
    expect(await readiness.inspect()).toEqual({ ok: false, failed: ["dataDirectory"] });
  });

  it("becomes unavailable as soon as shutdown starts", async () => {
    const readiness = createReadiness({
      database: async () => undefined,
      dataDirectory: async () => undefined,
      ffmpeg: async () => undefined,
      tts: async () => undefined
    });
    readiness.beginShutdown();
    expect(await readiness.inspect()).toEqual({ ok: false, failed: ["shutdown"] });
  });

  it("caches tooling checks but repeats storage checks", async () => {
    const checks = {
      database: vi.fn(async () => undefined),
      dataDirectory: vi.fn(async () => undefined),
      ffmpeg: vi.fn(async () => undefined),
      tts: vi.fn(async () => undefined)
    };
    const readiness = createReadiness(checks);

    expect(await readiness.inspect()).toEqual({ ok: true, failed: [] });
    expect(await readiness.inspect()).toEqual({ ok: true, failed: [] });
    expect(checks.database).toHaveBeenCalledTimes(2);
    expect(checks.dataDirectory).toHaveBeenCalledTimes(2);
    expect(checks.ffmpeg).toHaveBeenCalledTimes(1);
    expect(checks.tts).toHaveBeenCalledTimes(1);
  });
});
