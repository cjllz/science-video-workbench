import { afterEach, describe, expect, it, vi } from "vitest";
import { createShutdownController } from "./shutdown.js";

describe("graceful shutdown controller", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects new mutations as soon as shutdown begins", async () => {
    const controller = createShutdownController({
      timeoutMs: 30,
      waitForWork: async () => undefined,
      closeServer: async () => undefined,
      closeDatabase: () => undefined
    });
    const closing = controller.begin();
    expect(controller.acceptingWork()).toBe(false);
    await expect(closing).resolves.toEqual({ drained: true });
  });

  it("does not wait beyond its deadline", async () => {
    vi.useFakeTimers();
    const controller = createShutdownController({
      timeoutMs: 30,
      waitForWork: () => new Promise(() => undefined),
      closeServer: async () => undefined,
      closeDatabase: () => undefined
    });
    const closing = controller.begin();
    await vi.advanceTimersByTimeAsync(31);
    await expect(closing).resolves.toEqual({ drained: false });
  });

  it("applies the deadline while the HTTP server is still closing", async () => {
    vi.useFakeTimers();
    const controller = createShutdownController({
      timeoutMs: 30,
      closeServer: () => new Promise(() => undefined),
      waitForWork: async () => undefined,
      closeDatabase: () => undefined
    });
    const closing = controller.begin();
    await vi.advanceTimersByTimeAsync(31);
    await expect(closing).resolves.toEqual({ drained: false });
  });

  it("marks readiness first, closes resources once, and is idempotent", async () => {
    const calls: string[] = [];
    const controller = createShutdownController({
      timeoutMs: 30,
      beginReadinessShutdown: () => { calls.push("unready"); },
      closeServer: async () => { calls.push("server"); },
      waitForWork: async () => { calls.push("work"); },
      closeDatabase: () => { calls.push("database"); }
    });

    const first = controller.begin();
    const second = controller.begin();
    expect(second).toBe(first);
    await first;
    expect(calls).toEqual(["unready", "server", "work", "database"]);
  });
});
