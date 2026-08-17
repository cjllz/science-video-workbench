import { describe, expect, it } from "vitest";
import { createConcurrencyGate } from "./concurrency-gate.js";

describe("concurrency gate", () => {
  it("runs no more than the configured number of tasks", async () => {
    const gate = createConcurrencyGate(2);
    let active = 0;
    let maximum = 0;
    const run = () => gate.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    });

    await Promise.all([run(), run(), run(), run()]);

    expect(maximum).toBe(2);
  });

  it("starts queued tasks in FIFO order", async () => {
    const gate = createConcurrencyGate(1);
    const order: number[] = [];

    await Promise.all([1, 2, 3].map((value) => gate.run(async () => {
      order.push(value);
    })));

    expect(order).toEqual([1, 2, 3]);
  });

  it("uses one slot for invalid limits", async () => {
    const gate = createConcurrencyGate(Number.NaN);
    let active = 0;
    let maximum = 0;
    const run = () => gate.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    });

    await Promise.all([run(), run()]);

    expect(maximum).toBe(1);
  });
});
