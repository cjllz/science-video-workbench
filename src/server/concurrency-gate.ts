export interface ConcurrencyGate {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createConcurrencyGate(limit: number): ConcurrencyGate {
  const capacity = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  const queue: Array<() => void> = [];
  let active = 0;

  function acquire(): Promise<void> {
    if (active < capacity) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      queue.push(() => {
        active += 1;
        resolve();
      });
    });
  }

  function release(): void {
    active -= 1;
    queue.shift()?.();
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    }
  };
}
