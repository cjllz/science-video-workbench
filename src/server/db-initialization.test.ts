import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { projectRoot } from "./paths.js";

const temporaryRoots: string[] = [];
const workerCount = 8;
const roundCount = 10;
const workerReadyTimeoutMs = 30_000;
const testTimeoutMs = 120_000;

function waitForFiles(paths: string[], timeoutMs = workerReadyTimeoutMs): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (paths.every(existsSync)) return resolve();
      if (Date.now() >= deadline) return reject(new Error("Timed out waiting for database workers"));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function spawnDatabaseImport(moduleUrl: string, readyPath: string, startPath: string) {
  const script = `await import(${JSON.stringify(moduleUrl)});`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: projectRoot,
    env: { ...process.env, DB_INIT_READY_PATH: readyPath, DB_INIT_START_PATH: startPath },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const result = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
  return { child, result };
}

describe("database initialization", () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("initializes one fresh database from concurrent processes", async () => {
    const temporaryProject = mkdtempSync(path.join(tmpdir(), "science-video-db-init-"));
    temporaryRoots.push(temporaryProject);
    cpSync(path.join(projectRoot, "src"), path.join(temporaryProject, "src"), { recursive: true });

    const databaseModulePath = path.join(temporaryProject, "src", "server", "db.ts");
    const source = readFileSync(databaseModulePath, "utf8");
    const openStatement = "const db = new DatabaseSync(databasePath);";
    const instrumentedSource = source.replace(openStatement, `${openStatement}
fs.writeFileSync(process.env.DB_INIT_READY_PATH!, "ready");
while (!fs.existsSync(process.env.DB_INIT_START_PATH!)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);`);
    expect(instrumentedSource).not.toBe(source);
    writeFileSync(databaseModulePath, instrumentedSource);

    const moduleUrl = pathToFileURL(databaseModulePath).href;
    for (let round = 0; round < roundCount; round += 1) {
      rmSync(path.join(temporaryProject, "data"), { recursive: true, force: true });
      const startPath = path.join(temporaryProject, `start-${round}`);
      const readyPaths = Array.from({ length: workerCount }, (_, index) => path.join(temporaryProject, `ready-${round}-${index}`));
      const workers = readyPaths.map((readyPath) => spawnDatabaseImport(moduleUrl, readyPath, startPath));
      let results: Array<{ code: number | null; stderr: string }>;
      try {
        await waitForFiles(readyPaths);
        writeFileSync(startPath, "start");
        results = await Promise.all(workers.map((worker) => worker.result));
      } finally {
        if (!existsSync(startPath)) writeFileSync(startPath, "release");
        for (const worker of workers) {
          if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill();
        }
        await Promise.allSettled(workers.map((worker) => worker.result));
      }

      expect(results, `round ${round + 1}\n${results.map((result) => result.stderr).filter(Boolean).join("\n")}`).toEqual(
        Array.from({ length: workerCount }, () => ({ code: 0, stderr: "" }))
      );
    }

    const verification = new DatabaseSync(path.join(temporaryProject, "data", "studio.sqlite"));
    try {
      expect(verification.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      const tables = verification.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
        "jobs", "job_events", "feedback", "data_assets", "material_assets", "job_revisions"
      ]));
    } finally {
      verification.close();
    }
  }, testTimeoutMs);
});
