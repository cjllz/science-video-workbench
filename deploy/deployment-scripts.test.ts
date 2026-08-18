import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];
const bashAvailable = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;

async function runBash(script: string, environment: NodeJS.ProcessEnv) {
  return await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn("bash", [script], {
      cwd: projectRoot,
      env: { ...process.env, ENV_FILE: path.join(tmpdir(), "missing-science-video-env"), ...environment }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("deployment script safety contracts", () => {
  it("contains locking, idle checks, restart cleanup, and partial archives", () => {
    const backup = readFileSync(path.join(projectRoot, "deploy", "backup.sh"), "utf8");
    const library = readFileSync(path.join(projectRoot, "deploy", "lib.sh"), "utf8");
    expect(backup).toContain("flock");
    expect(backup).toContain("check_idle");
    expect(library).toContain("check-idle");
    expect(backup).toMatch(/trap .*EXIT/);
    expect(backup).toContain(".partial");
    expect(backup).toContain("mv -- \"$archive_partial\" \"$archive_path\"");
  });

  it("requires explicit restore confirmation and validation", () => {
    const restore = readFileSync(path.join(projectRoot, "deploy", "restore.sh"), "utf8");
    expect(restore).toContain("--confirm-restore");
    expect(restore).toContain("sha256sum");
    expect(restore).toContain("validate-data");
    expect(restore).toContain("rollback");
  });

  it("centralizes resolved-path safety guards", () => {
    const library = readFileSync(path.join(projectRoot, "deploy", "lib.sh"), "utf8");
    expect(library).toContain("realpath -m");
    expect(library).toContain("unsafe");
    expect(library).toContain("PROJECT_ROOT");
  });

  it.skipIf(!bashAvailable)("refuses an unsafe data root before invoking Docker", async () => {
    const temporaryBackup = mkdtempSync(path.join(tmpdir(), "science-video-backup-"));
    temporaryDirectories.push(temporaryBackup);
    const result = await runBash("deploy/backup.sh", { DATA_DIR: "/", BACKUP_DIR: temporaryBackup });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unsafe DATA_DIR");
  });
});
