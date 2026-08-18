export interface ShutdownResult {
  drained: boolean;
}

export interface ShutdownControllerOptions {
  timeoutMs: number;
  beginReadinessShutdown?: () => void;
  closeServer: () => Promise<void>;
  waitForWork: () => Promise<void>;
  closeDatabase: () => void | Promise<void>;
}

export function createShutdownController(options: ShutdownControllerOptions) {
  let acceptingWork = true;
  let closing: Promise<ShutdownResult> | undefined;

  const begin = (): Promise<ShutdownResult> => {
    if (closing) return closing;

    acceptingWork = false;
    options.beginReadinessShutdown?.();
    closing = (async () => {
      try {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const drained = await Promise.race([
          (async () => {
            await options.closeServer();
            await options.waitForWork();
            return true;
          })(),
          new Promise<false>((resolve) => {
            timeout = setTimeout(() => resolve(false), options.timeoutMs);
          })
        ]);
        if (timeout) clearTimeout(timeout);
        return { drained };
      } finally {
        await options.closeDatabase();
      }
    })();

    return closing;
  };

  return {
    acceptingWork: () => acceptingWork,
    begin
  };
}
