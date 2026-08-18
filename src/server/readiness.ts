import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type ReadinessComponent = "database" | "dataDirectory" | "ffmpeg" | "tts" | "shutdown";

export interface ReadinessChecks {
  database: () => void | Promise<void>;
  dataDirectory: () => void | Promise<void>;
  ffmpeg: () => void | Promise<void>;
  tts: () => void | Promise<void>;
}

export interface ReadinessResult {
  ok: boolean;
  failed: ReadinessComponent[];
}

function cachedCheck(check: () => void | Promise<void>): () => Promise<boolean> {
  let result: Promise<boolean> | undefined;
  return () => {
    result ??= Promise.resolve().then(check).then(() => true, () => false);
    return result;
  };
}

export function createReadiness(checks: ReadinessChecks) {
  let shuttingDown = false;
  const ffmpegReady = cachedCheck(checks.ffmpeg);
  const ttsReady = cachedCheck(checks.tts);

  return {
    beginShutdown(): void {
      shuttingDown = true;
    },
    async inspect(): Promise<ReadinessResult> {
      if (shuttingDown) return { ok: false, failed: ["shutdown"] };
      const results = await Promise.all([
        Promise.resolve().then(checks.database).then(() => true, () => false),
        Promise.resolve().then(checks.dataDirectory).then(() => true, () => false),
        ffmpegReady(),
        ttsReady()
      ]);
      const components: ReadinessComponent[] = ["database", "dataDirectory", "ffmpeg", "tts"];
      const failed = components.filter((_component, index) => !results[index]);
      return { ok: failed.length === 0, failed };
    }
  };
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: "ignore",
      signal: AbortSignal.timeout(10_000)
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(code === 0 ? undefined : new Error("dependency check failed")));
  });
}

export function createDeploymentReadiness(options: {
  database: () => void | Promise<void>;
  dataDirectory: string;
  ffmpegPath: string;
  pythonPath?: string;
}) {
  return createReadiness({
    database: options.database,
    async dataDirectory() {
      const probe = path.join(options.dataDirectory, `.readiness-${randomUUID()}`);
      try {
        await fs.writeFile(probe, "ready", { flag: "wx" });
      } finally {
        await fs.rm(probe, { force: true });
      }
    },
    ffmpeg: () => runCommand(options.ffmpegPath, ["-version"]),
    tts: () => runCommand(options.pythonPath ?? process.env.PYTHON_PATH ?? "python", ["-c", "import edge_tts"])
  });
}
