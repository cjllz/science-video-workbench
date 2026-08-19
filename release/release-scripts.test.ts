import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const releaseRoot = path.join(projectRoot, "release");
const directBash = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0 ? "bash" : undefined;
const gitExecPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim();
const gitBash = gitExecPath ? path.resolve(gitExecPath, "..", "..", "..", "bin", "bash.exe") : undefined;
const bash = directBash ?? (gitBash && existsSync(gitBash) ? gitBash : undefined);

function bashPath(value: string): string {
  const match = value.match(/^([A-Za-z]):\\(.*)$/);
  return match ? `/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}` : value;
}

function releaseFile(name: string): string {
  const file = path.join(releaseRoot, name);
  expect(existsSync(file), `missing release/${name}`).toBe(true);
  return readFileSync(file, "utf8");
}

describe("server release contracts", () => {
  it("uses a fixed public image without a source build", () => {
    const compose = releaseFile("compose.release.yaml");
    expect(compose).toContain("image: ${APP_IMAGE:?APP_IMAGE must be set}:${APP_VERSION:?APP_VERSION must be set}");
    expect(compose).toContain("platform: linux/amd64");
    expect(compose).not.toContain("build:");
    expect(compose).not.toMatch(/ports:[\s\S]*8787:8787/);
  });

  it("guards installation and persistent data", () => {
    const install = releaseFile("install.sh");
    expect(install).toContain("require_root");
    expect(install).toContain("require_amd64");
    expect(install).toContain("Docker Compose v2 is required");
    expect(install).toContain(".science-video-workbench-data");
    expect(install).toContain("wait_for_readiness");
  });

  it("requires an idle service and backup before update", () => {
    const update = releaseFile("update.sh");
    expect(update).toContain("check-idle");
    expect(update).toContain("backup.sh");
    expect(update).toContain("previous_image_id");
    expect(update).toContain("wait_for_readiness");
  });

  it("preserves persistent state unless destruction is explicitly confirmed", () => {
    const uninstall = releaseFile("uninstall.sh");
    expect(uninstall).toContain("--destroy-data");
    expect(uninstall).toContain("--confirm-destroy-data");
    expect(uninstall).not.toContain("down --volumes");
    expect(uninstall).toContain("require_data_layout");
  });

  it.skipIf(!bash)("passes Bash syntax validation", () => {
    for (const name of ["lib.sh", "configure.sh", "install.sh", "update.sh", "uninstall.sh"]) {
      const file = path.join(releaseRoot, name);
      expect(existsSync(file), `missing release/${name}`).toBe(true);
      const result = spawnSync(bash!, ["-n", file], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
  });

  it.skipIf(!bash)("writes a complete non-interactive production environment", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "science-video-release-config-"));
    const environmentFile = path.join(temporaryRoot, "deploy", ".env.production");
    try {
      const command = `id() { printf '0\\n'; }; uname() { printf 'Linux\\n'; }; source '${bashPath(path.join(releaseRoot, "configure.sh"))}'`;
      const result = spawnSync(bash!, ["-c", command], {
        encoding: "utf8",
        env: {
          ...process.env,
          NONINTERACTIVE: "1",
          ENV_FILE: bashPath(environmentFile),
          INSTALL_ROOT: bashPath(path.join(temporaryRoot, "app")),
          LAN_ACCESS_TOKEN: "test-access-token-1234"
        }
      });
      expect(result.status, result.stderr).toBe(0);
      const environment = readFileSync(environmentFile, "utf8");
      expect(environment).toContain("APP_IMAGE=ghcr.io/cjllz/science-video-workbench");
      expect(environment).toContain("APP_VERSION=0.1.0");
      expect(environment).toContain("LAN_ACCESS_TOKEN=test-access-token-1234");
      expect(environment).toContain("DATA_DIR=/srv/science-video-workbench/data");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("allows packaged maintenance scripts to select the release Compose file", () => {
    const deploymentLibrary = readFileSync(path.join(projectRoot, "deploy", "lib.sh"), "utf8");
    expect(deploymentLibrary).toContain('COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/compose.yaml}"');
    expect(deploymentLibrary).toContain('-f "$COMPOSE_FILE"');
  });
});
