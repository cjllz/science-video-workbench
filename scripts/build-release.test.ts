import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const projectVersion = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")).version;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("release packager", () => {
  it("creates a checksummed allowlist-only online bundle", () => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), "science-video-release-"));
    temporaryDirectories.push(outputDirectory);
    const result = spawnSync(process.execPath, ["scripts/build-release.mjs", "--output-dir", outputDirectory], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    expect(result.status, result.stderr).toBe(0);

    const archiveName = `science-video-workbench-v${projectVersion}-online-linux-amd64.tar.gz`;
    const archivePath = path.join(outputDirectory, archiveName);
    const checksum = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
    expect(readFileSync(`${archivePath}.sha256`, "utf8")).toBe(`${checksum}  ${archiveName}\n`);
    expect(readFileSync(path.join(outputDirectory, "SHA256SUMS"), "utf8")).toBe(`${checksum}  ${archiveName}\n`);

    const listing = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
    expect(listing.status, listing.stderr).toBe(0);
    const entries = listing.stdout.split(/\r?\n/).filter(Boolean).filter((entry) => !entry.endsWith("/"));
    const root = `science-video-workbench-v${projectVersion}/`;
    expect(entries.sort()).toEqual([
      `${root}Caddyfile`,
      `${root}README.txt`,
      `${root}VERSION`,
      `${root}compose.release.yaml`,
      `${root}configure.sh`,
      `${root}deploy/.env.production.example`,
      `${root}deploy/backup.sh`,
      `${root}deploy/lib.sh`,
      `${root}deploy/restore.sh`,
      `${root}install.sh`,
      `${root}lib.sh`,
      `${root}uninstall.sh`,
      `${root}update.sh`
    ].sort());
    expect(entries.join("\n")).not.toMatch(/(?:^|\/)(?:src|node_modules|dist|data|\.git)(?:\/|$)/);
    expect(entries.join("\n")).not.toMatch(/\.env\.production$|\.(?:sqlite|db|log|mp4|pem|key)$/);

    const verboseListing = spawnSync("tar", ["-tvzf", archivePath], { encoding: "utf8" });
    expect(verboseListing.status, verboseListing.stderr).toBe(0);
    for (const executable of ["configure.sh", "install.sh", "update.sh", "uninstall.sh", "lib.sh"]) {
      expect(verboseListing.stdout).toMatch(new RegExp(`^-rwxr-xr-x.*${executable}$`, "m"));
    }
  });

  it("refuses to overwrite an existing release archive", () => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), "science-video-release-existing-"));
    temporaryDirectories.push(outputDirectory);
    const first = spawnSync(process.execPath, ["scripts/build-release.mjs", "--output-dir", outputDirectory], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    expect(first.status, first.stderr).toBe(0);
    const second = spawnSync(process.execPath, ["scripts/build-release.mjs", "--output-dir", outputDirectory], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain("refusing to overwrite");
  });
});
